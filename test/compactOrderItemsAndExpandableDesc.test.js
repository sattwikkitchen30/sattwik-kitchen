const test = require('node:test');
const assert = require('node:assert/strict');

// Browser mocks for admin.js and script.js in Node environment
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
  querySelectorAll(sel) { return []; }
  querySelector(sel) {
    if (sel === '.desc-toggle-btn') {
      const btn = new MockElement('button');
      btn.textContent = '...more';
      btn.setAttribute('aria-expanded', 'false');
      return btn;
    }
    if (sel === '.qty-minus' || sel === '.qty-plus') return new MockElement('button');
    if (sel === '.qty-value') {
      const val = new MockElement('span');
      val.textContent = '0';
      return val;
    }
    return null;
  }
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

global.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
global.window = {
  location: { href: '', pathname: '', search: '' },
  addEventListener: () => {},
  open: () => {}
};
const domElements = new Map();
global.document = {
  getElementById: (id) => {
    if (!domElements.has(id)) domElements.set(id, new MockElement('div'));
    return domElements.get(id);
  },
  createElement: (tag) => new MockElement(tag),
  querySelectorAll: () => [],
  querySelector: () => new MockElement('div'),
  addEventListener: () => {}
};
global.IntersectionObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

// ----------------------------------------------------
// Part 1: Admin compact item formatting & orders table
// ----------------------------------------------------
const { formatCompactItemName, renderOrdersTable, state: adminState } = require('../admin/admin.js');

test('formatCompactItemName: compresses Full Meal packages across Single, Couple, Family', () => {
  assert.equal(formatCompactItemName('Tiffin Plan — Full Meal Package (Single)'), 'Full Meal — Single');
  assert.equal(formatCompactItemName('Tiffin Plan — Full Meal Package (Couple)'), 'Full Meal — Couple');
  assert.equal(formatCompactItemName('Tiffin Plan — Full Meal Package (Family)'), 'Full Meal — Family');
  assert.equal(formatCompactItemName('Full Meal Package (Single)'), 'Full Meal — Single');
  assert.equal(formatCompactItemName('Full Meal Package (Couple)'), 'Full Meal — Couple');
  assert.equal(formatCompactItemName('Full Meal Package (Family)'), 'Full Meal — Family');
  assert.equal(formatCompactItemName('Full Meal (Single)'), 'Full Meal — Single');
  assert.equal(formatCompactItemName('Full Meal (Couple)'), 'Full Meal — Couple');
  assert.equal(formatCompactItemName('Full Meal (Family)'), 'Full Meal — Family');
});

test('formatCompactItemName: compresses Curry-Only packages across Single, Couple, Family', () => {
  assert.equal(formatCompactItemName('Tiffin Plan — Curry-Only Package (Single)'), 'Curry-Only — Single');
  assert.equal(formatCompactItemName('Tiffin Plan — Curry-Only Package (Couple)'), 'Curry-Only — Couple');
  assert.equal(formatCompactItemName('Tiffin Plan — Curry-Only Package (Family)'), 'Curry-Only — Family');
  assert.equal(formatCompactItemName('Tiffin Plan — Curry Only Package (Single)'), 'Curry-Only — Single');
  assert.equal(formatCompactItemName('Curry-Only Package (Single)'), 'Curry-Only — Single');
  assert.equal(formatCompactItemName('Curry-Only Package (Couple)'), 'Curry-Only — Couple');
  assert.equal(formatCompactItemName('Curry-Only Package (Family)'), 'Curry-Only — Family');
  assert.equal(formatCompactItemName('Curry Only (Couple)'), 'Curry-Only — Couple');
});

