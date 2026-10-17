'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DateTime } = require('luxon');
const { resolveDeliveryStatus, withCurrentDeliveryStatus } = require('../server/utils/deliveryStatus');
const { resetDeliveredOrders } = require('../server/utils/dailyDeliveryReset');
const { startOfDay, addDays, formatDateKey } = require('../server/utils/tiffinPreparation');

// Set up minimal browser stubs to evaluate customer-orders.js pure helpers
global.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
global.window = { location: { href: '' }, confirm: () => true, io: undefined };
global.io = undefined;
global.document = {
  getElementById: () => null,
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener: () => {}
};
global.CSS = { escape: (s) => s };
global.fetch = async () => ({ ok: true, json: async () => ({}) });
global.ordersList = { addEventListener: () => {}, innerHTML: '' };
global.ordersMessage = { textContent: '' };

const srcPath = path.resolve(__dirname, '../customer/customer-orders.js');
const src = fs.readFileSync(srcPath, 'utf8');

const sandboxSrc = src
  .replace(/\/\/ ─── Bootstrap[\s\S]*$/, '')
  .replace(/\/\/ ─── Real-time[\s\S]*?(?=\n\/\/ ─)/, '')
  .replace(/\/\/ ─── Logout[\s\S]*?(?=\n\/\/ ─)/, '')
  .replace(/\/\/ ─── Details toggle[\s\S]*?(?=\n\/\/ ─)/, '')
  .replace(/\/\/ ─── Tab click[\s\S]*?(?=\n\/\/ ─)/, '')
  .replace(/\/\/ ─── Data loading[\s\S]*?(?=\n\/\/ ─)/, '');

const evalFn = new Function(sandboxSrc + '\n return { extractComponents, classifyComponent, componentAmount, getPickupItemStatus, getDeliveryStatus, isSubscriptionFullyComplete };');
const {
  extractComponents,
  classifyComponent,
  componentAmount,
  getPickupItemStatus,
  getDeliveryStatus,
  isSubscriptionFullyComplete
} = evalFn();

function createSubscriptionOrder(overrides = {}) {
  return {
    _id: 'ord_sub_26101500006',
    orderId: '26101500006',
    type: 'tiffin',
    fulfillment: 'delivery',
    status: 'ACCEPTED',
    totalAmount: 300,
    subscriptionStartDate: '2026-10-12',
    subscriptionEndDate: '2026-11-06', // 20 Mon-Fri service days
    deliveryStatusDate: new Date('2026-10-12T19:00:00Z'),
    items: [
      {
        productName: 'Full Meal — Couple',
        category: 'Tiffin Plans',
        fulfillment: 'delivery',
        quantity: 1,
        subtotal: 300,
        deliveryStatus: 'ACCEPTED'
      }
    ],
    customer: { firstName: 'xyz', lastName: 'Customer' },
    ...overrides
  };
}

test('1. Daily Delivered appears in Delivered tab, not Ongoing tab', () => {
  const order = createSubscriptionOrder({
    status: 'DELIVERED',
    items: [
      {
        productName: 'Full Meal — Couple',
        category: 'Tiffin Plans',
        fulfillment: 'delivery',
        quantity: 1,
        subtotal: 300,
        deliveryStatus: 'DELIVERED'
      }
    ]
  });

  const [deliveryComp] = extractComponents(order);
  assert.equal(deliveryComp.type, 'delivery');
  assert.equal(deliveryComp.status, 'DELIVERED');
  assert.equal(classifyComponent(deliveryComp), 'delivered', 'Daily Delivered must be in delivered tab');
  assert.notEqual(classifyComponent(deliveryComp), 'ongoing', 'Daily Delivered must not be in ongoing tab');
});

test("2. Next eligible service day's Accepted appears in Ongoing tab, not Delivered tab", () => {
  const order = createSubscriptionOrder({
    status: 'ACCEPTED',
    items: [
      {
        productName: 'Full Meal — Couple',
        category: 'Tiffin Plans',
        fulfillment: 'delivery',
        quantity: 1,
        subtotal: 300,
        deliveryStatus: 'ACCEPTED'
      }
    ]
  });

  const [deliveryComp] = extractComponents(order);
  assert.equal(deliveryComp.type, 'delivery');
  assert.equal(deliveryComp.status, 'ACCEPTED');
  assert.equal(classifyComponent(deliveryComp), 'ongoing', 'Reset Accepted must appear in ongoing tab');
  assert.notEqual(classifyComponent(deliveryComp), 'delivered', 'Reset Accepted must not appear in delivered tab');
});

test('3. Out for Delivery remains in Ongoing tab', () => {
  const order = createSubscriptionOrder({
    status: 'OUT_FOR_DELIVERY',
    items: [
      {
        productName: 'Full Meal — Couple',
        category: 'Tiffin Plans',
        fulfillment: 'delivery',
        quantity: 1,
        subtotal: 300,
        deliveryStatus: 'OUT_FOR_DELIVERY'
      }
    ]
  });

  const [deliveryComp] = extractComponents(order);
  assert.equal(deliveryComp.type, 'delivery');
  assert.equal(deliveryComp.status, 'OUT_FOR_DELIVERY');
  assert.equal(classifyComponent(deliveryComp), 'ongoing', 'Out for Delivery must remain in ongoing tab');
});

