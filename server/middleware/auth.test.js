const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { authRequired } = require('./auth');
const ordersRouter = require('../routes/orders');

test('customer credentials cannot access the admin order status endpoint', async () => {
  const token = jwt.sign(
    { id: 'customer-id', type: 'customer' },
    process.env.JWT_SECRET || 'dev_secret_change_me'
  );
  const response = {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
  let nextCalled = false;

  await authRequired({
    headers: { authorization: `Bearer ${token}` }
  }, response, () => { nextCalled = true; });

  const statusRoute = ordersRouter.stack.find((layer) => (
    layer.route?.path === '/:id/status' && layer.route.methods.put
  ));

  assert.equal(response.statusCode, 403);
  assert.equal(response.body.message, 'Admin access required');
  assert.equal(nextCalled, false);
  assert.ok(statusRoute);
  assert.equal(statusRoute.route.stack[0].handle, authRequired);
});
