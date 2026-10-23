const router = require('express').Router();
const Order = require('../models/Order');
const TiffinSubscription = require('../models/TiffinSubscription');
const { customerAuthRequired } = require('../middleware/customerAuth');
const { formatDateKey } = require('../utils/tiffinPreparation');
const { withCurrentDeliveryStatus } = require('../utils/deliveryStatus');
const { expireSubscriptionOrders } = require('../utils/dailyDeliveryReset');
const { getOrderCustomer } = require('../utils/orderCustomer');
const { transitionOrderStatus } = require('../utils/orderStatus');
const { emitOrderUpdate } = require('../utils/orderEvents');
const mongoose = require('mongoose');
const { getEffectiveOrderComments, migrateLegacyFeedbackToComments, validateCommentText } = require('../utils/orderComments');

function serializeOrder(order) {
  const currentOrder = withCurrentDeliveryStatus(order);
  const customerOrder = { ...currentOrder };
  customerOrder.customer = getOrderCustomer(customerOrder);
  return {
    ...customerOrder,
    pickupDate: formatDateKey(customerOrder.pickupDate),
    subscriptionStartDate: formatDateKey(customerOrder.subscriptionStartDate),
    subscriptionEndDate: formatDateKey(customerOrder.subscriptionEndDate),
    deliveryStatusDate: formatDateKey(customerOrder.deliveryStatusDate),
    customerFeedback: customerOrder.customerFeedback
      ? (customerOrder.customerFeedback instanceof Map
          ? Object.fromEntries(customerOrder.customerFeedback)
          : customerOrder.customerFeedback)
      : {},
    comments: getEffectiveOrderComments(customerOrder)
  };
}

router.get('/', customerAuthRequired, async (req, res) => {
  try { await expireSubscriptionOrders(Order, { now: new Date(), app: req.app }); } catch (e) { /* ignore */ }
  const orders = await Order.find({ $or: [{ customer: req.customer._id }, { customerId: req.customer._id }] })
    .sort('-placedAt -createdAt')
    .populate('customer', 'firstName lastName phone email address area')
    .populate('deliveryMemberId', 'name phone')
    .lean();
  res.json({ orders: orders.map(serializeOrder) });
});

router.get('/:id', customerAuthRequired, async (req, res) => {
  try { await expireSubscriptionOrders(Order, { now: new Date(), app: req.app }); } catch (e) { /* ignore */ }
  const order = await Order.findOne({
    _id: req.params.id,
    $or: [{ customer: req.customer._id }, { customerId: req.customer._id }]
  }).populate('customer', 'firstName lastName phone email address area').populate('deliveryMemberId', 'name phone').lean();
  if (!order) return res.status(404).json({ message: 'Order not found' });
  res.json({ order: serializeOrder(order) });
});

router.put('/:id/cancel', customerAuthRequired, async (req, res) => {
  const order = await Order.findOne({
    _id: req.params.id,
    $or: [{ customer: req.customer._id }, { customerId: req.customer._id }]
  }).lean();
  if (!order) return res.status(404).json({ message: 'Order not found.' });

  const result = await transitionOrderStatus(Order, order, 'CANCELLED', {
    actor: 'customer',
    accessFilter: { $or: [{ customer: req.customer._id }, { customerId: req.customer._id }] }
  });
  if (result.error) return res.status(result.error.status).json({ message: result.error.message });
  if (result.order.type === 'tiffin') {
    await TiffinSubscription.updateMany({ orderId: result.order._id }, { $set: { status: 'CANCELLED' } });
  }

  const populated = await Order.findById(result.order._id)
    .populate('customer', 'firstName lastName phone email address area')
    .populate('deliveryMemberId', 'name phone email')
    .lean();
  emitOrderUpdate(req.app, populated);
  res.json({ message: 'Order cancelled.', order: serializeOrder(populated) });
});

