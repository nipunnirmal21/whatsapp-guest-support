const { createClient } = require('@supabase/supabase-js');
const logger = require('../utils/logger');

const supabaseUrl  = process.env.SUPABASE_URL;
const supabaseKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  logger.error(
    'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in environment variables'
  );
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    // Service-role key bypasses RLS — keep it server-side only
    persistSession: false,
    autoRefreshToken: false,
  },
});

module.exports = supabase;
