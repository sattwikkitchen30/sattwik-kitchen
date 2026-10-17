const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { buildPreparationTotals } = require('../server/utils/tiffinPreparation');

function loadOrderController(overrides = {}) {
  const dependencies = {
    '../models/Order': {
      findById: async (id) => (overrides.findOrder ? overrides.findOrder(id) : overrides.savedOrder)
    },
    '../models/Customer': { findById: async () => ({ _id: new mongoose.Types.ObjectId() }) },
    '../models/Product': {},
    '../models/TiffinSubscription': {
      findOneAndUpdate: async () => ({}),
      deleteMany: async () => ({})
    },
    '../models/DeliveryPlan': {
      find: () => ({
        select: () => ({
          lean: async () => [
            {
              displayName: 'Full Meal (Single)',
              items: { dal: 'small', curry: 'small', chapati: 4, rice: 1, curd: 'small', dynamicItems: [] }
            },
            {
              displayName: 'Curry-Only (Couple)',
              items: { dal: 'medium', curry: 'medium', chapati: 0, rice: 0, curd: null, dynamicItems: [] }
            }
          ]
        })
      })
    },
    '../utils/orderEvents': { emitOrderUpdate: () => {} }
  };

  const path = require('path');
  const cached = new Map();
  for (const [request, exports] of Object.entries(dependencies)) {
    const filename = path.resolve(__dirname, '../server/controllers', request + (request.endsWith('.js') ? '' : '.js'));
    cached.set(filename, require.cache[filename]);
    require.cache[filename] = { id: filename, filename, loaded: true, exports };
  }

  // Clear orderController cache so it loads with mocks
  const controllerPath = require.resolve('../server/controllers/orderController');
  const cachedController = require.cache[controllerPath];
  delete require.cache[controllerPath];
  const controller = require('../server/controllers/orderController');

  return {
    controller,
    restore() {
      for (const [filename, original] of cached) {
        if (original) require.cache[filename] = original;
        else delete require.cache[filename];
      }
      if (cachedController) require.cache[controllerPath] = cachedController;
      else delete require.cache[controllerPath];
    }
  };
}

test('standalone delivery order (order 26101600004): editing item quantity updates tiffinItems and order.items synchronously', async () => {
  const original = {
    _id: new mongoose.Types.ObjectId(),
    orderId: '26101600004',
    customer: new mongoose.Types.ObjectId(),
    type: 'tiffin',
    fulfillment: 'delivery',
    status: 'ACCEPTED',
    totalAmount: 50.00,
    subscriptionStartDate: new Date('2026-10-21T00:00:00Z'),
    subscriptionEndDate: new Date('2026-11-17T00:00:00Z'),
    tiffinPlan: { packageType: null, size: null, price: null },
    items: [
      {
        productId: null,
        productName: 'Large Curry',
        category: 'Tiffin Preparation',
        fulfillment: 'delivery',
        deliveryStatus: 'ACCEPTED',
        priceAtPurchase: 50.00,
        quantity: 1,
        subtotal: 50.00
      }
    ],
    tiffinItems: [
      {
        productId: null,
        productName: 'Large Curry',
        category: 'Tiffin Preparation',
        preparationType: 'largeCurry',
        quantity: 1,
        isAdditional: false,
        itemKey: 'curry',
        size: 'large',
        originalQuantity: 1,
        additionalQuantity: 0
      }
    ],
    tiffinItemsCustomized: false,
    save: async function () {},
    toObject: function () {
      const { save, toObject, ...plain } = this;
      return JSON.parse(JSON.stringify(plain));
    }
  };

  const loaded = loadOrderController({ savedOrder: original });
  const response = {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };

  try {
    // Admin edits Large Curry quantity from 1 to 2
    await loaded.controller.updateTiffinItems({
      params: { id: String(original._id) },
      body: {
        items: [
          {
            preparationType: 'largeCurry',
            productName: 'Large Curry',
            quantity: 2,
            originalQuantity: 1,
            additionalQuantity: 1,
            isAdditional: true
          }
        ]
      },
      app: { get: () => null }
    }, response);
  } finally {
    loaded.restore();
  }

  assert.equal(response.statusCode, null); // 200 via default json()
  assert.equal(response.body.message, 'Order items updated successfully.');

  // 1. Backend database object updated
  assert.equal(original.tiffinItems.length, 1);
  assert.equal(original.tiffinItems[0].quantity, 2);
  assert.equal(original.items.length, 1);
  assert.equal(original.items[0].productName, 'Large Curry');
  assert.equal(original.items[0].quantity, 2);
  assert.equal(original.items[0].subtotal, 100.00);

  // 2. Order totalAmount preserved (not overwritten)
  assert.equal(original.totalAmount, 50.00);

  // 3. Response order contains updated item quantity
  assert.equal(response.body.order.items[0].quantity, 2);
  assert.equal(response.body.order.tiffinItems[0].quantity, 2);

  // 4. Admin Orders rendering view model check:
  // Admin Orders table filters items by fulfillment === 'delivery'
  const adminDisplayedItems = original.items.filter((i) => i.fulfillment === 'delivery');
  assert.equal(adminDisplayedItems.length, 1);
  assert.equal(adminDisplayedItems[0].productName, 'Large Curry');
  assert.equal(adminDisplayedItems[0].quantity, 2);

  // 5. Customer My Orders rendering view model check:
  // Customer My Orders filters deliveryItems = order.items.filter(i => i.fulfillment === 'delivery')
  const customerDeliveryItems = (original.items || []).filter((i) => i.fulfillment === 'delivery');
  assert.equal(customerDeliveryItems.length, 1);
  assert.equal(customerDeliveryItems[0].quantity, 2);

  // 6. Tiffin Preparation aggregation reflects updated count
  const totals = buildPreparationTotals([{ orderId: original }]);
  assert.equal(totals.largeCurries, 2);
});

