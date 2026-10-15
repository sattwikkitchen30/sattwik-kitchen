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
  }
  setAttribute(k, v) { this.attributes[k] = String(v); }
  getAttribute(k) { return this.attributes[k] || null; }
  appendChild(el) { this.children.push(el); return el; }
  querySelectorAll(sel) { return []; }
  querySelector(sel) { return null; }
  addEventListener() {}
  set innerHTML(val) {
    this.innerHTMLValue = val;
    this.textContent = val.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  }
  get innerHTML() { return this.innerHTMLValue; }
}

global.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
global.window = { location: { href: '', pathname: '' }, addEventListener: () => {} };
const domElements = new Map();
global.document = {
  getElementById: (id) => {
    if (!domElements.has(id)) domElements.set(id, new MockElement('div'));
    return domElements.get(id);
  },
  querySelectorAll: () => [],
  querySelector: () => null,
  addEventListener: () => {}
};

const Order = require('../server/models/Order');
const { state, renderOrdersTable, renderOrderAmountEditor } = require('../admin/admin');

test('Order model pre-validate hook properly classifies item fulfillment and mixed order fulfillment', async () => {
  const mixedOrder = new Order({
    orderId: '26101500004',
    customer: new mongoose.Types.ObjectId(),
    pickupDate: new Date('2026-10-15T12:00:00Z'),
    subscriptionStartDate: new Date('2026-10-15T12:00:00Z'),
    subscriptionEndDate: new Date('2026-11-12T12:00:00Z'),
    type: 'tiffin',
    totalAmount: 128.99,
    items: [
      {
        productName: 'Tomato Pickle',
        category: 'Pickles',
        priceAtPurchase: 8.99,
        quantity: 1,
        subtotal: 8.99
      },
      {
        productName: 'Curry-Only Package (Single)',
        category: 'Tiffin Plans',
        priceAtPurchase: 120.00,
        quantity: 1,
        subtotal: 120.00
      }
    ]
  });

  await mixedOrder.validate();

  assert.equal(mixedOrder.items[0].fulfillment, 'pickup');
  assert.equal(mixedOrder.items[1].fulfillment, 'delivery');
  assert.equal(mixedOrder.fulfillment, 'mixed');
  assert.equal(mixedOrder.totalAmount, 128.99);
  assert.equal(mixedOrder.orderId, '26101500004');
});

test('Order model pre-validate hook correctly classifies pickup-only orders', async () => {
  const pickupOrder = new Order({
    orderId: '26101500001',
    customer: new mongoose.Types.ObjectId(),
    pickupDate: new Date('2026-10-15T12:00:00Z'),
    type: 'product',
    totalAmount: 8.99,
    items: [
      {
        productName: 'Tomato Pickle',
        category: 'Pickles',
        priceAtPurchase: 8.99,
        quantity: 1,
        subtotal: 8.99
      }
    ]
  });

  await pickupOrder.validate();

  assert.equal(pickupOrder.items[0].fulfillment, 'pickup');
  assert.equal(pickupOrder.fulfillment, 'pickup');
  assert.equal(pickupOrder.totalAmount, 8.99);
});

test('Order model pre-validate hook correctly classifies delivery-only Curry-Only plans', async () => {
  const deliveryOrder = new Order({
    orderId: '26101500002',
    customer: new mongoose.Types.ObjectId(),
    pickupDate: new Date('2026-10-15T12:00:00Z'),
    subscriptionStartDate: new Date('2026-10-15T12:00:00Z'),
    subscriptionEndDate: new Date('2026-11-12T12:00:00Z'),
    type: 'tiffin',
    totalAmount: 120.00,
    items: [
      {
        productName: 'Curry-Only Package (Single)',
        category: 'Tiffin Plans',
        priceAtPurchase: 120.00,
        quantity: 1,
        subtotal: 120.00
      }
    ]
  });

  await deliveryOrder.validate();

  assert.equal(deliveryOrder.items[0].fulfillment, 'delivery');
  assert.equal(deliveryOrder.fulfillment, 'delivery');
  assert.equal(deliveryOrder.totalAmount, 120.00);
});

