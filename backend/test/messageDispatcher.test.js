const test = require('node:test');
const assert = require('node:assert/strict');

const {
  extractFailureMetadata,
  normaliseProviderTimestamp,
  createMessageDispatcher,
  serialiseFailureReason,
} = require('../src/services/messages/dispatcher');

function createHarness({
  sendError = null,
  statusMessage = { id: 'message-1', delivery_status: 'sent' },
} = {}) {
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
    ['insert', 'send', 'sent', 'status', 'touch']
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
    timestamp: '1786280000',
    recipient_id: '94770000000',
  });

  assert.equal(result.id, 'message-1');
  assert.equal(harness.calls[0][0], 'status');
  assert.equal(harness.calls[0][1].waMessageId, 'wamid-1');
  assert.equal(harness.calls[0][1].deliveryStatus, 'delivered');
  assert.equal(
    harness.calls[0][1].providerTimestamp,
    new Date(1786280000 * 1000).toISOString()
  );
  assert.equal(harness.calls[0][1].recipientPhone, '94770000000');
  assert.equal(harness.calls[0][1].failureReason, null);
});

test('failed provider event stores structured and bounded failure metadata', async () => {
  const harness = createHarness({
    statusMessage: { id: 'message-1', delivery_status: 'failed' },
  });

  await harness.dispatcher.updateDeliveryStatus({
    id: 'wamid-1',
    status: 'failed',
    errors: [
      {
        code: 131026,
        title: 'Message undeliverable',
        error_data: { details: 'Recipient unavailable' },
      },
    ],
  });

  const payload = harness.calls[0][1];
  assert.equal(payload.failureCode, '131026');
  assert.match(payload.failureReason, /Message undeliverable/);
  assert.equal(payload.failureDetails.error_data.details, 'Recipient unavailable');
});

test('unsupported or malformed statuses are ignored before database access', async () => {
  const harness = createHarness();

  assert.equal(
    await harness.dispatcher.updateDeliveryStatus({ id: 'wamid-1', status: 'deleted' }),
    null
  );
  assert.equal(await harness.dispatcher.updateDeliveryStatus({ status: 'read' }), null);
  assert.deepEqual(harness.calls, []);
});

test('status received before the outbound row is linked remains buffered', async () => {
  const harness = createHarness({
    statusMessage: { message: null, buffered: true, applied: false },
  });

  const result = await harness.dispatcher.updateDeliveryStatus({
    id: 'wamid-early',
    status: 'delivered',
    timestamp: '1786280000',
  });

  assert.equal(result, null);
  assert.equal(harness.calls[0][0], 'status');
});

test('failure reasons are bounded before database persistence', () => {
  const reason = serialiseFailureReason({ message: 'x'.repeat(2000) });
  assert.equal(reason.length, 1000);
});

test('provider timestamp and failure helpers reject invalid data safely', () => {
  assert.equal(normaliseProviderTimestamp('not-a-timestamp'), null);
  assert.equal(normaliseProviderTimestamp(null), null);
  assert.equal(extractFailureMetadata({ status: 'read' }).failureCode, null);
});
