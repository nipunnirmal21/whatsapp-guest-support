const MAX_FAILURE_REASON_LENGTH = 1000;
const MAX_STATUS_JSON_LENGTH = 16000;
const WHATSAPP_DELIVERY_STATUSES = new Set([
  'sent',
  'delivered',
  'read',
  'failed',
]);

function serialiseFailureReason(error) {
  const detail = error?.response?.data ?? error?.message ?? error;

  let text;
  try {
    text = typeof detail === 'string' ? detail : JSON.stringify(detail);
  } catch {
    text = String(detail);
  }

  return (text || 'Unknown outbound message failure').slice(
    0,
    MAX_FAILURE_REASON_LENGTH
  );
}

function normaliseProviderTimestamp(value) {
  if (value === null || value === undefined || value === '') return null;

  const numericValue = Number(value);
  if (!Number.isFinite(numericValue) || numericValue <= 0) return null;

  const milliseconds = numericValue > 1e12 ? numericValue : numericValue * 1000;
  const date = new Date(milliseconds);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function toSafeJson(value) {
  if (value === null || value === undefined) return null;

  try {
    const json = JSON.stringify(value);
    if (json.length <= MAX_STATUS_JSON_LENGTH) return JSON.parse(json);
    return {
      truncated: true,
      summary: json.slice(0, MAX_STATUS_JSON_LENGTH),
    };
  } catch {
    return { summary: String(value).slice(0, MAX_STATUS_JSON_LENGTH) };
  }
}

function extractFailureMetadata(statusEvent) {
  if (statusEvent?.status !== 'failed') {
    return { failureCode: null, failureReason: null, failureDetails: null };
  }

  const errors = Array.isArray(statusEvent.errors)
    ? statusEvent.errors
    : statusEvent.errors
      ? [statusEvent.errors]
      : [];
  const primaryError = errors[0] ?? null;

  return {
    failureCode:
      primaryError?.code === null || primaryError?.code === undefined
        ? null
        : String(primaryError.code),
    failureReason: serialiseFailureReason(
      errors.length > 0 ? errors : 'WhatsApp reported a delivery failure'
    ),
    failureDetails: toSafeJson(primaryError ?? errors),
  };
}

function buildStatusPayload(statusEvent) {
  return toSafeJson({
    id: statusEvent.id,
    status: statusEvent.status,
    timestamp: statusEvent.timestamp ?? null,
    recipient_id: statusEvent.recipient_id ?? null,
    conversation: statusEvent.conversation ?? null,
    pricing: statusEvent.pricing ?? null,
    errors: statusEvent.errors ?? null,
    source: statusEvent.source ?? 'meta_webhook',
  });
}

function createMessageDispatcher({
  insertPendingMessage,
  sendText,
  markMessageSent,
  markMessageFailed,
  touchConversation,
  updateMessageStatus,
  logger,
}) {
  async function dispatchTextMessage({ conversationId, to, content, source }) {
    const trimmedContent = typeof content === 'string' ? content.trim() : '';

    if (!conversationId) throw new Error('conversationId is required');
    if (!to) throw new Error('Recipient phone number is required');
    if (!trimmedContent) throw new Error('Outbound message content is required');
    if (!source) throw new Error('Outbound message source is required');

    const pendingMessage = await insertPendingMessage({
      conversationId,
      content: trimmedContent,
      source,
    });

    let sendResult;
    try {
      sendResult = await sendText(to, trimmedContent);
    } catch (error) {
      const failureReason = serialiseFailureReason(error);

      try {
        await markMessageFailed(pendingMessage.id, failureReason);
      } catch (updateError) {
        logger.error('Failed to mark outbound message as failed', {
          messageId: pendingMessage.id,
          error: updateError.message,
        });
      }

      throw error;
    }

    const waMessageId = sendResult?.messages?.[0]?.id ?? null;
    let sentMessage = await markMessageSent(pendingMessage.id, waMessageId);

    // Insert a local "sent" event and replay any Meta status that arrived in
    // the small window before wa_message_id was stored on the message row.
    if (waMessageId) {
      try {
        const reconciledMessage = await updateDeliveryStatus({
          id: waMessageId,
          status: 'sent',
          timestamp: Math.floor(Date.now() / 1000),
          recipient_id: to,
          source: 'send_response',
        });
        if (reconciledMessage) sentMessage = reconciledMessage;
      } catch (error) {
        logger.warn('Outbound message sent but status reconciliation failed', {
          messageId: pendingMessage.id,
          waMessageId,
          error: error.message,
        });
      }
    }

    try {
      await touchConversation(conversationId, new Date().toISOString());
    } catch (error) {
      logger.warn('Outbound message sent but conversation timestamp update failed', {
        conversationId,
        messageId: pendingMessage.id,
        error: error.message,
      });
    }

    logger.info('Outbound message dispatched and persisted', {
      conversationId,
      messageId: pendingMessage.id,
      waMessageId,
      source,
    });

    return {
      message: sentMessage,
      waMessageId,
      providerResult: sendResult,
    };
  }

  async function updateDeliveryStatus(statusEvent) {
    const waMessageId =
      typeof statusEvent?.id === 'string' ? statusEvent.id.trim() : '';
    const deliveryStatus =
      typeof statusEvent?.status === 'string'
        ? statusEvent.status.trim().toLowerCase()
        : '';

    if (!waMessageId || !deliveryStatus) {
      logger.warn('Ignoring malformed WhatsApp delivery status event');
      return null;
    }

    if (!WHATSAPP_DELIVERY_STATUSES.has(deliveryStatus)) {
      logger.warn('Ignoring unsupported WhatsApp delivery status', {
        waMessageId,
        deliveryStatus,
      });
      return null;
    }

    const failure = extractFailureMetadata({
      ...statusEvent,
      status: deliveryStatus,
    });

    const result = await updateMessageStatus({
      waMessageId,
      deliveryStatus,
      providerTimestamp: normaliseProviderTimestamp(statusEvent.timestamp),
      recipientPhone: statusEvent.recipient_id ?? null,
      failureCode: failure.failureCode,
      failureReason: failure.failureReason,
      failureDetails: failure.failureDetails,
      payload: buildStatusPayload({ ...statusEvent, status: deliveryStatus }),
    });
    const message = result?.message ?? (result?.id ? result : null);

    if (!message) {
      logger.info('WhatsApp status event buffered until message ID is available', {
        waMessageId,
        deliveryStatus,
      });
      return null;
    }

    logger.info('Outbound message delivery status updated', {
      messageId: message.id,
      waMessageId,
      deliveryStatus,
    });

    return message;
  }

  return { dispatchTextMessage, updateDeliveryStatus };
}

let defaultDispatcher;

function getDefaultDispatcher() {
  if (defaultDispatcher) return defaultDispatcher;

  const supabase = require('../../db/client');
  const logger = require('../../utils/logger');
  const { sendTextMessage } = require('../whatsapp/sender');

  defaultDispatcher = createMessageDispatcher({
    logger,
    sendText: sendTextMessage,

    async insertPendingMessage({ conversationId, content, source }) {
      const { data, error } = await supabase
        .from('messages')
        .insert({
          conversation_id: conversationId,
          direction: 'outbound',
          source,
          content,
          delivery_status: 'pending',
        })
        .select('*')
        .single();

      if (error) {
        throw new Error(`Failed to create pending outbound message: ${error.message}`);
      }

      return data;
    },

    async markMessageSent(messageId, waMessageId) {
      const now = new Date().toISOString();
      const { data, error } = await supabase
        .from('messages')
        .update({
          wa_message_id: waMessageId,
          delivery_status: 'sent',
          status_updated_at: now,
          sent_at: now,
          failure_code: null,
          failure_reason: null,
          failure_details: null,
        })
        .eq('id', messageId)
        .select('*')
        .single();

      if (error) {
        throw new Error(
          `WhatsApp message sent but database update failed: ${error.message}`
        );
      }

      return data;
    },

    async markMessageFailed(messageId, failureReason) {
      const now = new Date().toISOString();
      const { data, error } = await supabase
        .from('messages')
        .update({
          delivery_status: 'failed',
          status_updated_at: now,
          failed_at: now,
          failure_code: 'LOCAL_SEND_FAILURE',
          failure_reason: failureReason,
        })
        .eq('id', messageId)
        .select('*')
        .single();

      if (error) {
        throw new Error(`Failed to store outbound failure: ${error.message}`);
      }

      return data;
    },

    async touchConversation(conversationId, lastMessageAt) {
      const { error } = await supabase
        .from('conversations')
        .update({ last_message_at: lastMessageAt })
        .eq('id', conversationId);

      if (error) {
        throw new Error(`Failed to update conversation timestamp: ${error.message}`);
      }
    },

    async updateMessageStatus(status) {
      const { data, error } = await supabase.rpc(
        'apply_whatsapp_delivery_status',
        {
          p_wa_message_id: status.waMessageId,
          p_status: status.deliveryStatus,
          p_provider_timestamp: status.providerTimestamp,
          p_recipient_phone: status.recipientPhone,
          p_failure_code: status.failureCode,
          p_failure_reason: status.failureReason,
          p_failure_details: status.failureDetails,
          p_payload: status.payload,
        }
      );

      if (error) {
        const migrationHint = error.code === 'PGRST202'
          ? ' Run migration 007_whatsapp_delivery_statuses.sql.'
          : '';
        throw new Error(
          `Failed to update message delivery status: ${error.message}.${migrationHint}`
        );
      }

      return Array.isArray(data) ? data[0] : data;
    },
  });

  return defaultDispatcher;
}

module.exports = {
  WHATSAPP_DELIVERY_STATUSES,
  buildStatusPayload,
  createMessageDispatcher,
  extractFailureMetadata,
  normaliseProviderTimestamp,
  serialiseFailureReason,
  dispatchTextMessage: (...args) =>
    getDefaultDispatcher().dispatchTextMessage(...args),
  updateDeliveryStatus: (...args) =>
    getDefaultDispatcher().updateDeliveryStatus(...args),
};
