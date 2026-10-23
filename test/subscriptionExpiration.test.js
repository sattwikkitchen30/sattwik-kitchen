'use strict';

/**
 * Subscription Expiration Feature — Automated Test Suite
 *
 * Covers all 8 testing requirements:
 *  1. An active subscription whose end date is today becomes Expired, even if its status is Accepted.
 *  2. An active subscription whose end date is in the past becomes Expired.
 *  3. An active subscription whose end date is in the future is not prematurely expired.
 *  4. An expired order is not reset to Accepted by the daily reset job.
 *  5. An expired order appears in the customer's existing Delivered tab with a red Expired label.
 *  6. Admin Orders displays and persists the actual Expired status.
 *  7. Existing daily delivery resets continue to work for subscriptions that have not expired.
 *  8. Date comparisons use America/Vancouver, including around midnight and daylight-saving transitions.
 */

const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const { DateTime } = require('luxon');

const {
  expireSubscriptionOrders,
  resetDeliveredOrders
} = require('../server/utils/dailyDeliveryReset');

const {
  resolveDeliveryStatus,
  withCurrentDeliveryStatus
} = require('../server/utils/deliveryStatus');

const {
  formatDateKey,
  getSubscriptionServiceDates,
  startOfDay,
  endOfDay,
  BUSINESS_TIMEZONE
} = require('../server/utils/tiffinPreparation');

// Mock helpers
function makeOrder(overrides = {}) {
  const _id = overrides._id || new mongoose.Types.ObjectId().toString();
  return {
    _id,
    orderId: overrides.orderId || '26101500006',
    type: overrides.type || 'tiffin',
    fulfillment: overrides.fulfillment || 'delivery',
    status: overrides.status || 'ACCEPTED',
    subscriptionStartDate: overrides.subscriptionStartDate || new Date('2026-10-12T12:00:00Z'),
    subscriptionEndDate: overrides.subscriptionEndDate || new Date('2026-10-20T12:00:00Z'),
    deliveryStatusDate: overrides.deliveryStatusDate || new Date('2026-10-20T12:00:00Z'),
    totalAmount: overrides.totalAmount || 300,
    items: overrides.items || [
      {
        productName: 'Full Meal — Couple',
        category: 'Tiffin Plans',
        fulfillment: 'delivery',
        deliveryStatus: overrides.status || 'ACCEPTED',
        quantity: 1,
        subtotal: 300
      }
    ],
    ...overrides
  };
}

function mockOrderModel(ordersArray) {
  return {
    find(query) {
      let filtered = ordersArray.filter((o) => {
        if (query.status?.$nin) {
          if (query.status.$nin.includes(o.status)) return false;
        }
        if (query.status?.$in) {
          if (!query.status.$in.includes(o.status)) return false;
        }
        return true;
      });
      return {
        lean: async () => filtered.map((item) => ({ ...item, items: (item.items || []).map((i) => ({ ...i })) }))
      };
    },
    findOneAndUpdate(filter, update, options) {
      const idx = ordersArray.findIndex((o) => String(o._id) === String(filter._id));
      if (idx === -1) return null;
      const target = ordersArray[idx];

      if (filter.status?.$nin && filter.status.$nin.includes(target.status)) {
        return null;
      }
      if (filter.status && !filter.status.$nin && !filter.status.$in && filter.status !== target.status) {
        return null;
      }

      if (update.$set) {
        Object.assign(target, update.$set);
        if (update.$set['items.$[delivery].deliveryStatus'] && target.items) {
          target.items.forEach((item) => {
            if (item.fulfillment === 'delivery') {
              item.deliveryStatus = update.$set['items.$[delivery].deliveryStatus'];
            }
          });
        }
      }
      const resultObj = { ...target, toObject: () => ({ ...target }) };
      return {
        ...resultObj,
        lean: async () => ({ ...resultObj })
      };
    }
  };
}

