const mongoose = require('mongoose');
const { DateTime } = require('luxon');
const { addDays, endOfDay, formatDateKey, isServiceDay, startOfDay, getSubscriptionServiceDates } = require('./tiffinPreparation');
const { getCurrentServiceDate, getOrderServiceDates } = require('./deliveryStatus');
const { emitOrderUpdate } = require('./orderEvents');

const BUSINESS_TIMEZONE = process.env.BUSINESS_TIMEZONE || 'America/Vancouver';

async function expireSubscriptionOrders(Order, { now = new Date(), app } = {}) {
  const todayKey = formatDateKey(now);
  if (!todayKey) return 0;

  const query = {
    status: { $nin: ['CANCELLED', 'EXPIRED'] },
    $or: [
      { type: 'tiffin' },
      { 'items.fulfillment': 'delivery' },
      { fulfillment: 'delivery' },
      { 'tiffinPlan.packageType': { $exists: true, $ne: null } }
    ]
  };

  const findResult = Order.find(query);
  const candidates = typeof findResult?.lean === 'function'
    ? await findResult.lean()
    : await findResult;

  let expiredCount = 0;
  for (const order of candidates || []) {
    const items = Array.isArray(order.items) ? order.items : [];
    const isPickupOnly = (items.length > 0 && items.every((i) => i.fulfillment === 'pickup'))
      || (order.fulfillment === 'pickup' && !items.some((i) => i.fulfillment === 'delivery'));
    if (isPickupOnly) continue;

    const serviceDates = getOrderServiceDates(order);
    const endDate = order.subscriptionEndDate
      || (serviceDates.length ? serviceDates[serviceDates.length - 1] : null)
      || (order.subscriptionStartDate ? getSubscriptionServiceDates(order.subscriptionStartDate).endDate : null);
    const endDateKey = endDate ? formatDateKey(endDate) : null;

    if (endDateKey && todayKey >= endDateKey) {
      const hasDeliveryItems = items.some((i) => i.fulfillment === 'delivery');
      const isDelivered = order.status === 'DELIVERED' || items.find((i) => i.fulfillment === 'delivery')?.deliveryStatus === 'DELIVERED';

      const updateSet = {
        status: 'EXPIRED'
      };
      if (hasDeliveryItems) {
        updateSet['items.$[delivery].deliveryStatus'] = isDelivered ? 'DELIVERED' : 'EXPIRED';
      }

      const options = {
        new: true,
        runValidators: true
      };
      if (hasDeliveryItems) {
        options.arrayFilters = [{ 'delivery.fulfillment': 'delivery' }];
      }

      const updateQuery1 = Order.findOneAndUpdate(
        {
          _id: order._id,
          status: { $nin: ['CANCELLED', 'EXPIRED'] }
        },
        { $set: updateSet },
        options
      );
      const updated = typeof updateQuery1?.lean === 'function' ? await updateQuery1.lean() : await updateQuery1;

      if (updated) {
        expiredCount += 1;
        if (mongoose.connection && mongoose.connection.readyState === 1) {
          try {
            const TiffinSubscription = mongoose.models.TiffinSubscription || require('../models/TiffinSubscription');
            await TiffinSubscription.updateMany(
              { orderId: order._id, status: { $ne: 'CANCELLED' } },
              { $set: { status: 'EXPIRED' } }
            );
          } catch {
            // ignore if model not loaded
          }
        }
        if (app) {
          const updatedDoc = typeof updated.toObject === 'function' ? updated.toObject() : updated;
          emitOrderUpdate(app, updatedDoc);
        }
      }
    }
  }

  return expiredCount;
}

