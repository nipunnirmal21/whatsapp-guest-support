const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createMessageDispatcher,
  serialiseFailureReason,
} = require('../src/services/messages/dispatcher');

function createHarness({ sendError = null, statusMessage = { id: 'message-1' } } = {}) {
  const calls = [];
  const logger = { info() {}, warn() {}, error() {} };

  const dispatcher = createMessageDispatcher({
    logger,
    async insertPendingMessage(payload) {
      calls.push(['insert', payload]);
      return { id: 'message-1', delivery_status: 'pending' };
    },
    async sendText(to, content) {
      calls.push(['send', { to, content }]);
      if (sendError) throw sendError;
      return { messages: [{ id: 'wamid-1' }] };
    },
    async markMessageSent(messageId, waMessageId) {
      calls.push(['sent', { messageId, waMessageId }]);
      return { id: messageId, wa_message_id: waMessageId, delivery_status: 'sent' };
    },
    async markMessageFailed(messageId, failureReason) {
      calls.push(['failed', { messageId, failureReason }]);
      return { id: messageId, delivery_status: 'failed' };
    },
    async touchConversation(conversationId) {
      calls.push(['touch', { conversationId }]);
    },
    async updateMessageStatus(payload) {
      calls.push(['status', payload]);
      return statusMessage;
    },
  });

  return { dispatcher, calls };
}

test('outbound message is persisted before it is sent', async () => {
  const harness = createHarness();

  const result = await harness.dispatcher.dispatchTextMessage({
    conversationId: 'conversation-1',
    to: '94770000000',
    content: 'Hello guest',
    source: 'ai',
  });

  assert.deepEqual(
    harness.calls.map(([name]) => name),
    ['insert', 'send', 'sent', 'touch']
  );
  assert.equal(result.waMessageId, 'wamid-1');
  assert.equal(result.message.delivery_status, 'sent');
});

test('send failure marks the pending message as failed', async () => {
  const harness = createHarness({ sendError: new Error('Provider unavailable') });

  await assert.rejects(
    harness.dispatcher.dispatchTextMessage({
      conversationId: 'conversation-1',
      to: '94770000000',
      content: 'Hello guest',
      source: 'ai',
    }),
    /Provider unavailable/
  );

  assert.deepEqual(
    harness.calls.map(([name]) => name),
    ['insert', 'send', 'failed']
  );
  assert.match(harness.calls[2][1].failureReason, /Provider unavailable/);
});

test('delivery status event updates its outbound message', async () => {
  const harness = createHarness();

  const result = await harness.dispatcher.updateDeliveryStatus({
    id: 'wamid-1',
    status: 'delivered',
  });

  assert.equal(result.id, 'message-1');
  assert.deepEqual(harness.calls[0], [
    'status',
    {
      waMessageId: 'wamid-1',
      deliveryStatus: 'delivered',
      failureReason: null,
    },
  ]);
});

test('failure reasons are bounded before database persistence', () => {
  const reason = serialiseFailureReason({ message: 'x'.repeat(2000) });
  assert.equal(reason.length, 1000);
});
