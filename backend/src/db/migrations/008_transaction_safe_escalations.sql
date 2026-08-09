-- Migration 008 - transaction-safe escalation lifecycle hardening

BEGIN;

ALTER TABLE escalations
  ADD COLUMN IF NOT EXISTS resolved_by UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'escalations_resolved_by_fkey'
       AND conrelid = 'escalations'::regclass
  ) THEN
    ALTER TABLE escalations
      ADD CONSTRAINT escalations_resolved_by_fkey
      FOREIGN KEY (resolved_by)
      REFERENCES admin_users(id)
      ON DELETE SET NULL;
  END IF;
END;
$$;

-- Backfill lifecycle timestamps before enforcing state consistency.
UPDATE escalations
   SET acknowledged_at = COALESCE(acknowledged_at, created_at)
 WHERE status = 'acknowledged'
   AND acknowledged_at IS NULL;

UPDATE escalations
   SET resolved_at = COALESCE(resolved_at, created_at)
 WHERE status = 'resolved'
   AND resolved_at IS NULL;

-- Keep the most relevant open escalation and close historical duplicates.
-- A claimed escalation wins over a pending one; otherwise the newest wins.
WITH ranked AS (
  SELECT id,
         conversation_id,
         row_number() OVER (
           PARTITION BY conversation_id
           ORDER BY
             CASE WHEN status = 'acknowledged' THEN 1 ELSE 0 END DESC,
             created_at DESC,
             id DESC
         ) AS row_number
    FROM escalations
   WHERE status IN ('pending', 'acknowledged')
), closed AS (
  UPDATE escalations AS escalation
     SET status = 'resolved',
         resolved_at = COALESCE(escalation.resolved_at, now())
    FROM ranked
   WHERE escalation.id = ranked.id
     AND ranked.row_number > 1
  RETURNING escalation.id, escalation.conversation_id
)
INSERT INTO conversation_events (
  conversation_id,
  escalation_id,
  event_type,
  metadata
)
SELECT conversation_id,
       id,
       'duplicate_escalation_closed',
       jsonb_build_object('migration', '008_transaction_safe_escalations')
  FROM closed;

