const express = require('express');
const {
  getAutomationSettings,
  updateAutomationSettings,
} = require('../../services/settings/automation');

const router = express.Router();

router.get('/automation', async (_req, res, next) => {
  try {
    const settings = await getAutomationSettings();
    return res.status(200).json({ success: true, data: settings });
  } catch (error) {
    next(error);
  }
});

router.patch('/automation', async (req, res, next) => {
  try {
    const settings = await updateAutomationSettings(req.body ?? {});
    return res.status(200).json({ success: true, data: settings });
  } catch (error) {
    if (
      /must be a boolean|Unknown automation setting|At least one/.test(
        error.message
      )
    ) {
      return res.status(400).json({ success: false, error: error.message });
    }
    next(error);
  }
});

module.exports = router;
