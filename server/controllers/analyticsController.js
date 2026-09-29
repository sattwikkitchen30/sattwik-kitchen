const Order = require('../models/Order');
const Customer = require('../models/Customer');
const Product = require('../models/Product');
const TiffinSubscription = require('../models/TiffinSubscription');
const TiffinMenuSelection = require('../models/TiffinMenuSelection');
const { REVENUE_STATUSES, dateMatch, TIFFIN_MENU_BY_WEEKDAY } = require('../utils/constants');
const { parseDateInput, formatDateKey, getWeekdayName, getMenuForDate, dateLabel, startOfDay, endOfDay, buildPreparationTotals, buildActivePlanCounts, syncExpiredTiffinSubscriptions } = require('../utils/tiffinPreparation');

const money = (n) => Math.round((n || 0) * 100) / 100;

function basePipeline(query = {}) {
  const match = { ...dateMatch(query) };
  if (query.status) match.status = query.status;
  if (query.type) match.type = query.type;

  const pipe = [
    { $lookup: { from: 'customers', localField: 'customer', foreignField: '_id', as: 'customerDoc' } },
    { $unwind: '$customerDoc' }
  ];

  if (Object.keys(match).length) {
    pipe.push({ $match: match });
  }
  return pipe;
}

async function overview(req, res) {
  const pipe = basePipeline(req.query);
  const [agg] = await Order.aggregate([
    ...pipe,
    {
      $group: {
        _id: null,
        totalOrders: { $sum: 1 },
        totalRevenue: { $sum: { $cond: [{ $in: ['$status', REVENUE_STATUSES] }, '$totalAmount', 0] } },
        pending: { $sum: { $cond: [{ $in: ['$status', ['PENDING', 'pending']] }, 1, 0] } },
        confirmed: { $sum: { $cond: [{ $in: ['$status', ['ACCEPTED', 'confirmed']] }, 1, 0] } },
        delivered: { $sum: { $cond: [{ $in: ['$status', ['DELIVERED', 'delivered']] }, 1, 0] } },
        cancelled: { $sum: { $cond: [{ $in: ['$status', ['CANCELLED', 'cancelled']] }, 1, 0] } },
        itemsQty: { $sum: { $sum: '$items.quantity' } }
      }
    }
  ]);

  const productCount = await Product.countDocuments();
  const activeProducts = await Product.countDocuments({ active: true });
  const lowStock = await Product.countDocuments({ $expr: { $and: [{ $gt: ['$stock', 0] }, { $lte: ['$stock', '$lowStockThreshold'] }] } });
  const outOfStock = await Product.countDocuments({ stock: 0 });

  const customerAgg = await Customer.aggregate([
    { $lookup: { from: 'orders', localField: '_id', foreignField: 'customer', as: 'orders' } },
    {
      $project: {
        totalOrders: { $size: '$orders' },
        firstOrder: { $min: '$orders.createdAt' }
      }
    },
    {
      $group: {
        _id: null,
        totalCustomers: { $sum: 1 },
        newCustomers: {
          $sum: {
            $cond: [{ $gte: ['$firstOrder', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)] }, 1, 0]
          }
        },
        returningCustomers: {
          $sum: { $cond: [{ $gt: ['$totalOrders', 1] }, 1, 0] }
        }
      }
    }
  ]);

  const a = agg || {};
  const c = customerAgg[0] || {};

  const totalOrders = a.totalOrders || 0;
  const revenue = a.totalRevenue || 0;
  const averageOrderValue = totalOrders ? revenue / totalOrders : 0;

  res.json({
    totalOrders,
    pendingOrders: a.pending || 0,
    confirmedOrders: a.confirmed || 0,
    completedOrders: a.delivered || 0,
    cancelledOrders: a.cancelled || 0,
    totalProducts: productCount,
    activeProducts,
    lowStock,
    outOfStock,
    totalQuantitySold: a.itemsQty || 0,
    totalRevenue: money(revenue),
    averageOrderValue: money(averageOrderValue),
    totalCustomers: c.totalCustomers || 0,
    newCustomers: c.newCustomers || 0,
    returningCustomers: c.returningCustomers || 0
  });
}

