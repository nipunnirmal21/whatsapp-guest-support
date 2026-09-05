const express = require('express');
const router = express.Router();
const supabase = require('../../db/client');
const logger = require('../../utils/logger');
const { ensureEscalation } = require('../../services/escalations/service');
const requireOperator = require('../../middleware/requireOperator');
const {
  takeOverEscalation,
  resolveConversation,
} = require('../../services/handover/service');

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
        assignee:admin_users!escalations_escalated_to_fkey (
          id,
          name,
          email,
          role
        ),
        conversation:conversations (
          id,
          guest_phone,
          status,
          ai_classification,
          ai_draft,
          last_message_at,
          maintenance_cases (
            id,
            apartment_id,
            category,
            severity,
            status,
            description,
            created_at
          ),
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
 * POST /api/escalations/:id/take-over
 * Atomically assigns an escalation and switches its conversation to manual.
 */
router.post('/:id/take-over', requireOperator, async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!isValidUuid(id)) {
      return res.status(400).json({ success: false, error: 'Invalid escalation id' });
    }

    const result = await takeOverEscalation({
      escalationId: id,
      operatorId: req.operator.id,
    });

    return res.status(200).json({ success: true, data: result });
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

    const result = await ensureEscalation({
      conversationId,
      reason: trimmedReason,
      escalatedTo: escalatedTo || null,
    });

    return res.status(result.created ? 201 : 200).json({
      success: true,
      data: {
        conversation: result.conversation,
        escalation: result.escalation,
        created: result.created,
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
router.post('/resolve', requireOperator, async (req, res, next) => {
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

    const conversation = await resolveConversation({
      conversationId,
      operatorId: req.operator.id,
    });

    return res.status(200).json({ success: true, data: conversation });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
