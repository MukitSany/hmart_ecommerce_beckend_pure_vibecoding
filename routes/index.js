const router = require('express').Router();
const { protect, authorize, requirePermission, optionalAuth } = require('../middleware/auth');
const auth = require('../controllers/authController');
const catalog = require('../controllers/catalogController');
const order = require('../controllers/orderController');
const customer = require('../controllers/customerController');
const merch = require('../controllers/merchandiserController');
const admin = require('../controllers/adminController');

/* ---------------------------- Public ---------------------------- */
router.get('/health', (req, res) => res.json({ ok: true, time: new Date() }));
router.get('/settings/public', catalog.publicSettings);
router.get('/home', catalog.homeData);
router.get('/categories', catalog.listCategories);
router.get('/products', catalog.listProducts);
router.get('/products/:idOrSlug', catalog.getProduct);

/* ---------------------------- Auth ---------------------------- */
router.post('/auth/register', auth.register);
router.post('/auth/login', auth.login);
router.get('/auth/me', protect, auth.me);
router.put('/auth/profile', protect, auth.updateProfile);
router.put('/auth/password', protect, auth.changePassword);

/* ---------------------------- Payment callbacks (called by SSLCommerz, no auth) ---------------------------- */
router.post('/payment/success', order.paymentSuccess);
router.post('/payment/fail', order.paymentFail);
router.post('/payment/cancel', order.paymentCancel);
router.post('/payment/ipn', order.paymentIpn);

/* ---------------------------- Customer ---------------------------- */
const cust = require('express').Router();
cust.use(protect);
cust.get('/dashboard', customer.dashboard);
cust.post('/addresses', customer.addAddress);
cust.put('/addresses/:id', customer.updateAddress);
cust.delete('/addresses/:id', customer.deleteAddress);
cust.get('/wishlist', customer.getWishlist);
cust.post('/wishlist/:productId', customer.toggleWishlist);
cust.post('/coupons/validate', order.validateCoupon);
cust.post('/orders', order.createOrder);
cust.get('/orders', order.myOrders);
cust.get('/orders/:id', order.myOrder);
cust.post('/orders/:id/cancel', order.cancelMyOrder);
cust.post('/orders/:id/pay', order.retryPayment);
cust.post('/products/:id/reviews', catalog.addReview);
router.use('/customer', cust);

/* ---------------------------- Merchandiser (admin also allowed) ---------------------------- */
const m = require('express').Router();
m.use(protect, authorize('merchandiser', 'admin'));
m.get('/stats', merch.stats);

// Catalog management
m.get('/products', requirePermission('catalog'), catalog.adminListProducts);
m.post('/products', requirePermission('catalog'), catalog.createProduct);
m.put('/products/:id', requirePermission('catalog'), catalog.updateProduct);
m.delete('/products/:id', requirePermission('catalog'), catalog.deleteProduct);
m.get('/categories', requirePermission('catalog'), catalog.adminListCategories);
m.post('/categories', requirePermission('catalog'), catalog.createCategory);
m.put('/categories/:id', requirePermission('catalog'), catalog.updateCategory);
m.delete('/categories/:id', requirePermission('catalog'), catalog.deleteCategory);

// Inventory control
m.get('/inventory', requirePermission('inventory'), merch.inventory);
m.put('/inventory/:id', requirePermission('inventory'), merch.adjustStock);

// Order fulfillment
m.get('/orders', requirePermission('orders'), merch.listOrders);
m.get('/orders/:id', requirePermission('orders'), merch.getOrder);
m.put('/orders/:id/status', requirePermission('orders'), merch.updateOrderStatus);

// Marketing
m.get('/coupons', requirePermission('marketing'), merch.listCoupons);
m.post('/coupons', requirePermission('marketing'), merch.createCoupon);
m.put('/coupons/:id', requirePermission('marketing'), merch.updateCoupon);
m.delete('/coupons/:id', requirePermission('marketing'), merch.deleteCoupon);
m.get('/campaigns', requirePermission('marketing'), merch.listCampaigns);
m.post('/campaigns', requirePermission('marketing'), merch.createCampaign);
m.put('/campaigns/:id', requirePermission('marketing'), merch.updateCampaign);
m.delete('/campaigns/:id', requirePermission('marketing'), merch.deleteCampaign);
router.use('/merchandiser', m);

/* ---------------------------- Admin only ---------------------------- */
const a = require('express').Router();
a.use(protect, authorize('admin'));
a.get('/stats', admin.stats);
// Security & permissions
a.get('/users', admin.listUsers);
a.post('/users', admin.createUser);
a.put('/users/:id', admin.updateUser);
a.put('/users/:id/password', admin.resetUserPassword);
a.delete('/users/:id', admin.deleteUser);
a.get('/audit-logs', admin.auditLogs);
// Site configuration
a.get('/settings', admin.getSettings);
a.put('/settings', admin.updateSettings);
// Integrations
a.get('/integrations', admin.listIntegrations);
a.put('/integrations/:key', admin.updateIntegration);
// Maintenance
a.get('/maintenance', admin.maintenanceInfo);
a.put('/maintenance', admin.setMaintenance);
a.post('/maintenance/cleanup-orders', admin.cleanupStaleOrders);
a.post('/maintenance/clear-logs', admin.clearAuditLogs);
a.post('/maintenance/reindex', admin.rebuildIndexes);
router.use('/admin', a);

module.exports = router;