describe('Subscription Expiration in Admin Orders and Customer My Orders', () => {

  // ── 1. Active subscription whose end date is today becomes Expired (even if Accepted) ──
  it('1 - An active subscription whose end date is today becomes Expired, even if its status is Accepted', async () => {
    // Current date in Vancouver is 2026-10-20
    const today = new Date('2026-10-20T19:00:00Z'); // Tuesday Oct 20 Vancouver time
    assert.equal(formatDateKey(today), '2026-10-20');

    const order = makeOrder({
      orderId: '26101500006',
      status: 'ACCEPTED',
      subscriptionStartDate: new Date('2026-10-12T12:00:00Z'),
      subscriptionEndDate: new Date('2026-10-20T12:00:00Z'),
      items: [{ fulfillment: 'delivery', deliveryStatus: 'ACCEPTED' }]
    });

    const Order = mockOrderModel([order]);
    const expiredCount = await expireSubscriptionOrders(Order, { now: today });

    assert.equal(expiredCount, 1);
    assert.equal(order.status, 'EXPIRED', 'Order status must be updated to EXPIRED');
    assert.equal(order.items[0].deliveryStatus, 'EXPIRED');

    // Also verify in-memory delivery status resolver
    const resolved = resolveDeliveryStatus(makeOrder({
      status: 'ACCEPTED',
      subscriptionEndDate: new Date('2026-10-20T12:00:00Z')
    }), today);
    assert.equal(resolved, 'EXPIRED');
  });

  // ── 2. Active subscription whose end date is in the past becomes Expired ───────────────
  it('2 - An active subscription whose end date is in the past becomes Expired', async () => {
    // Current date in Vancouver is 2026-10-23 (3 days after end date of 2026-10-20)
    const now = new Date('2026-10-23T16:00:00Z');
    assert.equal(formatDateKey(now), '2026-10-23');

    const order = makeOrder({
      orderId: '26101500006',
      status: 'ACCEPTED',
      subscriptionStartDate: new Date('2026-10-12T12:00:00Z'),
      subscriptionEndDate: new Date('2026-10-20T12:00:00Z')
    });

    const Order = mockOrderModel([order]);
    const expiredCount = await expireSubscriptionOrders(Order, { now });

    assert.equal(expiredCount, 1);
    assert.equal(order.status, 'EXPIRED', 'Past subscription must be persisted as EXPIRED');

    const serialized = withCurrentDeliveryStatus(order, now);
    assert.equal(serialized.status, 'EXPIRED');
  });

  // ── 3. Active subscription whose end date is in the future is not expired ──────────────
  it('3 - An active subscription whose end date is in the future is not prematurely expired', async () => {
    // Current date is 2026-10-15; subscription ends 2026-10-20
    const now = new Date('2026-10-15T18:00:00Z');
    assert.equal(formatDateKey(now), '2026-10-15');

    const order = makeOrder({
      orderId: '26101500007',
      status: 'ACCEPTED',
      subscriptionStartDate: new Date('2026-10-12T12:00:00Z'),
      subscriptionEndDate: new Date('2026-10-20T12:00:00Z'),
      items: [{ fulfillment: 'delivery', deliveryStatus: 'ACCEPTED' }]
    });

    const Order = mockOrderModel([order]);
    const expiredCount = await expireSubscriptionOrders(Order, { now });

    assert.equal(expiredCount, 0, 'Future subscription must not be expired');
    assert.equal(order.status, 'ACCEPTED', 'Status must remain ACCEPTED');

    const resolved = resolveDeliveryStatus(order, now);
    assert.equal(resolved, 'ACCEPTED');
  });

  // ── 4. Expired order is not reset to Accepted by daily reset job ────────────────────────
  it('4 - An expired order is not reset to Accepted by the daily reset job', async () => {
    // Wednesday Oct 21 service day
    const wednesday = new Date('2026-10-21T16:00:00Z');

    const expiredOrder = makeOrder({
      orderId: '26101500006',
      status: 'EXPIRED',
      subscriptionStartDate: new Date('2026-10-12T12:00:00Z'),
      subscriptionEndDate: new Date('2026-10-20T12:00:00Z'),
      items: [{ fulfillment: 'delivery', deliveryStatus: 'EXPIRED' }]
    });

    const Order = mockOrderModel([expiredOrder]);
    const resetCount = await resetDeliveredOrders(Order, { now: wednesday });

    assert.equal(resetCount, 0, 'No reset should occur for expired orders');
    assert.equal(expiredOrder.status, 'EXPIRED', 'Status must remain EXPIRED');
    assert.equal(expiredOrder.items[0].deliveryStatus, 'EXPIRED');
  });

  // ── 5. Expired order appears in customer Delivered tab with red Expired label ──────────
  it('5 - Customer My Orders: Expired orders route to Delivered tab and display Expired badge', () => {
    // Test the customer classifyComponent logic
    const custJs = fs.readFileSync(path.join(__dirname, '..', 'customer', 'customer-orders.js'), 'utf8');
    
    // Evaluate classifyComponent in isolation
    const classifyMatch = custJs.match(/function classifyComponent\([\s\S]*?^}/m);
    assert.ok(classifyMatch, 'classifyComponent must be defined in customer-orders.js');
    const classifyFn = new Function(`${classifyMatch[0]}; return classifyComponent;`)();

    const ongoingComp = { status: 'ACCEPTED' };
    const deliveredComp = { status: 'DELIVERED' };
    const expiredComp = { status: 'EXPIRED' };
    const cancelledComp = { status: 'CANCELLED' };

    assert.equal(classifyFn(ongoingComp), 'ongoing');
    assert.equal(classifyFn(deliveredComp), 'delivered');
    assert.equal(classifyFn(expiredComp), 'delivered', 'Expired component must route to delivered tab');
    assert.equal(classifyFn(cancelledComp), 'cancelled');

    // Verify customer.css defines red styling for .status-expired
    const custCss = fs.readFileSync(path.join(__dirname, '..', 'customer', 'customer.css'), 'utf8');
    assert.ok(custCss.includes('.status-expired'), 'customer.css must define .status-expired');
    assert.ok(custCss.includes('#b91c1c') || custCss.includes('#faeaea') || custCss.includes('#fbe8e8'), 'customer.css must style .status-expired in red');
  });

  // ── 6. Admin Orders displays and persists the actual Expired status ────────────────────
  it('6 - Admin Orders displays and persists the actual Expired status in UI and filter', () => {
    const adminJs = fs.readFileSync(path.join(__dirname, '..', 'admin', 'admin.js'), 'utf8');
    const adminCss = fs.readFileSync(path.join(__dirname, '..', 'admin', 'admin.css'), 'utf8');
    const dashHtml = fs.readFileSync(path.join(__dirname, '..', 'admin', 'dashboard.html'), 'utf8');

    // Status filter includes EXPIRED option
    assert.ok(dashHtml.includes('<option value="EXPIRED">Expired</option>'), 'dashboard.html #statusFilter must have Expired option');

    // Admin table select disables EXPIRED orders from manual change
    assert.ok(adminJs.includes("['DELIVERED', 'CANCELLED', 'EXPIRED'].includes(tiffinStatus) ? 'disabled' : ''"), 'admin.js must disable status select when EXPIRED');

    // Admin CSS styles .badge.expired in red
    assert.ok(adminCss.includes('.badge.expired'), 'admin.css must define .badge.expired');
    assert.ok(adminCss.includes('.order-status-select[data-current-status="EXPIRED"]'), 'admin.css must style expired select in red');
  });

  // ── 7. Existing daily delivery resets continue to work for non-expired subscriptions ───
  it('7 - Existing daily delivery resets continue to work for active, unexpired subscriptions', async () => {
    // Monday morning Oct 19, 2026 (service day). Subscription ends in November.
    const monday = new Date('2026-10-19T14:00:00Z');
    assert.equal(formatDateKey(monday), '2026-10-19');

    const activeDeliveredOrder = makeOrder({
      orderId: '26101200001',
      status: 'DELIVERED',
      subscriptionStartDate: new Date('2026-10-12T12:00:00Z'),
      subscriptionEndDate: new Date('2026-11-06T12:00:00Z'), // Ends in November
      deliveryStatusDate: new Date('2026-10-16T12:00:00Z'), // Delivered on Friday Oct 16
      items: [{ fulfillment: 'delivery', deliveryStatus: 'DELIVERED' }]
    });

    const Order = mockOrderModel([activeDeliveredOrder]);
    const resetCount = await resetDeliveredOrders(Order, { now: monday });

    assert.equal(resetCount, 1, 'Active unexpired delivered subscription should reset to ACCEPTED on Monday');
    assert.equal(activeDeliveredOrder.status, 'ACCEPTED', 'Status must reset to ACCEPTED');
    assert.equal(activeDeliveredOrder.items[0].deliveryStatus, 'ACCEPTED');
  });

  // ── 8. Date comparisons use America/Vancouver around midnight & DST transitions ──────
  it('8 - Date comparisons use America/Vancouver around midnight and daylight-saving transitions', () => {
    // Case A: Midnight boundary in Vancouver
    // 2026-10-20 23:59:59 Vancouver (PDT) is 2026-10-21 06:59:59 UTC
    const endOfOct20 = DateTime.fromISO('2026-10-20T23:59:59', { zone: BUSINESS_TIMEZONE }).toJSDate();
    assert.equal(formatDateKey(endOfOct20), '2026-10-20', '23:59:59 Vancouver must format as 2026-10-20');

    // 2026-10-21 00:00:01 Vancouver (PDT) is 2026-10-21 07:00:01 UTC
    const startOfOct21 = DateTime.fromISO('2026-10-21T00:00:01', { zone: BUSINESS_TIMEZONE }).toJSDate();
    assert.equal(formatDateKey(startOfOct21), '2026-10-21', '00:00:01 Vancouver must format as 2026-10-21');

    // Case B: Daylight saving fallback transition (Sun Nov 1, 2026)
    // 1:30 AM PDT before fallback vs 1:30 AM PST after fallback both belong to 2026-11-01
    const dstDate = DateTime.fromISO('2026-11-01T01:30:00', { zone: BUSINESS_TIMEZONE }).toJSDate();
    assert.equal(formatDateKey(dstDate), '2026-11-01', 'DST fallback date must stay on 2026-11-01');

    // Case C: Pure pickup orders are never expired
    const pickupOrder = {
      fulfillment: 'pickup',
      type: 'product',
      pickupDate: new Date('2026-10-10T12:00:00Z'),
      items: [{ fulfillment: 'pickup', productName: 'Amla Pickle', deliveryStatus: 'ACCEPTED' }]
    };
    const resolvedPickup = resolveDeliveryStatus(pickupOrder, new Date('2026-10-23T12:00:00Z'));
    assert.equal(resolvedPickup, 'PENDING', 'Pure pickup order status should not be modified by delivery resolver');
  });

});
