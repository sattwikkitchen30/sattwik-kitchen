'use strict';

let nodemailer = null;
try {
  nodemailer = require('nodemailer');
} catch (e1) {
  try {
    const path = require('path');
    const nodemailerPath = require.resolve('nodemailer', {
      paths: [process.cwd(), path.resolve(__dirname, '../../')]
    });
    nodemailer = require(nodemailerPath);
  } catch (e2) {
    nodemailer = null;
  }
}

let Resend = null;
try {
  ({ Resend } = require('resend'));
} catch (e1) {
  try {
    const path = require('path');
    const resendPath = require.resolve('resend', {
      paths: [process.cwd(), path.resolve(__dirname, '../../')]
    });
    ({ Resend } = require(resendPath));
  } catch (e2) {
    Resend = null;
  }
}

function getNodemailer() {
  return nodemailer;
}

function getResendModule() {
  return Resend;
}

let _cachedResendClient = null;
let _cachedResendApiKey = null;

function getResendClient() {
  const apiKey = (process.env.RESEND_API_KEY || '').trim();
  if (!apiKey) return null;
  if (!Resend) return null;

  if (_cachedResendClient && _cachedResendApiKey === apiKey) {
    return _cachedResendClient;
  }

  _cachedResendClient = new Resend(apiKey);
  _cachedResendApiKey = apiKey;
  return _cachedResendClient;
}

function _setResendClientForTesting(client) {
  _cachedResendClient = client;
  _cachedResendApiKey = client ? (process.env.RESEND_API_KEY || 'test-key') : null;
}

const _devOutbox = new Map();

function getBaseUrl() {
  const configured = process.env.APP_BASE_URL || process.env.BASE_URL;
  if (configured && typeof configured === 'string') {
    return configured.replace(/\/+$/, '');
  }
  const port = process.env.PORT || 5000;
  return `http://localhost:${port}`;
}

function getActiveEmailProvider() {
  if (process.env.RESEND_API_KEY && String(process.env.RESEND_API_KEY).trim()) {
    return 'resend';
  }
  if (!nodemailer) return null;
  if (process.env.SMTP_URL) return 'smtp';
  if (
    process.env.EMAIL_SERVICE &&
    (process.env.EMAIL_USER || process.env.SMTP_USER) &&
    (process.env.EMAIL_PASS || process.env.SMTP_PASS)
  ) {
    return 'smtp';
  }
  if (
    process.env.SMTP_HOST &&
    (process.env.SMTP_USER || process.env.EMAIL_USER) &&
    (process.env.SMTP_PASS || process.env.EMAIL_PASS)
  ) {
    return 'smtp';
  }
  return null;
}

function isEmailConfigured() {
  return getActiveEmailProvider() !== null;
}

function getTransporter() {
  const provider = getActiveEmailProvider();
  if (provider !== 'smtp') return null;

  if (process.env.SMTP_URL) {
    return nodemailer.createTransport(process.env.SMTP_URL);
  }

  if (process.env.EMAIL_SERVICE) {
    return nodemailer.createTransport({
      service: process.env.EMAIL_SERVICE,
      auth: {
        user: process.env.EMAIL_USER || process.env.SMTP_USER,
        pass: process.env.EMAIL_PASS || process.env.SMTP_PASS
      }
    });
  }

  const port = parseInt(process.env.SMTP_PORT || '587', 10);
  const secure = process.env.SMTP_SECURE === 'true' || port === 465;

  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure,
    auth: {
      user: process.env.SMTP_USER || process.env.EMAIL_USER,
      pass: process.env.SMTP_PASS || process.env.EMAIL_PASS
    }
  });
}

function logEmailStatusOnStartup() {
  const provider = getActiveEmailProvider();
  if (provider === 'resend') {
    const fromAddress = process.env.EMAIL_FROM || 'Sattwik Kitchen <noreply@send.sattwikkitchen.ca>';
    console.log(`[emailService] Resend email service configured (sender: ${fromAddress}).`);
  } else if (provider === 'smtp') {
    const host = process.env.SMTP_HOST || process.env.EMAIL_SERVICE || 'configured service';
    console.log(`[emailService] SMTP email service configured (${host}).`);
  } else {
    console.warn('[emailService] Notice: Neither Resend nor SMTP email provider is configured. Password reset emails will not be sent to real inboxes. Configure RESEND_API_KEY and EMAIL_FROM in .env to enable email delivery.');
  }
}

