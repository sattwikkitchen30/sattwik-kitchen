/**
 * Migration script to initialize DeliveryPlan collection with existing tiffin plans
 * This script is idempotent and safe to run multiple times
 */
require('dotenv').config();
const mongoose = require('mongoose');
const DeliveryPlan = require('../models/DeliveryPlan');
const { TIFFIN_PRICES, TIFFIN_LABELS, TIFFIN_PREPARATION_RULES } = require('../utils/constants');

async function initializeDeliveryPlans() {
  try {
    // Connect to MongoDB using same env var as server (MONGO_URI)
    const mongoUri = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/sattwik-kitchen';
    await mongoose.connect(mongoUri);
    console.log('Connected to MongoDB:', mongoose.connection.host);

    // Get existing plans to avoid duplicates
    const existingPlans = await DeliveryPlan.find({});
    const existingKeys = new Set(
      existingPlans.map(p => `${p.category.toLowerCase()}-${p.packageType}-${p.size}`)
    );
    console.log(`Found ${existingPlans.length} existing delivery plans`);

    // Initialize Full Meal plans
    const fullCategory = 'Full Meal';
    const fullPackageType = 'full';
    const fullSizes = ['single', 'couple', 'family'];
    
    for (const size of fullSizes) {
      const key = `${fullCategory.toLowerCase()}-${fullPackageType}-${size}`;
      if (existingKeys.has(key)) {
        console.log(`Skipping existing plan: ${key}`);
        continue;
      }

      const rule = TIFFIN_PREPARATION_RULES[fullPackageType][size];
      const price = TIFFIN_PRICES[fullPackageType][size];
      const displayName = TIFFIN_LABELS[fullPackageType].replace(' Package', ` (${size[0].toUpperCase() + size.slice(1)})`);

      await DeliveryPlan.create({
        category: fullCategory,
        categoryDescription: 'Complete meal with dal, curry, rice, chapathi, and curd',
        packageType: fullPackageType,
        size: size,
        displayName: displayName,
        description: `Full meal for ${size} customers`,
        price: price,
        items: {
          dal: rule.dal,
          curry: rule.curry,
          chapati: rule.chapati,
          rice: rule.rice,
          curd: rule.curd,
          dynamicItems: [] // Initialize empty dynamic items array
        }
      });
      console.log(`Created plan: ${key} - $${price}`);
    }

    // Initialize Curry-Only plans
    const curryCategory = 'Curry-Only';
    const curryPackageType = 'curry-only';
    const currySizes = ['single', 'couple', 'family'];
    
    for (const size of currySizes) {
      const key = `${curryCategory.toLowerCase()}-${curryPackageType}-${size}`;
      if (existingKeys.has(key)) {
        console.log(`Skipping existing plan: ${key}`);
        continue;
      }

      const rule = TIFFIN_PREPARATION_RULES[curryPackageType][size];
      const price = TIFFIN_PRICES[curryPackageType][size];
      const displayName = TIFFIN_LABELS[curryPackageType].replace(' Package', ` (${size[0].toUpperCase() + size.slice(1)})`);

      await DeliveryPlan.create({
        category: curryCategory,
        categoryDescription: 'Curry and dal only, without rice, chapathi, or curd',
        packageType: curryPackageType,
        size: size,
        displayName: displayName,
        description: `Curry-only meal for ${size} customers`,
        price: price,
        items: {
          dal: rule.dal,
          curry: rule.curry,
          chapathi: rule.chapati,
          rice: rule.rice,
          curd: rule.curd,
          dynamicItems: [] // Initialize empty dynamic items array
        }
      });
      console.log(`Created plan: ${key} - $${price}`);
    }

    console.log('DeliveryPlan initialization complete');
    const totalPlans = await DeliveryPlan.countDocuments();
    console.log(`Total delivery plans in database: ${totalPlans}`);

  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
  }
}

// Run migration if called directly
if (require.main === module) {
  initializeDeliveryPlans().then(() => process.exit(0));
}

module.exports = { initializeDeliveryPlans };
