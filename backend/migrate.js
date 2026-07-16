/**
 * Database migration runner
 *
 * Usage (from backend/):
 *   npm run migrate
 *
 * Why `pg` instead of @supabase/supabase-js?
 *   The Supabase JS client talks to PostgREST and cannot execute raw SQL / DDL.
 *   Migrations need a direct Postgres connection (SUPABASE_DB_URL).
 *
 * Required env:
 *   SUPABASE_DB_URL  — Postgres connection string from Supabase
 *                      (Project Settings → Database → Connection string → URI)
 *
 * Optional:
 *   Migrations are idempotent (IF NOT EXISTS / IF NOT EXISTS columns).
 */

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const MIGRATIONS_DIR = path.join(__dirname, 'src', 'db', 'migrations');

function log(level, message, meta) {
  const stamp = new Date().toISOString();
  const extra = meta ? ` ${JSON.stringify(meta)}` : '';
  // eslint-disable-next-line no-console
  console[level === 'error' ? 'error' : 'log'](`[${stamp}] [${level}] ${message}${extra}`);
}

function listMigrationFiles() {
  if (!fs.existsSync(MIGRATIONS_DIR)) {
    throw new Error(`Migrations directory not found: ${MIGRATIONS_DIR}`);
  }

  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

async function run() {
  const connectionString = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;

  if (!connectionString) {
    log(
      'error',
      'Missing SUPABASE_DB_URL (or DATABASE_URL). ' +
        'Copy it from Supabase → Project Settings → Database → Connection string (URI).'
    );
    process.exit(1);
  }

  const files = listMigrationFiles();
  if (files.length === 0) {
    log('error', `No .sql files found in ${MIGRATIONS_DIR}`);
    process.exit(1);
  }

  log('info', `Found ${files.length} migration(s)`, { files });

  const client = new Client({
    connectionString,
    // Supabase pooler / hosted Postgres often needs SSL
    ssl: connectionString.includes('localhost')
      ? false
      : { rejectUnauthorized: false },
  });

  try {
    await client.connect();
    log('info', 'Connected to Postgres');

    for (const file of files) {
      const fullPath = path.join(MIGRATIONS_DIR, file);
      const sql = fs.readFileSync(fullPath, 'utf8');

      log('info', `Applying ${file}…`);
      try {
        await client.query(sql);
        log('info', `Applied ${file}`);
      } catch (err) {
        log('error', `Failed on ${file}`, {
          message: err.message,
          code: err.code,
        });
        throw err;
      }
    }

    log('info', 'All migrations completed successfully');
  } catch (err) {
    log('error', 'Migration run aborted', { message: err.message });
    process.exitCode = 1;
  } finally {
    try {
      await client.end();
    } catch {
      // ignore close errors
    }
  }
}

run();
