const supabase = require('./client');
const logger = require('../utils/logger');

/**
 * Persists the full raw webhook payload from Meta for audit and debugging.
 * This is the first thing that happens on every incoming event — before any
 * business logic — so we always have an immutable record.
 *
 * Supabase table: webhook_raw_events
 *   id         uuid  (default: gen_random_uuid())
 *   payload    jsonb
 *   received_at timestamptz (default: now())
 */
async function saveRawEvent(payload) {
  const { error } = await supabase
    .from('webhook_raw_events')
    .insert({ payload });

  if (error) {
    logger.error('Failed to save raw webhook event to DB', {
      error: error.message,
    });
    // Do not throw — saving raw events must never block message processing
  }
}

module.exports = { saveRawEvent };
