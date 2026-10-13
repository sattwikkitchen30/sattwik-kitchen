const test = require('node:test');
const assert = require('node:assert/strict');
const { buildDefaultTiffinItems } = require('./tiffinItems');
const { buildPreparationTotals, buildActivePlanCounts, getSubscriptionServiceDates, formatDateKey } = require('./tiffinPreparation');

function itemQuantity(items, preparationType) {
  return items.find((item) => item.preparationType === preparationType)?.quantity || 0;
}

test('Couple and Family full meal defaults produce the required mixed totals', () => {
  const subscriptions = [
    { packageType: 'full', size: 'couple', quantity: 1 },
    { packageType: 'full', size: 'family', quantity: 1 }
  ];
  const defaults = buildDefaultTiffinItems(subscriptions);
  const totals = buildPreparationTotals(subscriptions);

  assert.equal(itemQuantity(defaults, 'mediumDal'), 1);
  assert.equal(itemQuantity(defaults, 'largeDal'), 1);
  assert.equal(itemQuantity(defaults, 'mediumCurry'), 1);
  assert.equal(itemQuantity(defaults, 'largeCurry'), 1);
  assert.equal(totals.smallCurd, 1);
  assert.equal(totals.bigCurd, 1);
  assert.equal(totals.riceBoxes, 2);
  assert.equal(totals.chapathiCount, 10);
});

test('multiple plans linked to one permanent order contribute once per plan entry', () => {
  const order = {
    _id: 'permanent-order',
    tiffinItemsCustomized: false,
    tiffinItems: buildDefaultTiffinItems([
      { packageType: 'full', size: 'couple', quantity: 1 },
      { packageType: 'full', size: 'family', quantity: 1 }
    ])
  };
  const subscriptions = [
    { packageType: 'full', size: 'couple', quantity: 1, orderId: order },
    { packageType: 'full', size: 'family', quantity: 1, orderId: order }
  ];
  const totals = buildPreparationTotals(subscriptions);

  assert.equal(totals.mediumDal, 1);
  assert.equal(totals.largeDal, 1);
  assert.equal(totals.mediumCurries, 1);
  assert.equal(totals.largeCurries, 1);
  assert.equal(totals.smallCurd, 1);
  assert.equal(totals.bigCurd, 1);
  assert.equal(totals.riceBoxes, 2);
  assert.equal(totals.chapathiCount, 10);
});

test('Curry-only plans do not contribute rice, chapati, or curd', () => {
  const totals = buildPreparationTotals([
    { packageType: 'curry-only', size: 'single', quantity: 1 },
    { packageType: 'curry-only', size: 'couple', quantity: 1 },
    { packageType: 'curry-only', size: 'family', quantity: 1 }
  ]);

  assert.equal(totals.riceBoxes, 0);
  assert.equal(totals.chapathiCount, 0);
  assert.equal(totals.smallCurd, 0);
  assert.equal(totals.bigCurd, 0);
});

test('saved customized items override defaults and are counted once for a multi-plan order', () => {
  const order = {
    _id: 'order-1',
    tiffinItemsCustomized: true,
    tiffinItems: [{ productName: 'Big Curd', preparationType: 'bigCurd', quantity: 3 }]
  };
  const subscriptions = [
    { packageType: 'full', size: 'couple', quantity: 1, orderId: order },
    { packageType: 'full', size: 'family', quantity: 1, orderId: order }
  ];
  const totals = buildPreparationTotals(subscriptions);
  const planCounts = buildActivePlanCounts(subscriptions);

  assert.equal(totals.smallCurd, 0);
  assert.equal(totals.bigCurd, 3);
  assert.equal(totals.riceBoxes, 0);
  assert.equal(planCounts.full.couple, 1);
  assert.equal(planCounts.full.family, 1);
});

test('refresh-style recalculation is deterministic and does not accumulate totals', () => {
  const subscriptions = [{ packageType: 'full', size: 'couple', quantity: 2 }];

  assert.deepEqual(buildPreparationTotals(subscriptions), buildPreparationTotals(subscriptions));
  assert.equal(buildPreparationTotals(subscriptions).smallCurd, 2);
});

