'use strict';

/**
 * Automated Test Suite: Automatic WhatsApp Delivery Notifications
 *
 * Verifies all 8 required criteria:
 * 1. A successful delivery status update triggers the correct WhatsApp message.
 * 2. The message goes to the correct customer's WhatsApp number.
 * 3. The message contains the correct customer name, order ID, package, and delivery date.
 * 4. Each eligible daily subscription delivery triggers one notification.
 * 5. Repeated clicks or duplicate requests do not send duplicate notifications.
 * 6. A failed status update sends no notification.
 * 7. A WhatsApp API failure does not undo the successful delivery status update.
 * 8. Unauthorized users cannot trigger delivery notifications.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const Order = require('../server/models/Order');
const DeliveryHistory = require('../server/models/DeliveryHistory');
const DeliveryMember = require('../server/models/DeliveryMember');
const TiffinSubscription = require('../server/models/TiffinSubscription');
const deliveryOrdersRouter = require('../server/routes/deliveryOrders');
const whatsappService = require('../server/utils/whatsappService');

// Helper to mock express req/res
function mockReqRes({ method = 'PUT', body = {}, params = {}, headers = {}, deliveryMember = null } = {}) {
  const req = {
    method,
    body,
    params,
    headers: { ...headers },
    deliveryMember,
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

// Find route handler in router stack
function findHandler(router, pathPattern, method) {
  for (const layer of router.stack) {
    if (layer.route && layer.route.path === pathPattern && layer.route.methods[method.toLowerCase()]) {
      return layer.route.stack[layer.route.stack.length - 1].handle;
    }
  }
  return null;
}

test('Automatic WhatsApp Delivery Notifications - Test Suite', async (t) => {
  const mockOrders = new Map();
  const mockHistories = new Map();

  const origOrderFindById = Order.findById;
  const origOrderUpdateOne = Order.updateOne;
  const origOrderFindOneAndUpdate = Order.findOneAndUpdate;
  const origHistoryFindOne = DeliveryHistory.findOne;
  const origHistoryUpdateOne = DeliveryHistory.updateOne;
  const origHistoryFindOneAndUpdate = DeliveryHistory.findOneAndUpdate;
  const origTiffinUpdateMany = TiffinSubscription.updateMany;

  Order.findOneAndUpdate = (filter, update) => {
    const id = String(filter._id);
    const ord = mockOrders.get(id);
    if (!ord) {
      return {
        lean: () => Promise.resolve(null),
        then: (fn) => Promise.resolve(null).then(fn)
      };
    }
    if (update.$set) {
      if (update.$set.status) ord.status = update.$set.status;
      if (update.$set.deliveredAt) ord.deliveredAt = update.$set.deliveredAt;
      if (update.$set.outForDeliveryAt) ord.outForDeliveryAt = update.$set.outForDeliveryAt;
      if (update.$set.deliveryStatusDate) ord.deliveryStatusDate = update.$set.deliveryStatusDate;
      if (ord.items) {
        ord.items.forEach((item) => {
          if (update.$set['items.$[item].deliveryStatus']) {
            item.deliveryStatus = update.$set['items.$[item].deliveryStatus'];
          }
        });
      }
    }
    mockOrders.set(id, ord);
    const copy = { ...ord };
    return {
      lean: () => Promise.resolve(copy),
      then: (fn) => Promise.resolve(copy).then(fn)
    };
  };

  Order.findById = (id) => {
    const ord = mockOrders.get(String(id));
    if (!ord) {
      return {
        populate: () => ({ populate: () => ({ lean: () => Promise.resolve(null), then: (fn) => Promise.resolve(null).then(fn) }) }),
        lean: () => Promise.resolve(null),
        then: (fn) => Promise.resolve(null).then(fn)
      };
    }
    const doc = {
      ...ord,
      save: async function () {
        mockOrders.set(String(this._id), { ...this });
        return this;
      }
    };
    const populateObj = {
      populate: () => populateObj,
      lean: () => Promise.resolve({ ...ord }),
      then: (fn) => Promise.resolve(doc).then(fn)
    };
    return {
      populate: () => populateObj,
      lean: () => Promise.resolve({ ...ord }),
      then: (fn) => Promise.resolve(doc).then(fn)
    };
  };

  Order.updateOne = async (filter, update) => {
    const id = String(filter._id);
    const ord = mockOrders.get(id);
    if (!ord) return { modifiedCount: 0 };
    if (!ord.whatsappDeliveryNotifications) ord.whatsappDeliveryNotifications = [];
    if (update.$push && update.$push.whatsappDeliveryNotifications) {
      ord.whatsappDeliveryNotifications.push(update.$push.whatsappDeliveryNotifications);
    }
    if (update.$pull && update.$pull.whatsappDeliveryNotifications) {
      const dateKey = update.$pull.whatsappDeliveryNotifications.dateKey;
      ord.whatsappDeliveryNotifications = ord.whatsappDeliveryNotifications.filter((n) => n.dateKey !== dateKey);
    }
    mockOrders.set(id, ord);
    return { modifiedCount: 1 };
  };

  DeliveryHistory.findOne = async (query) => {
    for (const h of mockHistories.values()) {
      let match = true;
      if (query.orderId && h.orderId !== query.orderId) match = false;
      if (query.deliveryDate && new Date(h.deliveryDate).getTime() !== new Date(query.deliveryDate).getTime()) match = false;
      if (match) return { ...h };
    }
    return null;
  };

  DeliveryHistory.updateOne = async (filter, update) => {
    for (const [key, h] of mockHistories.entries()) {
      let match = true;
      if (filter.orderId && h.orderId !== filter.orderId) match = false;
      if (filter.deliveryDate && new Date(h.deliveryDate).getTime() !== new Date(filter.deliveryDate).getTime()) match = false;
      if (match) {
        if (update.$set && update.$set.whatsappNotification) {
          h.whatsappNotification = { ...(h.whatsappNotification || {}), ...update.$set.whatsappNotification };
        }
        mockHistories.set(key, h);
        return { modifiedCount: 1 };
      }
    }
    return { modifiedCount: 0 };
  };

  DeliveryHistory.findOneAndUpdate = async (filter, update, options) => {
    const key = `${filter.orderId}_${new Date(filter.deliveryDate).toISOString()}`;
    let h = mockHistories.get(key) || {
      orderId: filter.orderId,
      deliveryDate: filter.deliveryDate,
      deliveryMemberId: filter.deliveryMemberId,
      whatsappNotification: { sent: false }
    };
    if (update.$set) Object.assign(h, update.$set);
    mockHistories.set(key, h);
    return h;
  };

  TiffinSubscription.updateMany = async () => ({ acknowledged: true });

  t.after(() => {
    Order.findById = origOrderFindById;
    Order.updateOne = origOrderUpdateOne;
    Order.findOneAndUpdate = origOrderFindOneAndUpdate;
    DeliveryHistory.findOne = origHistoryFindOne;
    DeliveryHistory.updateOne = origHistoryUpdateOne;
    DeliveryHistory.findOneAndUpdate = origHistoryFindOneAndUpdate;
    TiffinSubscription.updateMany = origTiffinUpdateMany;
    whatsappService.restoreWhatsAppSender();
    whatsappService.clearDevWhatsAppOutbox();
  });

  // Track dispatched messages
  const sentMessages = [];
  whatsappService.setMockWhatsAppSender(async ({ to, message, orderId }) => {
    sentMessages.push({ to, message, orderId, sentAt: new Date() });
    return {
      success: true,
      provider: 'mock-meta',
      messageId: `wamid.HBgL${Date.now()}`
    };
  });

  const memberId1 = new mongoose.Types.ObjectId().toString();
  const deliveryMember = { _id: memberId1, name: 'Suresh Kumar', email: 'suresh@sattwik.com', active: true };

  // ─── 1. Successful Delivery Triggers WhatsApp Message ──────────────────────
  await t.test('1. A successful delivery status update triggers the correct WhatsApp message', async () => {
    sentMessages.length = 0;
    const orderId1 = new mongoose.Types.ObjectId().toString();
    const mockOrder = {
      _id: orderId1,
      orderId: '26102800001',
      customer: {
        _id: 'cust-1',
        firstName: 'Aarav',
        lastName: 'Sharma',
        phone: '604-555-0199',
        email: 'aarav@example.com',
        address: '123 Robson St, Vancouver'
      },
      deliveryMemberId: memberId1,
      status: 'OUT_FOR_DELIVERY',
      fulfillment: 'delivery',
      type: 'tiffin',
      tiffinPlan: { packageType: 'full', size: 'single' },
      items: [{ productName: 'Full Meal Package (Single)', fulfillment: 'delivery', quantity: 1, subtotal: 18, deliveryStatus: 'OUT_FOR_DELIVERY' }],
      totalAmount: 18
    };
    mockOrders.set(orderId1, mockOrder);

    const handler = findHandler(deliveryOrdersRouter, '/:id/status', 'put');
    assert.ok(handler, 'PUT /:id/status handler must exist');

    const { req, res } = mockReqRes({
      method: 'PUT',
      params: { id: orderId1 },
      body: { status: 'DELIVERED' },
      deliveryMember
    });

    await handler(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(sentMessages.length, 1, 'Exactly one WhatsApp message should be triggered');
    assert.equal(sentMessages[0].orderId, '26102800001');
  });

  // ─── 2. Recipient Phone & Country Code Formatting ──────────────────────────
  await t.test('2. The message goes to the correct customer WhatsApp number with country code', async () => {
    assert.equal(sentMessages[0].to, '16045550199', '10-digit Vancouver phone must be formatted with North American country code 1');

    // Unit test formatWhatsAppNumber with varied inputs
    assert.equal(whatsappService.formatWhatsAppNumber('604-555-0101'), '16045550101');
    assert.equal(whatsappService.formatWhatsAppNumber('+1 (604) 555-0101'), '16045550101');
    assert.equal(whatsappService.formatWhatsAppNumber('16725881282'), '16725881282');
    assert.equal(whatsappService.formatWhatsAppNumber('+91 98765 43210'), '919876543210');
    assert.equal(whatsappService.formatWhatsAppNumber(''), null);
    assert.equal(whatsappService.formatWhatsAppNumber('123'), null);
  });

  // ─── 3. Message Template Content Verification ──────────────────────────────
  await t.test('3. The message contains correct customer name, order ID, package, and delivery date', async () => {
    const msg = sentMessages[0].message;

    assert.ok(msg.includes('Dear Aarav Sharma,'), 'Must greet customer by full name');
    assert.ok(msg.includes('Your Sattwik Kitchen order has been successfully delivered!'), 'Must include success confirmation statement');
    assert.ok(msg.includes('Order ID: 26102800001'), 'Must include correct order ID');
    assert.ok(msg.includes('Package: Full Meal Package (Single)'), 'Must include correct package name and size');
    assert.ok(msg.includes('Delivery Date:'), 'Must include delivery date');
    assert.ok(msg.includes('Thank you for choosing Sattwik Kitchen. We hope you enjoy your meal!'), 'Must include polite closing');
    assert.ok(msg.includes('Warm regards,\nSattwik Kitchen'), 'Must include signature');

    // Verify template helper with products
    const productMsg = whatsappService.buildDeliveryNotificationMessage({
      customerName: 'Priya Patel',
      orderId: '26102800002',
      packageName: 'Moringa Leaf Powder × 2',
      deliveryDate: 'Oct 28, 2026'
    });
    assert.ok(productMsg.includes('Dear Priya Patel,'));
    assert.ok(productMsg.includes('Package: Moringa Leaf Powder × 2'));
    assert.ok(productMsg.includes('Delivery Date: Oct 28, 2026'));
  });

  // ─── 4. Daily Subscription Deliveries Trigger One Notification Each ────────
  await t.test('4. Each eligible daily subscription delivery triggers one notification', async () => {
    sentMessages.length = 0;
    const subOrderId = new mongoose.Types.ObjectId().toString();
    const subOrder = {
      _id: subOrderId,
      orderId: '26102800003',
      customer: { firstName: 'Deepak', lastName: 'Verma', phone: '6045550222' },
      deliveryMemberId: memberId1,
      status: 'OUT_FOR_DELIVERY',
      fulfillment: 'delivery',
      type: 'tiffin',
      tiffinPlan: { packageType: 'curry-only', size: 'couple' },
      items: [{ productName: 'Curry-Only Package (Couple)', fulfillment: 'delivery', quantity: 1, deliveryStatus: 'OUT_FOR_DELIVERY' }]
    };
    mockOrders.set(subOrderId, subOrder);

    // Day 1 delivery (Oct 28)
    const day1Date = new Date('2026-10-28T12:00:00Z');
    const day1Res = await whatsappService.sendDeliveryWhatsAppNotification({
      order: subOrder,
      deliveryMemberId: memberId1,
      now: day1Date
    });

    assert.equal(day1Res.success, true);
    assert.equal(day1Res.sent, true);
    assert.equal(sentMessages.length, 1);
    assert.ok(sentMessages[0].message.includes('Curry-Only Package (Couple)'));

    // Day 2 delivery (Oct 29)
    const day2Date = new Date('2026-10-29T12:00:00Z');
    const day2Res = await whatsappService.sendDeliveryWhatsAppNotification({
      order: subOrder,
      deliveryMemberId: memberId1,
      now: day2Date
    });

    assert.equal(day2Res.success, true);
    assert.equal(day2Res.sent, true);
    assert.equal(sentMessages.length, 2, 'Day 2 delivery must trigger a second daily notification');
  });

  // ─── 5. Persistent Idempotency: Duplicate Requests Skip Sending ────────────
  await t.test('5. Repeated clicks or duplicate requests do not send duplicate notifications', async () => {
    const currentCount = sentMessages.length;
    const subOrder = mockOrders.get(Array.from(mockOrders.keys())[1]);

    // Re-attempt Day 1 delivery notification
    const dupRes = await whatsappService.sendDeliveryWhatsAppNotification({
      order: subOrder,
      deliveryMemberId: memberId1,
      now: new Date('2026-10-28T12:00:00Z')
    });

    assert.equal(dupRes.skipped, true);
    assert.equal(dupRes.duplicate, true);
    assert.equal(sentMessages.length, currentCount, 'Sent messages count must not increase on duplicate request');
  });

  // ─── 6. Failed Status Update Sends No Notification ─────────────────────────
  await t.test('6. A failed status update sends no notification', async () => {
    sentMessages.length = 0;
    const cancelledOrderId = new mongoose.Types.ObjectId().toString();
    mockOrders.set(cancelledOrderId, {
      _id: cancelledOrderId,
      orderId: '26102800004',
      status: 'CANCELLED',
      deliveryMemberId: memberId1,
      customer: { phone: '6045559999' },
      items: [{ fulfillment: 'delivery', deliveryStatus: 'CANCELLED' }]
    });

    const handler = findHandler(deliveryOrdersRouter, '/:id/status', 'put');
    const { req, res } = mockReqRes({
      params: { id: cancelledOrderId },
      body: { status: 'DELIVERED' },
      deliveryMember
    });

    await handler(req, res);

    assert.notEqual(res.statusCode, 200, 'Transition from CANCELLED to DELIVERED must fail');
    assert.equal(sentMessages.length, 0, 'No notification should be sent on failed status update');
  });

  // ─── 7. WhatsApp API Failure Does Not Revert Delivered Status ─────────────
  await t.test('7. A WhatsApp API failure does not undo the successful delivery status update', async () => {
    sentMessages.length = 0;
    const testOrderId = new mongoose.Types.ObjectId().toString();
    const testOrder = {
      _id: testOrderId,
      orderId: '26102800005',
      status: 'OUT_FOR_DELIVERY',
      deliveryMemberId: memberId1,
      fulfillment: 'delivery',
      type: 'product',
      customer: { firstName: 'Rohan', phone: '6045553333' },
      items: [{ productName: 'Moringa Powder', fulfillment: 'delivery', quantity: 1, deliveryStatus: 'OUT_FOR_DELIVERY' }]
    };
    mockOrders.set(testOrderId, testOrder);

    // Simulate WhatsApp API error
    whatsappService.setMockWhatsAppSender(async () => {
      throw new Error('Meta Graph API 500: Internal server error at Meta');
    });

    const handler = findHandler(deliveryOrdersRouter, '/:id/status', 'put');
    const { req, res } = mockReqRes({
      params: { id: testOrderId },
      body: { status: 'DELIVERED' },
      deliveryMember
    });

    await handler(req, res);

    // The order status change must still succeed with 200!
    assert.equal(res.statusCode, 200);
    assert.equal(res._json.order.status, 'DELIVERED', 'Delivered status must NOT be reverted on WhatsApp failure');
    assert.equal(res._json.whatsappNotification.success, false);
    assert.ok(res._json.whatsappNotification.error.includes('Meta Graph API 500'));
  });

  // ─── 8. Unauthorized Users Cannot Trigger Delivery Notifications ──────────
  await t.test('8. Unauthorized users cannot trigger delivery notifications', async () => {
    sentMessages.length = 0;
    const testOrderId = new mongoose.Types.ObjectId().toString();
    mockOrders.set(testOrderId, {
      _id: testOrderId,
      orderId: '26102800006',
      status: 'OUT_FOR_DELIVERY',
      deliveryMemberId: memberId1,
      customer: { phone: '6045554444' },
      items: [{ fulfillment: 'delivery', deliveryStatus: 'OUT_FOR_DELIVERY' }]
    });

    const handler = findHandler(deliveryOrdersRouter, '/:id/status', 'put');

    // Case A: Unassigned / wrong delivery member
    const wrongMember = { _id: new mongoose.Types.ObjectId().toString(), name: 'Imposter' };
    const { req, res } = mockReqRes({
      params: { id: testOrderId },
      body: { status: 'DELIVERED' },
      deliveryMember: wrongMember
    });

    await handler(req, res);
    assert.equal(res.statusCode, 409);
    assert.equal(sentMessages.length, 0, 'No notification sent for wrong delivery member');

    // Case B: Route middleware enforces deliveryAuthRequired
    const { deliveryAuthRequired } = require('../server/middleware/deliveryAuth');
    const { req: unauthReq, res: unauthRes } = mockReqRes({ headers: {} });
    let nextCalled = false;
    await deliveryAuthRequired(unauthReq, unauthRes, () => { nextCalled = true; });

    assert.equal(unauthRes.statusCode, 401);
    assert.equal(nextCalled, false, 'Middleware must reject unauthenticated requests with 401');
  });

  // ─── 9. Provider Configuration & Startup Status ────────────────────────────
  await t.test('9. Provider configuration detection distinguishes Meta, Twilio, and Unconfigured', () => {
    const origEnv = { ...process.env };

    // Case A: Unconfigured
    delete process.env.WHATSAPP_API_TOKEN;
    delete process.env.WHATSAPP_PHONE_NUMBER_ID;
    delete process.env.TWILIO_ACCOUNT_SID;
    delete process.env.TWILIO_AUTH_TOKEN;
    delete process.env.TWILIO_WHATSAPP_FROM;
    delete process.env.WHATSAPP_GATEWAY_URL;
    assert.equal(whatsappService.isWhatsAppConfigured(), false);
    assert.equal(whatsappService.getWhatsAppProviderConfig().provider, null);

    // Case B: Meta Cloud API
    process.env.WHATSAPP_API_TOKEN = 'test_token';
    process.env.WHATSAPP_PHONE_NUMBER_ID = 'test_phone_id';
    assert.equal(whatsappService.isWhatsAppConfigured(), true);
    assert.equal(whatsappService.getWhatsAppProviderConfig().provider, 'meta');

    // Case C: Twilio WhatsApp
    delete process.env.WHATSAPP_API_TOKEN;
    delete process.env.WHATSAPP_PHONE_NUMBER_ID;
    process.env.TWILIO_ACCOUNT_SID = 'AC123';
    process.env.TWILIO_AUTH_TOKEN = 'auth123';
    process.env.TWILIO_WHATSAPP_FROM = 'whatsapp:+14155238886';
    assert.equal(whatsappService.isWhatsAppConfigured(), true);
    assert.equal(whatsappService.getWhatsAppProviderConfig().provider, 'twilio');

    // Restore env
    for (const key of Object.keys(process.env)) {
      if (!(key in origEnv)) delete process.env[key];
    }
    Object.assign(process.env, origEnv);
  });

  // ─── 10. Live HTTP Dispatch Format (Meta & Twilio) ─────────────────────────
  await t.test('10. Provider HTTP dispatch formats payloads correctly for Meta and Twilio', async () => {
    whatsappService.restoreWhatsAppSender(); // restore real sender to test payload formatting
    const origFetch = global.fetch;
    const fetchCalls = [];

    global.fetch = async (url, opts) => {
      fetchCalls.push({ url, opts });
      return {
        ok: true,
        status: 200,
        json: async () => ({
          messages: [{ id: 'wamid.test_123' }],
          sid: 'SM_test_456'
        })
      };
    };

    try {
      // Test Meta dispatch
      process.env.WHATSAPP_API_TOKEN = 'meta_secret_token';
      process.env.WHATSAPP_PHONE_NUMBER_ID = '10987654321';
      delete process.env.TWILIO_ACCOUNT_SID;

      const metaRes = await whatsappService.sendWhatsAppMessage({
        to: '16045550101',
        message: 'Hello Customer',
        orderId: 'SK-101'
      });

      assert.equal(metaRes.success, true);
      assert.equal(metaRes.provider, 'meta');
      assert.equal(metaRes.messageId, 'wamid.test_123');
      assert.ok(fetchCalls[0].url.includes('10987654321/messages'));
      const metaBody = JSON.parse(fetchCalls[0].opts.body);
      assert.equal(metaBody.to, '16045550101');
      assert.equal(metaBody.text.body, 'Hello Customer');
      assert.equal(fetchCalls[0].opts.headers.Authorization, 'Bearer meta_secret_token');

      // Test Twilio dispatch
      delete process.env.WHATSAPP_API_TOKEN;
      delete process.env.WHATSAPP_PHONE_NUMBER_ID;
      process.env.TWILIO_ACCOUNT_SID = 'AC_test_account';
      process.env.TWILIO_AUTH_TOKEN = 'auth_secret_token';
      process.env.TWILIO_WHATSAPP_FROM = 'whatsapp:+14155238886';

      const twilioRes = await whatsappService.sendWhatsAppMessage({
        to: '16045550101',
        message: 'Hello Twilio Customer',
        orderId: 'SK-102'
      });

      assert.equal(twilioRes.success, true);
      assert.equal(twilioRes.provider, 'twilio');
      assert.equal(twilioRes.messageId, 'SM_test_456');
      assert.ok(fetchCalls[1].url.includes('AC_test_account/Messages.json'));
      assert.ok(fetchCalls[1].opts.body.includes('To=whatsapp%3A%2B16045550101'));
      assert.ok(fetchCalls[1].opts.headers.Authorization.startsWith('Basic '));
    } finally {
      global.fetch = origFetch;
      delete process.env.WHATSAPP_API_TOKEN;
      delete process.env.WHATSAPP_PHONE_NUMBER_ID;
      delete process.env.TWILIO_ACCOUNT_SID;
      delete process.env.TWILIO_AUTH_TOKEN;
      delete process.env.TWILIO_WHATSAPP_FROM;
    }
  });

  // ─── 11. Graceful Handling When Provider Is Unconfigured ───────────────────
  await t.test('11. When unconfigured, records to dev outbox without pretending message was sent', async () => {
    whatsappService.restoreWhatsAppSender();
    whatsappService.clearDevWhatsAppOutbox();

    delete process.env.WHATSAPP_API_TOKEN;
    delete process.env.WHATSAPP_PHONE_NUMBER_ID;
    delete process.env.TWILIO_ACCOUNT_SID;
    delete process.env.TWILIO_AUTH_TOKEN;
    delete process.env.TWILIO_WHATSAPP_FROM;
    delete process.env.WHATSAPP_GATEWAY_URL;

    const res = await whatsappService.sendWhatsAppMessage({
      to: '16045550101',
      message: 'Unconfigured Test Message',
      orderId: 'SK-103'
    });

    assert.equal(res.success, false);
    assert.equal(res.reason, 'UNCONFIGURED');
    assert.ok(res.error.includes('WhatsApp provider not configured'));

    const outbox = whatsappService.getDevWhatsAppOutbox();
    assert.equal(outbox.length, 1);
    assert.equal(outbox[0].to, '16045550101');
    assert.equal(outbox[0].status, 'unconfigured');
  });
});
