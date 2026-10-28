const test = require('node:test');
const assert = require('node:assert/strict');
const { getOrderCustomer } = require('./orderCustomer');

test('uses the authoritative customer profile details over historical snapshot when customer record is present', () => {
  const customer = getOrderCustomer({
    customer: {
      firstName: 'Aarav',
      lastName: 'Sharma',
      phone: '6045550199',
      email: 'aarav.sharma@example.com',
      address: '456 Updated Ave',
      area: 'Downtown Vancouver'
    },
    customerSnapshot: {
      firstName: 'AaravOld',
      lastName: 'SharmaOld',
      phone: '6041112222',
      email: 'old.checkout@example.com',
      address: '123 Old St',
      area: 'Richmond'
    }
  });

  assert.deepEqual(
    ['firstName', 'lastName', 'phone', 'email', 'address', 'area'].map((field) => customer[field]),
    ['Aarav', 'Sharma', '6045550199', 'aarav.sharma@example.com', '456 Updated Ave', 'Downtown Vancouver']
  );
});

test('falls back to snapshot details when customer profile fields are blank', () => {
  const customer = getOrderCustomer({
    customer: {
      firstName: 'Aarav',
      lastName: 'Sharma',
      phone: '6045550199',
      email: 'aarav.sharma@example.com',
      address: '',
      area: ''
    },
    customerSnapshot: {
      firstName: 'AaravOld',
      lastName: 'SharmaOld',
      phone: '6041112222',
      email: 'old@example.com',
      address: '123 Fallback St',
      area: 'Kitsilano'
    }
  });

  assert.equal(customer.firstName, 'Aarav');
  assert.equal(customer.address, '123 Fallback St');
  assert.equal(customer.area, 'Kitsilano');
});

test('falls back to snapshot details when customer record is unpopulated or missing', () => {
  const customerWithId = getOrderCustomer({
    customer: '507f1f77bcf86cd799439011',
    customerSnapshot: {
      firstName: 'SnapshotName',
      lastName: 'SnapshotLast',
      phone: '6049991111',
      email: 'snapshot@example.com',
      address: '789 Snapshot Rd',
      area: 'Burnaby'
    }
  });

  assert.equal(customerWithId.firstName, 'SnapshotName');
  assert.equal(customerWithId.phone, '6049991111');
  assert.equal(customerWithId.address, '789 Snapshot Rd');

  const customerNull = getOrderCustomer({
    customer: null,
    customerSnapshot: {
      firstName: 'Guest',
      lastName: 'Checkout',
      phone: '6040001111',
      email: 'guest@example.com',
      address: '321 Guest Lane',
      area: 'Surrey'
    }
  });

  assert.equal(customerNull.firstName, 'Guest');
  assert.equal(customerNull.address, '321 Guest Lane');
});

test('falls back to profile details when an order has no snapshot', () => {
  const customer = getOrderCustomer({
    customer: { firstName: 'Historical', phone: '5551234567', area: 'Surrey' }
  });

  assert.equal(customer.firstName, 'Historical');
  assert.equal(customer.phone, '5551234567');
  assert.equal(customer.area, 'Surrey');
});
