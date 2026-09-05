const express = require('express');
const router = express.Router();
const supabase = require('../../db/client');
const logger = require('../../utils/logger');
const { saveRawEvent } = require('../../db/rawEvents');
const { extractTextFromMessage } = require('../../services/whatsapp/parser');
const { markMessageAsRead } = require('../../services/whatsapp/sender');
const {
  dispatchTextMessage,
  updateDeliveryStatus,
} = require('../../services/messages/dispatcher');
const {
  findOrCreateConversation,
  resolveReservationContext,
} = require('../../services/reservations/lookup');
const { runRulesEngine } = require('../../services/rules/engine');
const { classifyAndDraft } = require('../../services/ai/classifier');
const { handleAiOutcome } = require('../../services/ai/outcomeHandler');
const {
  isConversationAutomationPaused,
} = require('../../services/conversations/automation');

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
    logger.warn('Webhook verification failed: missing query parameters', {
      mode,
      tokenProvided: Boolean(token),
      challengeProvided: Boolean(challenge),
    });
    return res.status(400).send();
  }

  logger.info('Webhook verification request received', {
    mode,
    tokenProvided: true,
  });

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
            recipientPhoneSuffix: String(status.recipient_id ?? '').slice(-4),
            timestamp: status.timestamp,
          });
          await updateDeliveryStatus(status).catch((err) =>
            logger.error('Failed to persist WhatsApp message status', {
              waMessageId: status.id,
              status: status.status,
              error: err.message,
            })
          );
        }

        // --- Inbound user messages ----------------------------------------
        for (const message of value.messages ?? []) {
          logger.info('Inbound message received', {
            waMessageId: message.id,
            senderPhoneSuffix: String(message.from ?? '').slice(-4),
            type: message.type,
            timestamp: message.timestamp,
          });

          // Dispatch to the message processor (non-blocking)
          processInboundMessage(message).catch((err) =>
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
// updateConversationAiState  —  store LLM classification and draft for review
// ---------------------------------------------------------------------------
async function updateConversationAiState(
  conversationId,
  classification,
  draft,
  inboundMessageId
) {
  const { error } = await supabase
    .from('conversations')
    .update({
      ai_classification: classification,
      ai_draft: draft,
      ai_action_status: 'classified',
      ai_last_message_id: inboundMessageId,
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
//   Phase 5 ✅ AI replies and escalation integration
// ---------------------------------------------------------------------------
async function processInboundMessage(message) {
  const from        = message.from;
  const messageType = message.type;
  const textContent = extractTextFromMessage(message);

  logger.info('Processing inbound message', {
    senderPhoneSuffix: String(from ?? '').slice(-4),
    messageType,
  });

  // Phase 3: phone first, then verified Booking ID, then provisional guest-name
  // fallback. Explicit name-only matches never expose reservation context.
  const reservationResolution = await resolveReservationContext({
    phoneNumber: from,
    messageText: textContent,
  });
  const reservationContext = reservationResolution.reservationContext;
  const reservationId = reservationContext?.reservation?.id ?? null;

  // Reuse an active unlinked conversation when a later Booking ID verifies it.
  const conversation = await findOrCreateConversation(from, reservationId, {
    status: reservationResolution.match.status,
    method: reservationResolution.match.method,
    candidateReservationId: reservationResolution.candidateReservationId,
  });

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
    reservationMatchStatus: reservationResolution.match.status,
    reservationMatchMethod: reservationResolution.match.method,
    reservationMatchReason: reservationResolution.match.reason,
    messageId: savedMessage?.id ?? null,
    messageType,
    hasText: Boolean(textContent),
  });

  // Duplicate webhook delivery — message already stored; skip response pipeline
  if (!savedMessage) {
    return;
  }

  // Human handover/manual mode owns the conversation. Keep storing inbound
  // messages and read receipts, but do not run rules or AI auto-replies.
  if (isConversationAutomationPaused(conversation)) {
    logger.info('Automation skipped for human-owned conversation', {
      conversationId: conversation.id,
      status: conversation.status,
      assignedTo: conversation.assigned_to ?? null,
      inboundMessageId: savedMessage.id,
    });
    return;
  }

  // Phase 4: deterministic rules first, then AI for anything unhandled
  const reservation = reservationContext?.reservation ?? null;
  const apartment = reservationContext?.apartment
    ? { ...reservationContext.apartment, policy: reservationContext.policy ?? null }
    : null;
  const aiContext = reservationContext ?? {
    identity_verification: {
      status: reservationResolution.match.status,
      method: reservationResolution.match.method,
      reason: reservationResolution.match.reason,
    },
  };

  const rulesResult = await runRulesEngine(textContent, reservation, apartment);

  if (rulesResult.outcome === 'auto_reply' && rulesResult.reply) {
    try {
      const dispatched = await dispatchTextMessage({
        conversationId: conversation.id,
        to: from,
        content: rulesResult.reply,
        source: 'system',
      });

      logger.info('Rules engine auto-reply sent', {
        conversationId: conversation.id,
        waMessageId: dispatched.waMessageId,
      });
    } catch (err) {
      logger.error('Failed to send or persist rules engine auto-reply', {
        conversationId: conversation.id,
        error: err.message,
      });
    }

    return;
  }

  if (rulesResult.outcome === 'human_handover') {
    try {
      const outcome = await handleAiOutcome({
        conversation,
        aiResult: { classification: 'human_handover', draft: null },
        reservationContext: aiContext,
        inboundMessageId: savedMessage.id,
        handoverReason: rulesResult.reason,
        maintenanceIssue:
          rulesResult.reason === 'maintenance issue'
            ? {
                description: textContent,
                apartmentId:
                  reservationContext?.reservation?.id &&
                  reservationContext?.apartment?.id
                    ? reservationContext.apartment.id
                    : null,
              }
            : null,
      });

      logger.info('Rules engine human handover completed', {
        conversationId: conversation.id,
        reason: rulesResult.reason ?? null,
        action: outcome.action,
      });
    } catch (err) {
      logger.error('Failed to handle rules engine human handover', {
        conversationId: conversation.id,
        reason: rulesResult.reason ?? null,
        error: err.message,
      });
    }
    return;
  }

  let aiResult;
  try {
    aiResult = await classifyAndDraft(textContent, aiContext);
  } catch (err) {
    logger.error('Failed to classify inbound message', {
      conversationId: conversation.id,
      error: err.message,
    });
    aiResult = {
      classification: 'human_handover',
      draft: null,
    };
  }

  try {
    await updateConversationAiState(
      conversation.id,
      aiResult.classification,
      aiResult.draft,
      savedMessage.id
    );
  } catch (err) {
    // The guest response/handover must continue even when dashboard AI metadata fails.
    logger.error('Failed to persist conversation AI state', {
      conversationId: conversation.id,
      error: err.message,
    });
  }

  try {
    const outcome = await handleAiOutcome({
      conversation,
      aiResult,
      reservationContext: aiContext,
      inboundMessageId: savedMessage.id,
    });

    logger.info('AI classification outcome handled', {
      conversationId: conversation.id,
      classification: aiResult.classification,
      action: outcome.action,
    });
  } catch (err) {
    logger.error('Failed to handle AI outcome', {
      conversationId: conversation.id,
      classification: aiResult.classification,
      error: err.message,
    });
  }
}

module.exports = router;
