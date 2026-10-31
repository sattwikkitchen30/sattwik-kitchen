'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const mongoose = require('mongoose');

const Order = require('../server/models/Order');
const DeliveryMember = require('../server/models/DeliveryMember');
const deliveryOrdersRouter = require('../server/routes/deliveryOrders');
const { signDeliveryToken } = require('../server/middleware/deliveryAuth');

function mockReqRes({ method = 'GET', body = {}, params = {}, headers = {} } = {}) {
  const req = {
    method,
    body,
    params,
    headers: { ...headers },
    app: {
      get: (key) => (key === 'io' ? { to: () => ({ emit: () => {} }) } : null)
    }
  };

  const res = {
    statusCode: 200,
    headersSent: false,
    _json: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this._json = data;
      this.headersSent = true;
      return this;
    }
  };

  return { req, res };
}

test('Delivery Member Notify Feature - Comprehensive Test Suite', async (t) => {
  // ─── 1. Static Frontend Verification ──────────────────────────────────────
  await t.test('1. Delivery Member UI contains Notify button and WhatsApp click-to-chat logic', () => {
    const deliveryJs = fs.readFileSync(path.join(__dirname, '../delivery/delivery.js'), 'utf8');
    assert.ok(deliveryJs.includes('notify-button'), 'delivery.js must include notify-button class');
    assert.ok(deliveryJs.includes('data-notify-order'), 'delivery.js must include data-notify-order attribute');
    assert.ok(deliveryJs.includes('formatWhatsAppPhone'), 'delivery.js must include formatWhatsAppPhone helper');
    assert.ok(deliveryJs.includes('buildDeliveryNotifyMessage'), 'delivery.js must include buildDeliveryNotifyMessage');
    assert.ok(deliveryJs.includes('https://wa.me/'), 'delivery.js must generate https://wa.me/ click-to-chat links');
    assert.ok(deliveryJs.includes('/delivery-orders/'), 'delivery.js must log notification to server');

    const deliveryCss = fs.readFileSync(path.join(__dirname, '../delivery/delivery.css'), 'utf8');
    assert.ok(deliveryCss.includes('.notify-button'), 'delivery.css must style .notify-button');
    assert.ok(deliveryCss.includes('.notified-badge'), 'delivery.css must style .notified-badge');
  });

  // ─── 2. Scope Isolation Verification ──────────────────────────────────────
  await t.test('2. Notify button is strictly isolated to Delivery Member (absent from Admin and Customer interfaces)', () => {
    const adminHtml = fs.readFileSync(path.join(__dirname, '../admin/dashboard.html'), 'utf8');
    const adminJs = fs.readFileSync(path.join(__dirname, '../admin/admin.js'), 'utf8');
    const customerOrdersHtml = fs.readFileSync(path.join(__dirname, '../customer/orders.html'), 'utf8');
    const customerOrdersJs = fs.readFileSync(path.join(__dirname, '../customer/customer-orders.js'), 'utf8');
    const publicIndexHtml = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');

    assert.ok(!adminHtml.includes('data-notify-order'), 'Admin dashboard HTML must not contain delivery notify button');
    assert.ok(!adminJs.includes('data-notify-order'), 'Admin JS must not contain delivery notify handler');
    assert.ok(!customerOrdersHtml.includes('data-notify-order'), 'Customer orders HTML must not contain notify button');
    assert.ok(!customerOrdersJs.includes('data-notify-order'), 'Customer orders JS must not contain notify handler');
    assert.ok(!publicIndexHtml.includes('data-notify-order'), 'Public index HTML must not contain delivery notify button');
  });

  // ─── 3. Frontend Button Disabled/Enabled by Status ────────────────────────
  await t.test('3. Frontend orderCard enables Notify ONLY for DELIVERED status, disabled for ACCEPTED, OUT_FOR_DELIVERY, CANCELLED', () => {
    const deliveryJs = fs.readFileSync(path.join(__dirname, '../delivery/delivery.js'), 'utf8');

    // Extract helper and orderCard functions in isolated scope
    const sandboxFn = new Function(`
      function money(v) { return '$' + Number(v||0).toFixed(2); }
      function escapeHtml(s) { return String(s||''); }
      ${deliveryJs.substring(deliveryJs.indexOf('function formatWhatsAppPhone'), deliveryJs.indexOf('async function loadDeliveryOrders'))}
      return orderCard;
    `);
    const cardFn = sandboxFn();

    const baseOrder = {
      _id: 'order123',
      orderId: 'SK-1001',
      totalAmount: 45.0,
      customer: { firstName: 'Alice', lastName: 'Smith', phone: '6045550101', address: '123 Main' },
      items: [{ productName: 'Full Meal', quantity: 1, fulfillment: 'delivery' }]
    };

    // 1. ACCEPTED -> Visible but disabled
    const acceptedHtml = cardFn({ ...baseOrder, status: 'ACCEPTED' });
    assert.ok(acceptedHtml.includes('data-notify-order="order123"'), 'Notify button must be visible for ACCEPTED');
    assert.ok(acceptedHtml.includes('disabled title="Notify button is enabled once the order is marked as Delivered"'), 'Notify button must be disabled for ACCEPTED');

    // 2. OUT_FOR_DELIVERY -> Visible but disabled
    const outHtml = cardFn({ ...baseOrder, status: 'OUT_FOR_DELIVERY' });
    assert.ok(outHtml.includes('data-notify-order="order123"'), 'Notify button must be visible for OUT_FOR_DELIVERY');
    assert.ok(outHtml.includes('disabled title="Notify button is enabled once the order is marked as Delivered"'), 'Notify button must be disabled for OUT_FOR_DELIVERY');

    // 3. CANCELLED -> Visible but disabled
    const cancelledHtml = cardFn({ ...baseOrder, status: 'CANCELLED' });
    assert.ok(cancelledHtml.includes('data-notify-order="order123"'), 'Notify button must be visible for CANCELLED');
    assert.ok(cancelledHtml.includes('disabled'), 'Notify button must be disabled for CANCELLED');

    // 4. DELIVERED with valid phone -> Enabled
    const deliveredHtml = cardFn({ ...baseOrder, status: 'DELIVERED' });
    assert.ok(deliveredHtml.includes('data-notify-order="order123"'), 'Notify button must be visible for DELIVERED');
    assert.ok(!deliveredHtml.includes('data-notify-order="order123" disabled'), 'Notify button must NOT be disabled for DELIVERED with valid phone');
    assert.ok(deliveredHtml.includes('title="Send WhatsApp delivery confirmation to customer"'), 'Notify title must indicate send capability');

    // 5. DELIVERED without phone -> Disabled due to missing contact info
    const noPhoneHtml = cardFn({ ...baseOrder, status: 'DELIVERED', customer: { ...baseOrder.customer, phone: '' } });
    assert.ok(noPhoneHtml.includes('disabled title="Customer phone number is missing or invalid"'), 'Notify button must be disabled when phone is missing');
  });

  // ─── 4. Phone Formatting & Message Template Verification ──────────────────
  await t.test('4. Message builder composes polite delivery completion notification with order details', () => {
    const deliveryJs = fs.readFileSync(path.join(__dirname, '../delivery/delivery.js'), 'utf8');
    const buildFn = new Function(`
      ${deliveryJs.substring(deliveryJs.indexOf('function buildDeliveryNotifyMessage'), deliveryJs.indexOf('function deliveryStatusLabel'))}
      return buildDeliveryNotifyMessage;
    `)();

    const sampleOrder = {
      orderId: '1042',
      customer: {
        firstName: 'Ananya',
        lastName: 'Sharma',
        address: '123 Main St, Vancouver, BC'
      }
    };

    const message = buildFn(sampleOrder);
    assert.ok(message.includes('Hello Ananya Sharma,'), 'Message must address customer by name');
    assert.ok(message.includes('#1042'), 'Message must include order ID');
    assert.ok(message.includes('123 Main St, Vancouver, BC'), 'Message must include delivery address');
    assert.ok(message.includes('has been delivered'), 'Message must state order has been delivered');
    assert.ok(message.includes('Sattwik Kitchen'), 'Message must include Sattwik Kitchen branding');
  });

  // ─── 5. Route Authentication & Authorization ──────────────────────────────
  await t.test('5. POST /api/delivery-orders/:id/notify rejects unauthenticated requests with 401', async () => {
    const { req, res } = mockReqRes({
      method: 'POST',
      params: { id: new mongoose.Types.ObjectId().toString() }
    });

    const layers = deliveryOrdersRouter.stack.find((s) => s.route?.path === '/:id/notify')?.route?.stack;
    assert.ok(layers && layers.length >= 2, 'Route must have auth middleware and handler');

    await layers[0].handle(req, res, () => {});
    assert.equal(res.statusCode, 401, 'Unauthenticated request must return 401');
  });

  // ─── 6. Backend Rejection of Non-DELIVERED Statuses ───────────────────────
  await t.test('6. POST /api/delivery-orders/:id/notify rejects ACCEPTED, OUT_FOR_DELIVERY, and CANCELLED orders with 400', async () => {
    const memberId = new mongoose.Types.ObjectId();
    const token = signDeliveryToken({ _id: memberId, email: 'driver@example.com', name: 'Ramesh Driver' });

    const origMemberFindOne = DeliveryMember.findOne;
    DeliveryMember.findOne = (query) => ({
      lean: () => Promise.resolve({
        _id: query._id || memberId,
        email: 'driver@example.com',
        name: 'Ramesh Driver',
        active: true,
        tokenVersion: 0
      })
    });

    const origFindById = Order.findById;

    try {
      const statusesToReject = ['ACCEPTED', 'OUT_FOR_DELIVERY', 'CANCELLED', 'PENDING'];

      for (const status of statusesToReject) {
        const orderId = new mongoose.Types.ObjectId();
        Order.findById = () => Promise.resolve({
          _id: orderId,
          status,
          deliveryMemberId: memberId,
          items: [{ productName: 'Full Meal', quantity: 1, fulfillment: 'delivery' }]
        });

        const { req, res } = mockReqRes({
          method: 'POST',
          params: { id: orderId.toString() },
          headers: { authorization: `Bearer ${token}` }
        });

        const layers = deliveryOrdersRouter.stack.find((s) => s.route?.path === '/:id/notify')?.route?.stack;
        let nextCalled = false;
        await layers[0].handle(req, res, () => { nextCalled = true; });
        assert.ok(nextCalled, 'Auth must pass');

        await layers[1].handle(req, res);

        assert.equal(res.statusCode, 400, `Status ${status} must be rejected with HTTP 400`);
        assert.ok(
          res._json.message.includes('once the order is marked as Delivered'),
          `Status ${status} error message must require Delivered status`
        );
      }
    } finally {
      Order.findById = origFindById;
      DeliveryMember.findOne = origMemberFindOne;
    }
  });

  // ─── 7. Backend Successful Notification for DELIVERED ─────────────────────
  await t.test('7. POST /api/delivery-orders/:id/notify accepts DELIVERED status, logs event, and updates lastNotifiedAt', async () => {
    const memberId = new mongoose.Types.ObjectId();
    const token = signDeliveryToken({ _id: memberId, email: 'driver@example.com', name: 'Ramesh Driver' });

    const origMemberFindOne = DeliveryMember.findOne;
    DeliveryMember.findOne = (query) => ({
      lean: () => Promise.resolve({
        _id: query._id || memberId,
        email: 'driver@example.com',
        name: 'Ramesh Driver',
        active: true,
        tokenVersion: 0
      })
    });

    const orderId = new mongoose.Types.ObjectId();
    const mockOrder = {
      _id: orderId,
      orderId: 'SK-2001',
      status: 'DELIVERED',
      deliveryMemberId: memberId,
      items: [{ productName: 'Full Meal Package', quantity: 1, fulfillment: 'delivery' }],
      customer: {
        firstName: 'Rajesh',
        lastName: 'Kumar',
        phone: '16045550101',
        address: '456 Oak St, Surrey, BC'
      },
      manualDeliveryNotifications: [],
      lastNotifiedAt: null,
      save: async function () {
        return this;
      }
    };

    const origFindById = Order.findById;
    Order.findById = (id) => {
      if (String(id) === String(orderId)) {
        return {
          ...mockOrder,
          populate: () => ({
            populate: () => ({
              lean: () => Promise.resolve({
                ...mockOrder,
                customer: mockOrder.customer
              })
            })
          }),
          save: mockOrder.save
        };
      }
      return Promise.resolve(null);
    };

    try {
      const { req, res } = mockReqRes({
        method: 'POST',
        params: { id: orderId.toString() },
        headers: { authorization: `Bearer ${token}` }
      });

      const layers = deliveryOrdersRouter.stack.find((s) => s.route?.path === '/:id/notify')?.route?.stack;
      let nextCalled = false;
      await layers[0].handle(req, res, () => { nextCalled = true; });
      assert.ok(nextCalled, 'Auth middleware must pass with valid token');

      await layers[1].handle(req, res);

      assert.equal(res.statusCode, 200, 'Notify route must return 200 for DELIVERED order');
      assert.equal(res._json.success, true, 'Response must report success');
      assert.ok(res._json.lastNotifiedAt, 'Response must return lastNotifiedAt timestamp');
      assert.equal(mockOrder.manualDeliveryNotifications.length, 1, 'Order must record 1 notification event');
      assert.equal(mockOrder.manualDeliveryNotifications[0].channel, 'whatsapp');
      assert.equal(mockOrder.manualDeliveryNotifications[0].orderStatus, 'DELIVERED');
    } finally {
      Order.findById = origFindById;
      DeliveryMember.findOne = origMemberFindOne;
    }
  });
});
