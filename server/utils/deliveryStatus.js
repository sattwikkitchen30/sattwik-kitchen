const { formatDateKey, getSubscriptionServiceDates, isServiceDay } = require('./tiffinPreparation');

function getOrderServiceDates(order) {
  if (!order?.subscriptionStartDate) return [];
  const calculatedDates = getSubscriptionServiceDates(order.subscriptionStartDate);
  const endDateKey = formatDateKey(order.subscriptionEndDate || calculatedDates.endDate);
  return calculatedDates.serviceDates
    .filter((date) => formatDateKey(date) <= endDateKey);
}

function getCurrentServiceDate(order, now = new Date()) {
  if (!isServiceDay(now)) return null;
  const todayKey = formatDateKey(now);
  return getOrderServiceDates(order).find((date) => formatDateKey(date) === todayKey) || null;
}

function resolveDeliveryStatus(order, now = new Date()) {
  const deliveryItem = (order?.items || []).find((item) => item.fulfillment === 'delivery');
  const status = String(order?.status || deliveryItem?.deliveryStatus || 'PENDING').toUpperCase();
  if (status === 'CANCELLED') return status;

  const serviceDates = getOrderServiceDates(order);
  const todayKey = formatDateKey(now);
  const currentIndex = serviceDates.findIndex((date) => formatDateKey(date) === todayKey);
  if (currentIndex <= 0 || !isServiceDay(now)) return status;

  const recordedDate = order.deliveryStatusDate
    || (status === 'DELIVERED' ? order.deliveredAt : null)
    || (status === 'OUT_FOR_DELIVERY' ? order.outForDeliveryAt : null)
    || (status === 'ACCEPTED' ? order.acceptedAt : null);
  const recordedDateKey = formatDateKey(recordedDate);
  return !recordedDateKey || recordedDateKey < todayKey ? 'ACCEPTED' : status;
}

function applyDeliveryStatus(order, status, now = new Date()) {
  order.status = status;
  (order.items || []).forEach((item) => {
    if (item.fulfillment === 'delivery') item.deliveryStatus = status;
  });
  const serviceDate = getCurrentServiceDate(order, now);
  if (serviceDate) order.deliveryStatusDate = serviceDate;
}

function withCurrentDeliveryStatus(order, now = new Date()) {
  if (!(order?.items || []).some((item) => item.fulfillment === 'delivery')) return order;
  const status = resolveDeliveryStatus(order, now);
  return {
    ...order,
    status,
    items: (order.items || []).map((item) => (
      item.fulfillment === 'delivery' ? { ...item, deliveryStatus: status } : item
    ))
  };
}

module.exports = {
  getOrderServiceDates,
  getCurrentServiceDate,
  resolveDeliveryStatus,
  applyDeliveryStatus,
  withCurrentDeliveryStatus
};
