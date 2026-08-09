const test = require('node:test');
const assert = require('node:assert/strict');

const {
  MAX_TEXT_LENGTH,
  createClassifyHandler,
} = require('../src/routes/api/intents');

const CONVERSATION_ID = '123e4567-e89b-42d3-a456-426614174000';

function createResponse() {
  return {
    statusCode: null,
    payload: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    },
  };
}

function createDependencies(overrides = {}) {
  return {
    async resolveByPhone() {
      return {
        reservationContext: null,
        candidateReservationId: null,
        match: { status: 'unmatched', method: 'phone', reason: 'not_found' },
      };
    },
    async resolveByConversationId() {
      return {
        reservationContext: null,
        candidateReservationId: null,
        match: { status: 'unmatched', method: null, reason: 'not_linked' },
      };
    },
    normalisePhone(value) {
      return value.replace(/\D/g, '');
    },
    async runRules() {
      return { outcome: 'unhandled', reply: null };
    },
    async classify() {
      return { classification: 'clarification_needed', draft: 'Please clarify.' };
    },
    serviceLogger: { info() {}, warn() {}, error() {} },
    ...overrides,
  };
}

async function invoke(body, overrides = {}) {
  const response = createResponse();
  let nextError = null;
  const handler = createClassifyHandler(createDependencies(overrides));

  await handler({ body }, response, (err) => {
    nextError = err;
  });

  return { response, nextError };
}

test('classify endpoint rejects blank and oversized text', async () => {
  const blank = await invoke({ text: '   ' });
  assert.equal(blank.response.statusCode, 400);
  assert.match(blank.response.payload.error, /text/);

  const oversized = await invoke({ text: 'x'.repeat(MAX_TEXT_LENGTH + 1) });
  assert.equal(oversized.response.statusCode, 400);
  assert.match(oversized.response.payload.error, /2000/);
});

test('classify endpoint rejects conflicting context identifiers', async () => {
  const result = await invoke({
    text: 'Hello',
    conversationId: CONVERSATION_ID,
    phoneNumber: '+94 77 000 0000',
  });

  assert.equal(result.response.statusCode, 400);
  assert.match(result.response.payload.error, /either/);
});

test('verified deterministic rule returns a safe reply without calling AI', async () => {
  let classifyCalled = false;
  const reservationContext = {
    reservation: { id: 'reservation-1', status: 'confirmed' },
    guest: { id: 'guest-1', full_name: 'Nimal Perera' },
    apartment: { id: 'apartment-1', name: 'Ocean View' },
    policy: { checkin_time: '14:00:00' },
  };

  const result = await invoke(
    { text: 'What is the Wi-Fi password?', conversationId: CONVERSATION_ID },
    {
      async resolveByConversationId(id) {
        assert.equal(id, CONVERSATION_ID);
        return {
          reservationContext,
          candidateReservationId: null,
          match: { status: 'verified', method: 'phone', reason: null },
        };
      },
      async runRules(text, reservation, apartment) {
        assert.equal(text, 'What is the Wi-Fi password?');
        assert.equal(reservation, reservationContext.reservation);
        assert.equal(apartment.policy, reservationContext.policy);
        return { outcome: 'auto_reply', reply: 'Network: Guest\nPassword: secret' };
      },
      async classify() {
        classifyCalled = true;
        return { classification: 'human_handover', draft: null };
      },
    }
  );

  assert.equal(classifyCalled, false);
  assert.equal(result.response.statusCode, 200);
  assert.deepEqual(result.response.payload.data, {
    classification: 'safe_reply',
    draft: 'Network: Guest\nPassword: secret',
    source: 'rules',
    reservationMatch: { status: 'verified', method: 'phone', reason: null },
  });
});

test('unhandled text reaches AI with identity-verification context', async () => {
  let receivedContext;
  const result = await invoke(
    { text: 'Can I check in early?', phoneNumber: '+94 77 000 0000' },
    {
      normalisePhone(value) {
        assert.equal(value, '+94 77 000 0000');
        return '94770000000';
      },
      async resolveByPhone(payload) {
        assert.deepEqual(payload, {
          phoneNumber: '94770000000',
          messageText: 'Can I check in early?',
        });
        return {
          reservationContext: null,
          candidateReservationId: 'reservation-candidate',
          match: {
            status: 'provisional',
            method: 'guest_name',
            reason: 'booking_id_verification_required',
          },
        };
      },
      async classify(_text, context) {
        receivedContext = context;
        return {
          classification: 'human_handover',
          draft: 'Our team will assist you shortly.',
        };
      },
    }
  );

  assert.deepEqual(receivedContext, {
    identity_verification: {
      status: 'provisional',
      method: 'guest_name',
      reason: 'booking_id_verification_required',
    },
  });
  assert.equal(result.response.payload.data.source, 'ai');
  assert.equal(result.response.payload.data.classification, 'human_handover');
});

test('text-only classification uses safe unmatched identity context', async () => {
  let receivedContext;
  const result = await invoke(
    { text: 'I need help' },
    {
      async classify(_text, context) {
        receivedContext = context;
        return { classification: 'clarification_needed', draft: 'How can we help?' };
      },
    }
  );

  assert.equal(result.response.statusCode, 200);
  assert.equal(receivedContext.identity_verification.status, 'unmatched');
  assert.equal(receivedContext.identity_verification.reason, 'no_context_identifier');
});

test('unknown conversation returns 404 and does not call the classifier', async () => {
  let classifyCalled = false;
  const result = await invoke(
    { text: 'Hello', conversationId: CONVERSATION_ID },
    {
      async resolveByConversationId() {
        return null;
      },
      async classify() {
        classifyCalled = true;
        return { classification: 'safe_reply', draft: 'Hello' };
      },
    }
  );

  assert.equal(result.response.statusCode, 404);
  assert.equal(classifyCalled, false);
});

test('unexpected dependency errors are forwarded to the central error handler', async () => {
  const expectedError = new Error('database unavailable');
  const result = await invoke(
    { text: 'Hello', conversationId: CONVERSATION_ID },
    {
      async resolveByConversationId() {
        throw expectedError;
      },
    }
  );

  assert.equal(result.nextError, expectedError);
});