async function revenue(req, res) {
  const group = ['day', 'week', 'month'].includes(req.query.group) ? req.query.group : 'day';
  const format = group === 'day' ? '%Y-%m-%d' : group === 'month' ? '%Y-%m' : '%Y-W%V';

  const rows = await Order.aggregate([
    ...basePipeline(req.query),
    {
      $group: {
        _id: { $dateToString: { format, date: '$createdAt' } },
        revenue: { $sum: { $cond: [{ $in: ['$status', REVENUE_STATUSES] }, '$totalAmount', 0] } },
        orders: { $sum: 1 }
      }
    },
    { $sort: { _id: 1 } }
  ]);

  res.json({
    labels: rows.map((r) => r._id),
    revenue: rows.map((r) => money(r.revenue)),
    orders: rows.map((r) => r.orders)
  });
}

async function products(req, res) {
  const rows = await Order.aggregate([
    ...basePipeline(req.query),
    { $match: { status: { $nin: ['CANCELLED', 'cancelled'] } } },
    { $unwind: '$items' },
    {
      $group: {
        _id: {
          id: '$items.productId',
          name: '$items.productName',
          category: '$items.category'
        },
        quantity: { $sum: '$items.quantity' },
        revenue: { $sum: '$items.subtotal' },
        orders: { $sum: 1 }
      }
    },
    { $sort: { revenue: -1 } }
  ]);

  const result = rows.map((r) => ({
    productId: r._id.id,
    name: r._id.name,
    category: r._id.category,
    quantity: r.quantity,
    revenue: money(r.revenue),
    orders: r.orders
  }));

  const valid = result.filter((r) => r.revenue > 0 || r.quantity > 0);

  res.json({
    products: result,
    highestQuantity: valid.length ? valid.reduce((a, b) => (b.quantity > a.quantity ? b : a)) : null,
    highestRevenue: valid.length ? valid.reduce((a, b) => (b.revenue > a.revenue ? b : a)) : null,
    lowestSelling: valid.length ? valid.reduce((a, b) => (b.quantity < a.quantity ? b : a)) : null
  });
}

async function categories(req, res) {
  const rows = await Order.aggregate([
    ...basePipeline(req.query),
    { $match: { status: { $nin: ['CANCELLED', 'cancelled'] } } },
    { $unwind: '$items' },
    {
      $group: {
        _id: '$items.category',
        quantity: { $sum: '$items.quantity' },
        revenue: { $sum: '$items.subtotal' }
      }
    },
    { $sort: { revenue: -1 } }
  ]);

  const totalRev = rows.reduce((sum, r) => sum + r.revenue, 0) || 1;
  const totalQty = rows.reduce((sum, r) => sum + r.quantity, 0) || 1;

  res.json({
    categories: rows.map((r) => ({
      category: r._id,
      quantity: r.quantity,
      revenue: money(r.revenue),
      revenuePct: Number(((r.revenue / totalRev) * 100).toFixed(1)),
      qtyPct: Number(((r.quantity / totalQty) * 100).toFixed(1))
    }))
  });
}

