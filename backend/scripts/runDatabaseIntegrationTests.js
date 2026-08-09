const path = require('node:path');
const { spawnSync } = require('node:child_process');
require('dotenv').config();

if (!process.env.SUPABASE_DB_URL && !process.env.DATABASE_URL) {
  console.error(
    'Database integration tests require SUPABASE_DB_URL or DATABASE_URL.'
  );
  process.exit(1);
}

const testFile = path.join(
  __dirname,
  '..',
  'test',
  'escalationConcurrency.integration.test.js'
);
const result = spawnSync(process.execPath, ['--test', testFile], {
  stdio: 'inherit',
  env: {
    ...process.env,
    RUN_DB_INTEGRATION_TESTS: 'true',
  },
});

if (result.error) {
  throw result.error;
}

process.exit(result.status ?? 1);
