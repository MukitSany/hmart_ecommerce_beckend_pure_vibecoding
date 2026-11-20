const mongoose = require('mongoose');
const Order = require('../models/Order');
const Product = require('../models/Product');
const Setting = require('../models/Setting');
const { Coupon } = require('../models/Marketing');
const { initPayment, validatePayment } = require('../utils/sslcommerz');
const { asyncHandler, httpError, paginate } = require('../utils/helpers');

/* ------------------------------ helpers ------------------------------ */

async function computeCoupon(code, subtotal) {
  if (!code) return { discount: 0 };
  const c = await Coupon.findOne({ code: String(code).toUpperCase(), isActive: true });
  const now = new Date();
  if (!c) throw httpError(400, 'Invalid coupon code');
  if (c.startsAt && c.startsAt > now) throw httpError(400, 'Coupon is not active yet');
  if (c.expiresAt && c.expiresAt < now) throw httpError(400, 'Coupon has expired');
  if (c.usageLimit && c.usedCount >= c.usageLimit) throw httpError(400, 'Coupon usage limit reached');
  if (subtotal < (c.minOrder || 0)) throw httpError(400, `Minimum order for this coupon is ${c.minOrder}`);
  let discount = c.type === 'percent' ? (subtotal * c.value) / 100 : c.value;
  if (c.maxDiscount) discount = Math.min(discount, c.maxDiscount);
  discount = Math.min(discount, subtotal);
  return { discount: Math.round(discount * 100) / 100, coupon: c };
}

async function restoreStock(order) {
  if (order.stockRestored) return;
  for (const it of order.items) {
    await Product.updateOne({ _id: it.product }, { $inc: { stock: it.qty, sold: -it.qty } });
  }
  order.stockRestored = true;
}

/* ------------------------------ coupon preview ------------------------------ */

exports.validateCoupon = asyncHandler(async (req, res) => {
  const { code, subtotal } = req.body;
  const { discount } = await computeCoupon(code, Number(subtotal) || 0);
  res.json({ code: String(code).toUpperCase(), discount });
});

/* ------------------------------ create order ------------------------------ */

exports.createOrder = asyncHandler(async (req, res) => {
  const { items, shippingAddress, paymentMethod = 'sslcommerz', couponCode, note } = req.body;
  if (!Array.isArray(items) || items.length === 0) throw httpError(400, 'Cart is empty');
  if (!shippingAddress?.name || !shippingAddress?.phone || !shippingAddress?.address || !shippingAddress?.city) {
    throw httpError(400, 'Shipping name, phone, address and city are required');
  }

  const settings = await Setting.get();
  if (paymentMethod === 'cod' && !settings.allowCOD) throw httpError(400, 'Cash on delivery is not available');

  // Price everything on the SERVER (never trust client prices)
  const orderItems = [];
  for (const line of items) {
    const qty = Math.max(parseInt(line.qty) || 1, 1);
    const p = await Product.findOne({ _id: line.product, isActive: true });
    if (!p) throw httpError(400, 'A product in your cart is no longer available');
    orderItems.push({
      product: p._id,
      name: p.name,
      image: p.images?.[0],
      sku: p.sku,
      price: p.salePrice && p.salePrice < p.price ? p.salePrice : p.price,
      qty,
    });
  }

  const subtotal = orderItems.reduce((a, i) => a + i.price * i.qty, 0);
  const { discount, coupon } = await computeCoupon(couponCode, subtotal);
  const afterDiscount = subtotal - discount;
  const shippingFee = afterDiscount >= settings.freeShippingThreshold ? 0 : settings.shippingFee;
  const tax = Math.round(((afterDiscount * settings.taxRate) / 100) * 100) / 100;
  const total = Math.round((afterDiscount + shippingFee + tax) * 100) / 100;

  // Reserve stock atomically (rolled back on failure)
  const reserved = [];
  try {
    for (const it of orderItems) {
      const r = await Product.findOneAndUpdate(
        { _id: it.product, stock: { $gte: it.qty } },
        { $inc: { stock: -it.qty, sold: it.qty } },
        { new: true }
      );
      if (!r) throw httpError(400, `Insufficient stock for "${it.name}"`);
      reserved.push(it);
    }
  } catch (e) {
    for (const it of reserved) await Product.updateOne({ _id: it.product }, { $inc: { stock: it.qty, sold: -it.qty } });
    throw e;
  }

  const tranId = 'HM-' + new mongoose.Types.ObjectId().toString();
  const order = await Order.create({
    user: req.user._id,
    items: orderItems,
    shippingAddress: { ...shippingAddress, email: shippingAddress.email || req.user.email },
    subtotal,
    shippingFee,
    tax,
    discount,
    couponCode: coupon?.code,
    total,
    currency: settings.currency || 'BDT',
    paymentMethod,
    tranId,
    note,
    statusHistory: [{ status: 'pending', note: 'Order placed', by: req.user._id }],
  });
  if (coupon) await Coupon.updateOne({ _id: coupon._id }, { $inc: { usedCount: 1 } });

  if (paymentMethod === 'cod') {
    return res.status(201).json({ order, cod: true });
  }

  try {
    const { url } = await initPayment(order, req.user);
    res.status(201).json({ order, paymentUrl: url });
  } catch (e) {
    // Payment session failed: cancel order & return stock so nothing is left hanging
    order.paymentStatus = 'failed';
    order.status = 'cancelled';
    order.statusHistory.push({ status: 'cancelled', note: 'Payment session could not be created' });
    await restoreStock(order);
    await order.save();
    throw e;
  }
});

/* ------------------------------ SSLCommerz callbacks ------------------------------ */

const clientUrl = () => process.env.CLIENT_URL || 'http://localhost:3000';