async function customers(req, res) {
  const byArea = await Order.aggregate([
    ...basePipeline(req.query),
    {
      $group: {
        _id: { $ifNull: ['$customerDoc.area', 'Unknown'] },
        orders: { $sum: 1 },
        revenue: { $sum: { $cond: [{ $in: ['$status', REVENUE_STATUSES] }, '$totalAmount', 0] } }
      }
    },
    { $sort: { orders: -1 } }
  ]);

  const perCustomer = await Order.aggregate([
    ...basePipeline(req.query),
    {
      $group: {
        _id: '$customer',
        orders: { $sum: 1 },
        revenue: { $sum: { $cond: [{ $in: ['$status', REVENUE_STATUSES] }, '$totalAmount', 0] } },
        firstName: { $last: '$customerDoc.firstName' },
        lastName: { $last: '$customerDoc.lastName' },
        area: { $last: '$customerDoc.area' }
      }
    },
    { $sort: { revenue: -1 } },
    { $limit: 10 }
  ]);

  const counts = await Order.aggregate([
    ...basePipeline(req.query),
    { $group: { _id: '$customer', count: { $sum: 1 } } },
    {
      $group: {
        _id: null,
        avg: { $avg: '$count' },
        oneTime: { $sum: { $cond: [{ $eq: ['$count', 1] }, 1, 0] } },
        repeat: { $sum: { $cond: [{ $gt: ['$count', 1] }, 1, 0] } }
      }
    }
  ]);

  const c = counts[0] || {};

  res.json({
    byArea: byArea.map((r) => ({ area: r._id || 'Unknown', orders: r.orders, revenue: money(r.revenue) })),
    topCustomers: perCustomer.map((r) => ({
      name: `${r.firstName || ''} ${r.lastName || ''}`.trim(),
      area: r.area || 'Unknown',
      orders: r.orders,
      revenue: money(r.revenue)
    })),
    avgOrdersPerCustomer: c.avg ? Number(c.avg.toFixed(2)) : 0,
    oneTimeCustomers: c.oneTime || 0,
    repeatCustomers: c.repeat || 0
  });
}

async function orderStatus(req, res) {
  const rows = await Order.aggregate([
    ...basePipeline(req.query),
    { $group: { _id: '$status', count: { $sum: 1 } } }
  ]);

  res.json({ statuses: rows.map((r) => ({ status: r._id, count: r.count })) });
}

async function tiffins(req, res) {
  const rows = await Order.aggregate([
    ...basePipeline({ ...req.query, type: 'tiffin' }),
    { $match: { status: { $ne: 'cancelled' } } },
    { $unwind: '$items' },
    { $match: { 'items.category': 'Tiffin Plans' } },
    {
      $group: {
        _id: {
          packageType: '$tiffinPlan.packageType',
          size: '$tiffinPlan.size',
          name: '$items.productName'
        },
        sold: { $sum: '$items.quantity' },
        revenue: { $sum: '$items.subtotal' },
        orders: { $sum: 1 }
      }
    },
    { $sort: { sold: -1 } }
  ]);

  const plans = rows.map((r) => ({
    packageType: r._id.packageType,
    size: r._id.size,
    name: r._id.name,
    sold: r.sold,
    revenue: money(r.revenue),
    orders: r.orders
  }));

  const fullMeal = plans.filter((p) => p.packageType === 'full').reduce((sum, p) => sum + p.revenue, 0);
  const curryOnly = plans.filter((p) => p.packageType === 'curry-only').reduce((sum, p) => sum + p.revenue, 0);

  res.json({
    plans,
    fullMealRevenue: money(fullMeal),
    curryOnlyRevenue: money(curryOnly),
    mostPurchased: plans.length ? plans.reduce((a, b) => (b.sold > a.sold ? b : a)) : null,
    totalPlansSold: plans.reduce((sum, p) => sum + p.sold, 0),
    totalRevenue: money(plans.reduce((sum, p) => sum + p.revenue, 0))
  });
}

