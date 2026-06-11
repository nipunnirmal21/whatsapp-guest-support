const express = require('express');
const router = express.Router();
const logger = require('../../utils/logger');
const { saveRawEvent } = require('../../db/rawEvents');

// ---------------------------------------------------------------------------
// GET /webhooks/whatsapp  —  Meta webhook verification handshake
// ---------------------------------------------------------------------------
// Meta sends three query params:
//   hub.mode         = "subscribe"
//   hub.verify_token = the secret string you set in the Meta dashboard
//   hub.challenge    = a random string Meta wants echoed back as plain text
// ---------------------------------------------------------------------------
router.get('/', (req, res) => {
  const mode      = req.query['hub.mode'];
  const token     = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  logger.info('Webhook verification request received', { mode, token });

  if (mode !== 'subscribe') {
    logger.warn('Webhook verification failed: unexpected mode', { mode });
    return res.status(403).json({ error: 'Invalid hub.mode' });
  }

  if (token !== process.env.WEBHOOK_VERIFY_TOKEN) {
    logger.warn('Webhook verification failed: token mismatch');
    return res.status(403).json({ error: 'Verification token mismatch' });
  }

  logger.info('Webhook verified successfully');
  // Meta requires a plain-text 200 response containing only the challenge value
  return res.status(200).send(challenge);
});

// ---------------------------------------------------------------------------
// POST /webhooks/whatsapp  —  Receive inbound messages and status updates
// ---------------------------------------------------------------------------
// Meta delivers every event here: inbound text/media messages, message status
// updates (sent, delivered, read, failed), and other notifications.
//
// IMPORTANT: Always respond 200 immediately. If you return anything else,
// Meta will retry the delivery repeatedly. Do all heavy processing async.
// ---------------------------------------------------------------------------
router.post('/', async (req, res) => {
  // Acknowledge immediately so Meta does not retry
  res.status(200).send('EVENT_RECEIVED');

  const body = req.body;

  // Guard: only process WhatsApp Business Account events
  if (body.object !== 'whatsapp_business_account') {
    logger.warn('Received non-WhatsApp webhook event', { object: body.object });
    return;
  }

  try {
    // Persist raw payload for audit / debugging (fire-and-forget)
    await saveRawEvent(body).catch((err) =>
      logger.error('Failed to persist raw webhook event', { err: err.message })
    );

    // Walk through every entry and every change in the payload
    for (const entry of body.entry ?? []) {
      for (const change of entry.changes ?? []) {
        if (change.field !== 'messages') continue;

        const value = change.value;

        // --- Status updates (sent / delivered / read / failed) -----------
        for (const status of value.statuses ?? []) {
          logger.info('Message status update', {
            waMessageId: status.id,
            status: status.status,
            recipientPhone: status.recipient_id,
            timestamp: status.timestamp,
          });
          // TODO (Phase 3): update outbound message record in DB
        }

        // --- Inbound user messages ----------------------------------------
        for (const message of value.messages ?? []) {
          const contact = (value.contacts ?? []).find(
            (c) => c.wa_id === message.from
          );

          logger.info('Inbound message received', {
            waMessageId: message.id,
            from: message.from,
            type: message.type,
            displayName: contact?.profile?.name,
            timestamp: message.timestamp,
          });

          // Dispatch to the message processor (non-blocking)
          processInboundMessage(message, contact, value).catch((err) =>
            logger.error('Error processing inbound message', {
              waMessageId: message.id,
              error: err.message,
            })
          );
        }
      }
    }
  } catch (err) {
    logger.error('Unhandled error in webhook POST handler', {
      error: err.message,
      stack: err.stack,
    });
  }
});

// ---------------------------------------------------------------------------
// processInboundMessage  —  async pipeline (stubbed for Phase 2)
// ---------------------------------------------------------------------------
// Each phase will flesh out one step of this pipeline:
//   Phase 3 → guest / reservation lookup
//   Phase 4 → rules engine + AI layer
//   Phase 5 → escalation / dashboard integration
// ---------------------------------------------------------------------------
async function processInboundMessage(message, contact, value) {
  const from        = message.from;          // sender's phone number (E.164)
  const messageType = message.type;          // text | image | audio | document | …
  const displayName = contact?.profile?.name ?? 'Guest';

  logger.info('Processing inbound message', { from, messageType, displayName });

  // Extract plain text (only text messages in Phase 2)
  let textContent = null;
  if (messageType === 'text') {
    textContent = message.text?.body ?? '';
  }

  // TODO (Phase 3): find or create conversation, match reservation
  // TODO (Phase 4): run rules engine, call AI if needed
  // TODO (Phase 5): escalate or send response

  logger.info('Message queued for processing (pipeline stubs in place)', {
    from,
    messageType,
    textContent,
  });
}

module.exports = router;
