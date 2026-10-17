const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

// Browser mocks for admin.js
global.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
global.window = { location: { href: '', pathname: '', search: '' }, addEventListener: () => {} };
global.document = {
  getElementById: () => ({ addEventListener: () => {}, querySelectorAll: () => [], classList: { add: () => {}, remove: () => {} } }),
  createElement: () => ({ addEventListener: () => {}, appendChild: () => {} }),
  querySelectorAll: () => [],
  querySelector: () => null,
  addEventListener: () => {}
};

const {
  TIFFIN_PREPARATION_ITEMS,
  PREPARATION_TYPES,
  TIFFIN_PREP_KEY_MAP,
  getTiffinPreparationType,
  buildDefaultTiffinItems,
  buildOrderTiffinItems,
  getLegacyOrderTiffinItems,
  isDeliveryTiffinOrder: isDeliveryTiffinOrderBackend
} = require('../server/utils/tiffinItems');

const { isDeliveryTiffinOrder: isDeliveryTiffinOrderFrontend } = require('../admin/admin');

// ---------------------------------------------------------------------------
// 1. buildOrderTiffinItems tests
// ---------------------------------------------------------------------------
test('buildOrderTiffinItems: resolves Small Dal × 1 correctly with original bookkeeping', () => {
  const items = [
    {
      productName: 'Small Dal',
      category: 'Tiffin Preparation',
      fulfillment: 'delivery',
      quantity: 1
    }
  ];

  const tiffinItems = buildOrderTiffinItems(items);
  assert.equal(tiffinItems.length, 1);
  const dal = tiffinItems[0];
  assert.equal(dal.productName, 'Small Dal');
  assert.equal(dal.preparationType, 'smallDal');
  assert.equal(dal.itemKey, 'dal');
  assert.equal(dal.size, 'small');
  assert.equal(dal.quantity, 1);
  assert.equal(dal.originalQuantity, 1);
  assert.equal(dal.additionalQuantity, 0);
  assert.equal(dal.isAdditional, false);
});

test('buildOrderTiffinItems: expands Full Meal Package (Couple) into standard preparation items', () => {
  const items = [
    {
      productName: 'Full Meal Package (Couple)',
      category: 'Tiffin Plans',
      fulfillment: 'delivery',
      quantity: 1
    }
  ];

  const tiffinItems = buildOrderTiffinItems(items);
  // Full Meal Couple: mediumDal, mediumCurry, chapathi (4), riceBox (1), smallCurd (1)
  assert.equal(tiffinItems.length, 5);
  const byType = new Map(tiffinItems.map((item) => [item.preparationType, item]));

  assert.ok(byType.has('mediumDal'));
  assert.equal(byType.get('mediumDal').quantity, 1);
  assert.equal(byType.get('mediumDal').originalQuantity, 1);
  assert.equal(byType.get('mediumDal').additionalQuantity, 0);
  assert.equal(byType.get('mediumDal').isAdditional, false);

  assert.ok(byType.has('mediumCurry'));
  assert.equal(byType.get('mediumCurry').quantity, 1);

  assert.ok(byType.has('chapathi'));
  assert.equal(byType.get('chapathi').quantity, 4);

  assert.ok(byType.has('riceBox'));
  assert.equal(byType.get('riceBox').quantity, 1);

  assert.ok(byType.has('smallCurd'));
  assert.equal(byType.get('smallCurd').quantity, 1);
});

test('buildOrderTiffinItems: expands Curry-Only Package (Single)', () => {
  const items = [
    {
      productName: 'Curry-Only Package (Single)',
      category: 'Tiffin Plans',
      fulfillment: 'delivery',
      quantity: 1
    }
  ];

  const tiffinItems = buildOrderTiffinItems(items);
  // Curry-Only Single: smallDal, smallCurry
  assert.equal(tiffinItems.length, 2);
  const byType = new Map(tiffinItems.map((item) => [item.preparationType, item]));
  assert.ok(byType.has('smallDal'));
  assert.ok(byType.has('smallCurry'));
});

test('buildOrderTiffinItems: handles custom items and preserves originalQuantity', () => {
  const items = [
    {
      productName: 'Fresh Fruit Bowl',
      category: 'Tiffin Preparation',
      fulfillment: 'delivery',
      quantity: 2
    }
  ];

  const tiffinItems = buildOrderTiffinItems(items);
  assert.equal(tiffinItems.length, 1);
  const item = tiffinItems[0];
  assert.equal(item.productName, 'Fresh Fruit Bowl');
  assert.equal(item.quantity, 2);
  assert.equal(item.originalQuantity, 2);
  assert.equal(item.additionalQuantity, 0);
  assert.equal(item.isAdditional, false);
});

