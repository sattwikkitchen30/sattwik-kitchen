const mongoose = require('mongoose');

const deliveryMemberSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  phone: { type: String, default: '', trim: true },
  passwordHash: { type: String, required: true, select: false },
  passwordChangedAt: { type: Date },
  tokenVersion: { type: Number, default: 0 },
  active: { type: Boolean, default: true }
}, { timestamps: true });

module.exports = mongoose.model('DeliveryMember', deliveryMemberSchema);
