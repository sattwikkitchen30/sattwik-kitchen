const router = require('express').Router();
const bcrypt = require('bcryptjs');
const DeliveryMember = require('../models/DeliveryMember');
const { signDeliveryToken, deliveryAuthRequired } = require('../middleware/deliveryAuth');

const MIN_PASSWORD_LENGTH = 8;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function publicMember(member) {
  return { id: String(member._id), name: member.name, email: member.email, phone: member.phone };
}

router.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  const member = await DeliveryMember.findOne({ email: String(email || '').trim().toLowerCase(), active: true }).select('+passwordHash');
  if (!member || !bcrypt.compareSync(String(password || ''), member.passwordHash)) {
    return res.status(401).json({ message: 'Invalid delivery email or password.' });
  }
  res.json({ token: signDeliveryToken(member), member: publicMember(member) });
});

// Remove public signup - only admins can create delivery members
router.post('/signup', async (req, res) => {
  return res.status(403).json({ message: 'Public delivery account creation is disabled. Contact an administrator.' });
});

router.get('/me', deliveryAuthRequired, (req, res) => res.json({ member: publicMember(req.deliveryMember) }));
router.post('/logout', deliveryAuthRequired, (req, res) => res.json({ message: 'Logged out' }));

router.post('/change-password', deliveryAuthRequired, async (req, res) => {
  try {
    const { currentPassword, newPassword, confirmPassword } = req.body || {};
    const next = String(newPassword || '');
    const confirm = confirmPassword === undefined ? next : String(confirmPassword);

    if (!String(currentPassword || '')) return res.status(400).json({ message: 'Current password is required' });
    if (next.length < MIN_PASSWORD_LENGTH) {
      return res.status(400).json({ message: `New password must be at least ${MIN_PASSWORD_LENGTH} characters` });
    }
    if (next !== confirm) return res.status(400).json({ message: 'New passwords do not match' });

    const member = await DeliveryMember.findById(req.deliveryMember._id).select('+passwordHash');
    if (!member) return res.status(401).json({ message: 'Account no longer exists' });
    if (!bcrypt.compareSync(String(currentPassword), member.passwordHash)) {
      return res.status(401).json({ message: 'Current password is incorrect' });
    }
    if (bcrypt.compareSync(next, member.passwordHash)) {
      return res.status(400).json({ message: 'New password must be different from the current password' });
    }

    member.passwordHash = bcrypt.hashSync(next, 12);
    await member.save();

    res.json({ message: 'Password updated successfully. Please sign in again.', reauthRequired: true });
  } catch (err) {
    console.error('[deliveryAuth] change password failed:', err.message);
    res.status(500).json({ message: 'Could not update the password' });
  }
});

module.exports = router;
