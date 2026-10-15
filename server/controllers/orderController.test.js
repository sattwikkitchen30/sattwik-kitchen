const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { buildPreparationTotals, formatDateKey } = require('../utils/tiffinPreparation');

function loadController(overrides) {
  const dependencies = {
    '../models/Order': {
      create: overrides.createOrder,
      aggregate: overrides.aggregateOrder || (async () => []),
      findOne: () => ({ sort: () => ({ lean: async () => null }) }),
      findById: overrides.findOrder || (() => ({ populate: async () => ({ ...overrides.savedOrder, toObject: () => ({ ...overrides.savedOrder }) }) })),
      deleteOne: overrides.deleteOrder
    },
    '../models/Customer': { findById: async () => overrides.accountCustomer || ({ _id: overrides.customerId, firstName: 'Test', lastName: 'Customer', phone: '5551234567', email: 'test@example.com' }) },
    '../models/Product': {},
    '../models/TiffinSubscription': {
      findOneAndUpdate: overrides.saveSubscription,
      deleteMany: overrides.deleteSubscriptions
    },
    '../models/DeliveryPlan': {
      find: overrides.findDeliveryPlans || (() => ({
        select: () => ({
          lean: async () => overrides.deliveryPlans || [
            {
              displayName: 'Full Meal (Single)',
              items: { dal: 'small', curry: 'small', chapati: 4, rice: 1, curd: 'small', dynamicItems: [] }
            },
            {
              displayName: 'Full Meal (Family)',
              items: { dal: 'large', curry: 'large', chapati: 6, rice: 1, curd: 'big', dynamicItems: [] }
            }
          ]
        })
      }))
    },
    '../utils/orderEvents': { emitOrderUpdate: () => {} }
  };
  const cached = new Map();
  for (const [request, exports] of Object.entries(dependencies)) {
    const filename = require.resolve(request, { paths: [__dirname] });
    cached.set(filename, require.cache[filename]);
    require.cache[filename] = { id: filename, filename, loaded: true, exports };
  }

  const controllerPath = require.resolve('./orderController');
  cached.set(controllerPath, require.cache[controllerPath]);
  delete require.cache[controllerPath];
  const controller = require('./orderController');

  return {
    controller,
    restore() {
      for (const [filename, original] of cached) {
        if (original) require.cache[filename] = original;
        else delete require.cache[filename];
      }
    }
  };
}

function futureDateKey() {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Vancouver',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric'
  });
  const parts = formatter.formatToParts(new Date());
  const year = Number(parts.find(p => p.type === 'year')?.value);
  const month = Number(parts.find(p => p.type === 'month')?.value);
  const day = Number(parts.find(p => p.type === 'day')?.value);
  const nextDay = new Date(Date.UTC(year, month - 1, day + 1));
  const nextParts = formatter.formatToParts(nextDay);
  const nextYear = nextParts.find(p => p.type === 'year')?.value;
  const nextMonth = nextParts.find(p => p.type === 'month')?.value;
  const nextDayValue = nextParts.find(p => p.type === 'day')?.value;
  return `${nextYear}-${String(nextMonth).padStart(2, '0')}-${String(nextDayValue).padStart(2, '0')}`;
}

