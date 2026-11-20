const Product = require('../models/Product');
const Category = require('../models/Category');
const { Campaign } = require('../models/Marketing');
const Setting = require('../models/Setting');
const { asyncHandler, httpError, slugify, paginate, audit } = require('../utils/helpers');

/* ----------------------------- Public storefront ----------------------------- */

exports.publicSettings = asyncHandler(async (req, res) => {
  const s = await Setting.get();
  const o = s.toObject();
  delete o._id;
  delete o.__v;
  res.json({ settings: o });
});

exports.listProducts = asyncHandler(async (req, res) => {
  const { q, category, minPrice, maxPrice, sort, featured, isNewArrival, onSale, topRated } = req.query;
  const { page, limit, skip } = paginate(req, 12);
  const filter = { isActive: true };

  if (q) filter.$text = { $search: q };
  if (category) {
    const cat = await Category.findOne({ $or: [{ slug: category }, ...(category.match(/^[0-9a-fA-F]{24}$/) ? [{ _id: category }] : [])] });
    filter.category = cat ? cat._id : null;
  }
  if (minPrice || maxPrice) {
    filter.price = {};
    if (minPrice) filter.price.$gte = Number(minPrice);
    if (maxPrice) filter.price.$lte = Number(maxPrice);
  }
  if (featured === 'true') filter.isFeatured = true;
  if (isNewArrival === 'true') filter.isNewArrival = true;
  if (onSale === 'true') filter.salePrice = { $gt: 0 };
  if (topRated === 'true') filter.rating = { $gte: 4 };

  const sortMap = {
    newest: { createdAt: -1 },
    'price-asc': { price: 1 },
    'price-desc': { price: -1 },
    rating: { rating: -1 },
    popular: { sold: -1 },
  };
  const sortBy = sortMap[sort] || { createdAt: -1 };

  const [items, total] = await Promise.all([
    Product.find(filter).populate('category', 'name slug').sort(sortBy).skip(skip).limit(limit).select('-reviews'),
    Product.countDocuments(filter),
  ]);
  res.json({ items, total, page, pages: Math.ceil(total / limit) });
});

exports.getProduct = asyncHandler(async (req, res) => {
  const { idOrSlug } = req.params;
  const filter = idOrSlug.match(/^[0-9a-fA-F]{24}$/) ? { _id: idOrSlug } : { slug: idOrSlug };
  const product = await Product.findOne({ ...filter, isActive: true }).populate('category', 'name slug');
  if (!product) throw httpError(404, 'Product not found');
  const related = await Product.find({ category: product.category._id, _id: { $ne: product._id }, isActive: true })
    .limit(4)
    .select('-reviews');
  res.json({ product, related });
});

exports.listCategories = asyncHandler(async (req, res) => {
  const categories = await Category.find({ isActive: true }).sort('name');
  res.json({ categories });
});

exports.homeData = asyncHandler(async (req, res) => {
  const now = new Date();
  const live = { isActive: true, $and: [{ $or: [{ startsAt: null }, { startsAt: { $lte: now } }] }, { $or: [{ endsAt: null }, { endsAt: { $gte: now } }] }] };
  const [campaigns, newArrivals, topRated, featured, categories] = await Promise.all([
    Campaign.find(live).sort('sortOrder'),
    Product.find({ isActive: true }).sort('-createdAt').limit(8).select('-reviews').populate('category', 'name slug'),
    Product.find({ isActive: true, rating: { $gte: 4 } }).sort('-rating').limit(8).select('-reviews').populate('category', 'name slug'),
    Product.find({ isActive: true, isFeatured: true }).limit(8).select('-reviews').populate('category', 'name slug'),
    Category.find({ isActive: true }).sort('name'),
  ]);
  res.json({
    hero: campaigns.filter((c) => c.placement === 'hero'),
    promo: campaigns.filter((c) => c.placement === 'promo'),
    featuredOffers: campaigns.filter((c) => c.placement === 'featured'),
    newArrivals,
    topRated,
    featured,
    categories,
  });
});

/* ----------------------------- Reviews (customer) ----------------------------- */

