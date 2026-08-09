const test = require('node:test');
const assert = require('node:assert/strict');

const {
  ESCALATION_ERROR_STATUS,
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

test('database escalation errors have safe HTTP status mappings', () => {
  assert.equal(ESCALATION_ERROR_STATUS.P0002, 404);
  assert.equal(ESCALATION_ERROR_STATUS.P0001, 409);
  assert.equal(ESCALATION_ERROR_STATUS['22023'], 400);
  assert.equal(ESCALATION_ERROR_STATUS['23503'], 400);
  assert.equal(ESCALATION_ERROR_STATUS['23505'], 409);
});
