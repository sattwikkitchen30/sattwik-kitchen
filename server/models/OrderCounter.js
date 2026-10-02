const mongoose = require('mongoose');

const orderCounterSchema = new mongoose.Schema({
  _id: { type: String },
  sequence: { type: Number, required: true, default: 0 }
}, { versionKey: false });

module.exports = mongoose.model('OrderCounter', orderCounterSchema);