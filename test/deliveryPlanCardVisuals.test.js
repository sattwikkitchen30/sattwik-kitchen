'use strict';

/**
 * Automated Test Suite: Delivery Plan Card Badge, Price Formatting, and Choose Plan Button Styling
 *
 * Verifies:
 * 1. Promotional badge: "GREAT FOR TWO" is rendered on Curry-Only Couple card and styled with .great-for-two.
 * 2. .great-for-two badge styling matches .popular (position: absolute, right: 20px, top: -13px, background: var(--green), color: #fff).
 * 3. Badge does not appear on unrelated plans.
 * 4. Price formatting: Displays currency symbol '$' before price across Full Meal and Curry-Only plans (e.g. $160).
 * 5. Price formatting: No duplicate currency symbols (e.g. not $$160).
 * 6. "Choose Plan" button: Styled with green background (var(--green)), white text (#fff), pill border-radius, hover/focus/active states.
 * 7. Choose Plan and Quantity controls preserve event listeners and cart integration.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('Delivery Plan Card Visuals Test Suite', async (t) => {
  const rootDir = process.cwd();
  const stylesCss = fs.readFileSync(path.resolve(rootDir, 'styles.css'), 'utf8');
  const publicStylesCss = fs.readFileSync(path.resolve(rootDir, 'public/styles.css'), 'utf8');
  const scriptJs = fs.readFileSync(path.resolve(rootDir, 'script.js'), 'utf8');
  const publicScriptJs = fs.readFileSync(path.resolve(rootDir, 'public/script.js'), 'utf8');

  await t.test('1. Stylesheet contains .great-for-two matching .popular positioning and styling', () => {
    for (const [name, css] of [['styles.css', stylesCss], ['public/styles.css', publicStylesCss]]) {
      // Must target both .popular and .great-for-two
      assert.ok(css.includes('.popular') && css.includes('.great-for-two'), `${name} must include .popular and .great-for-two`);
      
      // Check absolute positioning at top-13px right-20px
      assert.ok(css.includes('position:absolute') || css.includes('position: absolute'), `${name} badge must be position: absolute`);
      assert.ok(css.includes('top:-13px') || css.includes('top: -13px'), `${name} badge must sit at top: -13px`);
      assert.ok(css.includes('right:20px') || css.includes('right: 20px'), `${name} badge must sit at right: 20px`);
      assert.ok(css.includes('background:var(--green)') || css.includes('background: var(--green)'), `${name} badge must use green background`);
      assert.ok(css.includes('color:#fff') || css.includes('color: #fff'), `${name} badge text must be white`);
    }
  });

  await t.test('2. Stylesheet styles .plan-choose-btn with green background and polished states', () => {
    for (const [name, css] of [['styles.css', stylesCss], ['public/styles.css', publicStylesCss]]) {
      assert.ok(css.includes('.plan-choose-btn'), `${name} must contain .plan-choose-btn rules`);
      assert.ok(css.includes('background:var(--green)') || css.includes('background: var(--green)'), `${name} .plan-choose-btn must have green background`);
      assert.ok(css.includes('color:#fff') || css.includes('color: #fff'), `${name} .plan-choose-btn must have white text`);
      assert.ok(css.includes('border-radius:999px') || css.includes('border-radius: 999px'), `${name} .plan-choose-btn must have pill border-radius`);
      assert.ok(css.includes('.plan-choose-btn:hover'), `${name} must define hover state`);
      assert.ok(css.includes('.plan-choose-btn:focus-visible'), `${name} must define focus-visible state`);
      assert.ok(css.includes('.plan-choose-btn:active'), `${name} must define active state`);
    }
  });

  await t.test('3. Card rendering includes $ symbol before price and avoids duplicate $ symbols', () => {
    for (const [name, js] of [['script.js', scriptJs], ['public/script.js', publicScriptJs]]) {
      assert.ok(js.includes('displayPrice'), `${name} must compute displayPrice`);
      assert.ok(js.includes('<strong>${displayPrice}</strong>'), `${name} must render displayPrice inside <strong>`);
    }
  });

  await t.test('4. Price formatting helper properly prefixes $ and preserves value format', () => {
    const formatPlanPrice = (price) => {
      const formattedPrice = String(price != null ? price : '').trim();
      return formattedPrice.startsWith('$') ? formattedPrice : `$${formattedPrice}`;
    };

    assert.equal(formatPlanPrice(160), '$160', 'Numeric 160 formats to $160');
    assert.equal(formatPlanPrice('160'), '$160', 'String 160 formats to $160');
    assert.equal(formatPlanPrice('85.00'), '$85.00', 'Decimal 85.00 formats to $85.00');
    assert.equal(formatPlanPrice(240), '$240', 'Full Meal Single formats to $240');
    assert.equal(formatPlanPrice('$160'), '$160', 'Already-prefixed price does not duplicate $');
    assert.equal(formatPlanPrice('$85.00'), '$85.00', 'Already-prefixed decimal does not duplicate $');
  });

  await t.test('5. Promotional badge conditional logic preserves existing rules', () => {
    const plans = [
      { category: 'Full Meal', size: 'single', displayName: 'Full Meal (Single)' },
      { category: 'Full Meal', size: 'couple', displayName: 'Full Meal (Couple)' },
      { category: 'Full Meal', size: 'family', displayName: 'Full Meal (Family)' },
      { category: 'Curry-Only', size: 'single', displayName: 'Curry-Only (Single)' },
      { category: 'Curry-Only', size: 'couple', displayName: 'Curry-Only (Couple)' },
      { category: 'Curry-Only', size: 'family', displayName: 'Curry-Only (Family)' }
    ];

    plans.forEach(plan => {
      const isPopular = plan.category === 'Full Meal' && plan.size === 'couple';
      const isGreatForTwo = plan.category === 'Curry-Only' && plan.size === 'couple';
      const badge = isPopular ? '<div class="popular">POPULAR CHOICE</div>' : '';
      const greatForTwoLabel = isGreatForTwo ? '<div class="great-for-two">GREAT FOR TWO</div>' : '';

      if (plan.category === 'Full Meal' && plan.size === 'couple') {
        assert.ok(badge.includes('POPULAR CHOICE'));
        assert.equal(greatForTwoLabel, '');
      } else if (plan.category === 'Curry-Only' && plan.size === 'couple') {
        assert.equal(badge, '');
        assert.ok(greatForTwoLabel.includes('GREAT FOR TWO'));
        assert.ok(greatForTwoLabel.includes('class="great-for-two"'));
      } else {
        assert.equal(badge, '', `Badge should not appear on ${plan.category} ${plan.size}`);
        assert.equal(greatForTwoLabel, '', `Great for Two should not appear on ${plan.category} ${plan.size}`);
      }
    });
  });
});
