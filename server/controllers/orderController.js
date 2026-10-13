const mongoose = require('mongoose');
const Order = require('../models/Order');
const Customer = require('../models/Customer');
const Product = require('../models/Product');
const TiffinSubscription = require('../models/TiffinSubscription');
const { TIFFIN_PRICES, tiffinDisplayName, ORDER_STATUSES } = require('../utils/constants');
const { emitOrderUpdate } = require('../utils/orderEvents');
const { parseDateInput, formatDateKey, addDays, startOfDay, getSubscriptionServiceDates } = require('../utils/tiffinPreparation');
const { getOrderServiceDates, getCurrentServiceDate, resolveDeliveryStatus, applyDeliveryStatus, withCurrentDeliveryStatus } = require('../utils/deliveryStatus');
const { PREPARATION_TYPES, TIFFIN_PREPARATION_ITEMS, getTiffinPreparationType, buildDefaultTiffinItems, getLegacyOrderTiffinItems } = require('../utils/tiffinItems');
const { getOrderCustomer } = require('../utils/orderCustomer');
const { normalizeStatus, transitionOrderStatus } = require('../utils/orderStatus');
const { parseDateOnly } = require('../utils/dateFilter');

function extractOrderFulfillment(orderItems = []) {
  if (!orderItems.length) return 'pickup';
  const deliveryCount = orderItems.filter((item) => item.fulfillment === 'delivery').length;
  if (deliveryCount === 0) return 'pickup';
  if (deliveryCount === orderItems.length) return 'delivery';
  return 'mixed';
}

function parseOrderDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = parseDateInput(value);
  if (formatDateKey(date) !== value || value < formatDateKey(new Date())) return null;
  return date;
}

function deriveSubscriptionDates(startDateValue, endDateValue) {
  const fallbackStart = parseDateInput(startDateValue || new Date());
  const { startDate, endDate } = getSubscriptionServiceDates(fallbackStart, endDateValue || null);
  const resolvedStart = startDate || fallbackStart;
  const resolvedEnd = endDate || addDays(resolvedStart, 27);
  return { startDate: resolvedStart, endDate: resolvedEnd };
}

