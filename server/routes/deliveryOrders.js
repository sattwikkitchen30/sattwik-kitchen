const router = require('express').Router();
const Order = require('../models/Order');
const { deliveryAuthRequired } = require('../middleware/deliveryAuth');
const { emitOrderUpdate } = require('../utils/orderEvents');
const { getOrderServiceDates, getCurrentServiceDate, withCurrentDeliveryStatus } = require('../utils/deliveryStatus');
const { getOrderCustomer } = require('../utils/orderCustomer');
const { transitionOrderStatus } = require('../utils/orderStatus');
const TiffinSubscription = require('../models/TiffinSubscription');

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
      customer: getOrderCustomer(currentOrder),
      deliveryAddress: currentOrder.customerSnapshot
        ? currentOrder.customerSnapshot.address || currentOrder.customerSnapshot.area || ''
        : currentOrder.deliveryAddress || currentOrder.customer?.address || currentOrder.customer?.area || '',
      items: currentOrder.items,
      totalAmount: items.reduce((sum, item) => sum + Number(item.subtotal || 0), 0)
    };
  });
  const activeOrders = deliveryOrders.filter((order) => {
    if (order.status === 'CANCELLED') return false;
    if (getOrderServiceDates(order).length && !getCurrentServiceDate(order)) return false;
    return true;
  });

  const priority = { OUT_FOR_DELIVERY: 0, ACCEPTED: 1, DELIVERED: 2, CANCELLED: 3 };
  activeOrders.sort((a, b) => {
    const statusOrder = (priority[a.status] ?? 99) - (priority[b.status] ?? 99);
    if (statusOrder !== 0) return statusOrder;
    return new Date(b.updatedAt || b.acceptedAt || b.placedAt || b.createdAt) - new Date(a.updatedAt || a.acceptedAt || a.placedAt || a.createdAt);
  });
  res.json({ orders: activeOrders });
});

router.put('/:id/status', deliveryAuthRequired, async (req, res) => {
  const requested = String(req.body?.status || '').toUpperCase();
  if (!['OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED'].includes(requested)) {
    return res.status(400).json({ message: 'Delivery members can update status to Out for Delivery, Delivered, or Cancelled.' });
  }

  const order = await Order.findById(req.params.id);
  if (!order || String(order.deliveryMemberId) !== String(req.deliveryMember._id)
    || !(order.items || []).some((item) => item.fulfillment === 'delivery')) {
    return res.status(409).json({ message: 'Order status or assignment has changed. Refresh the dashboard.' });
  }
  if (requested !== 'CANCELLED' && getOrderServiceDates(order).length && !getCurrentServiceDate(order)) {
    return res.status(400).json({ message: 'No delivery service is scheduled for today.' });
  }
  const result = await transitionOrderStatus(Order, order, requested, {
    actor: 'delivery',
    accessFilter: { deliveryMemberId: req.deliveryMember._id }
  });
  if (result.error) return res.status(result.error.status).json({ message: result.error.message });
  if (requested === 'CANCELLED' && result.order.type === 'tiffin') {
    await TiffinSubscription.updateMany({ orderId: result.order._id }, { $set: { status: 'CANCELLED' } });
  }

  const populated = await Order.findById(order._id).populate('customer', 'firstName lastName phone email address area').populate('deliveryMemberId', 'name phone email').lean();
  populated.customer = getOrderCustomer(populated);
  populated.deliveryAddress = populated.customerSnapshot
    ? populated.customerSnapshot.address || populated.customerSnapshot.area || ''
    : populated.deliveryAddress || populated.customer.address || populated.customer.area || '';
  emitOrderUpdate(req.app, populated);
  res.json({ message: requested === 'CANCELLED' ? 'Order cancelled.' : `Order marked as ${requested}`, order: populated });
});

module.exports = router;
