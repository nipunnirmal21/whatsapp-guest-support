const logger = require('../../utils/logger');

const WIFI_KEYWORDS = [
  'wifi',
  'wi-fi',
  'wi fi',
  'wireless',
  'internet',
  'ssid',
  'network password',
];

const PARKING_KEYWORDS = [
  'parking',
  'park my car',
  'park the car',
  'car park',
  'where to park',
  'garage',
];

const CHECKOUT_KEYWORDS = [
  'check out',
  'check-out',
  'checkout',
  'check out time',
  'leaving time',
  'departure',
  'when do i leave',
];

const CHECKIN_KEYWORDS = [
  'check in',
  'check-in',
  'checkin',
  'check in time',
  'arrival time',
  'when can i arrive',
  'key collection',
  'collect keys',
  'how do i get in',
  'access code',
  'directions',
  'where is the apartment',
  'location',
  'address',
];

const ACTIVE_RESERVATION_STATUSES = ['confirmed', 'checked_in'];

/**
 * @param {string|null|undefined} text
 * @returns {string}
 */
function normaliseText(text) {
  return (text ?? '').toLowerCase().trim();
}

/**
 * @param {string} text
 * @param {string[]} keywords
 * @returns {boolean}
 */
function matchesAny(text, keywords) {
  return keywords.some((keyword) => text.includes(keyword));
}

/**
 * @param {string|null|undefined} timeValue - e.g. "14:00" or "14:00:00"
 * @returns {string|null}
 */
function formatTime(timeValue) {
  if (!timeValue) return null;

  const [hoursPart, minutesPart = '00'] = timeValue.split(':');
  const hours = Number.parseInt(hoursPart, 10);

  if (Number.isNaN(hours)) return timeValue;

  const minutes = minutesPart.padStart(2, '0').slice(0, 2);
  const period = hours >= 12 ? 'PM' : 'AM';
  const hour12 = hours % 12 || 12;

  return `${hour12}:${minutes} ${period}`;
}

/**
 * @param {string|null|undefined} dateValue - YYYY-MM-DD
 * @returns {string|null}
 */
