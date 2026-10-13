const { DateTime } = require('luxon');
const { TIFFIN_MENU_BY_WEEKDAY } = require('./constants');
const { buildDefaultTiffinItems, getLegacyOrderTiffinItems } = require('./tiffinItems');

const BUSINESS_TIMEZONE = process.env.BUSINESS_TIMEZONE || 'America/Vancouver';
const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const SERVICE_WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

function pad(value, size = 2) {
  return String(value).padStart(size, '0');
}

function toVancouverDateTime(dateValue) {
  if (!dateValue) return null;
  if (typeof dateValue === 'string' && DATE_ONLY_PATTERN.test(dateValue)) {
    return DateTime.fromISO(dateValue, { zone: BUSINESS_TIMEZONE }).set({ hour: 12, minute: 0, second: 0, millisecond: 0 });
  }
  if (dateValue instanceof Date) {
    return DateTime.fromJSDate(dateValue).setZone(BUSINESS_TIMEZONE);
  }
  return DateTime.fromJSDate(new Date(dateValue)).setZone(BUSINESS_TIMEZONE);
}

function toJSDate(vancouverDateTime) {
  if (!vancouverDateTime) return null;
  return vancouverDateTime.toJSDate();
}

function getZonedParts(dateValue = new Date()) {
  const dt = toVancouverDateTime(dateValue);
  if (!dt || !dt.isValid) return null;
  return {
    weekday: dt.toFormat('EEEE'),
    year: dt.year,
    month: dt.month,
    day: dt.day,
    hour: dt.hour,
    minute: dt.minute,
    second: dt.second
  };
}

function getLocalDate(dateValue = new Date()) {
  const dt = toVancouverDateTime(dateValue);
  if (!dt || !dt.isValid) return null;
  return dt.toJSDate();
}

function formatDateKey(dateValue) {
  if (typeof dateValue === 'string' && DATE_ONLY_PATTERN.test(dateValue)) {
    return dateValue;
  }
  const dt = toVancouverDateTime(dateValue);
  if (!dt || !dt.isValid) return null;
  return dt.toFormat('yyyy-MM-dd');
}

function parseDateInput(value, fallback = new Date()) {
  if (!value && value !== 0) return getLocalDate(fallback);
  const parsed = getLocalDate(value);
  return parsed || getLocalDate(fallback);
}

function addDays(dateValue, days) {
  const dt = toVancouverDateTime(dateValue);
  if (!dt || !dt.isValid) return null;
  const shifted = dt.plus({ days: Number(days || 0) });
  return shifted.toJSDate();
}

function getWeekdayName(dateValue) {
  const dt = toVancouverDateTime(dateValue);
  if (!dt || !dt.isValid) return null;
  return dt.toFormat('EEEE');
}

function isServiceDay(dateValue) {
  return SERVICE_WEEKDAYS.includes(getWeekdayName(dateValue));
}

function getMenuForDate(dateValue) {
  const day = getWeekdayName(dateValue);
  return TIFFIN_MENU_BY_WEEKDAY[day] || null;
}

function dateLabel(dateValue) {
  const date = getLocalDate(dateValue);
  if (!date) return '—';
  return new Intl.DateTimeFormat('en-US', {
    timeZone: BUSINESS_TIMEZONE,
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric'
  }).format(date);
}

function getSubscriptionServiceDates(startDateValue, endDateValue = null) {
  const start = startOfDay(startDateValue);
  if (!start) {
    return { startDate: null, endDate: null, serviceDates: [] };
  }

  const serviceDates = [];
  let cursor = start;
  
  // Count exactly 20 service days (Monday-Friday only)
  while (serviceDates.length < 20) {
    if (isServiceDay(cursor)) {
      serviceDates.push(startOfDay(cursor));
    }
    cursor = addDays(cursor, 1);
    // Safety break to prevent infinite loops
    if (!cursor || cursor.getTime() - start.getTime() > 1000 * 60 * 60 * 24 * 365) {
      break;
    }
  }

  // If we couldn't find 20 service days, return what we have
  if (serviceDates.length === 0) {
    return { startDate: start, endDate: start, serviceDates: [] };
  }

  // The end date is the last service day found
  const resolvedEnd = serviceDates[serviceDates.length - 1];
  
  // If an explicit end date is provided and it matches the calculated end, use it
  // Otherwise, use the calculated end date
  const explicitEnd = endDateValue ? startOfDay(endDateValue) : null;
  const normalizedEnd = explicitEnd && serviceDates.length === 20 && explicitEnd.getTime() === resolvedEnd.getTime()
    ? explicitEnd
    : resolvedEnd;

  return {
    startDate: start,
    endDate: normalizedEnd,
    serviceDates
  };
}

