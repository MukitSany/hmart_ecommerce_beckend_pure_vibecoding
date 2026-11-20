const User = require('../models/User');
const Setting = require('../models/Setting');
const { asyncHandler, signToken, httpError, audit } = require('../utils/helpers');

const publicUser = (u) => ({
  _id: u._id,
  name: u.name,
  email: u.email,
  phone: u.phone,
  role: u.role,
  permissions: u.permissions,
  addresses: u.addresses,
  wishlist: u.wishlist,
});

// Self-registration always creates a CUSTOMER. Merchandisers/admins are created by an admin.
exports.register = asyncHandler(async (req, res) => {
  const settings = await Setting.get();
  if (!settings.allowRegistration) throw httpError(403, 'Registration is currently disabled');

  const { name, email, password, phone } = req.body;
  if (!name || !email || !password) throw httpError(400, 'Name, email and password are required');
  if (password.length < 6) throw httpError(400, 'Password must be at least 6 characters');
  if (await User.findOne({ email: email.toLowerCase() })) throw httpError(409, 'Email already registered');

  const user = await User.create({ name, email, password, phone, role: 'customer' });
  res.status(201).json({ token: signToken(user), user: publicUser(user) });
});

exports.login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) throw httpError(400, 'Email and password are required');

  const user = await User.findOne({ email: email.toLowerCase() }).select('+password');
  if (!user || !(await user.matchPassword(password))) throw httpError(401, 'Invalid email or password');
  if (!user.isActive) throw httpError(403, 'Your account has been deactivated');

  user.lastLoginAt = new Date();
  await user.save();
  req.user = user;
  if (user.role !== 'customer') audit(req, 'auth.login', 'User', user._id);
  res.json({ token: signToken(user), user: publicUser(user) });
});

exports.me = asyncHandler(async (req, res) => {
  res.json({ user: publicUser(req.user) });
});

exports.updateProfile = asyncHandler(async (req, res) => {
  const { name, phone } = req.body;
  if (name) req.user.name = name;
  if (phone !== undefined) req.user.phone = phone;
  await req.user.save();
  res.json({ user: publicUser(req.user) });
});

exports.changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!newPassword || newPassword.length < 6) throw httpError(400, 'New password must be at least 6 characters');
  const user = await User.findById(req.user._id).select('+password');
  if (!(await user.matchPassword(currentPassword || ''))) throw httpError(400, 'Current password is incorrect');
  user.password = newPassword;
  await user.save();
  audit(req, 'auth.password_change', 'User', user._id);
  res.json({ message: 'Password updated' });
});
