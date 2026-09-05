const logger = require('../utils/logger');

/**
 * Centralised error-handling middleware.
 * Express requires the 4-argument signature to treat it as an error handler.
 */
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  const status = err.status || err.statusCode || 500;
  const message = err.message || 'Internal Server Error';
  const publicMessage =
    process.env.NODE_ENV === 'production' && Number(status) >= 500
      ? 'Internal Server Error'
      : message;

  logger.error(message, {
    status,
    stack: err.stack,
    path: req.path,
    method: req.method,
  });

  res.status(status).json({
    success: false,
    error: publicMessage,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
}

module.exports = errorHandler;
