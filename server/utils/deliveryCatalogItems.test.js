const test = require('node:test');
const assert = require('node:assert/strict');
const {
  extractDeliveryCatalogItems,
  resolveDeliveryCatalogSelection,
  additionalTiffinItemToRow,
  getCanonicalIdentity,
  resolveCustomItem
} = require('./deliveryCatalogItems');

const samplePlans = [
  {
    displayName: 'Curry-Only (Single)',
    items: { dal: 'small', curry: 'small', chapati: 0, rice: 0, curd: null, dynamicItems: [] }
  },
  {
    displayName: 'Full Meal (Family)',
    items: { dal: 'large', curry: 'large', chapati: 6, rice: 1, curd: 'big', dynamicItems: [] }
  },
  {
    displayName: 'Full Meal (Couple)',
    items: {
      dynamicItems: [
        { name: 'Dal', quantity: 'medium' },
        { name: 'Curry', quantity: 'medium' },
        { name: 'Chapathi', quantity: '4' },
        { name: 'Apple', quantity: '1' }
      ]
    }
  }
];

test('catalog items come from delivery plan components, not plan names, and skip pickup-only products', () => {
  const catalog = extractDeliveryCatalogItems(samplePlans);
  assert.deepEqual(catalog.map((item) => item.key), ['dal', 'curry', 'chapati', 'rice', 'curd', 'apple']);
  assert.equal(catalog.some((item) => /full meal|curry-only/i.test(item.name)), false);
});

test('dal, curry, and curd expose configured sizes without inventing missing ones', () => {
  const catalog = extractDeliveryCatalogItems(samplePlans);
  const dal = catalog.find((item) => item.key === 'dal');
  const curry = catalog.find((item) => item.key === 'curry');
  const curd = catalog.find((item) => item.key === 'curd');
  const apple = catalog.find((item) => item.key === 'apple');

  assert.deepEqual(dal.sizes, ['small', 'medium', 'large']);
  assert.equal(dal.supportsSize, true);
  assert.deepEqual(curry.sizes, ['small', 'medium', 'large']);
  assert.deepEqual(curd.sizes, ['large']);
  assert.equal(curd.supportsSize, true);
  assert.equal(apple.supportsSize, false);
  assert.deepEqual(apple.sizes, []);
});

test('chapati and rice do not use sizes when the delivery config stores a count', () => {
  const catalog = extractDeliveryCatalogItems(samplePlans);
  const chapati = catalog.find((item) => item.key === 'chapati');
  const rice = catalog.find((item) => item.key === 'rice');
  assert.equal(chapati.supportsSize, false);
  assert.deepEqual(chapati.sizes, []);
  assert.equal(rice.supportsSize, false);
  assert.equal(resolveDeliveryCatalogSelection(chapati, 'large').preparationType, 'chapathi');
  assert.equal(resolveDeliveryCatalogSelection(rice, 'large').preparationType, 'riceBox');
});

test('duplicate component names collapse to a single dropdown option', () => {
  const catalog = extractDeliveryCatalogItems(samplePlans);
  assert.equal(catalog.filter((item) => item.key === 'dal').length, 1);
  assert.equal(catalog.filter((item) => item.key === 'chapati').length, 1);
});

test('saved additional items round-trip to editor rows', () => {
  assert.deepEqual(additionalTiffinItemToRow({ preparationType: 'chapathi', quantity: 4 }), {
    itemKey: 'chapati',
    size: '',
    quantity: 4
  });
  assert.deepEqual(additionalTiffinItemToRow({ preparationType: 'largeDal', quantity: 1 }), {
    itemKey: 'dal',
    size: 'large',
    quantity: 1
  });
  assert.deepEqual(additionalTiffinItemToRow({ itemKey: 'curry', size: 'medium', quantity: 2 }), {
    itemKey: 'curry',
    size: 'medium',
    quantity: 2
  });
  assert.deepEqual(additionalTiffinItemToRow({ itemKey: 'breads', size: 'large', quantity: 3, productName: 'Large Breads' }), {
    itemKey: 'breads',
    size: 'large',
    quantity: 3
  });
});