async function createTiffinSubscriptionsForOrder(order, payload = {}) {
  if (!order || order.type !== 'tiffin') return [];
  const entries = Array.isArray(payload.tiffinPlans) ? payload.tiffinPlans.filter((entry) => entry && entry.packageType && entry.size) : [];
  if (!entries.length) return [];

  const { startDate, endDate } = deriveSubscriptionDates(payload.pickupDate || entries[0].startDate, entries[0].endDate || payload.endDate);
  const subscriptions = [];

  for (const entry of entries) {
    const quantity = Math.max(1, parseInt(entry.quantity, 10) || 1);
    const subscription = await TiffinSubscription.findOneAndUpdate(
      { customerId: order.customer, orderId: order._id, packageType: entry.packageType, size: entry.size },
      {
        customerId: order.customer,
        orderId: order._id,
        packageType: entry.packageType,
        size: entry.size,
        quantity,
        startDate,
        endDate,
        status: 'ACTIVE',
        isDemo: Boolean(order.isDemo)
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    subscriptions.push(subscription);
  }

  return subscriptions;
}

async function syncTiffinSubscriptionStatus(order) {
  if (!order || order.type !== 'tiffin') return;
  const status = order.status === 'CANCELLED' ? 'CANCELLED' : 'ACTIVE';
  await TiffinSubscription.updateMany({ orderId: order._id }, { $set: { status } });
}

async function syncTiffinSubscriptionDates(order) {
  if (!order || order.type !== 'tiffin') return;
  await TiffinSubscription.updateOne(
    { orderId: order._id },
    { $set: { startDate: order.subscriptionStartDate, endDate: order.subscriptionEndDate } }
  );
}

function setTiffinAcceptanceDates(order) {
  order.acceptedAt = new Date();
  if (!order.subscriptionStartDate) {
    const dates = getSubscriptionServiceDates(order.acceptedAt);
    order.subscriptionStartDate = dates.startDate;
    order.subscriptionEndDate = dates.endDate;
  }
}

async function createOrder(req, res) {
  if (!req.customer || !req.customer._id) {
    return res.status(401).json({ message: 'Customer sign-in required before placing an order.' });
  }

  const customerDoc = await Customer.findById(req.customer._id);
  if (!customerDoc) {
    return res.status(401).json({ message: 'Customer account no longer exists.' });
  }

  const { items = [], tiffinPlans = [], customRequest = '', customAmount = 0, type = 'product' } = req.body || {};

  const checkoutCustomer = req.body?.customer || {};
  const firstName = String(checkoutCustomer.firstName ?? customerDoc.firstName ?? req.customer.firstName ?? '').trim();
  const lastName = String(checkoutCustomer.lastName ?? customerDoc.lastName ?? req.customer.lastName ?? '').trim();
  const phone = String(checkoutCustomer.phone ?? customerDoc.phone ?? req.customer.phone ?? '').trim();
  const email = String(checkoutCustomer.email ?? customerDoc.email ?? req.customer.email ?? '').trim().toLowerCase();
  const area = String(checkoutCustomer.area ?? customerDoc.area ?? req.customer.area ?? '').trim();
  const address = String(checkoutCustomer.address ?? area ?? customerDoc.address ?? req.customer.address ?? '').trim();

  if (!firstName || !lastName || !phone || !email.includes('@')) {
    return res.status(400).json({ message: 'Please provide first name, last name, phone and a valid email.' });
  }
  if (firstName.length > 100 || lastName.length > 100 || phone.length > 40 || email.length > 254 || area.length > 200 || address.length > 500
    || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ message: 'Please provide valid checkout contact details and address.' });
  }
  const customerSnapshot = { firstName, lastName, phone, email, address, area };

  const orderItems = [];
  let totalAmount = 0;
  let orderType = ['tiffin', 'catering', 'custom'].includes(type) ? type : 'product';

  if (Array.isArray(items) && items.length) {
    const ids = items.map((i) => i.productId).filter((id) => mongoose.isValidObjectId(id));
    const products = ids.length ? await Product.find({ _id: { $in: ids }, active: true }).lean() : [];
    const byId = new Map(products.map((p) => [String(p._id), p]));

    for (const raw of items) {
      if (!raw || !mongoose.isValidObjectId(raw.productId)) {
        return res.status(400).json({ message: 'Each product order item must reference a catalog product.' });
      }

      const product = byId.get(String(raw.productId));
      if (!product) {
        return res.status(400).json({ message: `Invalid or inactive product: ${raw.productId}` });
      }

      const quantity = Math.max(1, Math.min(99, parseInt(raw.quantity, 10) || 1));
      if (product.stock === 0) {
        return res.status(400).json({ message: `${product.name} is currently out of stock.` });
      }
      if (product.stock < quantity) {
        return res.status(400).json({ message: `Insufficient stock for ${product.name}. Available: ${product.stock}, requested: ${quantity}.` });
      }
      const subtotal = Math.round(product.price * quantity * 100) / 100;
      totalAmount += subtotal;
      orderItems.push({
        productId: product._id,
        productName: product.name,
        category: product.category,
        priceAtPurchase: product.price,
        quantity,
        subtotal,
        fulfillment: 'pickup',
        deliveryStatus: 'PENDING'
      });
    }
  }

  let tiffinPlanMeta = { packageType: null, size: null, price: null };
  const normalizedTiffinPlans = [];
  if (Array.isArray(tiffinPlans) && tiffinPlans.length) {
    orderType = 'tiffin';

    for (const tp of tiffinPlans) {
      if (!tp || !tp.packageType || !tp.size) continue;
      const packagePrices = Object.prototype.hasOwnProperty.call(TIFFIN_PRICES, tp.packageType)
        ? TIFFIN_PRICES[tp.packageType]
        : null;
      const price = packagePrices && Object.prototype.hasOwnProperty.call(packagePrices, tp.size)
        ? packagePrices[tp.size]
        : null;
      if (!price) {
        return res.status(400).json({ message: 'Invalid tiffin plan selection.' });
      }
      const quantity = Math.max(1, parseInt(tp.quantity, 10) || 1);
      const normalizedPlan = { ...tp, packageType: String(tp.packageType), size: String(tp.size), quantity };
      normalizedTiffinPlans.push(normalizedPlan);
      const name = tiffinDisplayName(normalizedPlan.packageType, normalizedPlan.size);

      const subtotal = price * quantity;
      totalAmount += subtotal;
      orderItems.push({
        productId: null,
        productName: name,
        category: 'Tiffin Plans',
        priceAtPurchase: price,
        quantity,
        subtotal,
        fulfillment: 'delivery',
        deliveryStatus: 'PENDING'
      });
      tiffinPlanMeta = { packageType: normalizedPlan.packageType, size: normalizedPlan.size, price };
    }
  }

  const fulfillment = extractOrderFulfillment(orderItems);
  const pickupDateValue = String(req.body?.pickupDate || '').trim();
  if (!pickupDateValue) {
    return res.status(400).json({ message: 'Pickup date is required for every order.' });
  }
  const selectedOrderDate = parseOrderDate(pickupDateValue);
  if (!selectedOrderDate) {
    return res.status(400).json({ message: 'Pickup date must be a valid date on or after today.' });
  }
  const pickupDate = selectedOrderDate;

  const deliveryDates = fulfillment !== 'pickup'
    ? getSubscriptionServiceDates(selectedOrderDate)
    : null;
  const subscriptionDates = normalizedTiffinPlans.length ? deliveryDates : null;

  if (orderType === 'tiffin' && subscriptionDates?.startDate && tiffinPlanMeta.packageType) {
    const existingTiffinOrder = await Order.findOne({
      customer: customerDoc._id,
      type: 'tiffin',
      'tiffinPlan.packageType': tiffinPlanMeta.packageType,
      'tiffinPlan.size': tiffinPlanMeta.size,
      subscriptionStartDate: subscriptionDates.startDate,
      status: { $ne: 'CANCELLED' }
    }).sort({ createdAt: -1 }).lean();

    if (existingTiffinOrder) {
      const populated = await Order.findById(existingTiffinOrder._id).populate('customer', 'firstName lastName phone email address area');
      return res.status(200).json({ message: 'Existing tiffin subscription order found.', order: populated });
    }
  }

  const cleanCustom = String(customRequest || '').trim().slice(0, 2000);
  if (!orderItems.length && !cleanCustom) {
    return res.status(400).json({ message: 'Your cart is empty — add a product, tiffin plan or custom request.' });
  }

  const explicitCustomAmount = Number(customAmount ?? req.body?.amount ?? 0);
  if (Number.isFinite(explicitCustomAmount) && explicitCustomAmount > 0) {
    totalAmount += Math.round(explicitCustomAmount * 100) / 100;
  }

  if (cleanCustom) {
    orderType = orderType === 'product' ? (type === 'catering' ? 'catering' : 'custom') : orderType;
    if (totalAmount <= 0) {
      const trayMatch = cleanCustom.match(/(\d+)\s*trays?/i);
      const guestMatch = cleanCustom.match(/(\d+)\s*guests?/i);
      if (trayMatch) {
        totalAmount = parseInt(trayMatch[1], 10) * 50;
      } else if (guestMatch) {
        totalAmount = parseInt(guestMatch[1], 10) * 25;
      } else {
        totalAmount = orderType === 'catering' ? 3000 : 1500;
      }
    }
  }

  totalAmount = Math.round(totalAmount * 100) / 100;

  const order = await Order.create({
    customer: customerDoc._id,
    customerId: customerDoc._id,
    customerSnapshot,
    items: orderItems,
    ...(orderType === 'tiffin' ? {
      tiffinItems: normalizedTiffinPlans.length ? buildDefaultTiffinItems(normalizedTiffinPlans) : []
    } : {}),
    fulfillment,
    type: orderType,
    tiffinPlan: tiffinPlanMeta,
    customRequest: cleanCustom,
    totalAmount,
    pickupDate,
    subscriptionStartDate: deliveryDates?.startDate || null,
    subscriptionEndDate: deliveryDates?.endDate || null,
    deliveryStatusDate: deliveryDates?.serviceDates[0] || null,
    deliveryAddress: address || area,
    status: 'PENDING',
    placedAt: new Date()
  });

  if (orderType === 'tiffin') {
    try {
      await createTiffinSubscriptionsForOrder(order, { ...(req.body || {}), tiffinPlans: normalizedTiffinPlans });
    } catch (error) {
      await TiffinSubscription.deleteMany({ orderId: order._id });
      await Order.deleteOne({ _id: order._id });
      throw error;
    }
  }

  const stockChanges = new Map();
  try {
    for (const item of orderItems.filter((entry) => entry.productId)) {
      const updated = await Product.findOneAndUpdate(
        { _id: item.productId, active: true, stock: { $gte: item.quantity } },
        { $inc: { stock: -item.quantity } },
        { new: true }
      ).lean();
      if (!updated) {
        const currentProduct = await Product.findById(item.productId).lean();
        if (!currentProduct || !currentProduct.active) {
          throw new Error(`Product ${item.productName} is no longer available.`);
        }
        if (currentProduct.stock === 0) {
          throw new Error(`${item.productName} is currently out of stock.`);
        }
        throw new Error(`Insufficient stock for ${item.productName}. Available: ${currentProduct.stock}, requested: ${item.quantity}.`);
      }
      stockChanges.set(String(item.productId), item.quantity);
      req.app.get('io')?.emit('product:stockUpdated', { productId: updated._id, stock: updated.stock, product: updated });
    }
  } catch (error) {
    for (const [productId, quantity] of stockChanges) await Product.updateOne({ _id: productId }, { $inc: { stock: quantity } });
    await Order.deleteOne({ _id: order._id });
    return res.status(400).json({ message: error.message || 'Could not reserve product stock.' });
  }

  const populated = await Order.findById(order._id).populate('customer', 'firstName lastName phone email address area');
  emitOrderUpdate(req.app, populated);
  const responseOrder = populated.toObject();
  responseOrder.customer = getOrderCustomer(responseOrder);
  responseOrder.pickupDate = formatDateKey(populated.pickupDate);
  responseOrder.subscriptionStartDate = formatDateKey(populated.subscriptionStartDate);
  responseOrder.subscriptionEndDate = formatDateKey(populated.subscriptionEndDate);
  res.status(201).json({ message: 'Order saved', order: responseOrder });
}

