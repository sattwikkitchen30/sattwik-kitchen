const { TIFFIN_PREPARATION_RULES, TIFFIN_MENU_BY_WEEKDAY } = require('./constants');

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
    bigCurd: 0
  };

  const sizeMap = {
    single: 'small',
    couple: 'medium',
    family: 'large'
  };

  for (const subscription of subscriptions) {
    if (!subscription || !subscription.packageType || !subscription.size) continue;
    const packageType = String(subscription.packageType);
    const size = String(subscription.size);
    const rule = TIFFIN_PREPARATION_RULES[packageType]?.[size];
    if (!rule) continue;

    const prepSize = sizeMap[size] || size;
    totals[`${prepSize}Curries`] += 1;
    totals[`${prepSize}Dal`] += 1;

    if (packageType === 'full') {
      totals.riceBoxes += Number(rule.rice || 0);
      totals.chapathiCount += Number(rule.chapati || 0);
      if (rule.curd === 'small') totals.smallCurd += 1;
      if (rule.curd === 'big') totals.bigCurd += 1;
    }
  }

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
  startOfDay,
  endOfDay,
  buildPreparationTotals,
  buildActivePlanCounts,
  resolveTiffinSubscriptionStatus,
  syncExpiredTiffinSubscriptions
};
