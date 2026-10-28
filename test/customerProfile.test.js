'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const mongoose = require('mongoose');

const Customer = require('../server/models/Customer');
const { updateCustomerProfile } = require('../server/routes/customerAuth');
const customerAuthRouter = require('../server/routes/customerAuth');
const customersRouter = require('../server/routes/customers');

// Helper to mock req and res
function mockReqRes({ method = 'PUT', body = {}, params = {}, headers = {}, customer = null, admin = null } = {}) {
  const req = {
    method,
    body,
    params,
    headers: { ...headers },
    customer,
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

test('Customer Edit Profile - Comprehensive Test Suite', async (t) => {
  // ─── Mock in-memory database store ─────────────────────────────────────────
  const mockCustomers = new Map();

  const origFindById = Customer.findById;
  const origFindOne = Customer.findOne;
  const origFind = Customer.find;

  Customer.findById = (id) => {
    const cust = mockCustomers.get(String(id));
    return {
      select: () => Promise.resolve(cust ? { ...cust } : null),
      lean: () => Promise.resolve(cust ? { ...cust } : null),
      then: (fn) => {
        if (!cust) return Promise.resolve(null).then(fn);
        const doc = {
          ...cust,
          save: async function () {
            mockCustomers.set(String(this._id), { ...this });
            return this;
          }
        };
        return Promise.resolve(doc).then(fn);
      }
    };
  };

  Customer.findOne = (filter) => {
    let found = null;
    for (const cust of mockCustomers.values()) {
      let match = true;
      if (filter._id && filter._id.$ne && String(cust._id) === String(filter._id.$ne)) {
        match = false;
      }
      if (filter.email && cust.email !== String(filter.email).toLowerCase()) {
        match = false;
      }
      if (filter.phone && cust.phone !== String(filter.phone).trim()) {
        match = false;
      }
      if (match) {
        found = cust;
        break;
      }
    }
    return {
      select: () => Promise.resolve(found ? { ...found } : null),
      lean: () => Promise.resolve(found ? { ...found } : null),
      then: (fn) => Promise.resolve(found ? { ...found } : null).then(fn)
    };
  };

  t.after(() => {
    Customer.findById = origFindById;
    Customer.findOne = origFindOne;
    Customer.find = origFind;
  });

  // Seed baseline test customers
  const customerId1 = new mongoose.Types.ObjectId().toString();
  const customerId2 = new mongoose.Types.ObjectId().toString();

  mockCustomers.set(customerId1, {
    _id: customerId1,
    firstName: 'Priya',
    lastName: 'Sharma',
    email: 'priya@example.com',
    phone: '604-555-0101',
    area: 'Vancouver',
    address: '100 Main St',
    passwordHash: 'hashed_pw_priya',
    isDemo: false
  });

  mockCustomers.set(customerId2, {
    _id: customerId2,
    firstName: 'Rahul',
    lastName: 'Verma',
    email: 'rahul@example.com',
    phone: '604-555-0202',
    area: 'Burnaby',
    address: '200 Kingsway',
    passwordHash: 'hashed_pw_rahul',
    isDemo: false
  });

  // ─── 1. Static HTML & CSS Verifications ───────────────────────────────────
  await t.test('1. Static HTML: customer/orders.html does NOT contain duplicate Edit Profile button in header', () => {
    const htmlPath = path.join(__dirname, '../customer/orders.html');
    const html = fs.readFileSync(htmlPath, 'utf8');

    // Button should NOT be in the header / orders-actions
    assert.ok(
      !html.includes('id="customerEditProfileBtn"'),
      'orders.html must NOT have duplicate #customerEditProfileBtn in header'
    );

    // Modal structure should remain available
    assert.ok(html.includes('id="customerProfileModal"'), 'orders.html should have #customerProfileModal');
    assert.ok(html.includes('id="customerProfileTitle"'), 'orders.html should have #customerProfileTitle');
    assert.ok(html.includes('id="closeCustomerProfileModal"'), 'orders.html should have #closeCustomerProfileModal');
    assert.ok(html.includes('id="customerProfileForm"'), 'orders.html should have #customerProfileForm');
  });

  await t.test('2. Static HTML: index.html contains Edit Profile button in navigation immediately before Logout', () => {
    const htmlPath = path.join(__dirname, '../index.html');
    const html = fs.readFileSync(htmlPath, 'utf8');

    assert.ok(html.includes('id="customerProfileBtn"'), 'index.html must have #customerProfileBtn in nav');
    assert.ok(html.includes('id="customerProfileModal"'), 'index.html must have #customerProfileModal');

    // Verify exact ordering in nav-links:
    // Menu -> Tiffin Plans -> Catering -> Contact -> My Orders -> Edit Profile -> Logout
    const navMatch = html.match(/<nav class="nav-links"[^>]*>([\s\S]*?)<\/nav>/);
    assert.ok(navMatch, 'index.html must have <nav class="nav-links">');
    const navContent = navMatch[1];

    const menuIdx = navContent.indexOf('href="#menu"');
    const plansIdx = navContent.indexOf('href="#plans"');
    const cateringIdx = navContent.indexOf('href="#catering"');
    const contactIdx = navContent.indexOf('href="#contact"');
    const ordersIdx = navContent.indexOf('id="customerOrdersLink"');
    const profileIdx = navContent.indexOf('id="customerProfileBtn"');
    const logoutIdx = navContent.indexOf('id="customerLogoutBtn"');

    assert.ok(menuIdx !== -1, 'Menu link must exist in nav');
    assert.ok(plansIdx !== -1, 'Tiffin Plans link must exist in nav');
    assert.ok(cateringIdx !== -1, 'Catering link must exist in nav');
    assert.ok(contactIdx !== -1, 'Contact link must exist in nav');
    assert.ok(ordersIdx !== -1, 'My Orders link must exist in nav');
    assert.ok(profileIdx !== -1, 'Edit Profile button must exist in nav');
    assert.ok(logoutIdx !== -1, 'Logout button must exist in nav');

    assert.ok(menuIdx < plansIdx, 'Menu must precede Tiffin Plans');
    assert.ok(plansIdx < cateringIdx, 'Tiffin Plans must precede Catering');
    assert.ok(cateringIdx < contactIdx, 'Catering must precede Contact');
    assert.ok(contactIdx < ordersIdx, 'Contact must precede My Orders');
    assert.ok(ordersIdx < profileIdx, 'My Orders must precede Edit Profile');
    assert.ok(profileIdx < logoutIdx, 'Edit Profile must immediately precede Logout');
  });

  await t.test('2b. Static HTML & JS in public/: public/index.html and public/script.js are synchronized with root', () => {
    const publicHtml = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
    const publicJs = fs.readFileSync(path.join(__dirname, '../public/script.js'), 'utf8');

    assert.ok(publicHtml.includes('id="customerProfileBtn"'), 'public/index.html must have #customerProfileBtn');
    assert.ok(publicJs.includes("customerProfileBtn?.classList.remove('hidden')"), 'public/script.js must unhide customerProfileBtn when logged in');
    assert.ok(publicJs.includes("customerProfileBtn?.classList.add('hidden')"), 'public/script.js must hide customerProfileBtn when logged out');

    // Verify ordering in public/index.html
    const navMatch = publicHtml.match(/<nav class="nav-links"[^>]*>([\s\S]*?)<\/nav>/);
    assert.ok(navMatch, 'public/index.html must have <nav class="nav-links">');
    const navContent = navMatch[1];
    const ordersIdx = navContent.indexOf('id="customerOrdersLink"');
    const profileIdx = navContent.indexOf('id="customerProfileBtn"');
    const logoutIdx = navContent.indexOf('id="customerLogoutBtn"');

    assert.ok(ordersIdx !== -1 && profileIdx !== -1 && logoutIdx !== -1, 'Orders, Profile, and Logout must exist');
    assert.ok(ordersIdx < profileIdx, 'Orders must precede Profile in public/index.html');
    assert.ok(profileIdx < logoutIdx, 'Profile must precede Logout in public/index.html');
  });

  await t.test('3. CSS: customer.css and styles.css contain profile modal, typography, and hover styles', () => {
    const customerCss = fs.readFileSync(path.join(__dirname, '../customer/customer.css'), 'utf8');
    const stylesCss = fs.readFileSync(path.join(__dirname, '../styles.css'), 'utf8');

    for (const [name, css] of [['customer.css', customerCss], ['styles.css', stylesCss]]) {
      assert.ok(css.includes('.customer-profile-modal'), `${name} must include .customer-profile-modal`);
      assert.ok(css.includes('.profile-modal-content'), `${name} must include .profile-modal-content`);
      assert.ok(css.includes('.profile-section'), `${name} must include .profile-section`);
      assert.ok(css.includes('.form-grid'), `${name} must include .form-grid`);
      assert.ok(css.includes('.profile-modal-actions'), `${name} must include .profile-modal-actions`);
      assert.ok(css.includes('.profile-btn.primary'), `${name} must include .profile-btn.primary`);
      assert.ok(css.includes('.profile-btn.secondary'), `${name} must include .profile-btn.secondary`);
      assert.ok(css.includes('.profile-message'), `${name} must include .profile-message`);
      assert.ok(css.includes('@media (max-width: 600px)'), `${name} must include mobile responsive styles`);
    }

    assert.ok(stylesCss.includes('.nav-profile-btn'), 'styles.css must include .nav-profile-btn');
    assert.ok(stylesCss.includes('.nav-profile-btn::after'), 'styles.css must include hover underline for .nav-profile-btn');
  });

  await t.test('4. Frontend JS: script.js wires up profile button visibility and modal functionality', () => {
    const mainJs = fs.readFileSync(path.join(__dirname, '../script.js'), 'utf8');

    assert.ok(mainJs.includes('customerProfileBtn'), 'script.js must reference customerProfileBtn');
    assert.ok(mainJs.includes('customerProfileBtn?.classList.remove(\'hidden\')'), 'script.js must show customerProfileBtn when logged in');
    assert.ok(mainJs.includes('customerProfileBtn?.classList.add(\'hidden\')'), 'script.js must hide customerProfileBtn when logged out');
    assert.ok(mainJs.includes('openCustomerProfileModal'), 'script.js must have openCustomerProfileModal');
    assert.ok(mainJs.includes('/api/customer-auth/profile'), 'script.js must call /api/customer-auth/profile');
  });

  // ─── 2. Backend Route & Middleware Inspection ─────────────────────────────
  await t.test('5. Express Route Registration: PUT endpoints exist for customer profile updates', () => {
    const customerAuthRoutes = customerAuthRouter.stack
      .filter((layer) => layer.route)
      .map((layer) => ({ path: layer.route.path, methods: Object.keys(layer.route.methods) }));

    const hasProfilePut = customerAuthRoutes.some((r) => r.path === '/profile' && r.methods.includes('put'));
    const hasMePut = customerAuthRoutes.some((r) => r.path === '/me' && r.methods.includes('put'));

    assert.ok(hasProfilePut, 'customerAuth router must register PUT /profile');
    assert.ok(hasMePut, 'customerAuth router must register PUT /me');

    const customersRoutes = customersRouter.stack
      .filter((layer) => layer.route)
      .map((layer) => ({ path: layer.route.path, methods: Object.keys(layer.route.methods) }));

    const hasCustomersMePut = customersRoutes.some((r) => r.path === '/me' && r.methods.includes('put'));
    assert.ok(hasCustomersMePut, 'customers router must register PUT /me');
  });

  // ─── 3. Functional Backend Tests ──────────────────────────────────────────
  await t.test('6. Authentication Guard: Rejects unauthenticated requests with 401', async () => {
    const { req, res } = mockReqRes({
      method: 'PUT',
      customer: null,
      body: { firstName: 'Anita', lastName: 'Desai' }
    });

    await updateCustomerProfile(req, res);
    assert.equal(res.statusCode, 401);
    assert.equal(res._json?.message, 'Customer authentication required');
  });

  await t.test('7. Validation: Rejects missing first or last name with 400', async () => {
    // Missing firstName
    {
      const { req, res } = mockReqRes({
        customer: { _id: customerId1 },
        body: { firstName: '', lastName: 'Sharma', email: 'priya@example.com', phone: '604-555-0101' }
      });
      await updateCustomerProfile(req, res);
      assert.equal(res.statusCode, 400);
      assert.ok(res._json?.message?.includes('First name is required'));
    }

    // Missing lastName
    {
      const { req, res } = mockReqRes({
        customer: { _id: customerId1 },
        body: { firstName: 'Priya', lastName: '   ', email: 'priya@example.com', phone: '604-555-0101' }
      });
      await updateCustomerProfile(req, res);
      assert.equal(res.statusCode, 400);
      assert.ok(res._json?.message?.includes('Last name is required'));
    }
  });

  await t.test('8. Validation: Rejects invalid email format with 400', async () => {
    const { req, res } = mockReqRes({
      customer: { _id: customerId1 },
      body: { firstName: 'Priya', lastName: 'Sharma', email: 'not-an-email', phone: '604-555-0101' }
    });

    await updateCustomerProfile(req, res);
    assert.equal(res.statusCode, 400);
    assert.ok(res._json?.message?.includes('valid email address'));
  });

  await t.test('9. Validation: Rejects invalid phone format with 400', async () => {
    const { req, res } = mockReqRes({
      customer: { _id: customerId1 },
      body: { firstName: 'Priya', lastName: 'Sharma', email: 'priya@example.com', phone: '12' }
    });

    await updateCustomerProfile(req, res);
    assert.equal(res.statusCode, 400);
    assert.ok(res._json?.message?.includes('valid phone number'));
  });

  await t.test('10. Conflict Detection: Rejects duplicate email and phone collision with 409', async () => {
    const { req, res } = mockReqRes({
      customer: { _id: customerId1 },
      body: {
        firstName: 'Priya',
        lastName: 'Sharma',
        email: 'rahul@example.com', // Belongs to customerId2
        phone: '604-555-0202'       // Belongs to customerId2
      }
    });

    await updateCustomerProfile(req, res);
    assert.equal(res.statusCode, 409);
    assert.ok(res._json?.message?.includes('already exists'));
  });

  await t.test('11. Successful Update: Updates customer details and returns fresh token and public customer', async () => {
    const { req, res } = mockReqRes({
      customer: { _id: customerId1 },
      body: {
        firstName: 'Priyanka',
        lastName: 'Sharma-Gupta',
        email: 'PRIYA.NEW@EXAMPLE.COM',
        phone: '(604) 555-9876',
        area: 'Surrey',
        address: '555 128th St, Suite 404'
      }
    });

    await updateCustomerProfile(req, res);

    assert.equal(res.statusCode, 200);
    assert.ok(res._json?.customer, 'Response must include customer object');
    assert.equal(res._json?.customer?.firstName, 'Priyanka');
    assert.equal(res._json?.customer?.lastName, 'Sharma-Gupta');
    assert.equal(res._json?.customer?.email, 'priya.new@example.com');
    assert.equal(res._json?.customer?.phone, '(604) 555-9876');
    assert.equal(res._json?.customer?.area, 'Surrey');
    assert.equal(res._json?.customer?.address, '555 128th St, Suite 404');
    assert.equal(res._json?.customer?.passwordHash, undefined, 'passwordHash must never be exposed');

    assert.ok(typeof res._json?.token === 'string' && res._json.token.length > 20, 'Must return signed token');

    // Verify stored in mock database
    const saved = mockCustomers.get(customerId1);
    assert.equal(saved.firstName, 'Priyanka');
    assert.equal(saved.lastName, 'Sharma-Gupta');
    assert.equal(saved.email, 'priya.new@example.com');
    assert.equal(saved.phone, '(604) 555-9876');
    assert.equal(saved.area, 'Surrey');
    assert.equal(saved.address, '555 128th St, Suite 404');
  });

  await t.test('12. Mass Assignment Protection: Protected fields cannot be overridden', async () => {
    const attackerId = new mongoose.Types.ObjectId().toString();
    const { req, res } = mockReqRes({
      customer: { _id: customerId1 },
      body: {
        firstName: 'Priya',
        lastName: 'Sharma',
        _id: attackerId,
        passwordHash: 'injected_hash',
        isDemo: true
      }
    });

    await updateCustomerProfile(req, res);
    assert.equal(res.statusCode, 200);

    const saved = mockCustomers.get(customerId1);
    assert.equal(saved._id, customerId1, '_id must not change');
    assert.equal(saved.passwordHash, 'hashed_pw_priya', 'passwordHash must remain unchanged');
    assert.equal(saved.isDemo, false, 'isDemo must remain unchanged');
  });

  await t.test('13. Full Name Splitting Support: name field correctly populates firstName and lastName', async () => {
    const { req, res } = mockReqRes({
      customer: { _id: customerId1 },
      body: {
        name: 'Aarav Kumar Patel',
        email: 'priya.new@example.com',
        phone: '(604) 555-9876'
      }
    });

    await updateCustomerProfile(req, res);
    assert.equal(res.statusCode, 200);

    const saved = mockCustomers.get(customerId1);
    assert.equal(saved.firstName, 'Aarav');
    assert.equal(saved.lastName, 'Kumar Patel');
  });
});
