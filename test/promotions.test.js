'use strict';

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

const rootDir = process.cwd();

// Set up browser-like mocks so admin.js and script.js can be imported in Node environment
class MockElement {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this._classes = new Set();
    this.attributes = {};
    this.dataset = {};
    this.innerHTMLValue = '';
    this.textContent = '';
    this.value = '';
    this.disabled = false;
    this.hidden = false;
    this.style = {};
    this.listeners = {};
  }
  get classList() {
    return {
      add: (c) => this._classes.add(c),
      remove: (c) => this._classes.delete(c),
      toggle: (c, force) => {
        if (force === true) this._classes.add(c);
        else if (force === false) this._classes.delete(c);
        else if (this._classes.has(c)) this._classes.delete(c);
        else this._classes.add(c);
        return this._classes.has(c);
      },
      contains: (c) => this._classes.has(c)
    };
  }
  setAttribute(k, v) { this.attributes[k] = String(v); }
  getAttribute(k) { return this.attributes[k] || null; }
  appendChild(el) { this.children.push(el); return el; }
  querySelector() { return new MockElement('div'); }
  querySelectorAll() { return []; }
  addEventListener(type, cb) {
    if (!this.listeners[type]) this.listeners[type] = [];
    this.listeners[type].push(cb);
  }
  focus() { this.focused = true; }
  set innerHTML(val) {
    this.innerHTMLValue = val;
    this.textContent = String(val || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  }
  get innerHTML() { return this.innerHTMLValue; }
}

global.localStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {}
};
global.window = {
  location: { href: '', pathname: '' },
  addEventListener: () => {}
};
const domMap = new Map();
global.document = {
  body: new MockElement('body'),
  documentElement: new MockElement('html'),
  getElementById: (id) => {
    if (!domMap.has(id)) {
      const el = new MockElement('div');
      el.id = id;
      domMap.set(id, el);
    }
    return domMap.get(id);
  },
  querySelector: () => new MockElement('div'),
  querySelectorAll: () => [],
  createElement: (tag) => new MockElement(tag),
  addEventListener: () => {},
  readyState: 'complete'
};

global.IntersectionObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

const Promotion = require(path.resolve(rootDir, 'server/models/Promotion'));
const promotionController = require(path.resolve(rootDir, 'server/controllers/promotionController'));
const { renderPromotions } = require(path.resolve(rootDir, 'script.js'));
const {
  state: adminState,
  renderPromotionsTable,
  openPromotionEditModal,
  closePromotionEditModal,
  openDeletePromotionModal,
  closeDeletePromotionModal
} = require(path.resolve(rootDir, 'admin/admin.js'));

