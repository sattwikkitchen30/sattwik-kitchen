const mongoose = require('mongoose');

const tiffinMenuSelectionSchema = new mongoose.Schema({
  date: { type: String, required: true, unique: true, index: true },
  dalOption: { type: String, default: 'Not selected' },
  curryOption: { type: String, default: 'Not selected' },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin', default: null }
}, { timestamps: true });

module.exports = mongoose.model('TiffinMenuSelection', tiffinMenuSelectionSchema);
