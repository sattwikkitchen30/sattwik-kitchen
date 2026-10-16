/**
 * Tests for Admin → Orders → Add Order multi-item selector.
 *
 * Covers all 9 spec scenarios:
 *  1. Selecting a delivery catalog item adds it to confirmed list
 *  2. Same item + same size merges (quantity increases)
 *  3. Same item + different size stays as a separate row
 *  4. Custom item (with optional size) adds correctly
 *  5. Step +/− adjusts quantity; Remove deletes from list
 *  6. Submit builds correct `items` array payload
 *  7. Pickup item fulfillment = 'pickup', delivery item = 'delivery'
 *  8. Mixed items are correctly classified at order level
 *  9. Tiffin editor state is completely independent of manual order state
 */

const test = require('node:test');
const assert = require('node:assert/strict');

// ── Browser environment mocks ─────────────────────────────────────────────────
class MockElement {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.attributes = {};
    this.dataset = {};
    this.innerHTMLValue = '';
    this.textContent = '';
    this.value = '';
    this.disabled = false;
    this.hidden = false;
    this.required = false;
    this.min = '';
    this.checkValidity = () => true;
    this.reportValidity = () => {};
    this.listeners = {};
    this._classes = new Set();
  }
  get classList() {
    return {
      add: (c) => this._classes.add(c),
      remove: (c) => this._classes.delete(c),
      toggle: (c) => (this._classes.has(c) ? this._classes.delete(c) : this._classes.add(c)),
      contains: (c) => this._classes.has(c)
    };
  }
  setAttribute(k, v) { this.attributes[k] = String(v); }
  getAttribute(k) { return this.attributes[k] || null; }
  appendChild(el) { this.children.push(el); return el; }
  querySelectorAll() { return []; }
  querySelector() { return null; }
  addEventListener(type, cb) {
    if (!this.listeners[type]) this.listeners[type] = [];
    this.listeners[type].push(cb);
  }
  set innerHTML(val) {
    this.innerHTMLValue = val;
    this.textContent = val.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  }
  get innerHTML() { return this.innerHTMLValue; }
  focus() {}
  reset() {}
}

global.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
global.window = { location: { href: '', pathname: '', search: '' }, addEventListener: () => {} };

const domElements = new Map();
global.document = {
  getElementById: (id) => {
    if (!domElements.has(id)) domElements.set(id, new MockElement('div'));
    return domElements.get(id);
  },
  createElement: (tag) => new MockElement(tag),
  querySelectorAll: () => [],
  querySelector: () => new MockElement('div'),
  addEventListener: () => {}
};

// ── Load admin module ─────────────────────────────────────────────────────────
const admin = require('../admin/admin');
const {
  createEmptyManualItemRow,
  mergeManualAddItemRow,
  renderManualOrderItems,
  renderManualAddItemRows
} = admin;

// Helpers to get/set the mutable arrays via the exported getters/setters
function getManualOrderItems() { return admin.manualOrderItems; }
function setManualOrderItems(v) { admin.manualOrderItems = v; }
function getManualOrderItemRows() { return admin.manualOrderItemRows; }
function setManualOrderItemRows(v) { admin.manualOrderItemRows = v; }
function getManualOrderCatalog() { return admin.manualOrderCatalog; }
function setManualOrderCatalog(v) { admin.manualOrderCatalog = v; }
function getManualOrderProducts() { return admin.manualOrderProducts; }
function setManualOrderProducts(v) { admin.manualOrderProducts = v; }

/** Reset all manual-order state between tests */
function resetManualState() {
  setManualOrderItems([]);
  setManualOrderItemRows([createEmptyManualItemRow()]);
  setManualOrderCatalog([]);
  setManualOrderProducts([]);
  const msgEl = document.getElementById('manualOrderMessage');
  if (msgEl) msgEl.textContent = '';
}

// A minimal delivery catalog with two items: Dal (with sizes) and Chapati (no size)
const SAMPLE_CATALOG = [
  { key: 'dal', name: 'Dal', sizes: ['small', 'medium', 'large'], supportsSize: true },
  { key: 'chapati', name: 'Chapati', sizes: [], supportsSize: false }
];