async function submitPlans(tiffinPlans, { failAtSubscription, state = {}, customerId = new mongoose.Types.ObjectId(), accountCustomer, checkoutCustomer } = {}) {
  const orderId = new mongoose.Types.ObjectId();
  const subscriptions = [];
  const cleanup = [];
  let savedOrder;
  const loaded = loadController({
    customerId,
    accountCustomer,
    createOrder: async (order) => {
      savedOrder = { ...order, _id: orderId };
      return savedOrder;
    },
    saveSubscription: async (filter, update) => {
      if (failAtSubscription && subscriptions.length + 1 === failAtSubscription) {
        throw new Error('subscription write failed');
      }
      const subscription = { ...filter, ...update.$set };
      subscriptions.push(subscription);
      return subscription;
    },
    deleteSubscriptions: async (filter) => cleanup.push(['subscriptions', filter]),
    deleteOrder: async (filter) => cleanup.push(['order', filter])
  });
  const response = {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
  const request = {
    customer: { _id: customerId },
    body: { tiffinPlans, pickupDate: futureDateKey(), customer: checkoutCustomer },
    app: { get: () => null }
  };

  try {
    await loaded.controller.createOrder(request, response);
    return { response, savedOrder, subscriptions, cleanup };
  } catch (error) {
    state.cleanup = cleanup;
    throw error;
  } finally {
    loaded.restore();
  }

  test('saves checkout-confirmed customer details per order without changing the account profile', async () => {
    const customerId = new mongoose.Types.ObjectId();
    const accountCustomer = {
      _id: customerId,
      firstName: 'xyz',
      lastName: 'Account',
      phone: '5550000000',
      email: 'account@example.com',
      area: 'Old area',
      address: 'Old address'
    };
    const plan = [{ packageType: 'full', size: 'couple', quantity: 1 }];
    const first = await submitPlans(plan, {
      customerId,
      accountCustomer,
      checkoutCustomer: {
        firstName: 'abc',
        lastName: 'One',
        phone: '6041112222',
        email: 'one@example.com',
        area: 'Surrey'
      }
    });
    const second = await submitPlans(plan, {
      customerId,
      accountCustomer,
      checkoutCustomer: {
        firstName: 'abc',
        lastName: 'Two',
        phone: '6043334444',
        email: 'two@example.com',
        area: 'Burnaby'
      }
    });

    assert.deepEqual(first.savedOrder.customerSnapshot, {
      firstName: 'abc',
      lastName: 'One',
      phone: '6041112222',
      email: 'one@example.com',
      address: 'Surrey',
      area: 'Surrey'
    });
    assert.deepEqual(second.savedOrder.customerSnapshot, {
      firstName: 'abc',
      lastName: 'Two',
      phone: '6043334444',
      email: 'two@example.com',
      address: 'Burnaby',
      area: 'Burnaby'
    });
    assert.equal(first.response.body.order.customer.firstName, 'abc');
    assert.equal(first.response.body.order.customer.phone, '6041112222');
    assert.equal(first.response.body.order.deliveryAddress, 'Surrey');
    assert.equal(accountCustomer.firstName, 'xyz');
    assert.equal(accountCustomer.phone, '5550000000');
    assert.equal(accountCustomer.address, 'Old address');
  });
}

test('saves a Couple Full Meal order and counts its preparation once', async () => {
  const { response, savedOrder, subscriptions } = await submitPlans([
    { packageType: 'full', size: 'couple', quantity: 1 }
  ]);

  assert.equal(response.statusCode, 201);
  assert.equal(savedOrder.items[0].productName, 'Tiffin Plan — Full Meal Package (Couple)');
  assert.equal(savedOrder.items[0].fulfillment, 'delivery');
  assert.equal(savedOrder.totalAmount, 300);
  assert.equal(subscriptions.length, 1);
  assert.equal(subscriptions[0].size, 'couple');
  assert.equal(buildPreparationTotals(subscriptions).smallCurd, 1);
});

test('persists Couple and Family subscriptions and aggregates both curd sizes', async () => {
  const { response, subscriptions } = await submitPlans([
    { packageType: 'full', size: 'couple', quantity: 1 },
    { packageType: 'full', size: 'family', quantity: 1 }
  ]);

  assert.equal(response.statusCode, 201);
  assert.equal(subscriptions.length, 2);
  assert.equal(subscriptions[0].orderId, subscriptions[1].orderId);
  const totals = buildPreparationTotals(subscriptions);
  assert.equal(totals.smallCurd, 1);
  assert.equal(totals.bigCurd, 1);
});

test('removes the newly created order and partial subscriptions when subscription persistence fails', async () => {
  const state = {};
  await assert.rejects(
    submitPlans([
      { packageType: 'full', size: 'couple', quantity: 1 },
      { packageType: 'full', size: 'family', quantity: 1 }
    ], { failAtSubscription: 2, state }),
    /subscription write failed/
  );
  assert.equal(state.cleanup.length, 2);
  assert.equal(state.cleanup[0][0], 'subscriptions');
  assert.equal(state.cleanup[1][0], 'order');
});

test('saves edited preparation items on the permanent order without changing order metadata', async () => {
  const original = {
    _id: new mongoose.Types.ObjectId(),
    orderId: '26101100001',
    customer: new mongoose.Types.ObjectId(),
    type: 'tiffin',
    status: 'ACCEPTED',
    totalAmount: 640,
    subscriptionStartDate: new Date('2026-10-12T00:00:00'),
    subscriptionEndDate: new Date('2026-11-06T00:00:00'),
    deliveryMemberId: new mongoose.Types.ObjectId(),
    items: [
      { productName: 'Tiffin Plan — Full Meal Package (Couple)', quantity: 1, subtotal: 300, fulfillment: 'delivery' },
      { productName: 'Tiffin Plan — Full Meal Package (Family)', quantity: 1, subtotal: 340, fulfillment: 'delivery' }
    ],
    tiffinItems: [{ productName: 'Small Curd', preparationType: 'smallCurd', quantity: 1 }],
    tiffinItemsCustomized: false,
    save: async function () {},
    toObject: function () {
      const { save, toObject, ...plainOrder } = this;
      return plainOrder;
    }
  };
  const originalStartDate = original.subscriptionStartDate.getTime();
  const loaded = loadController({
    savedOrder: original,
    findOrder: async () => original
  });
  const response = {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };

  try {
    await loaded.controller.updateTiffinItems({
      params: { id: String(original._id) },
      body: { items: [{ preparationType: 'bigCurd', quantity: 2 }] },
      app: { get: () => null }
    }, response);
  } finally {
    loaded.restore();
  }

  assert.equal(response.statusCode, 200);
  assert.equal(original.tiffinItems[0].preparationType, 'bigCurd');
  assert.equal(original.tiffinItems[0].quantity, 2);
  assert.equal(original.tiffinItemsCustomized, true);
  assert.equal(original.orderId, '26101100001');
  assert.equal(original.status, 'ACCEPTED');
  assert.equal(original.totalAmount, 640);
  assert.equal(original.items.length, 2);
  assert.deepEqual(original.items.map((item) => item.productName), [
    'Tiffin Plan — Full Meal Package (Couple)',
    'Tiffin Plan — Full Meal Package (Family)'
  ]);
  assert.equal(original.subscriptionStartDate.getTime(), originalStartDate);
  assert.ok(original.deliveryMemberId);
});

test('saves additional delivery items without changing amount or original subscription items', async () => {
  const original = {
    _id: new mongoose.Types.ObjectId(),
    orderId: '26101100021',
    customer: new mongoose.Types.ObjectId(),
    type: 'tiffin',
    status: 'ACCEPTED',
    totalAmount: 160,
    subscriptionStartDate: new Date('2026-10-12T00:00:00'),
    subscriptionEndDate: new Date('2026-11-06T00:00:00'),
    tiffinPlan: { packageType: 'curry-only', size: 'couple' },
    items: [
      { productName: 'Tiffin Plan — Curry-Only Package (Couple)', quantity: 1, subtotal: 160, fulfillment: 'delivery' }
    ],
    tiffinItems: [
      { productName: 'Medium Dal', preparationType: 'mediumDal', quantity: 1 },
      { productName: 'Medium Curry', preparationType: 'mediumCurry', quantity: 1 }
    ],
    tiffinItemsCustomized: false,
    save: async function () {},
    toObject: function () {
      const { save, toObject, ...plainOrder } = this;
      return plainOrder;
    }
  };
  const loaded = loadController({
    savedOrder: original,
    findOrder: async () => original
  });
  const response = {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };

  try {
    await loaded.controller.updateTiffinItems({
      params: { id: String(original._id) },
      body: {
        items: [
          { preparationType: 'mediumDal', quantity: 1, isAdditional: false },
          { preparationType: 'mediumCurry', quantity: 1, isAdditional: false },
          { preparationType: 'largeDal', quantity: 1, isAdditional: true },
          { preparationType: 'mediumCurry', quantity: 2, isAdditional: true },
          { preparationType: 'smallCurd', quantity: 1, isAdditional: true },
          { preparationType: 'chapathi', quantity: 4, isAdditional: true },
          { preparationType: 'riceBox', quantity: 1, isAdditional: true }
        ]
      },
      app: { get: () => null }
    }, response);
  } finally {
    loaded.restore();
  }

  assert.equal(response.statusCode, 200);
  assert.equal(original.totalAmount, 160);
  assert.equal(original.orderId, '26101100021');
  assert.deepEqual(original.items.map((item) => item.productName), [
    'Tiffin Plan — Curry-Only Package (Couple)'
  ]);
  assert.equal(original.tiffinItems.length, 6);
  assert.equal(original.tiffinItems.filter((item) => !item.isAdditional).length, 1);
  assert.equal(original.tiffinItems.filter((item) => item.isAdditional).length, 5);
  const mergedCurry = original.tiffinItems.find((item) => item.preparationType === 'mediumCurry');
  assert.equal(mergedCurry.quantity, 3);
  assert.equal(mergedCurry.originalQuantity, 1);
  assert.equal(mergedCurry.additionalQuantity, 2);
  assert.equal(original.tiffinItems.find((item) => item.preparationType === 'chapathi').quantity, 4);
  assert.equal(original.tiffinItems.find((item) => item.isAdditional && item.preparationType === 'largeDal').productName, 'Large Dal');
  assert.equal(original.tiffinItems.find((item) => item.isAdditional && item.preparationType === 'largeDal').itemKey, 'dal');
  assert.equal(original.tiffinItems.find((item) => item.isAdditional && item.preparationType === 'largeDal').size, 'large');
  assert.equal(original.tiffinItems.find((item) => item.isAdditional && item.preparationType === 'chapathi').itemKey, 'chapati');
  assert.equal(original.tiffinItems.find((item) => item.isAdditional && item.preparationType === 'chapathi').size, null);
});

test('rejects zero or invalid additional item quantities', async () => {
  const original = {
    _id: new mongoose.Types.ObjectId(),
    type: 'tiffin',
    totalAmount: 160,
    items: [{ productName: 'Curry-Only', quantity: 1, fulfillment: 'delivery' }],
    tiffinItems: [],
    save: async function () {},
    toObject: function () {
      const { save, toObject, ...plainOrder } = this;
      return plainOrder;
    }
  };
  const loaded = loadController({ findOrder: async () => original });
  const response = {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };

  try {
    await loaded.controller.updateTiffinItems({
      params: { id: String(original._id) },
      body: { items: [{ preparationType: 'chapathi', quantity: 0, isAdditional: true }] },
      app: { get: () => null }
    }, response);
  } finally {
    loaded.restore();
  }

  assert.equal(response.statusCode, 400);
  assert.equal(original.tiffinItems.length, 0);
  assert.equal(original.totalAmount, 160);
});

test('order retrieval returns the persisted edited items instead of rebuilding package defaults', async () => {
  const editedItems = [{ productName: 'Big Curd', preparationType: 'bigCurd', quantity: 2 }];
  const savedOrder = {
    _id: new mongoose.Types.ObjectId(),
    orderId: '26101100002',
    type: 'tiffin',
    status: 'ACCEPTED',
    totalAmount: 300,
    subscriptionStartDate: new Date('2026-10-12T00:00:00'),
    subscriptionEndDate: new Date('2026-11-06T00:00:00'),
    tiffinItems: editedItems,
    tiffinItemsCustomized: true,
    tiffinPlan: { packageType: 'full', size: 'couple' },
    items: [{ category: 'Tiffin Plans', productName: 'Full Meal Package (Couple)', quantity: 1, fulfillment: 'delivery' }]
  };
  const loaded = loadController({
    savedOrder,
    findOrder: () => ({
      populate: async () => ({
        ...savedOrder,
        toObject: () => ({ ...savedOrder })
      })
    })
  });
  const response = {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };

  try {
    await loaded.controller.getOrder({ params: { id: String(savedOrder._id) } }, response);
  } finally {
    loaded.restore();
  }

  assert.equal(response.statusCode, null);
  assert.deepEqual(response.body.order.tiffinItems, editedItems);
  assert.equal(response.body.order.orderId, savedOrder.orderId);
  assert.equal(response.body.order.totalAmount, savedOrder.totalAmount);
});

test('orders API applies creation-time range, case-insensitive search, and fulfillment filters together', async () => {
  const aggregateCalls = [];
  const loaded = loadController({
    aggregateOrder: async (pipeline) => {
      aggregateCalls.push(pipeline);
      return aggregateCalls.length === 1 ? [{ data: [], total: [{ n: 0 }] }] : [];
    }
  });

  const response = {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };

  try {
    await loaded.controller.listOrders({
      query: {
        createdFrom: '2026-10-11T18:30:00.000Z',
        createdTo: '2026-10-12T18:30:00.000Z',
        search: '  John Doe  ',
        fulfillment: 'delivery'
      }
    }, response);
  } finally {
    loaded.restore();
  }

  const pipeline = aggregateCalls[0];
  const matchStages = pipeline.filter((stage) => stage.$match);
  const searchMatch = matchStages.find((stage) => stage.$match.$and);
  assert.ok(searchMatch);
  // createdFrom and createdTo are timestamp fields, not calendar dates, so they use the provided UTC timestamps
  assert.equal(searchMatch.$match.createdAt.$gte.toISOString(), '2026-10-11T18:30:00.000Z');
  assert.equal(searchMatch.$match.createdAt.$lt.toISOString(), '2026-10-12T18:30:00.000Z');
  const orGroups = searchMatch.$match.$and.map((condition) => condition.$or).filter(Boolean);
  assert.equal(orGroups.length, 1);
  assert.equal(orGroups[0][0].orderId.flags, 'i');
  assert.equal(orGroups[0][0].orderId.source, 'John Doe');
  assert.ok(orGroups[0].some((condition) => condition.$expr?.$regexMatch?.input?.$concat));
  assert.ok(orGroups[0].some((condition) => condition['customerDoc.email']));
  assert.ok(orGroups[0].some((condition) => condition['customerDoc.phone']));
  assert.ok(orGroups[0].some((condition) => condition['customerDoc.address']));
  assert.ok(orGroups[0].some((condition) => condition['customerDoc.area']));
  assert.ok(orGroups[0].some((condition) => condition.deliveryAddress));
  assert.ok(matchStages.some((stage) => stage.$match['items.fulfillment'] === 'delivery'));
  assert.equal(response.body.total, 0);
});

test('orders API filters delivery by local start date and includes status aliases in search', async () => {
  let captured;
  const loaded = loadController({
    aggregateOrder: async (pipeline) => {
      if (!captured) captured = pipeline;
      return [{ data: [], total: [] }];
    }
  });
  const response = { status() { return this; }, json() {} };

  try {
    await loaded.controller.listOrders({
      query: { orderDate: '2026-10-12', search: ' OUT for delivery ', fulfillment: 'delivery' }
    }, response);
  } finally {
    loaded.restore();
  }

  const match = captured.find((stage) => stage.$match?.$and)?.$match;
  assert.equal(formatDateKey(match.subscriptionStartDate.$gte), '2026-10-12');
  assert.equal(formatDateKey(match.subscriptionStartDate.$lt), '2026-10-13');
  const searchFields = match.$and.flatMap((condition) => condition.$or || []);
  assert.ok(searchFields.some((condition) => condition.status?.test('OUT_FOR_DELIVERY')));
  assert.ok(searchFields.some((condition) => condition['items.deliveryStatus']?.test('OUT_FOR_DELIVERY')));
  assert.ok(captured.some((stage) => stage.$set?.customerDoc?.$mergeObjects));
});

test('orders API filters pickup by pickup date and maps Pickup Completed to delivered status', async () => {
  let captured;
  const loaded = loadController({
    aggregateOrder: async (pipeline) => {
      if (!captured) captured = pipeline;
      return [{ data: [], total: [] }];
    }
  });
  const response = { status() { return this; }, json() {} };

  try {
    await loaded.controller.listOrders({
      query: { orderDate: '2026-10-12', search: 'Pickup Completed', fulfillment: 'pickup' }
    }, response);
  } finally {
    loaded.restore();
  }

  const match = captured.find((stage) => stage.$match?.$and)?.$match;
  assert.equal(formatDateKey(match.pickupDate.$gte), '2026-10-12');
  const searchFields = match.$and.flatMap((condition) => condition.$or || []);
  assert.ok(searchFields.some((condition) => condition.status?.test('DELIVERED')));
  assert.ok(captured.some((stage) => stage.$match?.$or?.some((condition) => condition['items.fulfillment'] === 'pickup')));
});

test('escapes search metacharacters and matches phone digits across formatting', async () => {
  let captured;
  const loaded = loadController({
    aggregateOrder: async (pipeline) => {
      if (!captured) captured = pipeline;
      return [{ data: [], total: [{ n: 0 }] }];
    }
  });
  const response = { status(code) { return this; }, json() {} };

  try {
    await loaded.controller.listOrders({ query: { search: '  (555) 123  ', fulfillment: 'pickup' } }, response);
  } finally {
    loaded.restore();
  }

  const match = captured.find((stage) => stage.$match?.$and)?.$match;
  const searchFields = match.$and.flatMap((condition) => condition.$or || []);
  assert.equal(searchFields[0].orderId.source, '\\(555\\) 123');
  assert.ok(searchFields.some((condition) => condition.$expr?.$regexMatch?.regex === '\\D*5\\D*5\\D*5\\D*1\\D*2\\D*3'));
  assert.ok(captured.some((stage) => stage.$match?.$or?.some((condition) => condition['items.fulfillment'] === 'pickup')));
});

test('admin orders API retains every plan item and the permanent order total', async () => {
  const savedOrder = {
    _id: new mongoose.Types.ObjectId(),
    orderId: '26101100011',
    type: 'tiffin',
    totalAmount: 640,
    items: [
      { productName: 'Tiffin Plan — Full Meal Package (Couple)', quantity: 1, subtotal: 300, fulfillment: 'delivery' },
      { productName: 'Tiffin Plan — Full Meal Package (Family)', quantity: 1, subtotal: 340, fulfillment: 'delivery' }
    ]
  };
  let callCount = 0;
  const loaded = loadController({
    aggregateOrder: async () => {
      callCount += 1;
      return callCount === 1
        ? [{ data: [savedOrder], total: [{ n: 1 }] }]
        : [];
    }
  });
  const response = {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };

  try {
    await loaded.controller.listOrders({ query: { fulfillment: 'delivery' } }, response);
  } finally {
    loaded.restore();
  }

  assert.equal(response.body.orders.length, 1);
  assert.equal(response.body.orders[0].orderId, '26101100011');
  assert.equal(response.body.orders[0].items.length, 2);
  assert.deepEqual(response.body.orders[0].items.map((item) => [item.productName, item.quantity]), [
    ['Tiffin Plan — Full Meal Package (Couple)', 1],
    ['Tiffin Plan — Full Meal Package (Family)', 1]
  ]);
  assert.equal(response.body.orders[0].totalAmount, 640);
});

test('merges matching items into existing items, never merges different sizes, and preserves canonical names', async () => {
  const original = {
    _id: new mongoose.Types.ObjectId(),
    orderId: '26101100099',
    type: 'tiffin',
    totalAmount: 120,
    tiffinPlan: { packageType: 'full', size: 'single' },
    items: [
      { productName: 'Tiffin Plan — Full Meal Package (Single)', quantity: 1, subtotal: 120, fulfillment: 'delivery' }
    ],
    tiffinItems: [
      { productName: 'Small Dal', preparationType: 'smallDal', quantity: 1, originalQuantity: 1, additionalQuantity: 0 },
      { productName: 'Small Curry', preparationType: 'smallCurry', quantity: 1, originalQuantity: 1, additionalQuantity: 0 },
      { productName: 'Chapathi', preparationType: 'chapathi', quantity: 4, originalQuantity: 4, additionalQuantity: 0 },
      { productName: 'Rice Box', preparationType: 'riceBox', quantity: 1, originalQuantity: 1, additionalQuantity: 0 },
      { productName: 'Small Curd', preparationType: 'smallCurd', quantity: 1, originalQuantity: 1, additionalQuantity: 0 }
    ],
    tiffinItemsCustomized: false,
    save: async function () {},
    toObject: function () {
      const { save, toObject, ...plainOrder } = this;
      return plainOrder;
    }
  };

  const loaded = loadController({
    savedOrder: original,
    findOrder: async () => original
  });
  const response = {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };

  try {
    await loaded.controller.updateTiffinItems({
      params: { id: String(original._id) },
      body: {
        items: [
          // Existing items
          { preparationType: 'smallDal', quantity: 1, isAdditional: false },
          { preparationType: 'smallCurry', quantity: 1, isAdditional: false },
          { preparationType: 'chapathi', quantity: 4, isAdditional: false },
          { preparationType: 'riceBox', quantity: 1, isAdditional: false },
          { preparationType: 'smallCurd', quantity: 1, isAdditional: false },
          // Added items to merge
          { itemKey: 'dal', size: 'small', quantity: 2, isAdditional: true }, // Dal + Small -> merges with Small Dal (1 + 2 = 3)
          { itemKey: 'chapati', quantity: 2, isAdditional: true }, // Chapati -> merges with Chapathi (4 + 2 = 6)
          { itemKey: 'rice', quantity: 1, isAdditional: true }, // Rice -> merges with Rice Box (1 + 1 = 2)
          // Added item with different size
          { itemKey: 'dal', size: 'large', quantity: 1, isAdditional: true }, // Dal + Large -> does NOT merge with Small Dal, creates Large Dal
          // Added large curd
          { itemKey: 'curd', size: 'large', quantity: 1, isAdditional: true } // Curd + Large -> creates Big Curd
        ]
      },
      app: { get: () => null }
    }, response);
  } finally {
    loaded.restore();
  }

  assert.equal(response.statusCode, 200);
  assert.equal(original.totalAmount, 120); // Amount unchanged

  // Verify Small Dal merged to 3
  const smallDal = original.tiffinItems.find((i) => i.preparationType === 'smallDal');
  assert.equal(smallDal.quantity, 3);
  assert.equal(smallDal.originalQuantity, 1);
  assert.equal(smallDal.additionalQuantity, 2);

  // Verify Chapathi merged to 6
  const chapathi = original.tiffinItems.find((i) => i.preparationType === 'chapathi');
  assert.equal(chapathi.quantity, 6);
  assert.equal(chapathi.originalQuantity, 4);
  assert.equal(chapathi.additionalQuantity, 2);

  // Verify Rice Box merged to 2
  const rice = original.tiffinItems.find((i) => i.preparationType === 'riceBox');
  assert.equal(rice.quantity, 2);
  assert.equal(rice.originalQuantity, 1);
  assert.equal(rice.additionalQuantity, 1);

  // Verify Large Dal created separately and NOT merged with Small Dal
  const largeDal = original.tiffinItems.find((i) => i.preparationType === 'largeDal');
  assert.ok(largeDal, 'Large Dal must exist as separate entry');
  assert.equal(largeDal.quantity, 1);
  assert.equal(largeDal.originalQuantity, 0);
  assert.equal(largeDal.additionalQuantity, 1);

  // Verify Big Curd created with canonical name
  const bigCurd = original.tiffinItems.find((i) => i.preparationType === 'bigCurd');
  assert.ok(bigCurd, 'Big Curd must exist as canonical item');
  assert.equal(bigCurd.productName, 'Big Curd');
  assert.equal(bigCurd.quantity, 1);

  // Total consolidated items = 7 (Small Dal, Small Curry, Chapathi, Rice Box, Small Curd, Large Dal, Big Curd)
  assert.equal(original.tiffinItems.length, 7);
});

test('persists custom items added via + Add and validates invalid custom names', async () => {
  const original = {
    _id: new mongoose.Types.ObjectId(),
    orderId: '26101100100',
    type: 'tiffin',
    totalAmount: 200,
    tiffinPlan: { packageType: 'curry-only', size: 'single' },
    items: [{ productName: 'Curry-Only', quantity: 1, fulfillment: 'delivery' }],
    tiffinItems: [],
    tiffinItemsCustomized: false,
    save: async function () {},
    toObject: function () {
      const { save, toObject, ...plainOrder } = this;
      return plainOrder;
    }
  };

  const loaded = loadController({
    savedOrder: original,
    findOrder: async () => original
  });

  try {
    // 1. Reject invalid custom name: "+ Add"
    const res1 = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
    await loaded.controller.updateTiffinItems({
      params: { id: String(original._id) },
      body: {
        items: [{ customName: '+ Add', quantity: 1, isAdditional: true }]
      },
      app: { get: () => null }
    }, res1);
    assert.equal(res1.statusCode, 400);

    // 2. Reject empty custom name
    const res2 = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
    await loaded.controller.updateTiffinItems({
      params: { id: String(original._id) },
      body: {
        items: [{ customName: '   ', quantity: 1, isAdditional: true }]
      },
      app: { get: () => null }
    }, res2);
    assert.equal(res2.statusCode, 400);

    // 3. Accept valid custom item
    const res3 = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
    await loaded.controller.updateTiffinItems({
      params: { id: String(original._id) },
      body: {
        items: [
          { customName: 'Mango Pickle', size: 'small', quantity: 2, isAdditional: true }
        ]
      },
      app: { get: () => null }
    }, res3);
    assert.equal(res3.statusCode, 200);
    assert.equal(original.tiffinItems.length, 1);
    assert.equal(original.tiffinItems[0].productName, 'Small Mango Pickle');
    assert.equal(original.tiffinItems[0].quantity, 2);
    assert.equal(original.tiffinItems[0].additionalQuantity, 2);
  } finally {
    loaded.restore();
  }
});

test('repeated saves do not duplicate quantities or items', async () => {
  const original = {
    _id: new mongoose.Types.ObjectId(),
    orderId: '26101100101',
    type: 'tiffin',
    totalAmount: 160,
    tiffinPlan: { packageType: 'curry-only', size: 'couple' },
    items: [{ productName: 'Curry-Only Couple', quantity: 1, fulfillment: 'delivery' }],
    tiffinItems: [
      { productName: 'Medium Dal', preparationType: 'mediumDal', quantity: 5, originalQuantity: 1, additionalQuantity: 4, isAdditional: true }
    ],
    tiffinItemsCustomized: true,
    save: async function () {},
    toObject: function () {
      const { save, toObject, ...plainOrder } = this;
      return plainOrder;
    }
  };

  const loaded = loadController({
    savedOrder: original,
    findOrder: async () => original
  });

  const response = {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };

  try {
    // Save once
    await loaded.controller.updateTiffinItems({
      params: { id: String(original._id) },
      body: { items: original.tiffinItems },
      app: { get: () => null }
    }, response);

    assert.equal(original.tiffinItems.length, 1);
    assert.equal(original.tiffinItems[0].quantity, 5);

    // Save again with same items
    await loaded.controller.updateTiffinItems({
      params: { id: String(original._id) },
      body: { items: original.tiffinItems },
      app: { get: () => null }
    }, response);

    assert.equal(original.tiffinItems.length, 1);
    assert.equal(original.tiffinItems[0].quantity, 5);
  } finally {
    loaded.restore();
  }
});