async function resetDeliveredOrders(Order, { now = new Date(), app } = {}) {
  await expireSubscriptionOrders(Order, { now, app });

  if (!isServiceDay(now)) return 0;
  const today = startOfDay(now);
  const todayKey = formatDateKey(today);
  const candidates = await Order.find({
    type: 'tiffin',
    status: { $in: ['DELIVERED', 'delivered'] },
    'items.fulfillment': 'delivery',
    subscriptionStartDate: { $lte: endOfDay(now) },
    $and: [
      { $or: [{ subscriptionEndDate: { $gte: today } }, { subscriptionEndDate: null }] },
      { $or: [
        { deliveryStatusDate: { $lt: today } },
        { deliveryStatusDate: null }
      ] }
    ],
  }).lean();

  let resetCount = 0;
  for (const order of candidates) {
    const serviceDate = getCurrentServiceDate(order, now);
    if (!serviceDate || formatDateKey(serviceDate) !== todayKey) continue;

    // Check if this is the final service day or past it
    const endDate = order.subscriptionEndDate;
    const endDateKey = endDate ? formatDateKey(endDate) : null;
    const isFinalDay = endDateKey && todayKey >= endDateKey;

    // If this is the final service day (or past it) and it's delivered, mark subscription as expired
    // instead of resetting to ACCEPTED
    if (isFinalDay) {
      const updateQuery2 = Order.findOneAndUpdate({
        _id: order._id,
        status: order.status,
        deliveryStatusDate: order.deliveryStatusDate ?? null
      }, {
        $set: {
          status: 'EXPIRED',
          deliveryStatusDate: today,
          'items.$[delivery].deliveryStatus': 'DELIVERED'
        }
      }, {
        new: true,
        runValidators: true,
        arrayFilters: [{ 'delivery.fulfillment': 'delivery' }]
      });
      const updatedOrder = typeof updateQuery2?.lean === 'function' ? await updateQuery2.lean() : await updateQuery2;
      if (!updatedOrder) continue;
      resetCount += 1;
      if (app) emitOrderUpdate(app, updatedOrder);
      continue;
    }

    const updateQuery3 = Order.findOneAndUpdate({
      _id: order._id,
      status: order.status,
      deliveryStatusDate: order.deliveryStatusDate ?? null
    }, {
      $set: {
        status: 'ACCEPTED',
        acceptedAt: now,
        deliveryStatusDate: today,
        'items.$[delivery].deliveryStatus': 'ACCEPTED'
      }
    }, {
      new: true,
      runValidators: true,
      arrayFilters: [{ 'delivery.fulfillment': 'delivery' }]
    });
    const updatedOrder = typeof updateQuery3?.lean === 'function' ? await updateQuery3.lean() : await updateQuery3;
    if (!updatedOrder) continue;
    resetCount += 1;
    if (app) emitOrderUpdate(app, updatedOrder);
  }
  return resetCount;
}

function startDailyDeliveryReset(Order, app, { now = () => new Date(), setTimeoutFn = setTimeout } = {}) {
  let timer;
  let stopped = false;
  const run = async () => {
    if (stopped) return;
    try {
      const currentTime = now();
      const expiredCount = await expireSubscriptionOrders(Order, { now: currentTime, app });
      if (expiredCount) console.info(`[sattwik] expired ${expiredCount} subscription(s) for ${formatDateKey(currentTime)}`);
      const resetCount = await resetDeliveredOrders(Order, { now: currentTime, app });
      if (resetCount) console.info(`[sattwik] reset ${resetCount} delivered subscription(s) for ${formatDateKey(currentTime)}`);
    } catch (error) {
      console.error('[sattwik] daily delivery reset failed:', error.message);
    }
    if (stopped) return;
    const currentTime = now();
    const vancouverNow = DateTime.fromJSDate(currentTime).setZone(BUSINESS_TIMEZONE);
    let nextServiceDay = vancouverNow.plus({ days: 1 }).startOf('day');
    while (!isServiceDay(nextServiceDay.toJSDate())) {
      nextServiceDay = nextServiceDay.plus({ days: 1 });
    }
    const nextRun = nextServiceDay.set({ second: 5, millisecond: 0 }).toJSDate();
    timer = setTimeoutFn(run, Math.max(1000, nextRun.getTime() - currentTime.getTime()));
    timer.unref?.();
  };
  run();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}

module.exports = { expireSubscriptionOrders, resetDeliveredOrders, startDailyDeliveryReset };
