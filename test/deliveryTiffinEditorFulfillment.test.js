const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

// Browser mocks for admin.js
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

const { isDeliveryTiffinOrder: isDeliveryTiffinOrderBackend } = require('../server/utils/tiffinItems');
const { isDeliveryTiffinOrder: isDeliveryTiffinOrderFrontend, openTiffinItemsEditor } = require('../admin/admin');

// --------------------------------------------------------------------------
// 1. Classification Tests (both backend and frontend)
// --------------------------------------------------------------------------
test('isDeliveryTiffinOrder: allows valid Full Meal delivery orders', () => {
  const fullMealOrder = {
    orderId: '26101500001',
    type: 'tiffin',
    fulfillment: 'delivery',
    totalAmount: 300.00,
    tiffinPlan: { packageType: 'full', size: 'couple', price: 300 },
    items: [
      { productName: 'Tiffin Plan — Full Meal Package (Couple)', category: 'Tiffin Plans', quantity: 1, fulfillment: 'delivery' }
    ]
  };

  assert.equal(isDeliveryTiffinOrderBackend(fullMealOrder), true);
  assert.equal(isDeliveryTiffinOrderFrontend(fullMealOrder), true);
});

test('isDeliveryTiffinOrder: allows valid Curry-Only delivery orders', () => {
  const curryOnlyOrder = {
    orderId: '26101500002',
    type: 'tiffin',
    fulfillment: 'delivery',
    totalAmount: 120.00,
    tiffinPlan: { packageType: 'curry-only', size: 'single', price: 120 },
    items: [
      { productName: 'Curry-Only Package (Single)', category: 'Tiffin Plans', quantity: 1, fulfillment: 'delivery' }
    ]
  };

  assert.equal(isDeliveryTiffinOrderBackend(curryOnlyOrder), true);
  assert.equal(isDeliveryTiffinOrderFrontend(curryOnlyOrder), true);
});

test('isDeliveryTiffinOrder: allows mixed pickup + delivery orders like 26101500006', () => {
  const mixedOrder = {
    orderId: '26101500006',
    type: 'tiffin',
    fulfillment: 'delivery',
    totalAmount: 309.99,
    tiffinPlan: { packageType: 'full', size: 'couple', price: 300 },
    items: [
      { productName: 'Tiffin Plan — Full Meal Package (Couple)', category: 'Tiffin Plans', quantity: 1, fulfillment: 'delivery' },
      { productName: 'Tomato Pickle', category: 'Pickles', quantity: 1, fulfillment: 'pickup' }
    ]
  };

  assert.equal(isDeliveryTiffinOrderBackend(mixedOrder), true);
  assert.equal(isDeliveryTiffinOrderFrontend(mixedOrder), true);
});

test('isDeliveryTiffinOrder: blocks pickup-only product orders', () => {
  const pickupOnlyOrder = {
    orderId: '26101500003',
    type: 'product',
    fulfillment: 'pickup',
    totalAmount: 8.99,
    items: [
      { productName: 'Tomato Pickle', category: 'Pickles', quantity: 1, fulfillment: 'pickup' }
    ]
  };

  assert.equal(isDeliveryTiffinOrderBackend(pickupOnlyOrder), false);
  assert.equal(isDeliveryTiffinOrderFrontend(pickupOnlyOrder), false);
});

test('isDeliveryTiffinOrder: blocks delivery-only non-tiffin product orders', () => {
  const deliveryPickleOrder = {
    orderId: '26101500005',
    type: 'product',
    fulfillment: 'delivery',
    totalAmount: 18.98,
    items: [
      { productName: 'Mango Pickle', category: 'Pickles', quantity: 2, fulfillment: 'delivery' }
    ]
  };

  assert.equal(isDeliveryTiffinOrderBackend(deliveryPickleOrder), false);
  assert.equal(isDeliveryTiffinOrderFrontend(deliveryPickleOrder), false);
});

// --------------------------------------------------------------------------
// 2. Frontend openTiffinItemsEditor Tests
// --------------------------------------------------------------------------
test('openTiffinItemsEditor: opens successfully for mixed order 26101500006 without throwing', async () => {
  const orderData = {
    _id: 'ord_26101500006',
    orderId: '26101500006',
    type: 'tiffin',
    fulfillment: 'delivery',
    totalAmount: 309.99,
    subscriptionStartDate: '2026-10-15',
    subscriptionEndDate: '2026-11-12',
    customer: { firstName: 'Sattwik', lastName: 'Customer', phone: '6045550100', email: 'cust@example.com' },
    items: [
      { productName: 'Tiffin Plan — Full Meal Package (Couple)', category: 'Tiffin Plans', quantity: 1, fulfillment: 'delivery' },
      { productName: 'Tomato Pickle', category: 'Pickles', quantity: 1, fulfillment: 'pickup' }
    ],
    tiffinItems: [
      { productName: 'Medium Dal', preparationType: 'mediumDal', quantity: 2, isAdditional: false },
      { productName: 'Medium Curry', preparationType: 'mediumCurry', quantity: 2, isAdditional: false }
    ]
  };

  global.fetch = async (url) => {
    if (url.includes('/orders/ord_26101500006')) {
      return { ok: true, text: async () => JSON.stringify({ order: orderData }) };
    }
    if (url.includes('/delivery-plans')) {
      return { ok: true, text: async () => JSON.stringify({ plans: [] }) };
    }
    return { ok: true, text: async () => '{}' };
  };

  // Must not throw "Only delivery tiffin orders can edit preparation items."
  await assert.doesNotReject(async () => {
    await openTiffinItemsEditor('ord_26101500006');
  });

  const summary = document.getElementById('tiffinItemsOrderSummary').innerHTML;
  assert.ok(summary.includes('26101500006'), 'Displays order ID');
  assert.ok(summary.includes('Full Meal Package (Couple)'), 'Displays delivery tiffin package');
  assert.equal(summary.includes('Tomato Pickle'), false, 'Does NOT include pickup-only product in package summary');
});

