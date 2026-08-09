const logger = require('../utils/logger');

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Temporary dashboard operator identity layer.
 *
 * The shared dashboard API key authenticates the application. Mutating
 * handover endpoints additionally require X-Admin-User-Id so actions can be
 * assigned and audited against an admin_users row. The database functions
 * validate that the supplied user exists and enforce role permissions.
 */
function requireOperator(req, res, next) {
  const value = req.headers['x-admin-user-id'];
  const operatorId = typeof value === 'string' ? value.trim() : '';

  if (!operatorId) {
    logger.warn('Handover request missing operator identity', {
      path: req.originalUrl,
      method: req.method,
    });
    return res.status(401).json({
      success: false,
      error: 'Unauthorized - missing X-Admin-User-Id header',
    });
  }

  if (!UUID_RE.test(operatorId)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid X-Admin-User-Id header',
    });
  }

  req.adminUserId = operatorId;
  return next();
}

module.exports = requireOperator;

