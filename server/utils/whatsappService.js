'use strict';

const mongoose = require('mongoose');
const DeliveryHistory = require('../models/DeliveryHistory');
const Order = require('../models/Order');
const { getOrderCustomer } = require('./orderCustomer');
const { startOfDay, formatDateKey } = require('./tiffinPreparation');
const { getCurrentServiceDate } = require('./deliveryStatus');

const BUSINESS_TIMEZONE = process.env.BUSINESS_TIMEZONE || 'America/Vancouver';

// In-memory outbox for testing, inspection, and development without live API keys
const _devOutbox = [];
let _mockSender = null;

/**
 * Check if an automated WhatsApp provider is configured in environment variables
 */
function isWhatsAppConfigured() {
  if (
    (process.env.WHATSAPP_API_TOKEN || process.env.WHATSAPP_ACCESS_TOKEN || process.env.META_WHATSAPP_TOKEN) &&
    process.env.WHATSAPP_PHONE_NUMBER_ID
  ) {
    return true;
  }
  if (
    process.env.TWILIO_ACCOUNT_SID &&
    process.env.TWILIO_AUTH_TOKEN &&
    (process.env.TWILIO_WHATSAPP_FROM || process.env.WHATSAPP_FROM)
  ) {
    return true;
  }
  if (process.env.WHATSAPP_GATEWAY_URL) {
    return true;
  }
  return false;
}

/**
 * Get active WhatsApp provider configuration type
 */
function getWhatsAppProviderConfig() {
  if (
    (process.env.WHATSAPP_API_TOKEN || process.env.WHATSAPP_ACCESS_TOKEN || process.env.META_WHATSAPP_TOKEN) &&
    process.env.WHATSAPP_PHONE_NUMBER_ID
  ) {
    return { provider: 'meta', isConfigured: true };
  }
  if (
    process.env.TWILIO_ACCOUNT_SID &&
    process.env.TWILIO_AUTH_TOKEN &&
    (process.env.TWILIO_WHATSAPP_FROM || process.env.WHATSAPP_FROM)
  ) {
    return { provider: 'twilio', isConfigured: true };
  }
  if (process.env.WHATSAPP_GATEWAY_URL) {
    return { provider: 'gateway', isConfigured: true };
  }
  return { provider: null, isConfigured: false };
}

/**
 * Log startup configuration status safely
 */
function logWhatsAppStatusOnStartup() {
  const { provider, isConfigured } = getWhatsAppProviderConfig();
  if (isConfigured) {
    console.log(`[whatsappService] Automatic WhatsApp delivery notification provider configured: ${provider.toUpperCase()}`);
  } else {
    console.warn(
      '[whatsappService] Notice: Automatic WhatsApp delivery provider is not configured in .env. ' +
      'Notifications will be safely recorded in database as unconfigured. ' +
      'To enable live sending, configure Meta Cloud API (WHATSAPP_API_TOKEN and WHATSAPP_PHONE_NUMBER_ID) ' +
      'or Twilio (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_WHATSAPP_FROM).'
    );
  }
}

/**
 * Format phone number to WhatsApp E.164 digits format (e.g. 16045550101)
 */
function formatWhatsAppNumber(phone) {
  if (!phone || typeof phone !== 'string') return null;
  const digits = phone.replace(/\D/g, '');
  if (!digits) return null;
  // If 10 digits (US/Canada local number), prepend North American country code '1'
  if (digits.length === 10) {
    return '1' + digits;
  }
  // If 11 or more digits (already includes country code)
  if (digits.length >= 11) {
    return digits;
  }
  return null;
}

/**
 * Mask phone number for safe logging
 */
function maskPhone(phone) {
  if (!phone || typeof phone !== 'string') return '***';
  const digits = phone.replace(/\D/g, '');
  if (digits.length <= 4) return '***';
  return digits.slice(0, 4) + '***' + digits.slice(-2);
}

/**
 * Format delivery date in business timezone
 */
function formatDeliveryDate(date) {
  const d = date ? new Date(date) : new Date();
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: BUSINESS_TIMEZONE
  });
}

/**
 * Resolve package/plan name and size from order
 */