-- Defence in depth: even direct inserts cannot create two open handovers for
-- the same conversation.
CREATE UNIQUE INDEX IF NOT EXISTS uq_escalations_one_open_per_conversation
  ON escalations(conversation_id)
  WHERE status IN ('pending', 'acknowledged');

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'escalations_status_valid'
       AND conrelid = 'escalations'::regclass
  ) THEN
    ALTER TABLE escalations
      ADD CONSTRAINT escalations_status_valid
      CHECK (status IN ('pending', 'acknowledged', 'resolved'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'escalations_lifecycle_consistent'
       AND conrelid = 'escalations'::regclass
  ) THEN
    ALTER TABLE escalations
      ADD CONSTRAINT escalations_lifecycle_consistent
      CHECK (
        (status = 'pending' AND resolved_at IS NULL)
        OR
        (
          status = 'acknowledged'
          AND acknowledged_at IS NOT NULL
          AND resolved_at IS NULL
        )
        OR
        (status = 'resolved' AND resolved_at IS NOT NULL)
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'conversations_status_valid'
       AND conrelid = 'conversations'::regclass
  ) THEN
    ALTER TABLE conversations
      ADD CONSTRAINT conversations_status_valid
      CHECK (status IN ('open', 'escalated', 'manual', 'resolved'));
  END IF;
END;
$$;

-- Find or create an escalation under the conversation lock. Every handover
-- function locks the conversation first, preventing create/resolve deadlocks.
CREATE OR REPLACE FUNCTION ensure_conversation_escalation(
  p_conversation_id UUID,
  p_reason          TEXT,
  p_escalated_to    UUID DEFAULT NULL
)
RETURNS TABLE (
  conversation JSONB,
  escalation   JSONB,
  created      BOOLEAN
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_conversation    conversations%ROWTYPE;
  v_escalation      escalations%ROWTYPE;
  v_previous_status TEXT;
  v_created         BOOLEAN := FALSE;
BEGIN
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'Escalation reason is required' USING ERRCODE = '22023';
  END IF;

  IF p_escalated_to IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM admin_users WHERE id = p_escalated_to) THEN
    RAISE EXCEPTION 'Escalation assignee not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT *
    INTO v_conversation
    FROM conversations
   WHERE id = p_conversation_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Conversation not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_conversation.status = 'resolved' THEN
    RAISE EXCEPTION 'Resolved conversation cannot be escalated'
      USING ERRCODE = 'P0001';
  END IF;

  v_previous_status := v_conversation.status;

  SELECT *
    INTO v_escalation
    FROM escalations
   WHERE conversation_id = p_conversation_id
     AND status IN ('pending', 'acknowledged')
   ORDER BY created_at DESC, id DESC
   LIMIT 1
   FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO escalations (
      conversation_id,
      reason,
      escalated_to,
      status
    ) VALUES (
      p_conversation_id,
      btrim(p_reason),
      p_escalated_to,
      'pending'
    )
    RETURNING * INTO v_escalation;

    v_created := TRUE;
  ELSIF p_escalated_to IS NOT NULL
        AND v_escalation.escalated_to IS NOT NULL
        AND v_escalation.escalated_to <> p_escalated_to THEN
    RAISE EXCEPTION 'Escalation is already assigned to another operator'
      USING ERRCODE = 'P0001';
  ELSIF p_escalated_to IS NOT NULL AND v_escalation.escalated_to IS NULL THEN
    UPDATE escalations
       SET escalated_to = p_escalated_to
     WHERE id = v_escalation.id
     RETURNING * INTO v_escalation;
  END IF;

  UPDATE conversations
     SET status = CASE WHEN status = 'manual' THEN 'manual' ELSE 'escalated' END
   WHERE id = p_conversation_id
   RETURNING * INTO v_conversation;

  IF v_created THEN
    INSERT INTO conversation_events (
      conversation_id,
      escalation_id,
      event_type,
      metadata
    ) VALUES (
      p_conversation_id,
      v_escalation.id,
      'escalated',
      jsonb_build_object(
        'reason', v_escalation.reason,
        'previous_status', v_previous_status,
        'escalated_to', v_escalation.escalated_to
      )
    );
  END IF;

  RETURN QUERY
  SELECT to_jsonb(v_conversation), to_jsonb(v_escalation), v_created;
END;
$$;

-- Returning to automation also closes the active escalation in the same
-- transaction and records who performed the action.
CREATE OR REPLACE FUNCTION resume_conversation_automation(
  p_conversation_id UUID,
  p_operator_id     UUID
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_conversation             conversations%ROWTYPE;
  v_operator                 admin_users%ROWTYPE;
  v_resolved_escalation_count INTEGER := 0;
BEGIN
  SELECT * INTO v_operator FROM admin_users WHERE id = p_operator_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Operator not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_conversation
    FROM conversations
   WHERE id = p_conversation_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Conversation not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_conversation.status = 'resolved' THEN
    RAISE EXCEPTION 'Resolved conversation cannot resume automation'
      USING ERRCODE = 'P0001';
  END IF;

  IF (v_conversation.assigned_to IS NULL OR v_conversation.assigned_to <> p_operator_id)
     AND v_operator.role NOT IN ('supervisor', 'admin') THEN
    RAISE EXCEPTION 'Only the assignee, a supervisor, or an admin can resume automation'
      USING ERRCODE = '42501';
  END IF;

  UPDATE conversations
     SET status = 'open',
         assigned_to = NULL,
         assigned_at = NULL,
         manual_mode_started_at = NULL,
         manual_mode_reason = NULL
   WHERE id = p_conversation_id
   RETURNING * INTO v_conversation;

  UPDATE escalations
     SET status = 'resolved',
         resolved_at = COALESCE(resolved_at, now()),
         resolved_by = COALESCE(resolved_by, p_operator_id)
   WHERE conversation_id = p_conversation_id
     AND status IN ('pending', 'acknowledged');

  GET DIAGNOSTICS v_resolved_escalation_count = ROW_COUNT;

  INSERT INTO conversation_events (
    conversation_id,
    actor_id,
    event_type,
    metadata
  ) VALUES (
    p_conversation_id,
    p_operator_id,
    'automation_resumed',
    jsonb_build_object('resolved_escalation_count', v_resolved_escalation_count)
  );

  RETURN to_jsonb(v_conversation);
END;
$$;

-- Resolve the conversation, every open escalation and the audit record in one
-- transaction. Repeated calls are idempotent and do not duplicate events.
CREATE OR REPLACE FUNCTION resolve_conversation_handover(
  p_conversation_id UUID,
  p_operator_id     UUID
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_conversation              conversations%ROWTYPE;
  v_operator                  admin_users%ROWTYPE;
  v_already_resolved          BOOLEAN;
  v_resolved_escalation_count INTEGER := 0;
BEGIN
  SELECT * INTO v_operator FROM admin_users WHERE id = p_operator_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Operator not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_conversation
    FROM conversations
   WHERE id = p_conversation_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Conversation not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_conversation.assigned_to IS NOT NULL
     AND v_conversation.assigned_to <> p_operator_id
     AND v_operator.role NOT IN ('supervisor', 'admin') THEN
    RAISE EXCEPTION 'Only the assignee, a supervisor, or an admin can resolve this conversation'
      USING ERRCODE = '42501';
  END IF;

  v_already_resolved := v_conversation.status = 'resolved';

  UPDATE escalations
     SET status = 'resolved',
         resolved_at = COALESCE(resolved_at, now()),
         resolved_by = COALESCE(resolved_by, p_operator_id)
   WHERE conversation_id = p_conversation_id
     AND status IN ('pending', 'acknowledged');

  GET DIAGNOSTICS v_resolved_escalation_count = ROW_COUNT;

  IF NOT v_already_resolved THEN
    UPDATE conversations
       SET status = 'resolved'
     WHERE id = p_conversation_id
     RETURNING * INTO v_conversation;

    INSERT INTO conversation_events (
      conversation_id,
      actor_id,
      event_type,
      metadata
    ) VALUES (
      p_conversation_id,
      p_operator_id,
      'resolved',
      jsonb_build_object('resolved_escalation_count', v_resolved_escalation_count)
    );
  ELSIF v_resolved_escalation_count > 0 THEN
    INSERT INTO conversation_events (
      conversation_id,
      actor_id,
      event_type,
      metadata
    ) VALUES (
      p_conversation_id,
      p_operator_id,
      'escalation_state_repaired',
      jsonb_build_object('resolved_escalation_count', v_resolved_escalation_count)
    );
  END IF;

  RETURN to_jsonb(v_conversation);
END;
$$;

REVOKE ALL ON FUNCTION ensure_conversation_escalation(UUID, TEXT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION resume_conversation_automation(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION resolve_conversation_handover(UUID, UUID) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION ensure_conversation_escalation(UUID, TEXT, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION resume_conversation_automation(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION resolve_conversation_handover(UUID, UUID) TO service_role;

COMMIT;
