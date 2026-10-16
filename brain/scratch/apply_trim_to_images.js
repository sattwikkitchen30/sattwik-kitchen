require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const mongoose = require('mongoose');
const Product = require('../../server/models/Product');

// These products have 2000x2000 images with large white padding at the bottom.
// Inserting /e_trim:10/ into the Cloudinary URL makes Cloudinary auto-trim the whitespace
// server-side, returning a natural 4:3 image. The original uploaded files are untouched.
const AFFECTED = [
  'Bobbatlu',
  'Gulab Jamoon',
  'DryFruit Burfi',
  'Kesari Bath',
  'Arabian Delight',
  'Rabdi',
];

mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI).then(async () => {
  for (const name of AFFECTED) {
    const product = await Product.findOne({ name });
    if (!product) { console.log('Not found:', name); continue; }
    if (!product.image) { console.log('No image for:', name); continue; }
    if (product.image.includes('/e_trim:')) {
      console.log('Already trimmed:', name);
      continue;
    }
    const newUrl = product.image.replace('/upload/', '/upload/e_trim:10/');
    product.image = newUrl;
    await product.save();
    console.log('Updated:', name, '->', newUrl);
  }
  mongoose.disconnect();
  console.log('Done.');
}).catch((e) => console.log('DB error:', e.message));
