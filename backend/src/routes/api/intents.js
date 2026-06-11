const express = require('express');
const router = express.Router();

/**
 * POST /api/intents/classify
 * Internal endpoint to classify a raw guest message text.
 * TODO (Phase 4): call rules engine first, then AI classifier.
 *
 * Returns one of: safe_reply | clarification_needed | human_handover
 */
router.post('/classify', async (req, res, next) => {
  try {
    const { text } = req.body;
    if (!text) {
      return res.status(400).json({ error: '"text" is required' });
    }
    // Stub — Phase 4 will implement rules engine + LLM call
    res.status(200).json({
      success: true,
      classification: 'clarification_needed',
      message: 'Phase 4 stub',
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
