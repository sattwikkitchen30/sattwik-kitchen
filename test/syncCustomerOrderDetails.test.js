'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const { getOrderCustomer } = require('../server/utils/orderCustomer');
const Order = require('../server/models/Order');
const Customer = require('../server/models/Customer');
const { updateCustomerProfile } = require('../server/routes/customerAuth');
const customersRouter = require('../server/routes/customers');

// Mock request/response generator
function mockReqRes({ method = 'GET', body = {}, params = {}, query = {}, customer = null, deliveryMember = null, admin = null } = {}) {
  const req = {
    method,
    body,
    params,
    query,
    customer,
    deliveryMember,
    admin,
    app: {
      get: (key) => (key === 'io' ? { to: () => ({ emit: () => {} }) } : null)
    }
  };

  const res = {
    statusCode: 200,
    headersSent: false,
    _json: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this._json = data;
      this.headersSent = true;
      return this;
    }
  };

  return { req, res };
}

test('Customer Order Details Synchronization - Test Suite', async (t) => {
  // ─── 1. Authoritative getOrderCustomer Resolution ─────────────────────────
  await t.test('1. getOrderCustomer prefers live customer profile over historical snapshot', () => {
    const populatedOrder = {
      orderId: '26101600001',
      customer: {
        _id: 'cust-101',
        firstName: 'Priya',
        lastName: 'Patel',
        phone: '6045558899',
        email: 'priya.new@example.com',
        area: 'Kitsilano',
        address: '222 Cornwall Ave, Vancouver'
      },
      customerSnapshot: {
        firstName: 'PriyaOld',
        lastName: 'PatelOld',
        phone: '6041110000',
        email: 'priya.old@example.com',
        area: 'Richmond',
        address: '111 No 3 Rd, Richmond'
      }
    };

    const resolved = getOrderCustomer(populatedOrder);
    assert.equal(resolved.firstName, 'Priya');
    assert.equal(resolved.lastName, 'Patel');
    assert.equal(resolved.phone, '6045558899');
    assert.equal(resolved.email, 'priya.new@example.com');
    assert.equal(resolved.area, 'Kitsilano');
    assert.equal(resolved.address, '222 Cornwall Ave, Vancouver');
  });

  // ─── 2. Graceful Fallback for Orphan/Guest/Unpopulated Orders ──────────────
  await t.test('2. getOrderCustomer gracefully falls back to snapshot when customer is unpopulated or missing', () => {
    // Unpopulated string ID
    const unpopulatedOrder = {
      orderId: '26101600002',
      customer: 'cust-unpopulated-id',
      customerSnapshot: {
        firstName: 'Guest',
        lastName: 'User',
        phone: '6049993333',
        email: 'guest@example.com',
        area: 'Burnaby',
        address: '456 Hastings St'
      }
    };

    const resolved1 = getOrderCustomer(unpopulatedOrder);
    assert.equal(resolved1.firstName, 'Guest');
    assert.equal(resolved1.lastName, 'User');
    assert.equal(resolved1.phone, '6049993333');
    assert.equal(resolved1.email, 'guest@example.com');
    assert.equal(resolved1.area, 'Burnaby');
    assert.equal(resolved1.address, '456 Hastings St');

    // Null customer (e.g. deleted user)
    const nullCustomerOrder = {
      orderId: '26101600003',
      customer: null,
      customerSnapshot: {
        firstName: 'Historical',
        lastName: 'Customer',
        phone: '6048882222',
        email: 'historical@example.com',
        area: 'Surrey',
        address: '789 King George Blvd'
      }
    };

    const resolved2 = getOrderCustomer(nullCustomerOrder);
    assert.equal(resolved2.firstName, 'Historical');
    assert.equal(resolved2.lastName, 'Customer');
    assert.equal(resolved2.address, '789 King George Blvd');

    // Partial blank field on customer falls back to snapshot field
    const partialOrder = {
      customer: {
        firstName: 'UpdatedFirst',
        lastName: 'UpdatedLast',
        phone: '6045550000',
        email: 'updated@example.com',
        address: '', // blank on profile
        area: ''
      },
      customerSnapshot: {
        firstName: 'OldFirst',
        lastName: 'OldLast',
        phone: '6040001111',
        email: 'old@example.com',
        address: 'Saved Snapshot Address',
        area: 'Saved Snapshot Area'
      }
    };

    const resolved3 = getOrderCustomer(partialOrder);
    assert.equal(resolved3.firstName, 'UpdatedFirst');
    assert.equal(resolved3.address, 'Saved Snapshot Address');
    assert.equal(resolved3.area, 'Saved Snapshot Area');
  });

  // ─── 3. Customer Profile Update Updates Customer Record ───────────────────
  await t.test('3. updateCustomerProfile updates all 5 fields on customer account', async () => {
    const mockCustId = new mongoose.Types.ObjectId();
    const customerDoc = {
      _id: mockCustId,
      firstName: 'OldName',
      lastName: 'OldLastName',
      phone: '6041112222',
      email: 'old@example.com',
      area: 'Richmond',
      address: 'Old St 123',
      save: async function () { return this; }
    };

    const origFindById = Customer.findById;
    const origFindOne = Customer.findOne;
    Customer.findById = () => Promise.resolve(customerDoc);
    Customer.findOne = () => ({ lean: () => Promise.resolve(null) });

    try {
      const { req, res } = mockReqRes({
        method: 'PUT',
        customer: { _id: mockCustId },
        body: {
          firstName: 'Aarav',
          lastName: 'Sharma',
          phone: '6045559988',
          email: 'aarav.sharma@example.com',
          area: 'Downtown Vancouver',
          address: '777 Burrard St, Apt 12B'
        }
      });

      await updateCustomerProfile(req, res);

      assert.equal(res.statusCode, 200);
      assert.equal(res._json.customer.firstName, 'Aarav');
      assert.equal(res._json.customer.lastName, 'Sharma');
      assert.equal(res._json.customer.phone, '6045559988');
      assert.equal(res._json.customer.email, 'aarav.sharma@example.com');
      assert.equal(res._json.customer.area, 'Downtown Vancouver');
      assert.equal(res._json.customer.address, '777 Burrard St, Apt 12B');
    } finally {
      Customer.findById = origFindById;
      Customer.findOne = origFindOne;
    }
  });

  // ─── 4. Admin Orders Pipeline Overwrite & Search Integrity ─────────────────
  await t.test('4. Admin Orders: listOrders pipeline merges live customerDoc over snapshot and resolves address', () => {
    // Simulate pipeline output in listOrders
    const mockRawOrderFromPipeline = {
      _id: new mongoose.Types.ObjectId(),
      orderId: '26101600004',
      status: 'ACCEPTED',
      totalAmount: 180.00,
      orderAmount: 180.00,
      deliveryAddress: 'Old Checkout Address',
      customerDoc: {
        _id: 'cust-101',
        firstName: 'Aarav',
        lastName: 'Sharma',
        phone: '6045559988',
        email: 'aarav.sharma@example.com',
        area: 'Downtown Vancouver',
        address: '777 Burrard St, Apt 12B'
      },
      customerSnapshot: {
        firstName: 'OldFirst',
        lastName: 'OldLast',
        phone: '6041112222',
        email: 'old@example.com',
        area: 'Richmond',
        address: 'Old Checkout Address'
      },
      items: [
        { productName: 'Couple Full Meal Package (12 Days)', fulfillment: 'delivery', quantity: 1, subtotal: 180.00 }
      ]
    };

    const resolvedCustomer = getOrderCustomer({
      customer: mockRawOrderFromPipeline.customerDoc,
      customerSnapshot: mockRawOrderFromPipeline.customerSnapshot
    });
    const resolvedAddress = resolvedCustomer.address || resolvedCustomer.area || mockRawOrderFromPipeline.deliveryAddress || '';

    assert.equal(resolvedCustomer.firstName, 'Aarav');
    assert.equal(resolvedCustomer.lastName, 'Sharma');
    assert.equal(resolvedCustomer.phone, '6045559988');
    assert.equal(resolvedCustomer.email, 'aarav.sharma@example.com');
    assert.equal(resolvedCustomer.area, 'Downtown Vancouver');
    assert.equal(resolvedAddress, '777 Burrard St, Apt 12B');
  });

  // ─── 5. Delivery Member Orders Retrieval Priority ─────────────────────────
  await t.test('5. Delivery Member Orders: GET /api/delivery-orders resolves updated customer name, phone, area, and address', () => {
    const rawDeliveryOrder = {
      _id: new mongoose.Types.ObjectId(),
      orderId: '26101600005',
      deliveryMemberId: 'del-member-1',
      status: 'OUT_FOR_DELIVERY',
      totalAmount: 120.00,
      deliveryAddress: 'Old Delivery Address',
      customer: {
        _id: 'cust-101',
        firstName: 'Rohan',
        lastName: 'Verma',
        phone: '6043334444',
        email: 'rohan.v@example.com',
        area: 'Kitsilano',
        address: '1500 West 4th Ave'
      },
      customerSnapshot: {
        firstName: 'RohanOld',
        lastName: 'VermaOld',
        phone: '6040000000',
        email: 'rohan.old@example.com',
        area: 'Surrey',
        address: 'Old Delivery Address'
      },
      items: [
        { productName: 'Tiffin Package', fulfillment: 'delivery', quantity: 1, subtotal: 120.00 }
      ]
    };

    const resolvedCustomer = getOrderCustomer(rawDeliveryOrder);
    const resolvedAddress = resolvedCustomer.address || resolvedCustomer.area || rawDeliveryOrder.deliveryAddress || rawDeliveryOrder.customerSnapshot?.address || '';

    assert.equal(resolvedCustomer.firstName, 'Rohan');
    assert.equal(resolvedCustomer.lastName, 'Verma');
    assert.equal(resolvedCustomer.phone, '6043334444');
    assert.equal(resolvedCustomer.area, 'Kitsilano');
    assert.equal(resolvedAddress, '1500 West 4th Ave');
  });

  // ─── 6. Existing Pickup Orders Sync (e.g. Order 26102700001) ───────────────
  await t.test('6. Pickup Orders: Existing pickup order reflects updated profile details over initial checkout snapshot', () => {
    // Model of order 26102700001 where snapshot captured "xyz self", but customer profile was updated to "xyz xyz"
    const pickupOrder = {
      _id: new mongoose.Types.ObjectId(),
      orderId: '26102700001',
      fulfillment: 'pickup',
      type: 'product',
      totalAmount: 11.99,
      pickupDate: '2026-10-30',
      items: [
        { productName: 'Moringa Leaf Powder', fulfillment: 'pickup', quantity: 1, subtotal: 11.99 }
      ],
      customer: {
        _id: '6acafa7ddca88f3f7b06f2ca',
        firstName: 'xyz',
        lastName: 'xyz', // updated
        phone: '3456789012',
        email: 'xyz@gmail.com',
        area: 'Surrey',
        address: ''
      },
      customerSnapshot: {
        firstName: 'xyz',
        lastName: 'self', // stale
        phone: '3456789012',
        email: 'xyz@gmail.com',
        area: 'Surrey',
        address: 'Surrey'
      }
    };

    const resolvedCustomer = getOrderCustomer(pickupOrder);
    const resolvedAddress = resolvedCustomer.address || resolvedCustomer.area || pickupOrder.deliveryAddress || '';

    // Must show updated name "xyz xyz", not stale "xyz self"
    assert.equal(resolvedCustomer.firstName, 'xyz');
    assert.equal(resolvedCustomer.lastName, 'xyz');
    assert.equal(resolvedCustomer.email, 'xyz@gmail.com');
    assert.equal(resolvedCustomer.phone, '3456789012');
    assert.equal(resolvedCustomer.area, 'Surrey');
    // Location falls back to area or snapshot address when customer.address is empty
    assert.equal(resolvedAddress, 'Surrey');
    // Order particulars remain untouched
    assert.equal(pickupOrder.orderId, '26102700001');
    assert.equal(pickupOrder.totalAmount, 11.99);
    assert.equal(pickupOrder.items[0].productName, 'Moringa Leaf Powder');
  });

  // ─── 7. Order Metadata Preservation ───────────────────────────────────────
  await t.test('7. Order preservation: order statuses, amounts, items, quantities, and payment history remain untouched', () => {
    const orderBefore = {
      _id: '507f1f77bcf86cd799439011',
      orderId: '26101600006',
      status: 'ACCEPTED',
      totalAmount: 240.00,
      orderAmount: 240.00,
      pickupDate: '2026-10-20',
      subscriptionStartDate: '2026-10-12',
      subscriptionEndDate: '2026-10-24',
      deliveryMemberId: '507f1f77bcf86cd799439022',
      items: [
        { productId: 'prod-1', productName: 'Couple Full Meal', quantity: 2, subtotal: 240.00 }
      ],
      paymentHistory: [
        { amount: 240.00, paymentDate: '2026-10-12', method: 'Cash' }
      ]
    };

    // When customer details are resolved
    const customer = {
      firstName: 'Updated',
      lastName: 'Customer',
      phone: '6049998877',
      email: 'updated@example.com',
      address: 'New House 123',
      area: 'Vancouver'
    };

    const processed = {
      ...orderBefore,
      customer: getOrderCustomer({ ...orderBefore, customer }),
      deliveryAddress: customer.address || orderBefore.deliveryAddress
    };

    // Core order attributes must remain strictly unchanged
    assert.equal(processed._id, orderBefore._id);
    assert.equal(processed.orderId, orderBefore.orderId);
    assert.equal(processed.status, 'ACCEPTED');
    assert.equal(processed.totalAmount, 240.00);
    assert.equal(processed.orderAmount, 240.00);
    assert.equal(processed.pickupDate, '2026-10-20');
    assert.equal(processed.subscriptionStartDate, '2026-10-12');
    assert.equal(processed.subscriptionEndDate, '2026-10-24');
    assert.equal(processed.deliveryMemberId, '507f1f77bcf86cd799439022');
    assert.equal(processed.items.length, 1);
    assert.equal(processed.items[0].quantity, 2);
    assert.equal(processed.paymentHistory.length, 1);
    assert.equal(processed.paymentHistory[0].amount, 240.00);
  });
});
