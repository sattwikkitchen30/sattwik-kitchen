const { TIFFIN_MENU_BY_WEEKDAY } = require('./constants');
const { buildDefaultTiffinItems, getLegacyOrderTiffinItems } = require('./tiffinItems');

const BUSINESS_TIMEZONE = 'Asia/Kolkata';
const BUSINESS_OFFSET = '+05:30';
const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const SERVICE_WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

function pad(value, size = 2) {
  return String(value).padStart(size, '0');
}

function zonedDateTime(year, month, day, hour = 0, minute = 0, second = 0, millisecond = 0) {
  return new Date(`${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:${pad(second)}.${pad(millisecond, 3)}${BUSINESS_OFFSET}`);
}

function getZonedParts(dateValue = new Date()) {
  const date = getLocalDate(dateValue);
  if (!date) return null;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: BUSINESS_TIMEZONE,
    weekday: 'long',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hourCycle: 'h23'
  }).formatToParts(date);
  const read = (type) => parts.find((part) => part.type === type)?.value;
  return {
    weekday: read('weekday'),
    year: Number(read('year')),
    month: Number(read('month')),
    day: Number(read('day')),
    hour: Number(read('hour')),
    minute: Number(read('minute')),
    second: Number(read('second'))
  };
}

function getLocalDate(dateValue = new Date()) {
  if (dateValue instanceof Date) {
    return Number.isNaN(dateValue.getTime()) ? null : dateValue;
  }
  if (typeof dateValue === 'string') {
    const trimmed = dateValue.trim();
    if (!trimmed) return null;
    const dateOnly = DATE_ONLY_PATTERN.exec(trimmed);
    if (dateOnly) {
      return zonedDateTime(Number(dateOnly[1]), Number(dateOnly[2]), Number(dateOnly[3]), 12);
    }
    const parsed = new Date(trimmed);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  const value = new Date(dateValue);
  return Number.isNaN(value.getTime()) ? null : value;
}

function formatDateKey(dateValue) {
  const parts = getZonedParts(dateValue);
  if (!parts) return null;
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
}

function parseDateInput(value, fallback = new Date()) {
  if (!value && value !== 0) return getLocalDate(fallback);
  const parsed = getLocalDate(value);
  return parsed || getLocalDate(fallback);
}

function addDays(dateValue, days) {
  const parts = getZonedParts(dateValue);
  if (!parts) return null;
  const shifted = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + Number(days || 0), 12));
  return zonedDateTime(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth() + 1,
    shifted.getUTCDate(),
    parts.hour,
    parts.minute,
    parts.second
  );
}

function getWeekdayName(dateValue) {
  return getZonedParts(dateValue)?.weekday || null;
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
  while (serviceDates.length < 20) {
    if (isServiceDay(cursor)) {
      serviceDates.push(startOfDay(cursor));
    }
    cursor = addDays(cursor, 1);
    if (!cursor || cursor.getTime() - start.getTime() > 1000 * 60 * 60 * 24 * 365) {
      break;
    }
  }

  const resolvedEnd = serviceDates[serviceDates.length - 1] || start;
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
  const parts = getZonedParts(dateValue);
  if (!parts) return null;
  return zonedDateTime(parts.year, parts.month, parts.day, 0, 0, 0, 0);
}

function endOfDay(dateValue) {
  const parts = getZonedParts(dateValue);
  if (!parts) return null;
  return zonedDateTime(parts.year, parts.month, parts.day, 23, 59, 59, 999);
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
