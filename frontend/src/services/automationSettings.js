function requireBoolean(value, name) {
  if (typeof value !== 'boolean') {
    throw new Error(`Invalid automation setting received: ${name}`);
  }
  return value;
}

export function normaliseAutomationSettings(data) {
  if (!data || typeof data !== 'object') {
    throw new Error('Automation settings response is missing');
  }

  return {
    aiAutoReplyEnabled: requireBoolean(
      data.aiAutoReplyEnabled,
      'aiAutoReplyEnabled'
    ),
    autoSendClarifications: requireBoolean(
      data.autoSendClarifications,
      'autoSendClarifications'
    ),
    emergencyDisabled: Boolean(data.emergencyDisabled),
    effectiveAiAutoReplyEnabled: Boolean(
      data.effectiveAiAutoReplyEnabled
    ),
    effectiveAutoSendClarifications: Boolean(
      data.effectiveAutoSendClarifications
    ),
    updatedAt: data.updatedAt ?? null,
  };
}

export async function loadAutomationSettings(authenticatedFetch) {
  const response = await authenticatedFetch('/api/settings/automation');
  return normaliseAutomationSettings(response.data);
}

export async function saveAutomationSettings(authenticatedFetch, settings) {
  requireBoolean(settings?.aiAutoReplyEnabled, 'aiAutoReplyEnabled');
  requireBoolean(
    settings?.autoSendClarifications,
    'autoSendClarifications'
  );

  const response = await authenticatedFetch('/api/settings/automation', {
    method: 'PATCH',
    body: JSON.stringify({
      aiAutoReplyEnabled: settings.aiAutoReplyEnabled,
      autoSendClarifications: settings.autoSendClarifications,
    }),
  });

  return normaliseAutomationSettings(response.data);
}