async function createManualOrder(req, res) {
  const { firstName, lastName, phone, email, productId, quantity, amount, fulfillment, address = '', pickupDate: pickupDateValue } = req.body || {};
  const cleanFirstName = String(firstName || '').trim();
  const cleanLastName = String(lastName || '').trim();
  const cleanPhone = String(phone || '').trim();
  const cleanEmail = String(email || '').trim().toLowerCase();
  const cleanFulfillment = String(fulfillment || '').toLowerCase();
  const parsedQuantity = Number(quantity);
  const parsedAmount = Number(amount);

  if (!cleanFirstName || !cleanLastName || !cleanPhone || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    return res.status(400).json({ message: 'First name, last name, phone and a valid email are required.' });
  }
  if (!mongoose.isValidObjectId(productId)) return res.status(400).json({ message: 'Select a valid product.' });
  if (!Number.isInteger(parsedQuantity) || parsedQuantity < 1 || parsedQuantity > 99) {
    return res.status(400).json({ message: 'Quantity must be between 1 and 99.' });
  }
  if (!Number.isFinite(parsedAmount) || parsedAmount < 0) return res.status(400).json({ message: 'Enter a valid non-negative amount.' });
  if (!['delivery', 'pickup'].includes(cleanFulfillment)) {
    return res.status(400).json({ message: 'Fulfillment must be delivery or pickup.' });
  }
  if (!String(pickupDateValue || '').trim()) {
    return res.status(400).json({ message: 'Pickup date is required for every order.' });
  }
  const selectedOrderDate = parseOrderDate(String(pickupDateValue).trim());
  if (!selectedOrderDate) {
    return res.status(400).json({ message: 'Pickup date must be a valid date on or after today.' });
  }
  const pickupDate = selectedOrderDate;
  const subscriptionDates = cleanFulfillment === 'delivery'
    ? getSubscriptionServiceDates(selectedOrderDate)
    : null;
  const product = await Product.findOne({ _id: productId, active: true }).lean();
  if (!product) return res.status(400).json({ message: 'Select an active catalog product.' });
  if (product.stock < parsedQuantity) {
    return res.status(400).json({ message: `Insufficient stock for ${product.name}. Available: ${product.stock}, requested: ${parsedQuantity}.` });
  }

  let customer;
  try {
    customer = await Customer.findOneAndUpdate(
      { email: cleanEmail, phone: cleanPhone },
      { $setOnInsert: { firstName: cleanFirstName, lastName: cleanLastName, phone: cleanPhone, email: cleanEmail, address: String(address).trim() } },
      { new: true, upsert: true, setDefaultsOnInsert: true, runValidators: true }
    );
  } catch (error) {
    if (error.code !== 11000) throw error;
    customer = await Customer.findOne({ email: cleanEmail, phone: cleanPhone });
    if (!customer) throw error;
  }

  const updatedProduct = await Product.findOneAndUpdate(
    { _id: product._id, active: true, stock: { $gte: parsedQuantity } },
    { $inc: { stock: -parsedQuantity } },
    { new: true }
  ).lean();
  if (!updatedProduct) return res.status(400).json({ message: `Insufficient stock for ${product.name}.` });

  const roundedAmount = Math.round(parsedAmount * 100) / 100;
  let order;
  try {
    order = await Order.create({
      customer: customer._id,
      customerId: customer._id,
      customerSnapshot: {
        firstName: cleanFirstName,
        lastName: cleanLastName,
        phone: cleanPhone,
        email: cleanEmail,
        address: String(address || customer.address || customer.area || '').trim(),
        area: customer.area || ''
      },
      items: [{
        productId: product._id,
        productName: product.name,
        category: product.category,
        fulfillment: cleanFulfillment,
        deliveryStatus: 'PENDING',
        priceAtPurchase: Math.round((roundedAmount / parsedQuantity) * 100) / 100,
        quantity: parsedQuantity,
        subtotal: roundedAmount
      }],
      fulfillment: cleanFulfillment,
      type: 'product',
      totalAmount: roundedAmount,
      pickupDate,
      subscriptionStartDate: subscriptionDates?.startDate || null,
      subscriptionEndDate: subscriptionDates?.endDate || null,
      deliveryStatusDate: subscriptionDates?.serviceDates[0] || null,
      deliveryAddress: String(address || customer.address || customer.area || '').trim(),
      status: 'PENDING',
      placedAt: new Date()
    });
  } catch (error) {
    await Product.updateOne({ _id: product._id }, { $inc: { stock: parsedQuantity } });
    throw error;
  }

  req.app.get('io')?.emit('product:stockUpdated', { productId: updatedProduct._id, stock: updatedProduct.stock, product: updatedProduct });
  const populated = await Order.findById(order._id).populate('customer', 'firstName lastName phone email address area');
  emitOrderUpdate(req.app, populated);
  const responseOrder = populated.toObject();
  responseOrder.customer = getOrderCustomer(responseOrder);
  responseOrder.pickupDate = formatDateKey(populated.pickupDate);
  responseOrder.subscriptionStartDate = formatDateKey(populated.subscriptionStartDate);
  responseOrder.subscriptionEndDate = formatDateKey(populated.subscriptionEndDate);
  return res.status(201).json({ message: 'Manual order saved', order: responseOrder });
}

