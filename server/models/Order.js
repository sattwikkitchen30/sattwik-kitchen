const mongoose = require('mongoose');
const { ORDER_STATUSES } = require('../utils/constants');

const itemSchema = new mongoose.Schema({
  productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', default: null },
  productName: { type: String, required: true },
  category: { type: String, default: 'General' },
  fulfillment: { type: String, enum: ['pickup', 'delivery'], default: 'pickup' },
  deliveryStatus: { type: String, enum: ['PENDING', 'ACCEPTED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED'], default: null },
  priceAtPurchase: { type: Number, required: true, min: 0 },
  quantity: { type: Number, required: true, min: 1 },
  subtotal: { type: Number, required: true, min: 0 }
}, { _id: false });

const orderSchema = new mongoose.Schema({
  orderId: { type: String, unique: true, index: true },
  customer: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true },
  customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: false, index: true },
  subscriptionStartDate: { type: Date, default: null, index: true },
  subscriptionEndDate: { type: Date, default: null, index: true },
  items: { type: [itemSchema], default: [] },
  fulfillment: { type: String, enum: ['pickup', 'delivery', 'mixed'], default: 'pickup' },
  type: { type: String, enum: ['product', 'tiffin', 'catering', 'custom'], default: 'product' },
  tiffinPlan: {
    packageType: { type: String, enum: ['full', 'curry-only'], default: null },
    size: { type: String, enum: ['single', 'couple', 'family'], default: null },
    price: { type: Number, default: null }
  },
  customRequest: { type: String, default: '' },
  totalAmount: { type: Number, required: true, min: 0 },
  deliveryAddress: { type: String, default: '' },
  deliveryMemberId: { type: mongoose.Schema.Types.ObjectId, ref: 'DeliveryMember', default: null },
  placedAt: { type: Date, default: Date.now },
  acceptedAt: { type: Date, default: null },
  outForDeliveryAt: { type: Date, default: null },
  deliveredAt: { type: Date, default: null },
  status: { type: String, enum: ORDER_STATUSES, default: 'pending' },
  isDemo: { type: Boolean, default: false }
}, { timestamps: true });

orderSchema.index(
  { customer: 1, type: 1, 'tiffinPlan.packageType': 1, 'tiffinPlan.size': 1, subscriptionStartDate: 1 },
  { unique: true, sparse: true, partialFilterExpression: { type: 'tiffin' } }
);

orderSchema.pre('validate', function (next) {
  if (!this.orderId) {
    const rand = Math.random().toString(36).substring(2, 8).toUpperCase();
    this.orderId = 'SK-' + rand;
  }
  next();
});

module.exports = mongoose.model('Order', orderSchema);
