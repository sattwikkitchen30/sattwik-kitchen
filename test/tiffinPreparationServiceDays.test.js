const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const {
  isServiceDay,
  getWeekdayName,
  getMenuForDate,
  getSubscriptionServiceDates,
  formatDateKey,
  startOfDay,
  endOfDay,
  BUSINESS_TIMEZONE
} = require('../server/utils/tiffinPreparation');

// Browser mocks for admin.js
global.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
global.window = { location: { href: '', pathname: '', search: '' }, addEventListener: () => {} };
global.document = {
  getElementById: () => ({ addEventListener: () => {}, querySelectorAll: () => [], classList: { add: () => {}, remove: () => {} } }),
  createElement: () => ({ addEventListener: () => {}, appendChild: () => {} }),
  querySelectorAll: () => [],
  querySelector: () => null,
  addEventListener: () => {}
};

const { shiftDateKey } = require('../admin/admin');
const { isTiffinPreparationEligible } = require('../server/utils/deliveryStatus');

// Models for controller testing
const TiffinSubscription = require('../server/models/TiffinSubscription');
const TiffinMenuSelection = require('../server/models/TiffinMenuSelection');

// ── 1. Service Days and Weekend Verification ────────────────────────────────
test('isServiceDay identifies Monday-Friday as service days and Saturday-Sunday as non-service days', () => {
  // October 2026:
  // Oct 16: Friday (service)
  // Oct 17: Saturday (no service)
  // Oct 18: Sunday (no service)
  // Oct 19: Monday (service)
  // Oct 20: Tuesday (service)
  // Oct 21: Wednesday (service)
  // Oct 22: Thursday (service)
  // Oct 23: Friday (service)
  assert.equal(isServiceDay('2026-10-16'), true, 'Friday Oct 16 is a service day');
  assert.equal(isServiceDay('2026-10-17'), false, 'Saturday Oct 17 is NOT a service day');
  assert.equal(isServiceDay('2026-10-18'), false, 'Sunday Oct 18 is NOT a service day');
  assert.equal(isServiceDay('2026-10-19'), true, 'Monday Oct 19 is a service day');
  assert.equal(isServiceDay('2026-10-20'), true, 'Tuesday Oct 20 is a service day');
  assert.equal(isServiceDay('2026-10-21'), true, 'Wednesday Oct 21 is a service day');
  assert.equal(isServiceDay('2026-10-22'), true, 'Thursday Oct 22 is a service day');
  assert.equal(isServiceDay('2026-10-23'), true, 'Friday Oct 23 is a service day');

  assert.equal(getWeekdayName('2026-10-17'), 'Saturday');
  assert.equal(getWeekdayName('2026-10-18'), 'Sunday');
  assert.equal(getWeekdayName('2026-10-19'), 'Monday');
  assert.equal(getWeekdayName('2026-10-20'), 'Tuesday');
});

// ── 2. Timezone Boundaries (America/Vancouver) ──────────────────────────────
test('America/Vancouver timezone: dates do not shift backwards or forwards across days', () => {
  // A string like '2026-10-17' must remain Saturday, October 17
  assert.equal(formatDateKey('2026-10-17'), '2026-10-17');
  assert.equal(getWeekdayName('2026-10-17'), 'Saturday');

  // Even ISO strings without timezone offsets must be interpreted in Vancouver
  assert.equal(getWeekdayName('2026-10-17T12:00:00'), 'Saturday');
  assert.equal(getWeekdayName('2026-10-19T12:00:00'), 'Monday');

  // Start and end of day in Vancouver
  const startSat = startOfDay('2026-10-17');
  const endSat = endOfDay('2026-10-17');
  // Oct 17 PDT (UTC-7): startOfDay is 00:00 PDT = 07:00 UTC; endOfDay is 23:59:59.999 PDT = next day 06:59:59.999 UTC
  assert.equal(startSat.toISOString(), '2026-10-17T07:00:00.000Z');
  assert.equal(endSat.toISOString(), '2026-10-18T06:59:59.999Z');
});

// ── 3. Menu Availability by Weekday ─────────────────────────────────────────
test('getMenuForDate returns valid menus for weekdays and null for weekends', () => {
  assert.equal(getMenuForDate('2026-10-17'), null, 'Saturday has no menu');
  assert.equal(getMenuForDate('2026-10-18'), null, 'Sunday has no menu');

  const mondayMenu = getMenuForDate('2026-10-19');
  assert.ok(mondayMenu, 'Monday must have a menu');
  assert.deepEqual(mondayMenu.dalOptions, ['Palak Dal', 'Ridge Gourd Dal']);
  assert.deepEqual(mondayMenu.curryOptions, ['Brinjal Masala', 'Cauliflower Curry']);

  const tuesdayMenu = getMenuForDate('2026-10-20');
  assert.ok(tuesdayMenu, 'Tuesday must have a menu');
  assert.deepEqual(tuesdayMenu.dalOptions, ['Tomato Dal', 'Kale Dal']);
  assert.deepEqual(tuesdayMenu.curryOptions, ['Cabbage Chutney', 'Capsicum Masala']);

  // Distinct menus per day
  assert.notDeepEqual(mondayMenu.dalOptions, tuesdayMenu.dalOptions);
});

