const test = require('node:test');
const assert = require('node:assert/strict');
const { revenueExpression, revenueEligibleItemsExpression } = require('./analyticsController');

test('revenue is calculated from payment records, not delivery status', () => {
  const expression = JSON.stringify(revenueExpression());
  assert.match(expression, /payments/);
  assert.match(expression, /amount/);
  assert.doesNotMatch(expression, /firstDeliveredAt|deliveredAt|status/);
});

test('product revenue allocates based on payment proportion of item subtotals', () => {
  const expression = JSON.stringify(revenueEligibleItemsExpression());
  assert.match(expression, /payments/);
  assert.match(expression, /totalPaid/);
  assert.match(expression, /subtotal/);
  assert.match(expression, /revenueAmount/);
  assert.doesNotMatch(expression, /firstDeliveredAt|deliveredAt/);
});
