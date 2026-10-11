const { STATUS_TRANSITIONS } = require('./constants');
const { getOrderServiceDates, getCurrentServiceDate, resolveDeliveryStatus } = require('./deliveryStatus');
const { getSubscriptionServiceDates } = require('./tiffinPreparation');

const LEGACY_STATUS = {
  PENDING: 'PENDING',
  pending: 'PENDING',
  ACCEPTED: 'ACCEPTED',
  confirmed: 'ACCEPTED',
  preparing: 'ACCEPTED',
  ready: 'ACCEPTED',
  OUT_FOR_DELIVERY: 'OUT_FOR_DELIVERY',
  DELIVERED: 'DELIVERED',
  delivered: 'DELIVERED',
  CANCELLED: 'CANCELLED',
  cancelled: 'CANCELLED'
};

function normalizeStatus(status) {
  return LEGACY_STATUS[status] || LEGACY_STATUS[String(status || '').toUpperCase()] || String(status || '').toUpperCase();
}

function getPickupStatus(order) {
  const items = order.items || [];
  const pickupItems = items.filter((entry) => entry.fulfillment === 'pickup');
  const defaultStatus = items.some((entry) => entry.fulfillment === 'delivery')
    ? 'PENDING'
    : normalizeStatus(order.status || 'PENDING');
  const itemStatuses = pickupItems.map((entry) => normalizeStatus(entry.deliveryStatus || defaultStatus));
  const itemStatus = itemStatuses[0] || 'PENDING';
  if (pickupItems.length && !items.some((entry) => entry.fulfillment === 'delivery')) {
    const orderStatus = normalizeStatus(order.status);
    if (itemStatuses.includes('DELIVERED') || orderStatus === 'DELIVERED') return 'DELIVERED';
    if (itemStatuses.includes('CANCELLED') || orderStatus === 'CANCELLED') return 'CANCELLED';
  }
  if (itemStatuses.includes('DELIVERED')) return 'DELIVERED';
  if (itemStatuses.includes('CANCELLED')) return 'CANCELLED';
  return itemStatus;
}

function getTransition(order, requested, fulfillment, now, actor) {
  const pickupItems = (order.items || []).filter((item) => item.fulfillment === 'pickup');
  const deliveryItems = (order.items || []).filter((item) => item.fulfillment === 'delivery');
  const isPickupOnly = pickupItems.length > 0 && deliveryItems.length === 0;
  const scope = fulfillment || (isPickupOnly ? 'pickup' : 'delivery');
  const current = scope === 'pickup' ? getPickupStatus(order) : resolveDeliveryStatus(order, now);
  const orderCancelled = normalizeStatus(order.status) === 'CANCELLED';
  const anyFulfillmentDelivered = (
    (pickupItems.length > 0 && getPickupStatus(order) === 'DELIVERED')
    || (deliveryItems.length > 0 && resolveDeliveryStatus(order, now) === 'DELIVERED')
  );

  if (!['pickup', 'delivery'].includes(scope)) {
    return { error: { status: 400, message: 'Fulfillment must be pickup or delivery.' } };
  }
  if (scope === 'pickup' && !pickupItems.length) {
    return { error: { status: 400, message: 'Order has no pickup items.' } };
  }
  if (scope === 'delivery' && !deliveryItems.length) {
    return { error: { status: 400, message: 'Order has no delivery items.' } };
  }
  if (orderCancelled || current === 'CANCELLED') {
    return { error: { status: 409, message: 'Cancelled orders cannot be changed.' } };
  }
  if (requested === 'CANCELLED' && (order.firstDeliveredAt || order.deliveredAt)) {
    return { error: { status: 409, message: 'An order that has been delivered cannot be cancelled.' } };
  }
  if (current === 'DELIVERED' || (requested === 'CANCELLED' && anyFulfillmentDelivered)) {
    return { error: { status: 409, message: 'Delivered orders cannot be changed or cancelled.' } };
  }
  if (requested === 'CANCELLED') {
    return { current, scope, pickupItems, deliveryItems, isPickupOnly, cancellation: true };
  }

  if (scope === 'pickup') {
    if (actor !== 'admin') {
      return { error: { status: 403, message: 'Only an admin can change pickup status.' } };
    }
    if (!['PENDING', 'ACCEPTED', 'DELIVERED'].includes(requested)) {
      return { error: { status: 400, message: 'Pickup status must be Pending, Accepted, or Delivered.' } };
    }
    return { current, scope, pickupItems, deliveryItems, isPickupOnly, flexiblePickup: true };
  }

  const next = STATUS_TRANSITIONS[current];
  if (next !== requested) {
    return { error: { status: 400, message: `Invalid transition from ${current} to ${requested}.` } };
  }
  if (scope === 'delivery' && requested === 'OUT_FOR_DELIVERY' && !order.deliveryMemberId) {
    return { error: { status: 400, message: 'Choose a delivery member.' } };
  }

  const serviceDates = getOrderServiceDates(order);
  const currentServiceDate = getCurrentServiceDate(order, now);
  if (scope === 'delivery' && serviceDates.length && !currentServiceDate) {
    return { error: { status: 400, message: 'No delivery service is scheduled for today.' } };
  }
  return { current, scope, pickupItems, deliveryItems, isPickupOnly, currentServiceDate };
}

