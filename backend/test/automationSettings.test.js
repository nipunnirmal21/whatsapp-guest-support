const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createAutomationSettingsService,
} = require('../src/services/settings/automation');

function createHarness({
  emergencyDisabled = false,
  loadError = null,
  cacheTtlMs = 30_000,
} = {}) {
  let timestamp = 1_000;
  let loadCount = 0;
  let row = {
    id: 'global',
    ai_auto_reply_enabled: false,
    auto_send_clarifications: true,
    updated_at: '2026-08-09T00:00:00.000Z',
  };

  const service = createAutomationSettingsService({
    logger: { info() {}, warn() {}, error() {} },
    emergencyDisabled,
    cacheTtlMs,
    now: () => timestamp,
    async loadSettingsRow() {
      loadCount += 1;
      if (loadError) throw loadError;
      return row;
    },
    async saveSettingsRow(settings) {
      row = {
        ...row,
        ai_auto_reply_enabled: settings.aiAutoReplyEnabled,
        auto_send_clarifications: settings.autoSendClarifications,
        updated_at: '2026-08-09T01:00:00.000Z',
      };
      return row;
    },
  });

  return {
    service,
    get loadCount() {
      return loadCount;
    },
    advance(ms) {
      timestamp += ms;
    },
  };
}

test('automation settings are cached for the configured TTL', async () => {
  const harness = createHarness();

  const first = await harness.service.getAutomationSettings();
  const second = await harness.service.getAutomationSettings();

  assert.equal(first.aiAutoReplyEnabled, false);
  assert.equal(second.source, 'cache');
  assert.equal(harness.loadCount, 1);

  harness.advance(30_001);
  await harness.service.getAutomationSettings();
  assert.equal(harness.loadCount, 2);
});

test('updating settings persists them and refreshes the cache', async () => {
  const harness = createHarness();

  const updated = await harness.service.updateAutomationSettings({
    aiAutoReplyEnabled: true,
    autoSendClarifications: false,
  });

  assert.equal(updated.aiAutoReplyEnabled, true);
  assert.equal(updated.autoSendClarifications, false);
  assert.equal(updated.effectiveAiAutoReplyEnabled, true);

  const cached = await harness.service.getAutomationSettings();
  assert.equal(cached.source, 'cache');
  assert.equal(cached.aiAutoReplyEnabled, true);
});

test('emergency disable overrides stored dashboard settings', async () => {
  const harness = createHarness({ emergencyDisabled: true });

  const updated = await harness.service.updateAutomationSettings({
    aiAutoReplyEnabled: true,
    autoSendClarifications: true,
  });

  assert.equal(updated.aiAutoReplyEnabled, true);
  assert.equal(updated.emergencyDisabled, true);
  assert.equal(updated.effectiveAiAutoReplyEnabled, false);
  assert.equal(updated.effectiveAutoSendClarifications, false);
});

test('fail-closed mode disables AI sending when settings cannot be loaded', async () => {
  const harness = createHarness({ loadError: new Error('Database unavailable') });

  const fallback = await harness.service.getAutomationSettings({
    failClosed: true,
  });

  assert.equal(fallback.source, 'fallback');
  assert.equal(fallback.effectiveAiAutoReplyEnabled, false);
  assert.equal(fallback.effectiveAutoSendClarifications, false);
});

test('invalid setting values are rejected', async () => {
  const harness = createHarness();

  await assert.rejects(
    harness.service.updateAutomationSettings({ aiAutoReplyEnabled: 'yes' }),
    /must be a boolean/
  );
  await assert.rejects(
    harness.service.updateAutomationSettings({ unexpectedSetting: true }),
    /Unknown automation setting/
  );
});