async function customOrders(req, res) {
  const rows = await Order.aggregate([
    ...basePipeline(req.query),
    { $match: { type: { $in: ['custom', 'catering'] } } },
    {
      $group: {
        _id: '$type',
        total: { $sum: 1 },
        pending: { $sum: { $cond: [{ $in: ['$status', ['PENDING', 'pending']] }, 1, 0] } },
        confirmed: { $sum: { $cond: [{ $in: ['$status', ['ACCEPTED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'confirmed', 'preparing', 'ready', 'delivered']] }, 1, 0] } },
        cancelled: { $sum: { $cond: [{ $in: ['$status', ['CANCELLED', 'cancelled']] }, 1, 0] } },
        totalAmount: { $sum: '$totalAmount' },
        revenue: { $sum: { $cond: [{ $in: ['$status', REVENUE_STATUSES] }, '$totalAmount', 0] } }
      }
    }
  ]);

  const map = Object.fromEntries(rows.map((r) => [r._id, r]));
  const recent = await Order.find({ type: { $in: ['custom', 'catering'] } })
    .sort('-createdAt')
    .limit(50)
    .populate('customer', 'firstName lastName phone email area address')
    .lean();

  const allCustomTotal = recent.reduce((sum, order) => sum + Number(order.totalAmount || 0), 0);

  res.json({
    custom: map.custom || { total: 0, pending: 0, confirmed: 0, cancelled: 0, totalAmount: 0, revenue: 0 },
    catering: map.catering || { total: 0, pending: 0, confirmed: 0, cancelled: 0, totalAmount: 0, revenue: 0 },
    totalAmount: money(allCustomTotal),
    recent
  });
}

async function tiffinPreparation(req, res) {
  const requestedDate = parseDateInput(req.query.date || new Date());
  const dateKey = formatDateKey(requestedDate);
  const selectedDate = new Date(`${dateKey}T12:00:00`);
  const weekday = getWeekdayName(selectedDate);
  const menu = getMenuForDate(selectedDate);
  const selection = await TiffinMenuSelection.findOne({ date: dateKey }).lean();

  if (!menu) {
    return res.json({
      selectedDate: dateKey,
      weekday,
      serviceExists: false,
      dateLabel: dateLabel(selectedDate),
      menu: null,
      selectedMenu: selection || { date: dateKey, dalOption: 'Not selected', curryOption: 'Not selected' },
      activePlanCounts: { full: { single: 0, couple: 0, family: 0 }, 'curry-only': { single: 0, couple: 0, family: 0 } },
      totals: {
        smallCurries: 0,
        mediumCurries: 0,
        largeCurries: 0,
        smallDal: 0,
        mediumDal: 0,
        largeDal: 0,
        riceBoxes: 0,
        chapathiCount: 0,
        smallCurd: 0,
        bigCurd: 0
      },
      message: 'No tiffin service on this day.'
    });
  }

  await syncExpiredTiffinSubscriptions(new Date());

  const subscriptions = await TiffinSubscription.find({
    status: { $ne: 'CANCELLED' },
    startDate: { $lte: endOfDay(selectedDate) },
    endDate: { $gte: startOfDay(selectedDate) }
  }).lean();

  const totals = buildPreparationTotals(subscriptions);
  const activePlanCounts = buildActivePlanCounts(subscriptions);

  res.json({
    selectedDate: dateKey,
    weekday,
    serviceExists: true,
    dateLabel: dateLabel(selectedDate),
    menu,
    selectedMenu: selection || { date: dateKey, dalOption: 'Not selected', curryOption: 'Not selected' },
    activePlanCounts,
    totals,
    message: ''
  });
}

async function saveTiffinMenuSelection(req, res) {
  const { date: dateValue, dalOption, curryOption } = req.body || {};
  const selectedDate = parseDateInput(dateValue || new Date());
  const dateKey = formatDateKey(selectedDate);
  const menu = getMenuForDate(selectedDate);

  if (!menu) {
    return res.status(400).json({ message: 'No tiffin service on this day.' });
  }

  const nextDal = String(dalOption || 'Not selected');
  const nextCurry = String(curryOption || 'Not selected');

  const validDal = !nextDal || nextDal === 'Not selected' || menu.dalOptions.includes(nextDal);
  const validCurry = !nextCurry || nextCurry === 'Not selected' || menu.curryOptions.includes(nextCurry);

  if (!validDal || !validCurry) {
    return res.status(400).json({ message: 'Invalid menu option selected.' });
  }

  const selection = await TiffinMenuSelection.findOneAndUpdate(
    { date: dateKey },
    { $set: { date: dateKey, dalOption: nextDal, curryOption: nextCurry, createdBy: req.admin?.id || null } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  ).lean();

  res.json({ message: 'Tiffin menu selection saved.', selection });
}

module.exports = { overview, revenue, products, categories, customers, orderStatus, tiffins, customOrders, tiffinPreparation, saveTiffinMenuSelection };
