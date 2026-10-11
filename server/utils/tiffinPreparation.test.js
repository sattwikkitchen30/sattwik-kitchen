const test = require('node:test');
const assert = require('node:assert/strict');
const { buildDefaultTiffinItems } = require('./tiffinItems');
const { buildPreparationTotals, buildActivePlanCounts } = require('./tiffinPreparation');

function itemQuantity(items, preparationType) {
  return items.find((item) => item.preparationType === preparationType)?.quantity || 0;
}

test('Couple and Family full meal defaults produce the required mixed totals', () => {
  const subscriptions = [
    { packageType: 'full', size: 'couple', quantity: 1 },
    { packageType: 'full', size: 'family', quantity: 1 }
  ];
  const defaults = buildDefaultTiffinItems(subscriptions);
  const totals = buildPreparationTotals(subscriptions);

  assert.equal(itemQuantity(defaults, 'mediumDal'), 1);
  assert.equal(itemQuantity(defaults, 'largeDal'), 1);
  assert.equal(itemQuantity(defaults, 'mediumCurry'), 1);
  assert.equal(itemQuantity(defaults, 'largeCurry'), 1);
  assert.equal(totals.smallCurd, 1);
  assert.equal(totals.bigCurd, 1);
  assert.equal(totals.riceBoxes, 2);
  assert.equal(totals.chapathiCount, 10);
});

test('multiple plans linked to one permanent order contribute once per plan entry', () => {
  const order = {
    _id: 'permanent-order',
    tiffinItemsCustomized: false,
    tiffinItems: buildDefaultTiffinItems([
      { packageType: 'full', size: 'couple', quantity: 1 },
      { packageType: 'full', size: 'family', quantity: 1 }
    ])
  };
  const subscriptions = [
    { packageType: 'full', size: 'couple', quantity: 1, orderId: order },
    { packageType: 'full', size: 'family', quantity: 1, orderId: order }
  ];
  const totals = buildPreparationTotals(subscriptions);

  assert.equal(totals.mediumDal, 1);
  assert.equal(totals.largeDal, 1);
  assert.equal(totals.mediumCurries, 1);
  assert.equal(totals.largeCurries, 1);
  assert.equal(totals.smallCurd, 1);
  assert.equal(totals.bigCurd, 1);
  assert.equal(totals.riceBoxes, 2);
  assert.equal(totals.chapathiCount, 10);
});

test('Curry-only plans do not contribute rice, chapati, or curd', () => {
  const totals = buildPreparationTotals([
    { packageType: 'curry-only', size: 'single', quantity: 1 },
    { packageType: 'curry-only', size: 'couple', quantity: 1 },
    { packageType: 'curry-only', size: 'family', quantity: 1 }
  ]);

  assert.equal(totals.riceBoxes, 0);
  assert.equal(totals.chapathiCount, 0);
  assert.equal(totals.smallCurd, 0);
  assert.equal(totals.bigCurd, 0);
});

test('saved customized items override defaults and are counted once for a multi-plan order', () => {
  const order = {
    _id: 'order-1',
    tiffinItemsCustomized: true,
    tiffinItems: [{ productName: 'Big Curd', preparationType: 'bigCurd', quantity: 3 }]
  };
  const subscriptions = [
    { packageType: 'full', size: 'couple', quantity: 1, orderId: order },
    { packageType: 'full', size: 'family', quantity: 1, orderId: order }
  ];
  const totals = buildPreparationTotals(subscriptions);
  const planCounts = buildActivePlanCounts(subscriptions);

  assert.equal(totals.smallCurd, 0);
  assert.equal(totals.bigCurd, 3);
  assert.equal(totals.riceBoxes, 0);
  assert.equal(planCounts.full.couple, 1);
  assert.equal(planCounts.full.family, 1);
});

test('refresh-style recalculation is deterministic and does not accumulate totals', () => {
  const subscriptions = [{ packageType: 'full', size: 'couple', quantity: 2 }];

  assert.deepEqual(buildPreparationTotals(subscriptions), buildPreparationTotals(subscriptions));
  assert.equal(buildPreparationTotals(subscriptions).smallCurd, 2);
});
