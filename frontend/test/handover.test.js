import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assignConversation,
  resolveConversation,
  resumeAutomation,
  startManualMode,
  takeOverEscalation,
} from '../src/services/handover.js';

function createFetchRecorder() {
  const calls = [];
  return {
    calls,
    async fetchWithAuth(path, options) {
      calls.push({ path, options });
      return { data: { ok: true } };
    },
  };
}

test('take over posts to the escalation claim endpoint', async () => {
  const recorder = createFetchRecorder();
  await takeOverEscalation(recorder.fetchWithAuth, 'esc-1');

  assert.deepEqual(recorder.calls, [
    {
      path: '/api/escalations/esc-1/take-over',
      options: { method: 'POST' },
    },
  ]);
});

test('manual mode and assignment send their required payloads', async () => {
  const recorder = createFetchRecorder();
  await startManualMode(recorder.fetchWithAuth, 'conv-1', 'Operator reply');
  await assignConversation(recorder.fetchWithAuth, 'conv-1', 'user-2');

  assert.equal(recorder.calls[0].path, '/api/conversations/conv-1/manual-mode');
  assert.deepEqual(JSON.parse(recorder.calls[0].options.body), {
    reason: 'Operator reply',
  });
  assert.equal(recorder.calls[1].options.method, 'PATCH');
  assert.deepEqual(JSON.parse(recorder.calls[1].options.body), {
    assignedTo: 'user-2',
  });
});

test('resume and resolve call the handover completion endpoints', async () => {
  const recorder = createFetchRecorder();
  await resumeAutomation(recorder.fetchWithAuth, 'conv-1');
  await resolveConversation(recorder.fetchWithAuth, 'conv-1');

  assert.equal(recorder.calls[0].path, '/api/conversations/conv-1/resume-automation');
  assert.equal(recorder.calls[1].path, '/api/escalations/resolve');
  assert.deepEqual(JSON.parse(recorder.calls[1].options.body), {
    conversationId: 'conv-1',
  });
});