async function listOrders(req, res) {
  const { status, type, area, search, sort = '-createdAt', page = 1, limit = 50, from, to, createdFrom, createdTo, orderDate, fulfillment } = req.query;
  const fulfillmentFilter = String(fulfillment || '').toLowerCase();
  if (fulfillmentFilter && !['delivery', 'pickup'].includes(fulfillmentFilter)) {
    return res.status(400).json({ message: 'Fulfillment must be delivery or pickup.' });
  }
  const match = {};
  if (status) match.status = new RegExp(`^${status}$`, 'i');
  if (type) match.type = type;
  const createdAt = {};
  if (from) {
    const fromDate = parseDateOnly(from);
    if (fromDate) {
      createdAt.$gte = startOfDay(fromDate);
    }
  }
  if (to) {
    const toDate = parseDateOnly(to);
    if (toDate) {
      const nextDay = addDays(toDate, 1);
      createdAt.$lt = startOfDay(nextDay);
    }
  }
  if (createdFrom) {
    const date = new Date(createdFrom);
    if (Number.isNaN(date.getTime())) return res.status(400).json({ message: 'Invalid order creation start time.' });
    createdAt.$gte = date;
  }
  if (createdTo) {
    const date = new Date(createdTo);
    if (Number.isNaN(date.getTime())) return res.status(400).json({ message: 'Invalid order creation end time.' });
    createdAt.$lt = date;
  }
  if (Object.keys(createdAt).length) match.createdAt = createdAt;
  if (orderDate) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(orderDate) || formatDateKey(parseDateInput(orderDate)) !== orderDate) {
      return res.status(400).json({ message: 'Invalid order date.' });
    }
    const selectedDate = startOfDay(parseDateInput(orderDate));
    const nextDate = addDays(selectedDate, 1);
    const dateField = fulfillmentFilter === 'delivery' ? 'subscriptionStartDate' : 'pickupDate';
    match[dateField] = { $gte: selectedDate, $lt: nextDate };
  }
  const conditions = [];
  if (area) {
    conditions.push({ $or: [
      { 'customerDoc.area': new RegExp(area, 'i') },
      { 'customerDoc.address': new RegExp(area, 'i') },
      { deliveryAddress: new RegExp(area, 'i') }
    ] });
  }
  const cleanSearch = String(search || '').trim();
  if (cleanSearch) {
    const escapedSearch = cleanSearch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const searchRegex = new RegExp(escapedSearch, 'i');
    const searchableFields = [
      { orderId: searchRegex },
      { 'customerDoc.firstName': searchRegex },
      { 'customerDoc.lastName': searchRegex },
      { 'customerDoc.email': searchRegex },
      { 'customerDoc.phone': searchRegex },
      { 'customerDoc.address': searchRegex },
      { 'customerDoc.area': searchRegex },
      { deliveryAddress: searchRegex },
      { type: searchRegex },
      { fulfillment: searchRegex },
      { customRequest: searchRegex },
      { 'items.productName': searchRegex },
      { 'items.category': searchRegex }
    ];
    const normalizedStatusSearch = cleanSearch.toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
    const statusAliases = {
      'pickup completed': 'DELIVERED',
      'out for delivery': 'OUT_FOR_DELIVERY',
      'pickup complete': 'DELIVERED'
    };
    const statusSearch = (statusAliases[normalizedStatusSearch] || normalizedStatusSearch.replace(/\s+/g, '_'))
      .replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const statusRegex = new RegExp(statusSearch.replace(/[_\s-]+/g, '[_\\s-]*'), 'i');
    searchableFields.push(
      { status: statusRegex },
      { 'items.deliveryStatus': statusRegex }
    );
    const phoneDigits = cleanSearch.replace(/\D/g, '');
    if (phoneDigits) {
      searchableFields.push({
        $expr: {
          $regexMatch: {
            input: { $ifNull: ['$customerDoc.phone', ''] },
            regex: phoneDigits.split('').map((digit) => `\\D*${digit}`).join(''),
            options: 'i'
          }
        }
      });
    }
    searchableFields.push(
      {
        $expr: {
          $regexMatch: {
            input: {
              $concat: [
                { $ifNull: ['$customerDoc.firstName', ''] },
                ' ',
                { $ifNull: ['$customerDoc.lastName', ''] }
              ]
            },
            regex: escapedSearch,
            options: 'i'
          }
        }
      }
    );
    conditions.push({ $or: searchableFields });
  }
  if (conditions.length) match.$and = conditions;

  const safeSort = ['createdAt', '-createdAt', 'totalAmount', '-totalAmount', 'status', '-status'].includes(sort) ? sort : '-createdAt';
  const p = Math.max(1, parseInt(page, 10) || 1);
  const l = Math.min(100, Math.max(1, parseInt(limit, 10) || 50));

  const pipeline = [
    { $lookup: { from: 'customers', localField: 'customer', foreignField: '_id', as: 'customerDoc' } },
    { $unwind: { path: '$customerDoc', preserveNullAndEmptyArrays: true } },
    {
      $set: {
        customerDoc: {
          $mergeObjects: [
            { $ifNull: ['$customerDoc', {}] },
            { $ifNull: ['$customerSnapshot', {}] }
          ]
        }
      }
    },
    { $lookup: { from: 'deliverymembers', localField: 'deliveryMemberId', foreignField: '_id', as: 'deliveryMemberDoc' } },
    { $unwind: { path: '$deliveryMemberDoc', preserveNullAndEmptyArrays: true } }
  ];

  if (Object.keys(match).length) {
    pipeline.push({ $match: match });
  }

  if (fulfillmentFilter === 'delivery') {
    pipeline.push({ $match: { 'items.fulfillment': 'delivery' } });
  } else if (fulfillmentFilter === 'pickup') {
    pipeline.push({
      $match: {
        $or: [
          { 'items.fulfillment': 'pickup' },
          { items: { $size: 0 }, fulfillment: { $ne: 'delivery' } }
        ]
      }
    });
  }

  const fulfillmentProjection = fulfillmentFilter ? [
    {
      $set: {
        _orderAmount: '$totalAmount',
        _allItemTotal: { $sum: { $map: { input: { $ifNull: ['$items', []] }, as: 'item', in: { $ifNull: ['$$item.subtotal', 0] } } } },
        _hasPickupItems: { $in: ['pickup', { $map: { input: { $ifNull: ['$items', []] }, as: 'item', in: '$$item.fulfillment' } }] },
        _hasDeliveryItems: { $in: ['delivery', { $map: { input: { $ifNull: ['$items', []] }, as: 'item', in: '$$item.fulfillment' } }] }
      }
    },
    {
      $set: {
        items: {
          $filter: {
            input: { $ifNull: ['$items', []] },
            as: 'item',
            cond: { $eq: ['$$item.fulfillment', fulfillmentFilter] }
          }
        }
      }
    },
    {
      $set: {
        orderAmount: '$_orderAmount',
        totalAmount: {
          $add: [
            { $sum: '$items.subtotal' },
            {
              $cond: [
                fulfillmentFilter === 'pickup'
                  ? { $or: [{ $eq: ['$_hasPickupItems', true] }, { $eq: ['$_hasDeliveryItems', false] }] }
                  : { $and: [{ $eq: ['$_hasDeliveryItems', true] }, { $eq: ['$_hasPickupItems', false] }] },
                { $max: [0, { $subtract: [{ $ifNull: ['$totalAmount', 0] }, '$_allItemTotal'] }] },
                0
              ]
            }
          ]
        },
        customRequest: {
          $cond: [
            fulfillmentFilter === 'pickup'
              ? { $or: [{ $eq: ['$_hasPickupItems', true] }, { $eq: ['$_hasDeliveryItems', false] }] }
              : { $and: [{ $eq: ['$_hasDeliveryItems', true] }, { $eq: ['$_hasPickupItems', false] }] },
            '$customRequest',
            ''
          ]
        }
      }
    },
    { $unset: ['_orderAmount', '_allItemTotal', '_hasPickupItems', '_hasDeliveryItems'] }
  ] : [];

  pipeline.push({
    $facet: {
      data: [
        { $sort: { [safeSort.replace('-', '')]: safeSort.startsWith('-') ? -1 : 1 } },
        { $skip: (p - 1) * l },
        { $limit: l },
        ...fulfillmentProjection
      ],
      total: [{ $count: 'n' }]
    }
  });

  const [result] = await Order.aggregate(pipeline);
  const total = result?.total?.[0]?.n || 0;

  const statusCounts = await Order.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]);

  res.json({
    orders: (result?.data || []).map((order) => {
      const hasDeliveryItems = (order.items || []).some((item) => item.fulfillment === 'delivery');
      const deliveryStartDate = hasDeliveryItems
        ? order.subscriptionStartDate || order.pickupDate
        : order.subscriptionStartDate;
      const derivedDeliveryDates = hasDeliveryItems && deliveryStartDate && !order.subscriptionEndDate
        ? getSubscriptionServiceDates(parseDateInput(deliveryStartDate))
        : null;
      const deliveryStatusOrder = withCurrentDeliveryStatus({
        ...order,
        subscriptionStartDate: deliveryStartDate,
        subscriptionEndDate: order.subscriptionEndDate || derivedDeliveryDates?.endDate
      });
      return {
        ...deliveryStatusOrder,
        orderAmount: order.orderAmount ?? order.totalAmount,
        pickupDate: formatDateKey(order.pickupDate),
        subscriptionStartDate: formatDateKey(deliveryStartDate),
        subscriptionEndDate: formatDateKey(order.subscriptionEndDate || derivedDeliveryDates?.endDate),
        deliveryStatusDate: formatDateKey(order.deliveryStatusDate)
      };
    }),
    total,
    page: p,
    pages: Math.ceil(total / l),
    statusCounts: Object.fromEntries(statusCounts.map((s) => [s._id, s.n]))
  });
}

