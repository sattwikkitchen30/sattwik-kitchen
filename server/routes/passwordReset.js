'use strict';

const router = require('express').Router();
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const PasswordResetToken = require('../models/PasswordResetToken');
const Customer = require('../models/Customer');
const DeliveryMember = require('../models/DeliveryMember');
const Admin = require('../models/Admin');

const { checkRateLimit } = require('../utils/rateLimiter');
const emailService = require('../utils/emailService');

const VALID_ACCOUNT_TYPES = ['customer', 'delivery', 'admin', 'superadmin'];
const MIN_PASSWORD_LENGTH = 8;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function hashToken(rawToken) {
  return crypto.createHash('sha256').update(String(rawToken || '')).digest('hex');
}

/**
 * Request a password reset link
 * POST /api/password-reset/request
 * Also aliased at POST /api/auth/forgot-password
 */
async function handleResetRequest(req, res) {
  try {
    const ip = req.ip || req.connection?.remoteAddress || 'unknown';
    const { email, accountType } = req.body || {};

    // 1. Validate inputs
    const cleanEmail = String(email || '').trim().toLowerCase();
    const cleanType = String(accountType || '').trim().toLowerCase();

    if (!cleanEmail || !EMAIL_PATTERN.test(cleanEmail)) {
      return res.status(400).json({ message: 'A valid email address is required.' });
    }

    if (!cleanType || !VALID_ACCOUNT_TYPES.includes(cleanType)) {
      return res.status(400).json({
        message: 'A valid account type is required (customer, delivery, admin, or superadmin).'
      });
    }

    // 2. Rate limiting check (per IP and per email)
    const ipLimit = checkRateLimit(`ip:${ip}`);
    if (!ipLimit.allowed) {
      return res.status(429).json({
        message: `Too many password reset requests from this location. Please try again in ${ipLimit.retryAfterSeconds} seconds.`
      });
    }

    const emailLimit = checkRateLimit(`email:${cleanType}:${cleanEmail}`);
    if (!emailLimit.allowed) {
      return res.status(429).json({
        message: `Too many password reset requests for this account. Please try again in ${emailLimit.retryAfterSeconds} seconds.`
      });
    }

    // 3. Generic response message
    const genericSuccessResponse = {
      message: 'If an account exists with that email address, password reset instructions have been sent.'
    };

    // 4. Find account in corresponding collection
    let account = null;
    let displayName = '';

    if (cleanType === 'admin') {
      account = await Admin.findOne({ email: cleanEmail });
      displayName = account?.name || 'Administrator';
    } else if (cleanType === 'superadmin') {
      account = await Admin.findOne({ email: cleanEmail, role: 'superadmin' });
      displayName = account?.name || 'Superadmin';
    } else if (cleanType === 'delivery') {
      account = await DeliveryMember.findOne({ email: cleanEmail, active: true });
      displayName = account?.name || 'Delivery Member';
    } else if (cleanType === 'customer') {
      account = await Customer.findOne({ email: cleanEmail });
      displayName = account ? `${account.firstName || ''} ${account.lastName || ''}`.trim() : 'Customer';
    }

    // If no account found, return generic success to avoid disclosing account existence
    if (!account) {
      return res.json(genericSuccessResponse);
    }

    // 5. Generate secure unpredictable reset token
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = hashToken(rawToken);

    // Invalidate any previously unused reset tokens for this account
    await PasswordResetToken.updateMany(
      { accountId: account._id, accountType: cleanType, usedAt: null },
      { $set: { usedAt: new Date() } }
    );

    // Save token record with 15-minute expiry
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
    await PasswordResetToken.create({
      tokenHash,
      accountType: cleanType,
      accountId: account._id,
      email: cleanEmail,
      expiresAt
    });

    // 6. Send email via email service
    try {
      const emailResult = await emailService.sendPasswordResetEmail({
        to: cleanEmail,
        name: displayName,
        accountType: cleanType,
        rawToken
      });
      if (emailResult && !emailResult.delivered) {
        console.warn(`[passwordReset] Notice: Password reset email for ${emailService.maskEmail(cleanEmail)} was not delivered via live SMTP (${emailResult.notice || 'unconfigured'}).`);
      }
    } catch (emailErr) {
      // Make failure visible in server logs without exposing tokens/passwords
      console.error(`[passwordReset] Email dispatch error for ${emailService.maskEmail(cleanEmail)}:`, emailErr.message);
    }

    return res.json(genericSuccessResponse);
  } catch (err) {
    console.error('[passwordReset] Request failed:', err.message);
    return res.status(500).json({ message: 'Could not process password reset request.' });
  }
}

