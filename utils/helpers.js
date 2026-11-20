const jwt = require('jsonwebtoken');
const AuditLog = require('../models/AuditLog');

exports.asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

exports.signToken = (user) =>
  jwt.sign({ id: user._id, role: user.role }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  });

exports.slugify = (str) =>
  String(str)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');

exports.audit = (req, action, entity, entityId, meta = {}) =>
  AuditLog.create({
    user: req.user?._id,
    userName: req.user?.name,
    role: req.user?.role,
    action,
    entity,
    entityId: entityId ? String(entityId) : undefined,
    meta,
    ip: req.ip,
  }).catch(() => {});

exports.paginate = (req, defaultLimit = 12) => {
  const page = Math.max(parseInt(req.query.page) || 1, 1);
  const limit = Math.min(Math.max(parseInt(req.query.limit) || defaultLimit, 1), 100);
  return { page, limit, skip: (page - 1) * limit };
};

exports.httpError = (status, message) => {
  const e = new Error(message);
  e.status = status;
  return e;
};
