const mongoose = require('mongoose');

const passwordResetTokenSchema = new mongoose.Schema({
  tokenHash: { type: String, required: true, unique: true, index: true },
  accountType: {
    type: String,
    required: true,
    enum: ['customer', 'delivery', 'admin', 'superadmin'],
    index: true
  },
  accountId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  email: { type: String, required: true, lowercase: true, trim: true },
  expiresAt: { type: Date, required: true, index: { expires: '24h' } },
  usedAt: { type: Date, default: null }
}, { timestamps: true });

passwordResetTokenSchema.index({ tokenHash: 1, accountType: 1, usedAt: 1, expiresAt: 1 });

module.exports = mongoose.model('PasswordResetToken', passwordResetTokenSchema);