// ── 4. Subscription Schedule & 20 Service-Day Calculation ───────────────────
test('getSubscriptionServiceDates calculates exactly 20 Monday-Friday days excluding weekends', () => {
  const schedule = getSubscriptionServiceDates('2026-10-16'); // starts Friday Oct 16
  assert.equal(schedule.serviceDates.length, 20, 'Must have exactly 20 service days');

  const dateKeys = schedule.serviceDates.map(formatDateKey);
  assert.equal(dateKeys[0], '2026-10-16', 'Day 1 is Friday Oct 16');
  // Day 2 must be Monday Oct 19 (skipping Sat Oct 17 and Sun Oct 18)
  assert.equal(dateKeys[1], '2026-10-19', 'Day 2 is Monday Oct 19');
  assert.equal(dateKeys[2], '2026-10-20', 'Day 3 is Tuesday Oct 20');
  assert.ok(!dateKeys.includes('2026-10-17'), 'Saturday Oct 17 must NOT be in schedule');
  assert.ok(!dateKeys.includes('2026-10-18'), 'Sunday Oct 18 must NOT be in schedule');

  // Verify all 20 days are Monday-Friday
  for (const d of schedule.serviceDates) {
    assert.equal(isServiceDay(d), true, `Service date ${formatDateKey(d)} must be a service day`);
  }

  // Day 20 is Thursday Nov 12, 2026 (1 day in W1 + 5 in W2 + 5 in W3 + 5 in W4 + 4 in W5)
  assert.equal(formatDateKey(schedule.endDate), '2026-11-12', 'Day 20 is Thursday Nov 12');
});

// ── 5. isTiffinPreparationEligible on Weekends vs Service Days ───────────────
test('isTiffinPreparationEligible: order is never eligible on weekends, only on its scheduled service dates', () => {
  const schedule = getSubscriptionServiceDates('2026-10-16');
  const mockOrder = {
    type: 'tiffin',
    status: 'ACCEPTED',
    subscriptionStartDate: schedule.startDate,
    subscriptionEndDate: schedule.endDate,
    items: [{ fulfillment: 'delivery', deliveryStatus: 'ACCEPTED' }]
  };

  // On Saturday Oct 17: NOT eligible
  assert.equal(isTiffinPreparationEligible(mockOrder, '2026-10-17'), false, 'Cannot be eligible on Saturday');
  // On Sunday Oct 18: NOT eligible
  assert.equal(isTiffinPreparationEligible(mockOrder, '2026-10-18'), false, 'Cannot be eligible on Sunday');
  // On Friday Oct 16: eligible
  assert.equal(isTiffinPreparationEligible(mockOrder, '2026-10-16'), true, 'Eligible on Friday Oct 16');
  // On Monday Oct 19: eligible
  assert.equal(isTiffinPreparationEligible(mockOrder, '2026-10-19'), true, 'Eligible on Monday Oct 19');
  // On Tuesday Oct 20: eligible
  assert.equal(isTiffinPreparationEligible(mockOrder, '2026-10-20'), true, 'Eligible on Tuesday Oct 20');
});