router.put('/:id/feedback', customerAuthRequired, async (req, res) => {
  const { type, text } = req.body || {};
  const VALID_TYPES = ['pickup', 'delivery'];
  if (!VALID_TYPES.includes(type)) {
    return res.status(400).json({ message: 'Component type must be pickup or delivery.' });
  }
  const trimmed = String(text ?? '').trim();
  if (!trimmed) {
    return res.status(400).json({ message: 'Feedback text cannot be empty.' });
  }
  if (trimmed.length > 1000) {
    return res.status(400).json({ message: 'Feedback must be 1,000 characters or fewer.' });
  }

  const order = await Order.findOne({
    _id: req.params.id,
    $or: [{ customer: req.customer._id }, { customerId: req.customer._id }]
  });
  if (!order) return res.status(404).json({ message: 'Order not found.' });

  migrateLegacyFeedbackToComments(order);

  const customerName = [req.customer.firstName, req.customer.lastName].filter(Boolean).join(' ') || 'Customer';
  const newComment = {
    _id: new mongoose.Types.ObjectId(),
    orderId: order._id,
    fulfillment: type,
    authorType: 'customer',
    authorId: req.customer._id,
    authorName: customerName,
    text: trimmed,
    createdAt: new Date()
  };
  order.comments.push(newComment);

  if (!order.customerFeedback) order.customerFeedback = new Map();
  order.customerFeedback.set(type, trimmed);
  order.markModified('customerFeedback');
  order.markModified('comments');
  await order.save();

  emitOrderUpdate(req.app, order);

  res.json({
    message: 'Feedback saved.',
    feedback: { type, text: trimmed },
    comment: newComment,
    comments: getEffectiveOrderComments(order, type)
  });
});


router.get('/:id/comments', customerAuthRequired, async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(400).json({ message: 'Invalid order ID.' });
  }
  const order = await Order.findOne({
    _id: req.params.id,
    $or: [{ customer: req.customer._id }, { customerId: req.customer._id }]
  }).lean();
  if (!order) return res.status(404).json({ message: 'Order not found.' });

  const fulfillment = req.query.type || req.query.fulfillment;
  const comments = getEffectiveOrderComments(order, fulfillment);
  res.json({ comments });
});

router.post('/:id/comments', customerAuthRequired, async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(400).json({ message: 'Invalid order ID.' });
  }
  const order = await Order.findOne({
    _id: req.params.id,
    $or: [{ customer: req.customer._id }, { customerId: req.customer._id }]
  });
  if (!order) return res.status(404).json({ message: 'Order not found.' });

  const fulfillment = String(req.body?.type || req.body?.fulfillment || (order.fulfillment === 'pickup' ? 'pickup' : 'delivery')).toLowerCase();
  if (!['pickup', 'delivery'].includes(fulfillment)) {
    return res.status(400).json({ message: 'Component type must be pickup or delivery.' });
  }

  const validation = validateCommentText(req.body?.text);
  if (validation.error) {
    return res.status(400).json({ message: validation.error });
  }

  migrateLegacyFeedbackToComments(order);

  const customerName = [req.customer.firstName, req.customer.lastName].filter(Boolean).join(' ') || 'Customer';
  const newComment = {
    _id: new mongoose.Types.ObjectId(),
    orderId: order._id,
    fulfillment,
    authorType: 'customer',
    authorId: req.customer._id,
    authorName: customerName,
    text: validation.trimmed,
    createdAt: new Date()
  };

  order.comments.push(newComment);
  if (!order.customerFeedback) order.customerFeedback = new Map();
  order.customerFeedback.set(fulfillment, validation.trimmed);
  order.markModified('customerFeedback');
  order.markModified('comments');
  await order.save();

  emitOrderUpdate(req.app, order);

  res.status(201).json({
    message: 'Comment added.',
    comment: order.comments[order.comments.length - 1],
    comments: getEffectiveOrderComments(order, fulfillment)
  });
});

module.exports = router;
