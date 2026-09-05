const express = require('express');
const supabase = require('../../db/client');
const logger = require('../../utils/logger');

const router = express.Router();

/**
 * GET /api/admin-users
 * Returns operators available for dashboard conversation assignment.
 */
router.get('/', async (_req, res, next) => {
  try {
    const { data, error } = await supabase
      .from('admin_users')
      .select('id, auth_user_id, name, email, role')
      .order('name', { ascending: true });

    if (error) {
      logger.error('Failed to list admin users', { error: error.message });
      const serviceError = new Error('Failed to fetch dashboard operators');
      serviceError.status = 500;
      throw serviceError;
    }

    return res.status(200).json({ success: true, data: data ?? [] });
  } catch (error) {
    next(error);
  }
});

module.exports = router;