function resolvePackageDescription(order) {
  if (!order) return 'Sattwik Meal Package';

  if (order.tiffinPlan && (order.tiffinPlan.packageType || order.tiffinPlan.size)) {
    const rawPkg = String(order.tiffinPlan.packageType || '').toLowerCase();
    const pkgName = rawPkg === 'curry-only'
      ? 'Curry-Only Package'
      : rawPkg === 'full'
      ? 'Full Meal Package'
      : (order.tiffinPlan.packageType
          ? String(order.tiffinPlan.packageType).charAt(0).toUpperCase() + String(order.tiffinPlan.packageType).slice(1)
          : 'Tiffin Plan');
    const size = order.tiffinPlan.size
      ? String(order.tiffinPlan.size).charAt(0).toUpperCase() + String(order.tiffinPlan.size).slice(1).toLowerCase()
      : '';
    return size ? `${pkgName} (${size})` : pkgName;
  }

  const deliveryItems = (order.items || []).filter((item) => item.fulfillment === 'delivery');
  const items = deliveryItems.length ? deliveryItems : (order.items || []);
  if (items.length) {
    return items.map((i) => {
      const name = i.productName || i.name || 'Item';
      const qty = Number(i.quantity) || 1;
      return `${name} × ${qty}`;
    }).join(', ');
  }

  if (order.type) {
    return String(order.type).charAt(0).toUpperCase() + String(order.type).slice(1) + ' Package';
  }

  return 'Sattwik Meal Package';
}

/**
 * Resolve customer name from live profile or snapshot
 */
function resolveCustomerName(order) {
  const customer = getOrderCustomer(order) || order.customer || order.customerSnapshot || {};
  const fullName = [customer.firstName, customer.lastName].filter(Boolean).join(' ').trim();
  if (fullName) return fullName;
  if (customer.name) return String(customer.name).trim();
  return 'Valued Customer';
}

/**
 * Build professional WhatsApp delivery confirmation message
 */
function buildDeliveryNotificationMessage({ customerName, orderId, packageName, deliveryDate }) {
  return [
    `Dear ${customerName},`,
    '',
    'Your Sattwik Kitchen order has been successfully delivered!',
    '',
    `Order ID: ${orderId}`,
    `Package: ${packageName}`,
    `Delivery Date: ${deliveryDate}`,
    '',
    'Thank you for choosing Sattwik Kitchen. We hope you enjoy your meal!',
    '',
    'Warm regards,',
    'Sattwik Kitchen'
  ].join('\n');
}

/**
 * Low-level dispatch to configured WhatsApp provider
 */