test('4. Completed 20-day subscriptions remain permanently in Delivered tab', () => {
  const completedOrder = createSubscriptionOrder({
    status: 'DELIVERED',
    subscriptionStartDate: '2026-09-01',
    subscriptionEndDate: '2026-09-28', // Past end date
    deliveryStatusDate: new Date('2026-09-28T20:00:00Z'),
    deliveredAt: new Date('2026-09-28T20:00:00Z'),
    items: [
      {
        productName: 'Full Meal — Couple',
        category: 'Tiffin Plans',
        fulfillment: 'delivery',
        quantity: 1,
        subtotal: 300,
        deliveryStatus: 'DELIVERED'
      }
    ]
  });

  // Verify backend does not resolve to ACCEPTED
  const resolved = resolveDeliveryStatus(completedOrder, new Date('2026-10-19T12:00:00Z'));
  assert.equal(resolved, 'DELIVERED', 'Completed subscription status remains DELIVERED');

  const [deliveryComp] = extractComponents(completedOrder);
  assert.equal(classifyComponent(deliveryComp), 'delivered', 'Completed subscription must be in delivered tab');
});

test('5. Weekend handling: Friday delivery stays Delivered on Saturday/Sunday and resets on Monday', () => {
  const friday = new Date('2026-10-16T19:00:00Z'); // Friday
  const saturday = new Date('2026-10-17T12:00:00Z'); // Saturday
  const sunday = new Date('2026-10-18T12:00:00Z'); // Sunday
  const monday = new Date('2026-10-19T12:00:00Z'); // Monday

  const order = createSubscriptionOrder({
    status: 'DELIVERED',
    subscriptionStartDate: '2026-10-12',
    subscriptionEndDate: '2026-11-06',
    deliveryStatusDate: friday,
    deliveredAt: friday
  });

  // 1. On Saturday: status stays DELIVERED
  const satResolved = resolveDeliveryStatus(order, saturday);
  assert.equal(satResolved, 'DELIVERED', 'On Saturday status must remain DELIVERED');
  const [satComp] = extractComponents({ ...order, status: satResolved });
  assert.equal(classifyComponent(satComp), 'delivered', 'On Saturday component is in delivered tab');

  // 2. On Sunday: status stays DELIVERED
  const sunResolved = resolveDeliveryStatus(order, sunday);
  assert.equal(sunResolved, 'DELIVERED', 'On Sunday status must remain DELIVERED');
  const [sunComp] = extractComponents({ ...order, status: sunResolved });
  assert.equal(classifyComponent(sunComp), 'delivered', 'On Sunday component is in delivered tab');

  // 3. On Monday: next service day resolves to ACCEPTED
  const monResolved = resolveDeliveryStatus(order, monday);
  assert.equal(monResolved, 'ACCEPTED', 'On Monday status resets to ACCEPTED');
  const [monComp] = extractComponents({ ...order, status: monResolved });
  assert.equal(classifyComponent(monComp), 'ongoing', 'On Monday component moves back to ongoing tab');
});

test('6. Mixed pickup + delivery order: each component routes to its independent tab', () => {
  const mixedOrder = {
    _id: 'ord_mixed_26101500006',
    orderId: '26101500006',
    fulfillment: 'mixed',
    type: 'tiffin',
    status: 'ACCEPTED',
    totalAmount: 309.99,
    subscriptionStartDate: '2026-10-12',
    subscriptionEndDate: '2026-11-06',
    items: [
      {
        productName: 'Full Meal — Couple',
        category: 'Tiffin Plans',
        fulfillment: 'delivery',
        quantity: 1,
        subtotal: 300,
        deliveryStatus: 'ACCEPTED'
      },
      {
        productName: 'Tomato Pickle',
        category: 'Pickles',
        fulfillment: 'pickup',
        quantity: 1,
        subtotal: 9.99,
        deliveryStatus: 'DELIVERED'
      }
    ]
  };

  const components = extractComponents(mixedOrder);
  assert.equal(components.length, 2);
  const deliveryComp = components.find((c) => c.type === 'delivery');
  const pickupComp = components.find((c) => c.type === 'pickup');

  assert.equal(classifyComponent(deliveryComp), 'ongoing', 'Active delivery is Ongoing');
  assert.equal(classifyComponent(pickupComp), 'delivered', 'Delivered pickup is Delivered');

  // When delivery is marked DELIVERED:
  deliveryComp.status = 'DELIVERED';
  assert.equal(classifyComponent(deliveryComp), 'delivered', 'Now both are Delivered independently');
  assert.equal(classifyComponent(pickupComp), 'delivered');
});

test('7. Customer orders serialization includes authoritative status with withCurrentDeliveryStatus', () => {
  const monday = new Date('2026-10-19T14:00:00Z');
  const deliveredOrder = createSubscriptionOrder({
    status: 'DELIVERED',
    deliveryStatusDate: monday,
    deliveredAt: monday
  });

  const serialized = withCurrentDeliveryStatus(deliveredOrder, monday);
  assert.equal(serialized.status, 'DELIVERED');
  const [comp] = extractComponents(serialized);
  assert.equal(classifyComponent(comp), 'delivered', 'Serializing order maintains DELIVERED tab status');
});
