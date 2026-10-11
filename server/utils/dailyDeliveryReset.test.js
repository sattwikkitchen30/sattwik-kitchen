const test = require('node:test');
const assert = require('node:assert/strict');
const { resetDeliveredOrders } = require('./dailyDeliveryReset');

test('resets an active delivered subscription once on the next service day and preserves its assignment', async () => {
  const order = {
    _id: 'order-id',
    orderId: 'permanent-order-id',
    type: 'tiffin',
    status: 'DELIVERED',
    deliveryMemberId: 'member-id',
    subscriptionStartDate: new Date(2026, 9, 12),
    subscriptionEndDate: new Date(2026, 10, 6),
    deliveryStatusDate: new Date(2026, 9, 12),
    firstDeliveredAt: new Date(2026, 9, 12, 15),
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
  const now = new Date(2026, 9, 13, 0, 5);

  const resetCount = await resetDeliveredOrders(Order, { now });
  assert.equal(resetCount, 1);
  assert.equal(order.status, 'ACCEPTED');
  assert.equal(order.items[0].deliveryStatus, 'ACCEPTED');
  assert.equal(order.deliveryMemberId, 'member-id');
  assert.equal(order.orderId, 'permanent-order-id');
  assert.equal(order.firstDeliveredAt.getDate(), 12);
  assert.equal(query.status.$in.includes('CANCELLED'), false);
  assert.equal(await resetDeliveredOrders(Order, { now }), 0);
});

test('skips weekends without querying orders', async () => {
  let queried = false;
  const Order = { find() { queried = true; throw new Error('must not query on weekend'); } };

  assert.equal(await resetDeliveredOrders(Order, { now: new Date(2026, 9, 17, 12) }), 0);
  assert.equal(queried, false);
});
