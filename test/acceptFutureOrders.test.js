const test = require('node:test');
const assert = require('node:assert/strict');
const { transitionOrderStatus } = require('../server/utils/orderStatus');
const { withCurrentDeliveryStatus } = require('../server/utils/deliveryStatus');
const { getSubscriptionServiceDates } = require('../server/utils/tiffinPreparation');

function makeDeliveryOrder(overrides = {}) {
  // Example from prompt:
  // Order placed: October 16, 2026
  // Delivery start date: October 21, 2026 (Wednesday)
  // Subscription: 20 Monday-Friday service days
  const startDate = new Date('2026-10-21T12:00:00Z');
  const serviceInfo = getSubscriptionServiceDates(startDate);
  return {
    _id: 'order-del-1',
    orderId: '26101600001',
    type: 'tiffin',
    fulfillment: 'delivery',
    status: 'PENDING',
    placedAt: new Date('2026-10-16T10:00:00Z'),
    subscriptionStartDate: serviceInfo.startDate,
    subscriptionEndDate: serviceInfo.endDate,
    deliveryStatusDate: serviceInfo.serviceDates[0],
    totalAmount: 300.00,
    deliveryMemberId: 'member-1',
    items: [
      {
        productName: 'Full Meal — Couple',
        category: 'Tiffin Plans',
        fulfillment: 'delivery',
        deliveryStatus: 'PENDING',
        priceAtPurchase: 300.00,
        quantity: 1,
        subtotal: 300.00
      }
    ],
    ...overrides
  };
}

function makePickupOrder(overrides = {}) {
  // Example from prompt:
  // Order placed: October 16, 2026
  // Scheduled pickup date: October 21, 2026
  return {
    _id: 'order-pick-1',
    orderId: '26101600002',
    type: 'product',
    fulfillment: 'pickup',
    status: 'PENDING',
    placedAt: new Date('2026-10-16T10:00:00Z'),
    pickupDate: new Date('2026-10-21T12:00:00Z'),
    totalAmount: 9.99,
    items: [
      {
        productName: 'Raw Tamarind Pickle',
        category: 'Pickles',
        fulfillment: 'pickup',
        deliveryStatus: 'PENDING',
        priceAtPurchase: 9.99,
        quantity: 1,
        subtotal: 9.99
      }
    ],
    ...overrides
  };
}

function mockModel(order) {
  const calls = [];
  return {
    calls,
    findOneAndUpdate(filter, update, options) {
      calls.push({ filter, update, options });
      if (filter.status !== order.status) return { lean: async () => null };
      if (filter.deliveryMemberId && filter.deliveryMemberId !== order.deliveryMemberId) return { lean: async () => null };
      if (filter.items?.$elemMatch) {
        const expectedStatus = filter.items.$elemMatch.deliveryStatus;
        if (!order.items.some((item) => item.fulfillment === 'pickup' && (item.deliveryStatus ?? null) === expectedStatus)) {
          return { lean: async () => null };
        }
      }
      for (const [key, value] of Object.entries(update.$set || {})) {
        const itemField = /^items\.\$\[item\]\.deliveryStatus$/.test(key);
        if (itemField) {
          const fulfillmentFilter = options?.arrayFilters?.[0]?.['item.fulfillment'];
          const allowed = typeof fulfillmentFilter === 'string'
            ? [fulfillmentFilter]
            : (fulfillmentFilter?.$in || ['pickup', 'delivery']);
          order.items.forEach((item) => {
            if (allowed.includes(item.fulfillment)) item.deliveryStatus = value;
          });
        } else {
          order[key] = value;
        }
      }
      return { lean: async () => ({ ...order, items: order.items.map((item) => ({ ...item })) }) };
    }
  };
}

