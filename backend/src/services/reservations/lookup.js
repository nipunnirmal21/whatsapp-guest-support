const supabase = require('../../db/client');
const logger = require('../../utils/logger');
const { normalisePhoneNumber } = require('../whatsapp/parser');

const ACTIVE_RESERVATION_STATUSES = ['confirmed', 'checked_in'];
const ACTIVE_CONVERSATION_STATUSES = ['open', 'escalated', 'manual'];

/**
 * Returns today's date as YYYY-MM-DD (UTC) for reservation date filtering.
 */
function getTodayDateString() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Validates and normalises a phone number to the E.164 digits-only format
 * stored in the guests table (no leading +).
 *
 * @param {string} phoneNumber
 * @returns {string}
 */
function validateAndNormalisePhone(phoneNumber) {
  if (!phoneNumber || typeof phoneNumber !== 'string') {
    throw new Error('phoneNumber is required and must be a string');
  }

  const normalised = normalisePhoneNumber(phoneNumber.trim());

  if (!/^\d{8,15}$/.test(normalised)) {
    throw new Error('phoneNumber must contain 8–15 digits in E.164 format');
  }

  return normalised;
}

/**
 * findReservationByPhone
 * Looks up the most relevant active reservation for a guest phone number.
 *
 * Active = status is confirmed or checked_in, and checkout_date is today or later.
 * When multiple matches exist, returns the reservation with the nearest check-in
 * (current or upcoming stay first).
 *
 * @param {string} phoneNumber - E.164 format, e.g. "919876543210" or "+919876543210"
 * @returns {Promise<object|null>} Structured context or null when no match
 *   {
 *     reservation: { id, booking_id, checkin_date, checkout_date, status, ... },
 *     guest:       { id, full_name, phone_number, email },
 *     apartment:   { id, name, code, address, map_link, wifi_details },
 *     policy:      { checkin_time, checkout_time, parking_info, ... } | null
 *   }
 */
async function findReservationByPhone(phoneNumber) {
  const normalisedPhone = validateAndNormalisePhone(phoneNumber);
  const today = getTodayDateString();

  const { data: guest, error: guestError } = await supabase
    .from('guests')
    .select('id, full_name, phone_number, email')
    .eq('phone_number', normalisedPhone)
    .maybeSingle();

  if (guestError) {
    logger.error('Failed to look up guest by phone', {
      error: guestError.message,
      code: guestError.code,
    });
    throw new Error(`Guest lookup failed: ${guestError.message}`);
  }

  if (!guest) {
    logger.info('No guest found for phone number', {
      phoneSuffix: normalisedPhone.slice(-4),
    });
    return null;
  }

  const { data: reservation, error: reservationError } = await supabase
    .from('reservations')
    .select(
      `
      id,
      booking_source,
      booking_id,
      apartment_id,
      guest_id,
      checkin_date,
      checkout_date,
      status,
      notes,
      created_at,
      apartment:apartments (
        id,
        name,
        code,
        address,
        map_link,
        wifi_details,
        apartment_policies (
          id,
          checkin_time,
          checkout_time,
          parking_info,
          pet_policy,
          extra_guest_policy,
          early_checkin_fee,
          late_checkout_fee,
          max_occupancy
        )
      )
    `
    )
    .eq('guest_id', guest.id)
    .in('status', ACTIVE_RESERVATION_STATUSES)
    .gte('checkout_date', today)
    .order('checkin_date', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (reservationError) {
    logger.error('Failed to look up reservation by guest', {
      guestId: guest.id,
      error: reservationError.message,
      code: reservationError.code,
    });
    throw new Error(`Reservation lookup failed: ${reservationError.message}`);
  }

  if (!reservation) {
    logger.info('No active reservation found for guest', {
      guestId: guest.id,
      phoneSuffix: normalisedPhone.slice(-4),
    });
    return null;
  }

  const apartment = reservation.apartment ?? null;
  const policy = apartment?.apartment_policies?.[0] ?? null;

  if (apartment) {
    delete apartment.apartment_policies;
  }

  logger.info('Active reservation matched', {
    reservationId: reservation.id,
    guestId: guest.id,
    apartmentId: apartment?.id ?? null,
    status: reservation.status,
  });

  return {
    reservation: {
      id: reservation.id,
      booking_source: reservation.booking_source,
      booking_id: reservation.booking_id,
      apartment_id: reservation.apartment_id,
      guest_id: reservation.guest_id,
      checkin_date: reservation.checkin_date,
      checkout_date: reservation.checkout_date,
      status: reservation.status,
      notes: reservation.notes,
      created_at: reservation.created_at,
    },
    guest,
    apartment,
    policy,
  };
}

/**
 * findOrCreateConversation
 * Returns an existing active conversation for the guest/reservation pair,
 * or creates a new one.
 *
 * One active thread per (guest_phone, reservation_id) pair. When no reservation
 * is matched yet, reservationId should be null.
 *
 * @param {string}      guestPhone    - sender phone from WhatsApp webhook
 * @param {string|null} reservationId - matched reservation UUID, or null
 * @returns {Promise<object>} conversation row
 */
async function findOrCreateConversation(guestPhone, reservationId = null) {
  const normalisedPhone = validateAndNormalisePhone(guestPhone);
  const now = new Date().toISOString();

  let findQuery = supabase
    .from('conversations')
    .select('*')
    .eq('guest_phone', normalisedPhone)
    .in('status', ACTIVE_CONVERSATION_STATUSES);

  findQuery = reservationId
    ? findQuery.eq('reservation_id', reservationId)
    : findQuery.is('reservation_id', null);

  const { data: existing, error: findError } = await findQuery
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();

  if (findError) {
    logger.error('Failed to find conversation', {
      guestPhoneSuffix: normalisedPhone.slice(-4),
      reservationId,
      error: findError.message,
      code: findError.code,
    });
    throw new Error(`Conversation lookup failed: ${findError.message}`);
  }

  if (existing) {
    const { data: updated, error: updateError } = await supabase
      .from('conversations')
      .update({ last_message_at: now })
      .eq('id', existing.id)
      .select('*')
      .single();

    if (updateError) {
      logger.error('Failed to update conversation timestamp', {
        conversationId: existing.id,
        error: updateError.message,
      });
      throw new Error(`Conversation update failed: ${updateError.message}`);
    }

    logger.info('Existing conversation found', {
      conversationId: updated.id,
      reservationId: updated.reservation_id,
      status: updated.status,
    });

    return updated;
  }

  const { data: created, error: createError } = await supabase
    .from('conversations')
    .insert({
      guest_phone: normalisedPhone,
      reservation_id: reservationId,
      status: 'open',
      last_message_at: now,
    })
    .select('*')
    .single();

  if (createError) {
    logger.error('Failed to create conversation', {
      guestPhoneSuffix: normalisedPhone.slice(-4),
      reservationId,
      error: createError.message,
      code: createError.code,
    });
    throw new Error(`Conversation creation failed: ${createError.message}`);
  }

  logger.info('New conversation created', {
    conversationId: created.id,
    reservationId: created.reservation_id,
  });

  return created;
}

/**
 * findReservationByBookingId
 * Fallback lookup when phone number match fails.
 * TODO (Phase 3 extension): implement when guest provides booking reference.
 */
async function findReservationByBookingId(bookingId) {
  logger.info('findReservationByBookingId called (stub)', { bookingId });
  return null;
}

module.exports = {
  findReservationByPhone,
  findReservationByBookingId,
  findOrCreateConversation,
};
