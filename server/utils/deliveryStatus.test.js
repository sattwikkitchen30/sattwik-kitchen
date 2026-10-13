const test = require('node:test');
const assert = require('node:assert/strict');
const { isTiffinPreparationEligible, resolveDeliveryStatus, filterTiffinPreparationSubscriptions, getCurrentServiceDate } = require('./deliveryStatus');
const { getSubscriptionServiceDates, formatDateKey, isServiceDay, parseDateInput } = require('./tiffinPreparation');

const monday = new Date('2026-10-12T19:00:00Z');

function makeOrder(status, overrides = {}) {
  return {
    type: 'tiffin',
    status,
    subscriptionStartDate: parseDateInput('2026-10-12'),
    subscriptionEndDate: parseDateInput('2026-11-06'),
    deliveryStatusDate: parseDateInput('2026-10-12'),
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
  const nextServiceDay = new Date('2026-10-13T12:00:00-07:00');

  assert.equal(resolveDeliveryStatus(delivery, nextServiceDay), 'DELIVERED');
});

test('Delivered remains eligible on its active date and resets to Accepted on a later service day', () => {
  const delivered = makeOrder('DELIVERED');
  const nextServiceDay = new Date('2026-10-13T12:00:00-07:00');

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
  assert.equal(isServiceDay(new Date('2026-10-12T19:00:00Z')), true);
  assert.equal(isServiceDay(new Date('2026-10-17T19:00:00Z')), false);
  assert.equal(isServiceDay(new Date('2026-10-18T19:00:00Z')), false);
  assert.equal(formatDateKey(dates.startDate), '2026-10-12');
  assert.equal(formatDateKey(dates.endDate), '2026-11-06');
});

test('business calendar treats weekdays as service days and keeps date-only values on the same day', () => {
  assert.equal(formatDateKey('2026-10-12'), '2026-10-12');
  assert.equal(formatDateKey(parseDateInput('2026-10-12')), '2026-10-12');
  assert.equal(isServiceDay('2026-10-12'), true);
  assert.equal(isServiceDay('2026-10-13'), true);
  assert.equal(isServiceDay('2026-10-16'), true);
  assert.equal(isServiceDay('2026-10-17'), false);
  assert.equal(isServiceDay('2026-10-18'), false);
  assert.equal(isServiceDay('2026-10-11'), false);
});

test('current service date is inclusive of start and end and uses Vancouver timezone', () => {
  const order = makeOrder('ACCEPTED');
  const mondayMorningVancouver = new Date('2026-10-12T15:00:00Z');
  const tuesday = new Date('2026-10-13T13:30:00Z');
  const friday = new Date('2026-10-16T13:30:00Z');
  const saturday = new Date('2026-10-17T13:30:00Z');
  const sunday = new Date('2026-10-18T13:30:00Z');

  assert.equal(formatDateKey(getCurrentServiceDate(order, mondayMorningVancouver)), '2026-10-12');
  assert.equal(formatDateKey(getCurrentServiceDate(order, tuesday)), '2026-10-13');
  assert.equal(formatDateKey(getCurrentServiceDate(order, friday)), '2026-10-16');
  assert.equal(getCurrentServiceDate(order, saturday), null);
  assert.equal(getCurrentServiceDate(order, sunday), null);

  const startsToday = makeOrder('ACCEPTED', {
    subscriptionStartDate: parseDateInput('2026-10-12'),
    subscriptionEndDate: parseDateInput('2026-11-06')
  });
  assert.equal(formatDateKey(getCurrentServiceDate(startsToday, mondayMorningVancouver)), '2026-10-12');

  const notStarted = makeOrder('ACCEPTED', { subscriptionStartDate: parseDateInput('2026-10-13') });
  assert.equal(getCurrentServiceDate(notStarted, mondayMorningVancouver), null);

  const endsToday = makeOrder('ACCEPTED', {
    subscriptionStartDate: parseDateInput('2026-09-15'),
    subscriptionEndDate: parseDateInput('2026-10-12')
  });
  assert.equal(formatDateKey(getCurrentServiceDate(endsToday, mondayMorningVancouver)), '2026-10-12');

  const expired = makeOrder('ACCEPTED', {
    subscriptionStartDate: parseDateInput('2026-09-01'),
    subscriptionEndDate: parseDateInput('2026-10-09')
  });
  assert.equal(getCurrentServiceDate(expired, mondayMorningVancouver), null);
});
