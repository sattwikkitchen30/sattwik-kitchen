const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const {
  buildPreparationTotals,
  buildActivePlanCounts,
  getSubscriptionServiceDates,
  formatDateKey
} = require('../server/utils/tiffinPreparation');
const {
  isTiffinPreparationEligible,
  filterTiffinPreparationSubscriptions
} = require('../server/utils/deliveryStatus');

const Order = require('../server/models/Order');
const TiffinSubscription = require('../server/models/TiffinSubscription');
const TiffinMenuSelection = require('../server/models/TiffinMenuSelection');

// ── 1. Preparation item mapping for standalone items ─────────────────────────
test('buildPreparationTotals correctly maps standalone delivery items (Large Curry, etc.)', () => {
  const mockOrderLargeCurry = {
    _id: new mongoose.Types.ObjectId(),
    orderId: '26101600004',
    fulfillment: 'delivery',
    type: 'tiffin',
    status: 'ACCEPTED',
    subscriptionStartDate: new Date('2026-10-16T12:00:00Z'),
    subscriptionEndDate: new Date('2026-11-12T12:00:00Z'),
    items: [
      {
        productName: 'Large Curry',
        category: 'Tiffin Preparation',
        fulfillment: 'delivery',
        deliveryStatus: 'ACCEPTED',
        quantity: 1
      }
    ],
    tiffinItems: [
      {
        productName: 'Large Curry',
        category: 'Tiffin Preparation',
        preparationType: 'largeCurry',
        quantity: 1,
        isAdditional: false,
        itemKey: 'curry',
        size: 'large'
      }
    ]
  };

  const totals = buildPreparationTotals([mockOrderLargeCurry]);
  assert.equal(totals.largeCurries, 1, 'Large curry count must be 1');
  assert.equal(totals.mediumCurries, 0);
  assert.equal(totals.smallCurries, 0);
  assert.equal(totals.mediumDal, 0);
  assert.equal(totals.riceBoxes, 0);
  assert.equal(totals.chapathiCount, 0);
  assert.equal(totals.smallCurd, 0);
});

test('buildPreparationTotals maps all standard sizes of Dal, Curry, Curd, Rice, and Chapathi', () => {
  const itemsToTest = [
    { productName: 'Small Dal', preparationType: 'smallDal', quantity: 2, expectedKey: 'smallDal', expectedVal: 2 },
    { productName: 'Medium Dal', preparationType: 'mediumDal', quantity: 1, expectedKey: 'mediumDal', expectedVal: 1 },
    { productName: 'Large Dal', preparationType: 'largeDal', quantity: 3, expectedKey: 'largeDal', expectedVal: 3 },
    { productName: 'Small Curry', preparationType: 'smallCurry', quantity: 1, expectedKey: 'smallCurries', expectedVal: 1 },
    { productName: 'Medium Curry', preparationType: 'mediumCurry', quantity: 2, expectedKey: 'mediumCurries', expectedVal: 2 },
    { productName: 'Large Curry', preparationType: 'largeCurry', quantity: 1, expectedKey: 'largeCurries', expectedVal: 1 },
    { productName: 'Small Curd', preparationType: 'smallCurd', quantity: 1, expectedKey: 'smallCurd', expectedVal: 1 },
    { productName: 'Big Curd', preparationType: 'bigCurd', quantity: 2, expectedKey: 'bigCurd', expectedVal: 2 },
    { productName: 'Rice Box', preparationType: 'riceBox', quantity: 3, expectedKey: 'riceBoxes', expectedVal: 3 },
    { productName: 'Chapathi', preparationType: 'chapathi', quantity: 8, expectedKey: 'chapathiCount', expectedVal: 8 }
  ];

  const mockOrder = {
    _id: new mongoose.Types.ObjectId(),
    orderId: 'MULTI_TEST',
    fulfillment: 'delivery',
    status: 'ACCEPTED',
    tiffinItems: itemsToTest.map(i => ({
      productName: i.productName,
      preparationType: i.preparationType,
      quantity: i.quantity
    }))
  };

  const totals = buildPreparationTotals([mockOrder]);
  for (const item of itemsToTest) {
    assert.equal(totals[item.expectedKey], item.expectedVal, `${item.expectedKey} must match expected quantity ${item.expectedVal}`);
  }
});

