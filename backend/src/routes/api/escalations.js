const express = require('express');
const router = express.Router();

/**
 * POST /api/escalations/create
 * Marks a conversation for human handover.
 * TODO (Phase 5): persist to escalations table, notify assigned staff.
 */
router.post('/create', async (req, res, next) => {
  try {
    const { conversationId, reason } = req.body;
    if (!conversationId || !reason) {
      return res.status(400).json({ error: '"conversationId" and "reason" are required' });
    }
    // Stub — Phase 5 will implement DB write + dashboard notification
    res.status(200).json({ success: true, message: 'Phase 5 stub' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