test('formatCompactItemName: preserves regular pickup products and additional items', () => {
  assert.equal(formatCompactItemName('Tomato Pickle'), 'Tomato Pickle');
  assert.equal(formatCompactItemName('Mango Pickle'), 'Mango Pickle');
  assert.equal(formatCompactItemName('Medium Dal'), 'Medium Dal');
  assert.equal(formatCompactItemName('Large Curry'), 'Large Curry');
  assert.equal(formatCompactItemName('Chapathi'), 'Chapathi');
  assert.equal(formatCompactItemName('Rice Box'), 'Rice Box');
  assert.equal(formatCompactItemName(''), '');
  assert.equal(formatCompactItemName(null), '');
});

test('Admin Orders table: renders compact item labels with full name in tooltip and order-item-cell class', async () => {
  const table = document.getElementById('ordersTable');
  adminState.ordersFulfillment = 'delivery';

  global.fetch = async (url) => {
    if (url.includes('/orders')) {
      return {
        ok: true,
        text: async () => JSON.stringify({
          orders: [
            {
              _id: 'ord_test_compact',
              orderId: '26101500099',
              type: 'tiffin',
              fulfillment: 'delivery',
              totalAmount: 300.00,
              subscriptionStartDate: '2026-10-15',
              subscriptionEndDate: '2026-11-12',
              createdAt: '2026-10-15T10:00:00.000Z',
              customerDoc: { firstName: 'Jane', lastName: 'Doe', phone: '6041234567', email: 'jane@example.com' },
              items: [
                {
                  productName: 'Tiffin Plan — Full Meal Package (Couple)',
                  category: 'Tiffin Plans',
                  priceAtPurchase: 300.00,
                  quantity: 1,
                  subtotal: 300.00,
                  fulfillment: 'delivery'
                },
                {
                  productName: 'Medium Dal',
                  category: 'Add-ons',
                  priceAtPurchase: 10.00,
                  quantity: 2,
                  subtotal: 20.00,
                  fulfillment: 'delivery'
                }
              ]
            }
          ],
          total: 1,
          page: 1,
          pages: 1
        })
      };
    }
    if (url.includes('/delivery-members')) {
      return { ok: true, text: async () => JSON.stringify({ members: [] }) };
    }
    return { ok: true, text: async () => '{}' };
  };

  await renderOrdersTable();
  const html = table.innerHTML;

  // Verify compact label is rendered
  assert.ok(html.includes('Full Meal — Couple × 1'), 'Displays compact label Full Meal — Couple × 1');
  assert.ok(html.includes('Medium Dal × 2'), 'Displays additional item Medium Dal × 2');

  // Verify full descriptive name is available in title tooltip
  assert.ok(html.includes('title="Tiffin Plan — Full Meal Package (Couple) × 1"'), 'Tooltip contains full descriptive plan name');

  // Verify column styling class
  assert.ok(html.includes('class="order-item-cell"'), 'Uses order-item-cell for compact width and wrapping');

  // Verify Add Items button is present
  assert.ok(html.includes('class="edit-tiffin-items-btn"'), 'Add Items action remains accessible');
});

// ----------------------------------------------------
// Part 2: Customer product description truncation & toggle
// ----------------------------------------------------
const {
  renderProductDescriptionHtml,
  toggleProductDescription,
  PRODUCT_DESCRIPTION_MAX_CHARS,
  createProductCard
} = require('../public/script.js');

test('renderProductDescriptionHtml: returns full text without toggle for short descriptions (<= 100 chars)', () => {
  const shortText = 'Authentic homemade garlic pickle prepared with pure spices.';
  assert.ok(shortText.length <= PRODUCT_DESCRIPTION_MAX_CHARS);
  const html = renderProductDescriptionHtml(shortText);
  assert.ok(html.includes('<p class="product-description">'), 'Contains product-description paragraph');
  assert.ok(html.includes(shortText), 'Contains complete short description');
  assert.equal(html.includes('desc-toggle-btn'), false, 'Does NOT contain toggle button for short descriptions');
});

