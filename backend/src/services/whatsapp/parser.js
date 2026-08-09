/**
 * Utility helpers for normalising and extracting data from Meta webhook payloads.
 */

const logger = require('../../utils/logger');

/** Max guest text length processed by rules/AI (mitigates oversized payloads / prompt injection). */
const MAX_GUEST_TEXT_LENGTH = 1000;

/**
 * Truncates guest text to MAX_GUEST_TEXT_LENGTH characters.
 * Returns null for empty/null input.
 *
 * @param {string|null|undefined} text
 * @returns {string|null}
 */
function truncateGuestText(text) {
  if (text === null || text === undefined) return null;

  const normalised = String(text);
  if (normalised.length <= MAX_GUEST_TEXT_LENGTH) {
    return normalised;
  }

  logger.warn('Inbound guest text truncated', {
    originalLength: normalised.length,
    maxLength: MAX_GUEST_TEXT_LENGTH,
  });

  return normalised.slice(0, MAX_GUEST_TEXT_LENGTH);
}

/**
 * extractTextFromMessage
 * Returns the text content from a WhatsApp message object, regardless of type.
 * Text longer than MAX_GUEST_TEXT_LENGTH is truncated (not rejected) so Meta
 * deliveries are still acknowledged and processed safely.
 *
 * @param {object} message - the message object from value.messages[]
 * @returns {string|null}
 */
function extractTextFromMessage(message) {
  let text = null;

  switch (message.type) {
    case 'text':
      text = message.text?.body ?? null;
      break;
    case 'button':
      text = message.button?.text ?? null;
      break;
    case 'interactive':
      text =
        message.interactive?.button_reply?.title ??
        message.interactive?.list_reply?.title ??
        null;
      break;
    default:
      text = null;
  }

  return truncateGuestText(text);
}

/**
 * normalisePhoneNumber
 * Strips any leading + and whitespace from a phone number string.
 * Meta delivers numbers without +, but some integrations add it.
 *
 * @param {string} phone
 * @returns {string}
 */
function normalisePhoneNumber(phone) {
  return phone.replace(/^\+/, '').replace(/\s/g, '');
}

module.exports = {
  extractTextFromMessage,
  normalisePhoneNumber,
  truncateGuestText,
  MAX_GUEST_TEXT_LENGTH,
};
