require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const mongoose = require('mongoose');
const Product = require('../../server/models/Product');

mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI).then(async () => {
  const prods = await Product.find({ category: { $in: ['Sweets', 'Snacks'] } }, 'name category image').lean();
  prods.forEach((p) => {
    console.log(`${p.category} | ${p.name} | ${p.image || '(no image)'}`);
  });
  mongoose.disconnect();
}).catch((e) => console.log('DB error:', e.message));
