const { formatDateKey } = require('./tiffinPreparation');
const { withCurrentDeliveryStatus } = require('./deliveryStatus');

function emitOrderUpdate(app, order) {
  const io = app.get('io');
  if (!io || !order) return;
  const orderData = typeof order.toObject === 'function' ? order.toObject() : order;
  const payload = {
    ...withCurrentDeliveryStatus(orderData),
    pickupDate: formatDateKey(orderData.pickupDate),
    subscriptionStartDate: formatDateKey(orderData.subscriptionStartDate),
    subscriptionEndDate: formatDateKey(orderData.subscriptionEndDate),
    deliveryStatusDate: formatDateKey(orderData.deliveryStatusDate)
  };
  const customerId = payload.customerId || payload.customer;
  if (customerId) io.to(`customer:${String(customerId)}`).emit('order:updated', payload);
  io.to('admin').emit('order:updated', payload);
  const memberId = payload.deliveryMemberId && (payload.deliveryMemberId._id || payload.deliveryMemberId);
  if (memberId) io.to(`delivery:${String(memberId)}`).emit('order:updated', payload);
}

module.exports = { emitOrderUpdate };
