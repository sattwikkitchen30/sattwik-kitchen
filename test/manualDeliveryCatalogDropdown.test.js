/**
 * Admin → Add Delivery Order → Add Items dropdown.
 * Reproduces the runtime wipe (catalog loaded, then openManualOrderModal resets it)
 * and verifies the fix against a real-shaped GET /api/delivery-plans payload.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  extractDeliveryCatalogItems: extractFromServer
} = require('../server/utils/deliveryCatalogItems');

class MockElement {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.attributes = {};
    this.dataset = {};
    this.innerHTMLValue = '';
    this.textContent = '';
    this.value = '';
    this.disabled = false;
    this.hidden = false;
    this.required = false;
    this.min = '';
    this.id = '';
    this.checkValidity = () => true;
    this.reportValidity = () => {};
    this.listeners = {};
    this._classes = new Set();
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
      },
      contains: (c) => this._classes.has(c)
    };
  }
  setAttribute(k, v) { this.attributes[k] = String(v); }
  getAttribute(k) { return this.attributes[k] || null; }
  appendChild(el) { this.children.push(el); return el; }
  querySelector(sel) {
    if (sel === '.manual-add-item-select' && /manual-add-item-select/.test(this.innerHTMLValue)) {
      const select = new MockElement('select');
      select.innerHTML = this.innerHTMLValue;
      return select;
    }
    return new MockElement('div');
  }
  querySelectorAll() { return []; }
  addEventListener(type, cb) {
    if (!this.listeners[type]) this.listeners[type] = [];
    this.listeners[type].push(cb);
  }
  set innerHTML(val) {
    this.innerHTMLValue = val;
    this.textContent = String(val).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  }
  get innerHTML() { return this.innerHTMLValue; }
  focus() {}
  reset() {}
}

global.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
global.window = { location: { href: '', pathname: '', search: '' }, addEventListener: () => {} };

const domElements = new Map();
global.document = {
  getElementById: (id) => {
    if (!domElements.has(id)) {
      const el = new MockElement('div');
      el.id = id;
      domElements.set(id, el);
    }
    return domElements.get(id);
  },
  createElement: (tag) => new MockElement(tag),
  querySelectorAll: () => [],
  querySelector: () => new MockElement('div'),
  addEventListener: () => {}
};

const admin = require('../admin/admin');
const {
  openManualOrderModal,
  extractDeliveryCatalogItems,
  unwrapDeliveryPlansResponse,
  applyLoadedDeliveryPlans,
  loadAddDeliveryOrderForm,
  retryManualDeliveryCatalog,
  renderManualAddItemRows,
  createEmptyManualItemRow
} = admin;

function getCatalog() { return admin.manualOrderCatalog; }
function setCatalog(v) { admin.manualOrderCatalog = v; }
function getPlans() { return admin.manualOrderDeliveryPlans; }
function setItemRows(v) { admin.manualOrderItemRows = v; }

// Shape returned by GET /api/delivery-plans (res.json({ plans })) and by
// DeliveryPlan documents after admin save (items.dynamicItems) plus legacy fields.
const REAL_SHAPED_API_RESPONSE = {
  plans: [
    {
      _id: 'plan-full-single',
      displayName: 'Full Meal (Single)',
      packageType: 'full',
      size: 'single',
      price: 14.99,
      active: true,
      items: {
        dal: 'small',
        curry: 'small',
        chapati: 2,
        rice: 1,
        curd: 'small',
        dynamicItems: []
      }
    },
    {
      _id: 'plan-edited-dynamic',
      displayName: 'Family Meal',
      packageType: 'full',
      size: 'family',
      price: 29.99,
      active: true,
      items: {
        dynamicItems: [
          { name: 'Dal', quantity: '16 oz' },
          { name: 'Curry', quantity: 'large' },
          { name: 'Chapathi', quantity: '6' },
          { name: 'Breads', quantity: 'large' },
          { name: 'Fruits', quantity: '1' }
        ]
      }
    }
  ]
};

function optionNames(html) {
  return [...String(html).matchAll(/<option[^>]*>([^<]*)<\/option>/g)].map((match) => match[1].trim());
}

test('GET /api/delivery-plans wraps plans in { plans }; unwrap reads that shape', () => {
  const plans = unwrapDeliveryPlansResponse(REAL_SHAPED_API_RESPONSE);
  assert.equal(plans.length, 2);
  assert.equal(unwrapDeliveryPlansResponse(REAL_SHAPED_API_RESPONSE.plans).length, 2);
  assert.deepEqual(unwrapDeliveryPlansResponse({ message: 'nope' }), []);
});

test('extractDeliveryCatalogItems reads legacy fields and dynamicItems from saved DeliveryPlan docs', () => {
  const catalog = extractDeliveryCatalogItems(REAL_SHAPED_API_RESPONSE.plans);
  const keys = catalog.map((item) => item.key);
  assert.deepEqual(keys, ['dal', 'curry', 'chapati', 'rice', 'curd', 'breads', 'fruits']);
  const dal = catalog.find((item) => item.key === 'dal');
  assert.ok(dal.sizes.includes('small'));
  assert.ok(dal.sizes.includes('large'));
  assert.equal(dal.name, 'Dal');
  const breads = catalog.find((item) => item.key === 'breads');
  assert.equal(breads.supportsSize, true);
  assert.deepEqual(breads.sizes, ['large']);
  assert.equal(catalog.find((item) => item.key === 'chapati').name, 'Chapati');
});

test('admin extract matches server extract on the same real-shaped payload', () => {
  const adminCatalog = extractDeliveryCatalogItems(REAL_SHAPED_API_RESPONSE.plans);
  const serverCatalog = extractFromServer(REAL_SHAPED_API_RESPONSE.plans);
  assert.deepEqual(adminCatalog.map((item) => item.key), serverCatalog.map((item) => item.key));
  assert.deepEqual(
    adminCatalog.find((item) => item.key === 'dal').sizes,
    serverCatalog.find((item) => item.key === 'dal').sizes
  );
});

test('FAILING SEQUENCE: loading catalog then calling openManualOrderModal wipes the dropdown', () => {
  const catalog = extractDeliveryCatalogItems(REAL_SHAPED_API_RESPONSE.plans);
  assert.ok(catalog.length > 0, 'extract must succeed before the wipe');
  setCatalog(catalog);
  admin.manualOrderDeliveryPlans = REAL_SHAPED_API_RESPONSE.plans;
  openManualOrderModal('delivery');
  assert.equal(getCatalog().length, 0, 'openManualOrderModal resets catalog');
  assert.equal(getPlans().length, 0, 'openManualOrderModal also resets delivery plans');
  setItemRows([createEmptyManualItemRow()]);
  renderManualAddItemRows();
  const html = document.getElementById('manualAddItemRows').innerHTML;
  assert.equal(html.includes('Dal'), false);
  assert.equal(html.includes('Breads'), false);
  assert.match(html, /Select delivery item/);
});

test('FIXED SEQUENCE: applyLoadedDeliveryPlans after modal reset populates Add Items options', () => {
  openManualOrderModal('delivery');
  const { catalog } = applyLoadedDeliveryPlans(REAL_SHAPED_API_RESPONSE);
  renderManualAddItemRows();
  assert.equal(catalog.length, 7);
  assert.equal(getCatalog().length, 7);
  const html = document.getElementById('manualAddItemRows').innerHTML;
  const names = optionNames(html);
  assert.ok(names.includes('Dal'));
  assert.ok(names.includes('Curry'));
  assert.ok(names.includes('Chapati'));
  assert.ok(names.includes('Rice'));
  assert.ok(names.includes('Curd'));
  assert.ok(names.includes('Breads'));
  assert.ok(names.includes('Fruits'));
  assert.ok(names.includes('+ Add custom item'));
  assert.equal(html.includes('Full Meal (Single)'), false, 'subscription plan names must not appear in Add Items');
  const planHtml = document.getElementById('manualPlanSelect').innerHTML;
  assert.match(planHtml, /Full Meal \(Single\)/);
  assert.match(planHtml, /Family Meal/);
});

test('loadAddDeliveryOrderForm fetches after reset and fills the dropdown', async () => {
  let fetchRan = false;
  global.fetch = async (url, options) => {
    fetchRan = true;
    assert.match(String(url), /\/api\/delivery-plans$/);
    assert.equal(options.credentials, 'include');
    assert.ok(!JSON.stringify(options.headers || {}).toLowerCase().includes('password'));
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify(REAL_SHAPED_API_RESPONSE)
    };
  };
  await loadAddDeliveryOrderForm();
  assert.equal(fetchRan, true);
  assert.equal(getCatalog().length, 7);
  const html = document.getElementById('manualAddItemRows').innerHTML;
  assert.match(html, />Dal</);
  assert.equal(document.getElementById('manualRetryCatalogBtn').hidden, true);
  assert.equal(document.getElementById('manualAddItemsStatus').textContent, '');
});

test('API failure shows an error and retry reloads the catalog', async () => {
  global.fetch = async () => ({
    ok: false,
    status: 401,
    text: async () => JSON.stringify({ message: 'Authentication required' })
  });
  await loadAddDeliveryOrderForm();
  assert.equal(getCatalog().length, 0);
  const status = document.getElementById('manualAddItemsStatus').textContent;
  assert.match(status, /Authentication required/);
  assert.equal(document.getElementById('manualRetryCatalogBtn').hidden, false);

  global.fetch = async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify(REAL_SHAPED_API_RESPONSE)
  });
  await retryManualDeliveryCatalog();
  assert.equal(getCatalog().length, 7);
  assert.match(document.getElementById('manualAddItemRows').innerHTML, />Dal</);
  assert.equal(document.getElementById('manualRetryCatalogBtn').hidden, true);
});

test('plans with no extractable items show a clear message instead of a silent empty list', () => {
  openManualOrderModal('delivery');
  applyLoadedDeliveryPlans({
    plans: [{ _id: 'empty', displayName: 'Empty Plan', packageType: 'full', size: 'single', price: 1, active: true, items: { dynamicItems: [] } }]
  });
  renderManualAddItemRows();
  const status = document.getElementById('manualAddItemsStatus').textContent;
  assert.match(status, /No preparation items are configured/);
  assert.equal(document.getElementById('manualRetryCatalogBtn').hidden, false);
  assert.equal(getCatalog().length, 0);
});

test('adding another item row still uses the loaded catalog', () => {
  openManualOrderModal('delivery');
  applyLoadedDeliveryPlans(REAL_SHAPED_API_RESPONSE);
  admin.manualOrderItemRows = [createEmptyManualItemRow(), createEmptyManualItemRow()];
  renderManualAddItemRows();
  const html = document.getElementById('manualAddItemRows').innerHTML;
  assert.equal((html.match(/manual-add-item-select/g) || []).length, 2);
  assert.equal((html.match(/>Dal</g) || []).length, 2);
});