// ── 2. Schedule eligibility: Mon-Fri only, exclude weekends ─────────────────
test('isTiffinPreparationEligible counts delivery order on 20 service days and excludes weekends', () => {
  const schedule = getSubscriptionServiceDates('2026-10-16');
  const mockOrder = {
    orderId: '26101600004',
    type: 'tiffin',
    fulfillment: 'delivery',
    status: 'ACCEPTED',
    subscriptionStartDate: schedule.startDate,
    subscriptionEndDate: schedule.endDate,
    items: [{ fulfillment: 'delivery', deliveryStatus: 'ACCEPTED', quantity: 1 }]
  };

  // Friday Oct 16: Eligible
  assert.equal(isTiffinPreparationEligible(mockOrder, '2026-10-16'), true);
  // Saturday Oct 17: NOT eligible (weekend)
  assert.equal(isTiffinPreparationEligible(mockOrder, '2026-10-17'), false);
  // Sunday Oct 18: NOT eligible (weekend)
  assert.equal(isTiffinPreparationEligible(mockOrder, '2026-10-18'), false);
  // Monday Oct 19: Eligible
  assert.equal(isTiffinPreparationEligible(mockOrder, '2026-10-19'), true);
  // Thursday Nov 12 (20th service day): Eligible
  assert.equal(isTiffinPreparationEligible(mockOrder, '2026-11-12'), true);
  // Friday Nov 13 (after end date): NOT eligible
  assert.equal(isTiffinPreparationEligible(mockOrder, '2026-11-13'), false);
});

// ── 3. Exclusion of pickup-only orders and cancelled orders ─────────────────
test('isTiffinPreparationEligible excludes pickup-only orders and cancelled orders', () => {
  const schedule = getSubscriptionServiceDates('2026-10-16');

  const pickupOrder = {
    orderId: 'PICKUP_ONLY',
    type: 'product',
    fulfillment: 'pickup',
    status: 'ACCEPTED',
    subscriptionStartDate: schedule.startDate,
    subscriptionEndDate: schedule.endDate,
    items: [{ fulfillment: 'pickup', deliveryStatus: null, quantity: 1 }]
  };
  assert.equal(isTiffinPreparationEligible(pickupOrder, '2026-10-16'), false, 'Pickup order must not be eligible');

  const cancelledOrder = {
    orderId: 'CANCELLED_ORDER',
    type: 'tiffin',
    fulfillment: 'delivery',
    status: 'CANCELLED',
    subscriptionStartDate: schedule.startDate,
    subscriptionEndDate: schedule.endDate,
    items: [{ fulfillment: 'delivery', deliveryStatus: 'CANCELLED', quantity: 1 }]
  };
  assert.equal(isTiffinPreparationEligible(cancelledOrder, '2026-10-16'), false, 'Cancelled order must not be eligible');
});

// ── 4. Combined package and standalone delivery items without double counting ──
test('buildPreparationTotals combines package items and additional items accurately', () => {
  const orderId = new mongoose.Types.ObjectId();
  const mockOrderWithPackageAndExtra = {
    _id: orderId,
    orderId: 'PKG_AND_EXTRA',
    fulfillment: 'delivery',
    type: 'tiffin',
    status: 'ACCEPTED',
    tiffinPlan: { packageType: 'full', size: 'couple' },
    tiffinItems: [
      { productName: 'Medium Dal', preparationType: 'mediumDal', quantity: 1, isAdditional: false },
      { productName: 'Medium Curry', preparationType: 'mediumCurry', quantity: 1, isAdditional: false },
      { productName: 'Chapathi', preparationType: 'chapathi', quantity: 4, isAdditional: false },
      { productName: 'Rice Box', preparationType: 'riceBox', quantity: 1, isAdditional: false },
      { productName: 'Small Curd', preparationType: 'smallCurd', quantity: 1, isAdditional: false },
      { productName: 'Large Curry', preparationType: 'largeCurry', quantity: 1, isAdditional: true }
    ]
  };

  const totals = buildPreparationTotals([mockOrderWithPackageAndExtra]);
  assert.equal(totals.mediumDal, 1);
  assert.equal(totals.mediumCurries, 1);
  assert.equal(totals.largeCurries, 1, 'Extra Large Curry must be included');
  assert.equal(totals.chapathiCount, 4);
  assert.equal(totals.riceBoxes, 1);
  assert.equal(totals.smallCurd, 1);

  // Deduplication: passing the same order twice should not double counts
  const dedupedTotals = buildPreparationTotals([mockOrderWithPackageAndExtra, mockOrderWithPackageAndExtra]);
  assert.equal(dedupedTotals.largeCurries, 1);
  assert.equal(dedupedTotals.mediumCurries, 1);
});

