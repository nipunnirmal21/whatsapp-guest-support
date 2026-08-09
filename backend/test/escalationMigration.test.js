const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const migrationPath = path.join(
  __dirname,
  '..',
  'src',
  'db',
  'migrations',
  '008_transaction_safe_escalations.sql'
);
const migration = fs.readFileSync(migrationPath, 'utf8');

function functionBody(name) {
  const pattern = new RegExp(
    `CREATE OR REPLACE FUNCTION ${name}\\([\\s\\S]*?\\n\\$\\$;`,
    'i'
  );
  return migration.match(pattern)?.[0] ?? '';
}

test('escalation hardening migration is atomic and idempotent', () => {
  assert.match(migration, /^\s*--[^\n]*\n\s*BEGIN;/i);
  assert.match(migration, /COMMIT;\s*$/i);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS resolved_by UUID/i);
  assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS/i);
  assert.match(
    migration,
    /WHERE status IN \('pending', 'acknowledged'\)/i
  );
  assert.match(migration, /duplicate_escalation_closed/i);
});

test('database constraints reject invalid escalation and conversation states', () => {
  assert.match(migration, /CONSTRAINT escalations_status_valid/i);
  assert.match(migration, /CONSTRAINT escalations_lifecycle_consistent/i);
  assert.match(migration, /CONSTRAINT conversations_status_valid/i);
});

test('create and resolve functions share the conversation-first row lock', () => {
  const createBody = functionBody('ensure_conversation_escalation');
  const resolveBody = functionBody('resolve_conversation_handover');

  assert.match(createBody, /FROM conversations[\s\S]*?FOR UPDATE/i);
  assert.match(resolveBody, /FROM conversations[\s\S]*?FOR UPDATE/i);
  assert.match(createBody, /Resolved conversation cannot be escalated/i);
  assert.match(resolveBody, /v_already_resolved/i);
  assert.match(resolveBody, /resolved_by = COALESCE\(resolved_by, p_operator_id\)/i);
  assert.match(resolveBody, /resolved_escalation_count/i);
});

test('escalation lifecycle functions write audit events inside the transaction', () => {
  const createBody = functionBody('ensure_conversation_escalation');
  const resolveBody = functionBody('resolve_conversation_handover');

  assert.match(createBody, /INSERT INTO conversation_events/i);
  assert.match(createBody, /'escalated'/i);
  assert.match(resolveBody, /INSERT INTO conversation_events/i);
  assert.match(resolveBody, /'resolved'/i);
  assert.match(resolveBody, /'escalation_state_repaired'/i);
});
