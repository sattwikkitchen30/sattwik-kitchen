const jwt = require('jsonwebtoken');
const Customer = require('../models/Customer');

function signCustomerToken(customer) {
  return jwt.sign(
    { id: customer._id, email: customer.email, type: 'customer', tv: customer.tokenVersion || 0 },
    process.env.JWT_SECRET || 'dev_secret_change_me',
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
}

async function customerAuthRequired(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ message: 'Customer sign-in required' });
    const payload = jwt.verify(token, process.env.JWT_SECRET || 'dev_secret_change_me');
    if (payload.type !== 'customer') return res.status(401).json({ message: 'Customer session required' });
    const customer = await Customer.findById(payload.id).lean();
    if (!customer) return res.status(401).json({ message: 'Customer account no longer exists' });
    if (payload.tv !== undefined && customer.tokenVersion !== undefined && payload.tv !== (customer.tokenVersion || 0)) {
      return res.status(401).json({ message: 'Password changed — please sign in again' });
    }
    req.customer = customer;
    next();
  } catch (error) {
    return res.status(401).json({ message: 'Invalid or expired customer session' });
  }
}

module.exports = { signCustomerToken, customerAuthRequired };
