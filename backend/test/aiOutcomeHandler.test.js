const test = require('node:test');
const assert = require('node:assert/strict');

const {
  HOLDING_MESSAGE,
  createAiOutcomeHandler,
  parseBoolean,
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
} = {}) {
  const dispatched = [];
  const escalations = [];
  const states = [];
  const logger = { info() {}, warn() {}, error() {} };

  const handler = createAiOutcomeHandler({
    logger,
    safeAutoReplyEnabled,
    autoSendClarifications,
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
    async updateAiActionState(payload) {
      states.push(payload);
    },
  });

  return { handler, dispatched, escalations, states };
}

test('parseBoolean uses safe defaults and recognises true', () => {
  assert.equal(parseBoolean(undefined, false), false);
  assert.equal(parseBoolean(undefined, true), true);
  assert.equal(parseBoolean('TRUE', false), true);
  assert.equal(parseBoolean('false', true), false);
});

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