/**
 * Verify a reset token
 * GET /api/password-reset/verify?token=...&type=...
 */
async function handleVerifyToken(req, res) {
  try {
    const rawToken = String(req.query?.token || '').trim();
    const cleanType = String(req.query?.type || '').trim().toLowerCase();

    if (!rawToken) {
      return res.status(400).json({ valid: false, message: 'Reset token is required.' });
    }

    if (!cleanType || !VALID_ACCOUNT_TYPES.includes(cleanType)) {
      return res.status(400).json({ valid: false, message: 'A valid account type is required.' });
    }

    const tokenHash = hashToken(rawToken);
    const tokenDoc = await PasswordResetToken.findOne({
      tokenHash,
      accountType: cleanType,
      usedAt: null,
      expiresAt: { $gt: new Date() }
    }).lean();

    if (!tokenDoc) {
      return res.status(400).json({
        valid: false,
        message: 'This password reset link is invalid, expired, or has already been used.'
      });
    }

    return res.json({
      valid: true,
      accountType: tokenDoc.accountType,
      email: emailService.maskEmail(tokenDoc.email)
    });
  } catch (err) {
    console.error('[passwordReset] Verify failed:', err.message);
    return res.status(500).json({ valid: false, message: 'Could not verify reset link.' });
  }
}

/**
 * Reset password using valid token
 * POST /api/password-reset/reset
 */
async function handleResetPassword(req, res) {
  try {
    const { token, accountType, password, confirmPassword } = req.body || {};

    const rawToken = String(token || '').trim();
    const cleanType = String(accountType || '').trim().toLowerCase();
    const newPass = String(password || '');
    const confirmPass = String(confirmPassword || '');

    if (!rawToken) {
      return res.status(400).json({ message: 'Reset token is required.' });
    }

    if (!cleanType || !VALID_ACCOUNT_TYPES.includes(cleanType)) {
      return res.status(400).json({ message: 'A valid account type is required.' });
    }

    if (!newPass || !confirmPass) {
      return res.status(400).json({ message: 'Both password and confirm password are required.' });
    }

    if (newPass.length < MIN_PASSWORD_LENGTH) {
      return res.status(400).json({
        message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters long.`
      });
    }

    if (newPass !== confirmPass) {
      return res.status(400).json({ message: 'Passwords do not match.' });
    }

    const tokenHash = hashToken(rawToken);

    // Atomically find and consume the token to prevent race conditions & double-use
    const tokenDoc = await PasswordResetToken.findOneAndUpdate(
      {
        tokenHash,
        accountType: cleanType,
        usedAt: null,
        expiresAt: { $gt: new Date() }
      },
      { $set: { usedAt: new Date() } },
      { new: false }
    );

    if (!tokenDoc) {
      return res.status(400).json({
        message: 'This password reset link is invalid, expired, or has already been used. Please request a new one.'
      });
    }

    // Locate the matching account
    let account = null;
    if (cleanType === 'admin' || cleanType === 'superadmin') {
      account = await Admin.findById(tokenDoc.accountId);
    } else if (cleanType === 'delivery') {
      account = await DeliveryMember.findById(tokenDoc.accountId);
    } else if (cleanType === 'customer') {
      account = await Customer.findById(tokenDoc.accountId);
    }

    if (!account) {
      return res.status(404).json({ message: 'Account no longer exists.' });
    }

    // Update password hash, record change time, and bump tokenVersion to invalidate existing sessions
    account.passwordHash = bcrypt.hashSync(newPass, 12);
    account.passwordChangedAt = new Date();
    account.tokenVersion = (account.tokenVersion || 0) + 1;
    await account.save();

    // Invalidate any other active reset tokens for this account
    await PasswordResetToken.updateMany(
      { accountId: account._id, accountType: cleanType },
      { $set: { usedAt: new Date() } }
    );

    return res.json({
      message: 'Your password has been reset successfully. Please sign in with your new password.'
    });
  } catch (err) {
    console.error('[passwordReset] Reset failed:', err.message);
    return res.status(500).json({ message: 'Could not reset password right now.' });
  }
}

// Router endpoints
router.post('/request', handleResetRequest);
router.post('/forgot-password', handleResetRequest);
router.get('/verify', handleVerifyToken);
router.post('/reset', handleResetPassword);
router.post('/reset-password', handleResetPassword);

module.exports = router;
