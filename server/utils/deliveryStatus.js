const { DateTime } = require('luxon');
const { formatDateKey, getSubscriptionServiceDates, isServiceDay, startOfDay } = require('./tiffinPreparation');

function getOrderServiceDates(order) {
  if (!order?.subscriptionStartDate) return [];
  const calculatedDates = getSubscriptionServiceDates(order.subscriptionStartDate);
  const endDateKey = formatDateKey(order.subscriptionEndDate || calculatedDates.endDate);
  return calculatedDates.serviceDates
    .filter((date) => formatDateKey(date) <= endDateKey);
}

function getCurrentServiceDate(order, now = new Date()) {
  if (!order?.subscriptionStartDate || !isServiceDay(now)) return null;
  const todayKey = formatDateKey(now);
  const startKey = formatDateKey(order.subscriptionStartDate);
  if (!todayKey || !startKey || todayKey < startKey) return null;
  const endDate = order.subscriptionEndDate || getSubscriptionServiceDates(order.subscriptionStartDate).endDate;
  const endKey = formatDateKey(endDate);
  if (endKey && todayKey > endKey) return null;
  return startOfDay(now);
}

function resolveDeliveryStatus(order, now = new Date()) {
  const deliveryItem = (order?.items || []).find((item) => item.fulfillment === 'delivery');
  const status = String(order?.status || deliveryItem?.deliveryStatus || 'PENDING').toUpperCase();
  if (status === 'CANCELLED' || status === 'EXPIRED') return status;

  const serviceDates = getOrderServiceDates(order);
  const isSubscription = order?.type === 'tiffin' || Boolean(order?.tiffinPlan?.packageType) || (order?.items || []).some((i) => i.fulfillment === 'delivery');
  const endDate = order?.subscriptionEndDate || (serviceDates.length ? serviceDates[serviceDates.length - 1] : null);
  const endDateKey = endDate ? formatDateKey(endDate) : null;
  const todayKey = formatDateKey(now);
  if (isSubscription && endDateKey && todayKey >= endDateKey && status !== 'DELIVERED') {
    return 'EXPIRED';
  }

  if (status === 'PENDING') return status;

  if (order?.type !== 'tiffin') return status;
  const currentIndex = serviceDates.findIndex((date) => formatDateKey(date) === todayKey);
  if (currentIndex < 0 || !isServiceDay(now)) return status;

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

function isTiffinPreparationEligible(order, serviceDate) {
  if (!order || String(order.status || '').toUpperCase() === 'CANCELLED') return false;
  if (!isServiceDay(serviceDate)) return false;

  const items = Array.isArray(order.items) ? order.items : [];
  const hasDelivery = (order.fulfillment === 'delivery' || order.fulfillment === 'mixed' || order.type === 'tiffin' || Boolean(order.packageType))
    && (items.length === 0 || items.some((item) => (item.fulfillment || order.fulfillment) === 'delivery'));
  if (!hasDelivery) return false;

  const serviceDates = getOrderServiceDates(order);
  if (serviceDates.length > 0) {
    const serviceKey = formatDateKey(serviceDate);
    if (!serviceDates.some((date) => formatDateKey(date) === serviceKey)) return false;
  }
  return ['ACCEPTED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'EXPIRED'].includes(resolveDeliveryStatus(order, serviceDate));
}

function filterTiffinPreparationSubscriptions(subscriptions, serviceDate) {
  return (subscriptions || []).filter((entry) => {
    const order = (entry?.orderId && typeof entry.orderId === 'object') ? entry.orderId : entry;
    return isTiffinPreparationEligible(order, serviceDate);
  });
}

module.exports = {
  getOrderServiceDates,
  getCurrentServiceDate,
  resolveDeliveryStatus,
  applyDeliveryStatus,
  withCurrentDeliveryStatus,
  isTiffinPreparationEligible,
  filterTiffinPreparationSubscriptions
};
