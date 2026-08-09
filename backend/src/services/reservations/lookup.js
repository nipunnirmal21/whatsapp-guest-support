const logger = require('../../utils/logger');
const { normalisePhoneNumber } = require('../whatsapp/parser');
const {
  extractReservationIdentifiers,
  normaliseBookingId,
  normaliseGuestName,
} = require('./identifierExtractor');

const ACTIVE_RESERVATION_STATUSES = ['confirmed', 'checked_in'];
const ACTIVE_CONVERSATION_STATUSES = ['open', 'escalated', 'manual'];
const MAX_FALLBACK_CANDIDATES = 3;
let supabaseClient;

function getSupabase() {
  if (!supabaseClient) {
    supabaseClient = require('../../db/client');
  }
  return supabaseClient;
}

const RESERVATION_CONTEXT_SELECT = `
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
  guest:guests!inner (
    id,
    full_name,
    phone_number,
    email,
    name_lookup_key
  ),
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
`;

function getTodayDateString() {
  return new Date().toISOString().slice(0, 10);
}

function validateAndNormalisePhone(phoneNumber) {
  if (!phoneNumber || typeof phoneNumber !== 'string') {
    throw new Error('phoneNumber is required and must be a string');
  }

  const normalised = normalisePhoneNumber(phoneNumber.trim());

  if (!/^\d{8,15}$/.test(normalised)) {
    throw new Error('phoneNumber must contain 8-15 digits in E.164 format');
  }

  return normalised;
}

function createActiveReservationQuery() {
  return getSupabase()
    .from('reservations')
    .select(RESERVATION_CONTEXT_SELECT)
    .in('status', ACTIVE_RESERVATION_STATUSES)
    .gte('checkout_date', getTodayDateString())
    .order('checkin_date', { ascending: true });
}

function toReservationContext(row) {
  if (!row) return null;

  const apartmentRow = row.apartment ?? null;
  const { apartment_policies: policies = [], ...apartment } = apartmentRow ?? {};

  return {
    reservation: {
      id: row.id,
      booking_source: row.booking_source,
      booking_id: row.booking_id,
      apartment_id: row.apartment_id,
      guest_id: row.guest_id,
      checkin_date: row.checkin_date,
      checkout_date: row.checkout_date,
      status: row.status,
      notes: row.notes,
      created_at: row.created_at,
    },
    guest: row.guest ?? null,
    apartment: apartmentRow ? apartment : null,
    policy: policies[0] ?? null,
  };
}

function throwLookupError(message, error, metadata = {}) {
  logger.error(message, {
    ...metadata,
    error: error.message,
    code: error.code,
  });
  throw new Error(`${message}: ${error.message}`);
}

async function findReservationByPhone(phoneNumber) {
  const normalisedPhone = validateAndNormalisePhone(phoneNumber);
  const { data, error } = await createActiveReservationQuery()
    .eq('guest.phone_number', normalisedPhone)
    .limit(1)
    .maybeSingle();

  if (error) {
    throwLookupError('Reservation lookup by phone failed', error, {
      phoneSuffix: normalisedPhone.slice(-4),
    });
  }

  if (!data) {
    logger.info('No active reservation found by phone', {
      phoneSuffix: normalisedPhone.slice(-4),
    });
    return null;
  }

  const context = toReservationContext(data);
  logger.info('Active reservation matched by phone', {
    reservationId: context.reservation.id,
    phoneSuffix: normalisedPhone.slice(-4),
  });
  return context;
}

async function findReservationCandidatesByBookingId(bookingId) {
  const lookupKey = normaliseBookingId(bookingId);
  if (!lookupKey) return [];

  const { data, error } = await createActiveReservationQuery()
    .eq('booking_lookup_key', lookupKey)
    .limit(MAX_FALLBACK_CANDIDATES);

  if (error) {
    throwLookupError('Reservation lookup by Booking ID failed', error);
  }

  return (data ?? []).map(toReservationContext);
}

async function findReservationByBookingId(bookingId) {
  const candidates = await findReservationCandidatesByBookingId(bookingId);
  return candidates.length === 1 ? candidates[0] : null;
}

async function findReservationCandidatesByGuestName(guestName) {
  const lookupKey = normaliseGuestName(guestName);
  if (!lookupKey) return [];

  const { data, error } = await createActiveReservationQuery()
    .eq('guest.name_lookup_key', lookupKey)
    .limit(MAX_FALLBACK_CANDIDATES);

  if (error) {
    throwLookupError('Reservation lookup by guest name failed', error);
  }

  return (data ?? []).map(toReservationContext);
}