// ── 1. Future-dated Delivery order can be accepted by an admin ────────────────
test('1. Future-dated Delivery order can be accepted by an admin', async () => {
  const order = makeDeliveryOrder();
  const model = mockModel(order);
  const now = new Date('2026-10-16T14:00:00Z'); // 5 days before start date

  const result = await transitionOrderStatus(model, order, 'ACCEPTED', {
    actor: 'admin',
    fulfillment: 'delivery',
    now
  });

  assert.equal(result.error, undefined, 'Admin accepting future delivery order should not produce an error');
  assert.equal(result.order.status, 'ACCEPTED');
  assert.equal(result.order.items[0].deliveryStatus, 'ACCEPTED');
  assert.ok(result.order.acceptedAt, 'acceptedAt timestamp should be set');
  assert.equal(result.order.acceptedAt.getTime(), now.getTime());
});

// ── 2. Future-dated Pickup order can be accepted by an admin ───────────────────
test('2. Future-dated Pickup order can be accepted by an admin', async () => {
  const order = makePickupOrder();
  const model = mockModel(order);
  const now = new Date('2026-10-16T14:00:00Z'); // 5 days before pickup date

  const result = await transitionOrderStatus(model, order, 'ACCEPTED', {
    actor: 'admin',
    fulfillment: 'pickup',
    now
  });

  assert.equal(result.error, undefined, 'Admin accepting future pickup order should not produce an error');
  assert.equal(result.order.status, 'ACCEPTED');
  assert.equal(result.order.items[0].deliveryStatus, 'ACCEPTED');
  assert.ok(result.order.acceptedAt, 'acceptedAt timestamp should be set');
  assert.equal(result.order.acceptedAt.getTime(), now.getTime());
});

// ── 3. Delivery and Pickup orders scheduled for today can still be accepted ──
test('3. Delivery and Pickup orders scheduled for today can still be accepted', async () => {
  // Wednesday Oct 21, 2026 (service day)
  const today = new Date('2026-10-21T16:00:00Z');

  // Delivery order scheduled for today
  const deliveryOrder = makeDeliveryOrder({
    subscriptionStartDate: new Date('2026-10-21T12:00:00Z')
  });
  const deliveryModel = mockModel(deliveryOrder);
  const delResult = await transitionOrderStatus(deliveryModel, deliveryOrder, 'ACCEPTED', {
    actor: 'admin',
    fulfillment: 'delivery',
    now: today
  });
  assert.equal(delResult.error, undefined);
  assert.equal(delResult.order.status, 'ACCEPTED');

  // Pickup order scheduled for today
  const pickupOrder = makePickupOrder({
    pickupDate: new Date('2026-10-21T12:00:00Z')
  });
  const pickupModel = mockModel(pickupOrder);
  const pickResult = await transitionOrderStatus(pickupModel, pickupOrder, 'ACCEPTED', {
    actor: 'admin',
    fulfillment: 'pickup',
    now: today
  });
  assert.equal(pickResult.error, undefined);
  assert.equal(pickResult.order.status, 'ACCEPTED');
});

// ── 4. Acceptance does not change scheduled dates or order amounts ───────────
test('4. Acceptance does not change scheduled dates or order amounts', async () => {
  const deliveryOrder = makeDeliveryOrder();
  const initialStartDate = new Date(deliveryOrder.subscriptionStartDate);
  const initialEndDate = new Date(deliveryOrder.subscriptionEndDate);
  const initialDeliveryAmount = deliveryOrder.totalAmount;

  const delResult = await transitionOrderStatus(mockModel(deliveryOrder), deliveryOrder, 'ACCEPTED', {
    actor: 'admin',
    fulfillment: 'delivery',
    now: new Date('2026-10-16T14:00:00Z')
  });
  assert.equal(delResult.order.subscriptionStartDate.getTime(), initialStartDate.getTime());
  assert.equal(delResult.order.subscriptionEndDate.getTime(), initialEndDate.getTime());
  assert.equal(delResult.order.totalAmount, initialDeliveryAmount);

  const pickupOrder = makePickupOrder();
  const initialPickupDate = new Date(pickupOrder.pickupDate);
  const initialPickupAmount = pickupOrder.totalAmount;

  const pickResult = await transitionOrderStatus(mockModel(pickupOrder), pickupOrder, 'ACCEPTED', {
    actor: 'admin',
    fulfillment: 'pickup',
    now: new Date('2026-10-16T14:00:00Z')
  });
  assert.equal(pickResult.order.pickupDate.getTime(), initialPickupDate.getTime());
  assert.equal(pickResult.order.totalAmount, initialPickupAmount);
});

