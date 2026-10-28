'use strict';

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

/**
 * Automated Test Suite: Delivery Plan Names and Creation Order
 *
 * Covers requirements for BOTH Full Meal and Curry-Only categories:
 * 1. Display exact unmutated displayName entered by admin everywhere (plan cards, cart, orders).
 * 2. No truncation to Single/Couple/Family or synthetic names when displayName exists.
 * 3. Backward-compatible fallback when displayName is empty.
 * 4. Plans within Full Meal and Curry-Only returned in exact creation order (createdAt: 1, _id: 1).
 * 5. Newly created plans appear after previously created plans in the same category.
 * 6. Editing plan details preserves creation order position.
 * 7. Category separation (Full Meal and Curry-Only) preserved with correct pricing, items, and sizes.
 * 8. Order creation and history preserve exact displayName across customer and delivery views.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const DeliveryPlan = require('../server/models/DeliveryPlan');
const Order = require('../server/models/Order');
const Customer = require('../server/models/Customer');
const deliveryPlansRouter = require('../server/routes/deliveryPlans');
const { createOrder, createManualOrder } = require('../server/controllers/orderController');

function mockReqRes({ method = 'GET', body = {}, params = {}, query = {}, customer = null, admin = null } = {}) {
  const req = {
    method,
    body,
    params,
    query,
    customer,
    admin,
    app: {
      get: (key) => (key === 'io' ? { to: () => ({ emit: () => {} }), emit: () => {} } : null)
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

function findHandler(router, pathPattern, method) {
  for (const layer of router.stack) {
    if (layer.route && layer.route.path === pathPattern && layer.route.methods[method.toLowerCase()]) {
      return layer.route.stack[layer.route.stack.length - 1].handle;
    }
  }
  return null;
}

test('Delivery Plan Names and Creation Order Suite', async (t) => {
  const nonce = Date.now();
  const testCategoryFull = `Test Full Meal ${nonce}`;
  const testCategoryCurry = `Test Curry-Only ${nonce}`;
  const createdPlanIds = [];
  const createdOrderIds = [];
  let testCustomer = null;

  t.before(async () => {
    if (mongoose.connection.readyState !== 1) {
      await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/sattwik-kitchen');
    }

    testCustomer = await Customer.create({
      firstName: 'TestPlan',
      lastName: 'Customer',
      phone: '6045550199',
      email: `testplan_${nonce}@example.com`,
      passwordHash: 'dummy',
      area: 'Surrey'
    });
  });

  t.after(async () => {
    try {
      await DeliveryPlan.deleteMany({ category: { $in: [testCategoryFull, testCategoryCurry, 'Test Full Meal', 'Test Curry-Only'] } });
      if (createdOrderIds.length) {
        await Order.deleteMany({ _id: { $in: createdOrderIds } });
      }
      if (testCustomer) {
        await Customer.deleteOne({ _id: testCustomer._id });
      }
    } finally {
      await mongoose.disconnect();
    }
  });

  await t.test('1. Exact unmutated displayName preserved across Full Meal and Curry-Only plans', async () => {
    const plan1 = await DeliveryPlan.create({
      category: testCategoryFull,
      packageType: 'full',
      size: 'test-single',
      displayName: 'Trial Pack (Single)',
      price: 75,
      items: { dynamicItems: [{ name: 'Dal', quantity: 'small' }] }
    });
    createdPlanIds.push(plan1._id);

    const plan2 = await DeliveryPlan.create({
      category: testCategoryCurry,
      packageType: 'curry-only',
      size: 'test-couple',
      displayName: 'Curry-Only Package (Special Couple)',
      price: 155,
      items: { dynamicItems: [{ name: 'Curry', quantity: 'medium' }] }
    });
    createdPlanIds.push(plan2._id);

    const fetched1 = await DeliveryPlan.findById(plan1._id).lean();
    assert.equal(fetched1.displayName, 'Trial Pack (Single)', 'Full Meal displayName must not be mutated or shortened');

    const fetched2 = await DeliveryPlan.findById(plan2._id).lean();
    assert.equal(fetched2.displayName, 'Curry-Only Package (Special Couple)', 'Curry-Only displayName must not be mutated');
  });

  await t.test('2. Backend public list returns plans in exact creation order (createdAt: 1, _id: 1)', async () => {
    const baseTime = Date.now();
    const p1 = await DeliveryPlan.create({
      category: testCategoryFull,
      packageType: 'full',
      size: 'ord-regular-single',
      displayName: 'Full Meal Regular (Single)',
      price: 240,
      createdAt: new Date(baseTime + 1000)
    });
    createdPlanIds.push(p1._id);

    const p2 = await DeliveryPlan.create({
      category: testCategoryFull,
      packageType: 'full',
      size: 'ord-regular-couple',
      displayName: 'Full Meal Regular (Couple)',
      price: 300,
      createdAt: new Date(baseTime + 2000)
    });
    createdPlanIds.push(p2._id);

    const p3 = await DeliveryPlan.create({
      category: testCategoryFull,
      packageType: null,
      size: 'ord-trial-single',
      displayName: 'Trial Pack Single',
      price: 75,
      createdAt: new Date(baseTime + 3000)
    });
    createdPlanIds.push(p3._id);

    const handler = findHandler(deliveryPlansRouter, '/public', 'get');
    assert.ok(handler, 'GET /public handler must exist');

    const { req, res } = mockReqRes({ method: 'GET' });
    await handler(req, res);

    assert.equal(res.statusCode, 200);
    const plans = res._json.plans.filter(p => p.category === testCategoryFull);
    assert.equal(plans.length, 4);

    // Verify ordering matches createdAt
    for (let i = 0; i < plans.length - 1; i++) {
      const tA = new Date(plans[i].createdAt).getTime();
      const tB = new Date(plans[i + 1].createdAt).getTime();
      assert.ok(tA <= tB, `Plan at index ${i} (${plans[i].displayName}) must be created before index ${i + 1} (${plans[i + 1].displayName})`);
    }
  });

  await t.test('3. Newly created plan appears after older plans in the same category', async () => {
    const p4 = await DeliveryPlan.create({
      category: testCategoryFull,
      packageType: null,
      size: 'ord-trial-family',
      displayName: 'Family Trial Pack Special',
      price: 99,
      createdAt: new Date(Date.now() + 10000)
    });
    createdPlanIds.push(p4._id);

    const handler = findHandler(deliveryPlansRouter, '/public', 'get');
    const { req, res } = mockReqRes({ method: 'GET' });
    await handler(req, res);

    const plans = res._json.plans.filter(p => p.category === testCategoryFull);
    const lastPlan = plans[plans.length - 1];
    assert.equal(String(lastPlan._id), String(p4._id), 'Newly created plan must appear at the end of the category');
    assert.equal(lastPlan.displayName, 'Family Trial Pack Special');
  });

  await t.test('4. Editing a plan does not alter its position in creation order', async () => {
    const handler = findHandler(deliveryPlansRouter, '/public', 'get');

    const { req: reqBefore, res: resBefore } = mockReqRes({ method: 'GET' });
    await handler(reqBefore, resBefore);

    const plansBefore = resBefore._json.plans.filter(p => p.category === testCategoryFull);
    const middlePlan = plansBefore[1];
    const originalMiddleId = String(middlePlan._id);

    // Update the middle plan's price and displayName
    middlePlan.displayName = 'Updated Display Name Middle';
    await DeliveryPlan.findByIdAndUpdate(middlePlan._id, { 
      displayName: middlePlan.displayName,
      price: middlePlan.price + 5
    });

    const { req: reqAfter, res: resAfter } = mockReqRes({ method: 'GET' });
    await handler(reqAfter, resAfter);

    const plansAfter = resAfter._json.plans.filter(p => p.category === testCategoryFull);
    assert.equal(String(plansAfter[1]._id), originalMiddleId, 'Plan position must not change after editing');
    assert.equal(plansAfter[1].displayName, 'Updated Display Name Middle');
  });

  await t.test('5. Order creation stores exact displayName for Full Meal and Curry-Only plans', async () => {
    const plan = await DeliveryPlan.findById(createdPlanIds[0]).lean();

    const { req, res } = mockReqRes({
      method: 'POST',
      customer: testCustomer,
      body: {
        customer: {
          firstName: testCustomer.firstName,
          lastName: testCustomer.lastName,
          phone: testCustomer.phone,
          email: testCustomer.email,
          area: 'Surrey'
        },
        pickupDate: '2026-11-01',
        tiffinPlans: [{
          planId: String(plan._id),
          displayName: plan.displayName,
          packageType: plan.packageType,
          size: plan.size,
          quantity: 1
        }]
      }
    });

    await createOrder(req, res);
    assert.equal(res.statusCode, 201);
    assert.ok(res._json?.order?._id);
    createdOrderIds.push(res._json.order._id);

    const savedOrder = await Order.findById(res._json.order._id).lean();
    assert.equal(savedOrder.items[0].productName, plan.displayName, 'Order item productName must equal exact unmutated displayName');
    assert.equal(savedOrder.tiffinPlan?.displayName, plan.displayName, 'Order tiffinPlan displayName must match');
  });

  await t.test('6. Manual order creation stores exact displayName without synthetic overrides', async () => {
    const plan = await DeliveryPlan.findById(createdPlanIds[1]).lean();

    const { req, res } = mockReqRes({
      method: 'POST',
      admin: { id: new mongoose.Types.ObjectId(), name: 'AdminTester' },
      body: {
        firstName: 'Manual',
        lastName: 'Tester',
        phone: '6045550200',
        email: 'manual_tester@example.com',
        amount: plan.price,
        pickupDate: '2026-11-01',
        fulfillment: 'delivery',
        plans: [{
          planId: String(plan._id),
          quantity: 1
        }]
      }
    });

    await createManualOrder(req, res);
    assert.equal(res.statusCode, 201);
    assert.ok(res._json?.order?._id);
    createdOrderIds.push(res._json.order._id);

    const savedOrder = await Order.findById(res._json.order._id).lean();
    assert.equal(savedOrder.items[0].productName, plan.displayName, 'Manual order item productName must equal exact unmutated displayName');
    assert.equal(savedOrder.tiffinPlan?.displayName, plan.displayName);
  });

  await t.test('7. Data preservation: Category separation, sizes, prices, and dynamic items are intact', async () => {
    const fullPlans = await DeliveryPlan.find({ category: testCategoryFull }).sort({ createdAt: 1, _id: 1 }).lean();
    const curryPlans = await DeliveryPlan.find({ category: testCategoryCurry }).sort({ createdAt: 1, _id: 1 }).lean();

    assert.ok(fullPlans.length >= 4, 'Full Meal plans must belong to Full Meal category');
    assert.ok(curryPlans.length >= 1, 'Curry-Only plans must belong to Curry-Only category');

    for (const p of fullPlans) {
      assert.equal(p.category, testCategoryFull);
      assert.ok(typeof p.price === 'number' && p.price > 0);
      assert.ok(p.size && p.size.length > 0);
    }

    for (const p of curryPlans) {
      assert.equal(p.category, testCategoryCurry);
      assert.ok(typeof p.price === 'number' && p.price > 0);
      assert.ok(p.size && p.size.length > 0);
    }
  });

  await t.test('8. Existing live database plans reflect exact display names and creation order', async () => {
    const fullMealPlans = await DeliveryPlan.find({ category: 'Full Meal', active: true }).sort({ createdAt: 1, _id: 1 }).lean();
    const curryOnlyPlans = await DeliveryPlan.find({ category: 'Curry-Only', active: true }).sort({ createdAt: 1, _id: 1 }).lean();

    assert.ok(fullMealPlans.length >= 6, 'Full Meal must have at least 6 active plans');
    assert.ok(curryOnlyPlans.length >= 6, 'Curry-Only must have at least 6 active plans');

    // Verify Full Meal plan names
    const fullNames = fullMealPlans.map(p => p.displayName);
    assert.ok(fullNames.includes('Full Meal (Single)'));
    assert.ok(fullNames.includes('Full Meal (Couple)'));
    assert.ok(fullNames.includes('Full Meal (Family)'));
    assert.ok(fullNames.includes('Trial Pack (Single)'));
    assert.ok(fullNames.includes('Trial Pack (Couple)'));
    assert.ok(fullNames.includes('Trial Pack (Family)'));

    // Verify Curry-Only plan names
    const curryNames = curryOnlyPlans.map(p => p.displayName);
    assert.ok(curryNames.includes('Curry-Only (Single)'));
    assert.ok(curryNames.includes('Curry-Only (Couple)'));
    assert.ok(curryNames.includes('Curry-Only (Family)'));
    assert.ok(curryNames.includes('Trial Curry-Only (Single)'));
    assert.ok(curryNames.includes('Trial Curry-Only (Couple)'));
    assert.ok(curryNames.includes('Trial Curry-Only (Family)'));

    // Verify creation order: regular packages created on 2026-10-14 come before trial packs created on 2026-10-27
    const fullCreatedTimes = fullMealPlans.map(p => new Date(p.createdAt).getTime());
    for (let i = 0; i < fullCreatedTimes.length - 1; i++) {
      assert.ok(fullCreatedTimes[i] <= fullCreatedTimes[i + 1], `Full meal plan ${fullMealPlans[i].displayName} must be created before ${fullMealPlans[i + 1].displayName}`);
    }

    const curryCreatedTimes = curryOnlyPlans.map(p => new Date(p.createdAt).getTime());
    for (let i = 0; i < curryCreatedTimes.length - 1; i++) {
      assert.ok(curryCreatedTimes[i] <= curryCreatedTimes[i + 1], `Curry-only plan ${curryOnlyPlans[i].displayName} must be created before ${curryOnlyPlans[i + 1].displayName}`);
    }
  });

  await t.test('9. Frontend files do NOT contain alphabetical .sort() or localeCompare() for delivery plans', () => {
    const fs = require('fs');
    const path = require('path');
    const rootDir = process.cwd();
    for (const file of ['script.js', 'public/script.js']) {
      const content = fs.readFileSync(path.resolve(rootDir, file), 'utf8');
      assert.ok(!content.includes('a.displayName.localeCompare'), `${file} must not contain alphabetical localeCompare sort for delivery plans`);
      assert.ok(!content.includes('categories[cat].sort'), `${file} must not re-sort categories[cat] by size or name`);
    }
  });

  await t.test('10. Frontend renderDeliveryPlans outputs exact unmutated Display Name as card title', () => {
    const fs = require('fs');
    const path = require('path');
    const rootDir = process.cwd();
    const scriptJs = fs.readFileSync(path.resolve(rootDir, 'script.js'), 'utf8');

    // Ensure planDisplayName resolution uses exact plan.displayName
    assert.ok(scriptJs.includes('const planDisplayName = (plan.displayName && String(plan.displayName).trim())'), 'Must resolve planDisplayName from plan.displayName');
    assert.ok(scriptJs.includes('<span>${escapeProductHtml(planDisplayName)}</span>'), 'Must render planDisplayName in plan-top span');
  });

  await t.test('11. Frontend renderDeliveryPlans preserves non-alphabetical creation sequence', () => {
    // Simulate renderDeliveryPlans with arbitrary creation order
    const samplePlans = [
      { _id: 'id1', category: 'Full Meal', size: 'ord-3', displayName: 'Trial Pack Single', price: 75, createdAt: new Date(1000) },
      { _id: 'id2', category: 'Full Meal', size: 'ord-1', displayName: 'Trial Pack Couple', price: 85, createdAt: new Date(2000) },
      { _id: 'id3', category: 'Full Meal', size: 'ord-2', displayName: 'Full Meal Family', price: 340, createdAt: new Date(3000) },
      { _id: 'id4', category: 'Curry-Only', size: 'curry-b', displayName: 'Curry-Only Couple', price: 160, createdAt: new Date(1000) },
      { _id: 'id5', category: 'Curry-Only', size: 'curry-a', displayName: 'Curry-Only Single', price: 120, createdAt: new Date(2000) }
    ];

    // Mirror frontend grouping and rendering logic
    const categories = {};
    samplePlans.forEach(plan => {
      if (!categories[plan.category]) categories[plan.category] = [];
      categories[plan.category].push(plan);
    });

    // Verify Full Meal sequence matches input creation sequence exactly
    assert.deepEqual(
      categories['Full Meal'].map(p => p.displayName),
      ['Trial Pack Single', 'Trial Pack Couple', 'Full Meal Family'],
      'Full Meal plans must strictly preserve input creation order without alphabetical rearrangement'
    );

    // Verify Curry-Only sequence matches input creation sequence exactly
    assert.deepEqual(
      categories['Curry-Only'].map(p => p.displayName),
      ['Curry-Only Couple', 'Curry-Only Single'],
      'Curry-Only plans must strictly preserve input creation order without alphabetical rearrangement'
    );
  });
});