exports.addReview = asyncHandler(async (req, res) => {
  const { rating, comment } = req.body;
  const product = await Product.findById(req.params.id);
  if (!product) throw httpError(404, 'Product not found');
  const existing = product.reviews.find((r) => String(r.user) === String(req.user._id));
  if (existing) {
    existing.rating = rating;
    existing.comment = comment;
  } else {
    product.reviews.push({ user: req.user._id, name: req.user.name, rating, comment });
  }
  product.numReviews = product.reviews.length;
  product.rating = product.reviews.reduce((a, r) => a + r.rating, 0) / product.reviews.length;
  await product.save();
  res.status(201).json({ message: 'Review saved', rating: product.rating, numReviews: product.numReviews });
});

/* ----------------------------- Catalog management (merchandiser: "catalog") ----------------------------- */

exports.adminListProducts = asyncHandler(async (req, res) => {
  const { q, category, status } = req.query;
  const { page, limit, skip } = paginate(req, 15);
  const filter = {};
  if (q) filter.$or = [{ name: new RegExp(q, 'i') }, { sku: new RegExp(q, 'i') }];
  if (category) filter.category = category;
  if (status === 'active') filter.isActive = true;
  if (status === 'inactive') filter.isActive = false;
  const [items, total] = await Promise.all([
    Product.find(filter).populate('category', 'name').sort('-createdAt').skip(skip).limit(limit).select('-reviews'),
    Product.countDocuments(filter),
  ]);
  res.json({ items, total, page, pages: Math.ceil(total / limit) });
});

exports.createProduct = asyncHandler(async (req, res) => {
  const body = { ...req.body };
  if (!body.name) throw httpError(400, 'Product name is required');
  body.slug = slugify(body.slug || body.name) + '-' + Math.random().toString(36).slice(2, 6);
  body.createdBy = req.user._id;
  if (body.salePrice === '' || body.salePrice === null) delete body.salePrice;
  const product = await Product.create(body);
  audit(req, 'product.create', 'Product', product._id, { name: product.name });
  res.status(201).json({ product });
});

exports.updateProduct = asyncHandler(async (req, res) => {
  const product = await Product.findById(req.params.id);
  if (!product) throw httpError(404, 'Product not found');
  const allowed = ['name', 'sku', 'description', 'category', 'brand', 'price', 'salePrice', 'images', 'tags', 'isFeatured', 'isNewArrival', 'isActive', 'lowStockThreshold', 'stock'];
  for (const k of allowed) if (req.body[k] !== undefined) product[k] = req.body[k];
  if (req.body.salePrice === '' || req.body.salePrice === null) product.salePrice = undefined;
  await product.save();
  audit(req, 'product.update', 'Product', product._id, { name: product.name });
  res.json({ product });
});

exports.deleteProduct = asyncHandler(async (req, res) => {
  const product = await Product.findByIdAndDelete(req.params.id);
  if (!product) throw httpError(404, 'Product not found');
  audit(req, 'product.delete', 'Product', product._id, { name: product.name });
  res.json({ message: 'Product deleted' });
});

exports.adminListCategories = asyncHandler(async (req, res) => {
  const categories = await Category.find().sort('name');
  res.json({ categories });
});

exports.createCategory = asyncHandler(async (req, res) => {
  const { name, image, description } = req.body;
  if (!name) throw httpError(400, 'Category name is required');
  const category = await Category.create({ name, slug: slugify(name), image, description });
  audit(req, 'category.create', 'Category', category._id, { name });
  res.status(201).json({ category });
});

exports.updateCategory = asyncHandler(async (req, res) => {
  const category = await Category.findById(req.params.id);
  if (!category) throw httpError(404, 'Category not found');
  const { name, image, description, isActive } = req.body;
  if (name) {
    category.name = name;
    category.slug = slugify(name);
  }
  if (image !== undefined) category.image = image;
  if (description !== undefined) category.description = description;
  if (isActive !== undefined) category.isActive = isActive;
  await category.save();
  res.json({ category });
});

exports.deleteCategory = asyncHandler(async (req, res) => {
  if (await Product.exists({ category: req.params.id })) throw httpError(400, 'Category has products; move or delete them first');
  await Category.findByIdAndDelete(req.params.id);
  res.json({ message: 'Category deleted' });
});
