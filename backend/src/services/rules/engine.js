const logger = require('../../utils/logger');

/**
 * runRulesEngine
 * Phase 4: checks structured business data BEFORE any AI call.
 *
 * The rules engine must answer deterministic intents (Wi-Fi, parking,
 * check-in time, etc.) directly without involving the LLM.
 *
 * @param {string} text        - normalised guest message text
 * @param {object} reservation - matched reservation context (or null)
 * @param {object} apartment   - apartment + policy data (or null)
 * @returns {{ outcome: string, reply: string|null }}
 *   outcome: 'auto_reply' | 'needs_approval' | 'escalate' | 'unhandled'
 */
async function runRulesEngine(text, reservation, apartment) {
  // TODO (Phase 4): implement deterministic intent matching
  logger.info('runRulesEngine called (stub)');
  return { outcome: 'unhandled', reply: null };
}

module.exports = { runRulesEngine };
