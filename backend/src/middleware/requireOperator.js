const logger = require('../utils/logger');
const { ALLOWED_DASHBOARD_ROLES } = require('./auth');

/**
 * Confirms that the global dashboard-auth middleware resolved an authorized
 * operator. Identity is server-derived from the validated Supabase session;
 * browser-supplied operator headers are intentionally ignored.
 */
function requireOperator(req, res, next) {
  const role = typeof req.operator?.role === 'string'
    ? req.operator.role.trim().toLowerCase()
    : '';

  if (!req.operator?.id) {
    logger.warn('Operator action reached route without authenticated identity', {
      path: req.originalUrl,
      method: req.method,
    });
    return res.status(401).json({
      success: false,
      error: 'Unauthorized — operator login is required',
    });
  }

  if (!ALLOWED_DASHBOARD_ROLES.has(role)) {
    return res.status(403).json({
      success: false,
      error: 'Forbidden — operator role is not authorized',
    });
  }

  return next();
}

module.exports = requireOperator;
