const test = require('node:test');
const assert = require('node:assert/strict');

const {
  HOLDING_MESSAGE,
  createAiOutcomeHandler,
} = require('../src/services/ai/outcomeHandler');

const conversation = {
  id: 'conversation-1',
  guest_phone: '94770000000',
  status: 'open',
};

const reservationContext = {
  reservation: { id: 'reservation-1' },
};

function createHarness({
  safeAutoReplyEnabled = false,
  autoSendClarifications = true,
  escalationCreated = true,
  dispatchError = null,
  maintenanceError = null,
} = {}) {
  const dispatched = [];
  const escalations = [];
  const maintenanceCases = [];
  const states = [];
  const logger = { info() {}, warn() {}, error() {} };

  const handler = createAiOutcomeHandler({
    logger,
    async getAutomationSettings() {
      return {
        effectiveAiAutoReplyEnabled: safeAutoReplyEnabled,
        effectiveAutoSendClarifications: autoSendClarifications,
      };
    },
    async dispatchTextMessage(payload) {
      dispatched.push(payload);
      if (dispatchError) throw dispatchError;
      return {
        message: { id: `message-${dispatched.length}` },
        waMessageId: `wamid-${dispatched.length}`,
      };
    },
    async ensureEscalation(payload) {
      escalations.push(payload);
      return {
        conversation: { ...conversation, status: 'escalated' },
        escalation: { id: 'escalation-1', status: 'pending' },
        created: escalationCreated,
      };
    },
    async ensureMaintenanceCase(payload) {
      maintenanceCases.push(payload);
      if (maintenanceError) throw maintenanceError;
      return {
        maintenanceCase: {
          id: 'maintenance-1',
          conversation_id: payload.conversationId,
          apartment_id: payload.apartmentId,
          description: payload.description,
          status: 'open',
        },
        created: true,
        skipped: false,
      };
    },
    async updateAiActionState(payload) {
      states.push(payload);
    },
  });

  return { handler, dispatched, escalations, maintenanceCases, states };
}

test('safe_reply waits for operator approval when auto reply is disabled', async () => {
  const harness = createHarness({ safeAutoReplyEnabled: false });

  const result = await harness.handler.handleAiOutcome({
    conversation,
    aiResult: { classification: 'safe_reply', draft: 'A safe answer.' },
    reservationContext,
    inboundMessageId: 'inbound-1',
  });

  assert.equal(result.action, 'awaiting_approval');
  assert.equal(harness.dispatched.length, 0);
  assert.equal(harness.escalations.length, 0);
  assert.equal(harness.states[0].status, 'awaiting_approval');
});

test('safe_reply auto-sends only with a matched reservation', async () => {
  const harness = createHarness({ safeAutoReplyEnabled: true });

  const result = await harness.handler.handleAiOutcome({
    conversation,
    aiResult: { classification: 'safe_reply', draft: 'A safe answer.' },
    reservationContext,
    inboundMessageId: 'inbound-2',
  });

  assert.equal(result.action, 'sent');
  assert.equal(harness.dispatched.length, 1);
  assert.equal(harness.dispatched[0].source, 'ai');
  assert.equal(harness.states[0].status, 'sent');
});

test('safe_reply without reservation context remains pending approval', async () => {
  const harness = createHarness({ safeAutoReplyEnabled: true });

  const result = await harness.handler.handleAiOutcome({
    conversation,
    aiResult: { classification: 'safe_reply', draft: 'A generic answer.' },
    reservationContext: {},
    inboundMessageId: 'inbound-3',
  });

  assert.equal(result.action, 'awaiting_approval');
  assert.equal(harness.dispatched.length, 0);
});