// ── 5. Controller test: direct orders merged with subscriptions ───────────────
test('tiffinPreparation controller includes direct delivery order items in daily counts', async () => {
  const origSubFind = TiffinSubscription.find;
  const origOrderFind = Order.find;
  const origMenuFindOne = TiffinMenuSelection.findOne;
  const origSubUpdateMany = TiffinSubscription.updateMany;

  TiffinSubscription.updateMany = async () => ({ modifiedCount: 0 });
  TiffinMenuSelection.findOne = () => ({ lean: async () => null });

  const schedule = getSubscriptionServiceDates('2026-10-16');

  // 1. Subscription-based order: Full Meal Couple
  const subOrderId = new mongoose.Types.ObjectId();
  const mockSubscription = {
    _id: new mongoose.Types.ObjectId(),
    packageType: 'full',
    size: 'couple',
    quantity: 1,
    startDate: schedule.startDate,
    endDate: schedule.endDate,
    status: 'ACTIVE',
    orderId: {
      _id: subOrderId,
      orderId: '26101500006',
      type: 'tiffin',
      fulfillment: 'delivery',
      status: 'ACCEPTED',
      subscriptionStartDate: schedule.startDate,
      subscriptionEndDate: schedule.endDate,
      tiffinPlan: { packageType: 'full', size: 'couple' },
      items: [{ fulfillment: 'delivery', deliveryStatus: 'ACCEPTED' }],
      tiffinItems: [
        { productName: 'Medium Dal', preparationType: 'mediumDal', quantity: 1 },
        { productName: 'Medium Curry', preparationType: 'mediumCurry', quantity: 1 },
        { productName: 'Chapathi', preparationType: 'chapathi', quantity: 4 },
        { productName: 'Rice Box', preparationType: 'riceBox', quantity: 1 },
        { productName: 'Small Curd', preparationType: 'smallCurd', quantity: 1 }
      ]
    }
  };

  // 2. Direct delivery order: Large Curry x 1 (no TiffinSubscription document)
  const directOrderId = new mongoose.Types.ObjectId();
  const mockDirectOrder = {
    _id: directOrderId,
    orderId: '26101600004',
    type: 'tiffin',
    fulfillment: 'delivery',
    status: 'ACCEPTED',
    subscriptionStartDate: schedule.startDate,
    subscriptionEndDate: schedule.endDate,
    items: [{ productName: 'Large Curry', fulfillment: 'delivery', deliveryStatus: 'ACCEPTED', quantity: 1 }],
    tiffinItems: [{ productName: 'Large Curry', preparationType: 'largeCurry', quantity: 1 }]
  };

  TiffinSubscription.find = () => ({
    populate: () => ({
      lean: async () => [mockSubscription]
    })
  });

  Order.find = () => ({
    lean: async () => [mockDirectOrder]
  });

  delete require.cache[require.resolve('../server/controllers/analyticsController')];
  const { tiffinPreparation } = require('../server/controllers/analyticsController');

  try {
    let result = null;
    await tiffinPreparation({
      query: { date: '2026-10-16' }
    }, {
      set() {},
      json(data) { result = data; }
    });

    assert.equal(result.serviceExists, true);
    assert.equal(result.selectedDate, '2026-10-16');
    assert.equal(result.weekday, 'Friday');

    // Daily Items must reflect BOTH the package components AND the standalone Large Curry
    assert.equal(result.totals.mediumDal, 1, 'Medium Dal from couple plan');
    assert.equal(result.totals.mediumCurries, 1, 'Medium Curry from couple plan');
    assert.equal(result.totals.largeCurries, 1, 'Large Curry from direct delivery order 26101600004 must be 1');
    assert.equal(result.totals.chapathiCount, 4);
    assert.equal(result.totals.riceBoxes, 1);
    assert.equal(result.totals.smallCurd, 1);

    // Active plans
    assert.equal(result.activePlanCounts.full.couple, 1);
  } finally {
    TiffinSubscription.find = origSubFind;
    Order.find = origOrderFind;
    TiffinMenuSelection.findOne = origMenuFindOne;
    TiffinSubscription.updateMany = origSubUpdateMany;
  }
});
