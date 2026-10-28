'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const Customer = require('../server/models/Customer');
const DeliveryMember = require('../server/models/DeliveryMember');
const Admin = require('../server/models/Admin');
const PasswordResetToken = require('../server/models/PasswordResetToken');

const passwordResetRouter = require('../server/routes/passwordReset');
const authRouter = require('../server/routes/auth');
const customerAuthRouter = require('../server/routes/customerAuth');
const deliveryAuthRouter = require('../server/routes/deliveryAuth');

const { signToken, authRequired } = require('../server/middleware/auth');
const { signCustomerToken, customerAuthRequired } = require('../server/middleware/customerAuth');
const { signDeliveryToken, deliveryAuthRequired } = require('../server/middleware/deliveryAuth');

const { checkRateLimit, resetRateLimits } = require('../server/utils/rateLimiter');
const { getDevLastResetToken, clearDevOutbox } = require('../server/utils/emailService');

function mockReqRes({ method = 'POST', body = {}, params = {}, query = {}, headers = {}, ip = '127.0.0.1' } = {}) {
  const req = {
    method,
    body,
    params,
    query,
    headers: { ...headers },
    ip,
    connection: { remoteAddress: ip },
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

test('Sattwik Kitchen: Comprehensive Password Reset Test Suite', async (t) => {
  // ─── 1. Static HTML Inspection: Forgot Password link on each login page ───
  await t.test('1. Static HTML: Each login page links to fixed account-type flow without account-type selectors', () => {
    const adminHtml = fs.readFileSync(path.join(__dirname, '../admin/login.html'), 'utf8');
    assert.ok(adminHtml.includes('forgot-password.html?type=admin'), 'Admin login page must link to forgot-password with type=admin');
    assert.ok(adminHtml.includes('Forgot Password?'), 'Admin login page must display Forgot Password? text');

    const deliveryHtml = fs.readFileSync(path.join(__dirname, '../delivery/login.html'), 'utf8');
    assert.ok(deliveryHtml.includes('forgot-password.html?type=delivery'), 'Delivery login page must link to forgot-password with type=delivery');
    assert.ok(deliveryHtml.includes('Forgot Password?'), 'Delivery login page must display Forgot Password? text');

    const customerHtml = fs.readFileSync(path.join(__dirname, '../customer/login.html'), 'utf8');
    assert.ok(customerHtml.includes('forgot-password.html?type=customer'), 'Customer login page must link to forgot-password with type=customer');
    assert.ok(customerHtml.includes('Forgot Password?'), 'Customer login page must display Forgot Password? text');

    // Also verify dedicated pages exist and have no account-type selectors
    const forgotHtml = fs.readFileSync(path.join(__dirname, '../public/forgot-password.html'), 'utf8');
    assert.ok(!forgotHtml.includes('Select Account Type'), 'forgot-password.html must NOT contain "Select Account Type"');
    assert.ok(!forgotHtml.includes('class="type-pill'), 'forgot-password.html must NOT contain .type-pill selector buttons');
    assert.ok(forgotHtml.includes('Reset Customer Password'), 'forgot-password.html must support Reset Customer Password');
    assert.ok(forgotHtml.includes('Reset Delivery Member Password'), 'forgot-password.html must support Reset Delivery Member Password');
    assert.ok(forgotHtml.includes('Reset Admin Password'), 'forgot-password.html must support Reset Admin Password');
    assert.ok(forgotHtml.includes('invalidContainer'), 'forgot-password.html must contain invalid/missing type handling');

    const resetHtml = fs.readFileSync(path.join(__dirname, '../public/reset-password.html'), 'utf8');
    assert.ok(resetHtml.includes('Reset Customer Password'), 'reset-password.html must support customer heading');
    assert.ok(resetHtml.includes('Reset Delivery Member Password'), 'reset-password.html must support delivery heading');
    assert.ok(resetHtml.includes('Reset Admin Password'), 'reset-password.html must support admin heading');
  });

  // ─── 2. Generic Response for Reset Requests ──────────────────────────────
  await t.test('2. Reset request returns identical generic message for existing and non-existing accounts', async () => {
    clearDevOutbox();
    resetRateLimits();

    const origCustFindOne = Customer.findOne;
    Customer.findOne = (query) => {
      if (query.email === 'registered@example.com') {
        return Promise.resolve({
          _id: new mongoose.Types.ObjectId(),
          email: 'registered@example.com',
          firstName: 'Alice',
          lastName: 'Customer'
        });
      }
      return Promise.resolve(null);
    };

    const origTokenCreate = PasswordResetToken.create;
    const origTokenUpdateMany = PasswordResetToken.updateMany;
    PasswordResetToken.create = () => Promise.resolve({});
    PasswordResetToken.updateMany = () => Promise.resolve({});

    try {
      const requestHandler = passwordResetRouter.stack.find((s) => s.route?.path === '/request')?.route?.stack[0]?.handle;
      assert.ok(requestHandler, 'Password reset POST /request handler must exist');

      // Existing customer
      const { req: req1, res: res1 } = mockReqRes({
        body: { email: 'registered@example.com', accountType: 'customer' }
      });
      await requestHandler(req1, res1);

      // Non-existent customer
      const { req: req2, res: res2 } = mockReqRes({
        body: { email: 'nonexistent@example.com', accountType: 'customer' }
      });
      await requestHandler(req2, res2);

      assert.equal(res1.statusCode, 200);
      assert.equal(res2.statusCode, 200);
      assert.equal(res1._json.message, res2._json.message, 'Responses must be completely identical');
      assert.ok(res1._json.message.includes('If an account exists with that email address'));
    } finally {
      Customer.findOne = origCustFindOne;
      PasswordResetToken.create = origTokenCreate;
      PasswordResetToken.updateMany = origTokenUpdateMany;
    }
  });

  // ─── 3. Password Reset for Customer ──────────────────────────────────────
  await t.test('3. Customer: Valid token allows password reset, updates hash, and invalidates old sessions', async () => {
    clearDevOutbox();
    resetRateLimits();

    const mockCustomerId = new mongoose.Types.ObjectId();
    const oldPassword = 'OldCustomerPassword123';
    const newPassword = 'NewCustomerPassword456';

    const customerDoc = {
      _id: mockCustomerId,
      email: 'customer.test@example.com',
      firstName: 'Test',
      lastName: 'User',
      passwordHash: bcrypt.hashSync(oldPassword, 10),
      tokenVersion: 0,
      save: async function () { return this; }
    };

    const mockTokenDoc = {
      _id: new mongoose.Types.ObjectId(),
      tokenHash: 'mock-token-hash-cust',
      accountType: 'customer',
      accountId: mockCustomerId,
      email: 'customer.test@example.com',
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
      usedAt: null
    };

    const origCustFindById = Customer.findById;
    const origCustFindOne = Customer.findOne;
    const origTokenFindOneAndUpdate = PasswordResetToken.findOneAndUpdate;
    const origTokenFindOne = PasswordResetToken.findOne;
    const origTokenUpdateMany = PasswordResetToken.updateMany;

    Customer.findById = (id) => ({
      lean: () => Promise.resolve(String(id) === String(mockCustomerId) ? customerDoc : null),
      then: (fn) => Promise.resolve(String(id) === String(mockCustomerId) ? customerDoc : null).then(fn)
    });
    Customer.findOne = () => Promise.resolve(customerDoc);
    PasswordResetToken.findOneAndUpdate = () => Promise.resolve(mockTokenDoc);
    PasswordResetToken.findOne = () => ({ lean: () => Promise.resolve(mockTokenDoc) });
    PasswordResetToken.updateMany = () => Promise.resolve({});

    try {
      // 1. Existing token signs with tv: 0
      const oldSessionToken = signCustomerToken(customerDoc);

      // 2. Perform password reset
      const { req, res } = mockReqRes({
        body: {
          token: 'customer-reset-token-abc',
          accountType: 'customer',
          password: newPassword,
          confirmPassword: newPassword
        }
      });

      // Find route handler in router stack
      const resetHandler = passwordResetRouter.stack.find((s) => s.route?.path === '/reset')?.route?.stack[0]?.handle;
      assert.ok(resetHandler, 'Password reset POST /reset handler must exist');

      await resetHandler(req, res);

      assert.equal(res.statusCode, 200);
      assert.ok(res._json.message.includes('Your password has been reset successfully'));

      // 3. New password hash is stored and verifies with bcrypt
      assert.ok(bcrypt.compareSync(newPassword, customerDoc.passwordHash), 'New password must match stored hash');
      assert.equal(bcrypt.compareSync(oldPassword, customerDoc.passwordHash), false, 'Old password must NOT match stored hash');

      // 4. tokenVersion incremented
      assert.equal(customerDoc.tokenVersion, 1, 'tokenVersion must be incremented to 1');

      // 5. Old session token (carrying tv: 0) is rejected by customerAuthRequired
      const reqOldAuth = {
        headers: { authorization: `Bearer ${oldSessionToken}` }
      };
      const resOldAuth = {
        statusCode: 200,
        status(code) { this.statusCode = code; return this; },
        json(data) { this._json = data; return this; }
      };

      await customerAuthRequired(reqOldAuth, resOldAuth, () => {});
      assert.equal(resOldAuth.statusCode, 401, 'Old session token must be rejected with 401');
      assert.ok(resOldAuth._json.message.includes('Password changed'));
    } finally {
      Customer.findById = origCustFindById;
      Customer.findOne = origCustFindOne;
      PasswordResetToken.findOneAndUpdate = origTokenFindOneAndUpdate;
      PasswordResetToken.findOne = origTokenFindOne;
      PasswordResetToken.updateMany = origTokenUpdateMany;
    }
  });

  // ─── 4. Password Reset for Delivery Member ────────────────────────────────
  await t.test('4. Delivery Member: Valid token allows password reset, updates hash, and invalidates old sessions', async () => {
    clearDevOutbox();
    resetRateLimits();

    const mockMemberId = new mongoose.Types.ObjectId();
    const oldPassword = 'OldDeliveryPassword123';
    const newPassword = 'NewDeliveryPassword456';

    const deliveryDoc = {
      _id: mockMemberId,
      name: 'Rohan Driver',
      email: 'rohan.delivery@example.com',
      passwordHash: bcrypt.hashSync(oldPassword, 10),
      tokenVersion: 0,
      active: true,
      save: async function () { return this; }
    };

    const mockTokenDoc = {
      _id: new mongoose.Types.ObjectId(),
      tokenHash: 'mock-token-hash-del',
      accountType: 'delivery',
      accountId: mockMemberId,
      email: 'rohan.delivery@example.com',
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
      usedAt: null
    };

    const origDelFindById = DeliveryMember.findById;
    const origDelFindOne = DeliveryMember.findOne;
    const origTokenFindOneAndUpdate = PasswordResetToken.findOneAndUpdate;
    const origTokenUpdateMany = PasswordResetToken.updateMany;

    DeliveryMember.findById = (id) => Promise.resolve(String(id) === String(mockMemberId) ? deliveryDoc : null);
    DeliveryMember.findOne = () => ({
      select: () => Promise.resolve(deliveryDoc),
      lean: () => Promise.resolve(deliveryDoc)
    });
    PasswordResetToken.findOneAndUpdate = () => Promise.resolve(mockTokenDoc);
    PasswordResetToken.updateMany = () => Promise.resolve({});

    try {
      const oldSessionToken = signDeliveryToken(deliveryDoc);

      const { req, res } = mockReqRes({
        body: {
          token: 'delivery-reset-token-xyz',
          accountType: 'delivery',
          password: newPassword,
          confirmPassword: newPassword
        }
      });

      const resetHandler = passwordResetRouter.stack.find((s) => s.route?.path === '/reset')?.route?.stack[0]?.handle;
      await resetHandler(req, res);

      assert.equal(res.statusCode, 200);
      assert.ok(bcrypt.compareSync(newPassword, deliveryDoc.passwordHash), 'New password must verify with bcrypt');
      assert.equal(bcrypt.compareSync(oldPassword, deliveryDoc.passwordHash), false, 'Old password must fail');
      assert.equal(deliveryDoc.tokenVersion, 1, 'DeliveryMember tokenVersion must be bumped to 1');

      // Old session is rejected
      const reqOldAuth = { headers: { authorization: `Bearer ${oldSessionToken}` } };
      const resOldAuth = {
        statusCode: 200,
        status(code) { this.statusCode = code; return this; },
        json(data) { this._json = data; return this; }
      };

      await deliveryAuthRequired(reqOldAuth, resOldAuth, () => {});
      assert.equal(resOldAuth.statusCode, 401, 'Old session token must be rejected with 401');
    } finally {
      DeliveryMember.findById = origDelFindById;
      DeliveryMember.findOne = origDelFindOne;
      PasswordResetToken.findOneAndUpdate = origTokenFindOneAndUpdate;
      PasswordResetToken.updateMany = origTokenUpdateMany;
    }
  });

  // ─── 5. Password Reset for Admin & Superadmin ─────────────────────────────
  await t.test('5. Admin & Superadmin: Valid token resets admin/superadmin password and invalidates tokens', async () => {
    clearDevOutbox();
    resetRateLimits();

    const mockAdminId = new mongoose.Types.ObjectId();
    const oldPassword = 'OldAdminPassword123';
    const newPassword = 'NewAdminPassword456';

    const adminDoc = {
      _id: mockAdminId,
      email: 'admin@sattwikkitchen.com',
      name: 'Primary Admin',
      role: 'superadmin',
      passwordHash: bcrypt.hashSync(oldPassword, 10),
      tokenVersion: 2,
      save: async function () { return this; }
    };

    const mockTokenDoc = {
      _id: new mongoose.Types.ObjectId(),
      tokenHash: 'mock-token-hash-admin',
      accountType: 'admin',
      accountId: mockAdminId,
      email: 'admin@sattwikkitchen.com',
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
      usedAt: null
    };

    const origAdminFindById = Admin.findById;
    const origAdminFindOne = Admin.findOne;
    const origTokenFindOneAndUpdate = PasswordResetToken.findOneAndUpdate;
    const origTokenUpdateMany = PasswordResetToken.updateMany;

    Admin.findById = (id) => ({
      lean: () => Promise.resolve(String(id) === String(mockAdminId) ? adminDoc : null),
      then: (fn) => Promise.resolve(String(id) === String(mockAdminId) ? adminDoc : null).then(fn)
    });
    Admin.findOne = () => Promise.resolve(adminDoc);
    PasswordResetToken.findOneAndUpdate = () => Promise.resolve(mockTokenDoc);
    PasswordResetToken.updateMany = () => Promise.resolve({});

    try {
      const oldSessionToken = signToken(adminDoc);

      const { req, res } = mockReqRes({
        body: {
          token: 'admin-reset-token-123',
          accountType: 'admin',
          password: newPassword,
          confirmPassword: newPassword
        }
      });

      const resetHandler = passwordResetRouter.stack.find((s) => s.route?.path === '/reset')?.route?.stack[0]?.handle;
      await resetHandler(req, res);

      assert.equal(res.statusCode, 200);
      assert.ok(bcrypt.compareSync(newPassword, adminDoc.passwordHash), 'New password must match');
      assert.equal(bcrypt.compareSync(oldPassword, adminDoc.passwordHash), false, 'Old password must fail');
      assert.equal(adminDoc.tokenVersion, 3, 'tokenVersion must be incremented to 3');

      // Old session with tv: 2 is rejected
      const reqOldAuth = { headers: { authorization: `Bearer ${oldSessionToken}` } };
      const resOldAuth = {
        statusCode: 200,
        status(code) { this.statusCode = code; return this; },
        json(data) { this._json = data; return this; }
      };

      await authRequired(reqOldAuth, resOldAuth, () => {});
      assert.equal(resOldAuth.statusCode, 401, 'Old session token must be rejected with 401');
      assert.ok(resOldAuth._json.message.includes('Password changed'));
    } finally {
      Admin.findById = origAdminFindById;
      Admin.findOne = origAdminFindOne;
      PasswordResetToken.findOneAndUpdate = origTokenFindOneAndUpdate;
      PasswordResetToken.updateMany = origTokenUpdateMany;
    }
  });

  // ─── 6. Rejection of Invalid, Expired, and Reused Tokens ──────────────────
  await t.test('6. Rejection: Invalid, expired, or reused tokens return 400', async () => {
    const origFindOneAndUpdate = PasswordResetToken.findOneAndUpdate;
    PasswordResetToken.findOneAndUpdate = () => Promise.resolve(null); // atomic find failed

    try {
      const { req, res } = mockReqRes({
        body: {
          token: 'already-used-or-expired-token',
          accountType: 'customer',
          password: 'Password123!',
          confirmPassword: 'Password123!'
        }
      });

      const resetHandler = passwordResetRouter.stack.find((s) => s.route?.path === '/reset')?.route?.stack[0]?.handle;
      await resetHandler(req, res);

      assert.equal(res.statusCode, 400);
      assert.ok(res._json.message.includes('invalid, expired, or has already been used'));
    } finally {
      PasswordResetToken.findOneAndUpdate = origFindOneAndUpdate;
    }
  });

  // ─── 7. Cross-Account Boundary Security & Invalid Account Types ──────────
  await t.test('7. Boundary Security: Rejects missing, invalid, or cross-account account-type values across request, verify, and reset endpoints', async () => {
    const requestHandler = passwordResetRouter.stack.find((s) => s.route?.path === '/request')?.route?.stack[0]?.handle;
    const verifyHandler = passwordResetRouter.stack.find((s) => s.route?.path === '/verify')?.route?.stack[0]?.handle;
    const resetHandler = passwordResetRouter.stack.find((s) => s.route?.path === '/reset')?.route?.stack[0]?.handle;

    // A. Request endpoint rejects missing or invalid accountType
    const { req: reqReq1, res: resReq1 } = mockReqRes({ body: { email: 'user@example.com' } });
    await requestHandler(reqReq1, resReq1);
    assert.equal(resReq1.statusCode, 400, 'POST /request without accountType must return 400');
    assert.ok(resReq1._json.message.includes('valid account type'));

    const { req: reqReq2, res: resReq2 } = mockReqRes({ body: { email: 'user@example.com', accountType: 'invalid_role' } });
    await requestHandler(reqReq2, resReq2);
    assert.equal(resReq2.statusCode, 400, 'POST /request with invalid accountType must return 400');

    // B. Verify endpoint rejects missing or invalid type
    const { req: reqVer1, res: resVer1 } = mockReqRes({ method: 'GET', query: { token: 'abc' } });
    await verifyHandler(reqVer1, resVer1);
    assert.equal(resVer1.statusCode, 400, 'GET /verify without type must return 400');

    const { req: reqVer2, res: resVer2 } = mockReqRes({ method: 'GET', query: { token: 'abc', type: 'hacker' } });
    await verifyHandler(reqVer2, resVer2);
    assert.equal(resVer2.statusCode, 400, 'GET /verify with invalid type must return 400');

    // C. Reset endpoint rejects missing or invalid accountType
    const { req: reqRes1, res: resRes1 } = mockReqRes({ body: { token: 'abc', password: 'Password123!', confirmPassword: 'Password123!' } });
    await resetHandler(reqRes1, resRes1);
    assert.equal(resRes1.statusCode, 400, 'POST /reset without accountType must return 400');

    // D. Cross-account tamper protection
    const origFindOneAndUpdate = PasswordResetToken.findOneAndUpdate;
    PasswordResetToken.findOneAndUpdate = (query) => {
      // Simulate MongoDB query: accountType must match exactly
      if (query.accountType === 'admin') {
        return Promise.resolve(null); // Token was issued for customer, not admin!
      }
      return Promise.resolve({});
    };

    try {
      const { req, res } = mockReqRes({
        body: {
          token: 'customer-token-trying-admin-reset',
          accountType: 'admin',
          password: 'HackerPassword123',
          confirmPassword: 'HackerPassword123'
        }
      });

      await resetHandler(req, res);

      assert.equal(res.statusCode, 400);
      assert.ok(res._json.message.includes('invalid, expired, or has already been used'));
    } finally {
      PasswordResetToken.findOneAndUpdate = origFindOneAndUpdate;
    }
  });

  // ─── 8. Rate Limiting Protection ──────────────────────────────────────────
  await t.test('8. Rate Limiting: Rejects excessive reset requests (> 5 requests) with 429', async () => {
    resetRateLimits();
    const testIp = '192.168.1.100';

    for (let i = 0; i < 5; i++) {
      const status = checkRateLimit(`ip:${testIp}`, { max: 5, windowMs: 15 * 60 * 1000 });
      assert.equal(status.allowed, true, `Request ${i + 1} should be allowed`);
    }

    // 6th request must be blocked
    const blocked = checkRateLimit(`ip:${testIp}`, { max: 5, windowMs: 15 * 60 * 1000 });
    assert.equal(blocked.allowed, false, '6th request must be rejected by rate limiter');
    assert.ok(blocked.retryAfterSeconds > 0, 'Retry after seconds must be provided');

    resetRateLimits();
  });

  // ─── 9. Input & Policy Validation ─────────────────────────────────────────
  await t.test('9. Validation: Rejects short passwords (< 8 chars) and mismatched passwords with 400', async () => {
    const resetHandler = passwordResetRouter.stack.find((s) => s.route?.path === '/reset')?.route?.stack[0]?.handle;

    // Short password
    const { req: req1, res: res1 } = mockReqRes({
      body: {
        token: 'valid-token',
        accountType: 'customer',
        password: 'short',
        confirmPassword: 'short'
      }
    });
    await resetHandler(req1, res1);
    assert.equal(res1.statusCode, 400);
    assert.ok(res1._json.message.includes('at least 8 characters'));

    // Mismatched passwords
    const { req: req2, res: res2 } = mockReqRes({
      body: {
        token: 'valid-token',
        accountType: 'customer',
        password: 'Password123!',
        confirmPassword: 'DifferentPassword123!'
      }
    });
    await resetHandler(req2, res2);
    assert.equal(res2.statusCode, 400);
    assert.ok(res2._json.message.includes('Passwords do not match'));
  });

  // ─── 10. Verify Token Endpoint ───────────────────────────────────────────
  await t.test('10. GET /api/password-reset/verify correctly validates active tokens and returns masked email', async () => {
    const mockTokenDoc = {
      _id: new mongoose.Types.ObjectId(),
      tokenHash: 'hash-abc',
      accountType: 'customer',
      email: 'sowjanya.customer@gmail.com',
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
      usedAt: null
    };

    const origTokenFindOne = PasswordResetToken.findOne;
    PasswordResetToken.findOne = (query) => ({
      lean: () => {
        if (query.accountType === 'customer') return Promise.resolve(mockTokenDoc);
        return Promise.resolve(null);
      }
    });

    try {
      const verifyHandler = passwordResetRouter.stack.find((s) => s.route?.path === '/verify')?.route?.stack[0]?.handle;

      // Valid customer token
      const { req: req1, res: res1 } = mockReqRes({
        method: 'GET',
        query: { token: 'valid-token-raw', type: 'customer' }
      });
      await verifyHandler(req1, res1);
      assert.equal(res1.statusCode, 200);
      assert.equal(res1._json.valid, true);
      assert.equal(res1._json.accountType, 'customer');
      assert.equal(res1._json.email, 'so***@gmail.com');

      // Mismatched type
      const { req: req2, res: res2 } = mockReqRes({
        method: 'GET',
        query: { token: 'valid-token-raw', type: 'delivery' }
      });
      await verifyHandler(req2, res2);
      assert.equal(res2.statusCode, 400);
      assert.equal(res2._json.valid, false);
    } finally {
      PasswordResetToken.findOne = origTokenFindOne;
    }
  });

  // ─── 11. Reset URL & Email Generation ────────────────────────────────────
  await t.test('11. Email Generation: Reset email preserves correct account type in link and subject', async () => {
    const { sendPasswordResetEmail, getDevLastEntry } = require('../server/utils/emailService');
    clearDevOutbox();

    // 1. Customer email
    await sendPasswordResetEmail({
      to: 'customer@example.com',
      name: 'Customer Test',
      accountType: 'customer',
      rawToken: 'token123'
    });
    const lastCust = getDevLastEntry('customer@example.com');
    assert.ok(lastCust, 'Customer token must be recorded');
    assert.equal(lastCust.accountType, 'customer');
    assert.ok(lastCust.resetUrl.includes('type=customer'), 'Reset URL must include type=customer');

    // 2. Delivery email
    await sendPasswordResetEmail({
      to: 'delivery@example.com',
      name: 'Driver Test',
      accountType: 'delivery',
      rawToken: 'token456'
    });
    const lastDel = getDevLastEntry('delivery@example.com');
    assert.ok(lastDel, 'Delivery token must be recorded');
    assert.equal(lastDel.accountType, 'delivery');
    assert.ok(lastDel.resetUrl.includes('type=delivery'), 'Reset URL must include type=delivery');

    // 3. Admin email
    await sendPasswordResetEmail({
      to: 'admin@example.com',
      name: 'Admin Test',
      accountType: 'admin',
      rawToken: 'token789'
    });
    const lastAdmin = getDevLastEntry('admin@example.com');
    assert.ok(lastAdmin, 'Admin token must be recorded');
    assert.equal(lastAdmin.accountType, 'admin');
    assert.ok(lastAdmin.resetUrl.includes('type=admin'), 'Reset URL must include type=admin');
  });

  // ─── 12. Email Provider Failure Handling & Generic Response ───────────────
  await t.test('12. Email Provider Failure: Errors during dispatch do not crash API and maintain generic response', async () => {
    resetRateLimits();
    clearDevOutbox();

    const origCustFindOne = Customer.findOne;
    Customer.findOne = () => Promise.resolve({
      _id: new mongoose.Types.ObjectId(),
      email: 'customer.fail@example.com',
      firstName: 'Fail',
      lastName: 'Test'
    });

    const origTokenCreate = PasswordResetToken.create;
    const origTokenUpdateMany = PasswordResetToken.updateMany;
    PasswordResetToken.create = () => Promise.resolve({});
    PasswordResetToken.updateMany = () => Promise.resolve({});

    // Simulate nodemailer throwing an authentication / transport error
    const emailService = require('../server/utils/emailService');
    const origSendEmail = emailService.sendPasswordResetEmail;

    let loggedError = '';
    const origConsoleError = console.error;
    console.error = (...args) => {
      loggedError += args.join(' ');
    };

    emailService.sendPasswordResetEmail = () => Promise.reject(new Error('SMTP 535: Authentication credentials invalid'));

    try {
      const requestHandler = passwordResetRouter.stack.find((s) => s.route?.path === '/request')?.route?.stack[0]?.handle;
      const { req, res } = mockReqRes({
        body: { email: 'customer.fail@example.com', accountType: 'customer' }
      });

      await requestHandler(req, res);

      // Verify generic success response is preserved (Requirement 5)
      assert.equal(res.statusCode, 200, 'Frontend must receive HTTP 200 generic success');
      assert.ok(res._json.message.includes('If an account exists with that email address'));

      // Verify error was logged without exposing sensitive tokens or passwords
      assert.ok(loggedError.includes('Email dispatch error') || loggedError.includes('SMTP 535'), 'Server log must report dispatch failure');
      assert.ok(!loggedError.includes('passwordHash'), 'Server log must NOT log password hashes');
      assert.ok(!loggedError.includes('live-token'), 'Server log must NOT log secret tokens');
    } finally {
      Customer.findOne = origCustFindOne;
      PasswordResetToken.create = origTokenCreate;
      PasswordResetToken.updateMany = origTokenUpdateMany;
      emailService.sendPasswordResetEmail = origSendEmail;
      console.error = origConsoleError;
    }
  });

  // ─── 13. Live SMTP Email Delivery Verification ────────────────────────────
  await t.test('13. Real SMTP Delivery: Live SMTP connection sends actual email with valid reset link', async () => {
    const { sendPasswordResetEmail, isEmailConfigured, getNodemailer } = require('../server/utils/emailService');
    const nodemailerModule = getNodemailer();
    assert.ok(nodemailerModule, 'nodemailer must be loaded');

    // Create a real, live Ethereal test account to verify actual network SMTP transmission
    const testAccount = await nodemailerModule.createTestAccount();
    assert.ok(testAccount.user, 'Ethereal SMTP test user must be created');

    const origEnv = { ...process.env };
    process.env.SMTP_HOST = testAccount.smtp.host;
    process.env.SMTP_PORT = String(testAccount.smtp.port);
    process.env.SMTP_SECURE = String(testAccount.smtp.secure);
    process.env.SMTP_USER = testAccount.user;
    process.env.SMTP_PASS = testAccount.pass;
    process.env.EMAIL_FROM = `"Sattwik Kitchen Test" <${testAccount.user}>`;
    process.env.APP_BASE_URL = 'http://localhost:5000';

    try {
      assert.equal(isEmailConfigured(), true, 'isEmailConfigured must be true when SMTP vars are set');

      const testToken = 'verified-live-token-999';
      const result = await sendPasswordResetEmail({
        to: 'customer.recipient@example.com',
        name: 'Verified Customer',
        accountType: 'customer',
        rawToken: testToken
      });

      assert.equal(result.success, true, 'Email dispatch must succeed');
      assert.equal(result.delivered, true, 'Email must be delivered via live SMTP');
      assert.ok(result.messageId, 'Nodemailer must return a valid messageId from SMTP server');
    } finally {
      process.env = origEnv;
    }
  });
});
