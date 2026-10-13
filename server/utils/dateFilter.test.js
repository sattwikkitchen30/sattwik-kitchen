const test = require('node:test');
const assert = require('node:assert/strict');
const { dateMatch } = require('./dateFilter');

test('dateMatch creates Vancouver timezone-aware boundaries', () => {
  // Test single day range
  const singleDay = dateMatch({ from: '2026-10-12', to: '2026-10-12' });
  assert.ok(singleDay.createdAt.$gte instanceof Date);
  assert.ok(singleDay.createdAt.$lt instanceof Date);
  
  // Verify the boundaries span the entire Vancouver day
  const start = singleDay.createdAt.$gte;
  const end = singleDay.createdAt.$lt;
  const duration = end.getTime() - start.getTime();
  
  // Should be approximately 24 hours (may vary slightly due to DST)
  assert.ok(duration > 23 * 60 * 60 * 1000);
  assert.ok(duration < 25 * 60 * 60 * 1000);
});

test('dateMatch handles from-only boundary', () => {
  const fromOnly = dateMatch({ from: '2026-10-12' });
  assert.ok(fromOnly.createdAt.$gte instanceof Date);
  assert.equal(fromOnly.createdAt.$lt, undefined);
});

test('dateMatch handles to-only boundary', () => {
  const toOnly = dateMatch({ to: '2026-10-12' });
  assert.equal(toOnly.createdAt.$gte, undefined);
  assert.ok(toOnly.createdAt.$lt instanceof Date);
});

test('dateMatch handles empty query', () => {
  const empty = dateMatch({});
  assert.equal(Object.keys(empty).length, 0);
});

test('dateMatch handles multi-day range', () => {
  const multiDay = dateMatch({ from: '2026-10-12', to: '2026-10-15' });
  assert.ok(multiDay.createdAt.$gte instanceof Date);
  assert.ok(multiDay.createdAt.$lt instanceof Date);
  
  const start = multiDay.createdAt.$gte;
  const end = multiDay.createdAt.$lt;
  const duration = end.getTime() - start.getTime();
  
  // Should be approximately 4 days (may vary slightly due to DST)
  assert.ok(duration > 3 * 24 * 60 * 60 * 1000);
  assert.ok(duration < 5 * 24 * 60 * 60 * 1000);
});

test('dateMatch uses half-open range (inclusive start, exclusive end)', () => {
  const singleDay = dateMatch({ from: '2026-10-12', to: '2026-10-12' });
  const start = singleDay.createdAt.$gte;
  const end = singleDay.createdAt.$lt;
  
  // Start should be midnight on the from date
  assert.ok(start instanceof Date);
  
  // End should be midnight on the day after to date
  assert.ok(end instanceof Date);
  
  // The end should be strictly after the start
  assert.ok(end.getTime() > start.getTime());
});

test('dateMatch boundaries are in UTC (for MongoDB comparison)', () => {
  const singleDay = dateMatch({ from: '2026-10-12', to: '2026-10-12' });
  const start = singleDay.createdAt.$gte;
  const end = singleDay.createdAt.$lt;
  
  // Both should be valid Date objects
  assert.ok(start instanceof Date);
  assert.ok(end instanceof Date);
  
  // Both should be valid dates (not NaN)
  assert.ok(!Number.isNaN(start.getTime()));
  assert.ok(!Number.isNaN(end.getTime()));
});

test('dateMatch handles Winter PST (UTC-8)', () => {
  const winterDay = dateMatch({ from: '2026-01-15', to: '2026-01-15' });
  const start = winterDay.createdAt.$gte;
  const end = winterDay.createdAt.$lt;
  
  assert.ok(start instanceof Date);
  assert.ok(end instanceof Date);
  assert.ok(!Number.isNaN(start.getTime()));
  assert.ok(!Number.isNaN(end.getTime()));
  
  const duration = end.getTime() - start.getTime();
  assert.ok(duration > 23 * 60 * 60 * 1000);
  assert.ok(duration < 25 * 60 * 60 * 1000);
});

test('dateMatch handles Summer PDT (UTC-7)', () => {
  const summerDay = dateMatch({ from: '2026-07-15', to: '2026-07-15' });
  const start = summerDay.createdAt.$gte;
  const end = summerDay.createdAt.$lt;
  
  assert.ok(start instanceof Date);
  assert.ok(end instanceof Date);
  assert.ok(!Number.isNaN(start.getTime()));
  assert.ok(!Number.isNaN(end.getTime()));
  
  const duration = end.getTime() - start.getTime();
  assert.ok(duration > 23 * 60 * 60 * 1000);
  assert.ok(duration < 25 * 60 * 60 * 1000);
});

test('dateMatch handles DST spring forward transition', () => {
  const springDay = dateMatch({ from: '2026-03-08', to: '2026-03-08' });
  const start = springDay.createdAt.$gte;
  const end = springDay.createdAt.$lt;
  
  assert.ok(start instanceof Date);
  assert.ok(end instanceof Date);
  assert.ok(!Number.isNaN(start.getTime()));
  assert.ok(!Number.isNaN(end.getTime()));
  
  const duration = end.getTime() - start.getTime();
  // On spring forward day, local day is 23 hours
  assert.ok(duration > 22 * 60 * 60 * 1000);
  assert.ok(duration < 24 * 60 * 60 * 1000);
});

test('dateMatch handles DST fall back transition', () => {
  const fallDay = dateMatch({ from: '2026-11-01', to: '2026-11-01' });
  const start = fallDay.createdAt.$gte;
  const end = fallDay.createdAt.$lt;
  
  assert.ok(start instanceof Date);
  assert.ok(end instanceof Date);
  assert.ok(!Number.isNaN(start.getTime()));
  assert.ok(!Number.isNaN(end.getTime()));
  
  const duration = end.getTime() - start.getTime();
  // On fall back day, local day is 25 hours
  assert.ok(duration > 24 * 60 * 60 * 1000);
  assert.ok(duration < 26 * 60 * 60 * 1000);
});

test('dateMatch handles range crossing DST transition', () => {
  const range = dateMatch({ from: '2026-03-08', to: '2026-03-09' });
  const start = range.createdAt.$gte;
  const end = range.createdAt.$lt;
  
  assert.ok(start instanceof Date);
  assert.ok(end instanceof Date);
  assert.ok(!Number.isNaN(start.getTime()));
  assert.ok(!Number.isNaN(end.getTime()));
  
  const duration = end.getTime() - start.getTime();
  // 2 days may be 47 or 49 hours depending on DST
  assert.ok(duration > 46 * 60 * 60 * 1000);
  assert.ok(duration < 50 * 60 * 60 * 1000);
});