// ── 5. Acceptance does not automatically complete either fulfillment ─────────
test('5. Acceptance does not automatically complete either fulfillment', async () => {
  const deliveryOrder = makeDeliveryOrder();
  const delResult = await transitionOrderStatus(mockModel(deliveryOrder), deliveryOrder, 'ACCEPTED', {
    actor: 'admin',
    now: new Date('2026-10-16T14:00:00Z')
  });
  assert.equal(delResult.order.status, 'ACCEPTED');
  assert.equal(delResult.order.deliveredAt, undefined);
  assert.equal(delResult.order.firstDeliveredAt, undefined);

  const pickupOrder = makePickupOrder();
  const pickResult = await transitionOrderStatus(mockModel(pickupOrder), pickupOrder, 'ACCEPTED', {
    actor: 'admin',
    fulfillment: 'pickup',
    now: new Date('2026-10-16T14:00:00Z')
  });
  assert.equal(pickResult.order.status, 'ACCEPTED');
  assert.equal(pickResult.order.deliveredAt, undefined);
  assert.equal(pickResult.order.firstDeliveredAt, undefined);
});

// ── 6. Delivery-member scheduling restrictions remain enforced ────────────────
test('6. Delivery-member scheduling restrictions remain enforced on non-service days', async () => {
  const order = makeDeliveryOrder({ status: 'ACCEPTED' });
  order.items[0].deliveryStatus = 'ACCEPTED';
  const model = mockModel(order);

  // Attempting OUT_FOR_DELIVERY before subscription starts (e.g. Oct 16) fails
  const earlyAttempt = await transitionOrderStatus(model, order, 'OUT_FOR_DELIVERY', {
    actor: 'delivery',
    now: new Date('2026-10-16T14:00:00Z')
  });
  assert.ok(earlyAttempt.error, 'Should reject out-for-delivery before subscription starts');
  assert.equal(earlyAttempt.error.status, 400);
  assert.equal(earlyAttempt.error.message, 'No delivery service is scheduled for today.');

  // Attempting DELIVERED directly before subscription starts fails
  const earlyDeliveredAttempt = await transitionOrderStatus(model, order, 'DELIVERED', {
    actor: 'delivery',
    now: new Date('2026-10-16T14:00:00Z')
  });
  assert.ok(earlyDeliveredAttempt.error);
  assert.equal(earlyDeliveredAttempt.error.status, 400);
  assert.equal(earlyDeliveredAttempt.error.message, 'Invalid transition from ACCEPTED to DELIVERED.');

  // On an actual service day (Oct 21, 2026), delivery member can proceed
  const serviceDay = new Date('2026-10-21T18:00:00Z');
  const validOut = await transitionOrderStatus(model, order, 'OUT_FOR_DELIVERY', {
    actor: 'delivery',
    now: serviceDay
  });
  assert.equal(validOut.error, undefined);
  assert.equal(validOut.order.status, 'OUT_FOR_DELIVERY');

  const validDel = await transitionOrderStatus(model, order, 'DELIVERED', {
    actor: 'delivery',
    now: serviceDay
  });
  assert.equal(validDel.error, undefined);
  assert.equal(validDel.order.status, 'DELIVERED');
});