async function getOrder(req, res) {
  const order = await Order.findById(req.params.id).populate('customer', 'firstName lastName phone email area');
  if (!order) return res.status(404).json({ message: 'Order not found' });
  const responseOrder = order.toObject();
  Object.assign(responseOrder, withCurrentDeliveryStatus(responseOrder));
  responseOrder.customer = getOrderCustomer(responseOrder);
  if (responseOrder.type === 'tiffin') {
    responseOrder.tiffinItems = getLegacyOrderTiffinItems(responseOrder);
  }
  responseOrder.pickupDate = formatDateKey(order.pickupDate);
  responseOrder.subscriptionStartDate = formatDateKey(order.subscriptionStartDate);
  responseOrder.subscriptionEndDate = formatDateKey(order.subscriptionEndDate);
  responseOrder.deliveryStatusDate = formatDateKey(order.deliveryStatusDate);
  res.json({ order: responseOrder });
}

async function updateAmount(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(400).json({ message: 'Invalid order ID.' });
  }

  const amount = req.body?.amount;
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0 || amount > Number.MAX_SAFE_INTEGER / 100) {
    return res.status(400).json({ message: 'Order amount must be a valid non-negative number.' });
  }

  const order = await Order.findById(req.params.id);
  if (!order) return res.status(404).json({ message: 'Order not found.' });

  order.totalAmount = Math.round((amount + Number.EPSILON) * 100) / 100;
  await order.save();
  emitOrderUpdate(req.app, order);
  return res.json({ message: 'Order amount updated successfully.', amount: order.totalAmount, order });
}