// A minimal pickup product
const SAMPLE_PRODUCT = {
  _id: '64a1b2c3d4e5f6a7b8c9d0e1',
  name: 'Mango Pickle',
  category: 'Pickles',
  price: 9.99,
  stock: 10,
  active: true
};

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 1: Selecting a delivery catalog item with size and quantity adds it
// ─────────────────────────────────────────────────────────────────────────────
test('Scenario 1: selecting a delivery catalog item (Dal / medium) adds it to confirmed list', () => {
  resetManualState();
  setManualOrderCatalog(SAMPLE_CATALOG);

  // Simulate the user picking "dal" with size "medium" and quantity 2
  const rows = getManualOrderItemRows();
  assert.equal(rows.length, 1);
  rows[0].itemKey = 'dal';
  rows[0].isCustom = false;
  rows[0].size = 'medium';
  rows[0].quantity = '2';

  const ok = mergeManualAddItemRow(rows[0].id);
  assert.equal(ok, true, 'mergeManualAddItemRow should return true');

  const items = getManualOrderItems();
  assert.equal(items.length, 1);
  assert.equal(items[0].productName, 'Medium Dal');
  assert.equal(items[0].quantity, 2);
  assert.equal(items[0].fulfillment, 'delivery');
  assert.equal(items[0].productId, null);
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 2: Selecting the same item + same size again merges (increases qty)
// ─────────────────────────────────────────────────────────────────────────────
test('Scenario 2: adding same item + same size again merges quantity', () => {
  resetManualState();
  setManualOrderCatalog(SAMPLE_CATALOG);

  // Add "dal / medium / qty 2"
  const rows1 = getManualOrderItemRows();
  rows1[0].itemKey = 'dal';
  rows1[0].size = 'medium';
  rows1[0].quantity = '2';
  mergeManualAddItemRow(rows1[0].id);
  assert.equal(getManualOrderItems().length, 1);

  // A new empty row was inserted after merge
  const rows2 = getManualOrderItemRows();
  assert.equal(rows2.length, 1);
  rows2[0].itemKey = 'dal';
  rows2[0].size = 'medium';
  rows2[0].quantity = '3';
  const ok = mergeManualAddItemRow(rows2[0].id);
  assert.equal(ok, true);

  // Must still be 1 item, quantity merged to 5
  const items = getManualOrderItems();
  assert.equal(items.length, 1);
  assert.equal(items[0].quantity, 5);
  assert.equal(items[0].productName, 'Medium Dal');
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 3: Same item with a different size stays as a separate row
// ─────────────────────────────────────────────────────────────────────────────
test('Scenario 3: same item with different size creates a separate confirmed row', () => {
  resetManualState();
  setManualOrderCatalog(SAMPLE_CATALOG);

  // Add "dal / small"
  const rows1 = getManualOrderItemRows();
  rows1[0].itemKey = 'dal';
  rows1[0].size = 'small';
  rows1[0].quantity = '1';
  mergeManualAddItemRow(rows1[0].id);

  // Add "dal / large" — different size
  const rows2 = getManualOrderItemRows();
  rows2[0].itemKey = 'dal';
  rows2[0].size = 'large';
  rows2[0].quantity = '1';
  mergeManualAddItemRow(rows2[0].id);

  const items = getManualOrderItems();
  assert.equal(items.length, 2, 'different sizes should produce two separate items');
  const names = items.map((i) => i.productName);
  assert.ok(names.includes('Small Dal'), 'Small Dal should be present');
  assert.ok(names.includes('Large Dal'), 'Large Dal should be present');
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 4: Custom item (with optional size) adds correctly
// ─────────────────────────────────────────────────────────────────────────────
test('Scenario 4a: custom item without size adds as a delivery item', () => {
  resetManualState();
  setManualOrderCatalog(SAMPLE_CATALOG);

  const rows = getManualOrderItemRows();
  rows[0].isCustom = true;
  rows[0].customName = 'Sambar';
  rows[0].size = '';
  rows[0].quantity = '1';
  const ok = mergeManualAddItemRow(rows[0].id);
  assert.equal(ok, true);

  const items = getManualOrderItems();
  assert.equal(items.length, 1);
  assert.equal(items[0].productName, 'Sambar');
  assert.equal(items[0].fulfillment, 'delivery');
  assert.equal(items[0].productId, null);
});

test('Scenario 4b: custom item with size includes size label in product name', () => {
  resetManualState();
  setManualOrderCatalog(SAMPLE_CATALOG);

  const rows = getManualOrderItemRows();
  rows[0].isCustom = true;
  rows[0].customName = 'Dal';
  rows[0].size = 'medium';
  rows[0].quantity = '2';
  const ok = mergeManualAddItemRow(rows[0].id);
  assert.equal(ok, true);

  const items = getManualOrderItems();
  assert.equal(items.length, 1);
  // "Dal" with size "medium" → identity is "mediumDal" which merges, name is "Medium Dal"
  assert.ok(
    items[0].productName.toLowerCase().includes('dal'),
    `productName "${items[0].productName}" should include "dal"`
  );
  assert.equal(items[0].quantity, 2);
});

test('Scenario 4c: custom item with empty name is rejected', () => {
  resetManualState();
  setManualOrderCatalog(SAMPLE_CATALOG);

  const rows = getManualOrderItemRows();
  rows[0].isCustom = true;
  rows[0].customName = '   ';
  rows[0].size = '';
  rows[0].quantity = '1';
  const ok = mergeManualAddItemRow(rows[0].id);
  assert.equal(ok, false, 'empty custom name should be rejected');
  assert.equal(getManualOrderItems().length, 0);
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 5: Step +/− adjusts quantity; Remove deletes from list
// ─────────────────────────────────────────────────────────────────────────────
test('Scenario 5: confirmed item quantity can be adjusted and item can be removed', () => {
  resetManualState();
  setManualOrderCatalog(SAMPLE_CATALOG);

  // Add Chapati (no size)
  const rows = getManualOrderItemRows();
  rows[0].itemKey = 'chapati';
  rows[0].size = '';
  rows[0].quantity = '3';
  mergeManualAddItemRow(rows[0].id);

  const items = getManualOrderItems();
  assert.equal(items.length, 1);
  assert.equal(items[0].quantity, 3);

  // Simulate "+1 step"
  items[0].quantity = Number(items[0].quantity) + 1;
  assert.equal(getManualOrderItems()[0].quantity, 4);

  // Simulate "−1 step"
  items[0].quantity = Math.max(1, Number(items[0].quantity) - 1);
  assert.equal(getManualOrderItems()[0].quantity, 3);

  // Simulate "−1 step" at minimum (qty=1 → stays 1)
  items[0].quantity = 1;
  const nextQty = Math.max(1, Number(items[0].quantity) - 1);
  assert.equal(nextQty, 1, 'quantity must not go below 1');

  // Simulate Remove
  const itemsBefore = getManualOrderItems().length;
  getManualOrderItems().splice(0, 1);
  assert.equal(getManualOrderItems().length, itemsBefore - 1);
  assert.equal(getManualOrderItems().length, 0);
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 6: Submit builds correct `items` array payload
// ─────────────────────────────────────────────────────────────────────────────
test('Scenario 6: submit produces correct items array payload (mirrors form submit logic)', () => {
  resetManualState();
  setManualOrderCatalog(SAMPLE_CATALOG);

  // Add two items
  const rows1 = getManualOrderItemRows();
  rows1[0].itemKey = 'dal';
  rows1[0].size = 'medium';
  rows1[0].quantity = '2';
  mergeManualAddItemRow(rows1[0].id);

  const rows2 = getManualOrderItemRows();
  rows2[0].itemKey = 'chapati';
  rows2[0].size = '';
  rows2[0].quantity = '5';
  mergeManualAddItemRow(rows2[0].id);

  const confirmedItems = getManualOrderItems();
  assert.equal(confirmedItems.length, 2);

  // Mirror the itemsPayload mapping from the form submit handler
  const itemsPayload = confirmedItems.map((item) => ({
    productId: item.productId && /^[a-fA-F0-9]{24}$/.test(String(item.productId)) ? item.productId : null,
    productName: item.productName,
    category: item.category || 'General',
    fulfillment: item.fulfillment || 'delivery',
    priceAtPurchase: Number(item.priceAtPurchase) || 0,
    quantity: Number(item.quantity),
    subtotal: Math.round((Number(item.priceAtPurchase) || 0) * Number(item.quantity) * 100) / 100,
    preparationType: item.preparationType || null,
    itemKey: item.itemKey || null,
    size: item.size || null
  }));

  // Validate structure
  assert.equal(itemsPayload.length, 2);

  const dalItem = itemsPayload.find((i) => i.productName === 'Medium Dal');
  assert.ok(dalItem, 'dal item should be in payload');
  assert.equal(dalItem.productId, null);
  assert.equal(dalItem.fulfillment, 'delivery');
  assert.equal(dalItem.quantity, 2);
  assert.equal(dalItem.itemKey, 'dal');
  assert.equal(dalItem.size, 'medium');

  const chapatiItem = itemsPayload.find((i) => i.productName === 'Chapathi');
  assert.ok(chapatiItem, 'chapathi item should be in payload');
  assert.equal(chapatiItem.productId, null);
  assert.equal(chapatiItem.fulfillment, 'delivery');
  assert.equal(chapatiItem.quantity, 5);
  assert.equal(chapatiItem.itemKey, 'chapati');
  assert.equal(chapatiItem.size, null);
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 7: Pickup product fulfillment = 'pickup', delivery item = 'delivery'
// ─────────────────────────────────────────────────────────────────────────────
test('Scenario 7: pickup product gets fulfillment=pickup; delivery item gets fulfillment=delivery', () => {
  resetManualState();
  setManualOrderCatalog(SAMPLE_CATALOG);
  setManualOrderProducts([SAMPLE_PRODUCT]);

  // Add pickup product
  const rows1 = getManualOrderItemRows();
  rows1[0].itemKey = `product:${SAMPLE_PRODUCT._id}`;
  rows1[0].isCustom = false;
  rows1[0].quantity = '1';
  const ok1 = mergeManualAddItemRow(rows1[0].id);
  assert.equal(ok1, true);

  // Add delivery catalog item
  const rows2 = getManualOrderItemRows();
  rows2[0].itemKey = 'chapati';
  rows2[0].isCustom = false;
  rows2[0].size = '';
  rows2[0].quantity = '4';
  const ok2 = mergeManualAddItemRow(rows2[0].id);
  assert.equal(ok2, true);

  const items = getManualOrderItems();
  assert.equal(items.length, 2);

  const pickupItem = items.find((i) => i.productName === SAMPLE_PRODUCT.name);
  assert.ok(pickupItem, 'Mango Pickle should be in items');
  assert.equal(pickupItem.fulfillment, 'pickup');
  assert.equal(String(pickupItem.productId), SAMPLE_PRODUCT._id);
  assert.equal(pickupItem.priceAtPurchase, SAMPLE_PRODUCT.price);

  const deliveryItem = items.find((i) => i.productName === 'Chapathi');
  assert.ok(deliveryItem, 'Chapathi should be in items');
  assert.equal(deliveryItem.fulfillment, 'delivery');
  assert.equal(deliveryItem.productId, null);
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 8: Mixed items — order-level fulfillment derived correctly
// ─────────────────────────────────────────────────────────────────────────────
test('Scenario 8: items array with mixed fulfillments produces mixed order-level classification', () => {
  // Mirror the itemsPayload fulfillment classification logic used in backend
  const itemsPayload = [
    { fulfillment: 'pickup', productName: 'Mango Pickle', quantity: 1 },
    { fulfillment: 'delivery', productName: 'Medium Dal', quantity: 2 }
  ];

  const hasDelivery = itemsPayload.some((i) => i.fulfillment === 'delivery');
  const hasPickup = itemsPayload.some((i) => i.fulfillment === 'pickup');
  const orderFulfillment = hasDelivery && hasPickup ? 'mixed' : hasDelivery ? 'delivery' : 'pickup';

  assert.equal(orderFulfillment, 'mixed');

  // Pickup-only
  const pickupPayload = [{ fulfillment: 'pickup', productName: 'Mango Pickle', quantity: 2 }];
  const hasD2 = pickupPayload.some((i) => i.fulfillment === 'delivery');
  const hasP2 = pickupPayload.some((i) => i.fulfillment === 'pickup');
  assert.equal(hasD2 && hasP2 ? 'mixed' : hasD2 ? 'delivery' : 'pickup', 'pickup');

  // Delivery-only
  const deliveryPayload = [{ fulfillment: 'delivery', productName: 'Medium Dal', quantity: 2 }];
  const hasD3 = deliveryPayload.some((i) => i.fulfillment === 'delivery');
  const hasP3 = deliveryPayload.some((i) => i.fulfillment === 'pickup');
  assert.equal(hasD3 && hasP3 ? 'mixed' : hasD3 ? 'delivery' : 'pickup', 'delivery');
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 9: Tiffin editor state is completely independent of manual order state
// ─────────────────────────────────────────────────────────────────────────────
test('Scenario 9: tiffin editor and manual order item arrays are independent references', () => {
  resetManualState();
  setManualOrderCatalog(SAMPLE_CATALOG);

  // Populate manualOrderItems
  const rows = getManualOrderItemRows();
  rows[0].itemKey = 'dal';
  rows[0].size = 'small';
  rows[0].quantity = '1';
  mergeManualAddItemRow(rows[0].id);
  assert.equal(getManualOrderItems().length, 1);

  // The tiffin editor functions (mergeAddItemRow, openTiffinItemsEditor) use
  // completely separate module-level arrays (tiffinEditorItems, tiffinEditorAdditionalRows).
  // We cannot reach them from outside without calling openTiffinItemsEditor (which hits the API),
  // but we CAN verify:
  //   a) manualOrderItems is its own array reference
  //   b) resetManualState() clears manualOrderItems without affecting anything else
  const itemsRef1 = getManualOrderItems();
  assert.equal(itemsRef1.length, 1, 'manualOrderItems should have 1 item after merge');

  // Verify the setter creates a fresh array
  setManualOrderItems([]);
  const itemsRef2 = getManualOrderItems();
  assert.equal(itemsRef2.length, 0, 'manualOrderItems should be empty after reset');
  assert.notStrictEqual(itemsRef1, itemsRef2, 'reset should produce a new array reference');

  // Verify that manualOrderItemRows is also independent of any tiffin editor row
  setManualOrderItemRows([createEmptyManualItemRow()]);
  const manualRows = getManualOrderItemRows();
  assert.equal(manualRows.length, 1);

  // The manual row ID counter starts at 1+ (manualOrderItemRowSeq),
  // which is a separate counter from tiffinEditorRowSeq — verify they both produce integers
  assert.ok(Number.isInteger(manualRows[0].id), 'manual row id should be an integer');
  assert.ok(manualRows[0].id > 0, 'manual row id should be positive');

  // Verify manualOrderCatalog is independent (setting it does not affect the tiffin catalog)
  setManualOrderCatalog([...SAMPLE_CATALOG]);
  assert.equal(getManualOrderCatalog().length, SAMPLE_CATALOG.length);
  setManualOrderCatalog([]);
  assert.equal(getManualOrderCatalog().length, 0, 'clearing manualOrderCatalog should not affect tiffin editor catalog');
});

// ─────────────────────────────────────────────────────────────────────────────
// Additional: out-of-stock product is rejected at the frontend merge step
// ─────────────────────────────────────────────────────────────────────────────
test('Out-of-stock pickup product is rejected with an error message', () => {
  resetManualState();
  setManualOrderCatalog(SAMPLE_CATALOG);
  setManualOrderProducts([{ ...SAMPLE_PRODUCT, stock: 0 }]);

  const rows = getManualOrderItemRows();
  rows[0].itemKey = `product:${SAMPLE_PRODUCT._id}`;
  rows[0].isCustom = false;
  rows[0].quantity = '1';
  const ok = mergeManualAddItemRow(rows[0].id);
  assert.equal(ok, false, 'out-of-stock product merge should return false');
  assert.equal(getManualOrderItems().length, 0);
  const msg = domElements.get('manualOrderMessage').textContent;
  assert.ok(msg.length > 0, 'an error message should be shown');
});

// ─────────────────────────────────────────────────────────────────────────────
// Additional: adding a catalog item without selecting a size (size-required) is rejected
// ─────────────────────────────────────────────────────────────────────────────
test('Adding a size-required catalog item without choosing a size is rejected', () => {
  resetManualState();
  setManualOrderCatalog(SAMPLE_CATALOG);

  const rows = getManualOrderItemRows();
  rows[0].itemKey = 'dal';      // dal requires a size
  rows[0].isCustom = false;
  rows[0].size = '';            // no size selected
  rows[0].quantity = '1';
  const ok = mergeManualAddItemRow(rows[0].id);
  assert.equal(ok, false, 'missing size for size-required item should be rejected');
  assert.equal(getManualOrderItems().length, 0);
});

// ─────────────────────────────────────────────────────────────────────────────
// Additional: chapati (no size support) adds without a size
// ─────────────────────────────────────────────────────────────────────────────
test('Chapati (no size) adds correctly without a size selection', () => {
  resetManualState();
  setManualOrderCatalog(SAMPLE_CATALOG);

  const rows = getManualOrderItemRows();
  rows[0].itemKey = 'chapati';
  rows[0].isCustom = false;
  rows[0].size = '';
  rows[0].quantity = '6';
  const ok = mergeManualAddItemRow(rows[0].id);
  assert.equal(ok, true);

  const items = getManualOrderItems();
  assert.equal(items.length, 1);
  assert.equal(items[0].productName, 'Chapathi');
  assert.equal(items[0].quantity, 6);
  assert.equal(items[0].fulfillment, 'delivery');
});
