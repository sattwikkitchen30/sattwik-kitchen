const router = require('express').Router();
const { authRequired } = require('../middleware/auth');
const Customer = require('../models/Customer');
const Order = require('../models/Order');
const mongoose = require('mongoose');

router.get('/', authRequired, async (req, res) => {
  const { search, area, page = 1, limit = 15 } = req.query;
  const match = {};
  if (search) {
    match.$or = ['firstName', 'lastName', 'phone', 'email'].map((field) => ({ [field]: new RegExp(search, 'i') }));
  }
  if (area) match.area = new RegExp(area, 'i');

  const p = Math.max(1, parseInt(page, 10) || 1);
  const l = Math.min(100, parseInt(limit, 10) || 15);

  const [data, total] = await Promise.all([
    Customer.find(match).sort('-createdAt').skip((p - 1) * l).limit(l).lean(),
    Customer.countDocuments(match)
  ]);

  const ids = data.map((customer) => new mongoose.Types.ObjectId(customer._id));
  const stats = await Order.aggregate([
    { $match: { customer: { $in: ids } } },
    { $group: { _id: '$customer', orders: { $sum: 1 }, spent: { $sum: '$totalAmount' }, lastOrder: { $max: '$createdAt' } } }
  ]);

  const statMap = Object.fromEntries(stats.map((s) => [String(s._id), s]));

  res.json({
    customers: data.map((customer) => ({
      ...customer,
      orders: statMap[String(customer._id)]?.orders || 0,
      spent: statMap[String(customer._id)]?.spent || 0,
      lastOrder: statMap[String(customer._id)]?.lastOrder || null
    })),
    total,
    page: p,
    pages: Math.ceil(total / l)
  });
});

router.get('/:id', authRequired, async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(404).json({ message: 'Customer not found' });
  }
  const customer = await Customer.findById(req.params.id).lean();
  if (!customer) return res.status(404).json({ message: 'Customer not found' });
  const orders = await Order.find({ customer: req.params.id }).sort('-createdAt').lean();
  res.json({ customer, orders });
});

async function updateCustomer(req, res) {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(404).json({ message: 'Customer not found' });
  }

  const customer = await Customer.findById(req.params.id);
  if (!customer) {
    return res.status(404).json({ message: 'Customer not found' });
  }

  const { name, firstName: rawFirstName, lastName: rawLastName, phone: rawPhone, email: rawEmail, area: rawArea, address: rawAddress } = req.body || {};

  let firstName = rawFirstName !== undefined ? String(rawFirstName).trim() : undefined;
  let lastName = rawLastName !== undefined ? String(rawLastName).trim() : undefined;

  if (name !== undefined) {
    const trimmedName = String(name).trim();
    if (!trimmedName) {
      return res.status(400).json({ message: 'Name is required.' });
    }
    const parts = trimmedName.split(/\s+/).filter(Boolean);
    firstName = parts[0];
    lastName = parts.slice(1).join(' ') || customer.lastName || parts[0];
  }

  if (firstName !== undefined) {
    if (!firstName) return res.status(400).json({ message: 'First name is required.' });
    customer.firstName = firstName;
  }
  if (lastName !== undefined) {
    if (!lastName) return res.status(400).json({ message: 'Last name is required.' });
    customer.lastName = lastName;
  }

  if (rawPhone !== undefined) {
    const phone = String(rawPhone).trim();
    if (!phone) {
      return res.status(400).json({ message: 'Phone number is required.' });
    }
    if (!/^[\d+\-()\s]{7,40}$/.test(phone) || !/\d/.test(phone)) {
      return res.status(400).json({ message: 'Please enter a valid phone number.' });
    }
    customer.phone = phone;
  }

  if (rawEmail !== undefined) {
    const email = String(rawEmail).trim().toLowerCase();
    if (!email) {
      return res.status(400).json({ message: 'Email address is required.' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ message: 'Please enter a valid email address.' });
    }
    customer.email = email;
  }

  if (rawArea !== undefined) {
    customer.area = String(rawArea).trim();
  }

  if (rawAddress !== undefined) {
    customer.address = String(rawAddress).trim();
  }

  // Check for duplicate conflicts with other customers
  const existingConflict = await Customer.findOne({
    _id: { $ne: customer._id },
    email: customer.email,
    phone: customer.phone
  }).lean();

  if (existingConflict) {
    return res.status(409).json({ message: 'A customer with this email and phone number already exists.' });
  }

  try {
    await customer.save();
    return res.json({
      message: 'Customer updated successfully',
      customer: {
        _id: customer._id,
        firstName: customer.firstName,
        lastName: customer.lastName,
        name: `${customer.firstName} ${customer.lastName}`.trim(),
        phone: customer.phone,
        email: customer.email,
        area: customer.area,
        address: customer.address,
        createdAt: customer.createdAt,
        updatedAt: customer.updatedAt
      }
    });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ message: 'A customer with this email and phone number already exists.' });
    }
    if (err.name === 'ValidationError') {
      return res.status(400).json({ message: Object.values(err.errors).map((e) => e.message).join(', ') });
    }
    throw err;
  }
}

router.put('/:id', authRequired, updateCustomer);
router.patch('/:id', authRequired, updateCustomer);

module.exports = router;
