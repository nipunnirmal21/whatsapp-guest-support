const crypto = require('crypto');
const logger = require('../utils/logger');

/**
 * Validates the X-Hub-Signature-256 header on incoming Meta webhook POSTs.
 * Meta signs every payload with your APP_SECRET using HMAC-SHA256.
 *
 * Attach this BEFORE express.json() on the webhook route so the raw body
 * is still available.  We capture the raw buffer via express.raw().
 */
function validateWebhookSignature(req, res, next) {
  const signature = req.headers['x-hub-signature-256'];

  if (!signature) {
    logger.warn('Webhook request missing X-Hub-Signature-256 header');
    return res.status(403).json({ error: 'Missing signature header' });
  }

  const appSecret = process.env.META_APP_SECRET;
  if (!appSecret) {
    logger.error('META_APP_SECRET not set – cannot validate webhook signature');
    return res.status(500).json({ error: 'Server misconfiguration' });
  }

  const expectedSig =
    'sha256=' +
    crypto
      .createHmac('sha256', appSecret)
      .update(req.rawBody)
      .digest('hex');

  const sigBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSig);

  if (
    sigBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(sigBuffer, expectedBuffer)
  ) {
    logger.warn('Webhook signature mismatch', { received: signature });
    return res.status(403).json({ error: 'Invalid signature' });
  }

  next();
}

module.exports = validateWebhookSignature;
