const express = require('express');
const router = express.Router();
const supabase = require('../../db/client');
const logger = require('../../utils/logger');
const { saveRawEvent } = require('../../db/rawEvents');
const { extractTextFromMessage } = require('../../services/whatsapp/parser');
const { markMessageAsRead, sendTextMessage } = require('../../services/whatsapp/sender');
const {
  findReservationByPhone,
  findOrCreateConversation,
} = require('../../services/reservations/lookup');
const { runRulesEngine } = require('../../services/rules/engine');
const { classifyAndDraft } = require('../../services/ai/classifier');

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

  if (!mode || !token || !challenge) {
    logger.warn('Webhook verification failed: missing query parameters', { mode, token, challenge });
    return res.status(400).send();
  }

  logger.info('Webhook verification request received', { mode, token });

  if (mode !== 'subscribe' || token !== process.env.WEBHOOK_VERIFY_TOKEN) {
    logger.warn('Webhook verification failed', { mode, tokenMatch: token === process.env.WEBHOOK_VERIFY_TOKEN });
    return res.status(403).send();
  }

  logger.info('Webhook verified successfully');
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
// saveInboundMessage  —  persist guest message against a conversation
// ---------------------------------------------------------------------------
async function saveInboundMessage(conversationId, message, textContent) {
  const content = textContent ?? `[${message.type}]`;

  const { data, error } = await supabase
    .from('messages')
    .insert({
      conversation_id: conversationId,
      direction: 'inbound',
      source: 'guest',
      content,
      wa_message_id: message.id,
    })
    .select('id')
    .single();

  if (error) {
    // Meta may retry webhooks — treat duplicate wa_message_id as idempotent
    if (error.code === '23505') {
      logger.info('Duplicate inbound message ignored', { waMessageId: message.id });
      return null;
    }

    throw new Error(`Failed to save inbound message: ${error.message}`);
  }

  return data;
}

// ---------------------------------------------------------------------------
// saveOutboundMessage  —  persist an outbound reply against a conversation
// ---------------------------------------------------------------------------
async function saveOutboundMessage(conversationId, content, waMessageId, source) {
  const { data, error } = await supabase
    .from('messages')
    .insert({
      conversation_id: conversationId,
      direction: 'outbound',
      source,
      content,
      wa_message_id: waMessageId,
      delivery_status: waMessageId ? 'sent' : null,
    })
    .select('id')
    .single();

  if (error) {
    throw new Error(`Failed to save outbound message: ${error.message}`);
  }

  return data;
}

// ---------------------------------------------------------------------------
// updateConversationAiState  —  store LLM classification and draft for review
// ---------------------------------------------------------------------------
async function updateConversationAiState(conversationId, classification, draft) {
  const { error } = await supabase
    .from('conversations')
    .update({
      ai_classification: classification,
      ai_draft: draft,
    })
    .eq('id', conversationId);

  if (error) {
    throw new Error(`Failed to update conversation AI state: ${error.message}`);
  }
}

// ---------------------------------------------------------------------------
// processInboundMessage  —  async pipeline
// ---------------------------------------------------------------------------
//   Phase 3 ✅ guest / reservation lookup, conversation storage
//   Phase 4 ✅ rules engine + AI layer
//   Phase 5    escalation / dashboard integration
// ---------------------------------------------------------------------------
async function processInboundMessage(message, contact, value) {
  const from        = message.from;
  const messageType = message.type;
  const displayName = contact?.profile?.name ?? 'Guest';
  const textContent = extractTextFromMessage(message);

  logger.info('Processing inbound message', { from, messageType, displayName });

  // Phase 3: match guest to active reservation by phone number
  const reservationContext = await findReservationByPhone(from);
  const reservationId = reservationContext?.reservation?.id ?? null;

  // Phase 3: find or create the conversation thread for this guest / reservation
  const conversation = await findOrCreateConversation(from, reservationId);

  // Phase 3: store inbound message for audit trail and dashboard inbox
  const savedMessage = await saveInboundMessage(
    conversation.id,
    message,
    textContent
  );

  // Acknowledge receipt to the guest (non-blocking — must not fail the pipeline)
  markMessageAsRead(message.id).catch((err) =>
    logger.warn('Failed to mark message as read', {
      waMessageId: message.id,
      error: err.message,
    })
  );

  logger.info('Inbound message processed (Phase 3 complete)', {
    conversationId: conversation.id,
    reservationId,
    reservationMatched: Boolean(reservationContext),
    guestName: reservationContext?.guest?.full_name ?? displayName,
    apartmentName: reservationContext?.apartment?.name ?? null,
    messageId: savedMessage?.id ?? null,
    messageType,
    hasText: Boolean(textContent),
  });

  // Duplicate webhook delivery — message already stored; skip response pipeline
  if (!savedMessage) {
    return;
  }

  // Phase 4: deterministic rules first, then AI for anything unhandled
  const reservation = reservationContext?.reservation ?? null;
  const apartment = reservationContext?.apartment
    ? { ...reservationContext.apartment, policy: reservationContext.policy ?? null }
    : null;

  const rulesResult = await runRulesEngine(textContent, reservation, apartment);

  if (rulesResult.outcome === 'auto_reply' && rulesResult.reply) {
    try {
      const sendResult = await sendTextMessage(from, rulesResult.reply);
      const waMessageId = sendResult?.messages?.[0]?.id ?? null;

      await saveOutboundMessage(
        conversation.id,
        rulesResult.reply,
        waMessageId,
        'system'
      );

      logger.info('Rules engine auto-reply sent', {
        conversationId: conversation.id,
        waMessageId,
      });
    } catch (err) {
      logger.error('Failed to send or persist rules engine auto-reply', {
        conversationId: conversation.id,
        error: err.message,
      });
    }

    return;
  }

  try {
    const aiResult = await classifyAndDraft(textContent, reservationContext ?? {});

    await updateConversationAiState(
      conversation.id,
      aiResult.classification,
      aiResult.draft
    );

    logger.info('Conversation updated with AI classification', {
      conversationId: conversation.id,
      classification: aiResult.classification,
      hasDraft: Boolean(aiResult.draft),
    });
  } catch (err) {
    logger.error('Failed to classify message or update conversation', {
      conversationId: conversation.id,
      error: err.message,
    });
  }

  // TODO (Phase 5): escalate or send AI draft based on classification
}

module.exports = router;