async function updateTiffinItems(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(400).json({ message: 'Invalid order ID.' });
  }
  const order = await Order.findById(req.params.id);
  if (!order) return res.status(404).json({ message: 'Order not found.' });
  const isDeliveryTiffin = order.type === 'tiffin'
    && (order.items || []).some((item) => item.fulfillment === 'delivery')
    && !(order.items || []).some((item) => item.fulfillment === 'pickup');
  if (!isDeliveryTiffin) {
    return res.status(400).json({ message: 'Only delivery tiffin orders can update preparation items.' });
  }

  const items = req.body?.items;
  if (!Array.isArray(items) || items.length > 50) {
    return res.status(400).json({ message: 'Provide a valid list of up to 50 tiffin items.' });
  }

  const productIds = new Set();
  for (const item of items) {
    const quantity = Number(item?.quantity);
    if (!Number.isSafeInteger(quantity) || quantity < 1) {
      return res.status(400).json({ message: 'Tiffin item quantities must be positive whole numbers.' });
    }
    if (item?.productId) {
      if (!mongoose.isValidObjectId(item.productId)) {
        return res.status(400).json({ message: 'Invalid product selected.' });
      }
      const productId = String(item.productId);
      if (productIds.has(productId)) {
        return res.status(400).json({ message: 'Each catalog product can only appear once.' });
      }
      productIds.add(productId);
    } else if (!PREPARATION_TYPES.includes(item?.preparationType)) {
      return res.status(400).json({ message: 'Invalid tiffin preparation item.' });
    }
  }

  const products = productIds.size
    ? await Product.find({ _id: { $in: [...productIds] } }).select('name category active').lean()
    : [];
  const productsById = new Map(products.map((product) => [String(product._id), product]));
  const savedProductsById = new Map(
    (order.tiffinItems || [])
      .filter((item) => item.productId)
      .map((item) => [String(item.productId), item])
  );
  const updatedItems = [];
  for (const item of items) {
    const quantity = Number(item?.quantity);
    if (item?.productId) {
      const productId = String(item.productId);
      const product = productsById.get(productId);
      const savedProduct = savedProductsById.get(productId);
      if (!product && !savedProduct) return res.status(400).json({ message: 'Selected product is unavailable.' });
      if (product && !product.active && !savedProduct) {
        return res.status(400).json({ message: 'Selected product is inactive.' });
      }
      updatedItems.push({
        productId: product?._id || savedProduct.productId,
        productName: product?.name || savedProduct.productName,
        category: product?.category || savedProduct.category,
        preparationType: product ? getTiffinPreparationType(product.name) : savedProduct.preparationType,
        quantity
      });
      continue;
    }

    const preparationType = item?.preparationType;
    const component = TIFFIN_PREPARATION_ITEMS[preparationType];
    updatedItems.push({
      productId: null,
      productName: component.productName,
      category: component.category,
      preparationType,
      quantity
    });
  }

  order.tiffinItems = updatedItems;
  order.tiffinItemsCustomized = true;
  await order.save();
  const responseOrder = order.toObject();
  Object.assign(responseOrder, withCurrentDeliveryStatus(responseOrder));
  return res.json({ message: 'Order items updated successfully.', order: responseOrder });
}

