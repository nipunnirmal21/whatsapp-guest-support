const supabase = require('../../db/client');
const logger = require('../../utils/logger');

/**
 * findReservationByPhone
 * Phase 3: looks up the most recent active reservation for a guest phone number.
 *
 * @param {string} phoneNumber - E.164 format, e.g. "919876543210"
 * @returns {Promise<object|null>} reservation + guest + apartment or null
 */
async function findReservationByPhone(phoneNumber) {
  // TODO (Phase 3): implement
  logger.info('findReservationByPhone called (stub)', { phoneNumber });
  return null;
}

/**
 * findReservationByBookingId
 * Fallback lookup when phone number match fails.
 */
async function findReservationByBookingId(bookingId) {
  // TODO (Phase 3): implement
  logger.info('findReservationByBookingId called (stub)', { bookingId });
  return null;
}

module.exports = { findReservationByPhone, findReservationByBookingId };
