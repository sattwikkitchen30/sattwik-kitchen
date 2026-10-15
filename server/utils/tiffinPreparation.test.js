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

test('additional items on a curry-only order are counted with original components and not doubled', () => {
  const order = {
    _id: 'curry-only-extra',
    tiffinItemsCustomized: true,
    tiffinItems: [
      { productName: 'Small Dal', preparationType: 'smallDal', quantity: 1, isAdditional: false },
      { productName: 'Small Curry', preparationType: 'smallCurry', quantity: 1, isAdditional: false },
      { productName: 'Chapathi', preparationType: 'chapathi', quantity: 4, isAdditional: true },
      { productName: 'Rice Box', preparationType: 'riceBox', quantity: 1, isAdditional: true },
      { productName: 'Small Curd', preparationType: 'smallCurd', quantity: 1, isAdditional: true },
      { productName: 'Large Dal', preparationType: 'largeDal', quantity: 1, isAdditional: true }
    ]
  };
  const subscriptions = [{ packageType: 'curry-only', size: 'single', quantity: 1, orderId: order }];
  const totals = buildPreparationTotals(subscriptions);
  assert.equal(totals.smallDal, 1);
  assert.equal(totals.largeDal, 1);
  assert.equal(totals.smallCurries, 1);
  assert.equal(totals.chapathiCount, 4);
  assert.equal(totals.riceBoxes, 1);
  assert.equal(totals.smallCurd, 1);
  assert.deepEqual(buildPreparationTotals(subscriptions), buildPreparationTotals(subscriptions));
});

