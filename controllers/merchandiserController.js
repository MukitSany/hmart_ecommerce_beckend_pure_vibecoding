const Order = require('../models/Order');
const Product = require('../models/Product');
const { Coupon, Campaign } = require('../models/Marketing');
const { restoreStock } = require('./orderController');
const { asyncHandler, httpError, paginate, audit } = require('../utils/helpers');

/* ------------------------------ Dashboard ------------------------------ */

exports.stats = asyncHandler(async (req, res) => {
  const since = new Date(Date.now() - 30 * 24 * 3600 * 1000);
  const [totalProducts, lowStock, outOfStock, pendingOrders, toShip, revenueAgg, topProducts, salesByDay, activeCoupons, activeCampaigns] =
    await Promise.all([
      Product.countDocuments(),
      Product.countDocuments({ $expr: { $and: [{ $gt: ['$stock', 0] }, { $lte: ['$stock', '$lowStockThreshold'] }] } }),
      Product.countDocuments({ stock: 0 }),
      Order.countDocuments({ status: 'pending' }),
      Order.countDocuments({ status: { $in: ['processing', 'packed'] } }),
      Order.aggregate([
        { $match: { createdAt: { $gte: since }, status: { $nin: ['cancelled', 'returned'] }, $or: [{ paymentStatus: 'paid' }, { paymentMethod: 'cod' }] } },
        { $group: { _id: null, revenue: { $sum: '$total' }, orders: { $sum: 1 } } },
      ]),
      Product.find().sort('-sold').limit(5).select('name sold stock images price'),
      Order.aggregate([
        { $match: { createdAt: { $gte: since }, status: { $nin: ['cancelled', 'returned'] } } },
        { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, total: { $sum: '$total' }, orders: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ]),
      Coupon.countDocuments({ isActive: true }),
      Campaign.countDocuments({ isActive: true }),
    ]);
  res.json({
    totalProducts,
    lowStock,
    outOfStock,
    pendingOrders,
    toShip,
    revenue30d: revenueAgg[0]?.revenue || 0,
    orders30d: revenueAgg[0]?.orders || 0,
    topProducts,
    salesByDay,
    activeCoupons,
    activeCampaigns,
  });
});

/* ------------------------------ Inventory control ------------------------------ */

exports.inventory = asyncHandler(async (req, res) => {
  const { q, filter } = req.query;
  const { page, limit, skip } = paginate(req, 20);
  const where = {};
  if (q) where.$or = [{ name: new RegExp(q, 'i') }, { sku: new RegExp(q, 'i') }];
  if (filter === 'out') where.stock = 0;
  if (filter === 'low') where.$expr = { $and: [{ $gt: ['$stock', 0] }, { $lte: ['$stock', '$lowStockThreshold'] }] };
  const [items, total] = await Promise.all([
    Product.find(where).sort('stock').skip(skip).limit(limit).select('name sku stock lowStockThreshold images sold price isActive'),
    Product.countDocuments(where),
  ]);
  res.json({ items, total, page, pages: Math.ceil(total / limit) });
});

exports.adjustStock = asyncHandler(async (req, res) => {
  const { mode = 'set', quantity, lowStockThreshold, reason } = req.body;
  const product = await Product.findById(req.params.id);
  if (!product) throw httpError(404, 'Product not found');
  const before = product.stock;
  const qty = Number(quantity);
  if (quantity !== undefined) {
    if (Number.isNaN(qty)) throw httpError(400, 'Quantity must be a number');
    product.stock = mode === 'add' ? before + qty : qty;
    if (product.stock < 0) throw httpError(400, 'Stock cannot be negative');
  }
  if (lowStockThreshold !== undefined) product.lowStockThreshold = Number(lowStockThreshold);
  await product.save();
  audit(req, 'inventory.adjust', 'Product', product._id, { before, after: product.stock, reason });
  res.json({ product });
});

/* ------------------------------ Order fulfillment ------------------------------ */

exports.listOrders = asyncHandler(async (req, res) => {
  const { status, paymentStatus, q } = req.query;
  const { page, limit, skip } = paginate(req, 15);
  const filter = {};
  if (status) filter.status = status;
  if (paymentStatus) filter.paymentStatus = paymentStatus;
  if (q) filter.$or = [{ orderNo: new RegExp(q, 'i') }, { 'shippingAddress.name': new RegExp(q, 'i') }, { 'shippingAddress.phone': new RegExp(q, 'i') }];
  const [items, total] = await Promise.all([
    Order.find(filter).populate('user', 'name email').sort('-createdAt').skip(skip).limit(limit),
    Order.countDocuments(filter),
  ]);
  res.json({ items, total, page, pages: Math.ceil(total / limit) });
});

exports.getOrder = asyncHandler(async (req, res) => {
  const order = await Order.findById(req.params.id).populate('user', 'name email phone');
  if (!order) throw httpError(404, 'Order not found');
  res.json({ order });
});

const FLOW = {
  pending: ['processing', 'cancelled'],
  processing: ['packed', 'shipped', 'cancelled'],
  packed: ['shipped', 'cancelled'],
  shipped: ['delivered', 'returned'],
  delivered: ['returned'],
  cancelled: [],
  returned: [],
};

exports.updateOrderStatus = asyncHandler(async (req, res) => {
  const { status, note, trackingNumber, courier } = req.body;
  const order = await Order.findById(req.params.id);
  if (!order) throw httpError(404, 'Order not found');

  if (status && status !== order.status) {
    if (!FLOW[order.status].includes(status)) throw httpError(400, `Cannot move order from "${order.status}" to "${status}"`);
    // Online-paid orders must be paid before shipping (COD is paid on delivery)
    if (['shipped', 'delivered'].includes(status) && order.paymentMethod === 'sslcommerz' && order.paymentStatus !== 'paid') {
      throw httpError(400, 'Payment has not been received for this order');
    }
    order.status = status;
    order.statusHistory.push({ status, note, by: req.user._id });
    if (status === 'delivered' && order.paymentMethod === 'cod') {
      order.paymentStatus = 'paid';
      order.paidAt = new Date();
    }
    if (status === 'cancelled') {
      if (order.paymentStatus === 'pending') order.paymentStatus = 'cancelled';
      await restoreStock(order);
    }
    if (status === 'returned') {
      await restoreStock(order);
      if (order.paymentStatus === 'paid') order.paymentStatus = 'refunded';
    }
  }
  if (trackingNumber !== undefined) order.trackingNumber = trackingNumber;
  if (courier !== undefined) order.courier = courier;
  await order.save();
  audit(req, 'order.update', 'Order', order._id, { status, trackingNumber });
  res.json({ order });
});

/* ------------------------------ Marketing: coupons ------------------------------ */

exports.listCoupons = asyncHandler(async (req, res) => {
  res.json({ items: await Coupon.find().sort('-createdAt') });
});
exports.createCoupon = asyncHandler(async (req, res) => {
  const coupon = await Coupon.create({ ...req.body, createdBy: req.user._id });
  audit(req, 'coupon.create', 'Coupon', coupon._id, { code: coupon.code });
  res.status(201).json({ coupon });
});
exports.updateCoupon = asyncHandler(async (req, res) => {
  const coupon = await Coupon.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
  if (!coupon) throw httpError(404, 'Coupon not found');
  res.json({ coupon });
});
exports.deleteCoupon = asyncHandler(async (req, res) => {
  await Coupon.findByIdAndDelete(req.params.id);
  res.json({ message: 'Coupon deleted' });
});

/* ------------------------------ Marketing: campaigns / banners ------------------------------ */

exports.listCampaigns = asyncHandler(async (req, res) => {
  res.json({ items: await Campaign.find().sort('placement sortOrder') });
});
exports.createCampaign = asyncHandler(async (req, res) => {
  const campaign = await Campaign.create({ ...req.body, createdBy: req.user._id });
  audit(req, 'campaign.create', 'Campaign', campaign._id, { title: campaign.title });
  res.status(201).json({ campaign });
});
exports.updateCampaign = asyncHandler(async (req, res) => {
  const campaign = await Campaign.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
  if (!campaign) throw httpError(404, 'Campaign not found');
  res.json({ campaign });
});
exports.deleteCampaign = asyncHandler(async (req, res) => {
  await Campaign.findByIdAndDelete(req.params.id);
  res.json({ message: 'Campaign deleted' });
});
