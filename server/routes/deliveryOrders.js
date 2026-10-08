const router = require('express').Router();
const Order = require('../models/Order');
const { deliveryAuthRequired } = require('../middleware/deliveryAuth');
const { STATUS_TRANSITIONS } = require('../utils/constants');
const { emitOrderUpdate } = require('../utils/orderEvents');
const { getOrderServiceDates, getCurrentServiceDate, resolveDeliveryStatus, applyDeliveryStatus, withCurrentDeliveryStatus } = require('../utils/deliveryStatus');

router.get('/', deliveryAuthRequired, async (req, res) => {
  // Only show orders assigned to this delivery member
  const orders = await Order.find({
    deliveryMemberId: req.deliveryMember._id,
    status: { $in: ['PENDING', 'ACCEPTED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED'] },
    'items.fulfillment': 'delivery'
  }).populate('customer', 'firstName lastName phone email address area').lean();

  const deliveryOrders = orders.map((order) => {
    const items = (order.items || []).filter((item) => item.fulfillment === 'delivery');
    const currentOrder = withCurrentDeliveryStatus({ ...order, items });
    return {
      ...currentOrder,
      items: currentOrder.items,
      totalAmount: items.reduce((sum, item) => sum + Number(item.subtotal || 0), 0)
    };
  });

  const priority = { OUT_FOR_DELIVERY: 0, ACCEPTED: 1, DELIVERED: 2, CANCELLED: 3 };
  deliveryOrders.sort((a, b) => {
    const statusOrder = (priority[a.status] ?? 99) - (priority[b.status] ?? 99);
    if (statusOrder !== 0) return statusOrder;
    return new Date(b.updatedAt || b.acceptedAt || b.placedAt || b.createdAt) - new Date(a.updatedAt || a.acceptedAt || a.placedAt || a.createdAt);
  });
  res.json({ orders: deliveryOrders });
});

router.put('/:id/status', deliveryAuthRequired, async (req, res) => {
  const requested = String(req.body?.status || '').toUpperCase();
  if (!['OUT_FOR_DELIVERY', 'DELIVERED'].includes(requested)) {
    return res.status(400).json({ message: 'Invalid delivery status. Delivery members can only update to OUT_FOR_DELIVERY or DELIVERED.' });
  }

  const order = await Order.findById(req.params.id);
  if (!order || String(order.deliveryMemberId) !== String(req.deliveryMember._id)
    || !(order.items || []).some((item) => item.fulfillment === 'delivery')) {
    return res.status(409).json({ message: 'Order status or assignment has changed. Refresh the dashboard.' });
  }
  if (getOrderServiceDates(order).length && !getCurrentServiceDate(order)) {
    return res.status(400).json({ message: 'No delivery service is scheduled for today.' });
  }

  const currentStatus = resolveDeliveryStatus(order);
  if (STATUS_TRANSITIONS[currentStatus] !== requested) {
    return res.status(409).json({ message: 'Order status or assignment has changed. Refresh the dashboard.' });
  }
  applyDeliveryStatus(order, requested);
  if (requested === 'OUT_FOR_DELIVERY') order.outForDeliveryAt = new Date();
  else order.deliveredAt = new Date();
  await order.save();

  const populated = await Order.findById(order._id).populate('customer', 'firstName lastName phone email address area').populate('deliveryMemberId', 'name phone email').lean();
  emitOrderUpdate(req.app, populated);
  res.json({ message: `Order marked as ${requested}`, order: populated });
});

module.exports = router;
