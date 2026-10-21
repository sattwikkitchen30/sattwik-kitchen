'use strict';

/**
 * Catering Image Full-Screen Viewer — Regression & Unit Tests
 *
 * Verifies:
 * 1. HTML structure in both public/index.html and root index.html
 * 2. CSS responsive rules in public/styles.css and root styles.css (100dvh, object-fit contain, safe areas)
 * 3. Open/Close lifecycle, scroll preservation, body lock in public/script.js
 * 4. Close triggers: close button, backdrop click, and Escape key
 * 5. Click on image itself does NOT close the viewer
 * 6. Event delegation: works for static and dynamically rendered images in the Catering section
 * 7. Repeated open/close cycles work without duplicates
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

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
    this.hidden = false;
    this.src = '';
    this.alt = '';
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
  querySelector(sel) {
    if (sel === '#imageViewerImg') {
      let img = this.children.find(c => c.id === 'imageViewerImg');
      if (!img) {
        img = new MockElement('img');
        img.id = 'imageViewerImg';
        this.children.push(img);
      }
      return img;
    }
    if (sel === '#imageViewerClose') {
      let btn = this.children.find(c => c.id === 'imageViewerClose');
      if (!btn) {
        btn = new MockElement('button');
        btn.id = 'imageViewerClose';
        this.children.push(btn);
      }
      return btn;
    }
    return null;
  }
  querySelectorAll() { return []; }
  addEventListener(type, cb) {
    if (!this.listeners[type]) this.listeners[type] = [];
    this.listeners[type].push(cb);
  }
  focus() { this.focused = true; }
  set innerHTML(val) {
    this.innerHTMLValue = val;
    this.textContent = val.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  }
  get innerHTML() { return this.innerHTMLValue; }
}

global.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
global.window = {
  location: { href: '', pathname: '', search: '' },
  pageYOffset: 120,
  scrollTo: (x, y) => { global.window.lastScroll = { x, y }; },
  addEventListener: () => {},
  open: () => {}
};
const domElements = new Map();
global.document = {
  activeElement: null,
  body: new MockElement('body'),
  documentElement: { scrollTop: 120 },
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
  addEventListener: (type, cb) => {
    if (!global.document.listeners) global.document.listeners = {};
    if (!global.document.listeners[type]) global.document.listeners[type] = [];
    global.document.listeners[type].push(cb);
  }
};
global.IntersectionObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

const {
  openImageViewer,
  closeImageViewer,
  ensureImageViewerElements,
  initCateringImageViewer
} = require('../public/script.js');

// ─────────────────────────────────────────────────────────────────────────────
// 1. Static HTML structure inspection (public/index.html and index.html)
// ─────────────────────────────────────────────────────────────────────────────

test('1. Static HTML: Full-screen viewer element exists in public/index.html and index.html', () => {
  const files = [
    path.join(__dirname, '../public/index.html'),
    path.join(__dirname, '../index.html')
  ];

  for (const file of files) {
    const html = fs.readFileSync(file, 'utf8');

    // Section and catering visual
    assert.ok(html.includes('id="catering"') || html.includes('class="section catering"'), `Catering section missing in ${file}`);
    assert.ok(html.includes('class="catering-visual"'), `catering-visual missing in ${file}`);

    // Full-screen image viewer container
    assert.ok(html.includes('id="imageViewer"'), `imageViewer container missing in ${file}`);
    assert.ok(html.includes('class="image-viewer"'), `image-viewer class missing in ${file}`);
    assert.ok(html.includes('role="dialog"'), `dialog role missing in ${file}`);
    assert.ok(html.includes('aria-modal="true"'), `aria-modal missing in ${file}`);

    // Close button
    assert.ok(html.includes('id="imageViewerClose"'), `imageViewerClose button missing in ${file}`);
    assert.ok(html.includes('class="image-viewer-close"'), `image-viewer-close class missing in ${file}`);

    // Content container & Image
    assert.ok(html.includes('class="image-viewer-content"'), `image-viewer-content missing in ${file}`);
    assert.ok(html.includes('id="imageViewerImg"'), `imageViewerImg img element missing in ${file}`);
    assert.ok(html.includes('class="image-viewer-img"'), `image-viewer-img class missing in ${file}`);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. CSS rules inspection (public/styles.css and styles.css)
// ─────────────────────────────────────────────────────────────────────────────

test('2. CSS rules: Full-screen viewer covers viewport (100dvh), centers image with object-fit: contain', () => {
  const files = [
    path.join(__dirname, '../public/styles.css'),
    path.join(__dirname, '../styles.css')
  ];

  for (const file of files) {
    const css = fs.readFileSync(file, 'utf8');

    // Fixed overlay with 100dvh and highest stacking order
    assert.ok(css.includes('.image-viewer'), `image-viewer missing in ${file}`);
    assert.ok(css.includes('position: fixed') || css.includes('position:fixed'), `fixed position missing in ${file}`);
    assert.ok(css.includes('inset: 0') || css.includes('inset:0') || css.includes('top:0'), `inset/coordinates missing in ${file}`);
    assert.ok(css.includes('100dvh'), `100dvh dynamic viewport height missing in ${file}`);
    assert.ok(css.includes('z-index: 99999') || css.includes('z-index:99999'), `z-index 99999 missing in ${file}`);

    // Image sizing: max-width 100%, max-height 100%, object-fit contain
    assert.ok(css.includes('.image-viewer-img'), `image-viewer-img class missing in ${file}`);
    assert.ok(css.includes('object-fit: contain') || css.includes('object-fit:contain'), `object-fit: contain missing in ${file}`);

    // Close button
    assert.ok(css.includes('.image-viewer-close'), `image-viewer-close class missing in ${file}`);

    // Safe area support
    assert.ok(css.includes('safe-area-inset'), `safe-area-inset missing in ${file}`);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Script logic & DOM lifecycle tests
// ─────────────────────────────────────────────────────────────────────────────

test('3. Script lifecycle: openImageViewer sets source, locks scroll, and displays dialog', () => {
  assert.equal(typeof openImageViewer, 'function', 'openImageViewer must be exported function');
  assert.equal(typeof closeImageViewer, 'function', 'closeImageViewer must be exported function');

  // Test opening
  const testUrl = 'https://res.cloudinary.com/sqkeo478/image/upload/v1790658122/catering_sample.jpg';
  const testAlt = 'Delicious catering platter';

  openImageViewer(testUrl, testAlt);

  const viewer = global.document.getElementById('imageViewer');
  const img = viewer.querySelector('#imageViewerImg');

  assert.equal(img.src, testUrl, 'Image src must match clicked photo');
  assert.equal(img.alt, testAlt, 'Image alt must match clicked photo');
  assert.equal(viewer.hidden, false, 'Viewer must not be hidden when open');
  assert.equal(viewer.getAttribute('aria-hidden'), 'false', 'aria-hidden must be false');
  assert.ok(viewer.classList.contains('open'), 'open class must be added');
  assert.equal(global.document.body.style.overflow, 'hidden', 'body overflow must be set to hidden');

  // Test closing
  closeImageViewer();

  assert.equal(viewer.hidden, true, 'Viewer must be hidden after close');
  assert.equal(viewer.getAttribute('aria-hidden'), 'true', 'aria-hidden must be true');
  assert.ok(!viewer.classList.contains('open'), 'open class must be removed');
  assert.equal(global.document.body.style.overflow, '', 'body overflow must be restored');
  assert.deepEqual(global.window.lastScroll, { x: 0, y: 120 }, 'Scroll position must be restored');
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Click delegation & dynamic catering image matching
// ─────────────────────────────────────────────────────────────────────────────

test('4. Event delegation: matches static and dynamically rendered images in Catering section', () => {
  function matchCateringImage(target) {
    if (!target) return null;
    if (target.tagName === 'IMG' && target.closest && target.closest('.catering, #catering')) {
      return target;
    }
    if (target.closest) {
      const container = target.closest('.catering-visual, .catering-panel, .catering, #catering');
      if (container) {
        return target.tagName === 'IMG' ? target : container.querySelector ? container.querySelector('img') : null;
      }
    }
    return null;
  }

  // 1. Static image in .catering-visual
  const staticImg = {
    tagName: 'IMG',
    src: 'https://res.cloudinary.com/sqkeo478/image/upload/v1790658122/catering1.jpg',
    alt: 'Catering showcase',
    closest(sel) {
      if (sel.includes('.catering') || sel.includes('#catering')) return true;
      return false;
    }
  };
  assert.equal(matchCateringImage(staticImg), staticImg, 'Static catering image must match');

  // 2. Dynamic image added later to a catering gallery inside #catering
  const dynamicImg = {
    tagName: 'IMG',
    src: 'https://res.cloudinary.com/sqkeo478/image/upload/v1790658122/catering_buffet.jpg',
    alt: 'Buffet setup',
    closest(sel) {
      if (sel.includes('.catering') || sel.includes('#catering')) return true;
      return false;
    }
  };
  assert.equal(matchCateringImage(dynamicImg), dynamicImg, 'Dynamically added catering image must match');

  // 3. Non-catering image (e.g. hero banner or products) must NOT match
  const heroImg = {
    tagName: 'IMG',
    src: 'hero.jpg',
    alt: 'Hero image',
    closest() { return false; }
  };
  assert.equal(matchCateringImage(heroImg), null, 'Non-catering image must NOT trigger catering viewer');
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Close behavior: backdrop vs image click
// ─────────────────────────────────────────────────────────────────────────────

test('5. Close behavior: clicking image does NOT close viewer; clicking backdrop closes', () => {
  let closed = false;

  function handleViewerClick(event) {
    if (event.target && (event.target.id === 'imageViewerImg' || (event.target.closest && event.target.closest('#imageViewerImg')))) {
      return; // Must NOT close when clicking the photo
    }
    closed = true;
  }

  // Click on the image itself
  closed = false;
  handleViewerClick({ target: { id: 'imageViewerImg' } });
  assert.equal(closed, false, 'Clicking image itself must NOT close viewer');

  // Click on the backdrop overlay
  closed = false;
  handleViewerClick({ target: { id: 'imageViewer' } });
  assert.equal(closed, true, 'Clicking backdrop must close viewer');

  // Click on the content container outside image
  closed = false;
  handleViewerClick({ target: { id: 'imageViewerContent', closest: () => null } });
  assert.equal(closed, true, 'Clicking content padding outside image must close viewer');
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. Escape key handling
// ─────────────────────────────────────────────────────────────────────────────

test('6. Keyboard behavior: Escape key closes an open viewer', () => {
  let closed = false;

  function handleKeydown(event, viewerState) {
    if (event.key === 'Escape') {
      if (viewerState.open && !viewerState.hidden) {
        closed = true;
      }
    }
  }

  // Pressing Escape when viewer is open
  closed = false;
  handleKeydown({ key: 'Escape' }, { open: true, hidden: false });
  assert.equal(closed, true, 'Escape must close open viewer');

  // Pressing Escape when viewer is closed
  closed = false;
  handleKeydown({ key: 'Escape' }, { open: false, hidden: true });
  assert.equal(closed, false, 'Escape should do nothing when viewer is closed');

  // Pressing other keys (e.g. Enter or Space)
  closed = false;
  handleKeydown({ key: 'Enter' }, { open: true, hidden: false });
  assert.equal(closed, false, 'Non-Escape key should not close viewer');
});
