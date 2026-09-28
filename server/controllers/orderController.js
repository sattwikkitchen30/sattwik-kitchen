const mongoose = require('mongoose');
const Order = require('../models/Order');
const Customer = require('../models/Customer');
const Product = require('../models/Product');
const { TIFFIN_PRICES, tiffinDisplayName, ORDER_STATUSES, DELIVERY_STATUSES, STATUS_TRANSITIONS } = require('../utils/constants');
const { emitOrderUpdate } = require('../utils/orderEvents');

async function createOrder(req, res) {
  if (!req.customer) return res.status(401).json({ message: 'Customer sign-in required before placing an order.' });
  const { items = [], tiffinPlans = [], customRequest = '', customAmount = 0, type = 'product' } = req.body || {};

  const firstName = String(req.customer.firstName || '').trim();
  const lastName = String(req.customer.lastName || '').trim();
  const phone = String(req.customer.phone || '').trim();
  const email = String(req.customer.email || '').trim().toLowerCase();
  const area = String(req.customer.area || '').trim();

  if (!firstName || !lastName || !phone || !email.includes('@')) {
    return res.status(400).json({ message: 'Please provide first name, last name, phone and a valid email.' });
  }

  const orderItems = [];
  let totalAmount = 0;
  let orderType = ['tiffin', 'catering', 'custom'].includes(type) ? type : 'product';

  if (Array.isArray(items) && items.length) {
    const ids = items.map((i) => i.productId).filter((id) => mongoose.isValidObjectId(id));
    const products = ids.length ? await Product.find({ _id: { $in: ids }, active: true }).lean() : [];
    const byId = new Map(products.map((p) => [String(p._id), p]));

    for (const raw of items) {
      if (raw.productId && mongoose.isValidObjectId(raw.productId)) {
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
          subtotal
        });
      } else if (raw.productName && (Number(raw.price || raw.priceAtPurchase) >= 0)) {
        const price = Math.round(Number(raw.price || raw.priceAtPurchase) * 100) / 100;
        const quantity = Math.max(1, Math.min(99, parseInt(raw.quantity, 10) || 1));
        const subtotal = Math.round(price * quantity * 100) / 100;
        totalAmount += subtotal;
        orderItems.push({
          productId: null,
          productName: String(raw.productName).trim(),
          category: raw.category || 'Custom',
          priceAtPurchase: price,
          quantity,
          subtotal
        });
      }
    }
  }

  let tiffinPlanMeta = { packageType: null, size: null, price: null };
  if (Array.isArray(tiffinPlans) && tiffinPlans.length) {
    orderType = 'tiffin';

    for (const tp of tiffinPlans) {
      const price = TIFFIN_PRICES[tp.packageType] && TIFFIN_PRICES[tp.packageType][tp.size];
      if (!price) {
        return res.status(400).json({ message: 'Invalid tiffin plan selection.' });
      }
      const quantity = Math.max(1, parseInt(tp.quantity, 10) || 1);
      const name = tiffinDisplayName(tp.packageType, tp.size);
      const subtotal = price * quantity;
      totalAmount += subtotal;
      orderItems.push({
        productId: null,
        productName: name,
        category: 'Tiffin Plans',
        priceAtPurchase: price,
        quantity,
        subtotal
      });
      tiffinPlanMeta = { packageType: tp.packageType, size: tp.size, price };
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

  const customerDoc = await Customer.findById(req.customer._id);
  if (!customerDoc) return res.status(401).json({ message: 'Customer account no longer exists.' });

  const order = await Order.create({
    customer: customerDoc._id,
    customerId: customerDoc._id,
    items: orderItems,
    type: orderType,
    tiffinPlan: tiffinPlanMeta,
    customRequest: cleanCustom,
    totalAmount,
    deliveryAddress: customerDoc.address || area,
    status: 'PENDING',
    placedAt: new Date()
  });

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
  res.status(201).json({ message: 'Order saved', order: populated });
}

async function listOrders(req, res) {
  const { status, type, area, search, sort = '-createdAt', page = 1, limit = 15, from, to } = req.query;
  const match = {};
  if (status) match.status = status;
  if (type) match.type = type;
  if (from || to) {
    match.createdAt = {};
    if (from) match.createdAt.$gte = new Date(from + 'T00:00:00.000Z');
    if (to) match.createdAt.$lte = new Date(to + 'T23:59:59.999Z');
  }
  if (area) match.area = new RegExp(area, 'i');
  if (search) {
    match.$or = [
      { orderId: new RegExp(search, 'i') },
      { customerName: new RegExp(search, 'i') }
    ];
  }

  const safeSort = ['createdAt', '-createdAt', 'totalAmount', '-totalAmount', 'status', '-status'].includes(sort) ? sort : '-createdAt';
  const p = Math.max(1, parseInt(page, 10) || 1);
  const l = Math.min(100, Math.max(1, parseInt(limit, 10) || 15));

  const pipeline = [
    { $lookup: { from: 'customers', localField: 'customer', foreignField: '_id', as: 'customerDoc' } },
    { $unwind: '$customerDoc' },
    { $lookup: { from: 'deliverymembers', localField: 'deliveryMemberId', foreignField: '_id', as: 'deliveryMemberDoc' } },
    { $unwind: { path: '$deliveryMemberDoc', preserveNullAndEmptyArrays: true } }
  ];

  if (Object.keys(match).length) {
    pipeline.push({ $match: match });
  }

  pipeline.push({
    $facet: {
      data: [
        { $sort: { [safeSort.replace('-', '')]: safeSort.startsWith('-') ? -1 : 1 } },
        { $skip: (p - 1) * l },
        { $limit: l }
      ],
      total: [{ $count: 'n' }]
    }
  });

  const [result] = await Order.aggregate(pipeline);
  const total = result?.total?.[0]?.n || 0;

  const statusCounts = await Order.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]);

  res.json({
    orders: result?.data || [],
    total,
    page: p,
    pages: Math.ceil(total / l),
    statusCounts: Object.fromEntries(statusCounts.map((s) => [s._id, s.n]))
  });
}