async function sendWhatsAppMessage({ to, message, orderId }) {
  if (_mockSender) {
    return await _mockSender({ to, message, orderId });
  }

  const { provider, isConfigured } = getWhatsAppProviderConfig();

  if (!isConfigured) {
    const unconfiguredRecord = {
      to,
      message,
      orderId,
      provider: 'unconfigured',
      status: 'unconfigured',
      createdAt: new Date()
    };
    _devOutbox.push(unconfiguredRecord);
    console.warn(
      `[whatsappService] Notification prepared for customer (${maskPhone(to)}) order ${orderId}, ` +
      'but no automated WhatsApp provider credentials are configured in .env.'
    );
    return {
      success: false,
      reason: 'UNCONFIGURED',
      error: 'WhatsApp provider not configured in .env. Configure Meta Cloud API or Twilio credentials.',
      messageBody: message
    };
  }

  // 1. Meta WhatsApp Cloud API
  if (provider === 'meta') {
    const token = process.env.WHATSAPP_API_TOKEN || process.env.WHATSAPP_ACCESS_TOKEN || process.env.META_WHATSAPP_TOKEN;
    const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    const url = `https://graph.facebook.com/v19.0/${encodeURIComponent(phoneId)}/messages`;

    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'text',
      text: {
        preview_url: false,
        body: message
      }
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const errMsg = data?.error?.message || `Meta API HTTP ${res.status}`;
      throw new Error(`Meta Cloud API error: ${errMsg}`);
    }

    const messageId = data?.messages?.[0]?.id || `meta_${Date.now()}`;
    return {
      success: true,
      provider: 'meta',
      messageId,
      data
    };
  }

  // 2. Twilio for WhatsApp
  if (provider === 'twilio') {
    const sid = process.env.TWILIO_ACCOUNT_SID;
    const auth = process.env.TWILIO_AUTH_TOKEN;
    const from = process.env.TWILIO_WHATSAPP_FROM || process.env.WHATSAPP_FROM;
    const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`;

    const bodyParams = new URLSearchParams();
    bodyParams.append('To', to.startsWith('+') ? `whatsapp:${to}` : `whatsapp:+${to}`);
    bodyParams.append('From', from.startsWith('whatsapp:') ? from : `whatsapp:${from}`);
    bodyParams.append('Body', message);

    const authHeader = 'Basic ' + Buffer.from(`${sid}:${auth}`).toString('base64');

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: authHeader,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: bodyParams.toString()
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const errMsg = data?.message || `Twilio HTTP ${res.status}`;
      throw new Error(`Twilio WhatsApp error: ${errMsg}`);
    }

    return {
      success: true,
      provider: 'twilio',
      messageId: data?.sid || `twilio_${Date.now()}`,
      data
    };
  }

  // 3. Custom Gateway
  if (provider === 'gateway') {
    const url = process.env.WHATSAPP_GATEWAY_URL;
    const headers = { 'Content-Type': 'application/json' };
    if (process.env.WHATSAPP_GATEWAY_KEY) {
      headers.Authorization = `Bearer ${process.env.WHATSAPP_GATEWAY_KEY}`;
    }

    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ to, message, orderId })
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(`Gateway HTTP ${res.status}`);
    }

    return {
      success: true,
      provider: 'gateway',
      messageId: data?.messageId || `gw_${Date.now()}`,
      data
    };
  }

  throw new Error('Unsupported WhatsApp provider');
}

/**
 * Main delivery notification handler
 * Called after order status is successfully transitioned to DELIVERED
 */
async function sendDeliveryWhatsAppNotification({ order, deliveryMemberId, now = new Date() }) {
  if (!order || !order.orderId) {
    return { success: false, error: 'Order is required' };
  }

  // Determine delivery date (Vancouver business date UTC midnight)
  const deliveryDate = getCurrentServiceDate(order, now) || startOfDay(order.deliveredAt || now);
  const dateKey = formatDateKey(deliveryDate);

  // ── 1. Persistent Idempotency Check ────────────────────────────────────────
  // Check DeliveryHistory for this specific order and delivery date
  let historyRecord = null;
  try {
    historyRecord = await DeliveryHistory.findOne({
      orderId: order.orderId,
      deliveryDate: deliveryDate
    });
  } catch (err) {
    // If DeliveryHistory model lookup fails (e.g. in standalone tests), continue
  }

  if (historyRecord && historyRecord.whatsappNotification?.sent === true) {
    console.log(`[whatsappService] Delivery notification for order ${order.orderId} on ${dateKey} was already sent. Skipping duplicate.`);
    return {
      success: true,
      skipped: true,
      duplicate: true,
      messageId: historyRecord.whatsappNotification.messageId,
      message: 'Notification already sent for this delivery event'
    };
  }

  // Also check order document directly if array is present
  if (Array.isArray(order.whatsappDeliveryNotifications)) {
    const alreadySentInOrder = order.whatsappDeliveryNotifications.find(
      (n) => n.dateKey === dateKey && n.sent === true
    );
    if (alreadySentInOrder) {
      console.log(`[whatsappService] Delivery notification for order ${order.orderId} on ${dateKey} was already sent according to order records. Skipping duplicate.`);
      return {
        success: true,
        skipped: true,
        duplicate: true,
        messageId: alreadySentInOrder.messageId,
        message: 'Notification already sent for this delivery event'
      };
    }
  }

  // ── 2. Resolve Customer, Phone, and Content ────────────────────────────────
  const customer = getOrderCustomer(order) || order.customer || order.customerSnapshot || {};
  const customerName = resolveCustomerName(order);
  const rawPhone = customer.phone || order.customerSnapshot?.phone || '';
  const formattedPhone = formatWhatsAppNumber(rawPhone);

  const packageName = resolvePackageDescription(order);
  const formattedDate = formatDeliveryDate(deliveryDate);

  const messageText = buildDeliveryNotificationMessage({
    customerName,
    orderId: order.orderId,
    packageName,
    deliveryDate: formattedDate
  });

  if (!formattedPhone) {
    console.warn(`[whatsappService] Order ${order.orderId} customer phone (${rawPhone}) is invalid for WhatsApp. Skipping send.`);
    const failureRecord = {
      sent: false,
      status: 'failed',
      error: 'Customer phone number is missing or invalid',
      recipientPhone: rawPhone || '',
      lastAttemptAt: now
    };
    await updateNotificationRecords(order, deliveryDate, deliveryMemberId, failureRecord);
    return {
      success: false,
      error: 'Customer phone number is missing or invalid',
      status: 'failed'
    };
  }

  // ── 3. Send Notification via Provider ─────────────────────────────────────
  let dispatchResult = null;
  try {
    dispatchResult = await sendWhatsAppMessage({
      to: formattedPhone,
      message: messageText,
      orderId: order.orderId
    });
  } catch (apiError) {
    console.error(`[whatsappService] WhatsApp sending failed for order ${order.orderId}:`, apiError.message);
    const failureRecord = {
      sent: false,
      status: 'failed',
      error: apiError.message,
      recipientPhone: formattedPhone,
      messageBody: messageText,
      lastAttemptAt: now
    };
    await updateNotificationRecords(order, deliveryDate, deliveryMemberId, failureRecord);
    return {
      success: false,
      error: apiError.message,
      status: 'failed'
    };
  }

  // ── 4. Record Results for Idempotency and Audit ────────────────────────────
  if (dispatchResult && dispatchResult.success) {
    const successRecord = {
      sent: true,
      sentAt: now,
      recipientPhone: formattedPhone,
      messageId: dispatchResult.messageId,
      status: 'sent',
      provider: dispatchResult.provider,
      messageBody: messageText,
      lastAttemptAt: now
    };
    await updateNotificationRecords(order, deliveryDate, deliveryMemberId, successRecord);
    console.log(`[whatsappService] WhatsApp delivery notification successfully sent for order ${order.orderId} to ${maskPhone(formattedPhone)}`);
    return {
      success: true,
      sent: true,
      messageId: dispatchResult.messageId,
      provider: dispatchResult.provider,
      status: 'sent',
      messageBody: messageText
    };
  } else {
    // Unconfigured provider (safe fallback)
    const unconfiguredRecord = {
      sent: false,
      status: 'unconfigured',
      error: dispatchResult?.error || 'WhatsApp provider not configured in .env',
      recipientPhone: formattedPhone,
      messageBody: messageText,
      lastAttemptAt: now
    };
    await updateNotificationRecords(order, deliveryDate, deliveryMemberId, unconfiguredRecord);
    return {
      success: false,
      sent: false,
      status: 'unconfigured',
      error: unconfiguredRecord.error,
      messageBody: messageText
    };
  }
}

/**
 * Helper to update DeliveryHistory and Order notification status
 */
async function updateNotificationRecords(order, deliveryDate, deliveryMemberId, notificationData) {
  const dateKey = formatDateKey(deliveryDate);

  try {
    // Update DeliveryHistory if it exists
    if (DeliveryHistory && typeof DeliveryHistory.updateOne === 'function') {
      await DeliveryHistory.updateOne(
        {
          orderId: order.orderId,
          deliveryDate: deliveryDate
        },
        {
          $set: {
            whatsappNotification: notificationData
          }
        }
      );
    }
  } catch (err) {
    // Safe ignore in unit test mock environments
  }

  try {
    // Update Order model array
    if (Order && typeof Order.updateOne === 'function' && order._id) {
      await Order.updateOne(
        { _id: order._id },
        {
          $pull: { whatsappDeliveryNotifications: { dateKey } }
        }
      );
      await Order.updateOne(
        { _id: order._id },
        {
          $push: {
            whatsappDeliveryNotifications: {
              deliveryDate,
              dateKey,
              ...notificationData
            }
          }
        }
      );
    }
  } catch (err) {
    // Safe ignore in unit test mock environments
  }
}

// ── Test & Mock Helpers ──────────────────────────────────────────────────────
function getDevWhatsAppOutbox() {
  return [..._devOutbox];
}

function clearDevWhatsAppOutbox() {
  _devOutbox.length = 0;
}

function setMockWhatsAppSender(fn) {
  _mockSender = fn;
}

function restoreWhatsAppSender() {
  _mockSender = null;
}

module.exports = {
  isWhatsAppConfigured,
  getWhatsAppProviderConfig,
  logWhatsAppStatusOnStartup,
  formatWhatsAppNumber,
  formatDeliveryDate,
  resolvePackageDescription,
  resolveCustomerName,
  buildDeliveryNotificationMessage,
  sendWhatsAppMessage,
  sendDeliveryWhatsAppNotification,
  getDevWhatsAppOutbox,
  clearDevWhatsAppOutbox,
  setMockWhatsAppSender,
  restoreWhatsAppSender
};
