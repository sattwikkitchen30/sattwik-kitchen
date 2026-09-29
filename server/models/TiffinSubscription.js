const mongoose = require('mongoose');

const tiffinSubscriptionSchema = new mongoose.Schema({
  customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true, index: true },
  orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', required: true, index: true },
  packageType: { type: String, enum: ['full', 'curry-only'], required: true },
  size: { type: String, enum: ['single', 'couple', 'family'], required: true },
  startDate: { type: Date, required: true, index: true },
  endDate: { type: Date, required: true, index: true },
  status: { type: String, enum: ['ACTIVE', 'CANCELLED', 'EXPIRED'], default: 'ACTIVE', index: true },
  isDemo: { type: Boolean, default: false }
}, { timestamps: true });

module.exports = mongoose.model('TiffinSubscription', tiffinSubscriptionSchema);
