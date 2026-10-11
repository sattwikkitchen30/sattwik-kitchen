const test = require('node:test');
const assert = require('node:assert/strict');
const { isTiffinPreparationEligible, resolveDeliveryStatus, filterTiffinPreparationSubscriptions, getCurrentServiceDate } = require('./deliveryStatus');
const { getSubscriptionServiceDates, formatDateKey, isServiceDay, parseDateInput } = require('./tiffinPreparation');

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

test('business calendar treats weekdays as service days and keeps date-only values on the same day', () => {
  assert.equal(formatDateKey('2026-10-12'), '2026-10-12');
  assert.equal(formatDateKey(parseDateInput('2026-10-12')), '2026-10-12');
  assert.equal(isServiceDay(new Date('2026-10-12T00:08:00+05:30')), true);
  assert.equal(isServiceDay(new Date('2026-10-13T12:00:00+05:30')), true);
  assert.equal(isServiceDay(new Date('2026-10-16T12:00:00+05:30')), true);
  assert.equal(isServiceDay(new Date('2026-10-17T12:00:00+05:30')), false);
  assert.equal(isServiceDay(new Date('2026-10-18T12:00:00+05:30')), false);
  assert.equal(isServiceDay(new Date('2026-10-11T18:38:00.000Z')), true);
});

test('current service date is inclusive of start and end and ignores UTC Sunday for a Monday in India', () => {
  const order = makeOrder('ACCEPTED');
  const mondayMorningIst = new Date('2026-10-11T18:38:00.000Z');
  const tuesday = new Date('2026-10-13T06:30:00.000Z');
  const friday = new Date('2026-10-16T06:30:00.000Z');
  const saturday = new Date('2026-10-17T06:30:00.000Z');
  const sunday = new Date('2026-10-18T06:30:00.000Z');

  assert.equal(formatDateKey(getCurrentServiceDate(order, mondayMorningIst)), '2026-10-12');
  assert.equal(formatDateKey(getCurrentServiceDate(order, tuesday)), '2026-10-13');
  assert.equal(formatDateKey(getCurrentServiceDate(order, friday)), '2026-10-16');
  assert.equal(getCurrentServiceDate(order, saturday), null);
  assert.equal(getCurrentServiceDate(order, sunday), null);

  const startsToday = makeOrder('ACCEPTED', {
    subscriptionStartDate: parseDateInput('2026-10-12'),
    subscriptionEndDate: parseDateInput('2026-11-06')
  });
  assert.equal(formatDateKey(getCurrentServiceDate(startsToday, mondayMorningIst)), '2026-10-12');

  const notStarted = makeOrder('ACCEPTED', { subscriptionStartDate: parseDateInput('2026-10-13') });
  assert.equal(getCurrentServiceDate(notStarted, mondayMorningIst), null);

  const endsToday = makeOrder('ACCEPTED', {
    subscriptionStartDate: parseDateInput('2026-09-15'),
    subscriptionEndDate: parseDateInput('2026-10-12')
  });
  assert.equal(formatDateKey(getCurrentServiceDate(endsToday, mondayMorningIst)), '2026-10-12');

  const expired = makeOrder('ACCEPTED', {
    subscriptionStartDate: parseDateInput('2026-09-01'),
    subscriptionEndDate: parseDateInput('2026-10-09')
  });
  assert.equal(getCurrentServiceDate(expired, mondayMorningIst), null);
});
