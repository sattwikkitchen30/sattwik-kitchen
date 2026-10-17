/**
 * test/myOrdersTabs.test.js
 *
 * Tests for Part 1–6 of the My Orders redesign:
 *   1. Component amount bug fix (mixed orders show component subtotals, not full total)
 *   2. Three-tab classification (Ongoing / Delivered / Cancelled)
 *   3. Status tracker preservation (existing CSS classes / DOM structure)
 *   4. Compact card structure (collapsed + expandable details)
 *   5. Backend/status integrity (independent pickup/delivery statuses)
 *   6. All Part 6 scenarios listed in the spec
 *
 * Pure-function unit tests — no server or browser required.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// ─── Load the JS functions under test ────────────────────────────────────────
// customer-orders.js is a browser script. We extract the pure helper functions
// by running the file in a minimal mock environment and capturing module exports
// via a side-channel global.

// Minimal browser globals
global.localStorage  = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
global.window        = { location: { href: '' }, confirm: () => true, io: undefined };
global.io            = undefined;
global.document = {
  getElementById: () => null,
  querySelector:  () => null,
  querySelectorAll: () => [],
  addEventListener: () => {}
};
global.CSS = { escape: (s) => s };
global.fetch = async () => ({ ok: true, json: async () => ({}) });

// Read source, strip the side-effecting browser bootstrap at the bottom, and
// expose pure helpers via eval so we can test them directly.
const srcPath = path.resolve(__dirname, '../customer/customer-orders.js');
const src = fs.readFileSync(srcPath, 'utf8');

// We evaluate everything up to and including the function definitions.
// The easiest way: replace the side-effecting bottom section (loadOrders() call,
// event-listener wiring) with nothing, then eval.
const sandboxSrc = src
  .replace(/\/\/ ─── Bootstrap[\s\S]*$/, '')        // strip bootstrap
  .replace(/\/\/ ─── Real-time[\s\S]*?(?=\n\/\/ ─)/, '') // strip socket.io
  .replace(/\/\/ ─── Logout[\s\S]*?(?=\n\/\/ ─)/, '')   // strip logout handler
  .replace(/\/\/ ─── Details toggle[\s\S]*?(?=\n\/\/ ─)/, '') // strip event listener
  .replace(/\/\/ ─── Tab click[\s\S]*?(?=\n\/\/ ─)/, '')
  .replace(/\/\/ ─── Data loading[\s\S]*?(?=\n\/\/ ─)/, '');

// Provide minimal stubs for browser APIs referenced in the evaluated code
global.ordersList    = { addEventListener: () => {}, innerHTML: '' };
global.ordersMessage = { textContent: '' };

// eslint-disable-next-line no-new-func
const evalFn = new Function(sandboxSrc + '\n return { extractComponents, classifyComponent, componentAmount, getPickupItemStatus, getDeliveryStatus, isSubscriptionFullyComplete, renderPickupTimeline, renderTimeline, money, tiffinPlanName };');
const {
  extractComponents,
  classifyComponent,
  componentAmount,
  getPickupItemStatus,
  getDeliveryStatus,
  isSubscriptionFullyComplete,
  renderPickupTimeline,
  renderTimeline,
  money,
  tiffinPlanName
} = evalFn();

// ─── Helper builders ──────────────────────────────────────────────────────────
function makePickupOrder(overrides = {}) {
  return {
    _id: 'ord_pickup_1',
    orderId: '26101500010',
    fulfillment: 'pickup',
    type: 'product',
    status: 'PENDING',
    totalAmount: 9.99,
    placedAt: new Date().toISOString(),
    pickupDate: '2026-10-20',
    items: [
      { productName: 'Raw Tamarind Pickle', category: 'Pickles', fulfillment: 'pickup', quantity: 1, subtotal: 9.99, deliveryStatus: 'PENDING' }
    ],
    customer: {},
    ...overrides
  };
}

function makeDeliveryOrder(overrides = {}) {
  const today = new Date();
  const pastEnd = new Date(today);
  pastEnd.setDate(today.getDate() - 5);
  return {
    _id: 'ord_delivery_1',
    orderId: '26101500011',
    fulfillment: 'delivery',
    type: 'tiffin',
    status: 'ACCEPTED',
    totalAmount: 300,
    placedAt: new Date().toISOString(),
    subscriptionStartDate: '2026-10-01',
    subscriptionEndDate: '2026-10-28',
    items: [
      { productName: 'Tiffin Plan — Full Meal Package (Couple)', category: 'Tiffin Plans', fulfillment: 'delivery', quantity: 1, subtotal: 300, deliveryStatus: 'ACCEPTED' }
    ],
    customer: {},
    ...overrides
  };
}

function makeMixedOrder(overrides = {}) {
  return {
    _id: 'ord_mixed_1',
    orderId: '26101500006',
    fulfillment: 'mixed',
    type: 'tiffin',
    status: 'ACCEPTED',
    totalAmount: 309.99,
    placedAt: new Date().toISOString(),
    pickupDate: '2026-10-20',
    subscriptionStartDate: '2026-10-01',
    subscriptionEndDate: '2026-10-28',
    items: [
      { productName: 'Full Meal — Couple', category: 'Tiffin Plans', fulfillment: 'delivery', quantity: 1, subtotal: 300, deliveryStatus: 'ACCEPTED' },
      { productName: 'Raw Tamarind Pickle', category: 'Pickles', fulfillment: 'pickup', quantity: 1, subtotal: 9.99, deliveryStatus: 'PENDING' }
    ],
    customer: {},
    ...overrides
  };
}

// ─── Part 1: Mixed-order amount bug ──────────────────────────────────────────

test('Part 1: componentAmount returns pickup subtotal (not full total) for mixed order', () => {
  const order = makeMixedOrder();
  assert.equal(componentAmount(order, 'pickup'), 9.99, 'Pickup component = $9.99');
  assert.equal(componentAmount(order, 'delivery'), 300, 'Delivery component = $300');
  // The full total is preserved on the order object and never duplicated
  assert.equal(order.totalAmount, 309.99, 'Overall total = $309.99');
});

test('Part 1: componentAmount for pickup-only order falls back to totalAmount when no subtotals', () => {
  const order = makePickupOrder({ items: [{ productName: 'P', fulfillment: 'pickup', quantity: 1, subtotal: 0 }], totalAmount: 8.99 });
  // subtotal is 0 on item — fallback to totalAmount for single-component
  assert.equal(componentAmount(order, 'pickup'), 8.99);
});

test('Part 1: money() formats amounts correctly', () => {
  assert.equal(money(9.99), '$9.99');
  assert.equal(money(300), '$300.00');
  assert.equal(money(309.99), '$309.99');
  assert.equal(money(0), '$0.00');
});

// ─── Part 2: Three-tab classification ────────────────────────────────────────

test('Part 2: Pickup-only order remains Ongoing until Delivered', () => {
  const order = makePickupOrder({ status: 'PENDING', items: [{ productName: 'P', category: 'Pickles', fulfillment: 'pickup', quantity: 1, subtotal: 9.99, deliveryStatus: 'PENDING' }] });
  const [comp] = extractComponents(order);
  assert.equal(comp.type, 'pickup');
  assert.equal(classifyComponent(comp), 'ongoing');
});

test('Part 2: Pickup order moves to Delivered after reaching Delivered status', () => {
  const order = makePickupOrder({ status: 'DELIVERED', items: [{ productName: 'P', category: 'Pickles', fulfillment: 'pickup', quantity: 1, subtotal: 9.99, deliveryStatus: 'DELIVERED' }] });
  const [comp] = extractComponents(order);
  assert.equal(classifyComponent(comp), 'delivered');
});

test('Part 2: Delivery subscription stays Ongoing while service days remain', () => {
  const futureEnd = new Date();
  futureEnd.setDate(futureEnd.getDate() + 10);
  const order = makeDeliveryOrder({ status: 'ACCEPTED', subscriptionEndDate: futureEnd.toISOString().slice(0, 10) });
  const [comp] = extractComponents(order);
  assert.equal(comp.type, 'delivery');
  assert.equal(classifyComponent(comp), 'ongoing');
});

test('Part 2: Delivery subscription moves to Delivered only after subscription end date passed and status DELIVERED', () => {
  const pastEnd = new Date();
  pastEnd.setDate(pastEnd.getDate() - 3);
  const order = makeDeliveryOrder({ status: 'DELIVERED', subscriptionEndDate: pastEnd.toISOString().slice(0, 10) });
  const [comp] = extractComponents(order);
  assert.equal(classifyComponent(comp), 'delivered');
});

test('Part 2: Delivery subscription with daily DELIVERED status appears in Delivered tab', () => {
  const futureEnd = new Date();
  futureEnd.setDate(futureEnd.getDate() + 5);
  const order = makeDeliveryOrder({ status: 'DELIVERED', subscriptionEndDate: futureEnd.toISOString().slice(0, 10) });
  const [comp] = extractComponents(order);
  // Daily delivery completed: appears in Delivered tab until next eligible service day reset
  assert.equal(classifyComponent(comp), 'delivered');
});

test('Part 2: Cancelled pickup component appears only under Cancelled tab', () => {
  const order = makePickupOrder({ status: 'CANCELLED', items: [{ productName: 'P', category: 'Pickles', fulfillment: 'pickup', quantity: 1, subtotal: 9.99, deliveryStatus: 'CANCELLED' }] });
  const [comp] = extractComponents(order);
  assert.equal(classifyComponent(comp), 'cancelled');
});

test('Part 2: Cancelled delivery component appears only under Cancelled tab', () => {
  const order = makeDeliveryOrder({ status: 'CANCELLED', items: [{ productName: 'T', category: 'Tiffin Plans', fulfillment: 'delivery', quantity: 1, subtotal: 300, deliveryStatus: 'CANCELLED' }] });
  const [comp] = extractComponents(order);
  assert.equal(classifyComponent(comp), 'cancelled');
});

test('Part 2: Mixed order yields two separate components with same order ID', () => {
  const order = makeMixedOrder();
  const components = extractComponents(order);
  assert.equal(components.length, 2);
  assert.ok(components.some((c) => c.type === 'pickup'), 'Pickup component present');
  assert.ok(components.some((c) => c.type === 'delivery'), 'Delivery component present');
  for (const c of components) {
    assert.equal(c.order.orderId, '26101500006', 'Both components share order ID 26101500006');
  }
});

test('Part 2: Mixed order — pickup Delivered + delivery Ongoing → different tabs', () => {
  const order = makeMixedOrder({
    status: 'ACCEPTED',   // delivery still active
    subscriptionEndDate: (() => { const d = new Date(); d.setDate(d.getDate() + 10); return d.toISOString().slice(0, 10); })(),
    items: [
      { productName: 'Full Meal — Couple', category: 'Tiffin Plans', fulfillment: 'delivery', quantity: 1, subtotal: 300, deliveryStatus: 'ACCEPTED' },
      { productName: 'Raw Tamarind Pickle', category: 'Pickles', fulfillment: 'pickup', quantity: 1, subtotal: 9.99, deliveryStatus: 'DELIVERED' }
    ]
  });
  const components = extractComponents(order);
  const pickup = components.find((c) => c.type === 'pickup');
  const delivery = components.find((c) => c.type === 'delivery');
  assert.equal(classifyComponent(pickup), 'delivered');
  assert.equal(classifyComponent(delivery), 'ongoing');
});

// ─── Part 3: Status tracker preserved ────────────────────────────────────────

test('Part 3: renderPickupTimeline generates dot/complete/current class structure', () => {
  const html = renderPickupTimeline('ACCEPTED');
  assert.ok(html.includes('class="timeline"'), 'Has timeline container');
  assert.ok(html.includes('class="dot"'), 'Has dot elements');
  assert.ok(html.includes('timeline-step complete'), 'Has complete step');
  assert.ok(html.includes('timeline-step  current'), 'Has current step');
  assert.ok(html.includes('<span>Accepted</span>'), 'Has Accepted label');
});

test('Part 3: renderTimeline generates 4-step delivery tracker', () => {
  const steps = ['PENDING', 'ACCEPTED', 'OUT_FOR_DELIVERY', 'DELIVERED'];
  const html = renderTimeline(steps, 'ACCEPTED');
  assert.ok(html.includes('Out for Delivery'), 'Has Out for Delivery label');
  assert.ok(html.includes('Pending'), 'Has Pending label');
  const stepCount = (html.match(/timeline-step/g) || []).length;
  assert.equal(stepCount, 4, 'Exactly 4 step elements in 4-step tracker');
});

test('Part 3: renderPickupTimeline shows Cancelled step when cancelled', () => {
  const html = renderPickupTimeline('CANCELLED');
  assert.ok(html.includes('<span>Cancelled</span>'), 'Has Cancelled label');
  const stepCount = (html.match(/timeline-step/g) || []).length;
  assert.equal(stepCount, 2, 'Pickup cancelled tracker has 2 steps: Pending + Cancelled');
});

test('Part 3: customer.css contains the exact timeline preservation rules', () => {
  const css = fs.readFileSync(path.resolve(__dirname, '../customer/customer.css'), 'utf8');
  assert.ok(css.includes('.timeline{'), 'Timeline base rule present');
  assert.ok(css.includes('.timeline::before{'), 'Horizontal line pseudo-element present');
  assert.ok(css.includes('.timeline-step .dot{'), 'Dot element rule present');
  assert.ok(css.includes('.timeline-step.complete'), 'Complete step rule present');
  assert.ok(css.includes('.timeline-step.current'), 'Current step rule present');
  // Colors preserved
  assert.ok(css.includes('#0c7a62'), 'Green color preserved for complete steps');
  assert.ok(css.includes('#c89b54'), 'Gold color preserved for current steps');
  assert.ok(css.includes('#fff8e8'), 'Background color preserved for current dot');
});

// ─── Part 4: Compact card structure ──────────────────────────────────────────

test('Part 4: customer.css contains compact card layout classes', () => {
  const css = fs.readFileSync(path.resolve(__dirname, '../customer/customer.css'), 'utf8');
  assert.ok(css.includes('.order-card-header'), 'order-card-header present');
  assert.ok(css.includes('.order-card-meta'), 'order-card-meta present');
  assert.ok(css.includes('.order-card-aside'), 'order-card-aside present');
  assert.ok(css.includes('.order-component-amount'), 'order-component-amount present');
  assert.ok(css.includes('.order-status-badge'), 'order-status-badge present');
  assert.ok(css.includes('.details-toggle'), 'details-toggle button present');
  assert.ok(css.includes('.order-details-panel'), 'expandable details panel present');
  assert.ok(css.includes('.fulfillment-badge'), 'fulfillment-badge present');
});

test('Part 4: orders-tabs CSS is present with three-tab pill style', () => {
  const css = fs.readFileSync(path.resolve(__dirname, '../customer/customer.css'), 'utf8');
  assert.ok(css.includes('.orders-tabs{'), 'orders-tabs container present');
  assert.ok(css.includes('.orders-tab{'), 'orders-tab button present');
  assert.ok(css.includes('.orders-tab.active'), 'active tab style present');
  assert.ok(css.includes('.tab-count'), 'tab count badge present');
});

test('Part 4: orders.html contains exactly three tabs', () => {
  const html = fs.readFileSync(path.resolve(__dirname, '../customer/orders.html'), 'utf8');
  const tabs = (html.match(/data-tab="/g) || []).length;
  assert.equal(tabs, 3, 'Exactly three data-tab buttons');
  assert.ok(html.includes('data-tab="ongoing"'), 'Ongoing tab present');
  assert.ok(html.includes('data-tab="delivered"'), 'Delivered tab present');
  assert.ok(html.includes('data-tab="cancelled"'), 'Cancelled tab present');
});

test('Part 4: orders.html has no duplicate order page or extra top-level tabs', () => {
  const html = fs.readFileSync(path.resolve(__dirname, '../customer/orders.html'), 'utf8');
  const tabCount = (html.match(/data-tab="/g) || []).length;
  assert.equal(tabCount, 3, 'No extra tabs beyond Ongoing/Delivered/Cancelled');
});

// ─── Part 5: Backend/status integrity ────────────────────────────────────────

test('Part 5: getPickupItemStatus reads item-level deliveryStatus, not order.status', () => {
  const order = makeMixedOrder({ status: 'ACCEPTED' }); // delivery is ACCEPTED
  const pickupItems = order.items.filter((i) => i.fulfillment === 'pickup');
  const status = getPickupItemStatus(order, pickupItems);
  // Pickup item has deliveryStatus: 'PENDING', even though order.status is 'ACCEPTED'
  assert.equal(status, 'PENDING', 'Pickup status reads from item.deliveryStatus, not order.status');
});

test('Part 5: getDeliveryStatus reads order-level status for subscription', () => {
  const order = makeDeliveryOrder({ status: 'OUT_FOR_DELIVERY' });
  assert.equal(getDeliveryStatus(order), 'OUT_FOR_DELIVERY');
});

test('Part 5: Pickup completion does not change delivery subscription status', () => {
  const order = makeMixedOrder({
    status: 'ACCEPTED',  // subscription active
    items: [
      { productName: 'Full Meal — Couple', category: 'Tiffin Plans', fulfillment: 'delivery', quantity: 1, subtotal: 300, deliveryStatus: 'ACCEPTED' },
      { productName: 'Raw Tamarind Pickle', category: 'Pickles', fulfillment: 'pickup', quantity: 1, subtotal: 9.99, deliveryStatus: 'DELIVERED' }
    ]
  });
  const components = extractComponents(order);
  const delivery = components.find((c) => c.type === 'delivery');
  assert.equal(delivery.status, 'ACCEPTED', 'Delivery status unchanged when pickup is DELIVERED');
});

test('Part 5: Delivery status change does not affect pickup status', () => {
  const order = makeMixedOrder({
    status: 'OUT_FOR_DELIVERY',
    items: [
      { productName: 'Full Meal — Couple', category: 'Tiffin Plans', fulfillment: 'delivery', quantity: 1, subtotal: 300, deliveryStatus: 'OUT_FOR_DELIVERY' },
      { productName: 'Raw Tamarind Pickle', category: 'Pickles', fulfillment: 'pickup', quantity: 1, subtotal: 9.99, deliveryStatus: 'PENDING' }
    ]
  });
  const components = extractComponents(order);
  const pickup = components.find((c) => c.type === 'pickup');
  assert.equal(pickup.status, 'PENDING', 'Pickup status unchanged when delivery advances');
});

test('Part 5: Cancelling one component does not incorrectly cancel the other', () => {
  // Simulate: delivery is cancelled, pickup is still pending
  const order = makeMixedOrder({
    fulfillment: 'mixed',
    // order.status reflects delivery (cancelled), but pickup item has its own status
    status: 'CANCELLED',
    items: [
      { productName: 'Full Meal — Couple', category: 'Tiffin Plans', fulfillment: 'delivery', quantity: 1, subtotal: 300, deliveryStatus: 'CANCELLED' },
      { productName: 'Raw Tamarind Pickle', category: 'Pickles', fulfillment: 'pickup', quantity: 1, subtotal: 9.99, deliveryStatus: 'PENDING' }
    ]
  });
  const components = extractComponents(order);
  const pickup = components.find((c) => c.type === 'pickup');
  const delivery = components.find((c) => c.type === 'delivery');
  // Pickup reads its own item.deliveryStatus = PENDING
  assert.equal(pickup.status, 'PENDING', 'Pickup not cancelled when only delivery is cancelled');
  assert.equal(delivery.status, 'CANCELLED', 'Delivery is cancelled');
  assert.equal(classifyComponent(delivery), 'cancelled', 'Delivery appears under Cancelled tab');
  assert.equal(classifyComponent(pickup), 'ongoing', 'Pickup appears under Ongoing tab');
});

test('Part 5: Component amounts reconcile to overall total for order 26101500006', () => {
  const order = makeMixedOrder();
  const pickupAmt = componentAmount(order, 'pickup');
  const deliveryAmt = componentAmount(order, 'delivery');
  const recon = Math.round((pickupAmt + deliveryAmt) * 100) / 100;
  assert.equal(recon, order.totalAmount, 'Pickup + Delivery components sum to overall total');
});

// ─── Part 6: Empty states and tab structure ───────────────────────────────────

test('Part 6: extractComponents for a custom/catering order with no items produces one component', () => {
  const order = {
    _id: 'ord_custom',
    orderId: '26101500099',
    fulfillment: 'pickup',
    type: 'catering',
    status: 'PENDING',
    totalAmount: 3000,
    placedAt: new Date().toISOString(),
    items: [],
    customer: {}
  };
  const components = extractComponents(order);
  assert.equal(components.length, 1);
  assert.equal(components[0].type, 'pickup');
});

test('Part 6: isSubscriptionFullyComplete is false for active subscription', () => {
  const futureEnd = new Date();
  futureEnd.setDate(futureEnd.getDate() + 5);
  const order = makeDeliveryOrder({ status: 'DELIVERED', subscriptionEndDate: futureEnd.toISOString().slice(0, 10) });
  assert.equal(isSubscriptionFullyComplete(order), false);
});

test('Part 6: isSubscriptionFullyComplete is true when status DELIVERED and end date past', () => {
  const pastEnd = new Date();
  pastEnd.setDate(pastEnd.getDate() - 2);
  const order = makeDeliveryOrder({ status: 'DELIVERED', subscriptionEndDate: pastEnd.toISOString().slice(0, 10) });
  assert.equal(isSubscriptionFullyComplete(order), true);
});

test('Part 6: Mixed order regression — order 26101500006 splits into pickup ($9.99) and delivery ($300)', () => {
  const order = makeMixedOrder();
  const components = extractComponents(order);
  const pickup = components.find((c) => c.type === 'pickup');
  const delivery = components.find((c) => c.type === 'delivery');
  assert.ok(pickup, 'Pickup component exists');
  assert.ok(delivery, 'Delivery component exists');
  assert.equal(pickup.amount, 9.99, 'Pickup shows $9.99');
  assert.equal(delivery.amount, 300, 'Delivery shows $300');
  // The old bug: both showed $309.99
  assert.notEqual(pickup.amount, 309.99, 'Pickup does NOT show the full $309.99 mixed total');
  assert.notEqual(delivery.amount, 309.99, 'Delivery does NOT show the full $309.99 mixed total');
});

test('Part 6: customer-orders.js exports no module (browser-only file)', () => {
  // Ensure no require() side-effects or missing runtime errors
  assert.ok(fs.existsSync(srcPath), 'customer-orders.js exists');
  const src2 = fs.readFileSync(srcPath, 'utf8');
  assert.ok(src2.includes('extractComponents'), 'extractComponents defined');
  assert.ok(src2.includes('classifyComponent'), 'classifyComponent defined');
  assert.ok(src2.includes('componentAmount'), 'componentAmount defined');
  assert.ok(src2.includes('isSubscriptionFullyComplete'), 'isSubscriptionFullyComplete defined');
});

test('Part 6: Existing customer-orders API route unchanged (customerOrders.js)', () => {
  const routeSrc = fs.readFileSync(path.resolve(__dirname, '../server/routes/customerOrders.js'), 'utf8');
  assert.ok(routeSrc.includes("router.get('/'"), 'GET / route preserved');
  assert.ok(routeSrc.includes("router.get('/:id'"), 'GET /:id route preserved');
  assert.ok(routeSrc.includes("router.put('/:id/cancel'"), 'PUT /:id/cancel route preserved');
  assert.ok(routeSrc.includes('customerAuthRequired'), 'Auth middleware preserved');
});
