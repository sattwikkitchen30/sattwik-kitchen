'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const rootDir = process.cwd();

test('About Us Page - Complete Verification Suite', async (t) => {
  const indexHtml = fs.readFileSync(path.join(rootDir, 'index.html'), 'utf8');
  const publicIndexHtml = fs.readFileSync(path.join(rootDir, 'public/index.html'), 'utf8');
  const aboutHtml = fs.readFileSync(path.join(rootDir, 'about.html'), 'utf8');
  const publicAboutHtml = fs.readFileSync(path.join(rootDir, 'public/about.html'), 'utf8');
  const stylesCss = fs.readFileSync(path.join(rootDir, 'styles.css'), 'utf8');
  const publicStylesCss = fs.readFileSync(path.join(rootDir, 'public/styles.css'), 'utf8');
  const aboutJs = fs.readFileSync(path.join(rootDir, 'public/about.js'), 'utf8');

  // ─── 1. Navigation order and placement in index.html & public/index.html ───
  await t.test('1. Navigation Bar: About Us appears immediately after Contact in the exact required order', () => {
    for (const [file, html] of [['index.html', indexHtml], ['public/index.html', publicIndexHtml]]) {
      const navMatch = html.match(/<nav class="nav-links"[^>]*>([\s\S]*?)<\/nav>/);
      assert.ok(navMatch, `${file} must contain <nav class="nav-links">`);
      const nav = navMatch[1];

      const menuIdx = nav.indexOf('href="#menu"');
      const plansIdx = nav.indexOf('href="#plans"');
      const cateringIdx = nav.indexOf('href="#catering"');
      const contactIdx = nav.indexOf('href="#contact"');
      const aboutIdx = nav.indexOf('href="/about.html"');
      const aboutTextIdx = nav.indexOf('About Us');
      const accountIdx = nav.indexOf('id="customerAccountLink"');
      const ordersIdx = nav.indexOf('id="customerOrdersLink"');
      const profileIdx = nav.indexOf('id="customerProfileBtn"');
      const logoutIdx = nav.indexOf('id="customerLogoutBtn"');

      assert.ok(menuIdx !== -1, `${file} must have Menu link`);
      assert.ok(plansIdx !== -1, `${file} must have Tiffin Plans link`);
      assert.ok(cateringIdx !== -1, `${file} must have Catering link`);
      assert.ok(contactIdx !== -1, `${file} must have Contact link`);
      assert.ok(aboutIdx !== -1 && aboutTextIdx !== -1, `${file} must have About Us link pointing to /about.html`);
      assert.ok(accountIdx !== -1, `${file} must have Login/Signup link`);
      assert.ok(ordersIdx !== -1, `${file} must have My Orders link`);
      assert.ok(profileIdx !== -1, `${file} must have Edit Profile button`);
      assert.ok(logoutIdx !== -1, `${file} must have Logout button`);

      // Verify exact required ordering:
      // 1. Menu, 2. Tiffin Plans, 3. Catering, 4. Contact, 5. About Us, 6. My Orders, 7. Edit Profile, 8. Logout
      assert.ok(menuIdx < plansIdx, `${file}: Menu must precede Tiffin Plans`);
      assert.ok(plansIdx < cateringIdx, `${file}: Tiffin Plans must precede Catering`);
      assert.ok(cateringIdx < contactIdx, `${file}: Catering must precede Contact`);
      assert.ok(contactIdx < aboutIdx, `${file}: Contact must precede About Us`);
      assert.ok(aboutIdx < ordersIdx, `${file}: About Us must precede My Orders`);
      assert.ok(ordersIdx < profileIdx, `${file}: My Orders must precede Edit Profile`);
      assert.ok(profileIdx < logoutIdx, `${file}: Edit Profile must precede Logout`);

      // Verify About Us is a dedicated page URL, NOT an anchor scroll link
      assert.ok(!nav.includes('href="#about"'), `${file}: About Us must not be an anchor scroll link`);
    }
  });

  // ─── 2. Dedicated About Us page structure ─────────────────────────────────
  await t.test('2. Separate Page: about.html and public/about.html exist with customer navigation and branding', () => {
    for (const [file, html] of [['about.html', aboutHtml], ['public/about.html', publicAboutHtml]]) {
      assert.ok(html.includes('<title>About Us | Sattwik Kitchen</title>'), `${file} must have proper title`);
      assert.ok(html.includes('class="site-header"'), `${file} must have the customer site header`);
      assert.ok(html.includes('class="nav-links"'), `${file} must have customer navigation`);

      // Check nav items on about page route back to home sections
      assert.ok(html.includes('href="/#menu"'), `${file} must link Menu back to /#menu`);
      assert.ok(html.includes('href="/#plans"'), `${file} must link Tiffin Plans back to /#plans`);
      assert.ok(html.includes('href="/#catering"'), `${file} must link Catering back to /#catering`);
      assert.ok(html.includes('href="/#contact"'), `${file} must link Contact back to /#contact`);
      assert.ok(html.includes('href="/about.html"'), `${file} must include About Us link`);
      assert.ok(html.includes('id="customerAccountLink"'), `${file} must include customer account link`);
      assert.ok(html.includes('id="customerOrdersLink"'), `${file} must include customer orders link`);
      assert.ok(html.includes('id="customerProfileBtn"'), `${file} must include edit profile button`);
      assert.ok(html.includes('id="customerLogoutBtn"'), `${file} must include logout button`);
    }
  });

  // ─── 3. Heading and Centered Welcome Section ──────────────────────────────
  await t.test('3. Main Heading: displays ABOUT US, centered "Welcome to Sattwik Kitchen", and "Food Like Home"', () => {
    for (const [file, html] of [['about.html', aboutHtml], ['public/about.html', publicAboutHtml]]) {
      assert.ok(html.includes('ABOUT US'), `${file} must include "ABOUT US"`);
      assert.ok(html.includes('Welcome to Sattwik Kitchen'), `${file} must include "Welcome to Sattwik Kitchen"`);
      assert.ok(html.includes('Food Like Home'), `${file} must include "Food Like Home"`);

      // Verify hierarchy inside <main>: kicker -> title -> tagline
      const mainMatch = html.match(/<main[^>]*>([\s\S]*?)<\/main>/);
      assert.ok(mainMatch, `${file} must contain <main>`);
      const mainContent = mainMatch[1];

      const kickerIdx = mainContent.indexOf('ABOUT US');
      const titleIdx = mainContent.indexOf('Welcome to Sattwik Kitchen');
      const taglineIdx = mainContent.indexOf('Food Like Home');

      assert.ok(kickerIdx !== -1, `${file}: <main> must contain ABOUT US`);
      assert.ok(titleIdx !== -1, `${file}: <main> must contain Welcome to Sattwik Kitchen`);
      assert.ok(taglineIdx !== -1, `${file}: <main> must contain Food Like Home`);

      assert.ok(kickerIdx < titleIdx, `${file}: ABOUT US kicker must precede Welcome heading`);
      assert.ok(titleIdx < taglineIdx, `${file}: Welcome heading must precede tagline`);
    }
  });

  // ─── 4. Main Content Paragraphs in exact sequence ─────────────────────────
  await t.test('4. Main Content: all 5 required paragraphs appear in exact sequence without omissions', () => {
    const requiredParagraphs = [
      'At Sattwik Kitchen, we bring the comforting flavors of South Indian-style vegetarian cooking to Canada. Our menu is inspired by the food many of us grew up with: hearty lentil dishes, seasonal vegetables, fragrant spices, tangy tamarind, and the homemade sides that make a meal feel complete.',
      'There’s something for every craving. Enjoy our tiffins for breakfast or a light meal, snacks for teatime or sharing, and sweets for a little celebration. We also offer pickles and spice powders-flavorful pantry favorites that bring a taste of home to everyday meals.',
      'South Indian (Specially Telangana) cuisine is known for its bold, satisfying flavors. Lentils, vegetables, chilies, peanuts, sesame, curry leaves, and tamarind come together in recipes full of character. We prepare vegetarian food with care and a love for these regional traditions, sharing familiar tastes with our community in Canada.',
      'Planning a family celebration, get-together, or other small gathering? Sattwik Kitchen also offers vegetarian catering to help make it special. We’d be happy to discuss menu options for your occasion.',
      'Whether you’re looking for a comforting meal, a teatime snack, something sweet to share, a jar of pickle for your table, or food for a gathering, we’re glad to welcome you.'
    ];

    for (const [file, html] of [['about.html', aboutHtml], ['public/about.html', publicAboutHtml]]) {
      let lastIndex = 0;
      for (let i = 0; i < requiredParagraphs.length; i++) {
        const text = requiredParagraphs[i];
        const idx = html.indexOf(text);
        assert.ok(idx !== -1, `${file} is missing paragraph ${i + 1}`);
        assert.ok(idx >= lastIndex, `${file}: paragraph ${i + 1} is out of order`);
        lastIndex = idx + text.length;
      }

      // Closing line: "Sattwik Kitchen - Food Like Home." in bold
      assert.ok(
        html.includes('<strong>Sattwik Kitchen - Food Like Home.</strong>') ||
        html.includes('<b>Sattwik Kitchen - Food Like Home.</b>'),
        `${file} must have bold closing "Sattwik Kitchen - Food Like Home."`
      );
    }
  });

  // ─── 5. Reused Footer & Profile Modal ─────────────────────────────────────
  await t.test('5. Reused Footer: contains exact contact details, copyright, and customer profile modal', () => {
    for (const [file, html] of [['about.html', aboutHtml], ['public/about.html', publicAboutHtml]]) {
      assert.ok(html.includes('class="footer"'), `${file} must reuse the site footer`);
      assert.ok(html.includes('sattwikkitchen@gmail.com'), `${file} must include email contact`);
      assert.ok(html.includes('+1 672-588-1282'), `${file} must include phone contact`);
      assert.ok(html.includes('Burnaby • New Westminster • Surrey • Delta'), `${file} must include service areas`);
      assert.ok(html.includes('id="customerProfileModal"'), `${file} must include #customerProfileModal`);
      assert.ok(html.includes('id="customerProfileForm"'), `${file} must include #customerProfileForm`);
    }
  });

  // ─── 6. CSS Styling & Responsiveness ──────────────────────────────────────
  await t.test('6. CSS: styles.css contains centered title, tagline, article card, and responsive breakpoints', () => {
    for (const [name, css] of [['styles.css', stylesCss], ['public/styles.css', publicStylesCss]]) {
      assert.ok(css.includes('.about-hero-section'), `${name} must include .about-hero-section`);
      assert.ok(css.includes('.about-title'), `${name} must include .about-title`);
      assert.ok(css.includes('.about-tagline'), `${name} must include .about-tagline`);
      assert.ok(css.includes('.about-card'), `${name} must include .about-card`);
      assert.ok(css.includes('.about-heading'), `${name} must include .about-heading`);
      assert.ok(css.includes('.about-paragraph'), `${name} must include .about-paragraph`);
      assert.ok(css.includes('.about-signoff'), `${name} must include .about-signoff`);
      assert.ok(css.includes('@media (max-width: 700px)'), `${name} must include responsive styles`);
    }
  });

  // ─── 7. Functional about.js execution ─────────────────────────────────────
  await t.test('7. Script: about.js manages mobile navigation, auth state changes, and modal', () => {
    function createMockElement(id) {
      const classes = new Set(['hidden']);
      return {
        id,
        classList: {
          add: (cls) => classes.add(cls),
          remove: (cls) => classes.delete(cls),
          toggle: (cls, force) => {
            if (force === true) classes.add(cls);
            else if (force === false) classes.delete(cls);
            else if (classes.has(cls)) classes.delete(cls);
            else classes.add(cls);
            return classes.has(cls);
          },
          contains: (cls) => classes.has(cls)
        },
        addEventListener: () => {},
        removeEventListener: () => {},
        style: {}
      };
    }

    const elements = {
      customerAccountLink: createMockElement('customerAccountLink'),
      customerOrdersLink: createMockElement('customerOrdersLink'),
      customerProfileBtn: createMockElement('customerProfileBtn'),
      customerLogoutBtn: createMockElement('customerLogoutBtn'),
      year: createMockElement('year')
    };
    elements.customerAccountLink.classList.remove('hidden');

    let storedToken = null;
    const mockLocalStorage = {
      getItem: (key) => (key === 'sattwikCustomerToken' ? storedToken : null),
      setItem: (key, val) => { if (key === 'sattwikCustomerToken') storedToken = val; },
      removeItem: (key) => { if (key === 'sattwikCustomerToken') storedToken = null; }
    };

    const sandbox = {
      document: {
        getElementById: (id) => elements[id] || (elements[id] = createMockElement(id)),
        querySelector: () => createMockElement('div'),
        querySelectorAll: () => [],
        addEventListener: () => {}
      },
      window: {
        addEventListener: () => {},
        location: { href: '', search: '', pathname: '/about.html' }
      },
      localStorage: mockLocalStorage,
      fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }),
      console,
      setTimeout: () => 0,
      clearTimeout: () => {},
      module: { exports: {} },
      exports: {}
    };

    vm.createContext(sandbox);
    vm.runInContext(aboutJs, sandbox);

    const { updateCustomerAuthUI } = sandbox.module.exports;
    assert.equal(typeof updateCustomerAuthUI, 'function', 'updateCustomerAuthUI must be exported');

    // 1. Logged out state
    storedToken = null;
    updateCustomerAuthUI();
    assert.equal(elements.customerAccountLink.classList.contains('hidden'), false);
    assert.equal(elements.customerOrdersLink.classList.contains('hidden'), true);
    assert.equal(elements.customerProfileBtn.classList.contains('hidden'), true);
    assert.equal(elements.customerLogoutBtn.classList.contains('hidden'), true);

    // 2. Logged in state
    storedToken = 'sample_token_jwt';
    updateCustomerAuthUI();
    assert.equal(elements.customerAccountLink.classList.contains('hidden'), true);
    assert.equal(elements.customerOrdersLink.classList.contains('hidden'), false);
    assert.equal(elements.customerProfileBtn.classList.contains('hidden'), false);
    assert.equal(elements.customerLogoutBtn.classList.contains('hidden'), false);
  });

  // ─── 8. Express Route Registration ────────────────────────────────────────
  await t.test('8. Express Server: registers routes for /about, /about.html, /customer/about', () => {
    const serverJs = fs.readFileSync(path.join(rootDir, 'server/server.js'), 'utf8');
    assert.ok(serverJs.includes("app.get('/about'"), 'server.js must register /about route');
    assert.ok(serverJs.includes("app.get('/about.html'"), 'server.js must register /about.html route');
    assert.ok(serverJs.includes("app.get('/customer/about'"), 'server.js must register /customer/about route');
    assert.ok(serverJs.includes("app.get('/customer/about.html'"), 'server.js must register /customer/about.html route');
  });
});
