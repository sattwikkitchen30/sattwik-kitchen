const mongoose = require('mongoose');
const Promotion = require('../models/Promotion');

// Public: list only active promotions for customer page
async function listActive(req, res) {
  try {
    const promotions = await Promotion.find({ isActive: true })
      .sort({ createdAt: 1, _id: 1 })
      .lean();
    res.json({ promotions });
  } catch (error) {
    console.error('[promotions] listActive failed:', error.message);
    res.status(500).json({ message: 'Could not load promotions' });
  }
}

// Admin: list all promotions (active and inactive)
async function listAll(req, res) {
  try {
    const promotions = await Promotion.find({})
      .sort({ createdAt: 1, _id: 1 })
      .lean();
    res.json({ promotions });
  } catch (error) {
    console.error('[promotions] listAll failed:', error.message);
    res.status(500).json({ message: 'Could not load promotions' });
  }
}

// Admin: get single promotion by ID
async function getOne(req, res) {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: 'Invalid promotion ID' });
    }
    const promotion = await Promotion.findById(req.params.id).lean();
    if (!promotion) {
      return res.status(404).json({ message: 'Promotion not found' });
    }
    res.json({ promotion });
  } catch (error) {
    console.error('[promotions] getOne failed:', error.message);
    res.status(500).json({ message: 'Could not load promotion' });
  }
}

// Admin: create a new promotion (active by default)
async function create(req, res) {
  try {
    const title = typeof req.body.title === 'string' ? req.body.title.trim() : '';
    const description = typeof req.body.description === 'string' ? req.body.description.trim() : '';

    if (!title) {
      return res.status(400).json({ message: 'Promotion title is required' });
    }
    if (!description) {
      return res.status(400).json({ message: 'Promotion description is required' });
    }

    const promotion = await Promotion.create({
      title,
      description,
      isActive: true
    });

    res.status(201).json({
      message: 'Promotion created successfully',
      promotion
    });
  } catch (error) {
    console.error('[promotions] create failed:', error.message);
    res.status(500).json({ message: error.message || 'Could not create promotion' });
  }
}

// Admin: update promotion title and description (preserves existing isActive)
async function update(req, res) {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: 'Invalid promotion ID' });
    }

    const updates = {};
    if (req.body.title !== undefined) {
      const trimmedTitle = typeof req.body.title === 'string' ? req.body.title.trim() : '';
      if (!trimmedTitle) {
        return res.status(400).json({ message: 'Promotion title is required' });
      }
      updates.title = trimmedTitle;
    }

    if (req.body.description !== undefined) {
      const trimmedDesc = typeof req.body.description === 'string' ? req.body.description.trim() : '';
      if (!trimmedDesc) {
        return res.status(400).json({ message: 'Promotion description is required' });
      }
      updates.description = trimmedDesc;
    }

    // Preserve existing isActive unless explicitly provided via status endpoint
    const promotion = await Promotion.findByIdAndUpdate(
      req.params.id,
      updates,
      { new: true, runValidators: true }
    );

    if (!promotion) {
      return res.status(404).json({ message: 'Promotion not found' });
    }

    res.json({
      message: 'Promotion updated successfully',
      promotion
    });
  } catch (error) {
    console.error('[promotions] update failed:', error.message);
    res.status(500).json({ message: error.message || 'Could not update promotion' });
  }
}

// Admin: activate or deactivate promotion
async function updateStatus(req, res) {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: 'Invalid promotion ID' });
    }

    const promotion = await Promotion.findById(req.params.id);
    if (!promotion) {
      return res.status(404).json({ message: 'Promotion not found' });
    }

    if (typeof req.body.isActive === 'boolean') {
      promotion.isActive = req.body.isActive;
    } else {
      promotion.isActive = !promotion.isActive;
    }

    await promotion.save();

    res.json({
      message: `Promotion ${promotion.isActive ? 'activated' : 'deactivated'} successfully`,
      promotion
    });
  } catch (error) {
    console.error('[promotions] updateStatus failed:', error.message);
    res.status(500).json({ message: error.message || 'Could not update promotion status' });
  }
}

// Admin: permanently delete a promotion
async function remove(req, res) {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: 'Invalid promotion ID' });
    }

    const promotion = await Promotion.findByIdAndDelete(req.params.id);
    if (!promotion) {
      return res.status(404).json({ message: 'Promotion not found' });
    }

    res.json({ message: 'Promotion deleted successfully' });
  } catch (error) {
    console.error('[promotions] remove failed:', error.message);
    res.status(500).json({ message: error.message || 'Could not delete promotion' });
  }
}

module.exports = {
  listActive,
  listAll,
  getOne,
  create,
  update,
  updateStatus,
  remove
};
