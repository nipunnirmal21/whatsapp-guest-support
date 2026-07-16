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
 * GET /api/escalations
 * Lists escalations for the dashboard (newest first).
 * Optional query: ?status=pending|acknowledged|resolved
 */
router.get('/', async (req, res, next) => {
  try {
    const { status } = req.query;

    let query = supabase
      .from('escalations')
      .select(
        `
        *,
        conversation:conversations (
          id,
          guest_phone,
          status,
          ai_classification,
          ai_draft,
          last_message_at,
          reservation:reservations (
            booking_id,
            status,
            guest:guests (
              full_name,
              phone_number
            ),
            apartment:apartments (
              name,
              code
            )
          )
        )
      `
      )
      .order('created_at', { ascending: false });

    if (status && typeof status === 'string') {
      query = query.eq('status', status.trim().toLowerCase());
    }

    const { data, error } = await query;

    if (error) {
      logger.error('Failed to list escalations', { error: error.message });
      const err = new Error('Failed to fetch escalations');
      err.status = 500;
      throw err;
    }

    return res.status(200).json({ success: true, data: data ?? [] });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/escalations/create
 * Marks a conversation for human handover and records the escalation.
 *
 * Body: { conversationId: string, reason: string, escalatedTo?: string }
 */
router.post('/create', async (req, res, next) => {
  try {
    const { conversationId, reason, escalatedTo } = req.body;

    if (!conversationId || !reason) {
      return res.status(400).json({
        success: false,
        error: '"conversationId" and "reason" are required',
      });
    }

    if (!isValidUuid(conversationId)) {
      return res.status(400).json({ success: false, error: 'Invalid conversationId' });
    }

    if (escalatedTo && !isValidUuid(escalatedTo)) {
      return res.status(400).json({ success: false, error: 'Invalid escalatedTo' });
    }

    const trimmedReason = String(reason).trim();
    if (!trimmedReason) {
      return res.status(400).json({ success: false, error: '"reason" cannot be empty' });
    }

    const { data: existing, error: findError } = await supabase
      .from('conversations')
      .select('id')
      .eq('id', conversationId)
      .maybeSingle();

    if (findError) {
      logger.error('Failed to look up conversation for escalation', {
        conversationId,
        error: findError.message,
      });
      const err = new Error('Failed to escalate conversation');
      err.status = 500;
      throw err;
    }

    if (!existing) {
      return res.status(404).json({ success: false, error: 'Conversation not found' });
    }

    const { data: conversation, error: updateError } = await supabase
      .from('conversations')
      .update({ status: 'escalated' })
      .eq('id', conversationId)
      .select('*')
      .single();

    if (updateError) {
      logger.error('Failed to update conversation status to escalated', {
        conversationId,
        error: updateError.message,
      });
      const err = new Error('Failed to escalate conversation');
      err.status = 500;
      throw err;
    }

    const escalationPayload = {
      conversation_id: conversationId,
      reason: trimmedReason,
      status: 'pending',
    };

    if (escalatedTo) {
      escalationPayload.escalated_to = escalatedTo;
    }

    const { data: escalation, error: escalationError } = await supabase
      .from('escalations')
      .insert(escalationPayload)
      .select('*')
      .single();

    if (escalationError) {
      logger.error('Failed to create escalation record', {
        conversationId,
        error: escalationError.message,
      });
      const err = new Error('Conversation escalated but failed to save escalation record');
      err.status = 500;
      throw err;
    }

    logger.info('Conversation escalated', { conversationId, escalationId: escalation.id });

    return res.status(200).json({
      success: true,
      data: {
        conversation,
        escalation,
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/escalations/resolve
 * Marks a conversation as resolved and closes any open escalations.
 *
 * Body: { conversationId: string }
 */
router.post('/resolve', async (req, res, next) => {
  try {
    const { conversationId } = req.body;

    if (!conversationId) {
      return res.status(400).json({
        success: false,
        error: '"conversationId" is required',
      });
    }

    if (!isValidUuid(conversationId)) {
      return res.status(400).json({ success: false, error: 'Invalid conversationId' });
    }

    const { data: existing, error: findError } = await supabase
      .from('conversations')
      .select('id')
      .eq('id', conversationId)
      .maybeSingle();

    if (findError) {
      logger.error('Failed to look up conversation for resolution', {
        conversationId,
        error: findError.message,
      });
      const err = new Error('Failed to resolve conversation');
      err.status = 500;
      throw err;
    }

    if (!existing) {
      return res.status(404).json({ success: false, error: 'Conversation not found' });
    }

    const { data: conversation, error: updateError } = await supabase
      .from('conversations')
      .update({ status: 'resolved' })
      .eq('id', conversationId)
      .select('*')
      .single();

    if (updateError) {
      logger.error('Failed to update conversation status to resolved', {
        conversationId,
        error: updateError.message,
      });
      const err = new Error('Failed to resolve conversation');
      err.status = 500;
      throw err;
    }

    const { error: escalationError } = await supabase
      .from('escalations')
      .update({ status: 'resolved' })
      .eq('conversation_id', conversationId)
      .in('status', ['pending', 'acknowledged']);

    if (escalationError) {
      logger.error('Failed to resolve escalation records', {
        conversationId,
        error: escalationError.message,
      });
      const err = new Error('Conversation resolved but failed to update escalation records');
      err.status = 500;
      throw err;
    }

    logger.info('Conversation resolved', { conversationId });

    return res.status(200).json({ success: true, data: conversation });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
