const mongoose = require('mongoose');

// Third-party integrations managed by Admin (payment gateway, email, SMS, analytics...)
const integrationSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true }, // e.g. sslcommerz, smtp, sms, analytics
    name: { type: String, required: true },
    description: String,
    enabled: { type: Boolean, default: false },
    config: { type: mongoose.Schema.Types.Mixed, default: {} },
    secretFields: { type: [String], default: [] }, // config keys that are masked in API responses
  },
  { timestamps: true }
);

integrationSchema.methods.toSafe = function () {
  const obj = this.toObject();
  const cfg = { ...(obj.config || {}) };
  for (const f of obj.secretFields || []) {
    if (cfg[f]) cfg[f] = '••••••••';
  }
  obj.config = cfg;
  return obj;
};

module.exports = mongoose.model('Integration', integrationSchema);
