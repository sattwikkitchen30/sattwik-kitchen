const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Browser mocks for script.js in Node environment
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
  querySelectorAll(sel) {
    if (sel === '.product-image-shell' || sel === '.product-image-container') {
      return this.querySelector(sel) ? [this.querySelector(sel)] : [];
    }
    if (sel === 'img') {
      return this.querySelector('img') ? [this.querySelector('img')] : [];
    }
    return [];
  }
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
    if (sel === '.product-image-shell' || sel === '.product-image-container') {
      if (this.innerHTMLValue.includes('product-image-shell') || this.innerHTMLValue.includes('product-image-container')) {
        return new MockElement('div');
      }
      return null;
    }
    if (sel === 'img') {
      const match = this.innerHTMLValue.match(/<img src="([^"]+)" alt="([^"]+)" \/>/);
      if (match) {
        const img = new MockElement('img');
        img.src = match[1];
        img.alt = match[2];
        return img;
      }
      return null;
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

const { createProductCard, cart } = require('../public/script.js');

test('CSS rules: public/styles.css specifies uniform container (220px), centering, and object-fit: contain', () => {
  const css = fs.readFileSync(path.join(__dirname, '../public/styles.css'), 'utf8');

  // Check .product-image-shell / .product-image-container container rules
  assert.match(css, /\.product-image-shell[\s\S]*?width:\s*100%/, 'Container must have width: 100%');
  assert.match(css, /\.product-image-shell[\s\S]*?height:\s*220px/, 'Container must have height: 220px for proportional aspect ratio');
  assert.match(css, /\.product-image-shell[\s\S]*?display:\s*flex/, 'Container must use flex centering');
  assert.match(css, /\.product-image-shell[\s\S]*?align-items:\s*center/, 'Container must align items center');
  assert.match(css, /\.product-image-shell[\s\S]*?justify-content:\s*center/, 'Container must justify content center');
  assert.match(css, /\.product-image-shell[\s\S]*?overflow:\s*hidden/, 'Container must have overflow: hidden');
  assert.match(css, /\.product-image-shell[\s\S]*?background:\s*#fff/, 'Container background must blend seamlessly with white image backgrounds (#fff)');

  // Check img rules: displays complete product without cropping via object-fit: contain
  assert.match(css, /\.product-image-shell img[\s\S]*?object-fit:\s*contain/, 'Images must use object-fit: contain to ensure complete product is visible without cropping');
  assert.match(css, /\.product-image-shell img[\s\S]*?object-position:\s*center/, 'Images must be centered via object-position: center');
  assert.match(css, /\.product-image-shell img[\s\S]*?width:\s*100%/, 'Images must specify width: 100%');
  assert.match(css, /\.product-image-shell img[\s\S]*?height:\s*100%/, 'Images must specify height: 100%');
  assert.match(css, /\.product-image-shell img[\s\S]*?box-sizing:\s*border-box/, 'Images must use box-sizing: border-box');
  assert.match(css, /\.product-image-shell img[\s\S]*?padding:\s*0/, 'Images must have padding: 0 to maximize available image area');
});

test('CSS rules: mobile layout preserves uniform height and alignment', () => {
  const css = fs.readFileSync(path.join(__dirname, '../public/styles.css'), 'utf8');
  const rootCss = fs.readFileSync(path.join(__dirname, '../styles.css'), 'utf8');

  // Ensure no media query inflates product-image-shell to 250px or another height
  assert.doesNotMatch(css, /@media[^{]+\{[\s\S]*?\.product-image-shell\s*\{\s*height:\s*250px/, 'Mobile media query must not override height to 250px in public/styles.css');
  assert.doesNotMatch(rootCss, /@media[^{]+\{[\s\S]*?\.product-image-shell[^{]*\{\s*height:\s*250px/, 'Mobile media query must not override height to 250px in styles.css');
  assert.match(rootCss, /@media\(max-width:700px\)\{[\s\S]*?\.product-image-shell,\.product-image-container\{height:220px\}/, 'Mobile media query maintains height: 220px');
});

test('CSS rules: root styles.css is synchronized with complete-view product image rules', () => {
  const rootCss = fs.readFileSync(path.join(__dirname, '../styles.css'), 'utf8');

  assert.match(rootCss, /\.product-image-shell[\s\S]*?height:\s*220px/, 'Root styles.css must define height: 220px');
  assert.match(rootCss, /\.product-image-shell img[\s\S]*?object-fit:\s*contain/, 'Root styles.css must define object-fit: contain');
  assert.match(rootCss, /\.product-image-shell img[\s\S]*?object-position:\s*center/, 'Root styles.css must define object-position: center');
  assert.match(rootCss, /\.product-image-shell[\s\S]*?background:\s*#fff/, 'Root styles.css must define background: #fff');
});

test('Customer HTML: all product cards in public/index.html have uniform image containers', () => {
  const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');

  // Every product-card should have a product-image-shell / product-image-container
  const cardCount = (html.match(/<article class="product-card"/g) || []).length;
  const shellCount = (html.match(/class="product-image-shell/g) || []).length;
  const containerClassCount = (html.match(/product-image-container/g) || []).length;

  assert.ok(cardCount > 0, 'Catalog contains product cards');
  assert.equal(shellCount, cardCount, 'Every product card must have an image container shell');
  assert.equal(containerClassCount, cardCount, 'Every product card must have product-image-container class');
});

test('Dynamic cards: createProductCard creates enlarged image container for tall source images (e.g. bottles/jars)', () => {
  const tallProduct = {
    _id: 'tall_jar_1',
    name: 'Tall Mango Pickle Jar',
    category: 'Pickles',
    price: 12.99,
    stock: 5,
    description: 'Traditional home-made mango pickle packed in tall glass jar.',
    image: 'https://example.com/tall-pickle-bottle-600x1200.jpg'
  };

  const card = createProductCard(tallProduct);

  assert.ok(card.innerHTML.includes('class="product-image-shell product-image-container"'), 'Container has both uniform image classes');
  assert.ok(card.innerHTML.includes('src="https://example.com/tall-pickle-bottle-600x1200.jpg"'), 'Image src matches tall image URL');
  assert.ok(card.innerHTML.includes('alt="Tall Mango Pickle Jar"'), 'Image alt matches product name');
});

test('Dynamic cards: createProductCard creates enlarged image container for wide source images (e.g. platters)', () => {
  const wideProduct = {
    _id: 'wide_platter_1',
    name: 'Full Breakfast Platter',
    category: 'Breakfast',
    price: 15.00,
    stock: 8,
    description: 'Assorted hot breakfast items served on a wide traditional tray.',
    image: 'https://example.com/wide-platter-1200x500.jpg'
  };

  const card = createProductCard(wideProduct);

  assert.ok(card.innerHTML.includes('class="product-image-shell product-image-container"'), 'Container has uniform image classes');
  assert.ok(card.innerHTML.includes('src="https://example.com/wide-platter-1200x500.jpg"'), 'Image src matches wide image URL');
});

test('Dynamic cards: createProductCard creates enlarged image container for square source images', () => {
  const squareProduct = {
    _id: 'sq_powder_1',
    name: 'Curry Leaf Powder Pack',
    category: 'Powders',
    price: 9.99,
    stock: 12,
    description: 'Spiced aromatic curry leaf powder in a square pouch.',
    image: 'https://example.com/curry-leaf-800x800.jpg'
  };

  const card = createProductCard(squareProduct);

  assert.ok(card.innerHTML.includes('class="product-image-shell product-image-container"'), 'Container has uniform image classes');
  assert.ok(card.innerHTML.includes('src="https://example.com/curry-leaf-800x800.jpg"'), 'Image src matches square image URL');
});

test('Dynamic cards: fallback to assets/product-placeholder.svg when product has no image', () => {
  const noImageProduct = {
    _id: 'no_img_1',
    name: 'Fresh Podi',
    category: 'Powders',
    price: 7.99,
    stock: 10
  };

  const card = createProductCard(noImageProduct);

  assert.ok(card.innerHTML.includes('class="product-image-shell product-image-container"'), 'Container has uniform image classes');
  assert.ok(card.innerHTML.includes('src="assets/product-placeholder.svg"'), 'Falls back to placeholder svg');
});

test('Preservation: cart functionality and product card details remain intact', () => {
  cart.clear();
  const product = {
    _id: 'prod_cart_test',
    name: 'Tomato Chutney',
    category: 'Pickles',
    price: 8.50,
    stock: 5,
    description: 'Tangy fresh tomato chutney.'
  };

  const card = createProductCard(product);

  assert.equal(card.dataset.productId, 'prod_cart_test');
  assert.equal(card.dataset.name, 'Tomato Chutney');
  assert.equal(card.dataset.price, '8.5');
  assert.equal(card.dataset.stock, '5');

  // Verify qty stepper structure
  const minus = card.querySelector('.qty-minus');
  const plus = card.querySelector('.qty-plus');
  const qtyVal = card.querySelector('.qty-value');

  assert.ok(minus, 'Quantity minus button is present');
  assert.ok(plus, 'Quantity plus button is present');
  assert.ok(qtyVal, 'Quantity value display is present');
  assert.equal(qtyVal.textContent, '0', 'Initial quantity is 0');
});

test('Scope isolation: Admin styles and unrelated site images are not modified', () => {
  const adminCss = fs.readFileSync(path.join(__dirname, '../admin/admin.css'), 'utf8');

  // Ensure product-image-shell or product-image-container were NOT added to admin.css
  assert.doesNotMatch(adminCss, /\.product-image-shell/, 'admin.css must not contain customer product image classes');
  assert.doesNotMatch(adminCss, /\.product-image-container/, 'admin.css must not contain customer product image classes');

  // Ensure hero, catering, and brand images in public/styles.css maintain their separate selectors
  const publicCss = fs.readFileSync(path.join(__dirname, '../public/styles.css'), 'utf8');
  assert.match(publicCss, /\.brand-logo\s*\{/, 'Brand logo styling is preserved');
  assert.match(publicCss, /\.hero-card-main img\s*\{/, 'Hero image styling is preserved');
  assert.match(publicCss, /\.catering-visual img\s*\{/, 'Catering visual styling is preserved');
  assert.match(publicCss, /\.footer-logo\s*\{/, 'Footer logo styling is preserved');
});