function startOfDay(dateValue) {
  const dt = toVancouverDateTime(dateValue);
  if (!dt || !dt.isValid) return null;
  return dt.startOf('day').toJSDate();
}

function endOfDay(dateValue) {
  const dt = toVancouverDateTime(dateValue);
  if (!dt || !dt.isValid) return null;
  return dt.endOf('day').toJSDate();
}

function buildPreparationTotals(subscriptions = []) {
  const totals = {
    smallCurries: 0,
    mediumCurries: 0,
    largeCurries: 0,
    smallDal: 0,
    mediumDal: 0,
    largeDal: 0,
    riceBoxes: 0,
    chapathiCount: 0,
    smallCurd: 0,
    bigCurd: 0,
    otherItems: []
  };
  const otherItems = new Map();
  const countedCustomizedOrders = new Set();

  for (const subscription of subscriptions) {
    if (!subscription) continue;
    const order = subscription.orderId || subscription;
    let tiffinItems;
    if (order.tiffinItemsCustomized) {
      const orderId = order._id || order.id;
      const orderKey = orderId ? String(orderId) : order;
      if (countedCustomizedOrders.has(orderKey)) continue;
      countedCustomizedOrders.add(orderKey);
      tiffinItems = getLegacyOrderTiffinItems(order, subscription);
    } else {
      tiffinItems = buildDefaultTiffinItems([subscription]);
      if (!tiffinItems.length) tiffinItems = getLegacyOrderTiffinItems(order, subscription);
    }

    for (const item of tiffinItems) {
      const quantity = Number(item.quantity) || 0;
      if (quantity <= 0) continue;
      const totalKey = {
        smallDal: 'smallDal',
        mediumDal: 'mediumDal',
        largeDal: 'largeDal',
        smallCurry: 'smallCurries',
        mediumCurry: 'mediumCurries',
        largeCurry: 'largeCurries',
        smallCurd: 'smallCurd',
        bigCurd: 'bigCurd',
        riceBox: 'riceBoxes',
        chapathi: 'chapathiCount'
      }[item.preparationType];
      if (totalKey) {
        totals[totalKey] += quantity;
      } else if (item.productName) {
        otherItems.set(item.productName, (otherItems.get(item.productName) || 0) + quantity);
      }
    }
  }

  totals.otherItems = [...otherItems].map(([item, count]) => ({ item, count }));
  return totals;
}

function buildActivePlanCounts(subscriptions = []) {
  const count = {
    full: { single: 0, couple: 0, family: 0 },
    'curry-only': { single: 0, couple: 0, family: 0 }
  };

  for (const subscription of subscriptions) {
    if (!subscription || !subscription.packageType || !subscription.size) continue;
    const packageType = String(subscription.packageType);
    const size = String(subscription.size);
    const quantity = Number(subscription.quantity) || 1;
    if (!count[packageType]) continue;
    count[packageType][size] = (count[packageType][size] || 0) + quantity;
  }

  return count;
}

function resolveTiffinSubscriptionStatus(subscription, now = new Date()) {
  const status = subscription?.status;
  if (status === 'CANCELLED') return 'CANCELLED';
  if (!subscription || !subscription.endDate) return status || 'ACTIVE';
  const currentTime = new Date(now);
  const endDate = new Date(subscription.endDate);
  if (Number.isNaN(currentTime.getTime()) || Number.isNaN(endDate.getTime())) return status || 'ACTIVE';
  return currentTime > endDate ? 'EXPIRED' : 'ACTIVE';
}

async function syncExpiredTiffinSubscriptions(now = new Date()) {
  const TiffinSubscription = require('../models/TiffinSubscription');
  const currentTime = new Date(now);
  return TiffinSubscription.updateMany(
    {
      status: { $ne: 'CANCELLED' },
      endDate: { $lt: currentTime }
    },
    { $set: { status: 'EXPIRED' } }
  );
}

module.exports = {
  BUSINESS_TIMEZONE,
  getLocalDate,
  formatDateKey,
  parseDateInput,
  addDays,
  getWeekdayName,
  isServiceDay,
  getMenuForDate,
  dateLabel,
  getSubscriptionServiceDates,
  startOfDay,
  endOfDay,
  buildPreparationTotals,
  buildActivePlanCounts,
  resolveTiffinSubscriptionStatus,
  syncExpiredTiffinSubscriptions
};