function formatDate(dateValue) {
  if (!dateValue) return null;

  const date = new Date(`${dateValue}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return dateValue;

  return date.toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/**
 * @param {object|null} apartment
 * @returns {{ apartment: object|null, policy: object|null }}
 */
function splitApartmentAndPolicy(apartment) {
  if (!apartment) {
    return { apartment: null, policy: null };
  }

  const { policy, ...apartmentData } = apartment;
  return {
    apartment: apartmentData,
    policy: policy ?? null,
  };
}

/**
 * @param {object|null} reservation
 * @returns {boolean}
 */
function hasActiveReservation(reservation) {
  if (!reservation) return false;

  const today = new Date().toISOString().slice(0, 10);

  return (
    ACTIVE_RESERVATION_STATUSES.includes(reservation.status) &&
    reservation.checkout_date >= today
  );
}

/**
 * @param {object|null} reservation
 * @returns {boolean}
 */
function isCheckinWindowOpen(reservation) {
  if (!hasActiveReservation(reservation)) return false;

  const today = new Date().toISOString().slice(0, 10);

  return reservation.checkin_date >= today || reservation.status === 'checked_in';
}

/**
 * @param {object|null} apartment
 * @param {object|null} policy
 * @returns {string|null}
 */
function buildWifiReply(apartment, policy) {
  const wifi = apartment?.wifi_details;

  if (!wifi?.ssid || !wifi?.password) {
    return null;
  }

  const apartmentName = apartment.name ?? 'your apartment';

  return (
    `The Wi-Fi for ${apartmentName} is:\n` +
    `Network: ${wifi.ssid}\n` +
    `Password: ${wifi.password}\n\n` +
    `Let us know if you need anything else.`
  );
}

/**
 * @param {object|null} apartment
 * @param {object|null} policy
 * @returns {string|null}
 */
function buildParkingReply(apartment, policy) {
  if (!policy?.parking_info) {
    return null;
  }

  const apartmentName = apartment?.name ?? 'your apartment';

  return (
    `Parking information for ${apartmentName}:\n` +
    `${policy.parking_info}\n\n` +
    `Let us know if you need anything else.`
  );
}

/**
 * @param {object|null} reservation
 * @param {object|null} apartment
 * @param {object|null} policy
 * @returns {string|null}
 */
function buildCheckinReply(reservation, apartment, policy) {
  if (!isCheckinWindowOpen(reservation) || !apartment) {
    return null;
  }

  const apartmentName = apartment.name ?? 'your apartment';
  const checkinTime = formatTime(policy?.checkin_time) ?? '2:00 PM';
  const checkinDate = formatDate(reservation.checkin_date);
  const lines = [
    `Check-in for ${apartmentName} is from ${checkinTime}` +
      (checkinDate ? ` on ${checkinDate}` : '') +
      '.',
  ];

  if (apartment.address) {
    lines.push(`Address: ${apartment.address}`);
  }

  if (apartment.map_link) {
    lines.push(`Directions: ${apartment.map_link}`);
  }

  lines.push('Let us know if you need anything else before arrival.');

  return lines.join('\n');
}

/**
 * @param {object|null} reservation
 * @param {object|null} apartment
 * @param {object|null} policy
 * @returns {string|null}
 */
function buildCheckoutReply(reservation, apartment, policy) {
  if (!hasActiveReservation(reservation) || !apartment) {
    return null;
  }

  const apartmentName = apartment.name ?? 'your apartment';
  const checkoutTime = formatTime(policy?.checkout_time) ?? '11:00 AM';
  const checkoutDate = formatDate(reservation.checkout_date);

  return (
    `Check-out for ${apartmentName} is by ${checkoutTime}` +
    (checkoutDate ? ` on ${checkoutDate}` : '') +
    '.\n\nPlease leave keys as instructed in your check-in details and ensure the apartment is secured before you leave.\n\nLet us know if you need anything else.'
  );
}

/**
 * runRulesEngine
 * Checks structured business data BEFORE any AI call.
 *
 * @param {string}      text        - guest message text
 * @param {object|null} reservation - matched reservation row
 * @param {object|null} apartment   - apartment row; may include nested `policy`
 * @returns {Promise<{ outcome: 'auto_reply' | 'unhandled', reply: string|null }>}
 */
async function runRulesEngine(text, reservation, apartment) {
  try {
    const normalised = normaliseText(text);

    if (!normalised) {
      logger.info('Rules engine received empty message text');
      return { outcome: 'unhandled', reply: null };
    }

    const { apartment: apartmentData, policy } = splitApartmentAndPolicy(apartment);

    if (matchesAny(normalised, WIFI_KEYWORDS)) {
      const reply = buildWifiReply(apartmentData, policy);

      if (reply) {
        logger.info('Rules engine matched wifi intent', {
          apartmentId: apartmentData?.id ?? null,
        });
        return { outcome: 'auto_reply', reply };
      }

      logger.info('Rules engine wifi intent missing structured data');
      return { outcome: 'unhandled', reply: null };
    }

    if (matchesAny(normalised, PARKING_KEYWORDS)) {
      const reply = buildParkingReply(apartmentData, policy);

      if (reply) {
        logger.info('Rules engine matched parking intent', {
          apartmentId: apartmentData?.id ?? null,
        });
        return { outcome: 'auto_reply', reply };
      }

      logger.info('Rules engine parking intent missing structured data');
      return { outcome: 'unhandled', reply: null };
    }

    if (matchesAny(normalised, CHECKOUT_KEYWORDS)) {
      const reply = buildCheckoutReply(reservation, apartmentData, policy);

      if (reply) {
        logger.info('Rules engine matched check-out intent', {
          reservationId: reservation?.id ?? null,
        });
        return { outcome: 'auto_reply', reply };
      }

      logger.info('Rules engine check-out intent could not be answered deterministically');
      return { outcome: 'unhandled', reply: null };
    }

    if (matchesAny(normalised, CHECKIN_KEYWORDS)) {
      const reply = buildCheckinReply(reservation, apartmentData, policy);

      if (reply) {
        logger.info('Rules engine matched check-in intent', {
          reservationId: reservation?.id ?? null,
        });
        return { outcome: 'auto_reply', reply };
      }

      logger.info('Rules engine check-in intent could not be answered deterministically');
      return { outcome: 'unhandled', reply: null };
    }

    logger.info('Rules engine found no matching intent');
    return { outcome: 'unhandled', reply: null };
  } catch (err) {
    logger.error('Rules engine failed', {
      error: err.message,
      stack: err.stack,
    });
    return { outcome: 'unhandled', reply: null };
  }
}

module.exports = { runRulesEngine };
