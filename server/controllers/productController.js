const Product = require('../models/Product');

async function listActive(req, res) {
  const products = await Product.find({ active: true }).sort({ category: 1, name: 1 }).lean();
  res.json({ products });
}

async function listAll(req, res) {
  const { search, category, active } = req.query;
  const match = {};
  if (search) match.name = new RegExp(search, 'i');
  if (category) match.category = category;
  if (active === 'true' || active === 'false') match.active = active === 'true';
  const products = await Product.find(match).sort({ category: 1, name: 1 }).lean();
  res.json({ products });
}

async function getOne(req, res) {
  const product = await Product.findById(req.params.id).lean();
  if (!product) return res.status(404).json({ message: 'Product not found' });
  res.json({ product });
}

async function create(req, res) {
  const { name, category, description, price, image, active, stock, lowStockThreshold } = req.body;
  if (!name || !(parseFloat(price) >= 0)) return res.status(400).json({ message: 'Name and a valid price are required' });
  
  // Validate description
  const trimmedDescription = description ? String(description).trim() : '';
  if (!trimmedDescription) return res.status(400).json({ message: 'Description is required' });
  
  const product = await Product.create({
    name: String(name).trim(),
    category: category || 'Pickles',
    description: trimmedDescription,
    price: Math.round(parseFloat(price) * 100) / 100,
    image: image || 'assets/product-placeholder.svg',
    active: active !== false,
    stock: Number(stock) || 0,
    lowStockThreshold: Number(lowStockThreshold) || 5
  });
  res.status(201).json({ message: 'Product created', product });
}

async function update(req, res) {
  const updates = {};
  const { name, category, description, price, image, active, stock, lowStockThreshold } = req.body;
  if (name !== undefined) updates.name = String(name).trim();
  if (category !== undefined) updates.category = category;
  if (description !== undefined) {
    const trimmedDescription = String(description).trim();
    if (!trimmedDescription) return res.status(400).json({ message: 'Description is required' });
    updates.description = trimmedDescription;
  }
  if (price !== undefined) updates.price = Math.round(parseFloat(price) * 100) / 100;
  if (image !== undefined) updates.image = image;
  if (active !== undefined) updates.active = Boolean(active);
  if (stock !== undefined) updates.stock = Number(stock) || 0;
  if (lowStockThreshold !== undefined) updates.lowStockThreshold = Number(lowStockThreshold) || 5;
  const product = await Product.findByIdAndUpdate(req.params.id, updates, { new: true, runValidators: true });
  if (!product) return res.status(404).json({ message: 'Product not found' });
  res.json({ message: 'Product updated', product });
}

async function remove(req, res) {
  const product = await Product.findByIdAndDelete(req.params.id);
  if (!product) return res.status(404).json({ message: 'Product not found' });
  res.json({ message: 'Product deleted' });
}

async function updateStock(req, res) {
  const stock = Number(req.body?.stock);
  if (!Number.isInteger(stock) || stock < 0) return res.status(400).json({ message: 'Stock must be a non-negative integer.' });
  const product = await Product.findByIdAndUpdate(req.params.id, { stock }, { new: true, runValidators: true });
  if (!product) return res.status(404).json({ message: 'Product not found' });
  const io = req.app.get('io');
  if (io) {
    io.emit('product:stockUpdated', { productId: product._id, stock: product.stock, product });
  }
  res.json({ message: 'Stock updated', product });
}

module.exports = { listActive, listAll, getOne, create, update, updateStock, remove };
