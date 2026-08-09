async function requestHandover(fetchWithAuth, path, options = {}) {
  const response = await fetchWithAuth(path, options);
  return response.data;
}

export function takeOverEscalation(fetchWithAuth, escalationId) {
  return requestHandover(
    fetchWithAuth,
    `/api/escalations/${encodeURIComponent(escalationId)}/take-over`,
    { method: 'POST' }
  );
}

export function assignConversation(fetchWithAuth, conversationId, assignedTo) {
  return requestHandover(
    fetchWithAuth,
    `/api/conversations/${encodeURIComponent(conversationId)}/assignment`,
    {
      method: 'PATCH',
      body: JSON.stringify({ assignedTo }),
    }
  );
}

export function startManualMode(fetchWithAuth, conversationId, reason) {
  return requestHandover(
    fetchWithAuth,
    `/api/conversations/${encodeURIComponent(conversationId)}/manual-mode`,
    {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }
  );
}

export function resumeAutomation(fetchWithAuth, conversationId) {
  return requestHandover(
    fetchWithAuth,
    `/api/conversations/${encodeURIComponent(conversationId)}/resume-automation`,
    { method: 'POST' }
  );
}

export function resolveConversation(fetchWithAuth, conversationId) {
  return requestHandover(fetchWithAuth, '/api/escalations/resolve', {
    method: 'POST',
    body: JSON.stringify({ conversationId }),
  });
}
