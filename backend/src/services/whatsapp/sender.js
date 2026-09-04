const axios = require('axios');
const logger = require('../../utils/logger');

const WHATSAPP_API_VERSION = 'v20.0';
const BASE_URL = `https://graph.facebook.com/${WHATSAPP_API_VERSION}`;

function getPhoneSuffix(phoneNumber) {
  return String(phoneNumber ?? '').slice(-4);
}

// ---------------------------------------------------------------------------
// getHeaders – builds the Authorization header for every Cloud API request
// ---------------------------------------------------------------------------
function getHeaders() {
  return {
    Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
    'Content-Type': 'application/json',
  };
}

// ---------------------------------------------------------------------------
// sendTextMessage
// Sends a plain text message to a single recipient phone number.
//
// @param {string} to   - recipient phone in E.164 format, e.g. "919876543210"
// @param {string} text - message body (max 4096 chars for WhatsApp)
// @returns {Promise<object>} - Cloud API response body
// ---------------------------------------------------------------------------
async function sendTextMessage(to, text) {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;

  const payload = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'text',
    text: {
      preview_url: false,
      body: text,
    },
  };

  try {
    const response = await axios.post(
      `${BASE_URL}/${phoneNumberId}/messages`,
      payload,
      { headers: getHeaders() }
    );

    logger.info('Text message sent successfully', {
      recipientPhoneSuffix: getPhoneSuffix(to),
      waMessageId: response.data?.messages?.[0]?.id,
    });

    return response.data;
  } catch (err) {
    const errorDetail = err.response?.data?.error?.message ?? err.message;
    logger.error('Failed to send text message', {
      recipientPhoneSuffix: getPhoneSuffix(to),
      error: errorDetail,
    });
    throw err;
  }
}

// ---------------------------------------------------------------------------
// sendTemplateMessage
// Sends an approved WhatsApp template message.
//
// @param {string} to           - recipient phone in E.164 format
// @param {string} templateName - approved template name in WhatsApp Manager
// @param {string} languageCode - e.g. "en_US"
// @param {Array}  components   - header / body / button variable components
// @returns {Promise<object>}
// ---------------------------------------------------------------------------
async function sendTemplateMessage(to, templateName, languageCode = 'en_US', components = []) {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;

  const payload = {
    messaging_product: 'whatsapp',
    to,
    type: 'template',
    template: {
      name: templateName,
      language: { code: languageCode },
      components,
    },
  };

  try {
    const response = await axios.post(
      `${BASE_URL}/${phoneNumberId}/messages`,
      payload,
      { headers: getHeaders() }
    );

    logger.info('Template message sent successfully', {
      recipientPhoneSuffix: getPhoneSuffix(to),
      templateName,
      waMessageId: response.data?.messages?.[0]?.id,
    });

    return response.data;
  } catch (err) {
    const errorDetail = err.response?.data?.error?.message ?? err.message;
    logger.error('Failed to send template message', {
      recipientPhoneSuffix: getPhoneSuffix(to),
      templateName,
      error: errorDetail,
    });
    throw err;
  }
}

// ---------------------------------------------------------------------------
// markMessageAsRead
// Sends a read receipt for an inbound message.
//
// @param {string} waMessageId - the wa_message_id from the incoming webhook
// ---------------------------------------------------------------------------
async function markMessageAsRead(waMessageId) {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;

  const payload = {
    messaging_product: 'whatsapp',
    status: 'read',
    message_id: waMessageId,
  };

  try {
    await axios.post(
      `${BASE_URL}/${phoneNumberId}/messages`,
      payload,
      { headers: getHeaders() }
    );
    logger.info('Message marked as read', { waMessageId });
  } catch (err) {
    // Non-critical — log and continue
    logger.warn('Failed to mark message as read', {
      waMessageId,
      error: err.response?.data?.error?.message ?? err.message,
    });
  }
}

module.exports = { sendTextMessage, sendTemplateMessage, markMessageAsRead };