exports.paymentSuccess = asyncHandler(async (req, res) => {
  const { val_id, tran_id } = req.body;
  const order = await Order.findOne({ tranId: tran_id });
  if (!order) return res.redirect(`${clientUrl()}/checkout/fail?reason=order_not_found`);
  if (order.paymentStatus === 'paid') return res.redirect(`${clientUrl()}/checkout/success?order=${order._id}`);

  try {
    // NEVER trust the browser redirect alone — verify with SSLCommerz's validation API
    const v = await validatePayment(val_id);
    const valid = ['VALID', 'VALIDATED'].includes(v.status);
    const amountOk = Math.abs(Number(v.amount) - order.total) < 1; // currency_amount can differ; amount is in BDT
    const tranOk = v.tran_id === order.tranId;

    if (valid && amountOk && tranOk) {
      order.paymentStatus = 'paid';
      order.paidAt = new Date();
      order.valId = val_id;
      order.paymentDetails = { bank_tran_id: v.bank_tran_id, card_type: v.card_type, card_brand: v.card_brand, amount: v.amount, currency: v.currency, tran_date: v.tran_date };
      order.status = 'processing';
      order.statusHistory.push({ status: 'processing', note: 'Payment received via SSLCommerz' });
      await order.save();
      return res.redirect(`${clientUrl()}/checkout/success?order=${order._id}`);
    }
    order.paymentStatus = 'failed';
    order.paymentDetails = v;
  } catch (e) {
    console.error('SSLCommerz validation error:', e.message);
    return res.redirect(`${clientUrl()}/checkout/fail?order=${order._id}&reason=validation_error`);
  }
  order.status = 'cancelled';
  order.statusHistory.push({ status: 'cancelled', note: 'Payment validation failed' });
  await restoreStock(order);
  await order.save();
  res.redirect(`${clientUrl()}/checkout/fail?order=${order._id}`);
});

async function failOrCancel(req, res, state) {
  const order = await Order.findOne({ tranId: req.body.tran_id });
  if (order && order.paymentStatus !== 'paid') {
    order.paymentStatus = state;
    order.status = 'cancelled';
    order.statusHistory.push({ status: 'cancelled', note: `Payment ${state}` });
    await restoreStock(order);
    await order.save();
  }
  res.redirect(`${clientUrl()}/checkout/${state === 'cancelled' ? 'cancel' : 'fail'}${order ? `?order=${order._id}` : ''}`);
}
exports.paymentFail = asyncHandler((req, res) => failOrCancel(req, res, 'failed'));
exports.paymentCancel = asyncHandler((req, res) => failOrCancel(req, res, 'cancelled'));

// IPN: server-to-server notification from SSLCommerz (safety net if the browser never returns)
exports.paymentIpn = asyncHandler(async (req, res) => {
  const { val_id, tran_id, status } = req.body;
  const order = await Order.findOne({ tranId: tran_id });
  if (!order || order.paymentStatus === 'paid') return res.sendStatus(200);
  if (['VALID', 'VALIDATED'].includes(status) && val_id) {
    const v = await validatePayment(val_id);
    if (['VALID', 'VALIDATED'].includes(v.status) && v.tran_id === order.tranId && Math.abs(Number(v.amount) - order.total) < 1) {
      order.paymentStatus = 'paid';
      order.paidAt = new Date();
      order.valId = val_id;
      order.paymentDetails = v;
      if (order.status === 'pending') {
        order.status = 'processing';
        order.statusHistory.push({ status: 'processing', note: 'Payment confirmed via IPN' });
      }
      await order.save();
    }
  }
  res.sendStatus(200);
});

// Customer can retry payment for an unpaid sslcommerz order that is still open
exports.retryPayment = asyncHandler(async (req, res) => {
  const order = await Order.findOne({ _id: req.params.id, user: req.user._id });
  if (!order) throw httpError(404, 'Order not found');
  if (order.paymentMethod !== 'sslcommerz' || order.paymentStatus === 'paid') throw httpError(400, 'Nothing to pay for this order');
  if (order.status === 'cancelled') throw httpError(400, 'This order was cancelled. Please place a new order.');
  order.tranId = 'HM-' + new mongoose.Types.ObjectId().toString();
  await order.save();
  const { url } = await initPayment(order, req.user);
  res.json({ paymentUrl: url });
});

/* ------------------------------ customer order endpoints ------------------------------ */

exports.myOrders = asyncHandler(async (req, res) => {
  const { page, limit, skip } = paginate(req, 10);
  const [items, total] = await Promise.all([
    Order.find({ user: req.user._id }).sort('-createdAt').skip(skip).limit(limit),
    Order.countDocuments({ user: req.user._id }),
  ]);
  res.json({ items, total, page, pages: Math.ceil(total / limit) });
});

exports.myOrder = asyncHandler(async (req, res) => {
  const order = await Order.findOne({ _id: req.params.id, user: req.user._id });
  if (!order) throw httpError(404, 'Order not found');
  res.json({ order });
});

exports.cancelMyOrder = asyncHandler(async (req, res) => {
  const order = await Order.findOne({ _id: req.params.id, user: req.user._id });
  if (!order) throw httpError(404, 'Order not found');
  if (!['pending', 'processing'].includes(order.status)) throw httpError(400, 'This order can no longer be cancelled');
  if (order.paymentStatus === 'paid') throw httpError(400, 'Paid orders must be cancelled through support (refund required)');
  order.status = 'cancelled';
  if (order.paymentStatus === 'pending') order.paymentStatus = 'cancelled';
  order.statusHistory.push({ status: 'cancelled', note: 'Cancelled by customer', by: req.user._id });
  await restoreStock(order);
  await order.save();
  res.json({ order });
});

exports.restoreStock = restoreStock;
