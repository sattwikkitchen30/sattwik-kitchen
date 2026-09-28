function emitOrderUpdate(app, order) {
  const io = app.get('io');
  if (!io || !order) return;
  const payload = typeof order.toObject === 'function' ? order.toObject() : order;
  const customerId = payload.customerId || payload.customer;
  if (customerId) io.to(`customer:${String(customerId)}`).emit('order:updated', payload);
  io.to('admin').emit('order:updated', payload);
  const memberId = payload.deliveryMemberId && (payload.deliveryMemberId._id || payload.deliveryMemberId);
  if (memberId) io.to(`delivery:${String(memberId)}`).emit('order:updated', payload);
}

module.exports = { emitOrderUpdate };
