const { TIFFIN_MENU_BY_WEEKDAY } = require('./constants');
const { getLegacyOrderTiffinItems } = require('./tiffinItems');

function getLocalDate(dateValue = new Date()) {
  const value = dateValue instanceof Date ? dateValue : new Date(dateValue);
  if (Number.isNaN(value.getTime())) return null;
  return value;
}

function formatDateKey(dateValue) {
  const date = getLocalDate(dateValue);
  if (!date) return null;
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseDateInput(value, fallback = new Date()) {
  if (!value && value !== 0) return getLocalDate(fallback);
  if (value instanceof Date) return getLocalDate(value);
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return getLocalDate(fallback);
    const date = new Date(`${trimmed}T12:00:00`);
    if (!Number.isNaN(date.getTime())) return date;
  }
  return getLocalDate(fallback);
}

function addDays(dateValue, days) {
  const date = getLocalDate(dateValue);
  if (!date) return null;
  const next = new Date(date);
  next.setDate(next.getDate() + Number(days || 0));
  return next;
}

function getWeekdayName(dateValue) {
  const date = getLocalDate(dateValue);
  if (!date) return null;
  const names = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  return names[date.getDay()];
}

function isServiceDay(dateValue) {
  const day = getWeekdayName(dateValue);
  return ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'].includes(day);
}

function getMenuForDate(dateValue) {
  const day = getWeekdayName(dateValue);
  return TIFFIN_MENU_BY_WEEKDAY[day] || null;
}

function dateLabel(dateValue) {
  const date = getLocalDate(dateValue);
  if (!date) return '—';
  return new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).format(date);
}

function getSubscriptionServiceDates(startDateValue, endDateValue = null) {
  const start = startOfDay(startDateValue);
  if (!start) {
    return { startDate: null, endDate: null, serviceDates: [] };
  }

  const serviceDates = [];
  const cursor = new Date(start);
  while (serviceDates.length < 20) {
    if (isServiceDay(cursor)) {
      serviceDates.push(new Date(cursor));
    }
    cursor.setDate(cursor.getDate() + 1);
    if (cursor.getTime() - start.getTime() > 1000 * 60 * 60 * 24 * 365) {
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
  const date = getLocalDate(dateValue);
  if (!date) return null;
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  return start;
}

function endOfDay(dateValue) {
  const date = getLocalDate(dateValue);
  if (!date) return null;
  const end = new Date(date);
  end.setHours(23, 59, 59, 999);
  return end;
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

  for (const subscription of subscriptions) {
    if (!subscription) continue;
    const tiffinItems = getLegacyOrderTiffinItems(subscription.orderId, subscription);
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
    if (!count[packageType]) continue;
    count[packageType][size] = (count[packageType][size] || 0) + 1;
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
