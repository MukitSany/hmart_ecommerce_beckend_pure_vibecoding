const User = require('../models/User');
const Order = require('../models/Order');
const Product = require('../models/Product');
const { asyncHandler, httpError } = require('../utils/helpers');

exports.dashboard = asyncHandler(async (req, res) => {
  const [orders, user] = await Promise.all([
    Order.find({ user: req.user._id }).sort('-createdAt'),
    User.findById(req.user._id),
  ]);
  const paid = orders.filter((o) => o.paymentStatus === 'paid' || o.status === 'delivered');
  res.json({
    totalOrders: orders.length,
    pendingOrders: orders.filter((o) => ['pending', 'processing', 'packed', 'shipped'].includes(o.status)).length,
    deliveredOrders: orders.filter((o) => o.status === 'delivered').length,
    totalSpent: paid.reduce((a, o) => a + o.total, 0),
    wishlistCount: user.wishlist.length,
    recentOrders: orders.slice(0, 5),
  });
});

/* addresses */
exports.addAddress = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id);
  if (req.body.isDefault || user.addresses.length === 0) user.addresses.forEach((a) => (a.isDefault = false));
  user.addresses.push({ ...req.body, isDefault: req.body.isDefault || user.addresses.length === 0 });
  await user.save();
  res.status(201).json({ addresses: user.addresses });
});

exports.updateAddress = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id);
  const addr = user.addresses.id(req.params.id);
  if (!addr) throw httpError(404, 'Address not found');
  if (req.body.isDefault) user.addresses.forEach((a) => (a.isDefault = false));
  addr.set(req.body);
  await user.save();
  res.json({ addresses: user.addresses });
});

exports.deleteAddress = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id);
  user.addresses.pull(req.params.id);
  await user.save();
  res.json({ addresses: user.addresses });
});

/* wishlist */
exports.getWishlist = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id).populate({ path: 'wishlist', select: '-reviews', populate: { path: 'category', select: 'name slug' } });
  res.json({ items: user.wishlist });
});

exports.toggleWishlist = asyncHandler(async (req, res) => {
  const { productId } = req.params;
  if (!(await Product.exists({ _id: productId }))) throw httpError(404, 'Product not found');
  const user = await User.findById(req.user._id);
  const idx = user.wishlist.findIndex((p) => String(p) === productId);
  if (idx >= 0) user.wishlist.splice(idx, 1);
  else user.wishlist.push(productId);
  await user.save();
  res.json({ wishlist: user.wishlist, added: idx < 0 });
});
