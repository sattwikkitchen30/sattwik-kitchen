const mongoose = require('mongoose');

const tiffinSubscriptionSchema = new mongoose.Schema({
  customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true, index: true },
  orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', required: true, index: true },
  packageType: { type: String, enum: ['full', 'curry-only'], required: true },
  size: { type: String, enum: ['single', 'couple', 'family'], required: true },
  quantity: { type: Number, required: true, min: 1, default: 1 },
  startDate: { type: Date, required: true, index: true },
  endDate: { type: Date, required: true, index: true },
  status: { type: String, enum: ['ACTIVE', 'CANCELLED', 'EXPIRED'], default: 'ACTIVE', index: true },
  isDemo: { type: Boolean, default: false }
}, { timestamps: true, autoIndex: false });

tiffinSubscriptionSchema.index(
  { orderId: 1, packageType: 1, size: 1 },
  { unique: true }
);

module.exports = mongoose.model('TiffinSubscription', tiffinSubscriptionSchema);
