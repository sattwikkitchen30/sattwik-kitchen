const test = require('node:test');
const assert = require('node:assert/strict');
const { getOrderCustomer } = require('./orderCustomer');

test('uses saved order details over the current customer profile', () => {
  const customer = getOrderCustomer({
    customer: {
      firstName: 'xyz',
      lastName: 'Profile',
      phone: '5550000000',
      email: 'profile@example.com',
      address: 'Old address',
      area: 'Old area'
    },
    customerSnapshot: {
      firstName: 'abc',
      lastName: 'Checkout',
      phone: '6041112222',
      email: 'checkout@example.com',
      address: 'New address',
      area: 'New area'
    }
  });

  assert.deepEqual(
    ['firstName', 'lastName', 'phone', 'email', 'address', 'area'].map((field) => customer[field]),
    ['abc', 'Checkout', '6041112222', 'checkout@example.com', 'New address', 'New area']
  );
});

test('falls back to profile details when a historical order has no snapshot', () => {
  const customer = getOrderCustomer({
    customer: { firstName: 'Historical', phone: '5551234567', area: 'Surrey' }
  });

  assert.equal(customer.firstName, 'Historical');
  assert.equal(customer.phone, '5551234567');
  assert.equal(customer.area, 'Surrey');
});

test('does not replace intentionally blank saved details with current profile values', () => {
  const customer = getOrderCustomer({
    customer: { address: 'Current profile address', area: 'Current area' },
    customerSnapshot: { address: '', area: '' }
  });

  assert.equal(customer.address, '');
  assert.equal(customer.area, '');
});