test('standalone delivery order: adding new items and removing existing items updates order.items accurately', async () => {
  const original = {
    _id: new mongoose.Types.ObjectId(),
    orderId: '26101600005',
    customer: new mongoose.Types.ObjectId(),
    type: 'tiffin',
    fulfillment: 'delivery',
    status: 'ACCEPTED',
    totalAmount: 50.00,
    subscriptionStartDate: new Date('2026-10-21T00:00:00Z'),
    subscriptionEndDate: new Date('2026-11-17T00:00:00Z'),
    tiffinPlan: { packageType: null, size: null, price: null },
    items: [
      {
        productId: null,
        productName: 'Large Curry',
        category: 'Tiffin Preparation',
        fulfillment: 'delivery',
        deliveryStatus: 'ACCEPTED',
        priceAtPurchase: 50.00,
        quantity: 1,
        subtotal: 50.00
      }
    ],
    tiffinItems: [
      {
        productId: null,
        productName: 'Large Curry',
        category: 'Tiffin Preparation',
        preparationType: 'largeCurry',
        quantity: 1,
        isAdditional: false,
        itemKey: 'curry',
        size: 'large',
        originalQuantity: 1,
        additionalQuantity: 0
      }
    ],
    tiffinItemsCustomized: false,
    save: async function () {},
    toObject: function () {
      const { save, toObject, ...plain } = this;
      return JSON.parse(JSON.stringify(plain));
    }
  };

  const loaded = loadOrderController({ savedOrder: original });
  const response = {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };

  try {
    // Admin adds Medium Dal x 1 and updates Large Curry to 2
    await loaded.controller.updateTiffinItems({
      params: { id: String(original._id) },
      body: {
        items: [
          { preparationType: 'largeCurry', quantity: 2, isAdditional: true },
          { preparationType: 'mediumDal', quantity: 1, isAdditional: true }
        ]
      },
      app: { get: () => null }
    }, response);
  } finally {
    loaded.restore();
  }

  assert.equal(original.items.length, 2);
  const curry = original.items.find((i) => i.productName === 'Large Curry');
  const dal = original.items.find((i) => i.productName === 'Medium Dal');
  assert.ok(curry);
  assert.ok(dal);
  assert.equal(curry.quantity, 2);
  assert.equal(dal.quantity, 1);
  assert.equal(dal.fulfillment, 'delivery');

  // Tiffin preparation reflects both
  const totals = buildPreparationTotals([{ orderId: original }]);
  assert.equal(totals.largeCurries, 2);
  assert.equal(totals.mediumDal, 1);
});