async function transitionOrderStatus(Order, order, requestedStatus, options = {}) {
  const requested = normalizeStatus(requestedStatus);
  const now = options.now || new Date();
  const transition = getTransition(order, requested, options.fulfillment, now, options.actor);
  if (transition.error) return transition;
  if (options.actor === 'delivery' && !['OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED'].includes(requested)) {
    return { error: { status: 400, message: 'Delivery members cannot set this status.' } };
  }
  if (requested === 'ACCEPTED' && options.actor === 'delivery') {
    return { error: { status: 400, message: 'Only an admin can accept an order.' } };
  }

  const filter = {
    _id: order._id,
    status: order.status,
    deliveryStatusDate: order.deliveryStatusDate ?? null,
    ...(options.accessFilter || {})
  };
  if (transition.scope === 'pickup' && transition.pickupItems.length) {
    filter.items = {
      $elemMatch: {
        fulfillment: 'pickup',
        deliveryStatus: transition.pickupItems[0].deliveryStatus ?? null
      }
    };
  }
  const update = { $set: {} };
  if (transition.cancellation) {
    update.$set.status = 'CANCELLED';
    update.$set.cancelledAt = now;
    update.$set['items.$[item].deliveryStatus'] = 'CANCELLED';
  } else {
    if (transition.scope === 'delivery' || transition.isPickupOnly) update.$set.status = requested;
    if (transition.scope === 'pickup') update.$set['items.$[item].deliveryStatus'] = requested;
    else update.$set['items.$[item].deliveryStatus'] = requested;
    if (transition.currentServiceDate) update.$set.deliveryStatusDate = transition.currentServiceDate;
    if (requested === 'ACCEPTED') {
      update.$set.acceptedAt = now;
      if (transition.scope === 'delivery' && order.type === 'tiffin' && !order.subscriptionStartDate) {
        const dates = getSubscriptionServiceDates(now);
        update.$set.subscriptionStartDate = dates.startDate;
        update.$set.subscriptionEndDate = dates.endDate;
      }
    }
    if (requested === 'OUT_FOR_DELIVERY') update.$set.outForDeliveryAt = now;
    if (requested === 'DELIVERED') {
      if (transition.scope === 'delivery' || transition.isPickupOnly) {
        update.$set.deliveredAt = now;
        update.$set.firstDeliveredAt = order.firstDeliveredAt || order.deliveredAt || now;
      }
    }
  }

  const itemFulfillment = transition.cancellation ? null : transition.scope;
  const optionsForUpdate = {
    new: true,
    runValidators: true,
    arrayFilters: itemFulfillment
      ? [{ 'item.fulfillment': itemFulfillment }]
      : [{ 'item.fulfillment': { $in: ['pickup', 'delivery'] } }]
  };
  const operation = Order.findOneAndUpdate(filter, update, optionsForUpdate);
  const updatedOrder = typeof operation.lean === 'function' ? await operation.lean() : await operation;
  if (!updatedOrder) return { error: { status: 409, message: 'Order status or assignment has changed. Refresh and try again.' } };
  return { order: updatedOrder, current: transition.current, scope: transition.scope, cancellation: transition.cancellation };
}

module.exports = { normalizeStatus, getPickupStatus, transitionOrderStatus };
