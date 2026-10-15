const test = require('node:test');
const assert = require('node:assert/strict');

// Minimal DOM implementation for script.js tests in Node
class SimpleElement {
  constructor(tagName = 'div') {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this._classes = new Set();
    this.dataset = {};
    this.attributes = {};
    this.listeners = {};
    this.textContent = '';
    this.innerHTMLValue = '';
    this.value = '';
    this.disabled = false;
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
  removeAttribute(k) { delete this.attributes[k]; }

  addEventListener(type, cb) {
    if (!this.listeners[type]) this.listeners[type] = [];
    this.listeners[type].push(cb);
  }

  dispatch(type, eventObj = {}) {
    eventObj.target = eventObj.target || this;
    eventObj.closest = eventObj.closest || ((sel) => {
      if (sel === '[data-delta]' && this.dataset.delta) return this;
      if (sel === '[data-remove]' && this.dataset.remove) return this;
      return null;
    });
    (this.listeners[type] || []).forEach(cb => cb(eventObj));
  }

  appendChild(el) {
    this.children.push(el);
    return el;
  }

  set innerHTML(html) {
    this.innerHTMLValue = html;
    this.children = parseHtmlToElements(html);
  }

  get innerHTML() {
    return this.innerHTMLValue;
  }

  querySelector(selector) {
    const all = this.querySelectorAll(selector);
    return all.length ? all[0] : null;
  }

  querySelectorAll(selector) {
    return querySelectorAllElement(this, selector);
  }
}

function querySelectorAllElement(root, selector) {
  const results = [];
  const selectors = selector.split(',').map(s => s.trim());

  function matches(el, sel) {
    if (!el) return false;
    if (sel.startsWith('.')) {
      const cls = sel.slice(1);
      return el._classes && el._classes.has(cls);
    }
    const multiAttrMatch = [...sel.matchAll(/\[([a-zA-Z0-9_-]+)(?:="([^"]*)")?\]/g)];
    if (multiAttrMatch.length > 0) {
      return multiAttrMatch.every(([, attr, val]) => {
        if (attr.startsWith('data-')) {
          const camel = attr.slice(5).replace(/-([a-z])/g, (_, l) => l.toUpperCase());
          if (val === undefined) return el.dataset[camel] !== undefined;
          return el.dataset[camel] === val;
        }
        if (val === undefined) return el.attributes[attr] !== undefined;
        return el.attributes[attr] === val;
      });
    }
    if (sel.toLowerCase() === 'button') return el.tagName === 'BUTTON';
    if (sel.toLowerCase() === 'span') return el.tagName === 'SPAN';
    if (sel.toLowerCase() === 'article') return el.tagName === 'ARTICLE';
    return false;
  }

  function walk(node) {
    for (const child of node.children) {
      for (const sel of selectors) {
        if (sel.includes(' ')) {
          const parts = sel.split(/\s+/);
          if (matches(child, parts[parts.length - 1])) {
            if (matches(node, parts[0])) {
              results.push(child);
              break;
            }
          }
        } else if (matches(child, sel)) {
          results.push(child);
          break;
        }
      }
      walk(child);
    }
  }

  walk(root);
  return results;
}

function parseHtmlToElements(html) {
  const root = new SimpleElement('root');
  const stack = [root];
  const tagTokenRegex = /<!--.*?-->|<(\/)?([a-zA-Z0-9-]+)((?:\s+[^>="']+(?:=(?:"[^"]*"|'[^']*'|[^>\s]+))?)*)\s*(\/)?>|([^<]+)/gs;
  let match;
  while ((match = tagTokenRegex.exec(html)) !== null) {
    const [full, isClose, tagName, rawAttrs, isSelfClosing, textContent] = match;
    if (full.startsWith('<!--')) continue;
    if (textContent) {
      const text = textContent.trim();
      if (text && stack.length > 0) {
        stack[stack.length - 1].textContent += (stack[stack.length - 1].textContent ? ' ' : '') + text;
      }
      continue;
    }
    if (isClose) {
      if (stack.length > 1 && stack[stack.length - 1].tagName === tagName.toUpperCase()) {
        stack.pop();
      }
      continue;
    }
    // Opening tag
    const el = new SimpleElement(tagName);
    if (rawAttrs) {
      const attrRegex = /([a-zA-Z0-9_-]+)(?:=(?:"([^"]*)"|'([^']*)'|([^>\s]+)))?/g;
      let am;
      while ((am = attrRegex.exec(rawAttrs)) !== null) {
        const name = am[1];
        const val = am[2] !== undefined ? am[2] : (am[3] !== undefined ? am[3] : (am[4] !== undefined ? am[4] : ''));
        if (name === 'class') {
          val.split(/\s+/).filter(Boolean).forEach(c => el._classes.add(c));
        } else if (name.startsWith('data-')) {
          const camel = name.slice(5).replace(/-([a-z])/g, (_, l) => l.toUpperCase());
          el.dataset[camel] = val;
        } else {
          el.setAttribute(name, val);
        }
      }
    }
    stack[stack.length - 1].appendChild(el);
    if (!isSelfClosing && !['IMG', 'INPUT', 'BR', 'HR'].includes(el.tagName)) {
      stack.push(el);
    }
  }
  return root.children;
}

// Global browser mocks
const store = new Map();
global.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear()
};

global.fetch = async () => ({
  ok: true,
  json: async () => ({ plans: [], products: [] })
});

const domStore = new Map();
function getOrCreateElement(id, tag = 'div') {
  if (!domStore.has(id)) {
    const el = new SimpleElement(tag);
    el.setAttribute('id', id);
    domStore.set(id, el);
  }
  return domStore.get(id);
}

global.document = {
  getElementById: (id) => getOrCreateElement(id),
  querySelector: (sel) => {
    for (const el of domStore.values()) {
      if (sel === '[data-tiffin-qty]' && el.dataset.tiffinQty !== undefined) return el;
      const found = el.querySelector(sel);
      if (found) return found;
    }
    return null;
  },
  querySelectorAll: (sel) => {
    const res = [];
    for (const el of domStore.values()) {
      res.push(...el.querySelectorAll(sel));
    }
    return res;
  },
  createElement: (tag) => new SimpleElement(tag),
  addEventListener: () => {},
  body: new SimpleElement('body'),
  readyState: 'complete'
};

global.window = {
  location: { href: 'http://localhost/', pathname: '/', search: '' },
  addEventListener: () => {},
  open: () => {}
};

global.IntersectionObserver = class {
  observe() {}
  unobserve() {}
};

const {
  cart,
  parseTiffinPlanId,
  extractTiffinMeta,
  syncTiffinPlanQuantity,
  updateQty,
  initializeTiffinPlanQuantities,
  renderDeliveryPlans
} = require('../public/script');

test('parseTiffinPlanId properly parses curry-only, curry, and full meal formats', () => {
  assert.deepEqual(parseTiffinPlanId('curry-only-single'), { packageType: 'curry-only', size: 'single' });
  assert.deepEqual(parseTiffinPlanId('curry-only-couple'), { packageType: 'curry-only', size: 'couple' });
  assert.deepEqual(parseTiffinPlanId('curry-only-family'), { packageType: 'curry-only', size: 'family' });
  assert.deepEqual(parseTiffinPlanId('curry-single'), { packageType: 'curry-only', size: 'single' });
  assert.deepEqual(parseTiffinPlanId('full-single'), { packageType: 'full', size: 'single' });
  assert.deepEqual(parseTiffinPlanId('full-couple'), { packageType: 'full', size: 'couple' });
});

test('extractTiffinMeta extracts packageType and size correctly', () => {
  assert.deepEqual(extractTiffinMeta({ packageType: 'curry-only', size: 'single' }), { packageType: 'curry-only', size: 'single' });
  assert.deepEqual(extractTiffinMeta({ name: 'Curry-Only Package (Single)' }), { packageType: 'curry-only', size: 'single' });
  assert.deepEqual(extractTiffinMeta({ name: 'Curry-Only Package (Couple)' }), { packageType: 'curry-only', size: 'couple' });
  assert.deepEqual(extractTiffinMeta({ name: 'Curry-Only Package (Family)' }), { packageType: 'curry-only', size: 'family' });
  assert.deepEqual(extractTiffinMeta({ name: 'Full Meal Package (Couple)' }), { packageType: 'full', size: 'couple' });
});

test('Curry-Only delivery plan quantity increment, decrement, and zero removal', () => {
  cart.clear();
  store.clear();

  const plansContainer = getOrCreateElement('plansContainer');
  const planToggle = getOrCreateElement('planToggle');

  const deliveryPlans = [
    {
      _id: 'p1',
      category: 'Full Meal',
      packageType: 'full',
      size: 'single',
      displayName: 'Single',
      price: 240,
      description: 'Single full meal'
    },
    {
      _id: 'p2',
      category: 'Curry-Only',
      packageType: 'curry-only',
      size: 'single',
      displayName: 'Single',
      price: 180,
      description: 'Single curries only'
    },
    {
      _id: 'p3',
      category: 'Curry-Only',
      packageType: 'curry-only',
      size: 'couple',
      displayName: 'Couple',
      price: 260,
      description: 'Couple curries only'
    },
    {
      _id: 'p4',
      category: 'Curry-Only',
      packageType: 'curry-only',
      size: 'family',
      displayName: 'Family',
      price: 360,
      description: 'Family curries only'
    }
  ];

  renderDeliveryPlans(deliveryPlans);

  // Locate the curry-only cards
  const curryCards = plansContainer.querySelectorAll('[data-tiffin-package-type="curry-only"]');
  assert.equal(curryCards.length, 3, 'Should render Single, Couple, Family curry-only cards');

  const singleCard = plansContainer.querySelector('[data-tiffin-plan="curry-only-single"]');
  assert.ok(singleCard, 'Single curry card found');
  const singleQty = singleCard.querySelector('.qty-value');
  const singlePlus = singleCard.querySelector('.qty-plus');
  const singleMinus = singleCard.querySelector('.qty-minus');

  // Initial state is 0
  assert.equal(singleQty.textContent, '0');

  // 1. Click + : 0 -> 1
  singlePlus.dispatch('click');
  assert.equal(singleQty.textContent, '1', 'Counter updates to 1 on plus click');
  assert.equal(cart.get('Curry-Only Package (Single)')?.qty, 1, 'Cart has qty 1');

  // 2. Click + again : 1 -> 2
  singlePlus.dispatch('click');
  assert.equal(singleQty.textContent, '2', 'Counter updates to 2 on second plus click');
  assert.equal(cart.get('Curry-Only Package (Single)')?.qty, 2, 'Cart has qty 2');

  // 3. Click - : 2 -> 1
  singleMinus.dispatch('click');
  assert.equal(singleQty.textContent, '1', 'Counter updates to 1 on minus click');
  assert.equal(cart.get('Curry-Only Package (Single)')?.qty, 1, 'Cart has qty 1');

  // 4. Click - : 1 -> 0 (removed from cart)
  singleMinus.dispatch('click');
  assert.equal(singleQty.textContent, '0', 'Counter updates to 0 on minus click');
  assert.equal(cart.has('Curry-Only Package (Single)'), false, 'Removed from cart at 0');

  // 5. Click - again at 0 : remains 0, cannot go negative
  singleMinus.dispatch('click');
  assert.equal(singleQty.textContent, '0', 'Counter remains 0 on further minus clicks');
  assert.equal(cart.has('Curry-Only Package (Single)'), false, 'Does not enter cart with negative quantity');
});

test('Multiple Curry-Only plans have independent counters and survive tab switches', () => {
  cart.clear();
  store.clear();

  const plansContainer = getOrCreateElement('plansContainer');
  const planToggle = getOrCreateElement('planToggle');

  const deliveryPlans = [
    {
      _id: 'p1',
      category: 'Full Meal',
      packageType: 'full',
      size: 'single',
      displayName: 'Single',
      price: 240
    },
    {
      _id: 'p2',
      category: 'Curry-Only',
      packageType: 'curry-only',
      size: 'single',
      displayName: 'Single',
      price: 180
    },
    {
      _id: 'p3',
      category: 'Curry-Only',
      packageType: 'curry-only',
      size: 'couple',
      displayName: 'Couple',
      price: 260
    },
    {
      _id: 'p4',
      category: 'Curry-Only',
      packageType: 'curry-only',
      size: 'family',
      displayName: 'Family',
      price: 360
    }
  ];

  renderDeliveryPlans(deliveryPlans);

  const singleCard = plansContainer.querySelector('[data-tiffin-plan="curry-only-single"]');
  const coupleCard = plansContainer.querySelector('[data-tiffin-plan="curry-only-couple"]');
  const familyCard = plansContainer.querySelector('[data-tiffin-plan="curry-only-family"]');

  // Increment single to 1, couple to 3, family to 2
  singleCard.querySelector('.qty-plus').dispatch('click');

  coupleCard.querySelector('.qty-plus').dispatch('click');
  coupleCard.querySelector('.qty-plus').dispatch('click');
  coupleCard.querySelector('.qty-plus').dispatch('click');

  familyCard.querySelector('.qty-plus').dispatch('click');
  familyCard.querySelector('.qty-plus').dispatch('click');

  assert.equal(singleCard.querySelector('.qty-value').textContent, '1');
  assert.equal(coupleCard.querySelector('.qty-value').textContent, '3');
  assert.equal(familyCard.querySelector('.qty-value').textContent, '2');

  // Switch category tabs: Full meal -> Curry-Only -> Full meal
  const fullMealTab = planToggle.querySelector('[data-plan-category="Full Meal"]');
  const curryTab = planToggle.querySelector('[data-plan-category="Curry-Only"]');

  if (fullMealTab) fullMealTab.dispatch('click');
  if (curryTab) curryTab.dispatch('click');

  // Ensure counters remain synchronized after tab switches
  assert.equal(singleCard.querySelector('.qty-value').textContent, '1');
  assert.equal(coupleCard.querySelector('.qty-value').textContent, '3');
  assert.equal(familyCard.querySelector('.qty-value').textContent, '2');
});
