import test from 'node:test';
import assert from 'node:assert/strict';

import {
  loadAutomationSettings,
  normaliseAutomationSettings,
  saveAutomationSettings,
} from '../src/services/automationSettings.js';

const responseData = {
  aiAutoReplyEnabled: false,
  autoSendClarifications: true,
  emergencyDisabled: false,
  effectiveAiAutoReplyEnabled: false,
  effectiveAutoSendClarifications: true,
  updatedAt: '2026-08-09T00:00:00.000Z',
};

test('normaliseAutomationSettings validates required boolean fields', () => {
  const result = normaliseAutomationSettings(responseData);
  assert.equal(result.aiAutoReplyEnabled, false);
  assert.equal(result.autoSendClarifications, true);

  assert.throws(
    () => normaliseAutomationSettings({ ...responseData, aiAutoReplyEnabled: 'yes' }),
    /Invalid automation setting/
  );
});

test('loadAutomationSettings uses the authenticated settings endpoint', async () => {
  const calls = [];
  const result = await loadAutomationSettings(async (...args) => {
    calls.push(args);
    return { data: responseData };
  });

  assert.deepEqual(calls, [['/api/settings/automation']]);
  assert.equal(result.autoSendClarifications, true);
});

test('saveAutomationSettings sends both dashboard controls', async () => {
  let received;
  const result = await saveAutomationSettings(
    async (path, options) => {
      received = { path, options };
      return {
        data: {
          ...responseData,
          aiAutoReplyEnabled: true,
          effectiveAiAutoReplyEnabled: true,
        },
      };
    },
    {
      aiAutoReplyEnabled: true,
      autoSendClarifications: true,
    }
  );

  assert.equal(received.path, '/api/settings/automation');
  assert.equal(received.options.method, 'PATCH');
  assert.deepEqual(JSON.parse(received.options.body), {
    aiAutoReplyEnabled: true,
    autoSendClarifications: true,
  });
  assert.equal(result.aiAutoReplyEnabled, true);
});
