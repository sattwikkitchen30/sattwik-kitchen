const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

// Mock models used by createManualOrder
const Customer = require('../server/models/Customer');
const Product = require('../server/models/Product');
const Order = require('../server/models/Order');

test('createManualOrder: roundedAmount is defined and correctly passed to Order.create for Delivery Order', async () => {
  const origCustomerFindOneAndUpdate = Customer.findOneAndUpdate;
  const origCustomerFindOne = Customer.findOne;
  const origOrderCreate = Order.create;
  const origOrderFindById = Order.findById;

  let createdOrderPayload = null;
  const fakeCustomerId = new mongoose.Types.ObjectId();
  const fakeOrderId = new mongoose.Types.ObjectId();

  Customer.findOneAndUpdate = async () => ({
    _id: fakeCustomerId,
    firstName: 'Jane',
    lastName: 'Doe',
    phone: '555-0100',
    email: 'jane@example.com',
    address: '123 Main St',
    area: 'Downtown'
  });

  Order.create = async (payload) => {
    createdOrderPayload = payload;
    return {
      _id: fakeOrderId,
      ...payload
    };
  };

  Order.findById = () => ({
    populate: async () => ({
      _id: fakeOrderId,
      ...createdOrderPayload,
      customer: {
        _id: fakeCustomerId,
        firstName: 'Jane',
        lastName: 'Doe',
        phone: '555-0100',
        email: 'jane@example.com',
        address: '123 Main St',
        area: 'Downtown'
      },
      toObject() {
        return {
          _id: fakeOrderId,
          ...createdOrderPayload,
          customer: {
            _id: fakeCustomerId,
            firstName: 'Jane',
            lastName: 'Doe',
            phone: '555-0100',
            email: 'jane@example.com',
            address: '123 Main St',
            area: 'Downtown'
          }
        };
      }
    })
  });

  delete require.cache[require.resolve('../server/controllers/orderController')];
  const { createManualOrder } = require('../server/controllers/orderController');

  let statusCode = 200;
  let responseData = null;
  const res = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(data) {
      responseData = data;
      return this;
    }
  };

  const req = {
    body: {
      firstName: 'Jane',
      lastName: 'Doe',
      phone: '555-0100',
      email: 'jane@example.com',
      amount: '299.99',
      fulfillment: 'delivery',
      address: '123 Main St',
      pickupDate: '2026-10-25',
      items: [
        {
          productName: 'Small Dal',
          category: 'Tiffin Preparation',
          fulfillment: 'delivery',
          quantity: 1,
          priceAtPurchase: 0
        }
      ]
    },
    app: {
      get: () => null
    }
  };

  try {
    await createManualOrder(req, res);
  } finally {
    Customer.findOneAndUpdate = origCustomerFindOneAndUpdate;
    Customer.findOne = origCustomerFindOne;
    Order.create = origOrderCreate;
    Order.findById = origOrderFindById;
  }

  assert.equal(statusCode, 201, 'Should return HTTP 201 Created');
  assert.equal(responseData.message, 'Manual order saved');
  assert.ok(createdOrderPayload, 'Order.create should have been called');
  assert.equal(createdOrderPayload.totalAmount, 299.99, 'totalAmount should match entered amount rounded to 2 decimals');
  assert.equal(createdOrderPayload.fulfillment, 'delivery');
});

test('createManualOrder: roundedAmount is defined and correctly passed for Pickup Order', async () => {
  const origCustomerFindOneAndUpdate = Customer.findOneAndUpdate;
  const origCustomerFindOne = Customer.findOne;
  const origOrderCreate = Order.create;
  const origOrderFindById = Order.findById;
  const origProductFindOneAndUpdate = Product.findOneAndUpdate;

  let createdOrderPayload = null;
  const fakeCustomerId = new mongoose.Types.ObjectId();
  const fakeOrderId = new mongoose.Types.ObjectId();
  const fakeProductId = new mongoose.Types.ObjectId();

  Customer.findOneAndUpdate = async () => ({
    _id: fakeCustomerId,
    firstName: 'John',
    lastName: 'Smith',
    phone: '555-0101',
    email: 'john@example.com',
    address: '',
    area: ''
  });

  Product.findOneAndUpdate = () => ({
    lean: async () => ({
      _id: fakeProductId,
      name: 'Mango Pickle',
      price: 12.50,
      category: 'Pickles',
      stock: 10
    })
  });
  const origProductFindById = Product.findById;
  Product.findById = () => ({
    lean: async () => ({
      _id: fakeProductId,
      name: 'Mango Pickle',
      price: 12.50,
      stock: 8
    })
  });

  Order.create = async (payload) => {
    createdOrderPayload = payload;
    return {
      _id: fakeOrderId,
      ...payload
    };
  };

  Order.findById = () => ({
    populate: async () => ({
      _id: fakeOrderId,
      ...createdOrderPayload,
      customer: {
        _id: fakeCustomerId,
        firstName: 'John',
        lastName: 'Smith',
        phone: '555-0101',
        email: 'john@example.com'
      },
      toObject() {
        return {
          _id: fakeOrderId,
          ...createdOrderPayload,
          customer: {
            _id: fakeCustomerId,
            firstName: 'John',
            lastName: 'Smith',
            phone: '555-0101',
            email: 'john@example.com'
          }
        };
      }
    })
  });

  delete require.cache[require.resolve('../server/controllers/orderController')];
  const { createManualOrder } = require('../server/controllers/orderController');

  let statusCode = 200;
  let responseData = null;
  const res = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(data) {
      responseData = data;
      return this;
    }
  };

  const req = {
    body: {
      firstName: 'John',
      lastName: 'Smith',
      phone: '555-0101',
      email: 'john@example.com',
      amount: 25.00,
      fulfillment: 'pickup',
      pickupDate: '2026-10-25',
      items: [
        {
          productId: fakeProductId.toString(),
          productName: 'Mango Pickle',
          category: 'Pickles',
          fulfillment: 'pickup',
          quantity: 2,
          priceAtPurchase: 12.50
        }
      ]
    },
    app: {
      get: () => null
    }
  };

  try {
    await createManualOrder(req, res);
  } finally {
    Customer.findOneAndUpdate = origCustomerFindOneAndUpdate;
    Customer.findOne = origCustomerFindOne;
    Order.create = origOrderCreate;
    Order.findById = origOrderFindById;
    Product.findOneAndUpdate = origProductFindOneAndUpdate;
    Product.findById = origProductFindById;
  }

  assert.equal(statusCode, 201, 'Should return HTTP 201 Created');
  assert.equal(responseData.message, 'Manual order saved');
  assert.ok(createdOrderPayload, 'Order.create should have been called');
  assert.equal(createdOrderPayload.totalAmount, 25.00);
  assert.equal(createdOrderPayload.fulfillment, 'pickup');
});