async function findExistingConversationReservation(phoneNumber) {
  const normalisedPhone = validateAndNormalisePhone(phoneNumber);
  const { data: conversation, error } = await getSupabase()
    .from('conversations')
    .select(
      'id, reservation_id, reservation_candidate_id, reservation_match_method, reservation_match_status'
    )
    .eq('guest_phone', normalisedPhone)
    .in('status', ACTIVE_CONVERSATION_STATUSES)
    .or('reservation_id.not.is.null,reservation_candidate_id.not.is.null')
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throwLookupError('Existing conversation reservation lookup failed', error, {
      phoneSuffix: normalisedPhone.slice(-4),
    });
  }

  if (!conversation) return null;

  const reservationId =
    conversation.reservation_id ?? conversation.reservation_candidate_id;
  const { data: reservation, error: reservationError } = await createActiveReservationQuery()
    .eq('id', reservationId)
    .limit(1)
    .maybeSingle();

  if (reservationError) {
    throwLookupError('Linked reservation lookup failed', reservationError, {
      conversationId: conversation.id,
    });
  }

  if (!reservation) return null;

  return {
    context: toReservationContext(reservation),
    method: conversation.reservation_match_method ?? 'existing_conversation',
    status: conversation.reservation_id ? 'verified' : 'provisional',
  };
}

async function resolveReservationContextByConversationId(conversationId) {
  const { data: conversation, error } = await getSupabase()
    .from('conversations')
    .select(
      'id, reservation_id, reservation_candidate_id, reservation_match_method, reservation_match_status'
    )
    .eq('id', conversationId)
    .maybeSingle();

  if (error) {
    throwLookupError('Conversation reservation context lookup failed', error, {
      conversationId,
    });
  }

  if (!conversation) return null;

  const matchStatus =
    conversation.reservation_match_status ??
    (conversation.reservation_id ? 'verified' : 'unmatched');
  const matchMethod = conversation.reservation_match_method ?? 'existing_conversation';

  if (matchStatus !== 'verified' || !conversation.reservation_id) {
    return {
      reservationContext: null,
      candidateReservationId: conversation.reservation_candidate_id ?? null,
      match: {
        status: matchStatus,
        method: matchMethod,
        reason:
          matchStatus === 'provisional'
            ? 'booking_id_verification_required'
            : 'conversation_has_no_verified_reservation',
      },
    };
  }

  const { data: reservation, error: reservationError } =
    await createActiveReservationQuery()
      .eq('id', conversation.reservation_id)
      .limit(1)
      .maybeSingle();

  if (reservationError) {
    throwLookupError('Conversation linked reservation lookup failed', reservationError, {
      conversationId,
      reservationId: conversation.reservation_id,
    });
  }

  if (!reservation) {
    return {
      reservationContext: null,
      candidateReservationId: null,
      match: {
        status: 'unmatched',
        method: matchMethod,
        reason: 'linked_reservation_not_active',
      },
    };
  }

  return {
    reservationContext: toReservationContext(reservation),
    candidateReservationId: null,
    match: { status: 'verified', method: matchMethod, reason: null },
  };
}

function createReservationResolver({
  findByPhone,
  findByBookingId,
  findByGuestName,
  findByExistingConversation,
  extractIdentifiers = extractReservationIdentifiers,
  logger: serviceLogger,
}) {
  async function resolveReservationContext({ phoneNumber, messageText }) {
    const identifiers = extractIdentifiers(messageText ?? '');
    const phoneContext = await findByPhone(phoneNumber);

    if (phoneContext) {
      return {
        reservationContext: phoneContext,
        candidateReservationId: null,
        match: { status: 'verified', method: 'phone', reason: null },
      };
    }

    if (identifiers.bookingId) {
      const bookingCandidates = await findByBookingId(identifiers.bookingId.key);

      if (bookingCandidates.length > 1) {
        serviceLogger.warn('Booking ID fallback returned multiple active reservations', {
          candidateCount: bookingCandidates.length,
        });
        return {
          reservationContext: null,
          candidateReservationId: null,
          match: {
            status: 'ambiguous',
            method: 'booking_id',
            reason: 'multiple_active_reservations',
          },
        };
      }

      if (bookingCandidates.length === 1) {
        const context = bookingCandidates[0];
        const suppliedName = identifiers.guestName?.key ?? null;
        const reservationName = normaliseGuestName(context.guest?.full_name);

        if (suppliedName && suppliedName !== reservationName) {
          serviceLogger.warn('Booking ID and supplied guest name do not match');
          return {
            reservationContext: null,
            candidateReservationId: null,
            match: {
              status: 'mismatch',
              method: 'booking_id',
              reason: 'guest_name_mismatch',
            },
          };
        }

        return {
          reservationContext: context,
          candidateReservationId: null,
          match: { status: 'verified', method: 'booking_id', reason: null },
        };
      }

      return {
        reservationContext: null,
        candidateReservationId: null,
        match: {
          status: 'unmatched',
          method: 'booking_id',
          reason: 'booking_id_not_found',
        },
      };
    }

    const existing = await findByExistingConversation(phoneNumber);
    if (existing?.status === 'verified') {
      return {
        reservationContext: existing.context,
        candidateReservationId: null,
        match: {
          status: 'verified',
          method: existing.method || 'existing_conversation',
          reason: null,
        },
      };
    }

    if (existing?.status === 'provisional') {
      return {
        reservationContext: null,
        candidateReservationId: existing.context.reservation.id,
        match: {
          status: 'provisional',
          method: existing.method || 'guest_name',
          reason: 'booking_id_verification_required',
        },
      };
    }

    if (identifiers.guestName) {
      const nameCandidates = await findByGuestName(identifiers.guestName.key);

      if (nameCandidates.length === 1) {
        return {
          reservationContext: null,
          candidateReservationId: nameCandidates[0].reservation.id,
          match: {
            status: 'provisional',
            method: 'guest_name',
            reason: 'booking_id_verification_required',
          },
        };
      }

      if (nameCandidates.length > 1) {
        return {
          reservationContext: null,
          candidateReservationId: null,
          match: {
            status: 'ambiguous',
            method: 'guest_name',
            reason: 'multiple_active_reservations',
          },
        };
      }

      return {
        reservationContext: null,
        candidateReservationId: null,
        match: {
          status: 'unmatched',
          method: 'guest_name',
          reason: 'guest_name_not_found',
        },
      };
    }

    return {
      reservationContext: null,
      candidateReservationId: null,
      match: { status: 'unmatched', method: null, reason: 'no_identifier' },
    };
  }

  return { resolveReservationContext };
}

