const mongoose = require('mongoose');
const User = require('../models/User');
const Order = require('../models/Order');
const Product = require('../models/Product');
const Setting = require('../models/Setting');
const Integration = require('../models/Integration');
const AuditLog = require('../models/AuditLog');
const { restoreStock } = require('./orderController');
const { asyncHandler, httpError, paginate, audit } = require('../utils/helpers');

/* ------------------------------ Dashboard ------------------------------ */

exports.stats = asyncHandler(async (req, res) => {
  const [users, byRole, products, orders, revenueAgg, recentLogs, settings] = await Promise.all([
    User.countDocuments(),
    User.aggregate([{ $group: { _id: '$role', count: { $sum: 1 } } }]),
    Product.countDocuments(),
    Order.countDocuments(),
    Order.aggregate([{ $match: { paymentStatus: 'paid' } }, { $group: { _id: null, total: { $sum: '$total' } } }]),
    AuditLog.find().sort('-createdAt').limit(8),
    Setting.get(),
  ]);
  res.json({
    users,
    usersByRole: Object.fromEntries(byRole.map((r) => [r._id, r.count])),
    products,
    orders,
    revenue: revenueAgg[0]?.total || 0,
    recentLogs,
    maintenanceMode: settings.maintenanceMode,
  });
});

/* ------------------------------ Security & permissions ------------------------------ */

exports.listUsers = asyncHandler(async (req, res) => {
  const { role, q, active } = req.query;
  const { page, limit, skip } = paginate(req, 15);
  const filter = {};
  if (role) filter.role = role;
  if (active === 'true') filter.isActive = true;
  if (active === 'false') filter.isActive = false;
  if (q) filter.$or = [{ name: new RegExp(q, 'i') }, { email: new RegExp(q, 'i') }];
  const [items, total] = await Promise.all([
    User.find(filter).sort('-createdAt').skip(skip).limit(limit).select('-wishlist -addresses'),
    User.countDocuments(filter),
  ]);
  res.json({ items, total, page, pages: Math.ceil(total / limit), availablePermissions: User.MERCH_PERMISSIONS });
});

exports.createUser = asyncHandler(async (req, res) => {
  const { name, email, password, role, phone, permissions } = req.body;
  if (!['customer', 'merchandiser', 'admin'].includes(role)) throw httpError(400, 'Invalid role');
  if (!name || !email || !password) throw httpError(400, 'Name, email and password are required');
  const user = await User.create({
    name,
    email,
    password,
    role,
    phone,
    permissions: role === 'merchandiser' ? (permissions?.length ? permissions : [...User.MERCH_PERMISSIONS]) : [],
  });
  audit(req, 'user.create', 'User', user._id, { email, role });
  res.status(201).json({ user: { ...user.toObject(), password: undefined } });
});

exports.updateUser = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) throw httpError(404, 'User not found');
  const isSelf = String(user._id) === String(req.user._id);
  const { role, isActive, permissions, name, phone } = req.body;

  if (isSelf && (role && role !== 'admin')) throw httpError(400, 'You cannot demote yourself');
  if (isSelf && isActive === false) throw httpError(400, 'You cannot deactivate yourself');

  if (name) user.name = name;
  if (phone !== undefined) user.phone = phone;
  if (role) {
    if (!['customer', 'merchandiser', 'admin'].includes(role)) throw httpError(400, 'Invalid role');
    user.role = role;
    if (role === 'merchandiser' && user.permissions.length === 0) user.permissions = [...User.MERCH_PERMISSIONS];
    if (role !== 'merchandiser') user.permissions = [];
  }
  if (isActive !== undefined) user.isActive = !!isActive;
  if (permissions && user.role === 'merchandiser') {
    user.permissions = permissions.filter((p) => User.MERCH_PERMISSIONS.includes(p));
  }
  await user.save();
  audit(req, 'user.update', 'User', user._id, { role, isActive, permissions });
  res.json({ user });
});

exports.resetUserPassword = asyncHandler(async (req, res) => {
  const { password } = req.body;
  if (!password || password.length < 6) throw httpError(400, 'Password must be at least 6 characters');
  const user = await User.findById(req.params.id);
  if (!user) throw httpError(404, 'User not found');
  user.password = password;
  await user.save();
  audit(req, 'user.password_reset', 'User', user._id);
  res.json({ message: 'Password reset' });
});

exports.deleteUser = asyncHandler(async (req, res) => {
  if (String(req.params.id) === String(req.user._id)) throw httpError(400, 'You cannot delete yourself');
  const user = await User.findByIdAndDelete(req.params.id);
  if (!user) throw httpError(404, 'User not found');
  audit(req, 'user.delete', 'User', user._id, { email: user.email });
  res.json({ message: 'User deleted' });
});

exports.auditLogs = asyncHandler(async (req, res) => {
  const { page, limit, skip } = paginate(req, 25);
  const filter = {};
  if (req.query.action) filter.action = new RegExp(req.query.action, 'i');
  const [items, total] = await Promise.all([AuditLog.find(filter).sort('-createdAt').skip(skip).limit(limit), AuditLog.countDocuments(filter)]);
  res.json({ items, total, page, pages: Math.ceil(total / limit) });
});

/* ------------------------------ Site configuration ------------------------------ */

exports.getSettings = asyncHandler(async (req, res) => res.json({ settings: await Setting.get() }));

