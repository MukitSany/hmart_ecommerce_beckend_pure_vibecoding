const mongoose = require('mongoose');

const couponSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true, uppercase: true, trim: true },
    description: String,
    type: { type: String, enum: ['percent', 'fixed'], default: 'percent' },
    value: { type: Number, required: true, min: 0 },
    minOrder: { type: Number, default: 0 },
    maxDiscount: Number,
    startsAt: Date,
    expiresAt: Date,
    usageLimit: Number,
    usedCount: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

// Banners / hero sliders / promo banners / flash sales shown on the storefront
const campaignSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    subtitle: String,
    image: String,
    link: { type: String, default: '/shop' },
    buttonText: { type: String, default: 'Shop Now' },
    placement: { type: String, enum: ['hero', 'promo', 'featured'], default: 'promo' },
    priceText: String,
    startsAt: Date,
    endsAt: Date,
    sortOrder: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

module.exports = {
  Coupon: mongoose.model('Coupon', couponSchema),
  Campaign: mongoose.model('Campaign', campaignSchema),
};
