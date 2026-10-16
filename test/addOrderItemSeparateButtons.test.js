/**
 * Tests for Admin → Orders → separate "Add Delivery Order" / "Add Pickup Order" buttons.
 *
 * Covers 8 spec scenarios:
 *  1. openManualOrderModal('delivery') sets manualOrderMode = 'delivery'; catalog populated, products empty
 *  2. openManualOrderModal('pickup')  sets manualOrderMode = 'pickup';  products populated, catalog empty
 *  3. In delivery mode, merging a catalog item produces fulfillment = 'delivery'
 *  4. In pickup mode, merging a pickup product produces fulfillment = 'pickup'
 *  5. Switching from delivery → pickup resets catalog (delivery items don't leak)
 *  6. Switching from pickup → delivery resets products (pickup items don't leak)
 *  7. mergeManualAddItemRow handles 'product:<id>' key correctly in pickup mode
 *  8. Form submit fulfillment comes from manualOrderMode, NOT state.ordersFulfillment
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
      toggle: (c, force) => {
        if (force === true) { this._classes.add(c); }
        else if (force === false) { this._classes.delete(c); }
        else { this._classes.has(c) ? this._classes.delete(c) : this._classes.add(c); }
      },
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
  openManualOrderModal,
  createEmptyManualItemRow,
  mergeManualAddItemRow,
  renderManualOrderItems,
  renderManualAddItemRows
} = admin;

// Helpers for mutable state via exported getters/setters
function getManualOrderMode()    { return admin.manualOrderMode; }
function setManualOrderMode(v)   { admin.manualOrderMode = v; }
function getManualOrderItems()   { return admin.manualOrderItems; }
function setManualOrderItems(v)  { admin.manualOrderItems = v; }
function getManualOrderItemRows()  { return admin.manualOrderItemRows; }
function setManualOrderItemRows(v) { admin.manualOrderItemRows = v; }
function getManualOrderCatalog()   { return admin.manualOrderCatalog; }
function setManualOrderCatalog(v)  { admin.manualOrderCatalog = v; }
function getManualOrderProducts()  { return admin.manualOrderProducts; }
function setManualOrderProducts(v) { admin.manualOrderProducts = v; }

/** Full reset of all manual-order state between tests */
function resetManualState() {
  setManualOrderItems([]);
  setManualOrderItemRows([createEmptyManualItemRow()]);
  setManualOrderCatalog([]);
  setManualOrderProducts([]);
  const msgEl = document.getElementById('manualOrderMessage');
  if (msgEl) msgEl.textContent = '';
}

// ── Sample data ───────────────────────────────────────────────────────────────
const SAMPLE_CATALOG = [
  { key: 'dal',    name: 'Dal',    sizes: ['small', 'medium', 'large'], supportsSize: true },
  { key: 'chapati', name: 'Chapati', sizes: [], supportsSize: false }
];

const SAMPLE_PICKUP_PRODUCT = {
  _id: '64a1b2c3d4e5f6a7b8c9d0e1',
  name: 'Mango Pickle',
  category: 'Pickles',
  price: 9.99,
  stock: 10,
  active: true
};

