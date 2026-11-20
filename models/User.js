const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

// Fine-grained permissions for the Merchandiser role (admin can toggle these)
const MERCH_PERMISSIONS = ['catalog', 'inventory', 'orders', 'marketing'];

const addressSchema = new mongoose.Schema({
  label: { type: String, default: 'Home' },
  name: String,
  phone: String,
  address: String,
  city: String,
  postcode: String,
  country: { type: String, default: 'Bangladesh' },
  isDefault: { type: Boolean, default: false },
});

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    phone: { type: String, trim: true },
    password: { type: String, required: true, minlength: 6, select: false },
    role: { type: String, enum: ['customer', 'merchandiser', 'admin'], default: 'customer' },
    permissions: { type: [String], default: [] },
    isActive: { type: Boolean, default: true },
    addresses: [addressSchema],
    wishlist: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Product' }],
    lastLoginAt: Date,
  },
  { timestamps: true }
);

userSchema.pre('save', async function (next) {
  if (this.isModified('password')) this.password = await bcrypt.hash(this.password, 12);
  if (this.isNew && this.role === 'merchandiser' && this.permissions.length === 0) {
    this.permissions = [...MERCH_PERMISSIONS];
  }
  next();
});

userSchema.methods.matchPassword = function (plain) {
  return bcrypt.compare(plain, this.password);
};

userSchema.statics.MERCH_PERMISSIONS = MERCH_PERMISSIONS;

module.exports = mongoose.model('User', userSchema);
