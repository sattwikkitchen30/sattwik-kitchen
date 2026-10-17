const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// ---------------------------------------------------------------------------
// 1. Static HTML & CSS inspection
// ---------------------------------------------------------------------------
test('HTML structure: manualOrderModal has manual-order-modal class, 2-col rows, and compact actions', () => {
  const htmlPath = path.join(__dirname, '../admin/dashboard.html');
  const html = fs.readFileSync(htmlPath, 'utf8');

  // Modal shell has manual-order-modal class
  assert.ok(
    html.includes('class="modal-shell manual-order-modal"'),
    'modal shell should include manual-order-modal class for scoping'
  );

  // Form includes 2-col layout rows for customer fields
  assert.ok(
    html.includes('class="manual-order-row-2col"'),
    'customer fields should be organized into 2-column rows'
  );

  // Add items table includes Quantity header with class
  assert.ok(
    html.includes('class="manual-qty-col"'),
    'Quantity column header should have manual-qty-col class'
  );

  // Bottom buttons in manual-order-actions
  assert.ok(
    html.includes('id="manualOrderSubmit"') && html.includes('id="manualOrderCancelBtn"'),
    'both manualOrderSubmit and manualOrderCancelBtn must be present'
  );

  // Verify primary and secondary classes
  assert.ok(
    html.includes('class="btn btn-primary" id="manualOrderSubmit"') ||
    html.includes('id="manualOrderSubmit" class="btn btn-primary"'),
    'Create Order button must have btn-primary'
  );
  assert.ok(
    html.includes('class="btn btn-secondary" id="manualOrderCancelBtn"') ||
    html.includes('id="manualOrderCancelBtn" class="btn btn-secondary"'),
    'Cancel button must have btn-secondary'
  );
});

test('CSS rules: admin.css contains compact rules for manual order modal and buttons', () => {
  const cssPath = path.join(__dirname, '../admin/admin.css');
  const css = fs.readFileSync(cssPath, 'utf8');

  // Modal shell width
  assert.ok(
    css.includes('.manual-order-modal') || css.includes('#manualOrderModal .modal-shell'),
    'CSS must style manual order modal shell'
  );

  // 2-column row style
  assert.ok(
    css.includes('.manual-order-row-2col'),
    'CSS must contain .manual-order-row-2col rules'
  );

  // Compact bottom buttons
  assert.ok(
    css.includes('.manual-order-actions'),
    'CSS must style .manual-order-actions'
  );
  assert.ok(
    css.includes('.manual-order-actions button') || css.includes('.manual-order-actions .btn'),
    'CSS must specify compact sizing for manual order action buttons'
  );

  // Selected items compact controls
  assert.ok(
    css.includes('#manualOrderItemsList .tiffin-item-row'),
    'CSS must style selected items row in manual order'
  );
  assert.ok(
    css.includes('#manualOrderItemsList .tiffin-item-quantity'),
    'CSS must style quantity input in manual order items'
  );

  // Add items table 4-column layout with wide item dropdown
  assert.ok(
    css.includes('#manualAddItemsTable .tiffin-add-items-header') ||
    css.includes('#manualAddItemsTable .tiffin-add-item-row'),
    'CSS must style Add Items table in manual order'
  );

  // Add another item compact button
  assert.ok(
    css.includes('#manualAddAnotherItemBtn'),
    'CSS must style Add Another Item button compactly'
  );

  // Mobile media query overrides
  assert.ok(
    css.includes('@media (max-width: 540px)'),
    'CSS must include mobile media query for 540px or narrower'
  );
});

// ---------------------------------------------------------------------------
// 2. Functional JS tests for renderManualOrderItems
// ---------------------------------------------------------------------------
// Set up browser mocks before requiring admin.js
global.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
global.window = { location: { href: '', pathname: '', search: '' }, addEventListener: () => {} };

const domMap = new Map();
class MockEl {
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
    this._classes = new Set();
    this.listeners = {};
  }
  get classList() {
    return {
      add: (c) => this._classes.add(c),
      remove: (c) => this._classes.delete(c),
      toggle: (c) => (this._classes.has(c) ? this._classes.delete(c) : this._classes.add(c)),
      contains: (c) => this._classes.has(c)
    };
  }
  setAttribute(k, v) { this.attributes[k] = String(v); }
  getAttribute(k) { return this.attributes[k] || null; }
  appendChild(el) { this.children.push(el); return el; }
  querySelectorAll() { return []; }
  querySelector() { return null; }
  addEventListener(type, cb) {
    if (!this.listeners[type]) this.listeners[type] = [];
    this.listeners[type].push(cb);
  }
  set innerHTML(val) {
    this.innerHTMLValue = val;
    this.textContent = val.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  }
  get innerHTML() { return this.innerHTMLValue; }
}

global.document = {
  getElementById: (id) => {
    if (!domMap.has(id)) domMap.set(id, new MockEl('div'));
    return domMap.get(id);
  },
  createElement: (tag) => new MockEl(tag),
  querySelectorAll: () => [],
  querySelector: () => new MockEl('div'),
  addEventListener: () => {}
};

const admin = require('../admin/admin');

test('renderManualOrderItems: generates tooltip title and manual-order-item-row class', () => {
  admin.manualOrderItems = [
    {
      productName: 'Full Meal Package (Couple)',
      quantity: 2,
      priceAtPurchase: 300
    }
  ];

  admin.renderManualOrderItems();
  const listEl = domMap.get('manualOrderItemsList');
  assert.ok(listEl);
  assert.ok(
    listEl.innerHTML.includes('manual-order-item-row'),
    'item row must include manual-order-item-row class'
  );
  assert.ok(
    listEl.innerHTML.includes('title="Full Meal Package (Couple)"'),
    'item strong element must include title attribute for tooltip'
  );
  assert.ok(
    listEl.innerHTML.includes('value="2"'),
    'quantity input must reflect current quantity'
  );
  assert.ok(
    listEl.innerHTML.includes('data-step="-1"') && listEl.innerHTML.includes('data-step="1"'),
    'both minus and plus step buttons must be rendered'
  );
  assert.ok(
    listEl.innerHTML.includes('class="tiffin-item-remove"'),
    'remove button must be rendered'
  );
});