async function updatePickupDate(req, res) {
  const rawDate = String(req.body?.pickupDate || '').trim();
  if (!rawDate) return res.status(400).json({ message: 'Pickup date is required.' });
  const pickupDate = /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? parseDateInput(rawDate) : null;
  if (!pickupDate || formatDateKey(pickupDate) !== rawDate) {
    return res.status(400).json({ message: 'Invalid pickup date.' });
  }

  const order = await Order.findById(req.params.id);
  if (!order) return res.status(404).json({ message: 'Order not found.' });
  const pickupItems = (order.items || []).filter((item) => item.fulfillment === 'pickup');
  if (!pickupItems.length && order.fulfillment !== 'pickup') {
    return res.status(400).json({ message: 'Only orders with pickup items can update the pickup date.' });
  }

  order.pickupDate = pickupDate;
  await order.save();
  const populated = await Order.findById(order._id)
    .populate('customer', 'firstName lastName phone email address area')
    .populate('deliveryMemberId', 'name phone email');
  emitOrderUpdate(req.app, populated);
  return res.json({
    message: 'Pickup date updated.',
    pickupDate: formatDateKey(populated.pickupDate),
    order: populated
  });
}

async function updateStatus(req, res) {
  const status = normalizeStatus(req.body?.status);
  if (!ORDER_STATUSES.includes(status)) return res.status(400).json({ message: 'Invalid status' });
  const order = await Order.findById(req.params.id);
  if (!order) return res.status(404).json({ message: 'Order not found' });
  const fulfillmentScope = String(req.body?.fulfillment || '').toLowerCase();
  if (fulfillmentScope && !['pickup', 'delivery'].includes(fulfillmentScope)) {
    return res.status(400).json({ message: 'Fulfillment must be pickup or delivery.' });
  }
  const result = await transitionOrderStatus(Order, order, status, { fulfillment: fulfillmentScope || undefined, actor: 'admin' });
  if (result.error) return res.status(result.error.status).json({ message: result.error.message });
  if (result.order.type === 'tiffin') {
    if (result.scope === 'delivery' && !result.cancellation && status === 'ACCEPTED') {
      await syncTiffinSubscriptionDates(result.order);
    }
    if (result.scope === 'delivery' || result.cancellation) {
      await syncTiffinSubscriptionStatus(result.order);
    }
  }
  const populated = await Order.findById(order._id).populate('customer', 'firstName lastName phone email address area').populate('deliveryMemberId', 'name phone email');
  emitOrderUpdate(req.app, populated);
  res.json({ message: `Order marked as ${status}`, order: populated });
}

async function assignDeliveryMember(req, res) {
  const { deliveryMemberId } = req.body || {};
  
  if (!deliveryMemberId) return res.status(400).json({ message: 'Delivery member ID is required' });
  
  const order = await Order.findById(req.params.id);
  if (!order) return res.status(404).json({ message: 'Order not found' });
  
  const DeliveryMember = require('../models/DeliveryMember');
  const deliveryMember = await DeliveryMember.findById(deliveryMemberId);
  if (!deliveryMember) return res.status(404).json({ message: 'Delivery member not found' });
  if (!deliveryMember.active) return res.status(400).json({ message: 'Delivery member is inactive' });

  const deliveryItems = (order.items || []).filter((item) => item.fulfillment === 'delivery');
  if (!deliveryItems.length) {
    return res.status(400).json({ message: 'Pickup-only orders cannot be assigned to a delivery member.' });
  }
  
  const currentStatus = resolveDeliveryStatus(order);
  const currentServiceDate = getCurrentServiceDate(order);
  if (['CANCELLED', 'DELIVERED'].includes(currentStatus)) {
    return res.status(400).json({ message: 'Cannot assign a cancelled or delivered order' });
  }

  order.deliveryMemberId = deliveryMemberId;
  const acceptingTiffin = order.type === 'tiffin' && (currentStatus === 'PENDING' || !currentStatus);
  if ((currentStatus === 'PENDING' || !currentStatus) && currentServiceDate) {
    applyDeliveryStatus(order, 'ACCEPTED');
    if (acceptingTiffin) setTiffinAcceptanceDates(order);
    else order.acceptedAt = new Date();
  } else if (currentServiceDate) {
    applyDeliveryStatus(order, currentStatus);
  }
  await order.save();
  if (acceptingTiffin) await syncTiffinSubscriptionDates(order);
  
  const populated = await Order.findById(order._id).populate('customer', 'firstName lastName phone email address area').populate('deliveryMemberId', 'name phone email');
  emitOrderUpdate(req.app, populated);
  res.json({ message: 'Order assigned to delivery member', order: populated });
}

