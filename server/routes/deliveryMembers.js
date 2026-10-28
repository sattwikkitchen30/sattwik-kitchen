const router = require('express').Router();
const bcrypt = require('bcryptjs');
const DeliveryMember = require('../models/DeliveryMember');
const Order = require('../models/Order');
const { authRequired } = require('../middleware/auth');
const { deliveryAuthRequired } = require('../middleware/deliveryAuth');
const { updateDeliveryMemberProfile } = require('./deliveryAuth');
const { getMemberDeliveryHistory, getMemberDeliveryCount, deleteMemberDeliveryHistory } = require('../utils/deliveryHistory');

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

// Get current delivery member's own details and history (delivery member only)
router.get('/me', deliveryAuthRequired, async (req, res) => {
  try {
    const member = req.deliveryMember;
    if (!member) return res.status(404).json({ message: 'Delivery member not found' });
    
    // Convert ObjectId to string to match admin endpoint behavior
    const memberId = String(member._id);
    
    // Get total delivery count (all time)
    const totalCount = await getMemberDeliveryCount(memberId);
    
    // Get count for selected period
    const { year, month, fromDate, toDate } = req.query;
    const periodCount = await getMemberDeliveryCount(memberId, { year, month, fromDate, toDate });
    
    // Get history for selected period
    const { history, total } = await getMemberDeliveryHistory(memberId, {
      year,
      month,
      fromDate,
      toDate,
      limit: 50
    });
    
    res.json({
      member: publicMember(member),
      totalCount,
      periodCount,
      history,
      historyTotal: total
    });
  } catch (err) {
    console.error('[deliveryMembers] me failed:', err.message);
    res.status(500).json({ message: 'Could not load delivery member details' });
  }
});

// Get delivery member details with history (admin only)
router.get('/:id', authRequired, async (req, res) => {
  try {
    const member = await DeliveryMember.findById(req.params.id).select('name email phone active createdAt').lean();
    if (!member) return res.status(404).json({ message: 'Delivery member not found' });
    
    // Get total delivery count (all time)
    const totalCount = await getMemberDeliveryCount(req.params.id);
    
    // Get count for selected period
    const { year, month, fromDate, toDate } = req.query;
    const periodCount = await getMemberDeliveryCount(req.params.id, { year, month, fromDate, toDate });
    
    // Get history for selected period
    const { history, total } = await getMemberDeliveryHistory(req.params.id, {
      year,
      month,
      fromDate,
      toDate,
      limit: 50
    });
    
    res.json({
      member: publicMember(member),
      totalCount,
      periodCount,
      history,
      historyTotal: total
    });
  } catch (err) {
    console.error('[deliveryMembers] details failed:', err.message);
    res.status(500).json({ message: 'Could not load delivery member details' });
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

// Update current delivery member's own profile
router.put('/me', deliveryAuthRequired, updateDeliveryMemberProfile);

// Update delivery member (admin only)
router.put('/:id', authRequired, async (req, res) => {
  try {
    const { name, email, phone, active } = req.body || {};

    const member = await DeliveryMember.findById(req.params.id);
    if (!member) return res.status(404).json({ message: 'Delivery member not found' });

    // Status-only update (when name, email, and phone are not provided)
    if (active !== undefined && name === undefined && email === undefined && phone === undefined) {
      member.active = Boolean(active);
      await member.save();
      return res.json({
        message: member.active ? 'Delivery member activated successfully' : 'Delivery member deactivated successfully',
        member: publicMember(member)
      });
    }

    const cleanName = String(name || '').trim();
    const cleanEmail = String(email || '').trim().toLowerCase();
    const cleanPhone = String(phone || '').trim();

    if (!cleanName) return res.status(400).json({ message: 'Name is required' });
    if (!cleanEmail) return res.status(400).json({ message: 'Email is required' });
    if (!EMAIL_PATTERN.test(cleanEmail)) return res.status(400).json({ message: 'Enter a valid email address' });
    if (!cleanPhone) return res.status(400).json({ message: 'Phone number is required' });

    // Check if email is being changed and if it conflicts with another member
    if (member.email !== cleanEmail && await DeliveryMember.exists({ email: cleanEmail, _id: { $ne: req.params.id } })) {
      return res.status(409).json({ message: 'A delivery account already exists for this email' });
    }

    member.name = cleanName;
    member.email = cleanEmail;
    member.phone = cleanPhone;
    if (active !== undefined) {
      member.active = Boolean(active);
    }
    await member.save();

    res.json({ message: 'Delivery member updated successfully', member: publicMember(member) });
  } catch (err) {
    console.error('[deliveryMembers] update failed:', err.message);
    res.status(500).json({ message: 'Could not update the delivery member' });
  }
});

// Toggle delivery member active status (admin only)
router.patch('/:id/status', authRequired, async (req, res) => {
  try {
    const { active } = req.body || {};
    if (typeof active !== 'boolean') {
      return res.status(400).json({ message: 'Active status (boolean) is required' });
    }

    const member = await DeliveryMember.findById(req.params.id);
    if (!member) return res.status(404).json({ message: 'Delivery member not found' });

    member.active = active;
    await member.save();

    res.json({
      message: active ? 'Delivery member activated successfully' : 'Delivery member deactivated successfully',
      member: publicMember(member)
    });
  } catch (err) {
    console.error('[deliveryMembers] status update failed:', err.message);
    res.status(500).json({ message: 'Could not update delivery member status' });
  }
});

// Soft-delete delivery member: mark inactive without deleting history or order assignments (admin only)
router.delete('/:id', authRequired, async (req, res) => {
  try {
    const member = await DeliveryMember.findById(req.params.id);
    if (!member) return res.status(404).json({ message: 'Delivery member not found' });

    // Soft delete: mark inactive
    member.active = false;
    await member.save();

    res.json({
      message: 'Delivery member deactivated successfully',
      member: publicMember(member)
    });
  } catch (err) {
    console.error('[deliveryMembers] deactivate failed:', err.message);
    res.status(500).json({ message: 'Could not deactivate the delivery member' });
  }
});

module.exports = router;
