const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const migration = fs.readFileSync(
  path.join(
    __dirname,
    '..',
    'src',
    'db',
    'migrations',
    '009_supabase_dashboard_auth.sql'
  ),
  'utf8'
);

test('dashboard auth migration safely binds operators to Supabase Auth users', () => {
  assert.match(migration, /^\s*--[^\n]*\n\s*BEGIN;/i);
  assert.match(migration, /COMMIT;\s*$/i);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS auth_user_id UUID/i);
  assert.match(migration, /lower\(operator\.email\) = lower\(auth_user\.email\)/i);
  assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS/i);
  assert.match(migration, /REFERENCES auth\.users\(id\)/i);
  assert.match(migration, /ON DELETE RESTRICT/i);
});