test('subscription service date calculation: start Sunday 2026-10-11 ends Friday 2026-11-06', () => {
  const result = getSubscriptionServiceDates('2026-10-11');
  assert.equal(formatDateKey(result.startDate), '2026-10-11');
  assert.equal(formatDateKey(result.endDate), '2026-11-06');
  assert.equal(result.serviceDates.length, 20);
  
  // Verify no weekends are included
  const weekdays = result.serviceDates.map((d) => new Date(d).getDay());
  assert.ok(!weekdays.includes(0), 'No Sundays');
  assert.ok(!weekdays.includes(6), 'No Saturdays');
  
  // Verify first service day is Monday (12 Oct)
  assert.equal(formatDateKey(result.serviceDates[0]), '2026-10-12');
  
  // Verify last service day is Friday (6 Nov)
  assert.equal(formatDateKey(result.serviceDates[19]), '2026-11-06');
});

test('subscription service date calculation: start Monday 2026-10-12 ends Friday 2026-11-06', () => {
  const result = getSubscriptionServiceDates('2026-10-12');
  assert.equal(formatDateKey(result.startDate), '2026-10-12');
  assert.equal(formatDateKey(result.endDate), '2026-11-06');
  assert.equal(result.serviceDates.length, 20);
  
  // Verify first service day is the start date (Monday)
  assert.equal(formatDateKey(result.serviceDates[0]), '2026-10-12');
  
  // Verify last service day is Friday
  assert.equal(formatDateKey(result.serviceDates[19]), '2026-11-06');
});

test('subscription service date calculation: start Friday 2026-10-09 ends Thursday 2026-11-05', () => {
  const result = getSubscriptionServiceDates('2026-10-09');
  assert.equal(formatDateKey(result.startDate), '2026-10-09');
  assert.equal(formatDateKey(result.endDate), '2026-11-05');
  assert.equal(result.serviceDates.length, 20);
  
  // Verify first service day is the start date (Friday)
  assert.equal(formatDateKey(result.serviceDates[0]), '2026-10-09');
  
  // Verify last service day is Thursday
  assert.equal(formatDateKey(result.serviceDates[19]), '2026-11-05');
});

test('subscription service date calculation: start Saturday 2026-10-10 ends Friday 2026-11-06', () => {
  const result = getSubscriptionServiceDates('2026-10-10');
  assert.equal(formatDateKey(result.startDate), '2026-10-10');
  assert.equal(formatDateKey(result.endDate), '2026-11-06');
  assert.equal(result.serviceDates.length, 20);
  
  // Verify first service day is Monday (next day after Saturday)
  assert.equal(formatDateKey(result.serviceDates[0]), '2026-10-12');
  
  // Verify last service day is Friday
  assert.equal(formatDateKey(result.serviceDates[19]), '2026-11-06');
});

test('subscription service date calculation: exactly 20 weekdays counted', () => {
  const result = getSubscriptionServiceDates('2026-10-12');
  assert.equal(result.serviceDates.length, 20);
  
  // Count weekdays
  const weekdays = result.serviceDates.map((d) => new Date(d).getDay());
  const weekdayCount = weekdays.filter((d) => d >= 1 && d <= 5).length;
  assert.equal(weekdayCount, 20);
});

test('subscription service date calculation: no Saturday or Sunday counted', () => {
  const result = getSubscriptionServiceDates('2026-10-12');
  const weekdays = result.serviceDates.map((d) => new Date(d).getDay());
  
  // Check for Saturday (6) and Sunday (0)
  assert.ok(!weekdays.includes(0), 'No Sundays included');
  assert.ok(!weekdays.includes(6), 'No Saturdays included');
});

test('subscription service date calculation: DST transition handled correctly', () => {
  // Test around spring forward (second Sunday in March 2026)
  const result = getSubscriptionServiceDates('2026-03-09');
  assert.equal(result.serviceDates.length, 20);
  assert.ok(result.endDate);
  
  // Verify the dates are valid
  result.serviceDates.forEach((date) => {
    assert.ok(!isNaN(date.getTime()), `Invalid date: ${date}`);
  });
});

test('subscription service date calculation: explicit end date preserved if matches calculated', () => {
  const calculated = getSubscriptionServiceDates('2026-10-12');
  const withExplicit = getSubscriptionServiceDates('2026-10-12', '2026-11-06');
  
  assert.equal(formatDateKey(calculated.endDate), formatDateKey(withExplicit.endDate));
});