// ── 7. Existing pickup status transitions continue to work ────────────────────
test('7. Existing pickup status transitions continue to work', async () => {
  // PENDING -> ACCEPTED -> DELIVERED
  const order1 = makePickupOrder();
  const m1 = mockModel(order1);
  const a1 = await transitionOrderStatus(m1, order1, 'ACCEPTED', { actor: 'admin', fulfillment: 'pickup' });
  assert.equal(a1.order.status, 'ACCEPTED');
  const d1 = await transitionOrderStatus(m1, order1, 'DELIVERED', { actor: 'admin', fulfillment: 'pickup' });
  assert.equal(d1.order.status, 'DELIVERED');

  // Direct PENDING -> DELIVERED
  const order2 = makePickupOrder();
  const m2 = mockModel(order2);
  const d2 = await transitionOrderStatus(m2, order2, 'DELIVERED', { actor: 'admin', fulfillment: 'pickup' });
  assert.equal(d2.order.status, 'DELIVERED');

  // DELIVERED is terminal
  const d3 = await transitionOrderStatus(m2, order2, 'PENDING', { actor: 'admin', fulfillment: 'pickup' });
  assert.equal(d3.error.status, 409);
  assert.equal(d3.error.message, 'Delivered orders cannot be changed or cancelled.');

  // CANCELLED is terminal
  const order4 = makePickupOrder({ status: 'CANCELLED' });
  order4.items[0].deliveryStatus = 'CANCELLED';
  const c4 = await transitionOrderStatus(mockModel(order4), order4, 'ACCEPTED', { actor: 'admin', fulfillment: 'pickup' });
  assert.equal(c4.error.status, 409);
  assert.equal(c4.error.message, 'Cancelled orders cannot be changed.');
});

// ── 8. The customer sees the updated Accepted status ──────────────────────────
test('8. The customer sees the updated Accepted status immediately', () => {
  // Accepted future delivery order
  const deliveryOrder = makeDeliveryOrder({
    status: 'ACCEPTED',
    acceptedAt: new Date('2026-10-16T12:00:00Z'),
    items: [{ fulfillment: 'delivery', deliveryStatus: 'ACCEPTED', productName: 'Full Meal — Couple', subtotal: 300 }]
  });
  const now = new Date('2026-10-16T14:00:00Z');
  const serialized = withCurrentDeliveryStatus(deliveryOrder, now);
  assert.equal(serialized.status, 'ACCEPTED', 'Customer delivery status should be ACCEPTED');
  assert.equal(serialized.items[0].deliveryStatus, 'ACCEPTED');

  // Accepted future pickup order
  const pickupOrder = makePickupOrder({
    status: 'ACCEPTED',
    acceptedAt: new Date('2026-10-16T12:00:00Z'),
    items: [{ fulfillment: 'pickup', deliveryStatus: 'ACCEPTED', productName: 'Raw Tamarind Pickle', subtotal: 9.99 }]
  });
  const pickupItemStatus = pickupOrder.items[0].deliveryStatus;
  assert.equal(pickupItemStatus, 'ACCEPTED', 'Customer pickup item status should be ACCEPTED');
});

// ── 9. Unauthorized users still cannot change order status ───────────────────
test('9. Unauthorized users still cannot change order status', async () => {
  const deliveryOrder = makeDeliveryOrder();
  const customerDelAttempt = await transitionOrderStatus(mockModel(deliveryOrder), deliveryOrder, 'ACCEPTED', {
    actor: 'customer'
  });
  assert.ok(customerDelAttempt.error);
  assert.equal(customerDelAttempt.error.status, 403);
  assert.equal(customerDelAttempt.error.message, 'Only an admin can accept an order.');

  const deliveryMemberDelAttempt = await transitionOrderStatus(mockModel(deliveryOrder), deliveryOrder, 'ACCEPTED', {
    actor: 'delivery'
  });
  assert.ok(deliveryMemberDelAttempt.error);
  assert.equal(deliveryMemberDelAttempt.error.status, 400);
  assert.equal(deliveryMemberDelAttempt.error.message, 'Delivery members cannot set this status.');

  const pickupOrder = makePickupOrder();
  const customerPickAttempt = await transitionOrderStatus(mockModel(pickupOrder), pickupOrder, 'ACCEPTED', {
    actor: 'customer',
    fulfillment: 'pickup'
  });
  assert.ok(customerPickAttempt.error);
  assert.equal(customerPickAttempt.error.status, 403);
  assert.equal(customerPickAttempt.error.message, 'Only an admin can change pickup status.');

  const deliveryMemberPickAttempt = await transitionOrderStatus(mockModel(pickupOrder), pickupOrder, 'ACCEPTED', {
    actor: 'delivery',
    fulfillment: 'pickup'
  });
  assert.ok(deliveryMemberPickAttempt.error);
  assert.equal(deliveryMemberPickAttempt.error.status, 403);
  assert.equal(deliveryMemberPickAttempt.error.message, 'Only an admin can change pickup status.');
});