test('package bundle subscription order: preserves package item and subscription price in order.items', async () => {
  const original = {
    _id: new mongoose.Types.ObjectId(),
    orderId: '26101100021',
    customer: new mongoose.Types.ObjectId(),
    type: 'tiffin',
    fulfillment: 'delivery',
    status: 'ACCEPTED',
    totalAmount: 160.00,
    subscriptionStartDate: new Date('2026-10-21T00:00:00Z'),
    subscriptionEndDate: new Date('2026-11-17T00:00:00Z'),
    tiffinPlan: { packageType: 'curry-only', size: 'couple', price: 160.00 },
    items: [
      {
        productId: null,
        productName: 'Tiffin Plan — Curry-Only Package (Couple)',
        category: 'Tiffin Plans',
        fulfillment: 'delivery',
        deliveryStatus: 'ACCEPTED',
        priceAtPurchase: 160.00,
        quantity: 1,
        subtotal: 160.00
      }
    ],
    tiffinItems: [
      {
        productName: 'Medium Dal',
        preparationType: 'mediumDal',
        quantity: 1,
        originalQuantity: 1,
        additionalQuantity: 0,
        isAdditional: false
      },
      {
        productName: 'Medium Curry',
        preparationType: 'mediumCurry',
        quantity: 1,
        originalQuantity: 1,
        additionalQuantity: 0,
        isAdditional: false
      }
    ],
    tiffinItemsCustomized: false,
    save: async function () {},
    toObject: function () {
      const { save, toObject, ...plain } = this;
      return JSON.parse(JSON.stringify(plain));
    }
  };

  const loaded = loadOrderController({ savedOrder: original });
  const response = {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };

  try {
    // Admin edits preparation items: Medium Curry x 2, Chapathi x 4
    await loaded.controller.updateTiffinItems({
      params: { id: String(original._id) },
      body: {
        items: [
          { preparationType: 'mediumDal', quantity: 1, isAdditional: false },
          { preparationType: 'mediumCurry', quantity: 2, isAdditional: true },
          { preparationType: 'chapathi', quantity: 4, isAdditional: true }
        ]
      },
      app: { get: () => null }
    }, response);
  } finally {
    loaded.restore();
  }

  // Package item is preserved untouched in order.items
  assert.equal(original.items.length, 1);
  assert.equal(original.items[0].productName, 'Tiffin Plan — Curry-Only Package (Couple)');
  assert.equal(original.items[0].quantity, 1);
  assert.equal(original.items[0].priceAtPurchase, 160.00);
  assert.equal(original.totalAmount, 160.00);

  // tiffinItems reflect the preparation details
  assert.equal(original.tiffinItems.length, 3);
  const curryPrep = original.tiffinItems.find((t) => t.preparationType === 'mediumCurry');
  assert.equal(curryPrep.quantity, 2);
  const chapathiPrep = original.tiffinItems.find((t) => t.preparationType === 'chapathi');
  assert.equal(chapathiPrep.quantity, 4);

  // Tiffin preparation calculates correctly
  const totals = buildPreparationTotals([{ orderId: original }]);
  assert.equal(totals.mediumCurries, 2);
  assert.equal(totals.chapathiCount, 4);
});

test('repeated saves do not multiply quantities or duplicate items in order.items or tiffinItems', async () => {
  const original = {
    _id: new mongoose.Types.ObjectId(),
    orderId: '26101600004',
    customer: new mongoose.Types.ObjectId(),
    type: 'tiffin',
    fulfillment: 'delivery',
    status: 'ACCEPTED',
    totalAmount: 50.00,
    subscriptionStartDate: new Date('2026-10-21T00:00:00Z'),
    subscriptionEndDate: new Date('2026-11-17T00:00:00Z'),
    tiffinPlan: { packageType: null, size: null, price: null },
    items: [
      {
        productId: null,
        productName: 'Large Curry',
        category: 'Tiffin Preparation',
        fulfillment: 'delivery',
        deliveryStatus: 'ACCEPTED',
        priceAtPurchase: 50.00,
        quantity: 1,
        subtotal: 50.00
      }
    ],
    tiffinItems: [
      {
        productId: null,
        productName: 'Large Curry',
        category: 'Tiffin Preparation',
        preparationType: 'largeCurry',
        quantity: 2,
        isAdditional: true,
        itemKey: 'curry',
        size: 'large',
        originalQuantity: 1,
        additionalQuantity: 1
      }
    ],
    tiffinItemsCustomized: true,
    save: async function () {},
    toObject: function () {
      const { save, toObject, ...plain } = this;
      return JSON.parse(JSON.stringify(plain));
    }
  };

  const loaded = loadOrderController({ savedOrder: original });
  const response = {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };

  try {
    // First save
    await loaded.controller.updateTiffinItems({
      params: { id: String(original._id) },
      body: { items: original.tiffinItems },
      app: { get: () => null }
    }, response);

    assert.equal(original.tiffinItems.length, 1);
    assert.equal(original.tiffinItems[0].quantity, 2);
    assert.equal(original.items.length, 1);
    assert.equal(original.items[0].quantity, 2);

    // Second save with exact same data
    await loaded.controller.updateTiffinItems({
      params: { id: String(original._id) },
      body: { items: original.tiffinItems },
      app: { get: () => null }
    }, response);

    assert.equal(original.tiffinItems.length, 1);
    assert.equal(original.tiffinItems[0].quantity, 2);
    assert.equal(original.items.length, 1);
    assert.equal(original.items[0].quantity, 2);
  } finally {
    loaded.restore();
  }
});
