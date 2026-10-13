const { DateTime } = require('luxon');

const BUSINESS_TIMEZONE = process.env.BUSINESS_TIMEZONE || 'America/Vancouver';

function parseDateOnly(dateString) {
  if (typeof dateString !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
    return null;
  }
  const dt = DateTime.fromISO(dateString, { zone: BUSINESS_TIMEZONE });
  if (!dt.isValid) return null;
  return dt.startOf('day').toJSDate();
}

function startOfDay(dateValue) {
  const dt = DateTime.fromJSDate(dateValue).setZone(BUSINESS_TIMEZONE);
  if (!dt.isValid) return null;
  return dt.startOf('day').toJSDate();
}

function addDays(dateValue, days) {
  const dt = DateTime.fromJSDate(dateValue).setZone(BUSINESS_TIMEZONE);
  if (!dt.isValid) return null;
  return dt.plus({ days: Number(days || 0) }).toJSDate();
}

function dateMatch(query = {}) {
  const { from, to } = query;
  const match = {};
  if (from || to) {
    match.createdAt = {};
    if (from) {
      const fromDate = parseDateOnly(from);
      if (fromDate) {
        match.createdAt.$gte = startOfDay(fromDate);
      }
    }
    if (to) {
      const toDate = parseDateOnly(to);
      if (toDate) {
        const nextDay = addDays(toDate, 1);
        match.createdAt.$lt = startOfDay(nextDay);
      }
    }
  }
  return match;
}

module.exports = { dateMatch, parseDateOnly, startOfDay, addDays };
