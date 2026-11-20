const Setting = require('../models/Setting');
const jwt = require('jsonwebtoken');

// Block the storefront API while maintenance mode is on (admins & auth/health/settings still work).
exports.maintenanceGuard = async (req, res, next) => {
  try {
    const open = ['/api/health', '/api/settings/public', '/api/auth', '/api/admin', '/api/payment'];
    if (open.some((p) => req.originalUrl.startsWith(p))) return next();

    const s = await Setting.get();
    if (!s.maintenanceMode) return next();

    // allow admin through
    const header = req.headers.authorization || '';
    if (header.startsWith('Bearer ')) {
      try {
        const d = jwt.verify(header.slice(7), process.env.JWT_SECRET);
        if (d.role === 'admin') return next();
      } catch {
        /* fallthrough */
      }
    }
    return res.status(503).json({ message: s.maintenanceMessage, maintenance: true });
  } catch (e) {
    next(e);
  }
};

exports.notFound = (req, res) => res.status(404).json({ message: `Route not found: ${req.method} ${req.originalUrl}` });

// eslint-disable-next-line no-unused-vars
exports.errorHandler = (err, req, res, next) => {
  let status = err.status || 500;
  let message = err.message || 'Server error';

  if (err.name === 'ValidationError') {
    status = 400;
    message = Object.values(err.errors).map((e) => e.message).join(', ');
  } else if (err.code === 11000) {
    status = 409;
    message = `Duplicate value for: ${Object.keys(err.keyValue || {}).join(', ')}`;
  } else if (err.name === 'CastError') {
    status = 400;
    message = `Invalid ${err.path}`;
  }
  if (status >= 500) console.error(err);
  res.status(status).json({ message, ...(process.env.NODE_ENV !== 'production' && status >= 500 ? { stack: err.stack } : {}) });
};