test('openTiffinItemsEditor: throws error and blocks pickup-only orders', async () => {
  const pickupOrder = {
    _id: 'ord_pickup_only',
    orderId: '26101500003',
    type: 'product',
    fulfillment: 'pickup',
    items: [{ productName: 'Tomato Pickle', category: 'Pickles', quantity: 1, fulfillment: 'pickup' }]
  };

  global.fetch = async (url) => {
    if (url.includes('/orders/ord_pickup_only')) {
      return { ok: true, text: async () => JSON.stringify({ order: pickupOrder }) };
    }
    return { ok: true, text: async () => JSON.stringify({ plans: [] }) };
  };

  await assert.rejects(
    async () => { await openTiffinItemsEditor('ord_pickup_only'); },
    { message: 'Only delivery tiffin orders can edit preparation items.' }
  );
});

// --------------------------------------------------------------------------
// 3. Backend updateTiffinItems Controller Tests
// --------------------------------------------------------------------------
test('backend updateTiffinItems: allows mixed order 26101500006 and preserves order amount & pickup items', async () => {
  let savedOrder;
  const originalOrder = {
    _id: new mongoose.Types.ObjectId(),
    orderId: '26101500006',
    type: 'tiffin',
    fulfillment: 'delivery',
    totalAmount: 309.99,
    status: 'ACCEPTED',
    subscriptionStartDate: new Date('2026-10-15'),
    subscriptionEndDate: new Date('2026-11-12'),
    tiffinPlan: { packageType: 'full', size: 'couple', price: 300 },
    items: [
      { productName: 'Tiffin Plan — Full Meal Package (Couple)', category: 'Tiffin Plans', quantity: 1, fulfillment: 'delivery' },
      { productName: 'Tomato Pickle', category: 'Pickles', quantity: 1, fulfillment: 'pickup' }
    ],
    tiffinItems: [
      { productName: 'Medium Dal', preparationType: 'mediumDal', quantity: 1, originalQuantity: 1, additionalQuantity: 0, isAdditional: false }
    ],
    async save() { savedOrder = this; return this; },
    toObject() { return { ...this }; }
  };

  // Dynamically load orderController with mocked Order.findById
  delete require.cache[require.resolve('../server/controllers/orderController')];
  const OrderModel = require('../server/models/Order');
  const originalFindById = OrderModel.findById;
  OrderModel.findById = () => ({
    ...originalOrder,
    async populate() { return originalOrder; }
  });

  const { updateTiffinItems } = require('../server/controllers/orderController');

  let responseStatus = 200;
  let responseJson = null;
  const res = {
    status(code) { responseStatus = code; return this; },
    json(data) { responseJson = data; return this; }
  };

  try {
    await updateTiffinItems({
      params: { id: String(originalOrder._id) },
      body: {
        items: [
          { productName: 'Medium Dal', preparationType: 'mediumDal', quantity: 3, originalQuantity: 1, additionalQuantity: 2, isAdditional: true }
        ]
      },
      app: { get: () => null }
    }, res);
  } finally {
    OrderModel.findById = originalFindById;
  }

  assert.equal(responseStatus, 200, 'Controller succeeds with HTTP 200');
  assert.equal(savedOrder.totalAmount, 309.99, 'Preserves original total amount $309.99');
  assert.equal(savedOrder.tiffinItemsCustomized, true, 'Marks tiffinItemsCustomized');
  assert.equal(savedOrder.tiffinItems[0].quantity, 3, 'Updates preparation quantity');
  assert.equal(savedOrder.items.length, 2, 'Line items preserved');
  assert.equal(savedOrder.items[1].productName, 'Tomato Pickle', 'Pickup product preserved');
  assert.equal(savedOrder.tiffinItems.some(i => i.productName === 'Tomato Pickle'), false, 'Tomato Pickle not added to preparation');
});

test('backend updateTiffinItems: rejects pickup-only order with 400', async () => {
  const pickupOrder = {
    _id: new mongoose.Types.ObjectId(),
    orderId: '26101500003',
    type: 'product',
    fulfillment: 'pickup',
    items: [{ productName: 'Tomato Pickle', category: 'Pickles', quantity: 1, fulfillment: 'pickup' }]
  };

  delete require.cache[require.resolve('../server/controllers/orderController')];
  const OrderModel = require('../server/models/Order');
  const originalFindById = OrderModel.findById;
  OrderModel.findById = () => pickupOrder;

  const { updateTiffinItems } = require('../server/controllers/orderController');

  let responseStatus = 200;
  let responseJson = null;
  const res = {
    status(code) { responseStatus = code; return this; },
    json(data) { responseJson = data; return this; }
  };

  try {
    await updateTiffinItems({
      params: { id: String(pickupOrder._id) },
      body: { items: [] }
    }, res);
  } finally {
    OrderModel.findById = originalFindById;
  }

  assert.equal(responseStatus, 400, 'Rejects pickup-only order with HTTP 400');
  assert.equal(responseJson.message, 'Only delivery tiffin orders can update preparation items.');
});