async function updateTiffinEndDate(req, res) {
  const hasStartDate = Object.prototype.hasOwnProperty.call(req.body || {}, 'startDate');
  const hasEndDate = Object.prototype.hasOwnProperty.call(req.body || {}, 'endDate');
  const hasPickupDate = Object.prototype.hasOwnProperty.call(req.body || {}, 'pickupDate');
  if ([hasStartDate, hasEndDate, hasPickupDate].filter(Boolean).length !== 1) {
    return res.status(400).json({ message: 'Provide exactly one of start date, end date or pickup date.' });
  }

  const dateType = hasStartDate ? 'start' : hasPickupDate ? 'pickup' : 'end';
  const rawDate = String((hasStartDate ? req.body.startDate : hasPickupDate ? req.body.pickupDate : req.body.endDate) || '').trim();
  if (!rawDate) return res.status(400).json({ message: `${dateType === 'start' ? 'Start' : dateType === 'pickup' ? 'Pickup' : 'End'} date is required.` });

  const order = await Order.findById(req.params.id);
  if (!order) return res.status(404).json({ message: 'Order not found.' });
  if (hasPickupDate) {
    const pickupItems = (order.items || []).filter((item) => item.fulfillment === 'pickup');
    if (!pickupItems.length && order.fulfillment !== 'pickup') {
      return res.status(400).json({ message: 'Only pickup orders can update the pickup date.' });
    }
  } else {
    const deliveryItems = (order.items || []).filter((item) => item.fulfillment === 'delivery');
    if (!deliveryItems.length && order.fulfillment !== 'delivery') {
      return res.status(400).json({ message: 'Only delivery orders can update delivery dates.' });
    }
  }

  const parsedDate = /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? parseDateInput(rawDate) : null;
  if (!parsedDate || formatDateKey(parsedDate) !== rawDate) {
    return res.status(400).json({ message: `Invalid ${dateType} date.` });
  }

  if (hasPickupDate) {
    order.pickupDate = parsedDate;
  } else if (hasStartDate) {
    const dates = getSubscriptionServiceDates(parsedDate);
    if (!dates.startDate || !dates.endDate || dates.serviceDates.length !== 20) {
      return res.status(400).json({ message: 'Could not calculate 20 serviceable weekdays for the start date.' });
    }
    const startDateChanged = formatDateKey(order.subscriptionStartDate) !== rawDate;
    order.subscriptionStartDate = dates.startDate;
    order.subscriptionEndDate = dates.endDate;
    if (startDateChanged) {
      const deliveryItems = (order.items || []).filter((item) => item.fulfillment === 'delivery');
      if (deliveryItems.length) {
        order.status = 'PENDING';
        deliveryItems.forEach((item) => { item.deliveryStatus = 'PENDING'; });
        order.deliveryStatusDate = getOrderServiceDates(order)[0] || null;
        order.acceptedAt = null;
        order.outForDeliveryAt = null;
        order.deliveredAt = null;
      }
    }
  } else {
    const startDate = order.subscriptionStartDate || new Date(order.createdAt || Date.now());
    if (parsedDate < new Date(startDate)) return res.status(400).json({ message: 'End date cannot be before the start date.' });
    order.subscriptionEndDate = parsedDate;
  }

  await order.save();

  if (order.type === 'tiffin' && !hasPickupDate) {
    await TiffinSubscription.updateMany(
      { orderId: order._id },
      {
        $set: hasStartDate
          ? { startDate: order.subscriptionStartDate, endDate: order.subscriptionEndDate }
          : { endDate: order.subscriptionEndDate }
      }
    );
  }

  const populated = await Order.findById(order._id).populate('customer', 'firstName lastName phone email address area').populate('deliveryMemberId', 'name phone email');
  emitOrderUpdate(req.app, populated);
  res.json({
    message: hasPickupDate ? 'Pickup date updated.' : hasStartDate ? 'Tiffin delivery dates updated.' : 'Tiffin delivery end date updated.',
    pickupDate: formatDateKey(populated.pickupDate),
    startDate: formatDateKey(populated.subscriptionStartDate),
    endDate: formatDateKey(populated.subscriptionEndDate),
    order: populated
  });
}

async function deleteOrder(req, res) {
  const order = await Order.findById(req.params.id);
  if (!order) return res.status(404).json({ message: 'Order not found' });
  await syncTiffinSubscriptionStatus({ ...order.toObject(), status: 'CANCELLED', type: order.type });
  await Order.findByIdAndDelete(req.params.id);
  res.json({ message: 'Order deleted' });
}

module.exports = { createOrder, createManualOrder, listOrders, getOrder, updateAmount, updateTiffinItems, updateStatus, deleteOrder, assignDeliveryMember, updatePickupDate, updateTiffinEndDate };
