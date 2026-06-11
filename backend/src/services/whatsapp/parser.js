/**
 * Utility helpers for normalising and extracting data from Meta webhook payloads.
 */

/**
 * extractTextFromMessage
 * Returns the text content from a WhatsApp message object, regardless of type.
 *
 * @param {object} message - the message object from value.messages[]
 * @returns {string|null}
 */
function extractTextFromMessage(message) {
  switch (message.type) {
    case 'text':
      return message.text?.body ?? null;
    case 'button':
      return message.button?.text ?? null;
    case 'interactive':
      return (
        message.interactive?.button_reply?.title ??
        message.interactive?.list_reply?.title ??
        null
      );
    default:
      return null;
  }
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

module.exports = { extractTextFromMessage, normalisePhoneNumber };
