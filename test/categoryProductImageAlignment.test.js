const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const publicCssPath = path.join(__dirname, '..', 'public', 'styles.css');
const rootCssPath = path.join(__dirname, '..', 'styles.css');
const publicScriptPath = path.join(__dirname, '..', 'public', 'script.js');

// Mock DOM environment for script.js
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
      add: (...classes) => classes.forEach((c) => this._classes.add(c)),
      remove: (...classes) => classes.forEach((c) => this._classes.delete(c)),
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
  get className() { return Array.from(this._classes).join(' '); }
  set className(val) {
    this._classes.clear();
    (val || '').split(/\s+/).filter(Boolean).forEach((c) => this._classes.add(c));
  }
  setAttribute(k, v) { this.attributes[k] = String(v); }
  getAttribute(k) { return this.attributes[k] || null; }
  appendChild(el) { this.children.push(el); return el; }
  querySelectorAll() { return []; }
  querySelector(sel) {
    if (sel === '.qty-minus' || sel === '.qty-plus') return new MockElement('button');
    if (sel === '.qty-value') {
      const el = new MockElement('span');
      el.textContent = '0';
      return el;
    }
    if (sel === '.product-image-shell' || sel === '.product-image-container') {
      return new MockElement('div');
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
global.window = { location: { href: '', pathname: '', search: '' }, addEventListener: () => {}, open: () => {} };
const domElements = new Map();
global.document = {
  getElementById: (id) => {
    if (!domElements.has(id)) domElements.set(id, new MockElement('div'));
    return domElements.get(id);
  },
  createElement: (tag) => new MockElement(tag),
  querySelectorAll: () => [],
  querySelector: () => null,
  addEventListener: () => {}
};
global.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };

const { createProductCard } = require('../public/script.js');

test('Category-Specific CSS: Pickles and Powders have prominent 270px height without cropping', () => {
  const css = fs.readFileSync(publicCssPath, 'utf8');

  // Verify Pickles & Powders rules
  assert.match(css, /#picklesGrid\s*\.product-image-container[\s\S]*?height:\s*270px/, 'Pickles grid has 270px container height');
  assert.match(css, /#powdersGrid\s*\.product-image-container[\s\S]*?height:\s*270px/, 'Powders grid has 270px container height');
  assert.match(css, /\.product-card\[data-category="Pickles" i\]\s*\.product-image-container[\s\S]*?height:\s*270px/, 'Pickles category attribute has 270px height');
  assert.match(css, /\.product-card\[data-category="Powders" i\]\s*\.product-image-container[\s\S]*?height:\s*270px/, 'Powders category attribute has 270px height');

  // Verify object-fit: contain is used so jars, lids, bases, and packets are never cut off
  assert.match(css, /#picklesGrid\s*\.product-image-container\s*img[\s\S]*?object-fit:\s*contain/, 'Pickles images use object-fit: contain');
  assert.match(css, /#powdersGrid\s*\.product-image-container\s*img[\s\S]*?object-fit:\s*contain/, 'Powders images use object-fit: contain');
});

test('Category-Specific CSS: Sweets and Snacks fill grid area with object-fit: contain (no cropping)', () => {
  const css = fs.readFileSync(publicCssPath, 'utf8');

  // Verify Sweets & Snacks rules
  assert.match(css, /#sweetsGrid\s*\.product-image-container[\s\S]*?height:\s*220px/, 'Sweets grid has 220px container height');
  assert.match(css, /#snacksGrid\s*\.product-image-container[\s\S]*?height:\s*220px/, 'Snacks grid has 220px container height');
  assert.match(css, /\.product-card\[data-category="Sweets" i\]\s*\.product-image-container[\s\S]*?height:\s*220px/, 'Sweets category attribute has 220px height');
  assert.match(css, /\.product-card\[data-category="Snacks" i\]\s*\.product-image-container[\s\S]*?height:\s*220px/, 'Snacks category attribute has 220px height');

  // Verify Sweets & Snacks use object-fit: contain so complete sweets/snacks remain visible
  assert.match(css, /#sweetsGrid\s*\.product-image-container\s*img[\s\S]*?object-fit:\s*contain/, 'Sweets images use object-fit: contain');
  assert.match(css, /#snacksGrid\s*\.product-image-container\s*img[\s\S]*?object-fit:\s*contain/, 'Snacks images use object-fit: contain');
});

test('Category-Specific CSS: Root styles.css is synchronized with category rules', () => {
  const rootCss = fs.readFileSync(rootCssPath, 'utf8');

  assert.match(rootCss, /#picklesGrid \.product-image-container[\s\S]*?height:270px/, 'Root CSS has pickles 270px rule');
  assert.match(rootCss, /#sweetsGrid \.product-image-container[\s\S]*?height:220px/, 'Root CSS has sweets 220px rule');
});

test('Dynamic Cards: createProductCard assigns category class and data-category attribute', () => {
  const pickleProduct = {
    _id: 'p1',
    name: 'Spicy Mango Pickle',
    category: 'Pickles',
    price: 9.99,
    image: 'https://res.cloudinary.com/spfurewl/image/upload/v1789330097/pickles.png'
  };

  const card = createProductCard(pickleProduct);
  assert.equal(card.dataset.category, 'Pickles', 'Sets data-category to Pickles');
  assert.ok(card.classList.contains('category-pickles'), 'Adds category-pickles class to article');

  const sweetProduct = {
    _id: 's1',
    name: 'Gulab Jamoon',
    category: 'Sweets',
    price: 10.00,
    image: 'https://example.com/gulab-jamoon.jpg'
  };

  const sweetCard = createProductCard(sweetProduct);
  assert.equal(sweetCard.dataset.category, 'Sweets', 'Sets data-category to Sweets');
  assert.ok(sweetCard.classList.contains('category-sweets'), 'Adds category-sweets class to article');

  const snackProduct = {
    _id: 'sn1',
    name: 'Mirchi Bajji',
    category: 'Snacks',
    price: 8.00,
    image: 'https://example.com/mirchi-bajji.jpg'
  };

  const snackCard = createProductCard(snackProduct);
  assert.equal(snackCard.dataset.category, 'Snacks', 'Sets data-category to Snacks');
  assert.ok(snackCard.classList.contains('category-snacks'), 'Adds category-snacks class to article');
});