test('Backward compatibility: legacy order with unassigned or pickup fulfillment on Curry-Only plan is normalized', async () => {
  const legacyOrder = new Order({
    orderId: '26101500003',
    customer: new mongoose.Types.ObjectId(),
    pickupDate: new Date('2026-10-15T12:00:00Z'),
    type: 'tiffin',
    totalAmount: 128.99,
    items: [
      {
        productName: 'Tomato Pickle',
        category: 'Pickles',
        priceAtPurchase: 8.99,
        quantity: 1,
        subtotal: 8.99,
        fulfillment: 'pickup'
      },
      {
        productName: 'Curry-Only Package (Single)',
        category: 'General', // legacy category
        priceAtPurchase: 120.00,
        quantity: 1,
        subtotal: 120.00,
        fulfillment: 'pickup' // incorrectly defaulted to pickup
      }
    ]
  });

  await legacyOrder.validate();

  assert.equal(legacyOrder.items[1].fulfillment, 'delivery');
  assert.equal(legacyOrder.items[0].fulfillment, 'pickup');
  assert.equal(legacyOrder.fulfillment, 'mixed');
});

test('Per-fulfillment subtotal and overall total calculation for order 26101500004', () => {
  const order = {
    orderId: '26101500004',
    type: 'tiffin',
    fulfillment: 'mixed',
    totalAmount: 128.99,
    pickupDate: '2026-10-15',
    subscriptionStartDate: '2026-10-15',
    subscriptionEndDate: '2026-11-12',
    items: [
      {
        productName: 'Tomato Pickle',
        category: 'Pickles',
        priceAtPurchase: 8.99,
        quantity: 1,
        subtotal: 8.99,
        fulfillment: 'pickup'
      },
      {
        productName: 'Curry-Only Package (Single)',
        category: 'Tiffin Plans',
        priceAtPurchase: 120.00,
        quantity: 1,
        subtotal: 120.00,
        fulfillment: 'delivery'
      }
    ]
  };

  // When filtered for Pickup:
  const pickupItems = order.items.filter(i => i.fulfillment === 'pickup');
  const pickupSubtotal = pickupItems.reduce((sum, i) => sum + i.subtotal, 0);
  assert.equal(pickupItems.length, 1);
  assert.equal(pickupItems[0].productName, 'Tomato Pickle');
  assert.equal(pickupSubtotal, 8.99);

  // When filtered for Delivery:
  const deliveryItems = order.items.filter(i => i.fulfillment === 'delivery');
  const deliverySubtotal = deliveryItems.reduce((sum, i) => sum + i.subtotal, 0);
  assert.equal(deliveryItems.length, 1);
  assert.equal(deliveryItems[0].productName, 'Curry-Only Package (Single)');
  assert.equal(deliverySubtotal, 120.00);

  // Authoritative overall total is preserved:
  assert.equal(order.totalAmount, 128.99);
  assert.equal(Math.round((pickupSubtotal + deliverySubtotal) * 100) / 100, order.totalAmount);
});

