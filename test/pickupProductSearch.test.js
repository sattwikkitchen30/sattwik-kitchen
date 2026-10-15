const test = require('node:test');
const assert = require('node:assert/strict');

// Set up browser-like mocks so admin.js can be imported in Node environment
global.localStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {}
};
global.document = {
  getElementById: () => null,
  querySelectorAll: () => [],
  addEventListener: () => {}
};
global.window = {
  location: { href: '', pathname: '' },
  addEventListener: () => {}
};

const { matchesPickupSearch, filterPickupProducts, displayProductCategory } = require('../admin/admin');

const sampleProducts = [
  {
    _id: '1',
    name: 'Mango Pickle',
    category: 'Pickles',
    description: 'Traditional spicy homemade Andhra mango pickle with mustard and fenugreek',
    price: 9.99,
    stock: 25,
    active: true
  },
  {
    _id: '2',
    name: 'Tomato Pickle',
    category: 'Pickles',
    description: 'Tangy and spiced sun-ripened tomato pickle',
    price: 8.99,
    stock: 15,
    active: true
  },
  {
    _id: '3',
    name: 'Curry Leaf Powder',
    category: 'Powders',
    description: 'Aromatic roasted karivepaku powder for hot rice and ghee',
    price: 11.99,
    stock: 30,
    active: true
  },
  {
    _id: '4',
    name: 'Dosa Platter',
    category: 'tiffin', // lowercase alias for Breakfast
    description: '2 Plain Dosas / 2 Masala Dosas / 2 Onion Dosas with Chutney',
    price: 10.00,
    stock: 8,
    active: true
  },
  {
    _id: '5',
    name: 'Bobbatlu',
    category: 'Sweets',
    description: 'Classic sweet flatbread stuffed with chana dal and jaggery',
    price: 2.00,
    stock: 50,
    active: true
  },
  {
    _id: '6',
    name: 'Gobi 65',
    category: 'Snacks',
    description: 'Crispy fried cauliflower florets tossed in southern spices',
    price: 10.00,
    stock: 0,
    active: false
  }
];

test('empty or whitespace query matches all products', () => {
  assert.equal(matchesPickupSearch(sampleProducts[0], ''), true);
  assert.equal(matchesPickupSearch(sampleProducts[0], '   '), true);
  assert.equal(matchesPickupSearch(sampleProducts[0], null), true);
  assert.equal(matchesPickupSearch(sampleProducts[0], undefined), true);

  const results = filterPickupProducts(sampleProducts, '');
  assert.equal(results.length, sampleProducts.length);

  const spacesResults = filterPickupProducts(sampleProducts, '   ');
  assert.equal(spacesResults.length, sampleProducts.length);
});

test('searches products by product name (case-insensitive)', () => {
  const lowercaseResults = filterPickupProducts(sampleProducts, 'mango');
  assert.equal(lowercaseResults.length, 1);
  assert.equal(lowercaseResults[0].name, 'Mango Pickle');

  const uppercaseResults = filterPickupProducts(sampleProducts, 'MANGO');
  assert.equal(uppercaseResults.length, 1);
  assert.equal(uppercaseResults[0].name, 'Mango Pickle');

  const mixedResults = filterPickupProducts(sampleProducts, 'DoSa');
  assert.equal(mixedResults.length, 1);
  assert.equal(mixedResults[0].name, 'Dosa Platter');
});

test('searches products by description (case-insensitive)', () => {
  const results1 = filterPickupProducts(sampleProducts, 'cauliflower');
  assert.equal(results1.length, 1);
  assert.equal(results1[0].name, 'Gobi 65');

  const results2 = filterPickupProducts(sampleProducts, 'karivepaku');
  assert.equal(results2.length, 1);
  assert.equal(results2[0].name, 'Curry Leaf Powder');

  const results3 = filterPickupProducts(sampleProducts, 'jaggery');
  assert.equal(results3.length, 1);
  assert.equal(results3[0].name, 'Bobbatlu');
});

test('searches products by category (raw and alias)', () => {
  const picklesResults = filterPickupProducts(sampleProducts, 'Pickles');
  assert.equal(picklesResults.length, 2);
  assert.ok(picklesResults.some((p) => p.name === 'Mango Pickle'));
  assert.ok(picklesResults.some((p) => p.name === 'Tomato Pickle'));

  // 'Dosa Platter' has category: 'tiffin', which displays as 'Breakfast'
  const breakfastResults = filterPickupProducts(sampleProducts, 'breakfast');
  assert.equal(breakfastResults.length, 1);
  assert.equal(breakfastResults[0].name, 'Dosa Platter');

  const tiffinResults = filterPickupProducts(sampleProducts, 'tiffin');
  assert.equal(tiffinResults.length, 1);
  assert.equal(tiffinResults[0].name, 'Dosa Platter');
});

test('ignores leading and trailing whitespace in query', () => {
  const results = filterPickupProducts(sampleProducts, '   Tomato   ');
  assert.equal(results.length, 1);
  assert.equal(results[0].name, 'Tomato Pickle');
});

test('returns empty array when no products match', () => {
  const results = filterPickupProducts(sampleProducts, 'nonexistentitem12345');
  assert.equal(results.length, 0);
});

test('handles null or missing product fields gracefully', () => {
  const edgeProducts = [
    { name: null, description: null, category: null },
    { name: 'Special Item' }
  ];

  assert.equal(matchesPickupSearch(edgeProducts[0], 'mango'), false);
  assert.equal(matchesPickupSearch(edgeProducts[1], 'special'), true);
  assert.equal(matchesPickupSearch(null, 'test'), false);
});
