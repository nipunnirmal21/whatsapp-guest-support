const AUTOMATION_PAUSED_STATUSES = new Set(['manual', 'escalated']);

function isConversationAutomationPaused(conversation) {
  const status = typeof conversation?.status === 'string'
    ? conversation.status.trim().toLowerCase()
    : '';

  return AUTOMATION_PAUSED_STATUSES.has(status);
}

module.exports = {
  AUTOMATION_PAUSED_STATUSES,
  isConversationAutomationPaused,
};