test('buildOrderTiffinItems: merges identical item rows without duplication', () => {
  const items = [
    {
      productName: 'Small Dal',
      category: 'Tiffin Preparation',
      fulfillment: 'delivery',
      quantity: 1
    },
    {
      productName: 'Small Dal',
      category: 'Tiffin Preparation',
      fulfillment: 'delivery',
      quantity: 2
    }
  ];

  const tiffinItems = buildOrderTiffinItems(items);
  assert.equal(tiffinItems.length, 1);
  assert.equal(tiffinItems[0].productName, 'Small Dal');
  assert.equal(tiffinItems[0].quantity, 3);
  assert.equal(tiffinItems[0].originalQuantity, 3);
  assert.equal(tiffinItems[0].additionalQuantity, 0);
});

test('buildOrderTiffinItems: ignores pickup items when extracting delivery tiffin items', () => {
  const items = [
    {
      productName: 'Small Dal',
      category: 'Tiffin Preparation',
      fulfillment: 'delivery',
      quantity: 1
    },
    {
      productName: 'Tomato Pickle',
      category: 'Pickles',
      fulfillment: 'pickup',
      quantity: 1
    }
  ];

  const tiffinItems = buildOrderTiffinItems(items);
  assert.equal(tiffinItems.length, 1);
  assert.equal(tiffinItems[0].productName, 'Small Dal');
});

test('buildOrderTiffinItems: falls back to tiffinPlan when items array is empty', () => {
  const tiffinItems = buildOrderTiffinItems([], { packageType: 'curry-only', size: 'single', quantity: 1 });
  assert.equal(tiffinItems.length, 2);
});

// ---------------------------------------------------------------------------
// 2. getLegacyOrderTiffinItems tests (including order 26101600002)
// ---------------------------------------------------------------------------
test('getLegacyOrderTiffinItems: resolves Small Dal × 1 for order 26101600002 lacking stored tiffinItems', () => {
  const order26101600002 = {
    orderId: '26101600002',
    type: 'product',
    fulfillment: 'delivery',
    totalAmount: 0,
    subscriptionStartDate: new Date('2026-10-17T00:00:00Z'),
    subscriptionEndDate: new Date('2026-11-13T00:00:00Z'),
    items: [
      {
        productId: null,
        productName: 'Small Dal',
        category: 'Tiffin Preparation',
        fulfillment: 'delivery',
        quantity: 1,
        priceAtPurchase: 0,
        subtotal: 0
      }
    ]
  };

  const resolved = getLegacyOrderTiffinItems(order26101600002);
  assert.equal(resolved.length, 1);
  assert.equal(resolved[0].productName, 'Small Dal');
  assert.equal(resolved[0].preparationType, 'smallDal');
  assert.equal(resolved[0].quantity, 1);
  assert.equal(resolved[0].originalQuantity, 1);
  assert.equal(resolved[0].additionalQuantity, 0);
  assert.equal(resolved[0].isAdditional, false);
});

test('getLegacyOrderTiffinItems: returns existing tiffinItems when present on order', () => {
  const orderWithSavedItems = {
    orderId: '26101600003',
    type: 'tiffin',
    fulfillment: 'delivery',
    tiffinItems: [
      {
        productName: 'Medium Dal',
        preparationType: 'mediumDal',
        quantity: 3,
        originalQuantity: 1,
        additionalQuantity: 2,
        isAdditional: true
      }
    ]
  };

  const resolved = getLegacyOrderTiffinItems(orderWithSavedItems);
  assert.equal(resolved.length, 1);
  assert.equal(resolved[0].productName, 'Medium Dal');
  assert.equal(resolved[0].quantity, 3);
  assert.equal(resolved[0].originalQuantity, 1);
  assert.equal(resolved[0].additionalQuantity, 2);
  assert.equal(resolved[0].isAdditional, true);
});

test('getLegacyOrderTiffinItems: returns empty array when order was explicitly customized to have no items', () => {
  const customizedEmptyOrder = {
    orderId: '26101600004',
    type: 'tiffin',
    fulfillment: 'delivery',
    tiffinItems: [],
    tiffinItemsCustomized: true,
    items: [
      {
        productName: 'Small Dal',
        category: 'Tiffin Preparation',
        fulfillment: 'delivery',
        quantity: 1
      }
    ]
  };

  const resolved = getLegacyOrderTiffinItems(customizedEmptyOrder);
  assert.deepEqual(resolved, []);
});

