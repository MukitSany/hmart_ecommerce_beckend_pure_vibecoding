const mongoose = require('mongoose');

// Single-document site configuration (key = "site")
const settingSchema = new mongoose.Schema(
  {
    key: { type: String, default: 'site', unique: true },
    siteName: { type: String, default: 'Hmart' },
    tagline: { type: String, default: 'Your Home Smart Devices & Best Solution' },
    logo: String,
    contactEmail: { type: String, default: 'support@hmart.example' },
    contactPhone: { type: String, default: '+880 1234 567890' },
    address: { type: String, default: 'Dhaka, Bangladesh' },
    topBarText: { type: String, default: 'World Wide Completely Free Returns and Shipping' },
    currency: { type: String, default: 'BDT' },
    currencySymbol: { type: String, default: '৳' },
    shippingFee: { type: Number, default: 80 },
    freeShippingThreshold: { type: Number, default: 5000 },
    taxRate: { type: Number, default: 0 },
    allowCOD: { type: Boolean, default: true },
    allowRegistration: { type: Boolean, default: true },
    maintenanceMode: { type: Boolean, default: false },
    maintenanceMessage: { type: String, default: 'We are performing scheduled maintenance. Please check back soon.' },
    social: {
      facebook: String,
      twitter: String,
      instagram: String,
      youtube: String,
    },
    seo: { title: String, description: String },
  },
  { timestamps: true }
);

settingSchema.statics.get = async function () {
  let s = await this.findOne({ key: 'site' });
  if (!s) s = await this.create({ key: 'site' });
  return s;
};

module.exports = mongoose.model('Setting', settingSchema);