test('clarification_needed sends the draft when enabled', async () => {
  const harness = createHarness({ autoSendClarifications: true });

  const result = await harness.handler.handleAiOutcome({
    conversation,
    aiResult: {
      classification: 'clarification_needed',
      draft: 'Could you share your booking reference?',
    },
    reservationContext: {},
    inboundMessageId: 'inbound-4',
  });

  assert.equal(result.action, 'sent');
  assert.equal(harness.dispatched[0].source, 'ai');
  assert.equal(harness.states[0].status, 'clarification_sent');
});

test('human_handover creates one escalation and sends a fixed holding message', async () => {
  const harness = createHarness({ escalationCreated: true });

  const result = await harness.handler.handleAiOutcome({
    conversation,
    aiResult: { classification: 'human_handover', draft: null },
    reservationContext,
    inboundMessageId: 'inbound-5',
  });

  assert.equal(result.action, 'escalated');
  assert.equal(harness.escalations.length, 1);
  assert.equal(harness.dispatched.length, 1);
  assert.equal(harness.dispatched[0].content, HOLDING_MESSAGE);
  assert.equal(harness.dispatched[0].source, 'system');
  assert.equal(harness.states[0].status, 'escalated');
  assert.equal(harness.maintenanceCases.length, 0);
});

test('maintenance handover records the verified apartment and still escalates', async () => {
  const harness = createHarness({ escalationCreated: true });

  const result = await harness.handler.handleAiOutcome({
    conversation,
    aiResult: { classification: 'human_handover', draft: null },
    reservationContext: {
      reservation: { id: 'reservation-1' },
      apartment: { id: 'apartment-1' },
    },
    inboundMessageId: 'inbound-maintenance-1',
    handoverReason: 'maintenance issue',
    maintenanceIssue: {
      apartmentId: 'apartment-1',
      description: 'The air conditioner is not working.',
    },
  });

  assert.equal(harness.maintenanceCases.length, 1);
  assert.deepEqual(harness.maintenanceCases[0], {
    conversationId: 'conversation-1',
    apartmentId: 'apartment-1',
    description: 'The air conditioner is not working.',
  });
  assert.equal(harness.escalations.length, 1);
  assert.equal(harness.escalations[0].reason, 'maintenance issue');
  assert.equal(harness.dispatched[0].content, HOLDING_MESSAGE);
  assert.equal(result.maintenance.created, true);
});

test('maintenance persistence failure does not suppress human handover', async () => {
  const harness = createHarness({
    maintenanceError: new Error('maintenance database unavailable'),
  });

  const result = await harness.handler.handleAiOutcome({
    conversation,
    aiResult: { classification: 'human_handover', draft: null },
    reservationContext,
    inboundMessageId: 'inbound-maintenance-2',
    handoverReason: 'maintenance issue',
    maintenanceIssue: {
      apartmentId: 'apartment-1',
      description: 'There is no hot water.',
    },
  });

  assert.equal(result.action, 'escalated');
  assert.equal(harness.escalations.length, 1);
  assert.equal(harness.dispatched[0].content, HOLDING_MESSAGE);
});

test('existing escalation is reused without sending another holding message', async () => {
  const harness = createHarness({ escalationCreated: false });

  const result = await harness.handler.handleAiOutcome({
    conversation,
    aiResult: { classification: 'human_handover', draft: null },
    reservationContext,
    inboundMessageId: 'inbound-6',
  });

  assert.equal(result.created, false);
  assert.equal(harness.dispatched.length, 0);
  assert.equal(harness.states[0].status, 'escalated');
});

test('AI delivery failure is persisted as failed and escalated', async () => {
  const harness = createHarness({
    safeAutoReplyEnabled: true,
    dispatchError: new Error('WhatsApp unavailable'),
  });

  const result = await harness.handler.handleAiOutcome({
    conversation,
    aiResult: { classification: 'safe_reply', draft: 'A safe answer.' },
    reservationContext,
    inboundMessageId: 'inbound-7',
  });

  assert.equal(result.action, 'escalated');
  assert.equal(harness.escalations.length, 1);
  assert.equal(harness.states[0].status, 'failed');
});
