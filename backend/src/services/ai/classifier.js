const OpenAI = require('openai');
const logger = require('../../utils/logger');

const openai = new OpenAI({ apiKey: process.env.LLM_API_KEY });

/**
 * classifyAndDraft
 * Phase 4: calls the LLM only after the rules engine returns 'unhandled'.
 *
 * Instructs the model to return ONLY one of:
 *   safe_reply | clarification_needed | human_handover
 *
 * @param {string} guestText    - raw guest message
 * @param {object} context      - { reservation, apartment, policy }
 * @returns {Promise<{ classification: string, draft: string|null }>}
 */
async function classifyAndDraft(guestText, context) {
  // TODO (Phase 4): build system prompt with context, call openai.chat.completions
  logger.info('classifyAndDraft called (stub)');
  return { classification: 'human_handover', draft: null };
}

module.exports = { classifyAndDraft };
