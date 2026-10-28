const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');

const DeliveryMember = require('../server/models/DeliveryMember');
const deliveryAuthRouter = require('../server/routes/deliveryAuth');
const deliveryMembersRouter = require('../server/routes/deliveryMembers');
const { signDeliveryToken } = require('../server/middleware/deliveryAuth');

// Helper to simulate express request and response
function mockReqRes({ method = 'GET', body = {}, params = {}, query = {}, headers = {}, deliveryMember = null, admin = null }) {
  const req = {
    method,
    body,
    params,
    query,
    headers: { ...headers },
    deliveryMember,
    admin
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

test('Delivery Member Profile Editing - Automated Test Suite', async (t) => {
  // Mock member store for tests without needing live MongoDB instance
  const mockMembers = new Map();

  // Save original mongoose methods
  const origFindById = DeliveryMember.findById;
  const origFindOne = DeliveryMember.findOne;
  const origFind = DeliveryMember.find;
  const origExists = DeliveryMember.exists;

  // Setup mock implementation
  DeliveryMember.findById = (id) => {
    const mem = mockMembers.get(String(id));
    return {
      select: (fields) => {
        if (!mem) return Promise.resolve(null);
        const copy = { ...mem };
        copy.save = async function () {
          mockMembers.set(String(this._id), { ...this });
          return this;
        };
        return Promise.resolve(copy);
      },
      lean: () => Promise.resolve(mem ? { ...mem } : null),
      then: (fn) => {
        if (!mem) return Promise.resolve(null).then(fn);
        const copy = { ...mem };
        copy.save = async function () {
          mockMembers.set(String(this._id), { ...this });
          return this;
        };
        return Promise.resolve(copy).then(fn);
      }
    };
  };

  DeliveryMember.findOne = (query) => {
    return {
      select: (fields) => {
        for (const mem of mockMembers.values()) {
          let match = true;
          if (query._id && String(mem._id) !== String(query._id)) match = false;
          if (query.email && mem.email !== query.email) match = false;
          if (query.active !== undefined && mem.active !== query.active) match = false;
          if (match) {
            const copy = { ...mem };
            copy.save = async function () {
              mockMembers.set(String(this._id), { ...this });
              return this;
            };
            return Promise.resolve(copy);
          }
        }
        return Promise.resolve(null);
      },
      lean: () => {
        for (const mem of mockMembers.values()) {
          let match = true;
          if (query._id && String(mem._id) !== String(query._id)) match = false;
          if (query.email && mem.email !== query.email) match = false;
          if (query.active !== undefined && mem.active !== query.active) match = false;
          if (match) return Promise.resolve({ ...mem });
        }
        return Promise.resolve(null);
      }
    };
  };

  DeliveryMember.exists = async (query) => {
    for (const mem of mockMembers.values()) {
      let match = true;
      if (query.email && mem.email !== query.email) match = false;
      if (query._id && query._id.$ne && String(mem._id) === String(query._id.$ne)) match = false;
      if (match) return { _id: mem._id };
    }
    return null;
  };

  DeliveryMember.find = () => ({
    select: () => ({
      sort: () => ({
        lean: () => Promise.resolve(Array.from(mockMembers.values()).map((m) => ({ ...m })))
      })
    })
  });

  t.after(() => {
    DeliveryMember.findById = origFindById;
    DeliveryMember.findOne = origFindOne;
    DeliveryMember.find = origFind;
    DeliveryMember.exists = origExists;
  });

  // Seed two mock delivery members
  const memberId1 = new mongoose.Types.ObjectId().toString();
  const memberId2 = new mongoose.Types.ObjectId().toString();
  const initialPassword = 'Password123!';
  const initialPasswordHash = bcrypt.hashSync(initialPassword, 12);

  mockMembers.set(memberId1, {
    _id: memberId1,
    name: 'Ramesh Patel',
    email: 'ramesh@sattwik.com',
    phone: '604-555-0101',
    passwordHash: initialPasswordHash,
    active: true,
    createdAt: new Date()
  });

  mockMembers.set(memberId2, {
    _id: memberId2,
    name: 'Suresh Kumar',
    email: 'suresh@sattwik.com',
    phone: '604-555-0202',
    passwordHash: initialPasswordHash,
    active: true,
    createdAt: new Date()
  });

  await t.test('1. Delivery member can load their profile via GET /me', async () => {
    const member = mockMembers.get(memberId1);
    const { req, res } = mockReqRes({
      method: 'GET',
      deliveryMember: member
    });

    const meRoute = deliveryAuthRouter.stack.find((r) => r.route && r.route.path === '/me' && r.route.methods.get);
    assert.ok(meRoute, 'GET /me route must exist');
    await meRoute.route.stack[meRoute.route.stack.length - 1].handle(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res._json.member.name, 'Ramesh Patel');
    assert.equal(res._json.member.email, 'ramesh@sattwik.com');
    assert.equal(res._json.member.phone, '604-555-0101');
    assert.equal(res._json.member.passwordHash, undefined, 'passwordHash must never be exposed');
  });

  await t.test('2. Delivery member can update personal details without changing password', async () => {
    const member = mockMembers.get(memberId1);
    const { req, res } = mockReqRes({
      method: 'PUT',
      deliveryMember: member,
      body: {
        name: 'Ramesh K. Patel',
        email: 'ramesh.new@sattwik.com',
        phone: '604-555-9999'
      }
    });

    const updateHandler = deliveryAuthRouter.updateDeliveryMemberProfile;
    assert.ok(updateHandler, 'updateDeliveryMemberProfile must be exported');
    await updateHandler(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res._json.message, 'Profile updated successfully');
    assert.equal(res._json.reauthRequired, false);
    assert.ok(res._json.token, 'Updated token should be returned');
    assert.equal(res._json.member.name, 'Ramesh K. Patel');
    assert.equal(res._json.member.email, 'ramesh.new@sattwik.com');
    assert.equal(res._json.member.phone, '604-555-9999');

    // Verify persistence in mockMembers
    const updated = mockMembers.get(memberId1);
    assert.equal(updated.name, 'Ramesh K. Patel');
    assert.equal(updated.email, 'ramesh.new@sattwik.com');
    assert.equal(updated.phone, '604-555-9999');
    assert.equal(updated.passwordHash, initialPasswordHash, 'Password must remain unchanged');
  });

  await t.test('3. Duplicate email address is rejected with 409 conflict', async () => {
    const member = mockMembers.get(memberId1);
    const { req, res } = mockReqRes({
      method: 'PUT',
      deliveryMember: member,
      body: {
        name: 'Ramesh Patel',
        email: 'suresh@sattwik.com', // Already used by memberId2
        phone: '604-555-0101'
      }
    });

    await deliveryAuthRouter.updateDeliveryMemberProfile(req, res);
    assert.equal(res.statusCode, 409);
    assert.ok(res._json.message.includes('already exists'));

    // Verify member 1 email was NOT modified
    const current = mockMembers.get(memberId1);
    assert.notEqual(current.email, 'suresh@sattwik.com');
  });

  await t.test('4. Empty name or invalid email are rejected with 400', async () => {
    const member = mockMembers.get(memberId1);

    // Empty name
    const { req: req1, res: res1 } = mockReqRes({
      method: 'PUT',
      deliveryMember: member,
      body: { name: '   ', email: 'ramesh@sattwik.com', phone: '123' }
    });
    await deliveryAuthRouter.updateDeliveryMemberProfile(req1, res1);
    assert.equal(res1.statusCode, 400);
    assert.equal(res1._json.message, 'Name is required');

    // Invalid email
    const { req: req2, res: res2 } = mockReqRes({
      method: 'PUT',
      deliveryMember: member,
      body: { name: 'Ramesh', email: 'notanemail', phone: '123' }
    });
    await deliveryAuthRouter.updateDeliveryMemberProfile(req2, res2);
    assert.equal(res2.statusCode, 400);
    assert.equal(res2._json.message, 'Enter a valid email address');
  });

  await t.test('5. Changing password with incorrect current password is rejected with 401', async () => {
    const member = mockMembers.get(memberId1);
    const prevName = member.name;

    const { req, res } = mockReqRes({
      method: 'PUT',
      deliveryMember: member,
      body: {
        name: 'Should Not Change',
        email: member.email,
        phone: member.phone,
        currentPassword: 'WrongPassword!',
        newPassword: 'BrandNewPassword123!',
        confirmPassword: 'BrandNewPassword123!'
      }
    });

    await deliveryAuthRouter.updateDeliveryMemberProfile(req, res);
    assert.equal(res.statusCode, 401);
    assert.equal(res._json.message, 'Current password is incorrect');

    // Verify profile was NOT changed
    const current = mockMembers.get(memberId1);
    assert.equal(current.name, prevName);
    assert.equal(current.passwordHash, initialPasswordHash);
  });

  await t.test('6. Changing password with mismatched confirmPassword is rejected with 400', async () => {
    const member = mockMembers.get(memberId1);
    const { req, res } = mockReqRes({
      method: 'PUT',
      deliveryMember: member,
      body: {
        name: member.name,
        email: member.email,
        phone: member.phone,
        currentPassword: initialPassword,
        newPassword: 'BrandNewPassword123!',
        confirmPassword: 'DifferentPassword123!'
      }
    });

    await deliveryAuthRouter.updateDeliveryMemberProfile(req, res);
    assert.equal(res.statusCode, 400);
    assert.equal(res._json.message, 'New passwords do not match');
  });

  await t.test('7. Changing password with short new password (< 8 chars) is rejected with 400', async () => {
    const member = mockMembers.get(memberId1);
    const { req, res } = mockReqRes({
      method: 'PUT',
      deliveryMember: member,
      body: {
        name: member.name,
        email: member.email,
        phone: member.phone,
        currentPassword: initialPassword,
        newPassword: 'short',
        confirmPassword: 'short'
      }
    });

    await deliveryAuthRouter.updateDeliveryMemberProfile(req, res);
    assert.equal(res.statusCode, 400);
    assert.equal(res._json.message, 'New password must be at least 8 characters');
  });

  await t.test('8. Changing password with valid current password updates hash and requires reauth', async () => {
    const member = mockMembers.get(memberId1);
    const newPassword = 'BrandNewSecurePassword123!';

    const { req, res } = mockReqRes({
      method: 'PUT',
      deliveryMember: member,
      body: {
        name: 'Ramesh K. Patel',
        email: 'ramesh.updated@sattwik.com',
        phone: '604-555-8888',
        currentPassword: initialPassword,
        newPassword: newPassword,
        confirmPassword: newPassword
      }
    });

    await deliveryAuthRouter.updateDeliveryMemberProfile(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res._json.reauthRequired, true);
    assert.ok(res._json.message.includes('updated successfully'));
    assert.equal(res._json.member.passwordHash, undefined, 'passwordHash must never be returned');

    // Verify hash changed and verifies against new password
    const updated = mockMembers.get(memberId1);
    assert.notEqual(updated.passwordHash, initialPasswordHash);
    assert.ok(bcrypt.compareSync(newPassword, updated.passwordHash), 'New password must match updated hash');
    assert.ok(!bcrypt.compareSync(initialPassword, updated.passwordHash), 'Old password must no longer match');
  });

  await t.test('9. Admin delivery members endpoint reflects latest saved details', async () => {
    const { req, res } = mockReqRes({
      method: 'GET',
      admin: { id: 'admin-1', role: 'admin' }
    });

    const listRoute = deliveryMembersRouter.stack.find((r) => r.route && r.route.path === '/' && r.route.methods.get);
    assert.ok(listRoute, 'Admin GET / route must exist in deliveryMembersRouter');
    await listRoute.route.stack[listRoute.route.stack.length - 1].handle(req, res);

    assert.equal(res.statusCode, 200);
    assert.ok(Array.isArray(res._json.members));
    const member1InAdmin = res._json.members.find((m) => m.id === memberId1);
    assert.ok(member1InAdmin, 'Updated member must be present in admin listing');
    assert.equal(member1InAdmin.name, 'Ramesh K. Patel');
    assert.equal(member1InAdmin.email, 'ramesh.updated@sattwik.com');
    assert.equal(member1InAdmin.phone, '604-555-8888');
    assert.equal(member1InAdmin.passwordHash, undefined, 'No passwordHash in admin list');
  });

  await t.test('10. PUT /me route is registered on deliveryMembers router and works', async () => {
    const member = mockMembers.get(memberId2);
    const { req, res } = mockReqRes({
      method: 'PUT',
      deliveryMember: member,
      body: {
        name: 'Suresh Updated',
        email: 'suresh@sattwik.com',
        phone: '604-555-7777'
      }
    });

    const putMeRoute = deliveryMembersRouter.stack.find((r) => r.route && r.route.path === '/me' && r.route.methods.put);
    assert.ok(putMeRoute, 'PUT /me route must exist in deliveryMembersRouter');
    await putMeRoute.route.stack[putMeRoute.route.stack.length - 1].handle(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res._json.member.name, 'Suresh Updated');
    assert.equal(res._json.member.phone, '604-555-7777');
  });

  await t.test('11. Protected fields cannot be overridden by client input', async () => {
    const member = mockMembers.get(memberId2);
    const { req, res } = mockReqRes({
      method: 'PUT',
      deliveryMember: member,
      body: {
        _id: 'fake-id',
        active: false,
        role: 'superadmin',
        passwordHash: 'injected-hash',
        name: 'Suresh Kumar',
        email: 'suresh@sattwik.com',
        phone: '604-555-0202'
      }
    });

    await deliveryAuthRouter.updateDeliveryMemberProfile(req, res);
    assert.equal(res.statusCode, 200);

    const mem = mockMembers.get(memberId2);
    assert.equal(mem._id, memberId2, '_id must never be modified');
    assert.equal(mem.active, true, 'active flag must not be modified by member');
    assert.notEqual(mem.passwordHash, 'injected-hash');
  });

  await t.test('12. Frontend markup and styles verify Edit Profile refinement and removal of redundant Change Password', () => {
    const htmlPath = path.join(__dirname, '..', 'delivery', 'dashboard.html');
    const html = fs.readFileSync(htmlPath, 'utf8');

    // Verify separate Change Password button and modal are REMOVED
    assert.ok(!html.includes('id="changePasswordBtn"'), 'dashboard.html must not include #changePasswordBtn');
    assert.ok(!html.includes('id="changePasswordModal"'), 'dashboard.html must not include #changePasswordModal');

    // Verify Edit Profile elements are present
    assert.ok(html.includes('id="editProfileBtn"'), 'dashboard.html must include #editProfileBtn');
    assert.ok(html.includes('id="editProfileModal"'), 'dashboard.html must include #editProfileModal');
    assert.ok(html.includes('id="editProfileForm"'), 'dashboard.html must include #editProfileForm');
    assert.ok(html.includes('id="editProfileName"'), 'dashboard.html must include #editProfileName');
    assert.ok(html.includes('id="editProfileEmail"'), 'dashboard.html must include #editProfileEmail');
    assert.ok(html.includes('id="editProfilePhone"'), 'dashboard.html must include #editProfilePhone');
    assert.ok(html.includes('id="editCurrentPassword"'), 'dashboard.html must include #editCurrentPassword');
    assert.ok(html.includes('id="editNewPassword"'), 'dashboard.html must include #editNewPassword');
    assert.ok(html.includes('id="editConfirmPassword"'), 'dashboard.html must include #editConfirmPassword');
    assert.ok(html.includes('id="saveProfileBtn"'), 'dashboard.html must include #saveProfileBtn');
    assert.ok(html.includes('id="cancelProfileBtn"'), 'dashboard.html must include #cancelProfileBtn');
    assert.ok(html.includes('id="editProfileMessage"'), 'dashboard.html must include #editProfileMessage');

    const cssPath = path.join(__dirname, '..', 'delivery', 'delivery.css');
    const css = fs.readFileSync(cssPath, 'utf8');
    assert.ok(css.includes('.profile-modal-content'), 'delivery.css must include .profile-modal-content');
    assert.ok(css.includes('.profile-section-heading'), 'delivery.css must include .profile-section-heading');
    assert.ok(css.includes('.form-grid'), 'delivery.css must include .form-grid');
    assert.ok(css.includes('.profile-modal-actions'), 'delivery.css must include .profile-modal-actions');

    const jsPath = path.join(__dirname, '..', 'delivery', 'delivery.js');
    const js = fs.readFileSync(jsPath, 'utf8');
    assert.ok(js.includes('/delivery-auth/profile'), 'delivery.js must call /delivery-auth/profile');
    assert.ok(js.includes('openEditProfileModal'), 'delivery.js must implement openEditProfileModal');
    assert.ok(js.includes('closeEditProfileModal'), 'delivery.js must implement closeEditProfileModal');
    assert.ok(!js.includes('changePasswordBtn?.addEventListener'), 'delivery.js must not retain obsolete changePasswordBtn handler');
  });
});
