const router = require('express').Router();
const bcrypt = require('bcryptjs');
const DeliveryMember = require('../models/DeliveryMember');
const { authRequired } = require('../middleware/auth');

const MIN_PASSWORD_LENGTH = 8;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function publicMember(member) {
  return { id: String(member._id), name: member.name, email: member.email, phone: member.phone, active: member.active, createdAt: member.createdAt };
}

function validateNewDeliveryMember({ name, email, phone, password, confirmPassword }) {
  const cleanName = String(name || '').trim();
  const cleanEmail = String(email || '').trim().toLowerCase();
  const cleanPhone = String(phone || '').trim();
  const pass = String(password || '');
  const confirm = String(confirmPassword || '');

  if (!cleanName) return { error: 'Delivery member name is required' };
  if (!cleanEmail) return { error: 'Email is required' };
  if (!EMAIL_PATTERN.test(cleanEmail)) return { error: 'Enter a valid email address' };
  if (!cleanPhone) return { error: 'Phone number is required' };
  if (!pass || !confirm) return { error: 'Password and confirm password are required' };
  if (pass.length < MIN_PASSWORD_LENGTH) return { error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` };
  if (pass !== confirm) return { error: 'Passwords do not match' };

  return { value: { name: cleanName, email: cleanEmail, phone: cleanPhone, password: pass } };
}

// Get all delivery members (admin only)
router.get('/', authRequired, async (req, res) => {
  try {
    const members = await DeliveryMember.find().select('name email phone active createdAt').sort('createdAt').lean();
    res.json({ members: members.map(publicMember) });
  } catch (err) {
    console.error('[deliveryMembers] list failed:', err.message);
    res.status(500).json({ message: 'Could not load delivery members' });
  }
});

// Create delivery member (admin only)
router.post('/', authRequired, async (req, res) => {
  try {
    const { error, value } = validateNewDeliveryMember(req.body || {});
    if (error) return res.status(400).json({ message: error });

    if (await DeliveryMember.exists({ email: value.email })) {
      return res.status(409).json({ message: 'A delivery account already exists for this email' });
    }

    const member = await DeliveryMember.create({
      name: value.name,
      email: value.email,
      phone: value.phone,
      passwordHash: bcrypt.hashSync(value.password, 12),
      active: true
    });

    res.status(201).json({ message: 'Delivery member created successfully', member: publicMember(member) });
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ message: 'A delivery account already exists for this email' });
    if (err.name === 'ValidationError') {
      return res.status(400).json({ message: Object.values(err.errors).map((e) => e.message).join(', ') });
    }
    console.error('[deliveryMembers] create failed:', err.message);
    res.status(500).json({ message: 'Could not create the delivery member account' });
  }
});

// Update delivery member (admin only)
router.put('/:id', authRequired, async (req, res) => {
  try {
    const { name, email, phone, active } = req.body || {};
    const cleanName = String(name || '').trim();
    const cleanEmail = String(email || '').trim().toLowerCase();
    const cleanPhone = String(phone || '').trim();

    if (!cleanName) return res.status(400).json({ message: 'Name is required' });
    if (!cleanEmail) return res.status(400).json({ message: 'Email is required' });
    if (!EMAIL_PATTERN.test(cleanEmail)) return res.status(400).json({ message: 'Enter a valid email address' });
    if (!cleanPhone) return res.status(400).json({ message: 'Phone number is required' });

    const member = await DeliveryMember.findById(req.params.id);
    if (!member) return res.status(404).json({ message: 'Delivery member not found' });

    // Check if email is being changed and if it conflicts with another member
    if (member.email !== cleanEmail && await DeliveryMember.exists({ email: cleanEmail, _id: { $ne: req.params.id } })) {
      return res.status(409).json({ message: 'A delivery account already exists for this email' });
    }

    member.name = cleanName;
    member.email = cleanEmail;
    member.phone = cleanPhone;
    member.active = active !== undefined ? Boolean(active) : member.active;
    await member.save();

    res.json({ message: 'Delivery member updated successfully', member: publicMember(member) });
  } catch (err) {
    console.error('[deliveryMembers] update failed:', err.message);
    res.status(500).json({ message: 'Could not update the delivery member' });
  }
});

// Delete delivery member (admin only)
router.delete('/:id', authRequired, async (req, res) => {
  try {
    const member = await DeliveryMember.findByIdAndDelete(req.params.id);
    if (!member) return res.status(404).json({ message: 'Delivery member not found' });
    res.json({ message: 'Delivery member deleted successfully' });
  } catch (err) {
    console.error('[deliveryMembers] delete failed:', err.message);
    res.status(500).json({ message: 'Could not delete the delivery member' });
  }
});

module.exports = router;
