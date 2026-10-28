'use strict';

/**
 * Test Suite: Admin Delivery Member Management
 *
 * Verifies:
 * 1. Admin Edit Delivery Member (PUT /api/delivery-members/:id) updates fields,
 *    persists in DB, preserves passwordHash and tokenVersion.
 * 2. Soft-delete via Deactivate / DELETE (/api/delivery-members/:id) sets active: false,
 *    does not erase the DB document or order history.
 * 3. Reactivation via PATCH /api/delivery-members/:id/status (active: true) restores active state.
 * 4. Historical integrity: Existing orders assigned to an inactive member retain their reference.
 * 5. Frontend assignment helper (renderDeliveryMemberSelectOptions):
 *    - Only active members are available as selectable new assignment options.
 *    - Inactive members previously assigned are retained as disabled (Inactive) option.
 * 6. Backend assignment enforcement:
 *    - PUT /orders/:id/assign rejects inactive delivery members with 400.
 * 7. Active member assignment succeeds with 200.
 * 8. Member Details modal HTML structure & close button verification:
 *    - Top close button and footer close button exist and have member-details-close-btn class.
 *    - Inline edit form and fields exist in dashboard.html.
 * 9. Security: Admin auth (authRequired) is enforced on all endpoints.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const mongoose = require('mongoose');

const DeliveryMember = require('../server/models/DeliveryMember');
const Order = require('../server/models/Order');
const TiffinSubscription = require('../server/models/TiffinSubscription');
const deliveryMembersRouter = require('../server/routes/deliveryMembers');
const orderController = require('../server/controllers/orderController');

// Helper to mock express req/res
function mockReqRes({ method = 'GET', body = {}, params = {}, query = {}, admin = null } = {}) {
  const req = {
    method,
    body,
    params,
    query,
    admin,
    app: {
      get: (key) => (key === 'io' ? { to: () => ({ emit: () => {} }) } : null)
    }
  };

  const res = {
    statusCode: 200,
    headersSent: false,
    _json: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this._json = data;
      this.headersSent = true;
      return this;
    }
  };

  return { req, res };
}

// Find route handler in express router stack
function findHandler(router, pathPattern, method) {
  for (const layer of router.stack) {
    if (layer.route && layer.route.path === pathPattern && layer.route.methods[method.toLowerCase()]) {
      return layer.route.stack[layer.route.stack.length - 1].handle;
    }
  }
  return null;
}

test('Admin Delivery Member Management - Automated Test Suite', async (t) => {
  const mockMembers = new Map();
  const mockOrders = new Map();

  const origDmFindById = DeliveryMember.findById;
  const origDmFind = DeliveryMember.find;
  const origDmExists = DeliveryMember.exists;
  const origOrderFindById = Order.findById;
  const origTiffinUpdateOne = TiffinSubscription.updateOne;

  TiffinSubscription.updateOne = async () => ({ acknowledged: true });

  DeliveryMember.findById = (id) => {
    const mem = mockMembers.get(String(id));
    if (!mem) {
      return {
        select: () => ({ lean: () => Promise.resolve(null) }),
        lean: () => Promise.resolve(null),
        then: (fn) => Promise.resolve(null).then(fn)
      };
    }
    const doc = {
      ...mem,
      save: async function () {
        mockMembers.set(String(this._id), { ...this });
        return this;
      }
    };
    return {
      select: () => ({
        lean: () => Promise.resolve({ ...mem })
      }),
      lean: () => Promise.resolve({ ...mem }),
      then: (fn) => Promise.resolve(doc).then(fn)
    };
  };

  DeliveryMember.find = () => ({
    select: () => ({
      sort: () => ({
        lean: () => Promise.resolve(Array.from(mockMembers.values()).map((m) => ({ ...m })))
      })
    })
  });

  DeliveryMember.exists = async (query) => {
    for (const mem of mockMembers.values()) {
      let match = true;
      if (query.email && mem.email.toLowerCase() !== query.email.toLowerCase()) match = false;
      if (query._id && query._id.$ne && String(mem._id) === String(query._id.$ne)) match = false;
      if (match) return { _id: mem._id };
    }
    return null;
  };

  Order.findById = (id) => {
    const ord = mockOrders.get(String(id));
    if (!ord) {
      return {
        populate: () => ({ populate: () => Promise.resolve(null) }),
        then: (fn) => Promise.resolve(null).then(fn)
      };
    }
    const doc = {
      ...ord,
      save: async function () {
        mockOrders.set(String(this._id), { ...this });
        return this;
      }
    };
    const populateObj = {
      populate: () => populateObj,
      then: (fn) => Promise.resolve(doc).then(fn)
    };
    return {
      populate: () => populateObj,
      then: (fn) => Promise.resolve(doc).then(fn)
    };
  };

  t.after(() => {
    DeliveryMember.findById = origDmFindById;
    DeliveryMember.find = origDmFind;
    DeliveryMember.exists = origDmExists;
    Order.findById = origOrderFindById;
    TiffinSubscription.updateOne = origTiffinUpdateOne;
  });

  // Seed initial test data
  const memberId1 = new mongoose.Types.ObjectId().toString();
  const memberId2 = new mongoose.Types.ObjectId().toString();
  const mockPasswordHash = '$2a$12$eX4mpL3h4ShValuEPr0t3ct3d';

  mockMembers.set(memberId1, {
    _id: memberId1,
    name: 'Vikram Singh',
    email: 'vikram@sattwik.com',
    phone: '604-555-1111',
    passwordHash: mockPasswordHash,
    tokenVersion: 1,
    active: true,
    createdAt: new Date('2026-01-01')
  });

  mockMembers.set(memberId2, {
    _id: memberId2,
    name: 'Anil Sharma',
    email: 'anil@sattwik.com',
    phone: '604-555-2222',
    passwordHash: mockPasswordHash,
    tokenVersion: 1,
    active: true,
    createdAt: new Date('2026-01-02')
  });

  const orderId1 = new mongoose.Types.ObjectId().toString();
  mockOrders.set(orderId1, {
    _id: orderId1,
    orderId: '26102800001',
    customer: { firstName: 'Test', lastName: 'Customer', phone: '6045550000', email: 'test@example.com' },
    deliveryMemberId: null,
    items: [{ name: 'Lunch Tiffin', fulfillment: 'delivery', quantity: 1, price: 15 }],
    deliveryStatus: 'PENDING',
    type: 'tiffin'
  });

  // ─── Test 1: Admin Edit Delivery Member Details ────────────────────────────
  await t.test('1. Admin Edit: PUT /api/delivery-members/:id updates details and preserves auth fields', async () => {
    const handler = findHandler(deliveryMembersRouter, '/:id', 'put');
    assert.ok(handler, 'PUT /:id handler must exist in deliveryMembers router');

    const { req, res } = mockReqRes({
      method: 'PUT',
      params: { id: memberId1 },
      body: {
        name: 'Vikram S. Verma',
        email: 'vikram.v@sattwik.com',
        phone: '604-555-9999'
      },
      admin: { _id: 'admin1', role: 'admin' }
    });

    await handler(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res._json.member.name, 'Vikram S. Verma');
    assert.equal(res._json.member.email, 'vikram.v@sattwik.com');
    assert.equal(res._json.member.phone, '604-555-9999');

    // Verify DB persistence
    const saved = mockMembers.get(memberId1);
    assert.equal(saved.name, 'Vikram S. Verma');
    assert.equal(saved.email, 'vikram.v@sattwik.com');
    assert.equal(saved.phone, '604-555-9999');
    // Verify passwordHash & tokenVersion are untouched
    assert.equal(saved.passwordHash, mockPasswordHash, 'passwordHash must never be overwritten on edit');
    assert.equal(saved.tokenVersion, 1, 'tokenVersion must remain untouched');
  });

  // ─── Test 2: Validation of Edit Inputs ────────────────────────────────────
  await t.test('2. Admin Edit: Rejects missing required fields and email collisions', async () => {
    const handler = findHandler(deliveryMembersRouter, '/:id', 'put');

    // Missing name
    const resNoName = mockReqRes({
      params: { id: memberId1 },
      body: { name: '', email: 'test@sattwik.com', phone: '123' },
      admin: { _id: 'admin1' }
    });
    await handler(resNoName.req, resNoName.res);
    assert.equal(resNoName.res.statusCode, 400);

    // Duplicate email conflict with memberId2
    const resConflict = mockReqRes({
      params: { id: memberId1 },
      body: { name: 'Vikram', email: 'anil@sattwik.com', phone: '123' },
      admin: { _id: 'admin1' }
    });
    await handler(resConflict.req, resConflict.res);
    assert.equal(resConflict.res.statusCode, 409);
  });

  // ─── Test 3: Soft-Delete (Deactivate) via DELETE ──────────────────────────
  await t.test('3. Soft Delete: DELETE /api/delivery-members/:id marks active: false and preserves record', async () => {
    const handler = findHandler(deliveryMembersRouter, '/:id', 'delete');
    assert.ok(handler, 'DELETE /:id handler must exist in deliveryMembers router');

    const { req, res } = mockReqRes({
      method: 'DELETE',
      params: { id: memberId2 },
      admin: { _id: 'admin1', role: 'admin' }
    });

    await handler(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res._json.member.active, false);

    // Verify record STILL EXISTS in database (soft delete)
    const saved = mockMembers.get(memberId2);
    assert.ok(saved, 'Delivery member record must NOT be deleted from the database');
    assert.equal(saved.active, false, 'Member active status must be set to false');
    assert.equal(saved.name, 'Anil Sharma');
  });

  // ─── Test 4: Reactivate via PATCH /:id/status ─────────────────────────────
  await t.test('4. Reactivation: PATCH /api/delivery-members/:id/status toggles status to true without profile fields', async () => {
    const handler = findHandler(deliveryMembersRouter, '/:id/status', 'patch');
    assert.ok(handler, 'PATCH /:id/status handler must exist in deliveryMembers router');

    const { req, res } = mockReqRes({
      method: 'PATCH',
      params: { id: memberId2 },
      body: { active: true },
      admin: { _id: 'admin1', role: 'admin' }
    });

    await handler(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res._json.member.active, true);

    const saved = mockMembers.get(memberId2);
    assert.equal(saved.active, true, 'Member active status must be true in DB');
    // Ensure name, email, phone, and password were not erased
    assert.equal(saved.name, 'Anil Sharma');
    assert.equal(saved.email, 'anil@sattwik.com');
    assert.equal(saved.phone, '604-555-2222');
    assert.equal(saved.passwordHash, mockPasswordHash);
  });

  // ─── Test 4b: Status-only update via PUT accepts active boolean without profile fields ──
  await t.test('4b. Backend accepts status-only update via PUT /:id without requiring name, email, or phone', async () => {
    const handler = findHandler(deliveryMembersRouter, '/:id', 'put');
    assert.ok(handler, 'PUT /:id handler must exist in deliveryMembers router');

    // Deactivate memberId1 with status-only payload
    const { req, res } = mockReqRes({
      method: 'PUT',
      params: { id: memberId1 },
      body: { active: false },
      admin: { _id: 'admin1', role: 'admin' }
    });

    await handler(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res._json.member.active, false);

    const saved = mockMembers.get(memberId1);
    assert.equal(saved.active, false);
    // Profile details remain unchanged
    assert.equal(saved.name, 'Vikram S. Verma');
    assert.equal(saved.email, 'vikram.v@sattwik.com');
    assert.equal(saved.phone, '604-555-9999');
    assert.equal(saved.passwordHash, mockPasswordHash);

    // Restore memberId1 to active
    saved.active = true;
  });

  // ─── Test 5: Historical Integrity ─────────────────────────────────────────
  await t.test('5. Historical integrity: Previous assignments retained when member is deactivated', async () => {
    // Assign memberId2 to orderId1 while active
    mockOrders.get(orderId1).deliveryMemberId = memberId2;

    // Deactivate memberId2
    const delHandler = findHandler(deliveryMembersRouter, '/:id', 'delete');
    const { req, res } = mockReqRes({
      params: { id: memberId2 },
      admin: { _id: 'admin1' }
    });
    await delHandler(req, res);
    assert.equal(mockMembers.get(memberId2).active, false);

    // Verify the order STILL references memberId2 and member data is intact
    const order = mockOrders.get(orderId1);
    assert.equal(order.deliveryMemberId, memberId2);
    const assignedMember = mockMembers.get(order.deliveryMemberId);
    assert.ok(assignedMember, 'Assigned member must remain accessible in database');
    assert.equal(assignedMember.name, 'Anil Sharma');
  });

  // ─── Test 6: Backend Assignment Rejects Inactive Member ───────────────────
  await t.test('6. Backend enforcement: PUT /orders/:id/assign rejects inactive member with 400', async () => {
    // memberId2 is currently inactive
    const orderId2 = new mongoose.Types.ObjectId().toString();
    mockOrders.set(orderId2, {
      _id: orderId2,
      orderId: '26102800002',
      customer: { firstName: 'Test', lastName: 'Customer' },
      deliveryMemberId: null,
      items: [{ name: 'Dinner Tiffin', fulfillment: 'delivery', quantity: 1, price: 15 }],
      deliveryStatus: 'PENDING',
      type: 'tiffin'
    });

    const { req, res } = mockReqRes({
      method: 'PUT',
      params: { id: orderId2 },
      body: { deliveryMemberId: memberId2 },
      admin: { _id: 'admin1' }
    });

    await orderController.assignDeliveryMember(req, res);

    assert.equal(res.statusCode, 400);
    assert.ok(res._json.message.includes('inactive'), 'Response message must state member is inactive');
    assert.equal(mockOrders.get(orderId2).deliveryMemberId, null, 'Order deliveryMemberId must NOT be set');
  });

  // ─── Test 7: Backend Assignment Accepts Active Member ─────────────────────
  await t.test('7. Active member assignment: PUT /orders/:id/assign succeeds for active member', async () => {
    // memberId1 is active
    const orderId3 = new mongoose.Types.ObjectId().toString();
    mockOrders.set(orderId3, {
      _id: orderId3,
      orderId: '26102800003',
      customer: { firstName: 'Test', lastName: 'Customer' },
      deliveryMemberId: null,
      items: [{ name: 'Dinner Tiffin', fulfillment: 'delivery', quantity: 1, price: 15 }],
      deliveryStatus: 'PENDING',
      type: 'tiffin'
    });

    const { req, res } = mockReqRes({
      method: 'PUT',
      params: { id: orderId3 },
      body: { deliveryMemberId: memberId1 },
      admin: { _id: 'admin1' }
    });

    await orderController.assignDeliveryMember(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(mockOrders.get(orderId3).deliveryMemberId, memberId1);
  });

  // ─── Test 8: Frontend Select Rendering Logic ─────────────────────────────
  await t.test('8. Frontend dropdown: Active only for new assignments, inactive shown as disabled tag if assigned', () => {
    // Load helper from admin.js source
    const adminJs = fs.readFileSync(path.join(__dirname, '../admin/admin.js'), 'utf8');
    assert.ok(adminJs.includes('function renderDeliveryMemberSelectOptions'), 'renderDeliveryMemberSelectOptions must exist in admin.js');

    // Evaluate the helper function in a sandbox with escHtml defined
    const fnMatch = adminJs.match(/function renderDeliveryMemberSelectOptions\s*\([\s\S]*?\n\}/);
    assert.ok(fnMatch, 'renderDeliveryMemberSelectOptions must be found');

    const fnStr = fnMatch[0];
    const renderOptions = new Function(`
      function escHtml(str) {
        return String(str || '').replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m]);
      }
      return ${fnStr}
    `)();

    const sampleMembers = [
      { id: '1', name: 'Vikram', active: true },
      { id: '2', name: 'Anil', active: false },
      { id: '3', name: 'Sunil', active: true }
    ];

    // Case A: Unassigned order
    const optionsUnassigned = renderOptions(null, sampleMembers);
    assert.ok(optionsUnassigned.includes('value="1"'), 'Active member Vikram should be in dropdown');
    assert.ok(optionsUnassigned.includes('value="3"'), 'Active member Sunil should be in dropdown');
    assert.ok(!optionsUnassigned.includes('value="2"'), 'Inactive member Anil should NOT be in dropdown for unassigned order');

    // Case B: Order already assigned to inactive member Anil (id: 2)
    const optionsAssignedToInactive = renderOptions('2', sampleMembers);
    assert.ok(optionsAssignedToInactive.includes('value="2"'), 'Previously assigned inactive member should remain rendered');
    assert.ok(optionsAssignedToInactive.includes('(Inactive)'), 'Inactive member must have (Inactive) indicator');
    assert.ok(optionsAssignedToInactive.includes('selected'), 'Assigned inactive member must be selected');
    // Other active members still present to allow reassigning to an active member
    assert.ok(optionsAssignedToInactive.includes('value="1"'), 'Active members should be available as reassignment targets');
  });

  // ─── Test 9: Static UI Inspection: Dashboard HTML & Close Button ──────────
  await t.test('9. Static UI Inspection: Close button fix and edit form in dashboard.html', () => {
    const html = fs.readFileSync(path.join(__dirname, '../admin/dashboard.html'), 'utf8');

    // Verify modal close buttons exist and use member-details-close-btn
    assert.ok(html.includes('id="memberDetailsCloseBtn"'), '#memberDetailsCloseBtn must exist');
    assert.ok(html.includes('id="memberDetailsCloseFooterBtn"'), '#memberDetailsCloseFooterBtn must exist with distinct ID');
    assert.ok(html.includes('member-details-close-btn'), 'Both close buttons must have member-details-close-btn class');

    // Verify Edit button and separate status toggle button exist in Member Information
    assert.ok(html.includes('id="memberEditBtn"'), '#memberEditBtn must exist');
    assert.ok(html.includes('id="memberStatusToggleBtn"'), '#memberStatusToggleBtn must exist in Member Information header');
    assert.ok(html.includes('id="editDeliveryMemberForm"'), '#editDeliveryMemberForm must exist');
    assert.ok(html.includes('id="editDeliveryMemberName"'), '#editDeliveryMemberName input must exist');
    assert.ok(html.includes('id="editDeliveryMemberEmail"'), '#editDeliveryMemberEmail input must exist');
    assert.ok(html.includes('id="editDeliveryMemberPhone"'), '#editDeliveryMemberPhone input must exist');
    assert.ok(html.includes('id="cancelDeliveryMemberEditBtn"'), '#cancelDeliveryMemberEditBtn must exist');
    assert.ok(!html.includes('id="editDeliveryMemberStatus"'), '#editDeliveryMemberStatus must NOT exist in edit form (status is separate)');

    // Verify Delete / Deactivate button
    assert.ok(html.includes('id="memberDeleteBtn"'), '#memberDeleteBtn must exist');

    // Verify CSS styles in admin.css
    const css = fs.readFileSync(path.join(__dirname, '../admin/admin.css'), 'utf8');
    assert.ok(css.includes('.badge.active'), '.badge.active must be defined');
    assert.ok(css.includes('.badge.inactive'), '.badge.inactive must be defined');
    assert.ok(css.includes('.btn-success'), '.btn-success must be defined');
  });

  // ─── Test 10: Security & Admin Authentication Enforcement ──────────────────
  await t.test('10. Security: authRequired protects delivery member management endpoints', async () => {
    const { authRequired } = require('../server/middleware/auth');
    
    // Request without Authorization header
    const { req: unauthReq, res: unauthRes } = mockReqRes({ headers: {} });
    let nextCalled = false;
    await authRequired(unauthReq, unauthRes, () => { nextCalled = true; });

    assert.equal(unauthRes.statusCode, 401);
    assert.equal(nextCalled, false, 'next() must NOT be called without authorization');

    // Verify all delivery member admin routes have authRequired middleware attached
    const adminRoutes = [
      { path: '/', method: 'get' },
      { path: '/:id', method: 'get' },
      { path: '/', method: 'post' },
      { path: '/:id', method: 'put' },
      { path: '/:id/status', method: 'patch' },
      { path: '/:id', method: 'delete' }
    ];

    for (const { path: p, method: m } of adminRoutes) {
      const layer = deliveryMembersRouter.stack.find((l) => l.route && l.route.path === p && l.route.methods[m]);
      assert.ok(layer, `Route ${m.toUpperCase()} ${p} must exist`);
      const stackNames = layer.route.stack.map((s) => s.name);
      assert.ok(stackNames.includes('authRequired'), `Route ${m.toUpperCase()} ${p} must use authRequired middleware`);
    }
  });
});