function maskEmail(email) {
  if (!email || typeof email !== 'string') return '';
  const [local, domain] = email.split('@');
  if (!domain) return email;
  const visible = local.length > 2 ? local.slice(0, 2) : local.slice(0, 1);
  return `${visible}***@${domain}`;
}

async function sendPasswordResetEmail({ to, name, accountType, rawToken }) {
  const cleanEmail = String(to || '').trim().toLowerCase();
  const baseUrl = getBaseUrl();
  const resetUrl = `${baseUrl}/reset-password.html?token=${encodeURIComponent(rawToken)}&type=${encodeURIComponent(accountType)}`;

  const roleLabels = {
    customer: 'Customer',
    delivery: 'Delivery Member',
    admin: 'Administrator',
    superadmin: 'Superadmin'
  };
  const roleLabel = roleLabels[accountType] || 'Account';

  const subject = `Reset Your Sattwik Kitchen ${roleLabel} Password`;
  const textContent = `Hello ${name || 'User'},

You requested a password reset for your Sattwik Kitchen ${roleLabel} account (${cleanEmail}).

Please click or copy the link below to set a new password:
${resetUrl}

This link is valid for 15 minutes and can only be used once.

If you did not make this request, you can safely ignore this email; your password will remain unchanged.

Best regards,
Sattwik Kitchen Team`;

  const htmlContent = `
<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #26170f; background: #fffaf2; margin: 0; padding: 24px; }
    .container { max-width: 540px; margin: 0 auto; background: #ffffff; border: 1px solid #eadfce; border-radius: 16px; padding: 32px; box-shadow: 0 4px 18px rgba(0,0,0,0.06); }
    .brand { text-align: center; margin-bottom: 24px; }
    .brand img { max-width: 180px; height: auto; }
    h1 { color: #4a230f; font-size: 22px; margin-top: 0; }
    p { font-size: 14px; line-height: 1.5; color: #5f4d43; }
    .btn-wrap { text-align: center; margin: 28px 0; }
    .btn { background: #0c7a62; color: #ffffff !important; text-decoration: none; padding: 13px 26px; border-radius: 999px; font-weight: bold; font-size: 15px; display: inline-block; }
    .url-alt { word-break: break-all; font-size: 12px; color: #88796e; background: #fdf8f0; padding: 10px; border-radius: 6px; border: 1px solid #ebdccb; }
    .footer { font-size: 12px; color: #9c8e84; margin-top: 28px; border-top: 1px solid #f2e7d8; padding-top: 14px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="brand">
      <img src="https://res.cloudinary.com/spfurewl/image/upload/v1789330411/sattwik-logo.png" alt="Sattwik Kitchen Logo" />
    </div>
    <h1>Password Reset Request</h1>
    <p>Hello <strong>${escapeHtml(name || 'there')}</strong>,</p>
    <p>We received a request to reset the password for your Sattwik Kitchen <strong>${escapeHtml(roleLabel)}</strong> account (<code>${escapeHtml(cleanEmail)}</code>).</p>
    <div class="btn-wrap">
      <a href="${escapeHtml(resetUrl)}" class="btn" target="_blank" rel="noopener">Reset Your Password</a>
    </div>
    <p>This password reset link will expire in <strong>15 minutes</strong> and can only be used once.</p>
    <p>If the button above does not work, copy and paste this link into your browser:</p>
    <p class="url-alt">${escapeHtml(resetUrl)}</p>
    <div class="footer">
      <p>If you did not request a password reset, please ignore this email or contact support if you suspect unauthorized access.</p>
      <p>&copy; ${new Date().getFullYear()} Sattwik Kitchen. All rights reserved.</p>
    </div>
  </div>
</body>
</html>`;

  const provider = getActiveEmailProvider();
  const fromAddress = process.env.EMAIL_FROM || process.env.SMTP_FROM || 'Sattwik Kitchen <noreply@send.sattwikkitchen.ca>';

  // 1. Primary provider: Resend API
  if (provider === 'resend') {
    const client = getResendClient();
    if (!client) {
      console.error(`[emailService] [ERROR] Resend client initialization failed for ${maskEmail(cleanEmail)}: SDK could not be initialized.`);
      throw new Error('Email delivery failed: Resend client initialization failed');
    }

    try {
      const { data, error } = await client.emails.send({
        from: fromAddress,
        to: cleanEmail,
        subject,
        text: textContent,
        html: htmlContent
      });

      if (error) {
        console.error(`[emailService] [ERROR] Resend delivery failed for ${maskEmail(cleanEmail)}:`, error.message || error);
        throw new Error(`Email delivery failed: ${error.message || 'Resend API error'}`);
      }

      const messageId = data?.id || 'resend-ok';
      console.log(`[emailService] Password reset email sent successfully via Resend to ${maskEmail(cleanEmail)} (messageId: ${messageId})`);
      return { success: true, delivered: true, provider: 'resend', messageId };
    } catch (err) {
      if (!err.message.startsWith('Email delivery failed:')) {
        console.error(`[emailService] [ERROR] Resend delivery exception for ${maskEmail(cleanEmail)}:`, err.message);
      }
      throw err.message.startsWith('Email delivery failed:') ? err : new Error(`Email delivery failed: ${err.message}`);
    }
  }

  // 2. Fallback provider: SMTP (Nodemailer)
  if (provider === 'smtp') {
    const transporter = getTransporter();
    try {
      const info = await transporter.sendMail({
        from: fromAddress,
        to: cleanEmail,
        subject,
        text: textContent,
        html: htmlContent
      });
      console.log(`[emailService] Password reset email sent successfully via SMTP to ${maskEmail(cleanEmail)} (messageId: ${info.messageId})`);
      return { success: true, delivered: true, provider: 'smtp', messageId: info.messageId };
    } catch (err) {
      console.error(`[emailService] [ERROR] SMTP delivery failed for ${maskEmail(cleanEmail)}:`, err.message);
      throw new Error(`Email delivery failed: ${err.message}`);
    }
  }

  // 3. Safe development / fallback mode: Neither Resend nor SMTP is configured
  _devOutbox.set(cleanEmail, {
    to: cleanEmail,
    name,
    accountType,
    rawToken,
    resetUrl,
    timestamp: Date.now()
  });

  console.warn(
    `[emailService] [WARNING] Password reset email NOT sent to ${maskEmail(cleanEmail)}: Neither Resend nor SMTP provider is configured in .env. ` +
    `Configure RESEND_API_KEY and EMAIL_FROM in your .env file to enable delivery.`
  );

  return {
    success: true,
    delivered: false,
    simulated: true,
    notice: 'Neither Resend nor SMTP is configured; captured for local testing.'
  };
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getDevLastResetToken(email) {
  const cleanEmail = String(email || '').trim().toLowerCase();
  const entry = _devOutbox.get(cleanEmail);
  return entry ? entry.rawToken : null;
}

function getDevLastResetUrl(email) {
  const cleanEmail = String(email || '').trim().toLowerCase();
  const entry = _devOutbox.get(cleanEmail);
  return entry ? entry.resetUrl : null;
}

function getDevLastEntry(email) {
  const cleanEmail = String(email || '').trim().toLowerCase();
  const entry = _devOutbox.get(cleanEmail);
  return entry ? { ...entry } : null;
}

function clearDevOutbox() {
  _devOutbox.clear();
}

module.exports = {
  sendPasswordResetEmail,
  isEmailConfigured,
  getActiveEmailProvider,
  getBaseUrl,
  maskEmail,
  getTransporter,
  getNodemailer,
  getResendClient,
  getResendModule,
  logEmailStatusOnStartup,
  getDevLastResetToken,
  getDevLastResetUrl,
  getDevLastEntry,
  clearDevOutbox,
  _setResendClientForTesting
};