test('delivery catalog includes all configured items including dynamic delivery items like Breads and Fruits', () => {
  const plansWithExtras = [
    ...samplePlans,
    {
      displayName: 'Special Meal',
      items: {
        dynamicItems: [
          { name: 'Breads', quantity: 'large' },
          { name: 'Fruits', quantity: '1' }
        ]
      }
    }
  ];
  const catalog = extractDeliveryCatalogItems(plansWithExtras);
  const keys = catalog.map((item) => item.key);
  assert.ok(keys.includes('breads'));
  assert.ok(keys.includes('fruits'));
  const breads = catalog.find((i) => i.key === 'breads');
  assert.equal(breads.supportsSize, true);
  assert.deepEqual(breads.sizes, ['large']);
  const fruits = catalog.find((i) => i.key === 'fruits');
  assert.equal(fruits.supportsSize, false);
});

test('canonical item matching rules map standard items and sizes accurately', () => {
  // Dal
  assert.equal(getCanonicalIdentity({ itemKey: 'dal', size: 'medium' }), 'mediumDal');
  assert.equal(getCanonicalIdentity({ itemKey: 'dal', size: 'large' }), 'largeDal');
  assert.equal(getCanonicalIdentity({ itemKey: 'dal', size: 'small' }), 'smallDal');
  assert.equal(getCanonicalIdentity({ preparationType: 'mediumDal' }), 'mediumDal');
  assert.equal(getCanonicalIdentity({ productName: 'Medium Dal' }), 'mediumDal');

  // Curry
  assert.equal(getCanonicalIdentity({ itemKey: 'curry', size: 'medium' }), 'mediumCurry');
  assert.equal(getCanonicalIdentity({ itemKey: 'curry', size: 'large' }), 'largeCurry');
  assert.equal(getCanonicalIdentity({ itemKey: 'curry', size: 'small' }), 'smallCurry');
  assert.equal(getCanonicalIdentity({ preparationType: 'largeCurry' }), 'largeCurry');
  assert.equal(getCanonicalIdentity({ productName: 'Large Curry' }), 'largeCurry');

  // Curd
  assert.equal(getCanonicalIdentity({ itemKey: 'curd', size: 'small' }), 'smallCurd');
  assert.equal(getCanonicalIdentity({ itemKey: 'curd', size: 'large' }), 'bigCurd');
  assert.equal(getCanonicalIdentity({ preparationType: 'bigCurd' }), 'bigCurd');
  assert.equal(getCanonicalIdentity({ productName: 'Big Curd' }), 'bigCurd');

  // Chapati and Rice
  assert.equal(getCanonicalIdentity({ itemKey: 'chapati' }), 'chapathi');
  assert.equal(getCanonicalIdentity({ itemKey: 'chapati', size: null }), 'chapathi');
  assert.equal(getCanonicalIdentity({ productName: 'Chapathi' }), 'chapathi');
  assert.equal(getCanonicalIdentity({ itemKey: 'rice' }), 'riceBox');
  assert.equal(getCanonicalIdentity({ itemKey: 'rice', size: null }), 'riceBox');
  assert.equal(getCanonicalIdentity({ productName: 'Rice Box' }), 'riceBox');

  // Different sizes never match
  assert.notEqual(getCanonicalIdentity({ itemKey: 'dal', size: 'medium' }), getCanonicalIdentity({ itemKey: 'dal', size: 'large' }));
  assert.notEqual(getCanonicalIdentity({ itemKey: 'curry', size: 'small' }), getCanonicalIdentity({ itemKey: 'curry', size: 'large' }));
  assert.notEqual(getCanonicalIdentity({ itemKey: 'curd', size: 'small' }), getCanonicalIdentity({ itemKey: 'curd', size: 'large' }));
});

test('resolveCustomItem validates custom item names and resolves sizes', () => {
  // Valid custom item without size
  const item1 = resolveCustomItem({ customName: 'Papad' });
  assert.equal(item1.error, undefined);
  assert.equal(item1.productName, 'Papad');
  assert.equal(item1.size, null);

  // Valid custom item with size
  const item2 = resolveCustomItem({ customName: 'Papad', size: 'small' });
  assert.equal(item2.error, undefined);
  assert.equal(item2.productName, 'Small Papad');
  assert.equal(item2.size, 'small');

  // Rejection of invalid names
  assert.ok(resolveCustomItem({ customName: '' }).error);
  assert.ok(resolveCustomItem({ customName: '   ' }).error);
  assert.ok(resolveCustomItem({ customName: '+ Add' }).error);
  assert.ok(resolveCustomItem({ customName: '+Add' }).error);
  assert.ok(resolveCustomItem({ customName: '__custom__' }).error);
});

