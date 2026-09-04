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

const ACTIVE_ESCALATION_STATUSES = ['pending', 'acknowledged'];
const HUMAN_HANDOVER_MESSAGE =
  'Thanks. I’ve passed this to our support team and someone will assist you shortly.';
const CLARIFICATION_FALLBACK_MESSAGE =
  'Could you please share a few more details so we can help you?';

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
<<<<<<< Updated upstream
          processInboundMessage(message, contact).catch((err) =>
=======
          processInboundMessage(message).catch((err) =>
>>>>>>> Stashed changes
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
// sendAndSaveReply  —  persist only after WhatsApp accepts the send request
// ---------------------------------------------------------------------------
async function sendAndSaveReply(conversationId, to, content, source) {
  let sendResult;

  try {
    sendResult = await sendTextMessage(to, content);
  } catch (err) {
    logger.error('Failed to send outbound WhatsApp reply', {
      conversationId,
      source,
      error: err.message,
    });
    return { sent: false, persisted: false };
  }

  const waMessageId = sendResult?.messages?.[0]?.id ?? null;

  try {
    await saveOutboundMessage(conversationId, content, waMessageId, source);
  } catch (err) {
    logger.error('WhatsApp reply sent but outbound message persistence failed', {
      conversationId,
      source,
      waMessageId,
      error: err.message,
    });
    return { sent: true, persisted: false, waMessageId };
  }

  logger.info('Outbound WhatsApp reply sent and persisted', {
    conversationId,
    source,
    waMessageId,
  });

  return { sent: true, persisted: true, waMessageId };
}

// ---------------------------------------------------------------------------
// ensureActiveEscalation  —  create one open handover per conversation
// ---------------------------------------------------------------------------
async function ensureActiveEscalation(conversationId, reason) {
  const { data: existing, error: findError } = await supabase
    .from('escalations')
    .select('id, status')
    .eq('conversation_id', conversationId)
    .in('status', ACTIVE_ESCALATION_STATUSES)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (findError) {
    throw new Error(`Failed to check active escalations: ${findError.message}`);
  }

  if (existing) {
    const { error: updateError } = await supabase
      .from('conversations')
      .update({ status: 'escalated' })
      .eq('id', conversationId);

    if (updateError) {
      throw new Error(`Failed to mark conversation as escalated: ${updateError.message}`);
    }

    logger.info('Reused active conversation escalation', {
      conversationId,
      escalationId: existing.id,
      escalationStatus: existing.status,
    });

    return { escalation: existing, created: false };
  }

  const { data: escalation, error: escalationError } = await supabase
    .from('escalations')
    .insert({
      conversation_id: conversationId,
      reason,
      status: 'pending',
    })
    .select('id, status')
    .single();

  if (escalationError) {
    throw new Error(`Failed to create escalation: ${escalationError.message}`);
  }

  const { error: updateError } = await supabase
    .from('conversations')
    .update({ status: 'escalated' })
    .eq('id', conversationId);

  if (updateError) {
    throw new Error(`Failed to mark conversation as escalated: ${updateError.message}`);
  }

  logger.info('Created active conversation escalation', {
    conversationId,
    escalationId: escalation.id,
  });

  return { escalation, created: true };
}

async function handOverToHuman(conversationId, to, reason) {
  try {
    await ensureActiveEscalation(conversationId, reason);
  } catch (err) {
    logger.error('Failed to complete human handover', {
      conversationId,
      error: err.message,
    });
    return;
  }

  await sendAndSaveReply(
    conversationId,
    to,
    HUMAN_HANDOVER_MESSAGE,
    'system'
  );
}

// ---------------------------------------------------------------------------
// processInboundMessage  —  async pipeline
// ---------------------------------------------------------------------------
//   Phase 3 ✅ guest / reservation lookup, conversation storage
//   Phase 4 ✅ rules engine + AI layer
//   Phase 5 ✅ AI replies and escalation integration
// ---------------------------------------------------------------------------
<<<<<<< Updated upstream
async function processInboundMessage(message, contact) {
=======
async function processInboundMessage(message) {
>>>>>>> Stashed changes
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
<<<<<<< Updated upstream
    reservationMatchStatus: reservationResolution.match.status,
    reservationMatchMethod: reservationResolution.match.method,
    reservationMatchReason: reservationResolution.match.reason,
    guestName: reservationContext?.guest?.full_name ?? displayName,
    apartmentName: reservationContext?.apartment?.name ?? null,
=======
>>>>>>> Stashed changes
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

  const rulesResult = await runRulesEngine(textContent, reservation, apartment);

  if (rulesResult.outcome === 'auto_reply' && rulesResult.reply) {
<<<<<<< Updated upstream
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
=======
    await sendAndSaveReply(
      conversation.id,
      from,
      rulesResult.reply,
      'system'
    );
>>>>>>> Stashed changes

    return;
  }

<<<<<<< Updated upstream
  try {
    const aiContext = reservationContext ?? {
      identity_verification: {
        status: reservationResolution.match.status,
        method: reservationResolution.match.method,
        reason: reservationResolution.match.reason,
      },
    };
    const aiResult = await classifyAndDraft(textContent, aiContext);
=======
  if (rulesResult.outcome === 'human_handover') {
    await handOverToHuman(
      conversation.id,
      from,
      rulesResult.reason ?? 'deterministic rules requested human handover'
    );
    return;
  }
>>>>>>> Stashed changes

  let aiResult;
  try {
    aiResult = await classifyAndDraft(textContent, reservationContext ?? {});
  } catch (err) {
    logger.error('Failed to classify inbound message', {
      conversationId: conversation.id,
      error: err.message,
    });
    aiResult = {
      classification: 'human_handover',
      draft: HUMAN_HANDOVER_MESSAGE,
    };
  }

  try {
    await updateConversationAiState(
      conversation.id,
      aiResult.classification,
      aiResult.draft,
      savedMessage.id
    );
<<<<<<< Updated upstream

    logger.info('Conversation updated with AI classification', {
      conversationId: conversation.id,
      classification: aiResult.classification,
      hasDraft: Boolean(aiResult.draft),
    });

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
    logger.error('Failed to classify message or handle AI outcome', {
=======
  } catch (err) {
    // The guest response/handover must continue even when dashboard AI metadata fails.
    logger.error('Failed to persist conversation AI state', {
>>>>>>> Stashed changes
      conversationId: conversation.id,
      error: err.message,
    });
  }
<<<<<<< Updated upstream
=======

  logger.info('AI decision ready for action', {
    conversationId: conversation.id,
    classification: aiResult.classification,
    hasDraft: Boolean(aiResult.draft),
  });

  if (aiResult.classification === 'safe_reply') {
    await sendAndSaveReply(conversation.id, from, aiResult.draft, 'ai');
    return;
  }

  if (aiResult.classification === 'clarification_needed') {
    await sendAndSaveReply(
      conversation.id,
      from,
      aiResult.draft ?? CLARIFICATION_FALLBACK_MESSAGE,
      'ai'
    );
    return;
  }

  await handOverToHuman(
    conversation.id,
    from,
    'AI classified inbound message for human handover'
  );
>>>>>>> Stashed changes
}

module.exports = router;
