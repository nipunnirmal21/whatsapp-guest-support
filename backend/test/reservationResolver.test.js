const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createConversationLinker,
  createReservationResolver,
} = require('../src/services/reservations/lookup');

const logger = { info() {}, warn() {}, error() {} };

function context(id, guestName = 'Nimal Perera') {
  return {
    reservation: { id, booking_id: `BOOK-${id}`, status: 'confirmed' },
    guest: { id: `guest-${id}`, full_name: guestName },
    apartment: { id: `apartment-${id}`, name: 'Test Apartment' },
    policy: null,
  };
}

function createResolver(overrides = {}) {
  return createReservationResolver({
    logger,
    async findByPhone() {
      return null;
    },
    async findByBookingId() {
      return [];
    },
    async findByGuestName() {
      return [];
    },
    async findByExistingConversation() {
      return null;
    },
    ...overrides,
  });
}

test('phone match remains the highest-priority verified lookup', async () => {
  const phoneContext = context('phone');
  const resolver = createResolver({
    async findByPhone() {
      return phoneContext;
    },
    async findByBookingId() {
      assert.fail('Booking ID fallback should not run after a phone match');
    },
  });

  const result = await resolver.resolveReservationContext({
    phoneNumber: '94770000000',
    messageText: 'Booking ID: OTHER-123',
  });

  assert.equal(result.reservationContext, phoneContext);
  assert.deepEqual(result.match, { status: 'verified', method: 'phone', reason: null });
});

test('unique Booking ID fallback becomes a verified reservation context', async () => {
  let receivedKey;
  const bookingContext = context('booking');
  const resolver = createResolver({
    async findByBookingId(key) {
      receivedKey = key;
      return [bookingContext];
    },
  });

  const result = await resolver.resolveReservationContext({
    phoneNumber: '94770000000',
    messageText: 'My booking ID is bk-1001',
  });

  assert.equal(receivedKey, 'BK1001');
  assert.equal(result.match.status, 'verified');
  assert.equal(result.match.method, 'booking_id');
  assert.equal(result.reservationContext, bookingContext);
});

test('Booking ID plus a different supplied guest name is rejected', async () => {
  const resolver = createResolver({
    async findByBookingId() {
      return [context('booking', 'Nimal Perera')];
    },
  });

  const result = await resolver.resolveReservationContext({
    phoneNumber: '94770000000',
    messageText: 'Booking ID: BK-1001. Name: Kamal Silva',
  });

  assert.equal(result.reservationContext, null);
  assert.equal(result.match.status, 'mismatch');
  assert.equal(result.match.reason, 'guest_name_mismatch');
});

test('unique guest-name fallback is provisional and exposes no reservation context', async () => {
  const candidate = context('name');
  const resolver = createResolver({
    async findByGuestName(key) {
      assert.equal(key, 'nimal perera');
      return [candidate];
    },
  });

  const result = await resolver.resolveReservationContext({
    phoneNumber: '94770000000',
    messageText: 'My name is Nimal Perera',
  });

  assert.equal(result.reservationContext, null);
  assert.equal(result.candidateReservationId, 'name');
  assert.equal(result.match.status, 'provisional');
  assert.equal(result.match.method, 'guest_name');
});

test('multiple guest-name matches are marked ambiguous', async () => {
  const resolver = createResolver({
    async findByGuestName() {
      return [context('one'), context('two')];
    },
  });

  const result = await resolver.resolveReservationContext({
    phoneNumber: '94770000000',
    messageText: 'Guest name: Nimal Perera',
  });

  assert.equal(result.candidateReservationId, null);
  assert.equal(result.match.status, 'ambiguous');
  assert.equal(result.match.reason, 'multiple_active_reservations');
});

test('verified existing conversation link is recovered on later messages', async () => {
  const existingContext = context('existing');
  const resolver = createResolver({
    async findByExistingConversation() {
      return {
        context: existingContext,
        status: 'verified',
        method: 'booking_id',
      };
    },
  });

  const result = await resolver.resolveReservationContext({
    phoneNumber: '94770000000',
    messageText: 'Can I get the Wi-Fi details?',
  });

  assert.equal(result.reservationContext, existingContext);
  assert.equal(result.match.status, 'verified');
  assert.equal(result.match.method, 'booking_id');
});

test('conversation linker forwards verified/candidate metadata atomically', async () => {
  let received;
  const linker = createConversationLinker({
    logger,
    async runLinkConversation(payload) {
      received = payload;
      return {
        id: 'conversation-1',
        reservation_id: null,
        reservation_candidate_id: payload.candidateReservationId,
        reservation_match_method: payload.matchMethod,
        reservation_match_status: payload.matchStatus,
      };
    },
  });

  const result = await linker.findOrCreateConversation(' +94 77 000 0000 ', null, {
    status: 'provisional',
    method: 'guest_name',
    candidateReservationId: 'reservation-1',
  });

  assert.equal(received.guestPhone, '94770000000');
  assert.equal(received.candidateReservationId, 'reservation-1');
  assert.equal(received.matchStatus, 'provisional');
  assert.equal(result.id, 'conversation-1');
});
