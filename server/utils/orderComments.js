'use strict';

const mongoose = require('mongoose');

/**
 * Validates comment text.
 * Rejects empty or whitespace-only strings and strings exceeding 2,000 characters.
 */
function validateCommentText(text) {
  if (typeof text !== 'string') {
    return { error: 'Comment text must be a string.' };
  }
  const trimmed = text.trim();
  if (!trimmed) {
    return { error: 'Comment text cannot be empty.' };
  }
  if (trimmed.length > 2000) {
    return { error: 'Comment must be 2,000 characters or fewer.' };
  }
  return { trimmed };
}

/**
 * Returns all effective comments for an order (including legacy customerFeedback).
 * Comments are sorted in chronological order (oldest first).
 *
 * @param {Object} order - Order document or plain object
 * @param {string} [fulfillmentFilter] - Optional 'delivery' or 'pickup' filter
 * @returns {Array<Object>}
 */
function getEffectiveOrderComments(order, fulfillmentFilter) {
  if (!order) return [];

  const rawComments = Array.isArray(order.comments) ? order.comments : [];
  const comments = rawComments.map((c) => {
    const obj = typeof c.toObject === 'function' ? c.toObject() : { ...c };
    return {
      _id: obj._id || new mongoose.Types.ObjectId(),
      orderId: obj.orderId || order._id,
      fulfillment: obj.fulfillment || (order.fulfillment === 'pickup' ? 'pickup' : 'delivery'),
      authorType: obj.authorType || 'customer',
      authorId: obj.authorId || null,
      authorName: obj.authorName || (obj.authorType === 'admin' ? 'Admin' : 'Customer'),
      text: String(obj.text || ''),
      createdAt: obj.createdAt || order.createdAt || new Date()
    };
  });

  // Extract legacy customerFeedback (plain object or Mongoose Map)
  let feedbackMap = {};
  if (order.customerFeedback instanceof Map) {
    feedbackMap = Object.fromEntries(order.customerFeedback);
  } else if (order.customerFeedback && typeof order.customerFeedback === 'object') {
    feedbackMap = order.customerFeedback;
  }

  for (const [fType, text] of Object.entries(feedbackMap)) {
    if (!text || typeof text !== 'string' || !text.trim()) continue;
    const trimmed = text.trim();
    // Check if a customer comment with this exact text is already present for this component
    const alreadyPresent = comments.some(
      (c) => c.fulfillment === fType && c.authorType === 'customer' && c.text.trim() === trimmed
    );
    if (!alreadyPresent) {
      const authorName = (order.customerSnapshot && [order.customerSnapshot.firstName, order.customerSnapshot.lastName].filter(Boolean).join(' '))
        || (order.customer && typeof order.customer === 'object' && [order.customer.firstName, order.customer.lastName].filter(Boolean).join(' '))
        || 'Customer';

      comments.unshift({
        _id: new mongoose.Types.ObjectId(),
        orderId: order._id,
        fulfillment: fType,
        authorType: 'customer',
        authorId: order.customer?._id || order.customer || order.customerId || null,
        authorName,
        text: trimmed,
        createdAt: order.updatedAt || order.createdAt || new Date()
      });
    }
  }

  // Sort chronological: oldest first
  comments.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

  if (fulfillmentFilter) {
    const filter = String(fulfillmentFilter).toLowerCase();
    return comments.filter((c) => c.fulfillment === filter);
  }

  return comments;
}

/**
 * Migrates any legacy customerFeedback from order into order.comments array
 * on an active Mongoose Order document before saving new comments.
 */
function migrateLegacyFeedbackToComments(order) {
  if (!order) return;
  if (!Array.isArray(order.comments)) {
    order.comments = [];
  }

  let feedbackMap = {};
  if (order.customerFeedback instanceof Map) {
    feedbackMap = Object.fromEntries(order.customerFeedback);
  } else if (order.customerFeedback && typeof order.customerFeedback === 'object') {
    feedbackMap = order.customerFeedback;
  }

  for (const [fType, text] of Object.entries(feedbackMap)) {
    if (!text || typeof text !== 'string' || !text.trim()) continue;
    const trimmed = text.trim();
    const alreadyPresent = order.comments.some(
      (c) => c.fulfillment === fType && c.authorType === 'customer' && c.text.trim() === trimmed
    );
    if (!alreadyPresent) {
      const authorName = (order.customerSnapshot && [order.customerSnapshot.firstName, order.customerSnapshot.lastName].filter(Boolean).join(' '))
        || (order.customer && typeof order.customer === 'object' && [order.customer.firstName, order.customer.lastName].filter(Boolean).join(' '))
        || 'Customer';

      order.comments.push({
        _id: new mongoose.Types.ObjectId(),
        orderId: order._id,
        fulfillment: fType,
        authorType: 'customer',
        authorId: order.customer?._id || order.customer || order.customerId || null,
        authorName,
        text: trimmed,
        createdAt: order.updatedAt || order.createdAt || new Date()
      });
    }
  }
}

module.exports = {
  validateCommentText,
  getEffectiveOrderComments,
  migrateLegacyFeedbackToComments
};
