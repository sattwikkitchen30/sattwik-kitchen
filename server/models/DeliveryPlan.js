const mongoose = require('mongoose');

/**
 * DeliveryPlan Model
 * Stores admin-configurable delivery categories and plans
 * Backward-compatible with existing tiffinPlan.packageType ('full', 'curry-only')
 * and tiffinPlan.size ('single', 'couple', 'family')
 */
const deliveryPlanSchema = new mongoose.Schema({
  // Category-level fields
  category: { 
    type: String, 
    required: true, 
    trim: true
    // No enum restriction - allow custom categories
    // Unique index with case-insensitive comparison handled in application logic
  },
  categoryDescription: { type: String, trim: true, default: '' },
  active: { type: Boolean, default: true },
  
  // Plan-level fields
  packageType: { 
    type: String, 
    trim: true,
    // Optional for custom products, but preserved for backward compatibility
    enum: ['full', 'curry-only', null],
    default: null
  },
  size: { 
    type: String, 
    required: true,
    trim: true
    // No enum restriction - allow custom sizes
    // Backward-compatible with existing 'single', 'couple', 'family'
  },
  displayName: { type: String, required: true, trim: true },
  description: { type: String, trim: true, default: '' },
  price: { type: Number, required: true, min: 0 },
  
  // Included items configuration
  // Can be either:
  // 1. Old fixed structure (for backward compatibility)
  // 2. New dynamic array structure
  items: {
    // Old fixed structure (deprecated but preserved for compatibility)
    dal: { type: String, enum: ['small', 'medium', 'large'] },
    curry: { type: String, enum: ['small', 'medium', 'large'] },
    chapati: { type: Number, min: 0, default: 0 },
    rice: { type: Number, min: 0, default: 0 },
    curd: { type: String, enum: ['small', 'big', null], default: null },
    // New dynamic array structure
    dynamicItems: [{
      name: { type: String, required: true, trim: true },
      quantity: { type: String, required: true, trim: true }
    }]
  }
}, { timestamps: true });

// Unique index to prevent duplicate plans within same category (case-insensitive)
deliveryPlanSchema.index({ category: 1, packageType: 1, size: 1 }, { 
  unique: true,
  collation: { locale: 'en', strength: 2 },
  sparse: true // Allows null packageType for custom products
});

module.exports = mongoose.model('DeliveryPlan', deliveryPlanSchema);
