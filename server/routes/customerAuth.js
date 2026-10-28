const router = require('express').Router();
const bcrypt = require('bcryptjs');
const Customer = require('../models/Customer');
const { signCustomerToken, customerAuthRequired } = require('../middleware/customerAuth');

function splitName(name = '') {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  return { firstName: parts.shift() || '', lastName: parts.join(' ') || 'Customer' };
}

function publicCustomer(customer) {
  return {
    id: customer._id,
    firstName: customer.firstName,
    lastName: customer.lastName,
    email: customer.email,
    phone: customer.phone,
    address: customer.address || '',
    area: customer.area || ''
  };
}

router.post('/signup', async (req, res) => {
  const { name, email, phone, password, address, area = '' } = req.body || {};
  const cleanEmail = String(email || '').trim().toLowerCase();
  if (!name || !cleanEmail.includes('@') || !phone || String(password || '').length < 8) {
    return res.status(400).json({ message: 'Name, valid email, phone, and an 8-character password are required.' });
  }

  const existing = await Customer.findOne({ email: cleanEmail }).select('+passwordHash');
  if (existing?.passwordHash) return res.status(409).json({ message: 'An account already exists for this email.' });

  const { firstName, lastName } = splitName(name);
  const customer = existing || new Customer({ email: cleanEmail });
  customer.firstName = firstName;
  customer.lastName = lastName;
  customer.phone = String(phone).trim();
  customer.address = String(address || '').trim();
  customer.area = String(area).trim();
  customer.passwordHash = bcrypt.hashSync(String(password), 12);
  await customer.save();

  res.status(201).json({ token: signCustomerToken(customer), customer: publicCustomer(customer) });
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  const customer = await Customer.findOne({ email: String(email || '').trim().toLowerCase() }).select('+passwordHash');
  if (!customer || !customer.passwordHash || !bcrypt.compareSync(String(password || ''), customer.passwordHash)) {
    return res.status(401).json({ message: 'Invalid email or password.' });
  }
  res.json({ token: signCustomerToken(customer), customer: publicCustomer(customer) });
});

router.get('/me', customerAuthRequired, (req, res) => res.json({ customer: publicCustomer(req.customer) }));
router.post('/logout', customerAuthRequired, (req, res) => res.json({ message: 'Logged out' }));

async function updateCustomerProfile(req, res) {
  try {
    if (!req.customer || !req.customer._id) {
      return res.status(401).json({ message: 'Customer authentication required' });
    }
    const customerId = req.customer._id;
    const customer = await Customer.findById(customerId);
    if (!customer) {
      return res.status(404).json({ message: 'Customer account no longer exists' });
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

    await customer.save();

    try {
      const mongoose = require('mongoose');
      const Order = require('../models/Order');
      if (mongoose.connection && mongoose.connection.readyState === 1 && Order && typeof Order.updateMany === 'function') {
        const orderUpdateFields = {
          'customerSnapshot.firstName': customer.firstName,
          'customerSnapshot.lastName': customer.lastName,
          'customerSnapshot.phone': customer.phone,
          'customerSnapshot.email': customer.email,
          'customerSnapshot.area': customer.area,
          'customerSnapshot.address': customer.address
        };
        if (customer.address) {
          orderUpdateFields.deliveryAddress = customer.address;
        }
        await Order.updateMany(
          { $or: [{ customer: customer._id }, { customerId: customer._id }] },
          { $set: orderUpdateFields }
        );
      }
    } catch (_orderSyncErr) {
      // Don't fail customer profile update if order synchronization throws
    }

    const token = signCustomerToken(customer);
    return res.json({
      message: 'Profile updated successfully',
      customer: publicCustomer(customer),
      token
    });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ message: 'A customer with this email and phone number already exists.' });
    }
    if (err.name === 'ValidationError') {
      return res.status(400).json({ message: Object.values(err.errors).map((e) => e.message).join(', ') });
    }
    console.error('[customerAuth] update profile failed:', err.message);
    return res.status(500).json({ message: 'Could not update profile' });
  }
}

router.put('/profile', customerAuthRequired, updateCustomerProfile);
router.put('/me', customerAuthRequired, updateCustomerProfile);

router.updateCustomerProfile = updateCustomerProfile;
module.exports = router;
