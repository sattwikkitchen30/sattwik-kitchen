const router = require('express').Router();
const Order = require('../models/Order');
const { deliveryAuthRequired } = require('../middleware/deliveryAuth');
const { STATUS_TRANSITIONS } = require('../utils/constants');
const { emitOrderUpdate } = require('../utils/orderEvents');

router.get('/', deliveryAuthRequired, async (req, res) => {
  // Only show orders assigned to this delivery member
  const orders = await Order.find({
    deliveryMemberId: req.deliveryMember._id,
    status: { $in: ['ACCEPTED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED'] },
    'items.fulfillment': 'delivery'
  }).populate('customer', 'firstName lastName phone email address area').lean();

  const deliveryOrders = orders.map((order) => {
    const items = (order.items || []).filter((item) => item.fulfillment === 'delivery');
    return {
      ...order,
      items,
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

  const currentStatus = requested === 'OUT_FOR_DELIVERY' ? 'ACCEPTED' : 'OUT_FOR_DELIVERY';
  const order = await Order.findOneAndUpdate(
    { _id: req.params.id, status: currentStatus, deliveryMemberId: req.deliveryMember._id, 'items.fulfillment': 'delivery' },
    {
      $set: {
        status: requested,
        ...(requested === 'OUT_FOR_DELIVERY' ? { outForDeliveryAt: new Date() } : { deliveredAt: new Date() }),
        'items.$[deliveryItem].deliveryStatus': requested
      }
    },
    { new: true, runValidators: true, arrayFilters: [{ 'deliveryItem.fulfillment': 'delivery' }] }
  );
  
  if (!order) return res.status(409).json({ message: 'Order status or assignment has changed. Refresh the dashboard.' });

  const populated = await Order.findById(order._id).populate('customer', 'firstName lastName phone email address area').populate('deliveryMemberId', 'name phone email').lean();
  emitOrderUpdate(req.app, populated);
  res.json({ message: `Order marked as ${requested}`, order: populated });
});

module.exports = router;
