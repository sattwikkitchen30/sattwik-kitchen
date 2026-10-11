const router = require('express').Router();
const Order = require('../models/Order');
const TiffinSubscription = require('../models/TiffinSubscription');
const { customerAuthRequired } = require('../middleware/customerAuth');
const { formatDateKey } = require('../utils/tiffinPreparation');
const { withCurrentDeliveryStatus } = require('../utils/deliveryStatus');
const { getOrderCustomer } = require('../utils/orderCustomer');
const { transitionOrderStatus } = require('../utils/orderStatus');
const { emitOrderUpdate } = require('../utils/orderEvents');

function serializeOrder(order) {
  const currentOrder = withCurrentDeliveryStatus(order);
  const customerOrder = { ...currentOrder };
  customerOrder.customer = getOrderCustomer(customerOrder);
  return {
    ...customerOrder,
    pickupDate: formatDateKey(customerOrder.pickupDate),
    subscriptionStartDate: formatDateKey(customerOrder.subscriptionStartDate),
    subscriptionEndDate: formatDateKey(customerOrder.subscriptionEndDate),
    deliveryStatusDate: formatDateKey(customerOrder.deliveryStatusDate)
  };
}

router.get('/', customerAuthRequired, async (req, res) => {
  const orders = await Order.find({ $or: [{ customer: req.customer._id }, { customerId: req.customer._id }] })
    .sort('-placedAt -createdAt')
    .populate('customer', 'firstName lastName phone email address area')
    .populate('deliveryMemberId', 'name phone')
    .lean();
  res.json({ orders: orders.map(serializeOrder) });
});

router.get('/:id', customerAuthRequired, async (req, res) => {
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

module.exports = router;
