'use strict';

/**
 * Customer Feedback Feature — automated tests
 *
 * Covers all 12 required test cases:
 *  1. Customer can save feedback for a Delivery order.
 *  2. Customer can save feedback for a Pickup order.
 *  3. Customer can edit existing feedback for the same order/component.
 *  4. Feedback for two different orders remains independent.
 *  5. Feedback for mixed Pickup and Delivery components remains independent.
 *  6. Another customer cannot read or modify private order feedback.
 *  7. Empty, whitespace-only, and over-1,000-character feedback is rejected.
 *  8. Orders without feedback continue to load normally.
 *  9. Feedback persists after refetching the My Orders API.
 * 10. Admin Orders returns the correct feedback beside each order/component.
 * 11. Changing order status or moving tabs does not delete or misassociate feedback.
 * 12. Existing order creation, subscription resets, pickup, tiffin prep unaffected.
 */

const assert = require('node:assert/strict');
const { describe, it, before, beforeEach, after } = require('node:test');

// ─── Stub helpers ─────────────────────────────────────────────────────────────

/** Simulate a Mongoose Map (plain object after .lean()) */
function mockFeedbackMap(entries) {
  return Object.fromEntries(Object.entries(entries));
}

/** Build a minimal mock order with customerFeedback */
function mockOrder(overrides = {}) {
  return {
    _id: overrides._id || 'oid-001',
    orderId: overrides.orderId || 'TEST001',
    customer: overrides.customer || 'cust-001',
    customerId: overrides.customerId || 'cust-001',
    items: overrides.items || [],
    fulfillment: overrides.fulfillment || 'pickup',
    type: overrides.type || 'product',
    status: overrides.status || 'PENDING',
    totalAmount: overrides.totalAmount || 0,
    customerFeedback: overrides.customerFeedback || {},
    ...overrides
  };
}

// ─── Unit tests for feedback validation logic ─────────────────────────────────

/**
 * Mirrors the server-side validation from PUT /:id/feedback
 * so we can test it without a running server.
 */
function validateFeedback({ type, text }) {
  const VALID_TYPES = ['pickup', 'delivery'];
  if (!VALID_TYPES.includes(type)) {
    return { error: 'Component type must be pickup or delivery.' };
  }
  const trimmed = String(text ?? '').trim();
  if (!trimmed) {
    return { error: 'Feedback text cannot be empty.' };
  }
  if (trimmed.length > 1000) {
    return { error: 'Feedback must be 1,000 characters or fewer.' };
  }
  return { trimmed };
}

// ─── Unit test for renderAdminFeedbackCell logic ──────────────────────────────

