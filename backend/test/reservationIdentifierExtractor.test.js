const test = require('node:test');
const assert = require('node:assert/strict');

const {
  extractReservationIdentifiers,
  normaliseBookingId,
  normaliseGuestName,
} = require('../src/services/reservations/identifierExtractor');

test('extracts and normalises an explicitly labelled Booking ID and guest name', () => {
  const result = extractReservationIdentifiers(
    'My booking ID is booking-4521. Name: Nimal Perera'
  );

  assert.equal(result.bookingId.key, 'BOOKING4521');
  assert.equal(result.guestName.key, 'nimal perera');
});

test('extracts common reservation reference and name phrases', () => {
  assert.equal(
    extractReservationIdentifiers('Reservation number: ab_123').bookingId.key,
    'AB123'
  );
  assert.equal(
    extractReservationIdentifiers("Under the name of Anne-Marie O'Neil").guestName.key,
    "anne-marie o'neil"
  );
});

test('does not treat ordinary booking language as an identifier or name', () => {
  const result = extractReservationIdentifiers('I have a booking for tomorrow');
  assert.equal(result.bookingId, null);
  assert.equal(result.guestName, null);
});

test('normalisers reject unusable values', () => {
  assert.equal(normaliseBookingId(' - '), null);
  assert.equal(normaliseGuestName('12345'), null);
  assert.equal(normaliseGuestName('  Nimal   Perera  '), 'nimal perera');
});

