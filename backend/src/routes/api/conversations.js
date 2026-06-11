const express = require('express');
const router = express.Router();

/**
 * GET /api/conversations
 * Returns the conversation list for the dashboard.
 * TODO (Phase 5): implement filters, pagination, and reservation context.
 */
router.get('/', async (req, res, next) => {
  try {
    // Stub — replace with Supabase query in Phase 5
    res.status(200).json({ success: true, data: [], message: 'Phase 5 stub' });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/conversations/:id
 * Returns a single conversation with guest, reservation, and apartment context.
 */
router.get('/:id', async (req, res, next) => {
  try {
    res.status(200).json({ success: true, data: null, message: 'Phase 5 stub' });
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
