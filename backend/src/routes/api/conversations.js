const express = require('express');
const router = express.Router();
const supabase = require('../../db/client');
const logger = require('../../utils/logger');
const { dispatchTextMessage } = require('../../services/messages/dispatcher');
const requireOperator = require('../../middleware/requireOperator');
const {
  assignConversation,
  startManualMode,
  resumeAutomation,
} = require('../../services/handover/service');

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isValidUuid(value) {
  return typeof value === 'string' && UUID_RE.test(value);
}

/**
 * GET /api/conversations
 * Returns the conversation list for the dashboard, newest activity first.
 * Includes nested reservation / guest / apartment for inbox + reservations views.
 */
router.get('/', async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from('conversations')
      .select(
        `
        *,
        assignee:admin_users!conversations_assigned_to_fkey (
          id,
          name,
          email,
          role
        ),
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
        assignee:admin_users!conversations_assigned_to_fkey (
          id,
          name,
          email,
          role
        ),
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
 * PATCH /api/conversations/:id/assignment
 * Assigns the conversation to an operator and enables manual mode.
 *
 * Body: { assignedTo: string }
 */
router.patch('/:id/assignment', requireOperator, async (req, res, next) => {
  try {
    const { id } = req.params;
    const { assignedTo } = req.body ?? {};

    if (!isValidUuid(id)) {
      return res.status(400).json({ success: false, error: 'Invalid conversation id' });
    }

    if (!isValidUuid(assignedTo)) {
      return res.status(400).json({ success: false, error: 'Invalid assignedTo' });
    }

    const conversation = await assignConversation({
      conversationId: id,
      actorId: req.adminUserId,
      assignedTo,
    });

    return res.status(200).json({ success: true, data: conversation });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/conversations/:id/manual-mode
 * Claims a conversation for the current operator and pauses automation.
 *
 * Body: { reason?: string }
 */
router.post('/:id/manual-mode', requireOperator, async (req, res, next) => {
  try {
    const { id } = req.params;
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : null;

    if (!isValidUuid(id)) {
      return res.status(400).json({ success: false, error: 'Invalid conversation id' });
    }

    if (reason && reason.length > 500) {
      return res.status(400).json({
        success: false,
        error: 'Manual mode reason must be 500 characters or fewer',
      });
    }

    const conversation = await startManualMode({
      conversationId: id,
      operatorId: req.adminUserId,
      reason,
    });

    return res.status(200).json({ success: true, data: conversation });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/conversations/:id/resume-automation
 * Releases the assignment and returns the conversation to automation.
 */
router.post('/:id/resume-automation', requireOperator, async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!isValidUuid(id)) {
      return res.status(400).json({ success: false, error: 'Invalid conversation id' });
    }

    const conversation = await resumeAutomation({
      conversationId: id,
      operatorId: req.adminUserId,
    });

    return res.status(200).json({ success: true, data: conversation });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/conversations/:id/reply
 * Sends a human-authored reply from the dashboard to the guest.
 *
 * Body: { content: string }
 */
router.post('/:id/reply', requireOperator, async (req, res, next) => {
  try {
    const { id } = req.params;
    const { content } = req.body;

    if (!isValidUuid(id)) {
      return res.status(400).json({ success: false, error: 'Invalid conversation id' });
    }

    const trimmedContent = typeof content === 'string' ? content.trim() : '';
    if (!trimmedContent) {
      return res.status(400).json({ success: false, error: '"content" is required' });
    }

    const { data: conversation, error: conversationError } = await supabase
      .from('conversations')
      .select('id, guest_phone')
      .eq('id', id)
      .maybeSingle();

    if (conversationError) {
      logger.error('Failed to fetch conversation for reply', {
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

    await startManualMode({
      conversationId: conversation.id,
      operatorId: req.adminUserId,
      reason: 'Operator sent a dashboard reply',
    });

    const dispatched = await dispatchTextMessage({
      conversationId: conversation.id,
      to: conversation.guest_phone,
      content: trimmedContent,
      source: 'human',
    });
    const message = dispatched.message;

    logger.info('Dashboard reply sent', {
      conversationId: id,
      messageId: message.id,
      waMessageId: dispatched.waMessageId,
    });

    return res.status(200).json({ success: true, data: message });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
