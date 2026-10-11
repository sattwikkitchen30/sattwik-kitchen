const { addDays, endOfDay, formatDateKey, isServiceDay, startOfDay } = require('./tiffinPreparation');
const { getCurrentServiceDate } = require('./deliveryStatus');
const { emitOrderUpdate } = require('./orderEvents');

async function resetDeliveredOrders(Order, { now = new Date(), app } = {}) {
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

    const updatedOrder = await Order.findOneAndUpdate({
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
    }).lean();
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
      const resetCount = await resetDeliveredOrders(Order, { now: currentTime, app });
      if (resetCount) console.info(`[sattwik] reset ${resetCount} delivered subscription(s) for ${formatDateKey(currentTime)}`);
    } catch (error) {
      console.error('[sattwik] daily delivery reset failed:', error.message);
    }
    if (stopped) return;
    const currentTime = now();
    const nextRun = addDays(startOfDay(currentTime), 1);
    nextRun.setSeconds(5, 0);
    timer = setTimeoutFn(run, Math.max(1000, nextRun.getTime() - currentTime.getTime()));
    timer.unref?.();
  };
  run();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}

module.exports = { resetDeliveredOrders, startDailyDeliveryReset };
