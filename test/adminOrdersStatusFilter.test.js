'use strict';

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

const rootDir = process.cwd();

// Set up browser-like mocks so admin.js can be imported in Node environment
global.localStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {}
};
global.document = {
  getElementById: () => null,
  querySelectorAll: () => [],
  addEventListener: () => {}
};
global.window = {
  location: { href: '', pathname: '' },
  addEventListener: () => {}
};

const {
  state,
  DELIVERY_STATUS_FILTERS,
  PICKUP_STATUS_FILTERS,
  renderOrdersStatusFilters,
  renderOrdersStatusDropdown,
  renderOrdersTable
} = require(path.resolve(rootDir, 'admin/admin.js'));

const Order = require(path.resolve(rootDir, 'server/models/Order'));
const Customer = require(path.resolve(rootDir, 'server/models/Customer'));
const { listOrders } = require(path.resolve(rootDir, 'server/controllers/orderController'));

function mockReqRes({ query = {} } = {}) {
  const req = {
    query,
    app: {
      get: (key) => (key === 'io' ? { to: () => ({ emit: () => {} }), emit: () => {} } : null)
    }
  };
  const res = {
    statusCode: 200,
    headersSent: false,
    _json: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this._json = data;
      this.headersSent = true;
      return this;
    }
  };
  return { req, res };
}

