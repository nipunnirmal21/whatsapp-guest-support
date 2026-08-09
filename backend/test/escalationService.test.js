const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createEscalationService,
} = require('../src/services/escalations/service');

test('ensureEscalation trims the reason and returns the atomic database result', async () => {
  let received;
  const service = createEscalationService({
    logger: { info() {}, warn() {}, error() {} },
    async runEnsureEscalation(payload) {
      received = payload;
      return {
        conversation: { id: payload.conversationId, status: 'escalated' },
        escalation: { id: 'escalation-1', reason: payload.reason },
        created: true,
      };
    },
  });

  const result = await service.ensureEscalation({
    conversationId: 'conversation-1',
    reason: '  Needs operator approval  ',
  });

  assert.equal(received.reason, 'Needs operator approval');
  assert.equal(result.created, true);
});

test('ensureEscalation rejects an empty reason before calling the database', async () => {
  const service = createEscalationService({
    logger: { info() {}, warn() {}, error() {} },
    async runEnsureEscalation() {
      throw new Error('should not be called');
    },
  });

  await assert.rejects(
    service.ensureEscalation({ conversationId: 'conversation-1', reason: '  ' }),
    /reason is required/i
  );
});