// ── 6. Backend tiffinPreparation Controller: October 17–20 ──────────────────
test('tiffinPreparation controller: Saturday/Sunday return no service; Monday/Tuesday return menu and counts', async () => {
  const origSubFind = TiffinSubscription.find;
  const origMenuFindOne = TiffinMenuSelection.findOne;
  const origSubUpdateMany = TiffinSubscription.updateMany;

  TiffinSubscription.updateMany = async () => ({ modifiedCount: 0 });
  TiffinMenuSelection.findOne = () => ({ lean: async () => null });

  // Mock an active couple full meal subscription starting Oct 19
  const fakeOrderId = new mongoose.Types.ObjectId();
  const schedule = getSubscriptionServiceDates('2026-10-19');
  const mockSubscription = {
    packageType: 'full',
    size: 'couple',
    quantity: 1,
    startDate: schedule.startDate,
    endDate: schedule.endDate,
    status: 'ACTIVE',
    orderId: {
      _id: fakeOrderId,
      type: 'tiffin',
      status: 'ACCEPTED',
      subscriptionStartDate: schedule.startDate,
      subscriptionEndDate: schedule.endDate,
      tiffinPlan: { packageType: 'full', size: 'couple' },
      items: [{ fulfillment: 'delivery', deliveryStatus: 'ACCEPTED' }]
    }
  };

  TiffinSubscription.find = () => ({
    populate: () => ({
      lean: async () => [mockSubscription]
    })
  });

  delete require.cache[require.resolve('../server/controllers/analyticsController')];
  const { tiffinPreparation } = require('../server/controllers/analyticsController');

  try {
    // 1. Test Saturday, October 17
    let satResult = null;
    await tiffinPreparation({
      query: { date: '2026-10-17' }
    }, {
      set() {},
      json(data) { satResult = data; }
    });

    assert.equal(satResult.selectedDate, '2026-10-17');
    assert.equal(satResult.weekday, 'Saturday');
    assert.equal(satResult.serviceExists, false);
    assert.equal(satResult.message, 'No tiffin service on this day.');
    assert.equal(satResult.menu, null);
    assert.equal(satResult.activePlanCounts.full.couple, 0);
    assert.equal(satResult.totals.mediumDal, 0);

    // 2. Test Sunday, October 18
    let sunResult = null;
    await tiffinPreparation({
      query: { date: '2026-10-18' }
    }, {
      set() {},
      json(data) { sunResult = data; }
    });

    assert.equal(sunResult.selectedDate, '2026-10-18');
    assert.equal(sunResult.weekday, 'Sunday');
    assert.equal(sunResult.serviceExists, false);
    assert.equal(sunResult.message, 'No tiffin service on this day.');
    assert.equal(sunResult.menu, null);

    // 3. Test Monday, October 19
    let monResult = null;
    await tiffinPreparation({
      query: { date: '2026-10-19' }
    }, {
      set() {},
      json(data) { monResult = data; }
    });

    assert.equal(monResult.selectedDate, '2026-10-19');
    assert.equal(monResult.weekday, 'Monday');
    assert.equal(monResult.serviceExists, true);
    assert.equal(monResult.message, '');
    assert.ok(monResult.menu, 'Must include Monday menu');
    assert.deepEqual(monResult.menu.dalOptions, ['Palak Dal', 'Ridge Gourd Dal']);
    assert.equal(monResult.activePlanCounts.full.couple, 1, 'Couple full meal counted on Monday');
    assert.equal(monResult.totals.mediumDal, 1, 'Medium dal counted for Couple full meal');

    // 4. Test Tuesday, October 20
    let tueResult = null;
    await tiffinPreparation({
      query: { date: '2026-10-20' }
    }, {
      set() {},
      json(data) { tueResult = data; }
    });

    assert.equal(tueResult.selectedDate, '2026-10-20');
    assert.equal(tueResult.weekday, 'Tuesday');
    assert.equal(tueResult.serviceExists, true);
    assert.equal(tueResult.message, '');
    assert.ok(tueResult.menu, 'Must include Tuesday menu');
    assert.deepEqual(tueResult.menu.dalOptions, ['Tomato Dal', 'Kale Dal']);
    assert.equal(tueResult.activePlanCounts.full.couple, 1, 'Couple full meal counted on Tuesday');
  } finally {
    TiffinSubscription.find = origSubFind;
    TiffinMenuSelection.findOne = origMenuFindOne;
    TiffinSubscription.updateMany = origSubUpdateMany;
  }
});

// ── 7. Date Navigation Around Weekends (shiftDateKey) ───────────────────────
test('shiftDateKey navigates cleanly around weekends without timezone offsets', () => {
  // Friday -> Saturday -> Sunday -> Monday
  assert.equal(shiftDateKey('2026-10-16', 1), '2026-10-17');
  assert.equal(shiftDateKey('2026-10-17', 1), '2026-10-18');
  assert.equal(shiftDateKey('2026-10-18', 1), '2026-10-19');
  assert.equal(shiftDateKey('2026-10-19', 1), '2026-10-20');

  // Monday -> Sunday -> Saturday -> Friday
  assert.equal(shiftDateKey('2026-10-20', -1), '2026-10-19');
  assert.equal(shiftDateKey('2026-10-19', -1), '2026-10-18');
  assert.equal(shiftDateKey('2026-10-18', -1), '2026-10-17');
  assert.equal(shiftDateKey('2026-10-17', -1), '2026-10-16');

  // Month boundary navigation
  assert.equal(shiftDateKey('2026-10-31', 1), '2026-11-01');
  assert.equal(shiftDateKey('2026-11-01', -1), '2026-10-31');
});