const ANOTHER_PICKUP_PRODUCT = {
  _id: '74b2c3d4e5f6a7b8c9d0e1f2',
  name: 'Red Chilli Powder',
  category: 'Powders',
  price: 4.99,
  stock: 5,
  active: true
};

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 1: openManualOrderModal('delivery') sets mode and clears products
// ─────────────────────────────────────────────────────────────────────────────
test('Scenario 1: openManualOrderModal("delivery") sets manualOrderMode to "delivery" and resets state', () => {
  // Pre-populate with pickup state to verify reset
  setManualOrderMode('pickup');
  setManualOrderProducts([SAMPLE_PICKUP_PRODUCT]);
  setManualOrderCatalog([]);
  setManualOrderItems([{ productName: 'Mango Pickle', fulfillment: 'pickup', quantity: 1 }]);

  openManualOrderModal('delivery');

  assert.equal(getManualOrderMode(), 'delivery', 'mode should be "delivery"');
  assert.deepEqual(getManualOrderItems(), [], 'items should be reset to []');
  assert.deepEqual(getManualOrderCatalog(), [], 'catalog should be reset to []');
  assert.deepEqual(getManualOrderProducts(), [], 'products should be reset to []');
  // One empty row should be present after reset
  const rows = getManualOrderItemRows();
  assert.equal(rows.length, 1, 'should have exactly one empty item row after reset');
  assert.equal(rows[0].itemKey, '', 'empty row itemKey should be blank');
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 2: openManualOrderModal('pickup') sets mode and clears catalog
// ─────────────────────────────────────────────────────────────────────────────
test('Scenario 2: openManualOrderModal("pickup") sets manualOrderMode to "pickup" and resets state', () => {
  // Pre-populate with delivery state to verify reset
  setManualOrderMode('delivery');
  setManualOrderCatalog([...SAMPLE_CATALOG]);
  setManualOrderProducts([]);
  setManualOrderItems([{ productName: 'Medium Dal', fulfillment: 'delivery', quantity: 2 }]);

  openManualOrderModal('pickup');

  assert.equal(getManualOrderMode(), 'pickup', 'mode should be "pickup"');
  assert.deepEqual(getManualOrderItems(), [], 'items should be reset to []');
  assert.deepEqual(getManualOrderCatalog(), [], 'catalog should be reset to []');
  assert.deepEqual(getManualOrderProducts(), [], 'products should be reset to []');
  const rows = getManualOrderItemRows();
  assert.equal(rows.length, 1, 'should have exactly one empty item row after reset');
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 3: Delivery mode — merging catalog item produces fulfillment='delivery'
// ─────────────────────────────────────────────────────────────────────────────
test('Scenario 3: in delivery mode, merging a catalog item produces fulfillment="delivery"', () => {
  resetManualState();
  openManualOrderModal('delivery');
  setManualOrderCatalog([...SAMPLE_CATALOG]);

  const rows = getManualOrderItemRows();
  rows[0].itemKey = 'dal';
  rows[0].isCustom = false;
  rows[0].size = 'medium';
  rows[0].quantity = '2';

  const ok = mergeManualAddItemRow(rows[0].id);
  assert.equal(ok, true, 'merge should succeed');

  const items = getManualOrderItems();
  assert.equal(items.length, 1);
  assert.equal(items[0].fulfillment, 'delivery', 'delivery catalog item must have fulfillment="delivery"');
  assert.equal(items[0].productName, 'Medium Dal');
  assert.equal(items[0].quantity, 2);
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 4: Pickup mode — merging a pickup product produces fulfillment='pickup'
// ─────────────────────────────────────────────────────────────────────────────
test('Scenario 4: in pickup mode, merging a pickup product produces fulfillment="pickup"', () => {
  resetManualState();
  openManualOrderModal('pickup');
  setManualOrderProducts([SAMPLE_PICKUP_PRODUCT]);

  const rows = getManualOrderItemRows();
  rows[0].itemKey = `product:${SAMPLE_PICKUP_PRODUCT._id}`;
  rows[0].isCustom = false;
  rows[0].quantity = '3';

  const ok = mergeManualAddItemRow(rows[0].id);
  assert.equal(ok, true, 'merge should succeed');

  const items = getManualOrderItems();
  assert.equal(items.length, 1);
  assert.equal(items[0].fulfillment, 'pickup', 'pickup product must have fulfillment="pickup"');
  assert.equal(items[0].productName, SAMPLE_PICKUP_PRODUCT.name);
  assert.equal(items[0].quantity, 3);
  assert.equal(String(items[0].productId), SAMPLE_PICKUP_PRODUCT._id);
  assert.equal(items[0].priceAtPurchase, SAMPLE_PICKUP_PRODUCT.price);
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 5: Switching delivery → pickup resets catalog; delivery items don't leak
// ─────────────────────────────────────────────────────────────────────────────
test('Scenario 5: switching delivery → pickup clears delivery catalog (no cross-contamination)', () => {
  resetManualState();

  // Open as delivery and populate catalog + items
  openManualOrderModal('delivery');
  setManualOrderCatalog([...SAMPLE_CATALOG]);
  const rows1 = getManualOrderItemRows();
  rows1[0].itemKey = 'chapati';
  rows1[0].quantity = '2';
  mergeManualAddItemRow(rows1[0].id);
  assert.equal(getManualOrderItems().length, 1, 'delivery item should be present before switch');

  // Now switch to pickup — openManualOrderModal resets everything
  openManualOrderModal('pickup');

  assert.equal(getManualOrderMode(), 'pickup');
  assert.deepEqual(getManualOrderCatalog(), [], 'catalog must be cleared on mode switch');
  assert.deepEqual(getManualOrderItems(), [], 'items must be cleared on mode switch');
  assert.deepEqual(getManualOrderProducts(), [], 'products still empty until loaded');
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 6: Switching pickup → delivery resets products; pickup items don't leak
// ─────────────────────────────────────────────────────────────────────────────
test('Scenario 6: switching pickup → delivery clears pickup products (no cross-contamination)', () => {
  resetManualState();

  // Open as pickup and populate products + items
  openManualOrderModal('pickup');
  setManualOrderProducts([SAMPLE_PICKUP_PRODUCT]);
  const rows1 = getManualOrderItemRows();
  rows1[0].itemKey = `product:${SAMPLE_PICKUP_PRODUCT._id}`;
  rows1[0].quantity = '1';
  mergeManualAddItemRow(rows1[0].id);
  assert.equal(getManualOrderItems().length, 1, 'pickup item should be present before switch');

  // Now switch to delivery — openManualOrderModal resets everything
  openManualOrderModal('delivery');

  assert.equal(getManualOrderMode(), 'delivery');
  assert.deepEqual(getManualOrderProducts(), [], 'products must be cleared on mode switch');
  assert.deepEqual(getManualOrderItems(), [], 'items must be cleared on mode switch');
  assert.deepEqual(getManualOrderCatalog(), [], 'catalog still empty until loaded');
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 7: mergeManualAddItemRow handles 'product:<id>' key correctly in pickup mode
// ─────────────────────────────────────────────────────────────────────────────
test('Scenario 7: mergeManualAddItemRow handles product:<id> key correctly in pickup mode', () => {
  resetManualState();
  openManualOrderModal('pickup');
  setManualOrderProducts([SAMPLE_PICKUP_PRODUCT, ANOTHER_PICKUP_PRODUCT]);

  // Add first product
  const rows1 = getManualOrderItemRows();
  rows1[0].itemKey = `product:${SAMPLE_PICKUP_PRODUCT._id}`;
  rows1[0].quantity = '2';
  const ok1 = mergeManualAddItemRow(rows1[0].id);
  assert.equal(ok1, true, 'first product merge should succeed');

  // Add second product
  const rows2 = getManualOrderItemRows();
  rows2[0].itemKey = `product:${ANOTHER_PICKUP_PRODUCT._id}`;
  rows2[0].quantity = '1';
  const ok2 = mergeManualAddItemRow(rows2[0].id);
  assert.equal(ok2, true, 'second product merge should succeed');

  const items = getManualOrderItems();
  assert.equal(items.length, 2, 'two different pickup products must be separate items');

  const pickle = items.find((i) => i.productName === SAMPLE_PICKUP_PRODUCT.name);
  const powder = items.find((i) => i.productName === ANOTHER_PICKUP_PRODUCT.name);

  assert.ok(pickle, 'Mango Pickle should be present');
  assert.equal(pickle.fulfillment, 'pickup');
  assert.equal(pickle.quantity, 2);

  assert.ok(powder, 'Red Chilli Powder should be present');
  assert.equal(powder.fulfillment, 'pickup');
  assert.equal(powder.quantity, 1);
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 7b: adding the same pickup product twice merges quantity
// ─────────────────────────────────────────────────────────────────────────────
test('Scenario 7b: adding the same pickup product twice merges quantity in pickup mode', () => {
  resetManualState();
  openManualOrderModal('pickup');
  setManualOrderProducts([SAMPLE_PICKUP_PRODUCT]);

  // Add once
  const rows1 = getManualOrderItemRows();
  rows1[0].itemKey = `product:${SAMPLE_PICKUP_PRODUCT._id}`;
  rows1[0].quantity = '2';
  mergeManualAddItemRow(rows1[0].id);
  assert.equal(getManualOrderItems().length, 1);

  // Add same product again
  const rows2 = getManualOrderItemRows();
  rows2[0].itemKey = `product:${SAMPLE_PICKUP_PRODUCT._id}`;
  rows2[0].quantity = '3';
  mergeManualAddItemRow(rows2[0].id);

  const items = getManualOrderItems();
  assert.equal(items.length, 1, 'same pickup product should merge into one row');
  assert.equal(items[0].quantity, 5, 'quantities should add up to 5');
  assert.equal(items[0].productName, SAMPLE_PICKUP_PRODUCT.name);
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 8: Form submit fulfillment derived from manualOrderMode, not state.ordersFulfillment
// ─────────────────────────────────────────────────────────────────────────────
test('Scenario 8: fulfillment for submit comes from manualOrderMode, not state.ordersFulfillment', () => {
  resetManualState();

  // Simulate: Pickup tab active (state.ordersFulfillment = 'pickup'), but admin
  // opens DELIVERY order modal → mode should be 'delivery'
  const stateEl = admin.state;  // The exported state object
  if (stateEl && typeof stateEl === 'object') {
    // Temporarily set ordersFulfillment to 'pickup' to simulate Pickup tab being active
    const original = stateEl.ordersFulfillment;
    stateEl.ordersFulfillment = 'pickup';

    openManualOrderModal('delivery');
    assert.equal(getManualOrderMode(), 'delivery',
      'manualOrderMode must be "delivery" regardless of state.ordersFulfillment');

    // Restore
    stateEl.ordersFulfillment = original;
  } else {
    // If state is not an object we can mutate, just verify mode isolation
    openManualOrderModal('delivery');
    assert.equal(getManualOrderMode(), 'delivery');
  }

  // And the reverse: Delivery tab active, but pickup order opened
  if (stateEl && typeof stateEl === 'object') {
    const original = stateEl.ordersFulfillment;
    stateEl.ordersFulfillment = 'delivery';

    openManualOrderModal('pickup');
    assert.equal(getManualOrderMode(), 'pickup',
      'manualOrderMode must be "pickup" regardless of state.ordersFulfillment');

    stateEl.ordersFulfillment = original;
  } else {
    openManualOrderModal('pickup');
    assert.equal(getManualOrderMode(), 'pickup');
  }

  // Mirror the form submit fulfillment logic
  openManualOrderModal('delivery');
  setManualOrderCatalog([...SAMPLE_CATALOG]);
  const rows = getManualOrderItemRows();
  rows[0].itemKey = 'dal';
  rows[0].size = 'small';
  rows[0].quantity = '1';
  mergeManualAddItemRow(rows[0].id);

  const items = getManualOrderItems();
  // The form uses: const fulfillment = manualOrderMode || 'delivery'
  const fulfillmentForSubmit = getManualOrderMode() || 'delivery';
  assert.equal(fulfillmentForSubmit, 'delivery', 'submit fulfillment must be "delivery" in delivery mode');

  // Verify item-level fulfillment matches
  assert.equal(items[0].fulfillment, 'delivery');
});

// ─────────────────────────────────────────────────────────────────────────────
// Additional: unknown fulfillment argument defaults to 'delivery'
// ─────────────────────────────────────────────────────────────────────────────
test('Additional: openManualOrderModal with unexpected argument defaults to "delivery"', () => {
  resetManualState();
  openManualOrderModal('unknown-value');
  assert.equal(getManualOrderMode(), 'delivery',
    'any non-"pickup" fulfillment argument should fall back to "delivery"');
});

// ─────────────────────────────────────────────────────────────────────────────
// Additional: openManualOrderModal with no argument defaults to 'delivery'
// ─────────────────────────────────────────────────────────────────────────────
test('Additional: openManualOrderModal with no argument defaults to "delivery"', () => {
  resetManualState();
  openManualOrderModal();
  assert.equal(getManualOrderMode(), 'delivery',
    'calling openManualOrderModal() with no argument should default to "delivery"');
});

// ─────────────────────────────────────────────────────────────────────────────
// Additional: pickup mode rejects custom items (no custom-item support in pickup)
// ─────────────────────────────────────────────────────────────────────────────
test('Additional: in pickup mode, an unrecognised itemKey (non product:<id>) is rejected', () => {
  resetManualState();
  openManualOrderModal('pickup');
  setManualOrderProducts([SAMPLE_PICKUP_PRODUCT]);

  const rows = getManualOrderItemRows();
  rows[0].itemKey = 'some-catalog-key';   // Not a product:<id> key
  rows[0].isCustom = false;
  rows[0].quantity = '1';

  const ok = mergeManualAddItemRow(rows[0].id);
  // In pickup mode manualOrderCatalog is empty, so catalog lookup returns null → should reject
  assert.equal(ok, false, 'non-product key in pickup mode should be rejected (no catalog)');
  assert.equal(getManualOrderItems().length, 0);
});
