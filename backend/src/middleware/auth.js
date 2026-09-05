const logger = require('../utils/logger');

const ALLOWED_DASHBOARD_ROLES = new Set(['operator', 'supervisor', 'admin']);
const MAX_BEARER_TOKEN_LENGTH = 8192;

function extractBearerToken(authorizationHeader) {
  if (typeof authorizationHeader !== 'string') return null;

  const match = authorizationHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;

  const token = match[1].trim();
  if (!token || token.length > MAX_BEARER_TOKEN_LENGTH) return null;
  return token;
}

function createDashboardAuth({ getUserByToken, findOperatorByAuthUserId, logger: authLogger }) {
  return async function requireDashboardAuth(req, res, next) {
    const token = extractBearerToken(req.headers.authorization);

    if (!token) {
      authLogger.warn('Dashboard API request missing Bearer authentication', {
        path: req.originalUrl,
        method: req.method,
      });
      return res.status(401).json({
        success: false,
        error: 'Unauthorized — a valid login session is required',
      });
    }

    let user;
    try {
      const result = await getUserByToken(token);
      if (result?.error || !result?.data?.user) {
        authLogger.warn('Dashboard API request used an invalid or expired session', {
          path: req.originalUrl,
          method: req.method,
        });
        return res.status(401).json({
          success: false,
          error: 'Unauthorized — session is invalid or expired',
        });
      }
      user = result.data.user;
    } catch (error) {
      authLogger.error('Supabase Auth token validation failed', {
        path: req.originalUrl,
        method: req.method,
        error: error.message,
      });
      return res.status(401).json({
        success: false,
        error: 'Unauthorized — session could not be validated',
      });
    }

    let operatorResult;
    try {
      operatorResult = await findOperatorByAuthUserId(user.id);
    } catch (error) {
      authLogger.error('Dashboard operator lookup failed', {
        authUserId: user.id,
        error: error.message,
      });
      return res.status(500).json({
        success: false,
        error: 'Dashboard authentication is not configured correctly',
      });
    }

    if (operatorResult?.error) {
      authLogger.error('Dashboard operator lookup failed', {
        authUserId: user.id,
        error: operatorResult.error.message,
        code: operatorResult.error.code,
      });
      return res.status(500).json({
        success: false,
        error: 'Dashboard authentication is not configured correctly',
      });
    }

    const operator = operatorResult?.data ?? null;
    const role = typeof operator?.role === 'string'
      ? operator.role.trim().toLowerCase()
      : '';

    if (!operator || !ALLOWED_DASHBOARD_ROLES.has(role)) {
      authLogger.warn('Authenticated Supabase user is not authorized for the dashboard', {
        authUserId: user.id,
      });
      return res.status(403).json({
        success: false,
        error: 'Forbidden — this account is not authorized for the dashboard',
      });
    }

    req.authUser = {
      id: user.id,
      email: user.email ?? null,
    };
    req.operator = {
      id: operator.id,
      authUserId: user.id,
      email: user.email ?? operator.email,
      name: operator.name,
      role,
    };

    return next();
  };
}

let defaultMiddleware;

function getDefaultMiddleware() {
  if (defaultMiddleware) return defaultMiddleware;

  const supabase = require('../db/client');

  defaultMiddleware = createDashboardAuth({
    logger,
    getUserByToken: (token) => supabase.auth.getUser(token),
    findOperatorByAuthUserId: (authUserId) =>
      supabase
        .from('admin_users')
        .select('id, auth_user_id, name, email, role')
        .eq('auth_user_id', authUserId)
        .maybeSingle(),
  });

  return defaultMiddleware;
}

module.exports = (...args) => getDefaultMiddleware()(...args);
module.exports.ALLOWED_DASHBOARD_ROLES = ALLOWED_DASHBOARD_ROLES;
module.exports.createDashboardAuth = createDashboardAuth;
module.exports.extractBearerToken = extractBearerToken;
