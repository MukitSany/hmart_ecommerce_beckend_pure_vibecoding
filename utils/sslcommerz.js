const axios = require('axios');
const Integration = require('../models/Integration');

/**
 * SSLCommerz credentials come from the "sslcommerz" Integration (editable by Admin in the dashboard)
 * and fall back to environment variables.
 */
async function getConfig() {
  const integ = await Integration.findOne({ key: 'sslcommerz' });
  const cfg = integ?.config || {};
  const storeId = cfg.storeId || process.env.SSLCOMMERZ_STORE_ID;
  const storePassword = cfg.storePassword || process.env.SSLCOMMERZ_STORE_PASSWORD;
  const isLive = cfg.isLive !== undefined ? !!cfg.isLive : process.env.SSLCOMMERZ_IS_LIVE === 'true';
  const enabled = integ ? integ.enabled : true;
  const base = isLive ? 'https://securepay.sslcommerz.com' : 'https://sandbox.sslcommerz.com';
  return { storeId, storePassword, isLive, enabled, base };
}

async function initPayment(order, user) {
  const cfg = await getConfig();
  if (!cfg.enabled) throw Object.assign(new Error('SSLCommerz payments are currently disabled'), { status: 400 });
  if (!cfg.storeId || !cfg.storePassword || cfg.storeId === 'your_store_id') {
    throw Object.assign(new Error('SSLCommerz is not configured (set store id/password)'), { status: 500 });
  }

  const server = process.env.SERVER_URL || 'http://localhost:5000';
  const sa = order.shippingAddress || {};

  const payload = new URLSearchParams({
    store_id: cfg.storeId,
    store_passwd: cfg.storePassword,
    total_amount: order.total.toFixed(2),
    currency: order.currency || 'BDT',
    tran_id: order.tranId,
    success_url: `${server}/api/payment/success`,
    fail_url: `${server}/api/payment/fail`,
    cancel_url: `${server}/api/payment/cancel`,
    ipn_url: `${server}/api/payment/ipn`,
    shipping_method: 'Courier',
    product_name: order.items.map((i) => i.name).join(', ').slice(0, 250) || 'Hmart order',
    product_category: 'General',
    product_profile: 'physical-goods',
    cus_name: sa.name || user.name,
    cus_email: sa.email || user.email,
    cus_add1: sa.address || 'N/A',
    cus_city: sa.city || 'Dhaka',
    cus_postcode: sa.postcode || '1000',
    cus_country: sa.country || 'Bangladesh',
    cus_phone: sa.phone || user.phone || '01700000000',
    ship_name: sa.name || user.name,
    ship_add1: sa.address || 'N/A',
    ship_city: sa.city || 'Dhaka',
    ship_postcode: sa.postcode || '1000',
    ship_country: sa.country || 'Bangladesh',
    value_a: String(order._id),
  });

  const { data } = await axios.post(`${cfg.base}/gwprocess/v4/api.php`, payload.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    timeout: 20000,
  });

  if (data.status !== 'SUCCESS' || !data.GatewayPageURL) {
    throw Object.assign(new Error(data.failedreason || 'SSLCommerz session initiation failed'), { status: 502 });
  }
  return { url: data.GatewayPageURL, sessionKey: data.sessionkey };
}

async function validatePayment(valId) {
  const cfg = await getConfig();
  const { data } = await axios.get(`${cfg.base}/validator/api/validationserverAPI.php`, {
    params: { val_id: valId, store_id: cfg.storeId, store_passwd: cfg.storePassword, format: 'json' },
    timeout: 20000,
  });
  return data; // { status: 'VALID'|'VALIDATED'|'INVALID_TRANSACTION', tran_id, amount, currency, ... }
}

module.exports = { initPayment, validatePayment, getConfig };