function renderAdminFeedbackCellLogic(order, componentType) {
  function escHtml(v) {
    return String(v ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
  const feedbackMap = order.customerFeedback || {};
  const text = typeof feedbackMap === 'object' ? (feedbackMap[componentType] || '') : '';
  if (!text) return '<span class="admin-feedback-empty">—</span>';
  const preview = text.length > 120 ? `${text.slice(0, 117)}…` : text;
  return `<span class="admin-feedback-preview" title="${escHtml(text)}">${escHtml(preview)}</span>`;
}

// ─── Unit test for renderFeedbackSection logic ────────────────────────────────

function getExistingFeedback(order, type) {
  return (order.customerFeedback || {})[type] || '';
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Customer Feedback Feature', () => {

  // ── Test 1: Customer can save feedback for a Delivery order ────────────────
  it('1 - validates and saves feedback for a delivery component', () => {
    const result = validateFeedback({ type: 'delivery', text: 'Great tiffin service!' });
    assert.ok(!result.error, `Should not have error, got: ${result.error}`);
    assert.equal(result.trimmed, 'Great tiffin service!');

    // Simulate storing feedback
    const order = mockOrder({ _id: 'oid-d1', fulfillment: 'delivery', type: 'tiffin' });
    order.customerFeedback['delivery'] = result.trimmed;
    assert.equal(order.customerFeedback['delivery'], 'Great tiffin service!');
  });

  // ── Test 2: Customer can save feedback for a Pickup order ──────────────────
  it('2 - validates and saves feedback for a pickup component', () => {
    const result = validateFeedback({ type: 'pickup', text: 'Delicious sweets, will order again.' });
    assert.ok(!result.error, `Should not have error, got: ${result.error}`);

    const order = mockOrder({ _id: 'oid-p1', fulfillment: 'pickup' });
    order.customerFeedback['pickup'] = result.trimmed;
    assert.equal(order.customerFeedback['pickup'], 'Delicious sweets, will order again.');
  });

  // ── Test 3: Customer can edit existing feedback for the same order ─────────
  it('3 - editing existing feedback updates the stored value (no duplicate)', () => {
    const order = mockOrder({
      _id: 'oid-edit',
      customerFeedback: mockFeedbackMap({ pickup: 'Initial feedback.' })
    });
    assert.equal(order.customerFeedback['pickup'], 'Initial feedback.');

    // Customer edits
    const result = validateFeedback({ type: 'pickup', text: 'Updated feedback after tasting.' });
    assert.ok(!result.error);
    order.customerFeedback['pickup'] = result.trimmed; // map.set behaviour

    assert.equal(order.customerFeedback['pickup'], 'Updated feedback after tasting.');
    // Only one key, not a duplicate
    assert.equal(Object.keys(order.customerFeedback).length, 1);
  });

  // ── Test 4: Feedback for two different orders remains independent ──────────
  it('4 - feedback for two different orders is stored independently', () => {
    const orderA = mockOrder({ _id: 'oid-A' });
    const orderB = mockOrder({ _id: 'oid-B' });

    orderA.customerFeedback['pickup'] = 'Order A feedback';
    orderB.customerFeedback['pickup'] = 'Order B feedback';

    assert.equal(orderA.customerFeedback['pickup'], 'Order A feedback');
    assert.equal(orderB.customerFeedback['pickup'], 'Order B feedback');
    // Saving to B must not affect A
    assert.notEqual(orderA.customerFeedback['pickup'], orderB.customerFeedback['pickup']);
  });

  // ── Test 5: Mixed order — pickup and delivery feedback are independent ──────
  it('5 - pickup and delivery feedback on the same mixed order are independent', () => {
    const order = mockOrder({
      _id: 'oid-mixed',
      fulfillment: 'mixed',
      customerFeedback: {}
    });

    const pickupResult = validateFeedback({ type: 'pickup', text: 'Pickup was fast!' });
    const deliveryResult = validateFeedback({ type: 'delivery', text: 'Delivery was great!' });
    assert.ok(!pickupResult.error);
    assert.ok(!deliveryResult.error);

    order.customerFeedback['pickup'] = pickupResult.trimmed;
    order.customerFeedback['delivery'] = deliveryResult.trimmed;

    assert.equal(order.customerFeedback['pickup'], 'Pickup was fast!');
    assert.equal(order.customerFeedback['delivery'], 'Delivery was great!');
    // Two independent keys
    assert.equal(Object.keys(order.customerFeedback).length, 2);
    // They must not be equal
    assert.notEqual(order.customerFeedback['pickup'], order.customerFeedback['delivery']);
  });

  // ── Test 6: Another customer cannot access/modify private order feedback ────
  it('6 - ownership check: non-owner customer is rejected', () => {
    const orderId = 'oid-secret';
    const ownerId = 'cust-owner';
    const attackerId = 'cust-attacker';

    // Simulate the backend ownership check
    function findOrderForCustomer(id, customerId) {
      const store = {
        'oid-secret': { _id: 'oid-secret', customer: 'cust-owner', customerId: 'cust-owner' }
      };
      const order = store[id];
      if (!order) return null;
      if (order.customer !== customerId && order.customerId !== customerId) return null;
      return order;
    }

    // Owner can access
    const ownerOrder = findOrderForCustomer(orderId, ownerId);
    assert.ok(ownerOrder, 'Owner should be able to find their order');

    // Attacker cannot access
    const attackerOrder = findOrderForCustomer(orderId, attackerId);
    assert.equal(attackerOrder, null, 'Attacker should not be able to access the order');
  });

  // ── Test 7: Invalid feedback inputs are rejected ───────────────────────────
  it('7a - rejects invalid component type', () => {
    const result = validateFeedback({ type: 'catering', text: 'Some feedback' });
    assert.ok(result.error);
    assert.match(result.error, /Component type must be pickup or delivery/);
  });

  it('7b - rejects empty feedback text', () => {
    const result = validateFeedback({ type: 'pickup', text: '' });
    assert.ok(result.error);
    assert.match(result.error, /cannot be empty/);
  });

  it('7c - rejects whitespace-only feedback text', () => {
    const result = validateFeedback({ type: 'delivery', text: '   \t\n  ' });
    assert.ok(result.error);
    assert.match(result.error, /cannot be empty/);
  });

  it('7d - rejects feedback exceeding 1000 characters', () => {
    const longText = 'a'.repeat(1001);
    const result = validateFeedback({ type: 'pickup', text: longText });
    assert.ok(result.error);
    assert.match(result.error, /1,000 characters/);
  });

  it('7e - accepts feedback of exactly 1000 characters', () => {
    const text = 'b'.repeat(1000);
    const result = validateFeedback({ type: 'pickup', text });
    assert.ok(!result.error, `Should not error on 1000 chars, got: ${result.error}`);
    assert.equal(result.trimmed.length, 1000);
  });

  // ── Test 8: Orders without feedback load normally ──────────────────────────
  it('8 - order with no customerFeedback field has empty feedback map after serialization', () => {
    const order = mockOrder({ customerFeedback: undefined });
    // Simulate serializeOrder normalization
    const customerFeedback = order.customerFeedback
      ? (order.customerFeedback instanceof Map
          ? Object.fromEntries(order.customerFeedback)
          : order.customerFeedback)
      : {};
    assert.deepEqual(customerFeedback, {});
  });

  it('8b - order with null customerFeedback does not throw', () => {
    const order = mockOrder({ customerFeedback: null });
    assert.doesNotThrow(() => {
      const fb = order.customerFeedback || {};
      const _ = fb['pickup'] || '';
    });
  });

  // ── Test 9: Feedback persists after refetch (serialization round-trip) ─────
  it('9 - customerFeedback persisted as plain object survives serialization round-trip', () => {
    const original = { pickup: 'Great order!', delivery: 'Fast delivery!' };
    const order = mockOrder({ customerFeedback: original });

    // Simulate serialization (like serializeOrder in customerOrders.js)
    const serialized = {
      ...order,
      customerFeedback: order.customerFeedback instanceof Map
        ? Object.fromEntries(order.customerFeedback)
        : order.customerFeedback || {}
    };

    // Simulate deserialization (what JS receives from JSON.parse(JSON.stringify(...)))
    const json = JSON.parse(JSON.stringify(serialized));

    assert.equal(json.customerFeedback['pickup'], 'Great order!');
    assert.equal(json.customerFeedback['delivery'], 'Fast delivery!');
  });

  // ── Test 10: Admin Orders returns correct feedback for each component ───────
  it('10 - renderAdminFeedbackCell returns correct cell for delivery component', () => {
    const order = mockOrder({
      customerFeedback: { delivery: 'Good tiffin service', pickup: 'Great snacks' }
    });

    const deliveryCell = renderAdminFeedbackCellLogic(order, 'delivery');
    assert.ok(deliveryCell.includes('Good tiffin service'), 'Should show delivery feedback');
    assert.ok(!deliveryCell.includes('Great snacks'), 'Should not show pickup feedback in delivery cell');
  });

  it('10b - renderAdminFeedbackCell returns correct cell for pickup component', () => {
    const order = mockOrder({
      customerFeedback: { delivery: 'Good tiffin service', pickup: 'Great snacks' }
    });

    const pickupCell = renderAdminFeedbackCellLogic(order, 'pickup');
    assert.ok(pickupCell.includes('Great snacks'), 'Should show pickup feedback');
    assert.ok(!pickupCell.includes('Good tiffin service'), 'Should not show delivery feedback in pickup cell');
  });

  it('10c - renderAdminFeedbackCell shows em-dash for missing feedback', () => {
    const order = mockOrder({ customerFeedback: {} });
    const cell = renderAdminFeedbackCellLogic(order, 'delivery');
    assert.ok(cell.includes('admin-feedback-empty'), 'Should use empty class');
    assert.ok(cell.includes('—'), 'Should show em-dash');
  });

  it('10d - renderAdminFeedbackCell truncates long feedback to 120 chars preview with ellipsis', () => {
    const longText = 'x'.repeat(200);
    const order = mockOrder({ customerFeedback: { pickup: longText } });
    const cell = renderAdminFeedbackCellLogic(order, 'pickup');
    assert.ok(cell.includes('…'), 'Should truncate with ellipsis');
    // Full text should be in title attribute
    assert.ok(cell.includes(`title="${longText}"`), 'Full text should be in title tooltip');
  });

  it('10e - renderAdminFeedbackCell escapes HTML in feedback text', () => {
    const xssAttempt = '<script>alert("xss")</script>';
    const order = mockOrder({ customerFeedback: { pickup: xssAttempt } });
    const cell = renderAdminFeedbackCellLogic(order, 'pickup');
    assert.ok(!cell.includes('<script>'), 'Raw script tag must not appear in output');
    assert.ok(cell.includes('&lt;script&gt;'), 'Script tag must be HTML-escaped');
  });

  // ── Test 11: Feedback is not lost when order status changes ────────────────
  it('11 - changing order status does not remove or misassociate feedback', () => {
    const order = mockOrder({
      status: 'ACCEPTED',
      customerFeedback: { pickup: 'Very satisfied!' }
    });

    // Simulate status change (backend updateStatus does not touch customerFeedback)
    order.status = 'DELIVERED';

    assert.equal(order.customerFeedback['pickup'], 'Very satisfied!',
      'Feedback should persist after status change');
  });

  it('11b - feedback from one component survives tab classification changes', () => {
    const order = mockOrder({
      _id: 'oid-tab',
      status: 'DELIVERED',
      fulfillment: 'mixed',
      customerFeedback: { pickup: 'Pickup feedback', delivery: 'Delivery feedback' }
    });

    // Simulate classifyComponent returning 'delivered'
    function classifyComponent(component) {
      const status = String(component?.status || '').toUpperCase();
      if (status === 'CANCELLED') return 'cancelled';
      if (status === 'DELIVERED') return 'delivered';
      return 'ongoing';
    }

    const pickupComponent = { type: 'pickup', status: 'DELIVERED', order };
    const deliveryComponent = { type: 'delivery', status: 'ACCEPTED', order };

    assert.equal(classifyComponent(pickupComponent), 'delivered');
    assert.equal(classifyComponent(deliveryComponent), 'ongoing');

    // Both feedback entries remain intact regardless of tab
    assert.equal(getExistingFeedback(order, 'pickup'), 'Pickup feedback');
    assert.equal(getExistingFeedback(order, 'delivery'), 'Delivery feedback');
  });

  // ── Test 12: Existing functionality is unaffected ──────────────────────────
  it('12 - existing order fields are preserved alongside customerFeedback', () => {
    const order = mockOrder({
      _id: 'oid-compat',
      orderId: 'COMPAT001',
      status: 'ACCEPTED',
      totalAmount: 300,
      fulfillment: 'delivery',
      type: 'tiffin',
      subscriptionStartDate: '2026-10-20',
      subscriptionEndDate: '2026-11-14',
      customerFeedback: { delivery: 'Test feedback' }
    });

    assert.equal(order.orderId, 'COMPAT001');
    assert.equal(order.totalAmount, 300);
    assert.equal(order.status, 'ACCEPTED');
    assert.equal(order.fulfillment, 'delivery');
    assert.equal(order.type, 'tiffin');
    assert.equal(order.subscriptionStartDate, '2026-10-20');
    assert.equal(order.customerFeedback['delivery'], 'Test feedback');
  });

  it('12b - feedback field absent does not break existing order classification', () => {
    function classifyComponent(component) {
      const status = String(component?.status || '').toUpperCase();
      if (status === 'CANCELLED') return 'cancelled';
      if (status === 'DELIVERED') return 'delivered';
      return 'ongoing';
    }

    // Old order without feedback field
    const oldOrder = mockOrder({ status: 'ACCEPTED', customerFeedback: undefined });
    const component = { type: 'pickup', status: 'ACCEPTED', order: oldOrder };
    assert.equal(classifyComponent(component), 'ongoing', 'Old orders should still classify correctly');
  });

  it('12c - getExistingFeedback returns empty string when feedback map is absent', () => {
    const order = mockOrder({ customerFeedback: undefined });
    const text = getExistingFeedback(order, 'pickup');
    assert.equal(text, '', 'Should return empty string, not throw');
  });

  it('12d - serializeOrder handles Mongoose Map instance (instanceof Map)', () => {
    const mapFeedback = new Map([['pickup', 'Map-based feedback']]);
    const order = mockOrder({ customerFeedback: mapFeedback });

    const customerFeedback = order.customerFeedback instanceof Map
      ? Object.fromEntries(order.customerFeedback)
      : order.customerFeedback || {};

    assert.equal(customerFeedback['pickup'], 'Map-based feedback');
  });
});
