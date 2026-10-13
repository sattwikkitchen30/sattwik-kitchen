const test = require('node:test');
const assert = require('node:assert/strict');
const { DateTime } = require('luxon');
const { formatDateKey, isServiceDay, startOfDay, endOfDay, addDays, getWeekdayName } = require('./tiffinPreparation');

const BUSINESS_TIMEZONE = 'America/Vancouver';

test('Vancouver date formatting preserves date-only strings', () => {
  assert.equal(formatDateKey('2026-10-12'), '2026-10-12');
  assert.equal(formatDateKey('2026-10-13'), '2026-10-13');
  assert.equal(formatDateKey('2026-10-16'), '2026-10-16');
});

test('Vancouver weekday detection uses actual Pacific time', () => {
  const monday = new Date('2026-10-12T19:00:00Z');
  const tuesday = new Date('2026-10-13T19:00:00Z');
  const friday = new Date('2026-10-16T19:00:00Z');
  const saturday = new Date('2026-10-17T19:00:00Z');
  const sunday = new Date('2026-10-18T19:00:00Z');

  assert.equal(getWeekdayName(monday), 'Monday');
  assert.equal(getWeekdayName(tuesday), 'Tuesday');
  assert.equal(getWeekdayName(friday), 'Friday');
  assert.equal(getWeekdayName(saturday), 'Saturday');
  assert.equal(getWeekdayName(sunday), 'Sunday');
});

test('Vancouver service days are Monday through Friday', () => {
  const monday = new Date('2026-10-12T19:00:00Z');
  const tuesday = new Date('2026-10-13T19:00:00Z');
  const wednesday = new Date('2026-10-14T19:00:00Z');
  const thursday = new Date('2026-10-15T19:00:00Z');
  const friday = new Date('2026-10-16T19:00:00Z');
  const saturday = new Date('2026-10-17T19:00:00Z');
  const sunday = new Date('2026-10-18T19:00:00Z');

  assert.equal(isServiceDay(monday), true);
  assert.equal(isServiceDay(tuesday), true);
  assert.equal(isServiceDay(wednesday), true);
  assert.equal(isServiceDay(thursday), true);
  assert.equal(isServiceDay(friday), true);
  assert.equal(isServiceDay(saturday), false);
  assert.equal(isServiceDay(sunday), false);
});

test('Winter PST date formatting (UTC-8)', () => {
  const winterDate = new Date('2026-01-15T20:00:00Z');
  const vancouverDate = DateTime.fromJSDate(winterDate).setZone(BUSINESS_TIMEZONE);
  assert.equal(vancouverDate.offset, -480);
  assert.equal(formatDateKey(winterDate), '2026-01-15');
});

test('Summer PDT date formatting (UTC-7)', () => {
  const summerDate = new Date('2026-07-15T20:00:00Z');
  const vancouverDate = DateTime.fromJSDate(summerDate).setZone(BUSINESS_TIMEZONE);
  assert.equal(vancouverDate.offset, -420);
  assert.equal(formatDateKey(summerDate), '2026-07-15');
});

test('Start of day returns Vancouver midnight', () => {
  const date = new Date('2026-10-12T19:00:00Z');
  const start = startOfDay(date);
  assert(formatDateKey(start) === '2026-10-12');
});

test('End of day returns Vancouver end of day', () => {
  const date = new Date('2026-10-12T19:00:00Z');
  const end = endOfDay(date);
  assert(formatDateKey(end) === '2026-10-12');
});

test('Add days adds calendar days in Vancouver time', () => {
  const monday = new Date('2026-10-12T19:00:00Z');
  const tuesday = addDays(monday, 1);
  const wednesday = addDays(monday, 2);
  const friday = addDays(monday, 4);

  assert.equal(formatDateKey(tuesday), '2026-10-13');
  assert.equal(formatDateKey(wednesday), '2026-10-14');
  assert.equal(formatDateKey(friday), '2026-10-16');
});

test('Vancouver midnight when UTC and India have different dates', () => {
  const vancouverMidnight = new Date('2026-10-12T07:00:00Z');
  assert.equal(formatDateKey(vancouverMidnight), '2026-10-12');
  assert.equal(getWeekdayName(vancouverMidnight), 'Monday');
});

test('Date-only round trip preserves the date', () => {
  const input = '2026-10-12';
  const formatted = formatDateKey(input);
  assert.equal(formatted, input);
});

test('DST spring forward transition (second Sunday in March)', () => {
  const beforeDST = new Date('2026-03-08T09:59:00Z');
  const afterDST = new Date('2026-03-08T10:00:00Z');

  const beforeVancouver = DateTime.fromJSDate(beforeDST).setZone(BUSINESS_TIMEZONE);
  const afterVancouver = DateTime.fromJSDate(afterDST).setZone(BUSINESS_TIMEZONE);

  assert.equal(beforeVancouver.offset, -480);
  assert.equal(afterVancouver.offset, -420);

  assert.equal(formatDateKey(beforeDST), '2026-03-08');
  assert.equal(formatDateKey(afterDST), '2026-03-08');
});

test('DST fall back transition (first Sunday in November)', () => {
  const beforeDST = new Date('2026-11-01T08:59:00Z');
  const afterDST = new Date('2026-11-01T09:00:00Z');

  const beforeVancouver = DateTime.fromJSDate(beforeDST).setZone(BUSINESS_TIMEZONE);
  const afterVancouver = DateTime.fromJSDate(afterDST).setZone(BUSINESS_TIMEZONE);

  assert.equal(beforeVancouver.offset, -420);
  assert.equal(afterVancouver.offset, -480);

  assert.equal(formatDateKey(beforeDST), '2026-11-01');
  assert.equal(formatDateKey(afterDST), '2026-11-01');
});

test('Subscription service day calculation skips weekends', () => {
  const friday = new Date('2026-10-16T19:00:00Z');
  const saturday = addDays(friday, 1);
  const sunday = addDays(friday, 2);
  const monday = addDays(friday, 3);

  assert.equal(formatDateKey(saturday), '2026-10-17');
  assert.equal(formatDateKey(sunday), '2026-10-18');
  assert.equal(formatDateKey(monday), '2026-10-19');

  assert.equal(isServiceDay(saturday), false);
  assert.equal(isServiceDay(sunday), false);
  assert.equal(isServiceDay(monday), true);
});
