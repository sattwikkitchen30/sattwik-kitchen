/**
 * Migration script to update existing DeliveryPlan records with new schema
 * This script adds the dynamicItems array to existing records
 */
const mongoose = require('mongoose');
const DeliveryPlan = require('../models/DeliveryPlan');

async function updateDeliveryPlansSchema() {
  try {
    // Connect to MongoDB
    const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/sattwik-kitchen';
    await mongoose.connect(mongoUri);
    console.log('Connected to MongoDB');

    // Get all existing plans
    const plans = await DeliveryPlan.find({});
    console.log(`Found ${plans.length} existing delivery plans`);

    let updated = 0;
    for (const plan of plans) {
      if (!plan.items.dynamicItems) {
        // Add empty dynamicItems array to existing records
        await DeliveryPlan.updateOne(
          { _id: plan._id },
          { $set: { 'items.dynamicItems': [] } }
        );
        updated++;
        console.log(`Updated plan: ${plan.category} - ${plan.displayName}`);
      }
    }

    console.log(`Migration complete. Updated ${updated} plans.`);
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
  }
}

// Run migration if called directly
if (require.main === module) {
  updateDeliveryPlansSchema().then(() => process.exit(0));
}

module.exports = { updateDeliveryPlansSchema };
