const mongoose = require('mongoose');
const { ORDER_STATUSES } = require('../utils/constants');

const itemSchema = new mongoose.Schema({
  productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', default: null },
  productName: { type: String, required: true },
  category: { type: String, default: 'General' },
  fulfillment: { type: String, enum: ['pickup', 'delivery'], default: 'pickup' },
  deliveryStatus: { type: String, enum: ['PENDING', 'ACCEPTED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED', 'EXPIRED'], default: null },
  priceAtPurchase: { type: Number, required: true, min: 0 },
  quantity: { type: Number, required: true, min: 1 },
  subtotal: { type: Number, required: true, min: 0 }
}, { _id: false });

const tiffinItemSchema = new mongoose.Schema({
  productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', default: null },
  productName: { type: String, required: true },
  category: { type: String, default: 'Tiffin Preparation' },
  preparationType: { type: String, default: null },
  quantity: { type: Number, required: true, min: 1 },
  isAdditional: { type: Boolean, default: false },
  itemKey: { type: String, default: null },
  size: { type: String, default: null },
  originalQuantity: { type: Number, default: 0 },
  additionalQuantity: { type: Number, default: 0 }
}, { _id: false });

const customerSnapshotSchema = new mongoose.Schema({
  firstName: { type: String, trim: true, default: '' },
  lastName: { type: String, trim: true, default: '' },
  phone: { type: String, trim: true, default: '' },
  email: { type: String, trim: true, lowercase: true, default: '' },
  address: { type: String, trim: true, default: '' },
  area: { type: String, trim: true, default: '' }
}, { _id: false });

const paymentSchema = new mongoose.Schema({
  amount: { type: Number, required: true, min: 0 },
  paymentDate: { type: Date, required: true },
  method: { type: String, required: true, enum: ['Cash', 'E-transfer', 'Other'] },
  notes: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now }
}, { _id: true });

const commentSchema = new mongoose.Schema({
  orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', required: true },
  fulfillment: { type: String, enum: ['pickup', 'delivery'], required: true, default: 'delivery' },
  authorType: { type: String, enum: ['admin', 'customer'], required: true },
  authorId: { type: mongoose.Schema.Types.ObjectId, default: null },
  authorName: { type: String, default: '' },
  text: { type: String, required: true, maxlength: 2000 },
  createdAt: { type: Date, default: Date.now }
}, { _id: true });

const orderSchema = new mongoose.Schema({
  orderId: { type: String, unique: true, index: true },
  customer: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true },
  customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: false, index: true },
  customerSnapshot: { type: customerSnapshotSchema, default: undefined },
  pickupDate: { type: Date, default: null },
  subscriptionStartDate: { type: Date, default: null, index: true },
  subscriptionEndDate: { type: Date, default: null, index: true },
  items: { type: [itemSchema], default: [] },
  tiffinItems: { type: [tiffinItemSchema], default: undefined },
  tiffinItemsCustomized: { type: Boolean, default: false },
  fulfillment: { type: String, enum: ['pickup', 'delivery', 'mixed'], default: 'pickup' },
  type: { type: String, enum: ['product', 'tiffin', 'catering', 'custom'], default: 'product' },
  tiffinPlan: {
    packageType: { type: String, default: null },
    size: { type: String, default: null },
    price: { type: Number, default: null },
    displayName: { type: String, default: null }
  },
  customRequest: { type: String, default: '' },
  customerFeedback: { type: Map, of: String, default: undefined },
  comments: { type: [commentSchema], default: [] },
  manualDeliveryNotifications: {
    type: [{
      notifiedAt: { type: Date, default: Date.now },
      deliveryMemberId: { type: mongoose.Schema.Types.ObjectId, ref: 'DeliveryMember' },
      recipientPhone: { type: String, default: '' },
      channel: { type: String, default: 'whatsapp' },
      orderStatus: { type: String, default: '' }
    }],
    default: []
  },
  lastNotifiedAt: { type: Date, default: null },
  whatsappDeliveryNotifications: {
    type: [{
      deliveryDate: { type: Date },
      dateKey: { type: String },
      sent: { type: Boolean, default: false },
      sentAt: { type: Date, default: null },
      recipientPhone: { type: String, default: '' },
      messageId: { type: String, default: null },
      status: { type: String, default: 'pending' },
      error: { type: String, default: null }
    }],
    default: []
  },
  totalAmount: { type: Number, required: true, min: 0 },
  payments: { type: [paymentSchema], default: [] },
  deliveryAddress: { type: String, default: '' },
  deliveryMemberId: { type: mongoose.Schema.Types.ObjectId, ref: 'DeliveryMember', default: null },
  placedAt: { type: Date, default: Date.now },
  acceptedAt: { type: Date, default: null },
  outForDeliveryAt: { type: Date, default: null },
  deliveredAt: { type: Date, default: null },
  firstDeliveredAt: { type: Date, default: null },
  cancelledAt: { type: Date, default: null },
  deliveryStatusDate: { type: Date, default: null },
  status: { type: String, enum: ORDER_STATUSES, default: 'pending' },
  isDemo: { type: Boolean, default: false }
}, { timestamps: true });

orderSchema.index(
  { customer: 1, type: 1, 'tiffinPlan.packageType': 1, 'tiffinPlan.size': 1, subscriptionStartDate: 1 },
  { unique: true, sparse: true, partialFilterExpression: { type: 'tiffin' } }
);

orderSchema.pre('validate', async function () {
  if (Array.isArray(this.items) && this.items.length) {
    this.items.forEach((item) => {
      const name = String(item?.productName || '').trim();
      const cat = String(item?.category || '').trim().toLowerCase();
      const isDelivery = item?.fulfillment === 'delivery'
        || cat === 'tiffin plans'
        || cat === 'tiffin preparation'
        || cat === 'tiffin'
        || /^(?:Full Meal Package|Curry(?:-|\s+)Only Package)\s*\(/i.test(name);
      item.fulfillment = isDelivery ? 'delivery' : 'pickup';
    });
    const deliveryCount = this.items.filter((item) => item.fulfillment === 'delivery').length;
    this.fulfillment = deliveryCount === 0 ? 'pickup' : (deliveryCount === this.items.length ? 'delivery' : 'mixed');
  }

  if (!this.orderId) {
    const { formatDateKey } = require('../utils/tiffinPreparation');
    const date = this.placedAt || this.createdAt || new Date();
    const dayKey = formatDateKey(date).replace(/-/g, '').slice(2);
    const OrderCounter = require('./OrderCounter');
    let counter;
    try {
      counter = await OrderCounter.findOneAndUpdate(
        { _id: dayKey },
        { $inc: { sequence: 1 } },
        { new: true, upsert: true, setDefaultsOnInsert: true }
      );
    } catch (error) {
      if (error.code !== 11000) throw error;
      counter = await OrderCounter.findOneAndUpdate(
        { _id: dayKey },
        { $inc: { sequence: 1 } },
        { new: true }
      );
    }
    if (counter.sequence > 99999) throw new Error(`Daily order sequence exhausted for ${dayKey}.`);
    this.orderId = `${dayKey}${String(counter.sequence).padStart(5, '0')}`;
  }
});

module.exports = mongoose.model('Order', orderSchema);
