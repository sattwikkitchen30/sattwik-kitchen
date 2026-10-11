const test = require('node:test');
const assert = require('node:assert/strict');
const { isTiffinPreparationEligible, resolveDeliveryStatus, filterTiffinPreparationSubscriptions } = require('./deliveryStatus');
const { getSubscriptionServiceDates, formatDateKey, isServiceDay } = require('./tiffinPreparation');

const monday = new Date('2026-10-12T12:00:00');

function makeOrder(status, overrides = {}) {
  return {
    type: 'tiffin',
    status,
    subscriptionStartDate: new Date('2026-10-12T00:00:00'),
    subscriptionEndDate: new Date('2026-11-06T00:00:00'),
    deliveryStatusDate: new Date('2026-10-12T00:00:00'),
    items: [{ fulfillment: 'delivery', deliveryStatus: status }],
    ...overrides
  };
}

test('Pending does not contribute; Accepted, Out for Delivery, and Delivered do', () => {
  assert.equal(isTiffinPreparationEligible(makeOrder('PENDING'), monday), false);
  assert.equal(isTiffinPreparationEligible(makeOrder('ACCEPTED'), monday), true);
  assert.equal(isTiffinPreparationEligible(makeOrder('OUT_FOR_DELIVERY'), monday), true);
  assert.equal(isTiffinPreparationEligible(makeOrder('DELIVERED'), monday), true);
});

test('one-off delivery orders do not receive subscription-day status resets', () => {
  const delivery = makeOrder('DELIVERED', { type: 'product' });
  const nextServiceDay = new Date('2026-10-13T12:00:00');

  assert.equal(resolveDeliveryStatus(delivery, nextServiceDay), 'DELIVERED');
});

test('Delivered remains eligible on its active date and resets to Accepted on a later service day', () => {
  const delivered = makeOrder('DELIVERED');
  const nextServiceDay = new Date('2026-10-13T12:00:00');

  assert.equal(isTiffinPreparationEligible(delivered, monday), true);
  assert.equal(resolveDeliveryStatus(delivered, nextServiceDay), 'ACCEPTED');
  assert.equal(isTiffinPreparationEligible(delivered, nextServiceDay), true);
});

test('Cancelled and missing orders do not contribute', () => {
  assert.equal(isTiffinPreparationEligible(makeOrder('CANCELLED'), monday), false);
  assert.equal(isTiffinPreparationEligible(null, monday), false);
});

test('the shared preparation set excludes pending, cancelled, and orphan subscriptions', () => {
  const eligible = filterTiffinPreparationSubscriptions([
    { orderId: makeOrder('PENDING') },
    { orderId: makeOrder('ACCEPTED') },
    { orderId: makeOrder('OUT_FOR_DELIVERY') },
    { orderId: makeOrder('DELIVERED') },
    { orderId: makeOrder('CANCELLED') },
    { orderId: null }
  ], monday);

  assert.equal(eligible.length, 3);
  assert.deepEqual(eligible.map((subscription) => subscription.orderId.status), [
    'ACCEPTED',
    'OUT_FOR_DELIVERY',
    'DELIVERED'
  ]);
});

test('subscription schedule contains exactly twenty weekdays and no weekend service', () => {
  const dates = getSubscriptionServiceDates(monday);

  assert.equal(dates.serviceDates.length, 20);
  assert.equal(isServiceDay(new Date('2026-10-12T12:00:00')), true);
  assert.equal(isServiceDay(new Date('2026-10-17T12:00:00')), false);
  assert.equal(isServiceDay(new Date('2026-10-18T12:00:00')), false);
  assert.equal(formatDateKey(dates.startDate), '2026-10-12');
  assert.equal(formatDateKey(dates.endDate), '2026-11-06');
});