test('removing an additional item updates future preparation without leftover duplicates', () => {
  const order = {
    _id: 'curry-only-removed',
    tiffinItemsCustomized: true,
    tiffinItems: [
      { productName: 'Small Dal', preparationType: 'smallDal', quantity: 1, isAdditional: false },
      { productName: 'Small Curry', preparationType: 'smallCurry', quantity: 1, isAdditional: false },
      { productName: 'Chapathi', preparationType: 'chapathi', quantity: 2, isAdditional: true }
    ]
  };
  const totals = buildPreparationTotals([
    { packageType: 'curry-only', size: 'single', quantity: 1, orderId: order }
  ]);
  assert.equal(totals.chapathiCount, 2);
  assert.equal(totals.riceBoxes, 0);
  assert.equal(totals.smallDal, 1);
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

test('additional items lifecycle: add, edit quantity, remove, and verify other customers unaffected', () => {
  const otherCustomerOrder = {
    _id: 'cust-2-order',
    tiffinItemsCustomized: false,
    tiffinPlan: { packageType: 'full', size: 'couple' }
  };
  const otherCustomerSub = {
    packageType: 'full',
    size: 'couple',
    quantity: 1,
    orderId: otherCustomerOrder
  };

  // Step 1: Curry-only order with added items: Dal Large 1, Curry Medium 2, Curd Small 1, Chapati 4, Rice 1
  const editedOrder = {
    _id: 'cust-1-order',
    tiffinItemsCustomized: true,
    tiffinPlan: { packageType: 'curry-only', size: 'single' },
    tiffinItems: [
      { productName: 'Small Dal', preparationType: 'smallDal', quantity: 1, isAdditional: false },
      { productName: 'Small Curry', preparationType: 'smallCurry', quantity: 1, isAdditional: false },
      { productName: 'Large Dal', preparationType: 'largeDal', quantity: 1, isAdditional: true },
      { productName: 'Medium Curry', preparationType: 'mediumCurry', quantity: 2, isAdditional: true },
      { productName: 'Small Curd', preparationType: 'smallCurd', quantity: 1, isAdditional: true },
      { productName: 'Chapathi', preparationType: 'chapathi', quantity: 4, isAdditional: true },
      { productName: 'Rice Box', preparationType: 'riceBox', quantity: 1, isAdditional: true }
    ]
  };
  const editedSub = {
    packageType: 'curry-only',
    size: 'single',
    quantity: 1,
    orderId: editedOrder
  };

  const totals1 = buildPreparationTotals([editedSub, otherCustomerSub]);
  // Other customer provides: 1 mediumDal, 1 mediumCurry, 1 smallCurd, 4 chapati, 1 riceBox
  // Edited order provides: 1 smallDal, 1 smallCurry, 1 largeDal, 2 mediumCurry, 1 smallCurd, 4 chapati, 1 riceBox
  assert.equal(totals1.smallDal, 1);
  assert.equal(totals1.mediumDal, 1);
  assert.equal(totals1.largeDal, 1);
  assert.equal(totals1.smallCurries, 1);
  assert.equal(totals1.mediumCurries, 3); // 1 (other) + 2 (added)
  assert.equal(totals1.smallCurd, 2); // 1 (other) + 1 (added)
  assert.equal(totals1.chapathiCount, 8); // 4 (other) + 4 (added)
  assert.equal(totals1.riceBoxes, 2); // 1 (other) + 1 (added)

  // Step 2: Edit quantity (Chapati from 4 to 6, Curry from 2 to 3)
  editedOrder.tiffinItems = [
    { productName: 'Small Dal', preparationType: 'smallDal', quantity: 1, isAdditional: false },
    { productName: 'Small Curry', preparationType: 'smallCurry', quantity: 1, isAdditional: false },
    { productName: 'Large Dal', preparationType: 'largeDal', quantity: 1, isAdditional: true },
    { productName: 'Medium Curry', preparationType: 'mediumCurry', quantity: 3, isAdditional: true },
    { productName: 'Small Curd', preparationType: 'smallCurd', quantity: 1, isAdditional: true },
    { productName: 'Chapathi', preparationType: 'chapathi', quantity: 6, isAdditional: true },
    { productName: 'Rice Box', preparationType: 'riceBox', quantity: 1, isAdditional: true }
  ];
  const totals2 = buildPreparationTotals([editedSub, otherCustomerSub]);
  assert.equal(totals2.mediumCurries, 4); // 1 (other) + 3 (added)
  assert.equal(totals2.chapathiCount, 10); // 4 (other) + 6 (added)

  // Step 3: Remove Rice and Large Dal
  editedOrder.tiffinItems = [
    { productName: 'Small Dal', preparationType: 'smallDal', quantity: 1, isAdditional: false },
    { productName: 'Small Curry', preparationType: 'smallCurry', quantity: 1, isAdditional: false },
    { productName: 'Medium Curry', preparationType: 'mediumCurry', quantity: 3, isAdditional: true },
    { productName: 'Small Curd', preparationType: 'smallCurd', quantity: 1, isAdditional: true },
    { productName: 'Chapathi', preparationType: 'chapathi', quantity: 6, isAdditional: true }
  ];
  const totals3 = buildPreparationTotals([editedSub, otherCustomerSub]);
  assert.equal(totals3.largeDal, 0); // removed
  assert.equal(totals3.riceBoxes, 1); // only other customer's rice box remains

  // Step 4: Multi-save idempotency check
  assert.deepEqual(buildPreparationTotals([editedSub, otherCustomerSub]), totals3);
});

test('consolidated merged items and custom items reflect accurately in preparation totals', () => {
  const consolidatedOrder = {
    _id: 'order-consolidated',
    tiffinItemsCustomized: true,
    tiffinItems: [
      { productName: 'Medium Dal', preparationType: 'mediumDal', quantity: 5, originalQuantity: 2, additionalQuantity: 3 },
      { productName: 'Medium Curry', preparationType: 'mediumCurry', quantity: 3, originalQuantity: 1, additionalQuantity: 2 },
      { productName: 'Chapathi', preparationType: 'chapathi', quantity: 6, originalQuantity: 4, additionalQuantity: 2 },
      { productName: 'Big Curd', preparationType: 'bigCurd', quantity: 2, originalQuantity: 1, additionalQuantity: 1 },
      { productName: 'Large Dal', preparationType: 'largeDal', quantity: 1, originalQuantity: 0, additionalQuantity: 1 },
      { productName: 'Mango Chutney', preparationType: 'mango_chutney', quantity: 2, originalQuantity: 0, additionalQuantity: 2 }
    ]
  };

  const sub = { packageType: 'full', size: 'couple', quantity: 1, orderId: consolidatedOrder };
  const totals = buildPreparationTotals([sub]);

  assert.equal(totals.mediumDal, 5);
  assert.equal(totals.mediumCurries, 3);
  assert.equal(totals.chapathiCount, 6);
  assert.equal(totals.bigCurd, 2);
  assert.equal(totals.largeDal, 1);
  assert.deepEqual(totals.otherItems, [{ item: 'Mango Chutney', count: 2 }]);

  // Repeated calculation idempotency
  assert.deepEqual(buildPreparationTotals([sub]), totals);

  // Removing additional quantity on Medium Dal (5 -> 2)
  consolidatedOrder.tiffinItems[0].quantity = 2;
  consolidatedOrder.tiffinItems[0].additionalQuantity = 0;
  const updatedTotals = buildPreparationTotals([sub]);
  assert.equal(updatedTotals.mediumDal, 2);
  assert.equal(updatedTotals.mediumCurries, 3);
});

