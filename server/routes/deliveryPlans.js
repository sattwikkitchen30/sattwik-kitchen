const router = require('express').Router();
const DeliveryPlan = require('../models/DeliveryPlan');
const Order = require('../models/Order');
const TiffinSubscription = require('../models/TiffinSubscription');
const { authRequired } = require('../middleware/auth');

// Get active delivery plans (public - for customer catalog)
router.get('/public', async (req, res) => {
  try {
    const plans = await DeliveryPlan.find({ active: true }).sort({ createdAt: 1, _id: 1 }).lean();
    res.json({ plans });
  } catch (err) {
    console.error('[deliveryPlans] public list failed:', err.message);
    res.status(500).json({ message: 'Could not load delivery plans' });
  }
});

// Get all delivery plans (admin only)
router.get('/', authRequired, async (req, res) => {
  try {
    const plans = await DeliveryPlan.find({}).sort({ createdAt: 1, _id: 1 }).lean();
    res.json({ plans });
  } catch (err) {
    console.error('[deliveryPlans] list failed:', err.message);
    res.status(500).json({ message: 'Could not load delivery plans' });
  }
});

// Get delivery plans by category (admin only)
router.get('/category/:category', authRequired, async (req, res) => {
  try {
    const { category } = req.params;
    const plans = await DeliveryPlan.find({ category }).sort({ createdAt: 1, _id: 1 }).lean();
    res.json({ plans });
  } catch (err) {
    console.error('[deliveryPlans] category list failed:', err.message);
    res.status(500).json({ message: 'Could not load delivery plans for category' });
  }
});

// Get a single delivery plan (admin only)
router.get('/:id', authRequired, async (req, res) => {
  try {
    const plan = await DeliveryPlan.findById(req.params.id).lean();
    if (!plan) return res.status(404).json({ message: 'Delivery plan not found' });
    res.json({ plan });
  } catch (err) {
    console.error('[deliveryPlans] get failed:', err.message);
    res.status(500).json({ message: 'Could not load delivery plan' });
  }
});

// Create a new delivery plan (admin only)
router.post('/', authRequired, async (req, res) => {
  try {
    const { category, packageType, size, displayName, description, price, items } = req.body || {};
    
    // Validation
    if (!category || !category.trim()) {
      return res.status(400).json({ message: 'Category is required' });
    }
    if (!size || !size.trim()) {
      return res.status(400).json({ message: 'Size is required' });
    }
    if (!displayName || !displayName.trim()) {
      return res.status(400).json({ message: 'Display name is required' });
    }
    if (typeof price !== 'number' || price < 0) {
      return res.status(400).json({ message: 'Price must be a non-negative number' });
    }
    
    // Validate dynamic items if provided
    if (items && items.dynamicItems) {
      if (!Array.isArray(items.dynamicItems)) {
        return res.status(400).json({ message: 'Dynamic items must be an array' });
      }
      for (const item of items.dynamicItems) {
        if (!item.name || !item.name.trim()) {
          return res.status(400).json({ message: 'Each item must have a name' });
        }
        if (!item.quantity || !item.quantity.trim()) {
          return res.status(400).json({ message: 'Each item must have a quantity' });
        }
      }
    }
    
    // Check for duplicate (only check category + size since packageType is now optional)
    const existing = await DeliveryPlan.findOne({ 
      category: category.trim(),
      size: size.trim()
    });
    if (existing) {
      return res.status(409).json({ message: 'A plan with this category and size already exists' });
    }
    
    const plan = await DeliveryPlan.create({
      category: category.trim(),
      categoryDescription: req.body.categoryDescription?.trim() || '',
      packageType: packageType?.trim() || null,
      size: size.trim(),
      displayName: displayName.trim(),
      description: description?.trim() || '',
      price,
      items: items || { dynamicItems: [] }
    });
    
    res.status(201).json({ plan });
  } catch (err) {
    console.error('[deliveryPlans] create failed:', err.message);
    if (err.code === 11000) {
      return res.status(409).json({ message: 'A plan with this category and size already exists' });
    }
    res.status(500).json({ message: 'Could not create delivery plan' });
  }
});

// Update a delivery plan (admin only)
router.put('/:id', authRequired, async (req, res) => {
  try {
    const { displayName, description, price, items, active } = req.body || {};
    
    const updateData = {};
    if (displayName !== undefined) updateData.displayName = displayName.trim();
    if (description !== undefined) updateData.description = description.trim();
    if (price !== undefined) {
      if (typeof price !== 'number' || price < 0) {
        return res.status(400).json({ message: 'Price must be a non-negative number' });
      }
      updateData.price = price;
    }
    if (items !== undefined) updateData.items = items;
    if (active !== undefined) updateData.active = active;
    
    const plan = await DeliveryPlan.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true, runValidators: true }
    ).lean();
    
    if (!plan) return res.status(404).json({ message: 'Delivery plan not found' });
    
    res.json({ plan });
  } catch (err) {
    console.error('[deliveryPlans] update failed:', err.message);
    res.status(500).json({ message: 'Could not update delivery plan' });
  }
});

// Delete a delivery plan (admin only)
router.delete('/:id', authRequired, async (req, res) => {
  try {
    const plan = await DeliveryPlan.findById(req.params.id).lean();
    if (!plan) return res.status(404).json({ message: 'Delivery plan not found' });

    // Check for references in orders
    const orderCount = await Order.countDocuments({
      'tiffinPlan.packageType': plan.packageType,
      'tiffinPlan.size': plan.size
    });

    // Check for references in active subscriptions
    const subscriptionCount = await TiffinSubscription.countDocuments({
      packageType: plan.packageType,
      size: plan.size,
      status: 'ACTIVE'
    });

    if (orderCount > 0 || subscriptionCount > 0) {
      return res.status(409).json({ 
        message: 'Cannot delete plan that is referenced by existing orders or active subscriptions. Consider deactivating it instead.',
        orderCount,
        subscriptionCount
      });
    }

    await DeliveryPlan.findByIdAndDelete(req.params.id);
    res.json({ message: 'Delivery plan deleted' });
  } catch (err) {
    console.error('[deliveryPlans] delete failed:', err.message);
    res.status(500).json({ message: 'Could not delete delivery plan' });
  }
});

module.exports = router;
