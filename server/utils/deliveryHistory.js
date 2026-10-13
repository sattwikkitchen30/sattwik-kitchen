const mongoose = require('mongoose');
const DeliveryHistory = require('../models/DeliveryHistory');
const Order = require('../models/Order');
const { formatDateKey, startOfDay } = require('./tiffinPreparation');
const BUSINESS_TIMEZONE = process.env.BUSINESS_TIMEZONE || 'America/Vancouver';

/**
 * Records a delivery history entry when a delivery is completed
 * @param {Object} order - The order that was delivered
 * @param {Date} deliveredAt - The timestamp when delivery was completed
 * @returns {Promise<Object>} The created delivery history record or error
 */
async function recordDeliveryHistory(order, deliveredAt) {
  if (!order || !order._id) {
    return { error: 'Order is required' };
  }
  
  if (!order.deliveryMemberId) {
    return { error: 'Delivery member not assigned' };
  }
  
  // Skip recording if deliveryMemberId is not a valid ObjectId (e.g., in tests)
  try {
    if (typeof order.deliveryMemberId === 'string' && !mongoose.Types.ObjectId.isValid(order.deliveryMemberId)) {
      return { skipped: true, reason: 'Invalid deliveryMemberId' };
    }
  } catch (e) {
    return { skipped: true, reason: 'Invalid deliveryMemberId' };
  }
  
  // Calculate Vancouver business date for the delivery
  const deliveryDate = startOfDay(deliveredAt);
  
  // Create customer snapshot
  const customerSnapshot = {
    firstName: order.customerSnapshot?.firstName || '',
    lastName: order.customerSnapshot?.lastName || '',
    phone: order.customerSnapshot?.phone || '',
    email: order.customerSnapshot?.email || '',
    address: order.customerSnapshot?.address || '',
    area: order.customerSnapshot?.area || ''
  };
  
  // Create delivery snapshot
  const deliverySnapshot = {
    orderType: order.type || 'product',
    fulfillment: order.fulfillment || 'delivery',
    tiffinPlan: order.tiffinPlan ? {
      packageType: order.tiffinPlan.packageType,
      size: order.tiffinPlan.size
    } : null
  };
  
  try {
    // Use findOneAndUpdate with upsert to ensure idempotency
    // If a record already exists for this order+date+member, don't create a duplicate
    const history = await DeliveryHistory.findOneAndUpdate(
      {
        orderId: order.orderId,
        deliveryDate: deliveryDate,
        deliveryMemberId: order.deliveryMemberId
      },
      {
        order: order._id,
        deliveryMemberId: order.deliveryMemberId,
        deliveryDate: deliveryDate,
        deliveredAt: deliveredAt,
        customerSnapshot,
        orderAmount: order.totalAmount || 0,
        deliverySnapshot
      },
      {
        upsert: true,
        new: true,
        setDefaultsOnInsert: true
      }
    );
    
    return { history };
  } catch (error) {
    if (error.code === 11000) {
      // Duplicate key error - record already exists (idempotent)
      const existing = await DeliveryHistory.findOne({
        orderId: order.orderId,
        deliveryDate: deliveryDate,
        deliveryMemberId: order.deliveryMemberId
      });
      return { history: existing, existing: true };
    }
    console.error('[deliveryHistory] record failed:', error.message);
    return { error: error.message };
  }
}

/**
 * Gets delivery history for a specific member with optional date filtering
 * @param {String} deliveryMemberId - The delivery member ID
 * @param {Object} options - Filter options
 * @param {String} options.fromDate - ISO date string (YYYY-MM-DD) for range start
 * @param {String} options.toDate - ISO date string (YYYY-MM-DD) for range end
 * @param {Number} options.year - Year for month filter
 * @param {Number} options.month - Month (1-12) for month filter
 * @param {Number} options.limit - Limit for pagination
 * @param {Number} options.skip - Skip for pagination
 * @returns {Promise<Object>} History records and count
 */
async function getMemberDeliveryHistory(deliveryMemberId, options = {}) {
  const { fromDate, toDate, year, month, limit = 100, skip = 0 } = options;
  
  const match = { deliveryMemberId };
  
  // Handle date range filter
  if (fromDate || toDate) {
    match.deliveryDate = {};
    if (fromDate) {
      const start = startOfDay(new Date(fromDate));
      if (start) match.deliveryDate.$gte = start;
    }
    if (toDate) {
      const end = startOfDay(new Date(toDate));
      if (end) {
        // Add 1 day to get exclusive end of to date
        const nextDay = new Date(end.getTime() + 24 * 60 * 60 * 1000);
        match.deliveryDate.$lt = nextDay;
      }
    }
  }
  
  // Handle month filter
  if (year && month) {
    const startOfMonth = new Date(year, month - 1, 1);
    const endOfMonth = new Date(year, month, 1);
    match.deliveryDate = {
      $gte: startOfMonth,
      $lt: endOfMonth
    };
  }
  
  try {
    const [history, total] = await Promise.all([
      DeliveryHistory.find(match)
        .populate('order', 'orderId totalAmount type fulfillment tiffinPlan')
        .sort({ deliveryDate: -1, deliveredAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      DeliveryHistory.countDocuments(match)
    ]);
    
    return { history, total };
  } catch (error) {
    console.error('[deliveryHistory] query failed:', error.message);
    return { error: error.message, history: [], total: 0 };
  }
}

/**
 * Gets delivery count for a member with optional date filtering
 * @param {String} deliveryMemberId - The delivery member ID
 * @param {Object} options - Filter options (same as getMemberDeliveryHistory)
 * @returns {Promise<Number>} Delivery count
 */
async function getMemberDeliveryCount(deliveryMemberId, options = {}) {
  const { fromDate, toDate, year, month } = options;
  
  const match = { deliveryMemberId };
  
  // Handle date range filter
  if (fromDate || toDate) {
    match.deliveryDate = {};
    if (fromDate) {
      const start = startOfDay(new Date(fromDate));
      if (start) match.deliveryDate.$gte = start;
    }
    if (toDate) {
      const end = startOfDay(new Date(toDate));
      if (end) {
        const nextDay = new Date(end.getTime() + 24 * 60 * 60 * 1000);
        match.deliveryDate.$lt = nextDay;
      }
    }
  }
  
  // Handle month filter
  if (year && month) {
    const startOfMonth = new Date(year, month - 1, 1);
    const endOfMonth = new Date(year, month, 1);
    match.deliveryDate = {
      $gte: startOfMonth,
      $lt: endOfMonth
    };
  }
  
  try {
    return await DeliveryHistory.countDocuments(match);
  } catch (error) {
    console.error('[deliveryHistory] count failed:', error.message);
    return 0;
  }
}

/**
 * Deletes all delivery history records for a member
 * @param {String} deliveryMemberId - The delivery member ID
 * @returns {Promise<Object>} Result with count of deleted records
 */
async function deleteMemberDeliveryHistory(deliveryMemberId) {
  try {
    const result = await DeliveryHistory.deleteMany({ deliveryMemberId });
    return { deletedCount: result.deletedCount };
  } catch (error) {
    console.error('[deliveryHistory] delete failed:', error.message);
    return { error: error.message, deletedCount: 0 };
  }
}

module.exports = {
  recordDeliveryHistory,
  getMemberDeliveryHistory,
  getMemberDeliveryCount,
  deleteMemberDeliveryHistory
};
