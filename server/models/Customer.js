const mongoose = require('mongoose');

const customerSchema = new mongoose.Schema({
  firstName: { type: String, required: true, trim: true },
  lastName: { type: String, required: true, trim: true },
  phone: { type: String, required: true, trim: true },
  email: { type: String, required: true, trim: true, lowercase: true },
  area: { type: String, default: '', trim: true },
  address: { type: String, default: '', trim: true },
  passwordHash: { type: String, default: '', select: false },
  passwordChangedAt: { type: Date },
  tokenVersion: { type: Number, default: 0 },
  isDemo: { type: Boolean, default: false }
}, { timestamps: true });

customerSchema.index({ email: 1, phone: 1 }, { unique: true });

module.exports = mongoose.model('Customer', customerSchema);