test('createManualOrder: rounds decimal amount to 2 decimal places and preserves admin amount without overwriting', async () => {
  const origCustomerFindOneAndUpdate = Customer.findOneAndUpdate;
  const origCustomerFindOne = Customer.findOne;
  const origOrderCreate = Order.create;
  const origOrderFindById = Order.findById;

  let createdOrderPayload = null;
  const fakeCustomerId = new mongoose.Types.ObjectId();
  const fakeOrderId = new mongoose.Types.ObjectId();

  Customer.findOneAndUpdate = async () => ({
    _id: fakeCustomerId,
    firstName: 'Alice',
    lastName: 'Admin',
    phone: '555-0999',
    email: 'alice@example.com'
  });

  Order.create = async (payload) => {
    createdOrderPayload = payload;
    return { _id: fakeOrderId, ...payload };
  };

  Order.findById = () => ({
    populate: async () => ({
      _id: fakeOrderId,
      ...createdOrderPayload,
      customer: { _id: fakeCustomerId, firstName: 'Alice', lastName: 'Admin', phone: '555-0999', email: 'alice@example.com' },
      toObject() {
        return {
          _id: fakeOrderId,
          ...createdOrderPayload,
          customer: { _id: fakeCustomerId, firstName: 'Alice', lastName: 'Admin', phone: '555-0999', email: 'alice@example.com' }
        };
      }
    })
  });

  delete require.cache[require.resolve('../server/controllers/orderController')];
  const { createManualOrder } = require('../server/controllers/orderController');

  let statusCode = 200;
  let responseData = null;
  const res = {
    status(code) { statusCode = code; return this; },
    json(data) { responseData = data; return this; }
  };

  // Admin specifies 145.678 for an order with tiffin items
  const req = {
    body: {
      firstName: 'Alice',
      lastName: 'Admin',
      phone: '555-0999',
      email: 'alice@example.com',
      amount: 145.678,
      fulfillment: 'delivery',
      pickupDate: '2026-10-25',
      items: [
        {
          productName: 'Small Dal',
          category: 'Tiffin Preparation',
          fulfillment: 'delivery',
          quantity: 2,
          priceAtPurchase: 0
        }
      ]
    },
    app: { get: () => null }
  };

  try {
    await createManualOrder(req, res);
  } finally {
    Customer.findOneAndUpdate = origCustomerFindOneAndUpdate;
    Customer.findOne = origCustomerFindOne;
    Order.create = origOrderCreate;
    Order.findById = origOrderFindById;
  }

  assert.equal(statusCode, 201);
  assert.equal(createdOrderPayload.totalAmount, 145.68, 'Amount 145.678 must be rounded to 145.68 without altering the admin value');
});

test('createManualOrder: validates invalid amount before attempting order creation', async () => {
  delete require.cache[require.resolve('../server/controllers/orderController')];
  const { createManualOrder } = require('../server/controllers/orderController');

  let statusCode = 200;
  let responseData = null;
  const res = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(data) {
      responseData = data;
      return this;
    }
  };

  const req = {
    body: {
      firstName: 'Jane',
      lastName: 'Doe',
      phone: '555-0100',
      email: 'jane@example.com',
      amount: -5,
      fulfillment: 'delivery',
      pickupDate: '2026-10-25',
      items: [{ productName: 'Small Dal', quantity: 1 }]
    }
  };

  await createManualOrder(req, res);
  assert.equal(statusCode, 400);
  assert.equal(responseData.message, 'Enter a valid non-negative amount.');
});