// ---------------------------------------------------------------------------
// 3. isDeliveryTiffinOrder tests
// ---------------------------------------------------------------------------
test('isDeliveryTiffinOrder: classifies order 26101600002 as delivery tiffin order', () => {
  const order26101600002 = {
    orderId: '26101600002',
    type: 'product',
    fulfillment: 'delivery',
    items: [
      {
        productName: 'Small Dal',
        category: 'Tiffin Preparation',
        fulfillment: 'delivery',
        quantity: 1
      }
    ]
  };

  assert.equal(isDeliveryTiffinOrderBackend(order26101600002), true);
  assert.equal(isDeliveryTiffinOrderFrontend(order26101600002), true);
});

test('isDeliveryTiffinOrder: classifies orders with stored tiffinItems as delivery tiffin orders', () => {
  const orderWithTiffinItems = {
    orderId: '26101600005',
    type: 'product',
    fulfillment: 'delivery',
    items: [],
    tiffinItems: [
      { productName: 'Small Dal', quantity: 1 }
    ]
  };

  assert.equal(isDeliveryTiffinOrderBackend(orderWithTiffinItems), true);
  assert.equal(isDeliveryTiffinOrderFrontend(orderWithTiffinItems), true);
});

// ---------------------------------------------------------------------------
// 4. Modal Open & Save Simulation for order 26101600002
// ---------------------------------------------------------------------------
test('Modal flow: order 26101600002 displays preparation items and retains bookkeeping on edit', () => {
  const rawOrder = {
    _id: 'ord_26101600002',
    orderId: '26101600002',
    type: 'product',
    fulfillment: 'delivery',
    subscriptionStartDate: new Date('2026-10-17T00:00:00Z'),
    subscriptionEndDate: new Date('2026-11-13T00:00:00Z'),
    items: [
      {
        productName: 'Small Dal',
        category: 'Tiffin Preparation',
        fulfillment: 'delivery',
        quantity: 1
      }
    ]
  };

  // 1. Simulating getOrder:
  const responseOrder = { ...rawOrder };
  if (isDeliveryTiffinOrderBackend(responseOrder)) {
    responseOrder.tiffinItems = getLegacyOrderTiffinItems(responseOrder);
  }

  assert.ok(Array.isArray(responseOrder.tiffinItems));
  assert.equal(responseOrder.tiffinItems.length, 1);
  assert.equal(responseOrder.tiffinItems[0].productName, 'Small Dal');

  // 2. Simulating modal initialization in admin.js:
  const savedItems = (responseOrder.tiffinItems || []).map((item) => ({ ...item }));
  const tiffinEditorItems = savedItems.map((item) => {
    const originalQuantity = Number.isInteger(item.originalQuantity) ? item.originalQuantity : (!item.isAdditional ? (Number(item.quantity) || 1) : 0);
    const additionalQuantity = Number.isInteger(item.additionalQuantity) ? item.additionalQuantity : (item.isAdditional ? (Number(item.quantity) || 1) : 0);
    return {
      ...item,
      quantity: Number(item.quantity) || 1,
      originalQuantity,
      additionalQuantity,
      isAdditional: Boolean(item.isAdditional || additionalQuantity > 0)
    };
  });

  assert.equal(tiffinEditorItems.length, 1);
  assert.equal(tiffinEditorItems[0].productName, 'Small Dal');
  assert.equal(tiffinEditorItems[0].quantity, 1);
  assert.equal(tiffinEditorItems[0].originalQuantity, 1);
  assert.equal(tiffinEditorItems[0].additionalQuantity, 0);
  assert.equal(tiffinEditorItems[0].isAdditional, false);

  // 3. User increases quantity by 1 in the UI:
  tiffinEditorItems[0].quantity = 2;
  tiffinEditorItems[0].additionalQuantity = Math.max(0, 2 - tiffinEditorItems[0].originalQuantity);
  tiffinEditorItems[0].isAdditional = tiffinEditorItems[0].additionalQuantity > 0;

  assert.equal(tiffinEditorItems[0].quantity, 2);
  assert.equal(tiffinEditorItems[0].originalQuantity, 1);
  assert.equal(tiffinEditorItems[0].additionalQuantity, 1);
  assert.equal(tiffinEditorItems[0].isAdditional, true);

  // 4. Saved to order.tiffinItems:
  rawOrder.tiffinItems = tiffinEditorItems.map((item) => ({ ...item }));
  rawOrder.tiffinItemsCustomized = true;

  // 5. Reopening the order loads the exact updated items without duplication:
  const reopenedResolved = getLegacyOrderTiffinItems(rawOrder);
  assert.equal(reopenedResolved.length, 1);
  assert.equal(reopenedResolved[0].productName, 'Small Dal');
  assert.equal(reopenedResolved[0].quantity, 2);
  assert.equal(reopenedResolved[0].originalQuantity, 1);
  assert.equal(reopenedResolved[0].additionalQuantity, 1);
  assert.equal(reopenedResolved[0].isAdditional, true);
});
