const router = require('express').Router();
const bcrypt = require('bcryptjs');
const Admin = require('../models/Admin');
const { signToken, authRequired } = require('../middleware/auth');

const MIN_PASSWORD_LENGTH = 8;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function publicAdmin(admin) {
  return { id: admin._id, email: admin.email, name: admin.name, role: admin.role, createdAt: admin.createdAt };
}

function validateNewAdmin({ name, email, password, confirmPassword }) {
  const cleanName = String(name || '').trim();
  const cleanEmail = String(email || '').trim().toLowerCase();
  const pass = String(password || '');
  const confirm = String(confirmPassword || '');

  if (!cleanName) return { error: 'Admin name is required' };
  if (!cleanEmail) return { error: 'Email is required' };
  if (!EMAIL_PATTERN.test(cleanEmail)) return { error: 'Enter a valid email address' };
  if (!pass || !confirm) return { error: 'Password and confirm password are required' };
  if (pass.length < MIN_PASSWORD_LENGTH) return { error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` };
  if (pass !== confirm) return { error: 'Passwords do not match' };

  return { value: { name: cleanName, email: cleanEmail, password: pass } };
}

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ message: 'Email and password are required' });
    const admin = await Admin.findOne({ email: String(email).toLowerCase().trim() });
    if (!admin || !bcrypt.compareSync(String(password), admin.passwordHash)) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }
    res.json({
      token: signToken(admin),
      admin: { email: admin.email, name: admin.name, role: admin.role }
    });
  } catch (err) {
    console.error('[auth] login failed:', err.message);
    res.status(500).json({ message: 'Could not sign in right now' });
  }
});

router.get('/admins', authRequired, async (req, res) => {
  try {
    const admins = await Admin.find().select('email name role createdAt').sort('createdAt').lean();
    res.json({ admins: admins.map(publicAdmin) });
  } catch (err) {
    console.error('[auth] list admins failed:', err.message);
    res.status(500).json({ message: 'Could not load admins' });
  }
});

// Creating an admin is restricted to signed-in admins.
async function createAdmin(req, res) {
  try {
    const { error, value } = validateNewAdmin(req.body || {});
    if (error) return res.status(400).json({ message: error });

    if (await Admin.exists({ email: value.email })) {
      return res.status(409).json({ message: 'An admin account already exists for this email' });
    }

    const admin = await Admin.create({
      name: value.name,
      email: value.email,
      passwordHash: bcrypt.hashSync(value.password, 10),
      role: 'admin'
    });

    res.status(201).json({ message: 'Admin created successfully', admin: publicAdmin(admin) });
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ message: 'An admin account already exists for this email' });
    if (err.name === 'ValidationError') {
      return res.status(400).json({ message: Object.values(err.errors).map((e) => e.message).join(', ') });
    }
    console.error('[auth] create admin failed:', err.message);
    res.status(500).json({ message: 'Could not create the admin account' });
  }
}

router.post('/admins', authRequired, createAdmin);
router.post('/signup', authRequired, createAdmin);

router.post('/logout', authRequired, (req, res) => res.json({ message: 'Logged out' }));
router.get('/me', authRequired, (req, res) => res.json({ admin: req.admin }));

router.post('/change-password', authRequired, async (req, res) => {
  try {
    const { currentPassword, newPassword, confirmPassword } = req.body || {};
    const next = String(newPassword || '');
    const confirm = confirmPassword === undefined ? next : String(confirmPassword);

    if (!String(currentPassword || '')) return res.status(400).json({ message: 'Current password is required' });
    if (next.length < MIN_PASSWORD_LENGTH) {
      return res.status(400).json({ message: `New password must be at least ${MIN_PASSWORD_LENGTH} characters` });
    }
    if (next !== confirm) return res.status(400).json({ message: 'New passwords do not match' });

    const admin = await Admin.findById(req.admin.id);
    if (!admin) return res.status(401).json({ message: 'Account no longer exists' });
    if (!bcrypt.compareSync(String(currentPassword), admin.passwordHash)) {
      return res.status(401).json({ message: 'Current password is incorrect' });
    }
    if (bcrypt.compareSync(next, admin.passwordHash)) {
      return res.status(400).json({ message: 'New password must be different from the current password' });
    }

    admin.passwordHash = bcrypt.hashSync(next, 10);
    admin.passwordChangedAt = new Date();
    admin.tokenVersion = (admin.tokenVersion || 0) + 1;
    await admin.save();

    res.json({ message: 'Password updated. Please sign in again.', reauthRequired: true });
  } catch (err) {
    console.error('[auth] change password failed:', err.message);
    res.status(500).json({ message: 'Could not update the password' });
  }
});

router.use('/', require('./passwordReset'));

module.exports = router;