const BOOKING_ID_PATTERNS = [
  /\b(?:booking|reservation|confirmation)\s+(?:id|number|no\.?|reference|ref|code)\s*(?:is\s*)?[:#-]?\s*([a-z0-9][a-z0-9_-]{2,63})\b/i,
  /\b(?:booking|reservation|confirmation)\s*[:#]\s*([a-z0-9][a-z0-9_-]{2,63})\b/i,
  /\b(?:booking|reservation)\s+is\s+([a-z0-9][a-z0-9_-]{2,63})\b/i,
  /\b(?:reference|ref)\s*(?:id|number|no\.)?\s*(?:is\s*)?[:#-]\s*([a-z0-9][a-z0-9_-]{2,63})\b/i,
];

const GUEST_NAME_PATTERNS = [
  /\bmy\s+(?:full\s+)?name\s+is\s*[:#-]?\s*([^\n,;.!?]{2,100})/i,
  /\b(?:full\s+)?name\s*(?:is\s*)?[:#-]\s*([^\n,;.!?]{2,100})/i,
  /\bguest\s+(?:full\s+)?name\s*(?:is\s*)?[:#-]\s*([^\n,;.!?]{2,100})/i,
  /\bname\s+on\s+(?:the\s+)?(?:booking|reservation)\s*(?:is\s*)?[:#-]?\s*([^\n,;.!?]{2,100})/i,
  /\b(?:booking|reservation)\s+(?:is\s+)?under\s+(?:the\s+)?name(?:\s+of)?\s*[:#-]?\s*([^\n,;.!?]{2,100})/i,
  /\bunder\s+(?:the\s+)?name(?:\s+of)?\s*[:#-]?\s*([^\n,;.!?]{2,100})/i,
];

function normaliseBookingId(value) {
  if (typeof value !== 'string') return null;

  const key = value
    .normalize('NFKC')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');

  return key.length >= 3 && key.length <= 64 ? key : null;
}

function normaliseGuestName(value) {
  if (typeof value !== 'string') return null;

  const key = value
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();

  if (key.length < 2 || key.length > 100) return null;
  if (!/^[\p{L}\p{M}][\p{L}\p{M} .'-]*$/u.test(key)) return null;

  return key;
}

function trimGuestNameCandidate(value) {
  return value
    .replace(
      /\s+and\s+(?:i|my|the|we|our|booking|reservation|check[- ]?in)\b.*$/i,
      ''
    )
    .replace(/\s+(?:booking|reservation)\s+(?:id|number|no\.?|reference)\b.*$/i, '')
    .trim();
}

function extractBookingId(text) {
  if (typeof text !== 'string') return null;

  for (const pattern of BOOKING_ID_PATTERNS) {
    const match = text.match(pattern);
    const key = normaliseBookingId(match?.[1]);
    if (key) {
      return { raw: match[1], key };
    }
  }

  return null;
}

function extractGuestName(text) {
  if (typeof text !== 'string') return null;

  for (const pattern of GUEST_NAME_PATTERNS) {
    const raw = trimGuestNameCandidate(text.match(pattern)?.[1] ?? '');
    const key = normaliseGuestName(raw);
    if (key) {
      return { raw, key };
    }
  }

  return null;
}

function extractReservationIdentifiers(text) {
  return {
    bookingId: extractBookingId(text),
    guestName: extractGuestName(text),
  };
}

module.exports = {
  extractBookingId,
  extractGuestName,
  extractReservationIdentifiers,
  normaliseBookingId,
  normaliseGuestName,
};
