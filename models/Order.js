const mongoose = require('mongoose');

const orderItemSchema = new mongoose.Schema({
  product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  name: String,
  image: String,
  sku: String,
  price: { type: Number, required: true },
  qty: { type: Number, required: true, min: 1 },
});

const orderSchema = new mongoose.Schema(
  {
    orderNo: { type: String, unique: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    items: [orderItemSchema],
    shippingAddress: {
      name: String,
      phone: String,
      email: String,
      address: String,
      city: String,
      postcode: String,
      country: { type: String, default: 'Bangladesh' },
    },
    subtotal: Number,
    shippingFee: { type: Number, default: 0 },
    tax: { type: Number, default: 0 },
    discount: { type: Number, default: 0 },
    couponCode: String,
    total: { type: Number, required: true },
    currency: { type: String, default: 'BDT' },

    paymentMethod: { type: String, enum: ['sslcommerz', 'cod'], default: 'sslcommerz' },
    paymentStatus: {
      type: String,
      enum: ['pending', 'paid', 'failed', 'cancelled', 'refunded'],
      default: 'pending',
    },
    tranId: { type: String, index: true },
    valId: String,
    paymentDetails: mongoose.Schema.Types.Mixed,
    paidAt: Date,

    status: {
      type: String,
      enum: ['pending', 'processing', 'packed', 'shipped', 'delivered', 'cancelled', 'returned'],
      default: 'pending',
    },
    trackingNumber: String,
    courier: String,
    note: String,
    stockRestored: { type: Boolean, default: false },
    statusHistory: [
      {
        status: String,
        note: String,
        by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        at: { type: Date, default: Date.now },
      },
    ],
  },
  { timestamps: true }
);

orderSchema.pre('validate', function (next) {
  if (!this.orderNo) {
    this.orderNo = 'HM' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 5).toUpperCase();
  }
  next();
});

module.exports = mongoose.model('Order', orderSchema);
