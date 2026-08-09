const MAX_FAILURE_REASON_LENGTH = 1000;

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
    const sentMessage = await markMessageSent(pendingMessage.id, waMessageId);

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
    const waMessageId = statusEvent?.id;
    const deliveryStatus = statusEvent?.status;

    if (!waMessageId || !deliveryStatus) {
      logger.warn('Ignoring malformed WhatsApp delivery status event');
      return null;
    }

    const failureReason =
      deliveryStatus === 'failed' && statusEvent.errors
        ? serialiseFailureReason(statusEvent.errors)
        : null;

    const message = await updateMessageStatus({
      waMessageId,
      deliveryStatus,
      failureReason,
    });

    if (!message) {
      logger.warn('No outbound message found for WhatsApp status event', {
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
      const { data, error } = await supabase
        .from('messages')
        .update({
          wa_message_id: waMessageId,
          delivery_status: 'sent',
          failure_reason: null,
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
      const { data, error } = await supabase
        .from('messages')
        .update({
          delivery_status: 'failed',
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

    async updateMessageStatus({ waMessageId, deliveryStatus, failureReason }) {
      const payload = { delivery_status: deliveryStatus };
      if (failureReason) payload.failure_reason = failureReason;

      const { data, error } = await supabase
        .from('messages')
        .update(payload)
        .eq('wa_message_id', waMessageId)
        .select('id, conversation_id, delivery_status, wa_message_id')
        .maybeSingle();

      if (error) {
        throw new Error(`Failed to update message delivery status: ${error.message}`);
      }

      return data;
    },
  });

  return defaultDispatcher;
}

module.exports = {
  createMessageDispatcher,
  serialiseFailureReason,
  dispatchTextMessage: (...args) =>
    getDefaultDispatcher().dispatchTextMessage(...args),
  updateDeliveryStatus: (...args) =>
    getDefaultDispatcher().updateDeliveryStatus(...args),
};
