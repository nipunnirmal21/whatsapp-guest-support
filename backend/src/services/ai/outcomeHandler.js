const HOLDING_MESSAGE =
  'Thanks for your message. A member of our team will review this and assist you shortly.';

const DEFAULT_CLARIFICATION_MESSAGE =
  'Could you please share a few more details so we can help you?';

function isManualConversation(conversation) {
  return ['escalated', 'manual'].includes(conversation?.status);
}

function createAiOutcomeHandler({
  dispatchTextMessage,
  ensureEscalation,
  updateAiActionState,
  getAutomationSettings,
  logger,
}) {
  async function setActionState(conversationId, status, inboundMessageId) {
    try {
      await updateAiActionState({ conversationId, status, inboundMessageId });
    } catch (error) {
      logger.error('Failed to update AI action state', {
        conversationId,
        status,
        error: error.message,
      });
      throw error;
    }
  }

  async function escalate({ conversation, reason, inboundMessageId, notifyGuest }) {
    const result = await ensureEscalation({
      conversationId: conversation.id,
      reason,
    });

    let notificationSent = false;
    if (notifyGuest && result.created) {
      try {
        await dispatchTextMessage({
          conversationId: conversation.id,
          to: conversation.guest_phone,
          content: HOLDING_MESSAGE,
          source: 'system',
        });
        notificationSent = true;
      } catch (error) {
        logger.error('Escalation created but holding message could not be sent', {
          conversationId: conversation.id,
          error: error.message,
        });
      }
    }

    await setActionState(
      conversation.id,
      result.created && notifyGuest && !notificationSent
        ? 'escalated_notification_failed'
        : 'escalated',
      inboundMessageId
    );

    return {
      action: 'escalated',
      escalation: result.escalation,
      created: result.created,
      notificationSent,
    };
  }

  async function handleDeliveryFailure({ conversation, inboundMessageId, error }) {
    logger.error('AI response delivery failed; escalating to an operator', {
      conversationId: conversation.id,
      error: error.message,
    });

    const result = await ensureEscalation({
      conversationId: conversation.id,
      reason: 'Automatic AI response could not be delivered. Operator review required.',
    });

    await setActionState(conversation.id, 'failed', inboundMessageId);

    return {
      action: 'escalated',
      escalation: result.escalation,
      created: result.created,
      notificationSent: false,
    };
  }

  async function sendAiMessage({
    conversation,
    content,
    successStatus,
    inboundMessageId,
  }) {
    try {
      const dispatched = await dispatchTextMessage({
        conversationId: conversation.id,
        to: conversation.guest_phone,
        content,
        source: 'ai',
      });

      await setActionState(conversation.id, successStatus, inboundMessageId);

      return {
        action: 'sent',
        message: dispatched.message,
        waMessageId: dispatched.waMessageId,
      };
    } catch (error) {
      return handleDeliveryFailure({ conversation, inboundMessageId, error });
    }
  }

  async function handleAiOutcome({
    conversation,
    aiResult,
    reservationContext,
    inboundMessageId,
  }) {
    if (!conversation?.id || !conversation?.guest_phone) {
      throw new Error('A conversation with guest_phone is required');
    }

    const classification = aiResult?.classification;
    const draft = typeof aiResult?.draft === 'string' ? aiResult.draft.trim() : '';

    if (classification === 'safe_reply') {
      if (!draft) {
        return escalate({
          conversation,
          reason: 'AI returned safe_reply without a usable draft.',
          inboundMessageId,
          notifyGuest: true,
        });
      }

      const settings = await getAutomationSettings({ failClosed: true });
      const canAutoSend =
        settings.effectiveAiAutoReplyEnabled &&
        Boolean(reservationContext?.reservation) &&
        !isManualConversation(conversation);

      if (!canAutoSend) {
        await setActionState(conversation.id, 'awaiting_approval', inboundMessageId);
        return { action: 'awaiting_approval' };
      }

      return sendAiMessage({
        conversation,
        content: draft,
        successStatus: 'sent',
        inboundMessageId,
      });
    }

    if (classification === 'clarification_needed') {
      const settings = await getAutomationSettings({ failClosed: true });
      if (
        !settings.effectiveAutoSendClarifications ||
        isManualConversation(conversation)
      ) {
        await setActionState(conversation.id, 'awaiting_approval', inboundMessageId);
        return { action: 'awaiting_approval' };
      }

      return sendAiMessage({
        conversation,
        content: draft || DEFAULT_CLARIFICATION_MESSAGE,
        successStatus: 'clarification_sent',
        inboundMessageId,
      });
    }

    if (classification === 'human_handover') {
      return escalate({
        conversation,
        reason: 'AI classified the latest guest message as requiring human handover.',
        inboundMessageId,
        notifyGuest: true,
      });
    }

    return escalate({
      conversation,
      reason: `Unsupported AI classification received: ${classification ?? 'missing'}.`,
      inboundMessageId,
      notifyGuest: true,
    });
  }

  return { handleAiOutcome };
}

let defaultHandler;

function getDefaultHandler() {
  if (defaultHandler) return defaultHandler;

  const supabase = require('../../db/client');
  const logger = require('../../utils/logger');
  const { dispatchTextMessage } = require('../messages/dispatcher');
  const { ensureEscalation } = require('../escalations/service');
  const { getAutomationSettings } = require('../settings/automation');

  defaultHandler = createAiOutcomeHandler({
    logger,
    dispatchTextMessage,
    ensureEscalation,
    getAutomationSettings,
    async updateAiActionState({ conversationId, status, inboundMessageId }) {
      const payload = { ai_action_status: status };
      if (inboundMessageId) payload.ai_last_message_id = inboundMessageId;

      const { error } = await supabase
        .from('conversations')
        .update(payload)
        .eq('id', conversationId);

      if (error) {
        throw new Error(`Failed to store AI action state: ${error.message}`);
      }
    },
  });

  return defaultHandler;
}

module.exports = {
  HOLDING_MESSAGE,
  DEFAULT_CLARIFICATION_MESSAGE,
  createAiOutcomeHandler,
  handleAiOutcome: (...args) => getDefaultHandler().handleAiOutcome(...args),
};
