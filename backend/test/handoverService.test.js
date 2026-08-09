const test = require('node:test');
const assert = require('node:assert/strict');

const {
  HANDOVER_ERROR_STATUS,
  createHandoverService,
} = require('../src/services/handover/service');

const logger = { info() {}, warn() {}, error() {} };

test('handover service maps each action to its atomic database function', async () => {
  const calls = [];
  const service = createHandoverService({
    logger,
    async runRpc(operation, params) {
      calls.push({ operation, params });
      if (operation === 'take_over_escalation') {
        return [{ conversation: { status: 'manual' }, escalation: { status: 'acknowledged' } }];
      }
      return { id: params.p_conversation_id, status: 'manual' };
    },
  });

  await service.takeOverEscalation({ escalationId: 'e-1', operatorId: 'u-1' });
  await service.assignConversation({
    conversationId: 'c-1',
    actorId: 'u-1',
    assignedTo: 'u-2',
  });
  await service.startManualMode({
    conversationId: 'c-1',
    operatorId: 'u-1',
    reason: 'Guest requested a person',
  });
  await service.resumeAutomation({ conversationId: 'c-1', operatorId: 'u-1' });
  await service.resolveConversation({ conversationId: 'c-1', operatorId: 'u-1' });

  assert.deepEqual(
    calls.map((call) => call.operation),
    [
      'take_over_escalation',
      'assign_conversation',
      'start_conversation_manual_mode',
      'resume_conversation_automation',
      'resolve_conversation_handover',
    ]
  );
  assert.equal(calls[0].params.p_operator_id, 'u-1');
  assert.equal(calls[1].params.p_assigned_to, 'u-2');
  assert.equal(calls[2].params.p_reason, 'Guest requested a person');
});

test('handover service rejects an empty database result', async () => {
  const service = createHandoverService({
    logger,
    async runRpc() {
      return null;
    },
  });

  await assert.rejects(
    service.resumeAutomation({ conversationId: 'c-1', operatorId: 'u-1' }),
    /invalid database result/i
  );
});

test('database handover errors have safe HTTP status mappings', () => {
  assert.equal(HANDOVER_ERROR_STATUS.P0002, 404);
  assert.equal(HANDOVER_ERROR_STATUS['42501'], 403);
  assert.equal(HANDOVER_ERROR_STATUS.P0001, 409);
  assert.equal(HANDOVER_ERROR_STATUS['22023'], 400);
});