test('renderProductDescriptionHtml: truncates descriptions longer than 100 chars and provides ...more button', () => {
  const longText = 'Our traditional homemade mango pickle is prepared using hand-picked farm fresh raw mangoes, cold-pressed sesame oil, and authentic Andhra spices aged to perfection.';
  assert.ok(longText.length > PRODUCT_DESCRIPTION_MAX_CHARS);
  const html = renderProductDescriptionHtml(longText);

  assert.ok(html.includes('class="product-description"'), 'Has product-description class');
  assert.ok(html.includes('class="desc-toggle-btn"'), 'Contains toggle button');
  assert.ok(html.includes('>...more</button>'), 'Initial toggle button text is ...more');
  assert.ok(html.includes('aria-expanded="false"'), 'Initial aria-expanded is false');

  // Truncated text should be at most 100 chars
  const expectedTruncated = longText.slice(0, PRODUCT_DESCRIPTION_MAX_CHARS).trim();
  assert.ok(html.includes(expectedTruncated), 'Contains truncated text');
  // Full text should be preserved in data attribute
  assert.ok(html.includes(`data-full-text="${longText}"`), 'Full text stored in data-full-text');
});

test('renderProductDescriptionHtml: handles empty or whitespace description gracefully', () => {
  assert.equal(renderProductDescriptionHtml(''), '');
  assert.equal(renderProductDescriptionHtml('   '), '');
  assert.equal(renderProductDescriptionHtml(null), '');
  assert.equal(renderProductDescriptionHtml(undefined), '');
});

test('toggleProductDescription: expands to ...less and collapses back to ...more independently', () => {
  const longText = 'A'.repeat(120);
  const truncatedText = 'A'.repeat(100);

  // Mock DOM container
  const container = {
    dataset: {
      fullText: longText,
      truncatedText: truncatedText
    },
    getAttribute(k) { return this.dataset[k]; }
  };
  const descText = { textContent: truncatedText };
  const toggleBtn = {
    textContent: '...more',
    attributes: { 'aria-expanded': 'false' },
    getAttribute(k) { return this.attributes[k]; },
    setAttribute(k, v) { this.attributes[k] = String(v); },
    closest(sel) {
      if (sel === '.product-description') return container;
      return null;
    }
  };
  container.querySelector = (sel) => (sel === '.desc-text' ? descText : null);

  // Click 1: Expand
  toggleProductDescription(toggleBtn);
  assert.equal(descText.textContent, longText, 'Expands to full description text');
  assert.equal(toggleBtn.textContent, '...less', 'Button changes to ...less');
  assert.equal(toggleBtn.getAttribute('aria-expanded'), 'true', 'aria-expanded becomes true');

  // Click 2: Collapse
  toggleProductDescription(toggleBtn);
  assert.equal(descText.textContent, truncatedText, 'Collapses back to truncated text');
  assert.equal(toggleBtn.textContent, '...more', 'Button changes back to ...more');
  assert.equal(toggleBtn.getAttribute('aria-expanded'), 'false', 'aria-expanded becomes false');
});

test('createProductCard: renders product card with expandable description and independent quantity controls', () => {
  const longDesc = 'Delicious fresh steamed idlis served with flavourful spiced sambar and two varieties of fresh homemade chutneys.';
  const product = {
    _id: 'prod_dosa_1',
    name: 'Steamed Idli Platter',
    price: 9.99,
    category: 'Breakfast',
    stock: 10,
    description: longDesc
  };

  const card = createProductCard(product);
  assert.equal(card.dataset.name, 'Steamed Idli Platter');

  const toggleBtn = card.querySelector('.desc-toggle-btn');
  assert.ok(toggleBtn, 'Card includes description toggle button');
  assert.equal(toggleBtn.textContent, '...more');

  // Verify quantity controls are present
  const minus = card.querySelector('.qty-minus');
  const plus = card.querySelector('.qty-plus');
  const qtyVal = card.querySelector('.qty-value');
  assert.ok(minus, 'Minus quantity button exists');
  assert.ok(plus, 'Plus quantity button exists');
  assert.ok(qtyVal, 'Quantity value display exists');
});
