const mongoose = require('mongoose');
const migrateTiffinSubscriptionIndexes = require('../utils/migrateTiffinSubscriptionIndexes');

async function connectDB(app) {
  console.log('[sattwik] MONGO_URI available:', Boolean(process.env.MONGO_URI));
  const uri = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/sattwik-kitchen';
  try {
    await mongoose.connect(uri);
    const TiffinSubscription = require('../models/TiffinSubscription');
    await migrateTiffinSubscriptionIndexes(TiffinSubscription);
    const Order = require('../models/Order');
    const { startDailyDeliveryReset } = require('../utils/dailyDeliveryReset');
    startDailyDeliveryReset(Order, app);
    console.log('[sattwik] MongoDB connected');
  } catch (err) {
    console.error('[sattwik] MongoDB connection failed:', err.message);
    process.exit(1);
  }
}

module.exports = connectDB;