test('Admin Orders Dropdown Status Filters Suite', async (t) => {
  const nonce = Date.now();
  let testCustomer = null;
  const createdOrderIds = [];

  t.before(async () => {
    if (mongoose.connection.readyState !== 1) {
      await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/sattwik-kitchen');
    }

    testCustomer = await Customer.create({
      firstName: 'StatusDropdown',
      lastName: 'AdminTester',
      phone: '6045550399',
      email: `statusdropdown_${nonce}@example.com`,
      passwordHash: 'dummy',
      area: 'Surrey'
    });

    // Create delivery orders with different statuses
    const deliveryPending = await Order.create({
      orderId: `DEL-P-${nonce}`,
      customer: testCustomer._id,
      customerSnapshot: { firstName: testCustomer.firstName, lastName: testCustomer.lastName, phone: testCustomer.phone, email: testCustomer.email },
      fulfillment: 'delivery',
      type: 'tiffin',
      status: 'PENDING',
      totalAmount: 240,
      items: [{ productName: 'Full Meal (Single)', category: 'Tiffin Plans', fulfillment: 'delivery', priceAtPurchase: 240, quantity: 1, subtotal: 240 }]
    });
    createdOrderIds.push(deliveryPending._id);

    const deliveryDelivered = await Order.create({
      orderId: `DEL-D-${nonce}`,
      customer: testCustomer._id,
      customerSnapshot: { firstName: testCustomer.firstName, lastName: testCustomer.lastName, phone: testCustomer.phone, email: testCustomer.email },
      fulfillment: 'delivery',
      type: 'tiffin',
      status: 'DELIVERED',
      totalAmount: 300,
      items: [{ productName: 'Full Meal (Couple)', category: 'Tiffin Plans', fulfillment: 'delivery', priceAtPurchase: 300, quantity: 1, subtotal: 300 }]
    });
    createdOrderIds.push(deliveryDelivered._id);

    // Create pickup orders with different statuses
    const pickupPending = await Order.create({
      orderId: `PCK-P-${nonce}`,
      customer: testCustomer._id,
      customerSnapshot: { firstName: testCustomer.firstName, lastName: testCustomer.lastName, phone: testCustomer.phone, email: testCustomer.email },
      fulfillment: 'pickup',
      type: 'product',
      status: 'PENDING',
      totalAmount: 25,
      items: [{ productName: 'Moringa Leaf Powder', category: 'General', fulfillment: 'pickup', deliveryStatus: 'PENDING', priceAtPurchase: 25, quantity: 1, subtotal: 25 }]
    });
    createdOrderIds.push(pickupPending._id);

    const pickupDelivered = await Order.create({
      orderId: `PCK-D-${nonce}`,
      customer: testCustomer._id,
      customerSnapshot: { firstName: testCustomer.firstName, lastName: testCustomer.lastName, phone: testCustomer.phone, email: testCustomer.email },
      fulfillment: 'pickup',
      type: 'product',
      status: 'DELIVERED',
      totalAmount: 50,
      items: [{ productName: 'Organic Ghee', category: 'General', fulfillment: 'pickup', deliveryStatus: 'DELIVERED', priceAtPurchase: 50, quantity: 1, subtotal: 50 }]
    });
    createdOrderIds.push(pickupDelivered._id);
  });

  t.after(async () => {
    try {
      if (createdOrderIds.length) {
        await Order.deleteMany({ _id: { $in: createdOrderIds } });
      }
      if (testCustomer) {
        await Customer.deleteOne({ _id: testCustomer._id });
      }
    } finally {
      await mongoose.disconnect();
    }
  });

  await t.test('1. Static HTML & CSS definitions for dropdown status filters', () => {
    const html = fs.readFileSync(path.resolve(rootDir, 'admin/dashboard.html'), 'utf8');
    const css = fs.readFileSync(path.resolve(rootDir, 'admin/admin.css'), 'utf8');

    // Confirm dropdown elements exist
    assert.ok(html.includes('id="deliveryStatusFilter"'), 'dashboard.html must contain #deliveryStatusFilter select');
    assert.ok(html.includes('id="pickupStatusFilter"'), 'dashboard.html must contain #pickupStatusFilter select');
    assert.ok(html.includes('id="deliveryStatusFilterLabel"'), 'dashboard.html must contain #deliveryStatusFilterLabel');
    assert.ok(html.includes('id="pickupStatusFilterLabel"'), 'dashboard.html must contain #pickupStatusFilterLabel');
    assert.ok(html.includes('<option value="">All Statuses</option>'), 'Dropdowns must include All Statuses initial option');

    // Confirm button filters have been completely removed
    assert.ok(!html.includes('id="ordersStatusFilters"'), 'dashboard.html must NOT contain #ordersStatusFilters container');
    assert.ok(!html.includes('class="orders-status-filters"'), 'dashboard.html must NOT contain .orders-status-filters');
    assert.ok(!html.includes('class="status-filter-btn'), 'dashboard.html must NOT contain .status-filter-btn');

    // Confirm CSS definitions
    assert.ok(css.includes('.orders-filter-bar select'), 'admin.css must style .orders-filter-bar select');
    assert.ok(css.includes('.orders-status-field'), 'admin.css must style .orders-status-field');
    assert.ok(!css.includes('.orders-status-filters'), 'admin.css must NOT contain .orders-status-filters');
    assert.ok(!css.includes('.status-filter-btn'), 'admin.css must NOT contain .status-filter-btn');
  });

  await t.test('2. Supported status values match application definitions with All Statuses label', () => {
    // Delivery status filters
    const deliveryValues = DELIVERY_STATUS_FILTERS.map(f => f.value);
    assert.deepEqual(
      deliveryValues,
      ['', 'PENDING', 'ACCEPTED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED', 'EXPIRED'],
      'Delivery status filters must match all application delivery statuses'
    );
    assert.equal(DELIVERY_STATUS_FILTERS[0].label, 'All Statuses', 'Delivery initial option must be All Statuses');

    // Pickup status filters
    const pickupValues = PICKUP_STATUS_FILTERS.map(f => f.value);
    assert.deepEqual(
      pickupValues,
      ['', 'PENDING', 'ACCEPTED', 'DELIVERED', 'CANCELLED'],
      'Pickup status filters must only include supported pickup statuses'
    );
    assert.equal(PICKUP_STATUS_FILTERS[0].label, 'All Statuses', 'Pickup initial option must be All Statuses');
    assert.ok(!pickupValues.includes('OUT_FOR_DELIVERY'), 'Pickup must not include OUT_FOR_DELIVERY');
    assert.ok(!pickupValues.includes('EXPIRED'), 'Pickup must not include EXPIRED');
  });

  await t.test('3. Delivery and Pickup status filters maintain independent state', () => {
    state.ordersFulfillment = 'delivery';
    state.deliveryStatusFilter = 'DELIVERED';
    state.pickupStatusFilter = 'PENDING';

    assert.equal(state.deliveryStatusFilter, 'DELIVERED', 'Delivery status is DELIVERED');
    assert.equal(state.pickupStatusFilter, 'PENDING', 'Pickup status is PENDING');

    // Switch to pickup
    state.ordersFulfillment = 'pickup';
    assert.equal(state.pickupStatusFilter, 'PENDING', 'Pickup status preserved when switching tabs');

    // Change pickup filter
    state.pickupStatusFilter = 'ACCEPTED';
    assert.equal(state.pickupStatusFilter, 'ACCEPTED');
    assert.equal(state.deliveryStatusFilter, 'DELIVERED', 'Delivery status untouched by pickup change');

    // Switch back to delivery
    state.ordersFulfillment = 'delivery';
    assert.equal(state.deliveryStatusFilter, 'DELIVERED', 'Delivery status preserved when switching back');

    // Clean up
    state.deliveryStatusFilter = '';
    state.pickupStatusFilter = '';
  });

  await t.test('4. renderOrdersStatusDropdown synchronizes DOM elements and visibility', () => {
    const mockElements = {
      deliveryStatusFilterLabel: { hidden: false },
      pickupStatusFilterLabel: { hidden: true },
      deliveryStatusFilter: { options: [], innerHTML: '', value: '' },
      pickupStatusFilter: { options: [], innerHTML: '', value: '' }
    };

    const origGetElementById = global.document.getElementById;
    global.document.getElementById = (id) => mockElements[id] || null;

    try {
      // 1. Delivery tab active
      state.ordersFulfillment = 'delivery';
      state.deliveryStatusFilter = 'ACCEPTED';
      state.pickupStatusFilter = 'PENDING';

      renderOrdersStatusDropdown();

      assert.equal(mockElements.deliveryStatusFilterLabel.hidden, false, 'Delivery label visible on delivery tab');
      assert.equal(mockElements.pickupStatusFilterLabel.hidden, true, 'Pickup label hidden on delivery tab');
      assert.equal(mockElements.deliveryStatusFilter.value, 'ACCEPTED', 'Delivery select value synchronized');
      assert.ok(mockElements.deliveryStatusFilter.innerHTML.includes('All Statuses'), 'Delivery options populated');

      // 2. Pickup tab active
      state.ordersFulfillment = 'pickup';
      renderOrdersStatusDropdown();

      assert.equal(mockElements.deliveryStatusFilterLabel.hidden, true, 'Delivery label hidden on pickup tab');
      assert.equal(mockElements.pickupStatusFilterLabel.hidden, false, 'Pickup label visible on pickup tab');
      assert.equal(mockElements.pickupStatusFilter.value, 'PENDING', 'Pickup select value synchronized');
      assert.ok(mockElements.pickupStatusFilter.innerHTML.includes('All Statuses'), 'Pickup options populated');

      // 3. Reset filters
      state.deliveryStatusFilter = '';
      state.pickupStatusFilter = '';
      renderOrdersStatusDropdown();
      assert.equal(mockElements.pickupStatusFilter.value, '', 'Pickup select reset to empty (All Statuses)');
      assert.equal(mockElements.deliveryStatusFilter.value, '', 'Delivery select reset to empty (All Statuses)');
    } finally {
      global.document.getElementById = origGetElementById;
      state.deliveryStatusFilter = '';
      state.pickupStatusFilter = '';
      state.ordersFulfillment = 'delivery';
    }
  });

  await t.test('5. Backend listOrders correctly filters Delivery orders by status', async () => {
    // 1. All delivery orders
    const { req: reqAll, res: resAll } = mockReqRes({ query: { fulfillment: 'delivery', search: `DEL-` } });
    await listOrders(reqAll, resAll);
    assert.equal(resAll.statusCode, 200);
    const delAll = resAll._json.orders.filter(o => createdOrderIds.some(id => String(id) === String(o._id)));
    assert.equal(delAll.length, 2, 'All delivery orders returned');

    // 2. Filter by PENDING
    const { req: reqPending, res: resPending } = mockReqRes({ query: { fulfillment: 'delivery', status: 'PENDING', search: `DEL-` } });
    await listOrders(reqPending, resPending);
    const delPending = resPending._json.orders.filter(o => createdOrderIds.some(id => String(id) === String(o._id)));
    assert.equal(delPending.length, 1, 'Only 1 PENDING delivery order');
    assert.equal(delPending[0].status, 'PENDING');

    // 3. Filter by DELIVERED
    const { req: reqDelivered, res: resDelivered } = mockReqRes({ query: { fulfillment: 'delivery', status: 'DELIVERED', search: `DEL-` } });
    await listOrders(reqDelivered, resDelivered);
    const delDelivered = resDelivered._json.orders.filter(o => createdOrderIds.some(id => String(id) === String(o._id)));
    assert.equal(delDelivered.length, 1, 'Only 1 DELIVERED delivery order');
    assert.equal(delDelivered[0].status, 'DELIVERED');
  });

  await t.test('6. Backend listOrders correctly filters Pickup orders by status', async () => {
    // 1. All pickup orders
    const { req: reqAll, res: resAll } = mockReqRes({ query: { fulfillment: 'pickup', search: `PCK-` } });
    await listOrders(reqAll, resAll);
    assert.equal(resAll.statusCode, 200);
    const pckAll = resAll._json.orders.filter(o => createdOrderIds.some(id => String(id) === String(o._id)));
    assert.equal(pckAll.length, 2, 'All pickup orders returned');

    // 2. Filter by PENDING
    const { req: reqPending, res: resPending } = mockReqRes({ query: { fulfillment: 'pickup', status: 'PENDING', search: `PCK-` } });
    await listOrders(reqPending, resPending);
    const pckPending = resPending._json.orders.filter(o => createdOrderIds.some(id => String(id) === String(o._id)));
    assert.equal(pckPending.length, 1, 'Only 1 PENDING pickup order');
    assert.equal(pckPending[0].orderId, `PCK-P-${nonce}`);

    // 3. Filter by DELIVERED
    const { req: reqDelivered, res: resDelivered } = mockReqRes({ query: { fulfillment: 'pickup', status: 'DELIVERED', search: `PCK-` } });
    await listOrders(reqDelivered, resDelivered);
    const pckDelivered = resDelivered._json.orders.filter(o => createdOrderIds.some(id => String(id) === String(o._id)));
    assert.equal(pckDelivered.length, 1, 'Only 1 DELIVERED pickup order');
    assert.equal(pckDelivered[0].orderId, `PCK-D-${nonce}`);
  });

  await t.test('7. Search works alongside status filtering', async () => {
    // Search with both status=DELIVERED and search term
    const { req, res } = mockReqRes({ query: { fulfillment: 'delivery', status: 'DELIVERED', search: 'Couple' } });
    await listOrders(req, res);
    assert.equal(res.statusCode, 200);
    const matched = res._json.orders.filter(o => createdOrderIds.some(id => String(id) === String(o._id)));
    assert.equal(matched.length, 1);
    assert.equal(matched[0].orderId, `DEL-D-${nonce}`);
  });
});