function mockReqRes({ body = {}, params = {}, query = {}, admin = null } = {}) {
  const req = {
    body,
    params,
    query,
    admin: admin || { id: 'admin123', email: 'admin@sattwik.com', role: 'admin' },
    headers: {}
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

test('Promotions Management Complete Suite', async (t) => {
  const nonce = Date.now();
  const createdPromotionIds = [];

  t.before(async () => {
    if (mongoose.connection.readyState !== 1) {
      await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/sattwik-kitchen');
    }
  });

  t.after(async () => {
    try {
      if (createdPromotionIds.length) {
        await Promotion.deleteMany({ _id: { $in: createdPromotionIds } });
      }
    } finally {
      await mongoose.disconnect();
    }
  });

  await t.test('1. Static template and CSS definitions for Promotions in Admin and Customer pages', () => {
    const adminHtml = fs.readFileSync(path.resolve(rootDir, 'admin/dashboard.html'), 'utf8');
    const adminCss = fs.readFileSync(path.resolve(rootDir, 'admin/admin.css'), 'utf8');
    const indexHtml = fs.readFileSync(path.resolve(rootDir, 'index.html'), 'utf8');
    const customerCss = fs.readFileSync(path.resolve(rootDir, 'styles.css'), 'utf8');

    // Admin dashboard
    assert.ok(adminHtml.includes('data-view="promotions"'), 'Admin sidebar must contain Promotions nav button');
    assert.ok(adminHtml.includes('id="promotionsView"'), 'Admin must have #promotionsView panel');
    assert.ok(adminHtml.includes('id="createPromotionForm"'), 'Admin must have #createPromotionForm');
    assert.ok(adminHtml.includes('id="promotionTitle"'), 'Admin must have #promotionTitle input');
    assert.ok(adminHtml.includes('id="promotionDescription"'), 'Admin must have #promotionDescription input');
    assert.ok(adminHtml.includes('id="promotionsTable"'), 'Admin must have #promotionsTable');
    assert.ok(adminHtml.includes('id="promotionEditModal"'), 'Admin must have #promotionEditModal');
    assert.ok(adminHtml.includes('id="deletePromotionModal"'), 'Admin must have #deletePromotionModal');

    // Admin CSS
    assert.ok(adminCss.includes('.promotions-actions-cell'), 'admin.css must contain .promotions-actions-cell');
    assert.ok(adminCss.includes('.field-error'), 'admin.css must contain .field-error');

    // Customer page placement (immediately above Menu)
    assert.ok(indexHtml.includes('id="promotionsSection"'), 'index.html must contain #promotionsSection');
    assert.ok(indexHtml.includes('id="promotionsContainer"'), 'index.html must contain #promotionsContainer');
    const promoIdx = indexHtml.indexOf('id="promotionsSection"');
    const menuIdx = indexHtml.indexOf('id="menu"');
    assert.ok(promoIdx > 0 && menuIdx > 0, 'Both promotionsSection and menu must exist');
    assert.ok(promoIdx < menuIdx, 'promotionsSection must appear immediately ABOVE menu section');
    assert.ok(menuIdx - promoIdx < 300, 'promotionsSection must directly precede menu section');

    // Customer CSS
    assert.ok(customerCss.includes('.promotions-section'), 'styles.css must contain .promotions-section');
    assert.ok(customerCss.includes('.promotion-banner'), 'styles.css must contain .promotion-banner');
    assert.ok(customerCss.includes('.promotion-badge'), 'styles.css must contain .promotion-badge');
    assert.ok(customerCss.includes('.promotion-title'), 'styles.css must contain .promotion-title');
    assert.ok(customerCss.includes('.promotion-description'), 'styles.css must contain .promotion-description');
  });

  await t.test('2. Promotion Mongoose Model validation and default values', async () => {
    // Requires title
    await assert.rejects(
      async () => {
        await Promotion.create({ description: 'Missing title' });
      },
      /Promotion title is required/
    );

    // Requires description
    await assert.rejects(
      async () => {
        await Promotion.create({ title: 'Missing description' });
      },
      /Promotion description is required/
    );

    // Newly created promotion defaults to isActive: true
    const p = await Promotion.create({
      title: `  Festive Offer ${nonce}  `,
      description: `  Get free halwa with order ${nonce}  `
    });
    createdPromotionIds.push(p._id);

    assert.equal(p.title, `Festive Offer ${nonce}`, 'Title is trimmed');
    assert.equal(p.description, `Get free halwa with order ${nonce}`, 'Description is trimmed');
    assert.equal(p.isActive, true, 'Newly created promotion defaults to isActive: true');
    assert.ok(p.createdAt instanceof Date, 'Has createdAt timestamp');
    assert.ok(p.updatedAt instanceof Date, 'Has updatedAt timestamp');
  });

  await t.test('3. Backend controller: create promotion with validation and default active status', async () => {
    // 1. Rejects empty title
    const { req: r1, res: s1 } = mockReqRes({ body: { title: '   ', description: 'Valid desc' } });
    await promotionController.create(r1, s1);
    assert.equal(s1.statusCode, 400);
    assert.equal(s1._json.message, 'Promotion title is required');

    // 2. Rejects empty description
    const { req: r2, res: s2 } = mockReqRes({ body: { title: 'Valid Title', description: '   ' } });
    await promotionController.create(r2, s2);
    assert.equal(s2.statusCode, 400);
    assert.equal(s2._json.message, 'Promotion description is required');

    // 3. Creates successfully with trimmed strings and active by default
    const { req: r3, res: s3 } = mockReqRes({
      body: {
        title: `  Diwali Special ${nonce}  `,
        description: `  15% off all traditional sweets this festive season!  `
      }
    });
    await promotionController.create(r3, s3);
    assert.equal(s3.statusCode, 201);
    assert.ok(s3._json.promotion);
    assert.equal(s3._json.promotion.title, `Diwali Special ${nonce}`);
    assert.equal(s3._json.promotion.description, '15% off all traditional sweets this festive season!');
    assert.equal(s3._json.promotion.isActive, true, 'Default active is true');
    createdPromotionIds.push(s3._json.promotion._id);
  });

  await t.test('4. Backend controller: update title and description preserves active/inactive status', async () => {
    // Create an inactive promotion
    const promo = await Promotion.create({
      title: `Pre-update Title ${nonce}`,
      description: `Pre-update Desc ${nonce}`,
      isActive: false
    });
    createdPromotionIds.push(promo._id);

    // Update title and description
    const { req, res } = mockReqRes({
      params: { id: String(promo._id) },
      body: {
        title: `Updated Title ${nonce}`,
        description: `Updated Desc ${nonce}`
      }
    });
    await promotionController.update(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res._json.promotion.title, `Updated Title ${nonce}`);
    assert.equal(res._json.promotion.description, `Updated Desc ${nonce}`);
    assert.equal(res._json.promotion.isActive, false, 'Existing inactive status was preserved');

    // Check DB persistence
    const inDb = await Promotion.findById(promo._id).lean();
    assert.equal(inDb.title, `Updated Title ${nonce}`);
    assert.equal(inDb.isActive, false);
  });

  await t.test('5. Backend controller: toggle active/inactive status', async () => {
    const promo = await Promotion.create({
      title: `Toggle Promo ${nonce}`,
      description: `Toggle Desc ${nonce}`,
      isActive: true
    });
    createdPromotionIds.push(promo._id);

    // Deactivate
    const { req: rDeact, res: sDeact } = mockReqRes({
      params: { id: String(promo._id) },
      body: { isActive: false }
    });
    await promotionController.updateStatus(rDeact, sDeact);
    assert.equal(sDeact.statusCode, 200);
    assert.equal(sDeact._json.promotion.isActive, false);

    // Check DB
    let inDb = await Promotion.findById(promo._id);
    assert.equal(inDb.isActive, false, 'Deactivation persisted in DB');

    // Reactivate
    const { req: rAct, res: sAct } = mockReqRes({
      params: { id: String(promo._id) },
      body: { isActive: true }
    });
    await promotionController.updateStatus(rAct, sAct);
    assert.equal(sAct.statusCode, 200);
    assert.equal(sAct._json.promotion.isActive, true);

    inDb = await Promotion.findById(promo._id);
    assert.equal(inDb.isActive, true, 'Activation persisted in DB');
  });

  await t.test('6. Backend controller: listActive returns only active promotions in deterministic creation order', async () => {
    // Create 1 active and 1 inactive promotion
    const p1 = await Promotion.create({
      title: `Active First ${nonce}`,
      description: `Active First Desc ${nonce}`,
      isActive: true
    });
    createdPromotionIds.push(p1._id);

    const pInactive = await Promotion.create({
      title: `Inactive Promo ${nonce}`,
      description: `Inactive Desc ${nonce}`,
      isActive: false
    });
    createdPromotionIds.push(pInactive._id);

    const p2 = await Promotion.create({
      title: `Active Second ${nonce}`,
      description: `Active Second Desc ${nonce}`,
      isActive: true
    });
    createdPromotionIds.push(p2._id);

    // Public listActive
    const { req, res } = mockReqRes();
    await promotionController.listActive(req, res);
    assert.equal(res.statusCode, 200);
    const activePromos = res._json.promotions;

    // Must include p1 and p2, but MUST NOT include pInactive
    const p1Found = activePromos.find(p => String(p._id) === String(p1._id));
    const p2Found = activePromos.find(p => String(p._id) === String(p2._id));
    const inactiveFound = activePromos.find(p => String(p._id) === String(pInactive._id));

    assert.ok(p1Found, 'Active promo 1 is present');
    assert.ok(p2Found, 'Active promo 2 is present');
    assert.ok(!inactiveFound, 'Inactive promo is excluded from customer active list');

    // Deterministic order: p1 created before p2
    const idx1 = activePromos.findIndex(p => String(p._id) === String(p1._id));
    const idx2 = activePromos.findIndex(p => String(p._id) === String(p2._id));
    assert.ok(idx1 < idx2, 'Older promotion appears before newer promotion');
  });

  await t.test('7. Backend controller: remove deletes promotion permanently', async () => {
    const promo = await Promotion.create({
      title: `Delete Promo ${nonce}`,
      description: `Delete Desc ${nonce}`,
      isActive: true
    });
    const promoId = String(promo._id);

    const { req, res } = mockReqRes({ params: { id: promoId } });
    await promotionController.remove(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res._json.message, 'Promotion deleted successfully');

    // Confirm deleted from DB
    const checkDb = await Promotion.findById(promoId);
    assert.equal(checkDb, null, 'Promotion removed from MongoDB');
  });

  await t.test('8. Customer frontend banner rendering produces festive markup with escaped content', () => {
    let htmlOutput = '';
    const mockContainer = {
      set innerHTML(val) { htmlOutput = val; },
      get innerHTML() { return htmlOutput; }
    };

    const samplePromotions = [
      {
        _id: 'promo1',
        title: 'Festival of Lights Special <script>alert("xss")</script>',
        description: 'Get 2 complimentary laddus with any 20-day plan & save big!',
        isActive: true
      }
    ];

    // Mock document.getElementById('promotionsContainer')
    const origGetElementById = global.document.getElementById;
    global.document.getElementById = (id) => (id === 'promotionsContainer' ? mockContainer : null);

    try {
      renderPromotions(samplePromotions);

      assert.ok(htmlOutput.includes('class="promotion-banner"'), 'Outputs .promotion-banner');
      assert.ok(htmlOutput.includes('class="promotion-title"'), 'Outputs .promotion-title');
      assert.ok(htmlOutput.includes('class="promotion-description"'), 'Outputs .promotion-description');
      assert.ok(htmlOutput.includes('class="promotion-badge"'), 'Outputs festive badge');
      assert.ok(htmlOutput.includes('Festival of Lights Special &lt;script&gt;'), 'XSS tags properly escaped in title');
      assert.ok(htmlOutput.includes('20-day plan &amp; save big!'), 'Special characters properly escaped in description');
    } finally {
      global.document.getElementById = origGetElementById;
    }
  });

  await t.test('9. Admin frontend: renderPromotionsTable produces status badges and action controls', () => {
    let tableHtml = '';
    let badgeText = '';
    const mockTable = {
      set innerHTML(val) { tableHtml = val; },
      get innerHTML() { return tableHtml; },
      querySelectorAll: () => []
    };
    const mockBadge = {
      set textContent(val) { badgeText = val; },
      get textContent() { return badgeText; }
    };

    const origGetElementById = global.document.getElementById;
    global.document.getElementById = (id) => {
      if (id === 'promotionsTable') return mockTable;
      if (id === 'promotionsCountBadge') return mockBadge;
      return null;
    };

    try {
      adminState.promotions = [
        {
          _id: 'p_act',
          title: 'Active Holi Offer',
          description: 'Special snacks basket with any order',
          isActive: true,
          createdAt: new Date().toISOString()
        },
        {
          _id: 'p_inact',
          title: 'Inactive Winter Offer',
          description: 'Old winter combo discount',
          isActive: false,
          createdAt: new Date().toISOString()
        }
      ];

      renderPromotionsTable();

      assert.equal(badgeText, '2 promotions', 'Count badge updated');
      assert.ok(tableHtml.includes('Active Holi Offer'), 'Active title rendered');
      assert.ok(tableHtml.includes('● Active'), 'Active label rendered');
      assert.ok(tableHtml.includes('○ Inactive'), 'Inactive label rendered');
      assert.ok(tableHtml.includes('Deactivate'), 'Active item offers Deactivate action');
      assert.ok(tableHtml.includes('Activate'), 'Inactive item offers Activate action');
      assert.ok(tableHtml.includes('Edit'), 'Edit action button rendered');
      assert.ok(tableHtml.includes('Delete'), 'Delete action button rendered');
    } finally {
      global.document.getElementById = origGetElementById;
    }
  });
});
