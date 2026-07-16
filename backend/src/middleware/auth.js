const crypto = require('crypto');
const logger = require('../utils/logger');

/**
 * Dashboard API key authentication.
 *
 * Expects the key in one of:
 *   - Header: X-API-Key: <key>
 *   - Header: Authorization: Bearer <key>
 *
 * Compared against process.env.DASHBOARD_API_KEY using a timing-safe check.
 * Apply only to /api/* routes — never to /webhooks/whatsapp.
 */
function requireDashboardAuth(req, res, next) {
  const configuredKey = process.env.DASHBOARD_API_KEY;

  if (!configuredKey) {
    logger.error('DASHBOARD_API_KEY is not configured — rejecting API request');
    return res.status(500).json({
      success: false,
      error: 'Server misconfiguration',
    });
  }

  const headerKey = req.headers['x-api-key'];
  const authHeader = req.headers.authorization;
  const bearerKey =
    typeof authHeader === 'string' && authHeader.startsWith('Bearer ')
      ? authHeader.slice(7).trim()
      : null;

  const providedKey =
    (typeof headerKey === 'string' && headerKey.trim()) || bearerKey || null;

  if (!providedKey) {
    logger.warn('Dashboard API request missing API key', {
      path: req.originalUrl,
      method: req.method,
    });
    return res.status(401).json({
      success: false,
      error: 'Unauthorized — missing API key',
    });
  }

  const providedBuffer = Buffer.from(providedKey);
  const expectedBuffer = Buffer.from(configuredKey);

  const keysMatch =
    providedBuffer.length === expectedBuffer.length &&
    crypto.timingSafeEqual(providedBuffer, expectedBuffer);

  if (!keysMatch) {
    logger.warn('Dashboard API request with invalid API key', {
      path: req.originalUrl,
      method: req.method,
    });
    return res.status(401).json({
      success: false,
      error: 'Unauthorized — invalid API key',
    });
  }

  next();
}

module.exports = requireDashboardAuth;
