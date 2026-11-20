const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { asyncHandler, httpError } = require('../utils/helpers');

// Requires a valid JWT. Attaches req.user.
exports.protect = asyncHandler(async (req, res, next) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) throw httpError(401, 'Not authenticated');

  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    throw httpError(401, 'Invalid or expired token');
  }
  const user = await User.findById(decoded.id);
  if (!user) throw httpError(401, 'User no longer exists');
  if (!user.isActive) throw httpError(403, 'Your account has been deactivated');
  req.user = user;
  next();
});

// Optional auth: attaches req.user if a valid token is present, never fails.
exports.optionalAuth = asyncHandler(async (req, res, next) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (token) {
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findById(decoded.id);
      if (user && user.isActive) req.user = user;
    } catch {
      /* ignore */
    }
  }
  next();
});

// Role guard: authorize('admin'), authorize('merchandiser', 'admin')
exports.authorize =
  (...roles) =>
  (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return next(httpError(403, 'You do not have access to this resource'));
    }
    next();
  };

// Merchandiser permission guard (catalog | inventory | orders | marketing). Admin bypasses.
exports.requirePermission =
  (permission) =>
  (req, res, next) => {
    if (!req.user) return next(httpError(401, 'Not authenticated'));
    if (req.user.role === 'admin') return next();
    if (req.user.role === 'merchandiser' && req.user.permissions.includes(permission)) return next();
    next(httpError(403, `Missing permission: ${permission}`));
  };