exports.updateSettings = asyncHandler(async (req, res) => {
  const s = await Setting.get();
  const allowed = [
    'siteName', 'tagline', 'logo', 'contactEmail', 'contactPhone', 'address', 'topBarText', 'currency', 'currencySymbol',
    'shippingFee', 'freeShippingThreshold', 'taxRate', 'allowCOD', 'allowRegistration', 'social', 'seo',
  ];
  for (const k of allowed) if (req.body[k] !== undefined) s[k] = req.body[k];
  await s.save();
  audit(req, 'settings.update', 'Setting', s._id);
  res.json({ settings: s });
});

/* ------------------------------ Integrations ------------------------------ */

const DEFAULT_INTEGRATIONS = [
  { key: 'sslcommerz', name: 'SSLCommerz', description: 'Payment gateway (cards, mobile banking, net banking)', enabled: true, secretFields: ['storePassword'], config: { storeId: '', storePassword: '', isLive: false } },
  { key: 'smtp', name: 'Email (SMTP)', description: 'Transactional emails (order confirmations, receipts)', enabled: false, secretFields: ['pass'], config: { host: '', port: 587, user: '', pass: '', from: '' } },
  { key: 'sms', name: 'SMS Gateway', description: 'Order status SMS notifications', enabled: false, secretFields: ['apiKey'], config: { provider: '', apiKey: '', senderId: '' } },
  { key: 'analytics', name: 'Analytics', description: 'Google Analytics / Meta Pixel tracking IDs', enabled: false, secretFields: [], config: { gaId: '', metaPixelId: '' } },
];

async function ensureIntegrations() {
  for (const d of DEFAULT_INTEGRATIONS) {
    await Integration.updateOne({ key: d.key }, { $setOnInsert: d }, { upsert: true });
  }
}

exports.listIntegrations = asyncHandler(async (req, res) => {
  await ensureIntegrations();
  const items = await Integration.find().sort('name');
  res.json({ items: items.map((i) => i.toSafe()) });
});

exports.updateIntegration = asyncHandler(async (req, res) => {
  const integ = await Integration.findOne({ key: req.params.key });
  if (!integ) throw httpError(404, 'Integration not found');
  if (req.body.enabled !== undefined) integ.enabled = !!req.body.enabled;
  if (req.body.config) {
    const merged = { ...(integ.config || {}) };
    for (const [k, v] of Object.entries(req.body.config)) {
      // Do not overwrite a stored secret with the masked placeholder
      if (integ.secretFields.includes(k) && (v === '••••••••' || v === '')) continue;
      merged[k] = v;
    }
    integ.config = merged;
    integ.markModified('config');
  }
  await integ.save();
  audit(req, 'integration.update', 'Integration', integ.key, { enabled: integ.enabled });
  res.json({ integration: integ.toSafe() });
});

/* ------------------------------ Maintenance ------------------------------ */

exports.maintenanceInfo = asyncHandler(async (req, res) => {
  const s = await Setting.get();
  const staleBefore = new Date(Date.now() - 24 * 3600 * 1000);
  const [stale, collections] = await Promise.all([
    Order.countDocuments({ paymentMethod: 'sslcommerz', paymentStatus: 'pending', status: 'pending', createdAt: { $lt: staleBefore } }),
    Promise.all(
      ['users', 'products', 'orders', 'categories', 'coupons', 'campaigns', 'auditlogs'].map(async (c) => ({
        name: c,
        count: await mongoose.connection.collection(c).countDocuments().catch(() => 0),
      }))
    ),
  ]);
  res.json({
    maintenanceMode: s.maintenanceMode,
    maintenanceMessage: s.maintenanceMessage,
    dbState: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    uptimeSeconds: Math.round(process.uptime()),
    nodeVersion: process.version,
    memoryMB: Math.round(process.memoryUsage().rss / 1024 / 1024),
    staleUnpaidOrders: stale,
    collections,
  });
});

exports.setMaintenance = asyncHandler(async (req, res) => {
  const s = await Setting.get();
  s.maintenanceMode = !!req.body.enabled;
  if (req.body.message) s.maintenanceMessage = req.body.message;
  await s.save();
  audit(req, 'maintenance.toggle', 'Setting', s._id, { enabled: s.maintenanceMode });
  res.json({ maintenanceMode: s.maintenanceMode, maintenanceMessage: s.maintenanceMessage });
});

// Cancel unpaid online orders older than 24h and return their stock
exports.cleanupStaleOrders = asyncHandler(async (req, res) => {
  const staleBefore = new Date(Date.now() - 24 * 3600 * 1000);
  const orders = await Order.find({ paymentMethod: 'sslcommerz', paymentStatus: 'pending', status: 'pending', createdAt: { $lt: staleBefore } });
  for (const o of orders) {
    o.status = 'cancelled';
    o.paymentStatus = 'cancelled';
    o.statusHistory.push({ status: 'cancelled', note: 'Auto-cancelled: unpaid for 24h', by: req.user._id });
    await restoreStock(o);
    await o.save();
  }
  audit(req, 'maintenance.cleanup_orders', 'Order', null, { cancelled: orders.length });
  res.json({ cancelled: orders.length });
});

exports.clearAuditLogs = asyncHandler(async (req, res) => {
  const days = Math.max(parseInt(req.body.olderThanDays) || 90, 7);
  const r = await AuditLog.deleteMany({ createdAt: { $lt: new Date(Date.now() - days * 24 * 3600 * 1000) } });
  audit(req, 'maintenance.clear_logs', 'AuditLog', null, { days, deleted: r.deletedCount });
  res.json({ deleted: r.deletedCount });
});

exports.rebuildIndexes = asyncHandler(async (req, res) => {
  await Promise.all([Product.syncIndexes(), User.syncIndexes(), Order.syncIndexes()]);
  audit(req, 'maintenance.reindex', 'DB');
  res.json({ message: 'Indexes synchronized' });
});
