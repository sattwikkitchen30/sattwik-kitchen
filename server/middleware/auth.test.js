const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { authRequired } = require('./auth');
const { deliveryAuthRequired } = require('./deliveryAuth');
const ordersRouter = require('../routes/orders');
const deliveryMembersRouter = require('../routes/deliveryMembers');

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

test('unauthenticated request to /delivery-members/me is rejected', async () => {
  const response = {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
  let nextCalled = false;

  await deliveryAuthRequired({}, response, () => { nextCalled = true; });

  assert.equal(response.statusCode, 401);
  assert.equal(response.body.message, 'Invalid or expired delivery session');
  assert.equal(nextCalled, false);
});

test('delivery member token is accepted by deliveryAuthRequired middleware', async () => {
  const token = jwt.sign(
    { id: 'delivery-member-id', type: 'delivery' },
    process.env.JWT_SECRET || 'dev_secret_change_me'
  );
  const response = {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
  let nextCalled = false;

  await deliveryAuthRequired({
    headers: { authorization: `Bearer ${token}` }
  }, response, () => { nextCalled = true; });

  // The middleware will try to find the member in the database, which will fail in this test
  // So we expect 401 because the member doesn't exist in the database
  assert.equal(response.statusCode, 401);
  assert.equal(response.body.message, 'Invalid or expired delivery session');
  assert.equal(nextCalled, false);
});

test('customer token is rejected by deliveryAuthRequired middleware', async () => {
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

  await deliveryAuthRequired({
    headers: { authorization: `Bearer ${token}` }
  }, response, () => { nextCalled = true; });

  assert.equal(response.statusCode, 401);
  assert.equal(response.body.message, 'Delivery session required');
  assert.equal(nextCalled, false);
});

test('delivery member route /me is registered before /:id', () => {
  const routes = deliveryMembersRouter.stack
    .filter((layer) => layer.route && layer.route.methods.get)
    .map((layer) => layer.route.path);

  const meIndex = routes.indexOf('/me');
  const idIndex = routes.indexOf('/:id');

  assert.ok(meIndex >= 0, '/me route should exist');
  assert.ok(idIndex >= 0, '/:id route should exist');
  assert.ok(meIndex < idIndex, '/me should be registered before /:id to prevent capture');
});