test('Admin Orders table displays correct Pickup row for mixed order 26101500004', async () => {
  const table = document.getElementById('ordersTable');
  state.ordersFulfillment = 'pickup';

  // Mock API response for fulfillment=pickup
  global.fetch = async (url) => {
    if (url.includes('/orders')) {
      return {
        ok: true,
        text: async () => JSON.stringify({
          orders: [
            {
              _id: 'ord123',
              orderId: '26101500004',
              type: 'product',
              fulfillment: 'mixed',
              totalAmount: 8.99,
              orderAmount: 128.99,
              pickupDate: '2026-10-15',
              createdAt: '2026-10-15T10:00:00.000Z',
              customerDoc: { firstName: 'xyz', lastName: 'Customer', phone: '1234567890', email: 'xyz@example.com' },
              items: [
                {
                  productName: 'Tomato Pickle',
                  category: 'Pickles',
                  priceAtPurchase: 8.99,
                  quantity: 1,
                  subtotal: 8.99,
                  fulfillment: 'pickup'
                }
              ]
            }
          ],
          total: 1,
          page: 1,
          pages: 1
        })
      };
    }
    return { ok: true, text: async () => '{}' };
  };

  await renderOrdersTable();

  const html = table.innerHTML;

  // 1. Order ID
  assert.ok(html.includes('26101500004'), 'Shows order ID 26101500004');
  // 2. Customer
  assert.ok(html.includes('xyz Customer'), 'Shows customer name');
  // 3. Item: Tomato Pickle × 1, NOT Curry-Only Package
  assert.ok(html.includes('Tomato Pickle × 1'), 'Shows Tomato Pickle × 1');
  assert.equal(html.includes('Curry-Only Package'), false, 'Does NOT show Curry-Only plan in pickup table');
  // 4. Type: product (not tiffin)
  assert.ok(html.includes('<td>product</td>'), 'Shows Type as product in pickup table');
  // 5. Fulfillment: Pickup
  assert.ok(html.includes('<td>Pickup</td>'), 'Shows Fulfillment as Pickup');
  // 6. Pickup date: actual saved date with Save button
  assert.ok(html.includes('<span class="saved-date">2026-10-15</span>'), 'Shows saved pickup date');
  assert.ok(html.includes('<button type="button" class="pickup-date-save"'), 'Save button is present');
  // 7. Amount: $8.99 (pickup subtotal)
  assert.ok(html.includes('$8.99'), 'Shows pickup subtotal $8.99');
});

test('Admin Orders table displays correct Delivery row for mixed order 26101500004', async () => {
  const table = document.getElementById('ordersTable');
  state.ordersFulfillment = 'delivery';

  // Mock API response for fulfillment=delivery
  global.fetch = async (url) => {
    if (url.includes('/orders')) {
      return {
        ok: true,
        text: async () => JSON.stringify({
          orders: [
            {
              _id: 'ord123',
              orderId: '26101500004',
              type: 'tiffin',
              fulfillment: 'mixed',
              totalAmount: 120.00,
              orderAmount: 128.99,
              subscriptionStartDate: '2026-10-15',
              subscriptionEndDate: '2026-11-12',
              createdAt: '2026-10-15T10:00:00.000Z',
              customerDoc: { firstName: 'xyz', lastName: 'Customer', phone: '1234567890', email: 'xyz@example.com' },
              items: [
                {
                  productName: 'Curry-Only Package (Single)',
                  category: 'Tiffin Plans',
                  priceAtPurchase: 120.00,
                  quantity: 1,
                  subtotal: 120.00,
                  fulfillment: 'delivery'
                }
              ]
            }
          ],
          total: 1,
          page: 1,
          pages: 1
        })
      };
    }
    if (url.includes('/delivery-members')) {
      return {
        ok: true,
        text: async () => JSON.stringify({ members: [] })
      };
    }
    return { ok: true, text: async () => '{}' };
  };

  await renderOrdersTable();

  const html = table.innerHTML;

  // 1. Order ID
  assert.ok(html.includes('26101500004'), 'Shows order ID 26101500004');
  // 2. Customer
  assert.ok(html.includes('xyz Customer'), 'Shows customer name');
  // 3. Item: Curry-Only Package (Single) × 1, NOT Tomato Pickle
  assert.ok(html.includes('Curry-Only Package (Single) × 1'), 'Shows Curry-Only plan');
  assert.equal(html.includes('Tomato Pickle'), false, 'Does NOT show Tomato Pickle in delivery table');
  // 4. Type: tiffin
  assert.ok(html.includes('<td>tiffin</td>'), 'Shows Type as tiffin in delivery table');
  // 5. Fulfillment: Delivery
  assert.ok(html.includes('<td>Delivery</td>'), 'Shows Fulfillment as Delivery');
  // 6. Dates: Start date and End date with Save button
  assert.ok(html.includes('<span class="saved-date">2026-10-15</span>'), 'Shows saved start date');
  assert.ok(html.includes('<span class="saved-date">2026-11-12</span>'), 'Shows saved end date');
  assert.ok(html.includes('<button class="delivery-start-date-save"'), 'Start date Save button is present');
  assert.ok(html.includes('<button class="delivery-end-date-save"'), 'End date Save button is present');
  // 7. Amount: $120.00 (delivery subtotal)
  assert.ok(html.includes('$120.00'), 'Shows delivery subtotal $120.00');
});
