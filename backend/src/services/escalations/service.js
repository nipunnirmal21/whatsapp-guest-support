function createEscalationService({ runEnsureEscalation, logger }) {
  async function ensureEscalation({ conversationId, reason, escalatedTo = null }) {
    const trimmedReason = typeof reason === 'string' ? reason.trim() : '';

    if (!conversationId) throw new Error('conversationId is required');
    if (!trimmedReason) throw new Error('Escalation reason is required');

    const result = await runEnsureEscalation({
      conversationId,
      reason: trimmedReason,
      escalatedTo,
    });

    logger.info(result.created ? 'Conversation escalated' : 'Open escalation reused', {
      conversationId,
      escalationId: result.escalation?.id ?? null,
    });

    return result;
  }

  return { ensureEscalation };
}

let defaultService;

function getDefaultService() {
  if (defaultService) return defaultService;

  const supabase = require('../../db/client');
  const logger = require('../../utils/logger');

  defaultService = createEscalationService({
    logger,
    async runEnsureEscalation({ conversationId, reason, escalatedTo }) {
      const { data, error } = await supabase.rpc('ensure_conversation_escalation', {
        p_conversation_id: conversationId,
        p_reason: reason,
        p_escalated_to: escalatedTo,
      });

      if (error) {
        const serviceError = new Error(`Failed to escalate conversation: ${error.message}`);
        serviceError.status = error.code === 'P0002' ? 404 : 500;
        serviceError.code = error.code;
        throw serviceError;
      }

      const row = Array.isArray(data) ? data[0] : data;
      if (!row?.conversation || !row?.escalation) {
        throw new Error('Escalation database function returned an invalid result');
      }

      return {
        conversation: row.conversation,
        escalation: row.escalation,
        created: Boolean(row.created),
      };
    },
  });

  return defaultService;
}

module.exports = {
  createEscalationService,
  ensureEscalation: (...args) => getDefaultService().ensureEscalation(...args),
};
