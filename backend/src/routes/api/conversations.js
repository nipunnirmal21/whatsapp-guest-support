const express = require('express');
const router = express.Router();
const supabase = require('../../db/client');
const logger = require('../../utils/logger');

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isValidUuid(value) {
  return typeof value === 'string' && UUID_RE.test(value);
}

/**
 * GET /api/conversations
 * Returns the conversation list for the dashboard, newest activity first.
 */
router.get('/', async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from('conversations')
      .select('*')
      .order('last_message_at', { ascending: false, nullsFirst: false });

    if (error) {
      logger.error('Failed to list conversations', { error: error.message });
      const err = new Error('Failed to fetch conversations');
      err.status = 500;
      throw err;
    }

    return res.status(200).json({ success: true, data: data ?? [] });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/conversations/:id
 * Returns a single conversation with its messages and reservation context.
 */
router.get('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!isValidUuid(id)) {
      return res.status(400).json({ success: false, error: 'Invalid conversation id' });
    }

    const { data: conversation, error: conversationError } = await supabase
      .from('conversations')
      .select(
        `
        *,
        reservation:reservations (
          id,
          booking_source,
          booking_id,
          checkin_date,
          checkout_date,
          status,
          guest:guests (
            id,
            full_name,
            phone_number,
            email
          ),
          apartment:apartments (
            id,
            name,
            code,
            address,
            map_link
          )
        )
      `
      )
      .eq('id', id)
      .maybeSingle();

    if (conversationError) {
      logger.error('Failed to fetch conversation', {
        conversationId: id,
        error: conversationError.message,
      });
      const err = new Error('Failed to fetch conversation');
      err.status = 500;
      throw err;
    }

    if (!conversation) {
      return res.status(404).json({ success: false, error: 'Conversation not found' });
    }

    const { data: messages, error: messagesError } = await supabase
      .from('messages')
      .select('*')
      .eq('conversation_id', id)
      .order('created_at', { ascending: true });

    if (messagesError) {
      logger.error('Failed to fetch conversation messages', {
        conversationId: id,
        error: messagesError.message,
      });
      const err = new Error('Failed to fetch conversation messages');
      err.status = 500;
      throw err;
    }

    return res.status(200).json({
      success: true,
      data: {
        ...conversation,
        messages: messages ?? [],
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/conversations/:id/reply
 * Sends or schedules a reply from the dashboard.
 */
router.post('/:id/reply', async (req, res, next) => {
  try {
    res.status(200).json({ success: true, message: 'Phase 5 stub' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
