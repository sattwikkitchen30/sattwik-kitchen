const mongoose = require('mongoose');

const productSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, unique: true },
  category: { type: String, required: true, trim: true, default: 'Pickles' },
  description: { 
    type: String, 
    default: '',
    validate: {
      validator: function(v) {
        // Allow empty string for legacy records, but require non-empty for new/updated records
        // This validation is enforced in the controller, not here, to allow legacy records
        return true;
      },
      message: 'Description is required'
    }
  },
  price: { type: Number, required: true, min: 0 },
  image: { type: String, default: 'assets/product-placeholder.svg' },
  active: { type: Boolean, default: true },
  stock: { type: Number, default: 0, min: 0 },
  lowStockThreshold: { type: Number, default: 5 },
  isDemo: { type: Boolean, default: false }
}, { timestamps: true });

module.exports = mongoose.model('Product', productSchema);
