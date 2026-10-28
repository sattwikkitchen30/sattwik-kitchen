const jwt = require('jsonwebtoken');
const DeliveryMember = require('../models/DeliveryMember');

function signDeliveryToken(member) {
  return jwt.sign(
    { id: member._id, email: member.email, type: 'delivery', tv: member.tokenVersion || 0 },
    process.env.JWT_SECRET || 'dev_secret_change_me',
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
}

async function deliveryAuthRequired(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ message: 'Delivery sign-in required' });
    const payload = jwt.verify(token, process.env.JWT_SECRET || 'dev_secret_change_me');
    if (payload.type !== 'delivery') return res.status(401).json({ message: 'Delivery session required' });
    const member = await DeliveryMember.findOne({ _id: payload.id, active: true }).lean();
    if (!member) return res.status(401).json({ message: 'Delivery account is inactive' });
    if (payload.tv !== undefined && member.tokenVersion !== undefined && payload.tv !== (member.tokenVersion || 0)) {
      return res.status(401).json({ message: 'Password changed — please sign in again' });
    }
    req.deliveryMember = member;
    next();
  } catch (error) {
    return res.status(401).json({ message: 'Invalid or expired delivery session' });
  }
}

module.exports = { signDeliveryToken, deliveryAuthRequired };