let defaultResolver;

function getDefaultResolver() {
  if (defaultResolver) return defaultResolver;

  defaultResolver = createReservationResolver({
    findByPhone: findReservationByPhone,
    findByBookingId: findReservationCandidatesByBookingId,
    findByGuestName: findReservationCandidatesByGuestName,
    findByExistingConversation: findExistingConversationReservation,
    logger,
  });

  return defaultResolver;
}

function createConversationLinker({ runLinkConversation, logger: serviceLogger }) {
  async function findOrCreateConversation(
    guestPhone,
    reservationId = null,
    match = {}
  ) {
    const normalisedPhone = validateAndNormalisePhone(guestPhone);
    const matchStatus = match.status ?? (reservationId ? 'verified' : 'unmatched');
    const data = await runLinkConversation({
      guestPhone: normalisedPhone,
      reservationId,
      candidateReservationId: match.candidateReservationId ?? null,
      matchMethod: match.method ?? null,
      matchStatus,
    });

    const conversation = Array.isArray(data) ? data[0] : data;
    if (!conversation?.id) {
      throw new Error('Conversation lookup/link returned an invalid result');
    }

    serviceLogger.info('Active conversation resolved', {
      conversationId: conversation.id,
      reservationId: conversation.reservation_id ?? null,
      candidateReservationId: conversation.reservation_candidate_id ?? null,
      matchMethod: conversation.reservation_match_method ?? null,
      matchStatus: conversation.reservation_match_status ?? null,
    });

    return conversation;
  }

  return { findOrCreateConversation };
}

let defaultConversationLinker;

function getDefaultConversationLinker() {
  if (defaultConversationLinker) return defaultConversationLinker;

  defaultConversationLinker = createConversationLinker({
    logger,
    async runLinkConversation(payload) {
      const { data, error } = await getSupabase().rpc('find_or_link_active_conversation', {
        p_guest_phone: payload.guestPhone,
        p_reservation_id: payload.reservationId,
        p_candidate_reservation_id: payload.candidateReservationId,
        p_match_method: payload.matchMethod,
        p_match_status: payload.matchStatus,
      });

      if (error) {
        const migrationHint = error.code === 'PGRST202'
          ? ' Run migration 006_reservation_fallback.sql.'
          : '';
        throw new Error(`Conversation lookup/link failed: ${error.message}.${migrationHint}`);
      }

      return data;
    },
  });

  return defaultConversationLinker;
}

module.exports = {
  ACTIVE_RESERVATION_STATUSES,
  createConversationLinker,
  createReservationResolver,
  findExistingConversationReservation,
  findOrCreateConversation: (...args) =>
    getDefaultConversationLinker().findOrCreateConversation(...args),
  findReservationByBookingId,
  findReservationByPhone,
  findReservationCandidatesByBookingId,
  findReservationCandidatesByGuestName,
  resolveReservationContext: (...args) =>
    getDefaultResolver().resolveReservationContext(...args),
  resolveReservationContextByConversationId,
  toReservationContext,
  validateAndNormalisePhone,
};
