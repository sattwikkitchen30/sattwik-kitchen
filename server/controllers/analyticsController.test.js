const test = require('node:test');
const assert = require('node:assert/strict');
const { hasEverBeenDeliveredExpression, revenueExpression, revenueEligibleItemsExpression } = require('./analyticsController');

test('revenue eligibility is based on a first-delivery marker or legacy delivered data', () => {
  assert.deepEqual(hasEverBeenDeliveredExpression(), {
    $or: [
      { $ne: [{ $ifNull: ['$firstDeliveredAt', null] }, null] },
      { $ne: [{ $ifNull: ['$deliveredAt', null] }, null] },
      { $in: ['$status', ['DELIVERED', 'delivered']] }
    ]
  });
  const serialized = JSON.stringify(revenueExpression());
  assert.match(serialized, /firstDeliveredAt/);
  assert.match(serialized, /deliveredAt/);
  assert.doesNotMatch(serialized, /ACCEPTED|OUT_FOR_DELIVERY/);
});

test('product revenue excludes pre-delivery orders and allocates delivered orders from saved totalAmount', () => {
  const expression = JSON.stringify(revenueEligibleItemsExpression());
  assert.match(expression, /firstDeliveredAt/);
  assert.match(expression, /totalAmount/);
  assert.match(expression, /revenueAmount/);
});
