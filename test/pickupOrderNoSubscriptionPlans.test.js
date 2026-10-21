const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Mock DOM elements
class MockElement {
  constructor(tagName = 'div') {
    this.tagName = String(tagName).toUpperCase();
    this.children = [];
    this.listeners = {};
    this.value = '';
    this.textContent = '';
    this.innerHTMLValue = '';
    this.hidden = false;
    this.required = false;
    this.min = '';
    this.disabled = false;
    this.attributes = {};
    this.style = {};
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
  trigger(type, eventObj = {}) {
    if (this.listeners[type]) {
      for (const cb of this.listeners[type]) {
        cb({ preventDefault: () => {}, target: this, currentTarget: this, ...eventObj });
      }
    }
  }
  set innerHTML(val) {
    this.innerHTMLValue = val;
    this.textContent = String(val).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  }
  get innerHTML() { return this.innerHTMLValue; }
  focus() {}
  reset() {}
  reportValidity() {}
  checkValidity() { return true; }
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
  querySelector: (sel) => {
    if (sel === '.manual-plan-select-section') {
      return global.document.getElementById('manualPlanSelectSection');
    }
    return new MockElement('div');
  },
  querySelectorAll: () => [],
  createElement: (tag) => new MockElement(tag),
  addEventListener: () => {}
};

const admin = require('../admin/admin');

test('HTML: dashboard.html wraps subscription plans section and contains required IDs', () => {
  const htmlPath = path.join(__dirname, '../admin/dashboard.html');
  const html = fs.readFileSync(htmlPath, 'utf8');

  assert.ok(
    html.includes('id="manualSubscriptionPlansSection"'),
    'dashboard.html must contain #manualSubscriptionPlansSection wrapper'
  );
  assert.ok(
    html.includes('id="manualOrderPlansTitle"'),
    'dashboard.html must contain #manualOrderPlansTitle'
  );
  assert.ok(
    html.includes('id="manualOrderPlansList"'),
    'dashboard.html must contain #manualOrderPlansList'
  );
  assert.ok(
    html.includes('id="manualAddPlanTitle"'),
    'dashboard.html must contain #manualAddPlanTitle'
  );
  assert.ok(
    html.includes('id="manualPlanSelectSection"'),
    'dashboard.html must contain #manualPlanSelectSection'
  );
  assert.ok(
    html.includes('id="manualPlanSelect"'),
    'dashboard.html must contain #manualPlanSelect'
  );
  assert.ok(
    html.includes('id="manualPlanQuantity"'),
    'dashboard.html must contain #manualPlanQuantity'
  );
  assert.ok(
    html.includes('id="manualAddPlanBtn"'),
    'dashboard.html must contain #manualAddPlanBtn'
  );
  assert.ok(
    !html.includes('id="manualPlanSelect" required'),
    '#manualPlanSelect should not have required attribute'
  );
});

test('CSS: admin.css hides subscription plans sections when [hidden]', () => {
  const cssPath = path.join(__dirname, '../admin/admin.css');
  const css = fs.readFileSync(cssPath, 'utf8');

  assert.ok(
    css.includes('.manual-subscription-plans-section[hidden]') ||
    css.includes('#manualSubscriptionPlansSection[hidden]'),
    'admin.css must include hidden display: none rule for subscription plans section'
  );
});

test('openManualOrderModal("pickup") hides all subscription plan UI controls and resets plans', () => {
  const plansSection = global.document.getElementById('manualSubscriptionPlansSection');
  const planSection = global.document.getElementById('manualPlanSelectSection');
  const plansTitle = global.document.getElementById('manualOrderPlansTitle');
  const addPlanTitle = global.document.getElementById('manualAddPlanTitle');
  const plansList = global.document.getElementById('manualOrderPlansList');
  const planSelect = global.document.getElementById('manualPlanSelect');
  const planQty = global.document.getElementById('manualPlanQuantity');
  const addPlanBtn = global.document.getElementById('manualAddPlanBtn');

  // Pre-populate plans as if user was on delivery
  admin.manualOrderPlans = [{ _id: 'plan1', displayName: 'Full Meal', price: 15, quantity: 2 }];

  admin.openManualOrderModal('pickup');

  assert.equal(admin.manualOrderMode, 'pickup');
  assert.equal(admin.manualOrderPlans.length, 0, 'manualOrderPlans must be reset to empty array');

  assert.equal(plansSection.hidden, true, 'plans wrapper must be hidden');
  assert.equal(plansSection.style.display, 'none', 'plans wrapper display must be none');

  assert.equal(planSection.hidden, true, 'plan select section must be hidden');
  assert.equal(plansTitle.hidden, true, 'plans title must be hidden');
  assert.equal(addPlanTitle.hidden, true, 'add plan title must be hidden');
  assert.equal(plansList.hidden, true, 'plans list must be hidden');
  assert.equal(plansList.innerHTML, '', 'plans list must be empty in pickup mode');

  assert.equal(planSelect.disabled, true, 'plan select must be disabled');
  assert.equal(planSelect.value, '', 'plan select value must be empty');
  assert.equal(planQty.disabled, true, 'plan quantity input must be disabled');
  assert.equal(addPlanBtn.disabled, true, 'add plan button must be disabled');
});

test('openManualOrderModal("delivery") preserves and displays subscription plan UI controls', () => {
  const plansSection = global.document.getElementById('manualSubscriptionPlansSection');
  const planSection = global.document.getElementById('manualPlanSelectSection');
  const plansTitle = global.document.getElementById('manualOrderPlansTitle');
  const addPlanTitle = global.document.getElementById('manualAddPlanTitle');
  const plansList = global.document.getElementById('manualOrderPlansList');
  const planSelect = global.document.getElementById('manualPlanSelect');
  const planQty = global.document.getElementById('manualPlanQuantity');
  const addPlanBtn = global.document.getElementById('manualAddPlanBtn');

  // First open pickup to ensure previous state was hidden
  admin.openManualOrderModal('pickup');
  assert.equal(plansSection.hidden, true);

  // Now open delivery
  admin.openManualOrderModal('delivery');

  assert.equal(admin.manualOrderMode, 'delivery');
  assert.equal(plansSection.hidden, false, 'plans wrapper must NOT be hidden in delivery mode');
  assert.equal(plansSection.style.display, '', 'plans wrapper display must be reset');

  assert.equal(planSection.hidden, false, 'plan select section must NOT be hidden');
  assert.equal(plansTitle.hidden, false, 'plans title must NOT be hidden');
  assert.equal(addPlanTitle.hidden, false, 'add plan title must NOT be hidden');
  assert.equal(plansList.hidden, false, 'plans list must NOT be hidden');

  assert.equal(planSelect.disabled, false, 'plan select must be enabled');
  assert.equal(planQty.disabled, false, 'plan quantity input must be enabled');
  assert.equal(addPlanBtn.disabled, false, 'add plan button must be enabled');
});

test('renderManualOrderPlans clears content when manualOrderMode is pickup', () => {
  const plansList = global.document.getElementById('manualOrderPlansList');
  admin.manualOrderMode = 'pickup';
  admin.manualOrderPlans = [{ _id: 'plan1', displayName: 'Full Meal', price: 15, quantity: 1 }];

  admin.renderManualOrderPlans();
  assert.equal(plansList.innerHTML, '');

  admin.manualOrderMode = 'delivery';
  admin.renderManualOrderPlans();
  assert.ok(plansList.innerHTML.includes('Full Meal'));
});

test('Pickup mode only shows individual pickup products in item selector, not delivery catalog items', () => {
  admin.manualOrderMode = 'pickup';
  admin.manualOrderProducts = [
    { _id: 'p1', name: 'Samosa Box', price: 10, stock: 5 },
    { _id: 'p2', name: 'Gulab Jamun', price: 6, stock: 0 }
  ];
  admin.manualOrderCatalog = [
    { key: 'dal', name: 'Dal', supportsSize: true, sizes: ['small', 'medium'] }
  ];
  admin.manualOrderItemRows = [admin.createEmptyManualItemRow()];

  admin.renderManualAddItemRows();

  const container = global.document.getElementById('manualAddItemRows');
  assert.ok(container.innerHTML.includes('Samosa Box ($10.00)'), 'Pickup product must appear in dropdown');
  assert.ok(container.innerHTML.includes('out of stock'), 'Out of stock product must show out of stock label');
  assert.ok(!container.innerHTML.includes('>Dal<'), 'Delivery prep item Dal must NOT appear in pickup dropdown');
  assert.ok(!container.innerHTML.includes('+ Add custom item'), 'Custom delivery item must NOT appear in pickup dropdown');
});

test('Pickup mode calculates amount strictly from individual pickup products, ignoring any plans', () => {
  admin.manualOrderMode = 'pickup';
  admin.manualOrderPlans = [{ _id: 'plan1', price: 50, quantity: 1 }];
  admin.manualOrderItems = [
    { productId: 'p1', priceAtPurchase: 12.50, quantity: 2 }
  ];

  admin.updateManualOrderAmount();
  const amountField = global.document.getElementById('manualAmount');
  assert.equal(amountField.value, '25.00', 'Amount must be 12.50 * 2 = 25.00, not including the 50 plan');
});

test('Switching Delivery → Pickup guarantees empty plans payload upon submit and requires pickup items', () => {
  admin.openManualOrderModal('delivery');
  admin.manualOrderPlans = [{ _id: 'plan1', price: 30, quantity: 1 }];
  assert.equal(admin.manualOrderPlans.length, 1);

  // Switch to pickup mode
  admin.openManualOrderModal('pickup');
  assert.equal(admin.manualOrderPlans.length, 0);

  // Attempting submit without items gives validation error
  const messageEl = global.document.getElementById('manualOrderMessage');
  const form = global.document.getElementById('manualOrderForm');

  // Trigger form submit
  form.trigger('submit');
  assert.equal(messageEl.textContent, 'Add at least one item before creating the order.');
});
