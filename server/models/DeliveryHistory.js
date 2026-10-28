const mongoose = require('mongoose');

const deliveryHistorySchema = new mongoose.Schema({
  orderId: { type: String, required: true, index: true },
  order: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', required: true },
  deliveryMemberId: { type: mongoose.Schema.Types.ObjectId, ref: 'DeliveryMember', required: true, index: true },
  deliveryDate: { type: Date, required: true, index: true }, // Vancouver business date as Date (UTC midnight)
  deliveredAt: { type: Date, required: true }, // Actual timestamp when delivered
  customerSnapshot: {
    firstName: { type: String, trim: true, default: '' },
    lastName: { type: String, trim: true, default: '' },
    phone: { type: String, trim: true, default: '' },
    email: { type: String, trim: true, lowercase: true, default: '' },
    address: { type: String, trim: true, default: '' },
    area: { type: String, trim: true, default: '' }
  },
  orderAmount: { type: Number, required: true, min: 0 },
  deliverySnapshot: {
    orderType: { type: String, enum: ['product', 'tiffin', 'catering', 'custom'], default: 'product' },
    fulfillment: { type: String, enum: ['pickup', 'delivery', 'mixed'], default: 'delivery' },
    tiffinPlan: {
      packageType: { type: String, enum: ['full', 'curry-only'], default: null },
      size: { type: String, enum: ['single', 'couple', 'family'], default: null }
    }
  },
  whatsappNotification: {
    sent: { type: Boolean, default: false },
    sentAt: { type: Date, default: null },
    recipientPhone: { type: String, default: '' },
    messageId: { type: String, default: null },
    status: { type: String, enum: ['pending', 'sent', 'failed', 'unconfigured', 'skipped'], default: 'pending' },
    error: { type: String, default: null },
    provider: { type: String, default: null },
    messageBody: { type: String, default: null },
    attempts: { type: Number, default: 0 },
    lastAttemptAt: { type: Date, default: null }
  }
}, { timestamps: true });

// Unique index to prevent duplicate delivery records for the same order on the same date by the same member
deliveryHistorySchema.index({ orderId: 1, deliveryDate: 1, deliveryMemberId: 1 }, { unique: true });

module.exports = mongoose.model('DeliveryHistory', deliveryHistorySchema);
