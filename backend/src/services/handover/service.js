const HANDOVER_ERROR_STATUS = Object.freeze({
  P0002: 404,
  '42501': 403,
  P0001: 409,
  '22023': 400,
});

function unwrapRpcResult(data, operation) {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) {
    const error = new Error(`${operation} returned an invalid database result`);
    error.status = 500;
    throw error;
  }
  return row;
}

function createHandoverService({ runRpc, logger }) {
  async function execute(operation, params, logContext) {
    const data = await runRpc(operation, params);
    const result = unwrapRpcResult(data, operation);
    logger.info(`Handover operation completed: ${operation}`, logContext);
    return result;
  }

  return {
    takeOverEscalation({ escalationId, operatorId }) {
      return execute(
        'take_over_escalation',
        { p_escalation_id: escalationId, p_operator_id: operatorId },
        { escalationId, operatorId }
      );
    },

    assignConversation({ conversationId, actorId, assignedTo }) {
      return execute(
        'assign_conversation',
        {
          p_conversation_id: conversationId,
          p_actor_id: actorId,
          p_assigned_to: assignedTo,
        },
        { conversationId, actorId, assignedTo }
      );
    },

    startManualMode({ conversationId, operatorId, reason = null }) {
      return execute(
        'start_conversation_manual_mode',
        {
          p_conversation_id: conversationId,
          p_operator_id: operatorId,
          p_reason: reason,
        },
        { conversationId, operatorId }
      );
    },

    resumeAutomation({ conversationId, operatorId }) {
      return execute(
        'resume_conversation_automation',
        { p_conversation_id: conversationId, p_operator_id: operatorId },
        { conversationId, operatorId }
      );
    },

    resolveConversation({ conversationId, operatorId }) {
      return execute(
        'resolve_conversation_handover',
        { p_conversation_id: conversationId, p_operator_id: operatorId },
        { conversationId, operatorId }
      );
    },
  };
}

let defaultService;

function getDefaultService() {
  if (defaultService) return defaultService;

  const supabase = require('../../db/client');
  const logger = require('../../utils/logger');

  defaultService = createHandoverService({
    logger,
    async runRpc(operation, params) {
      const { data, error } = await supabase.rpc(operation, params);

      if (error) {
        const serviceError = new Error(error.message || 'Handover operation failed');
        serviceError.status = HANDOVER_ERROR_STATUS[error.code] || 500;
        serviceError.code = error.code;
        throw serviceError;
      }

      return data;
    },
  });

  return defaultService;
}

module.exports = {
  HANDOVER_ERROR_STATUS,
  createHandoverService,
  takeOverEscalation: (...args) => getDefaultService().takeOverEscalation(...args),
  assignConversation: (...args) => getDefaultService().assignConversation(...args),
  startManualMode: (...args) => getDefaultService().startManualMode(...args),
  resumeAutomation: (...args) => getDefaultService().resumeAutomation(...args),
  resolveConversation: (...args) => getDefaultService().resolveConversation(...args),
};
