const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { Pool } = require('pg');
require('dotenv').config();

const shouldRun = process.env.RUN_DB_INTEGRATION_TESTS === 'true';

test(
  'concurrent escalation create and resolve operations remain consistent',
  { skip: !shouldRun, timeout: 30000 },
  async () => {
    const connectionString = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;
    assert.ok(
      connectionString,
      'SUPABASE_DB_URL or DATABASE_URL is required when RUN_DB_INTEGRATION_TESTS=true'
    );

    const pool = new Pool({
      connectionString,
      max: 12,
      ssl: connectionString.includes('localhost')
        ? false
        : { rejectUnauthorized: false },
    });
    const operatorId = crypto.randomUUID();
    const conversationId = crypto.randomUUID();
    const raceConversationId = crypto.randomUUID();
    const testPhone = `test-${crypto.randomUUID()}`;

    try {
      await pool.query(
        `INSERT INTO admin_users (id, name, email, role)
         VALUES ($1, 'Escalation concurrency test', $2, 'admin')`,
        [operatorId, `${operatorId}@example.invalid`]
      );
      await pool.query(
        `INSERT INTO conversations (id, guest_phone, status)
         VALUES
           ($1, $3, 'open'),
           ($2, $4, 'open')`,
        [conversationId, raceConversationId, testPhone, `${testPhone}-race`]
      );

      const createResults = await Promise.all(
        Array.from({ length: 12 }, (_, index) =>
          pool.query(
            `SELECT * FROM ensure_conversation_escalation($1, $2, NULL)`,
            [conversationId, `Concurrent reason ${index}`]
          )
        )
      );
      const createdCount = createResults.filter(
        (result) => result.rows[0]?.created === true
      ).length;
      assert.equal(createdCount, 1);

      const openEscalations = await pool.query(
        `SELECT count(*)::INTEGER AS count
           FROM escalations
          WHERE conversation_id = $1
            AND status IN ('pending', 'acknowledged')`,
        [conversationId]
      );
      assert.equal(openEscalations.rows[0].count, 1);

      const resolveResults = await Promise.all(
        Array.from({ length: 4 }, () =>
          pool.query(
            `SELECT resolve_conversation_handover($1, $2) AS result`,
            [conversationId, operatorId]
          )
        )
      );
      assert.ok(
        resolveResults.every((result) => result.rows[0].result.status === 'resolved')
      );

      const finalState = await pool.query(
        `SELECT
           (SELECT status FROM conversations WHERE id = $1) AS conversation_status,
           (SELECT count(*)::INTEGER
              FROM escalations
             WHERE conversation_id = $1
               AND status IN ('pending', 'acknowledged')) AS open_escalations,
           (SELECT count(*)::INTEGER
              FROM conversation_events
             WHERE conversation_id = $1
               AND event_type = 'escalated') AS escalated_events,
           (SELECT count(*)::INTEGER
              FROM conversation_events
             WHERE conversation_id = $1
               AND event_type = 'resolved') AS resolved_events`,
        [conversationId]
      );

      assert.deepEqual(finalState.rows[0], {
        conversation_status: 'resolved',
        open_escalations: 0,
        escalated_events: 1,
        resolved_events: 1,
      });

      const raceResults = await Promise.allSettled([
        pool.query(
          `SELECT * FROM ensure_conversation_escalation($1, $2, NULL)`,
          [raceConversationId, 'Create versus resolve race']
        ),
        pool.query(
          `SELECT resolve_conversation_handover($1, $2) AS result`,
          [raceConversationId, operatorId]
        ),
      ]);

      assert.equal(raceResults[1].status, 'fulfilled');
      if (raceResults[0].status === 'rejected') {
        assert.equal(raceResults[0].reason.code, 'P0001');
      }

      const raceFinalState = await pool.query(
        `SELECT
           (SELECT status FROM conversations WHERE id = $1) AS conversation_status,
           (SELECT count(*)::INTEGER
              FROM escalations
             WHERE conversation_id = $1
               AND status IN ('pending', 'acknowledged')) AS open_escalations`,
        [raceConversationId]
      );
      assert.deepEqual(raceFinalState.rows[0], {
        conversation_status: 'resolved',
        open_escalations: 0,
      });

      await assert.rejects(
        pool.query(
          `SELECT * FROM ensure_conversation_escalation($1, $2, NULL)`,
          [conversationId, 'Resolved conversations stay closed']
        ),
        (error) => error.code === 'P0001'
      );
    } finally {
      try {
        await pool.query(
          'DELETE FROM escalations WHERE conversation_id = ANY($1::UUID[])',
          [[conversationId, raceConversationId]]
        );
        await pool.query(
          'DELETE FROM conversations WHERE id = ANY($1::UUID[])',
          [[conversationId, raceConversationId]]
        );
        await pool.query('DELETE FROM admin_users WHERE id = $1', [operatorId]);
      } finally {
        await pool.end();
      }
    }
  }
);
