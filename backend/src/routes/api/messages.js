const express = require('express');
const router = express.Router();
const { sendTextMessage } = require('../../services/whatsapp/sender');
const logger = require('../../utils/logger');

/**
 * POST /api/messages/send
 * Internal endpoint used by the dashboard or automation scripts to
 * send an outbound WhatsApp message.
 *
 * Body: { to: string, text: string }
 */
router.post('/send', async (req, res, next) => {
  try {
    const { to, text } = req.body;

    if (!to || !text) {
      return res.status(400).json({ error: '"to" and "text" are required' });
    }

    const result = await sendTextMessage(to, text);

    logger.info('Outbound message dispatched via API', { to });
    return res.status(200).json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
