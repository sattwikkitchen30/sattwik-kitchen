const test = require('node:test');
const assert = require('node:assert/strict');
const { transitionOrderStatus } = require('./orderStatus');

function makeOrder(overrides = {}) {
  return {
    _id: 'order-1',
    orderId: 'permanent-id',
    status: 'ACCEPTED',
    deliveryStatusDate: new Date(2026, 9, 12),
    subscriptionStartDate: new Date(2026, 9, 12),
    subscriptionEndDate: new Date(2026, 10, 6),
    deliveryMemberId: 'member-1',
    items: [{ fulfillment: 'delivery', deliveryStatus: 'ACCEPTED' }],
    ...overrides
  };
}

function modelFor(order) {
  const calls = [];
  return {
    calls,
    findOneAndUpdate(filter, update, options) {
      calls.push({ filter, update, options });
      if (filter.status !== order.status) return { lean: async () => null };
      if (filter.deliveryMemberId && filter.deliveryMemberId !== order.deliveryMemberId) return { lean: async () => null };
      for (const [key, value] of Object.entries(update.$set)) {
        const itemField = /^items\.\$\[item\]\.deliveryStatus$/.test(key);
        if (itemField) {
          const fulfillmentFilter = options.arrayFilters[0]['item.fulfillment'];
          const allowed = typeof fulfillmentFilter === 'string' ? [fulfillmentFilter] : fulfillmentFilter.$in;
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

test('delivery order follows Accepted to Out for Delivery to Delivered and preserves first delivery', async () => {
  const order = makeOrder();
  const model = modelFor(order);
  const firstDay = new Date(2026, 9, 12, 12);

  const outForDelivery = await transitionOrderStatus(model, order, 'OUT_FOR_DELIVERY', { actor: 'admin', now: firstDay });
  assert.equal(outForDelivery.order.status, 'OUT_FOR_DELIVERY');
  const delivered = await transitionOrderStatus(model, order, 'DELIVERED', { actor: 'delivery', now: firstDay });
  assert.equal(delivered.order.status, 'DELIVERED');
  const firstDeliveredAt = order.firstDeliveredAt;
  assert.ok(firstDeliveredAt);

  order.status = 'ACCEPTED';
  order.deliveryStatusDate = new Date(2026, 9, 13);
  order.items[0].deliveryStatus = 'ACCEPTED';
  const nextDay = new Date(2026, 9, 13, 12);
  await transitionOrderStatus(model, order, 'OUT_FOR_DELIVERY', { actor: 'delivery', now: nextDay });
  await transitionOrderStatus(model, order, 'DELIVERED', { actor: 'delivery', now: nextDay });

  assert.equal(order.firstDeliveredAt, firstDeliveredAt);
  assert.equal(order.orderId, 'permanent-id');
});

test('pickup orders follow Pending to Accepted to Out for Delivery to Delivered', async () => {
  const order = makeOrder({
    status: 'PENDING',
    deliveryStatusDate: null,
    subscriptionStartDate: null,
    subscriptionEndDate: null,
    deliveryMemberId: null,
    fulfillment: 'pickup',
    items: [{ fulfillment: 'pickup', deliveryStatus: 'PENDING' }]
  });
  const model = modelFor(order);

  for (const status of ['ACCEPTED', 'OUT_FOR_DELIVERY', 'DELIVERED']) {
    const result = await transitionOrderStatus(model, order, status, {
      actor: 'admin',
      fulfillment: 'pickup',
      now: new Date(2026, 9, 12, 12)
    });
    assert.equal(result.order.status, status);
    assert.equal(result.order.items[0].deliveryStatus, status);
  }
  assert.ok(order.firstDeliveredAt);
});

test('delivering a pickup component does not mark the delivery component as revenue-delivered', async () => {
  const order = makeOrder({
    status: 'ACCEPTED',
    items: [
      { fulfillment: 'pickup', deliveryStatus: 'ACCEPTED' },
      { fulfillment: 'delivery', deliveryStatus: 'ACCEPTED' }
    ]
  });
  const model = modelFor(order);
  const now = new Date(2026, 9, 12, 12);

  await transitionOrderStatus(model, order, 'OUT_FOR_DELIVERY', { fulfillment: 'pickup', now });
  await transitionOrderStatus(model, order, 'DELIVERED', { fulfillment: 'pickup', now });
  assert.equal(order.firstDeliveredAt, undefined);
  assert.equal(order.deliveredAt, undefined);

  await transitionOrderStatus(model, order, 'OUT_FOR_DELIVERY', { fulfillment: 'delivery', now });
  await transitionOrderStatus(model, order, 'DELIVERED', { fulfillment: 'delivery', now });
  assert.ok(order.firstDeliveredAt);
});

test('cancellation is permitted before delivery but delivered and cancelled orders are terminal', async () => {
  const pendingOrder = makeOrder({ status: 'PENDING', items: [{ fulfillment: 'delivery', deliveryStatus: 'PENDING' }] });
  const cancelled = await transitionOrderStatus(modelFor(pendingOrder), pendingOrder, 'CANCELLED', {
    actor: 'customer',
    now: new Date(2026, 9, 12, 12)
  });
  assert.equal(cancelled.order.status, 'CANCELLED');
  assert.equal(cancelled.order.items[0].deliveryStatus, 'CANCELLED');
  assert.ok(cancelled.order.cancelledAt);

  const deliveredOrder = makeOrder({ status: 'DELIVERED', items: [{ fulfillment: 'delivery', deliveryStatus: 'DELIVERED' }] });
  const rejectDeliveredCancel = await transitionOrderStatus(modelFor(deliveredOrder), deliveredOrder, 'CANCELLED');
  assert.equal(rejectDeliveredCancel.error.status, 409);

  const rejectCancelledDelivery = await transitionOrderStatus(modelFor(pendingOrder), pendingOrder, 'DELIVERED');
  assert.equal(rejectCancelledDelivery.error.status, 409);
});

test('delivery-member updates are scoped to their assignment and status races fail closed', async () => {
  const order = makeOrder();
  const model = modelFor(order);
  const unauthorized = await transitionOrderStatus(model, order, 'OUT_FOR_DELIVERY', {
    actor: 'delivery',
    accessFilter: { deliveryMemberId: 'another-member' },
    now: new Date(2026, 9, 12, 12)
  });
  assert.equal(unauthorized.error.status, 409);

  const racingModel = { findOneAndUpdate: () => ({ lean: async () => null }) };
  const race = await transitionOrderStatus(racingModel, order, 'OUT_FOR_DELIVERY', {
    actor: 'admin',
    now: new Date(2026, 9, 12, 12)
  });
  assert.equal(race.error.status, 409);
});