async function getOrder(req, res) {
  const order = await Order.findById(req.params.id).populate('customer', 'firstName lastName phone email area');
  if (!order) return res.status(404).json({ message: 'Order not found' });
  res.json({ order });
}

async function updateStatus(req, res) {
  const status = String(req.body?.status || '');
  if (!ORDER_STATUSES.includes(status)) return res.status(400).json({ message: 'Invalid status' });
  const order = await Order.findById(req.params.id);
  if (!order) return res.status(404).json({ message: 'Order not found' });
  if (DELIVERY_STATUSES.includes(order.status) || DELIVERY_STATUSES.includes(status)) {
    if (STATUS_TRANSITIONS[order.status] !== status) return res.status(400).json({ message: `Invalid transition from ${order.status} to ${status}.` });
    if (status === 'ACCEPTED') order.acceptedAt = new Date();
    if (status === 'OUT_FOR_DELIVERY') order.outForDeliveryAt = new Date();
    if (status === 'DELIVERED') order.deliveredAt = new Date();
  }
  order.status = status;
  await order.save();
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
  
  if (['CANCELLED', 'cancelled', 'DELIVERED', 'delivered'].includes(order.status)) {
    return res.status(400).json({ message: 'Cannot assign a cancelled or delivered order' });
  }

  order.deliveryMemberId = deliveryMemberId;
  if (['PENDING', 'pending'].includes(order.status) || !order.status) {
    order.status = 'ACCEPTED';
    order.acceptedAt = new Date();
  }
  await order.save();
  
  const populated = await Order.findById(order._id).populate('customer', 'firstName lastName phone email address area').populate('deliveryMemberId', 'name phone email');
  emitOrderUpdate(req.app, populated);
  res.json({ message: 'Order assigned to delivery member', order: populated });
}

async function deleteOrder(req, res) {
  const order = await Order.findByIdAndDelete(req.params.id);
  if (!order) return res.status(404).json({ message: 'Order not found' });
  res.json({ message: 'Order deleted' });
}

module.exports = { createOrder, listOrders, getOrder, updateStatus, deleteOrder, assignDeliveryMember };
