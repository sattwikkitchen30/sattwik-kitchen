const test = require('node:test');
const assert = require('node:assert/strict');
const { resetDeliveredOrders, startDailyDeliveryReset } = require('./dailyDeliveryReset');

test('resets an active delivered subscription once on the next service day and preserves its assignment', async () => {
  const order = {
    _id: 'order-id',
    orderId: 'permanent-order-id',
    type: 'tiffin',
    status: 'DELIVERED',
    deliveryMemberId: 'member-id',
    subscriptionStartDate: new Date('2026-10-12T07:00:00Z'),
    subscriptionEndDate: new Date('2026-11-06T08:00:00Z'),
    deliveryStatusDate: new Date('2026-10-12T07:00:00Z'),
    firstDeliveredAt: new Date('2026-10-12T22:00:00Z'),
    items: [{ fulfillment: 'delivery', deliveryStatus: 'DELIVERED' }]
  };
  let query;
  const Order = {
    find(filter) {
      query = filter;
      return { lean: async () => order.status === 'DELIVERED' ? [{ ...order }] : [] };
    },
    findOneAndUpdate(filter, update, options) {
      assert.equal(filter.status, order.status);
      assert.equal(options.arrayFilters[0]['delivery.fulfillment'], 'delivery');
      Object.assign(order, update.$set);
      order.items[0].deliveryStatus = update.$set['items.$[delivery].deliveryStatus'];
      return { lean: async () => ({ ...order, items: order.items.map((item) => ({ ...item })) }) };
    }
  };
  const now = new Date('2026-10-13T07:05:00Z');

  const resetCount = await resetDeliveredOrders(Order, { now });
  assert.equal(resetCount, 1);
  assert.equal(order.status, 'ACCEPTED');
  assert.equal(order.items[0].deliveryStatus, 'ACCEPTED');
  assert.equal(order.deliveryMemberId, 'member-id');
  assert.equal(order.orderId, 'permanent-order-id');
  assert.equal(order.firstDeliveredAt.getUTCDate(), 12);
  assert.equal(query.status.$in.includes('CANCELLED'), false);
  assert.equal(await resetDeliveredOrders(Order, { now }), 0);
});

test('skips weekends without querying orders', async () => {
  let queried = false;
  const Order = { find() { queried = true; throw new Error('must not query on weekend'); } };

  assert.equal(await resetDeliveredOrders(Order, { now: new Date('2026-10-17T19:00:00Z') }), 0);
  assert.equal(queried, false);
});

test('startDailyDeliveryReset schedules next service day across weekends without constant reassignment error', async () => {
  const Order = { find: () => ({ lean: async () => [] }) };

  // 1. Starting on Saturday: must loop through Sunday to Monday without throwing "Assignment to constant variable"
  let scheduledDelaySat = null;
  await new Promise((resolve) => {
    const stopSat = startDailyDeliveryReset(Order, null, {
      now: () => new Date('2026-10-17T12:00:00Z'), // Saturday
      setTimeoutFn: (fn, delay) => {
        scheduledDelaySat = delay;
        stopSat();
        resolve();
        return { unref: () => {} };
      }
    });
  });
  assert.ok(scheduledDelaySat > 0, 'Must schedule a future timer delay');

  // 2. Starting on Friday: must loop through Saturday and Sunday to Monday without throwing
  let scheduledDelayFri = null;
  await new Promise((resolve) => {
    const stopFri = startDailyDeliveryReset(Order, null, {
      now: () => new Date('2026-10-16T12:00:00Z'), // Friday
      setTimeoutFn: (fn, delay) => {
        scheduledDelayFri = delay;
        stopFri();
        resolve();
        return { unref: () => {} };
      }
    });
  });
  assert.ok(scheduledDelayFri > 0, 'Must schedule a future timer delay');
});
