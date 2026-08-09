-- Migration 005 - atomic human handover, assignment and manual-mode workflow

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS assigned_at             TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS manual_mode_started_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS manual_mode_reason      TEXT;

ALTER TABLE escalations
  ADD COLUMN IF NOT EXISTS acknowledged_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS resolved_at     TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS conversation_events (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID        NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  escalation_id   UUID        REFERENCES escalations(id) ON DELETE SET NULL,
  actor_id         UUID        REFERENCES admin_users(id) ON DELETE SET NULL,
  event_type       TEXT        NOT NULL,
  metadata         JSONB       NOT NULL DEFAULT '{}'::JSONB,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_conversation_events_conversation
  ON conversation_events(conversation_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_conversation_events_actor
  ON conversation_events(actor_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_conversations_assigned_to
  ON conversations(assigned_to);

-- Claim an escalation. The conversation row is locked first so this function
-- follows the same lock order as the other handover functions.
CREATE OR REPLACE FUNCTION take_over_escalation(
  p_escalation_id UUID,
  p_operator_id   UUID
)
RETURNS TABLE (
  conversation JSONB,
  escalation   JSONB
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_conversation conversations%ROWTYPE;
  v_escalation   escalations%ROWTYPE;
  v_operator     admin_users%ROWTYPE;
  v_conversation_id UUID;
  v_changed BOOLEAN := FALSE;
BEGIN
  SELECT * INTO v_operator
    FROM admin_users
   WHERE id = p_operator_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Operator not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT conversation_id INTO v_conversation_id
    FROM escalations
   WHERE id = p_escalation_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Escalation not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_conversation
    FROM conversations
   WHERE id = v_conversation_id
   FOR UPDATE;

  SELECT * INTO v_escalation
    FROM escalations
   WHERE id = p_escalation_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Escalation not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_escalation.status = 'resolved' OR v_conversation.status = 'resolved' THEN
    RAISE EXCEPTION 'Resolved escalation cannot be taken over' USING ERRCODE = 'P0001';
  END IF;

  IF v_escalation.escalated_to IS NOT NULL
     AND v_escalation.escalated_to <> p_operator_id THEN
    RAISE EXCEPTION 'Escalation is already assigned to another operator'
      USING ERRCODE = 'P0001';
  END IF;

  v_changed := v_escalation.status <> 'acknowledged'
    OR v_escalation.escalated_to IS DISTINCT FROM p_operator_id
    OR v_conversation.status <> 'manual'
    OR v_conversation.assigned_to IS DISTINCT FROM p_operator_id;

  UPDATE escalations
     SET status = 'acknowledged',
         escalated_to = p_operator_id,
         acknowledged_at = COALESCE(acknowledged_at, now())
   WHERE id = p_escalation_id
   RETURNING * INTO v_escalation;

  UPDATE conversations
     SET status = 'manual',
         assigned_to = p_operator_id,
         assigned_at = COALESCE(assigned_at, now()),
         manual_mode_started_at = COALESCE(manual_mode_started_at, now()),
         manual_mode_reason = COALESCE(manual_mode_reason, v_escalation.reason)
   WHERE id = v_conversation_id
   RETURNING * INTO v_conversation;

  IF v_changed THEN
    INSERT INTO conversation_events (
      conversation_id, escalation_id, actor_id, event_type, metadata
    ) VALUES (
      v_conversation.id,
      v_escalation.id,
      p_operator_id,
      'taken_over',
      jsonb_build_object('reason', v_escalation.reason)
    );
  END IF;

  RETURN QUERY SELECT to_jsonb(v_conversation), to_jsonb(v_escalation);
END;
$$;

-- Assign or reassign a conversation. Operators may assign to themselves;
-- supervisors/admins may assign any active operator.
CREATE OR REPLACE FUNCTION assign_conversation(
  p_conversation_id UUID,
  p_actor_id        UUID,
  p_assigned_to     UUID
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_conversation conversations%ROWTYPE;
  v_actor        admin_users%ROWTYPE;
  v_assignee     admin_users%ROWTYPE;
  v_previous     UUID;
BEGIN
  SELECT * INTO v_actor FROM admin_users WHERE id = p_actor_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Operator not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_assignee FROM admin_users WHERE id = p_assigned_to;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Assignee not found' USING ERRCODE = 'P0002';
  END IF;

  IF p_actor_id <> p_assigned_to AND v_actor.role NOT IN ('supervisor', 'admin') THEN
    RAISE EXCEPTION 'Only supervisors or admins can assign another operator'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_conversation
    FROM conversations
   WHERE id = p_conversation_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Conversation not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_conversation.status = 'resolved' THEN
    RAISE EXCEPTION 'Resolved conversation cannot be assigned' USING ERRCODE = 'P0001';
  END IF;

  v_previous := v_conversation.assigned_to;

  UPDATE conversations
     SET status = 'manual',
         assigned_to = p_assigned_to,
         assigned_at = CASE
           WHEN assigned_to IS DISTINCT FROM p_assigned_to THEN now()
           ELSE COALESCE(assigned_at, now())
         END,
         manual_mode_started_at = COALESCE(manual_mode_started_at, now()),
         manual_mode_reason = COALESCE(manual_mode_reason, 'Assigned for human support')
   WHERE id = p_conversation_id
   RETURNING * INTO v_conversation;

  UPDATE escalations
     SET status = 'acknowledged',
         escalated_to = p_assigned_to,
         acknowledged_at = COALESCE(acknowledged_at, now())
   WHERE conversation_id = p_conversation_id
     AND status IN ('pending', 'acknowledged');

  IF v_previous IS DISTINCT FROM p_assigned_to THEN
    INSERT INTO conversation_events (
      conversation_id, actor_id, event_type, metadata
    ) VALUES (
      p_conversation_id,
      p_actor_id,
      CASE WHEN v_previous IS NULL THEN 'assigned' ELSE 'reassigned' END,
      jsonb_build_object(
        'previous_assignee', v_previous,
        'assigned_to', p_assigned_to
      )
    );
  END IF;

  RETURN to_jsonb(v_conversation);
END;
$$;

-- Put a conversation into manual mode and claim it for the acting operator.
CREATE OR REPLACE FUNCTION start_conversation_manual_mode(
  p_conversation_id UUID,
  p_operator_id     UUID,
  p_reason          TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_conversation conversations%ROWTYPE;
  v_operator     admin_users%ROWTYPE;
  v_reason       TEXT;
  v_changed      BOOLEAN;
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
    RAISE EXCEPTION 'Resolved conversation cannot enter manual mode' USING ERRCODE = 'P0001';
  END IF;

  IF v_conversation.assigned_to IS NOT NULL
     AND v_conversation.assigned_to <> p_operator_id
     AND v_operator.role NOT IN ('supervisor', 'admin') THEN
    RAISE EXCEPTION 'Conversation is assigned to another operator'
      USING ERRCODE = '42501';
  END IF;

  v_reason := NULLIF(btrim(COALESCE(p_reason, '')), '');
  v_changed := v_conversation.status <> 'manual'
    OR v_conversation.assigned_to IS DISTINCT FROM p_operator_id;

  UPDATE conversations
     SET status = 'manual',
         assigned_to = p_operator_id,
         assigned_at = CASE
           WHEN assigned_to IS DISTINCT FROM p_operator_id THEN now()
           ELSE COALESCE(assigned_at, now())
         END,
         manual_mode_started_at = CASE
           WHEN status <> 'manual' THEN now()
           ELSE COALESCE(manual_mode_started_at, now())
         END,
         manual_mode_reason = COALESCE(v_reason, manual_mode_reason, 'Operator started manual mode')
   WHERE id = p_conversation_id
   RETURNING * INTO v_conversation;

  UPDATE escalations
     SET status = 'acknowledged',
         escalated_to = p_operator_id,
         acknowledged_at = COALESCE(acknowledged_at, now())
   WHERE conversation_id = p_conversation_id
     AND status IN ('pending', 'acknowledged');

  IF v_changed THEN
    INSERT INTO conversation_events (
      conversation_id, actor_id, event_type, metadata
    ) VALUES (
      p_conversation_id,
      p_operator_id,
      'manual_mode_started',
      jsonb_build_object('reason', v_conversation.manual_mode_reason)
    );
  END IF;

  RETURN to_jsonb(v_conversation);
END;
$$;

-- Return a manually handled conversation to AI/rules automation.
CREATE OR REPLACE FUNCTION resume_conversation_automation(
  p_conversation_id UUID,
  p_operator_id     UUID
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_conversation conversations%ROWTYPE;
  v_operator     admin_users%ROWTYPE;
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
    RAISE EXCEPTION 'Resolved conversation cannot resume automation' USING ERRCODE = 'P0001';
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
         resolved_at = COALESCE(resolved_at, now())
   WHERE conversation_id = p_conversation_id
     AND status IN ('pending', 'acknowledged');

  INSERT INTO conversation_events (
    conversation_id, actor_id, event_type
  ) VALUES (
    p_conversation_id, p_operator_id, 'automation_resumed'
  );

  RETURN to_jsonb(v_conversation);
END;
$$;

-- Resolve a conversation and all of its open handover records atomically.
CREATE OR REPLACE FUNCTION resolve_conversation_handover(
  p_conversation_id UUID,
  p_operator_id     UUID
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_conversation conversations%ROWTYPE;
  v_operator     admin_users%ROWTYPE;
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
    RETURN to_jsonb(v_conversation);
  END IF;

  IF v_conversation.assigned_to IS NOT NULL
     AND v_conversation.assigned_to <> p_operator_id
     AND v_operator.role NOT IN ('supervisor', 'admin') THEN
    RAISE EXCEPTION 'Only the assignee, a supervisor, or an admin can resolve this conversation'
      USING ERRCODE = '42501';
  END IF;

  UPDATE conversations
     SET status = 'resolved'
   WHERE id = p_conversation_id
   RETURNING * INTO v_conversation;

  UPDATE escalations
     SET status = 'resolved',
         resolved_at = COALESCE(resolved_at, now())
   WHERE conversation_id = p_conversation_id
     AND status IN ('pending', 'acknowledged');

  INSERT INTO conversation_events (
    conversation_id, actor_id, event_type
  ) VALUES (
    p_conversation_id, p_operator_id, 'resolved'
  );

  RETURN to_jsonb(v_conversation);
END;
$$;

REVOKE ALL ON FUNCTION take_over_escalation(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION assign_conversation(UUID, UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION start_conversation_manual_mode(UUID, UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION resume_conversation_automation(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION resolve_conversation_handover(UUID, UUID) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION take_over_escalation(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION assign_conversation(UUID, UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION start_conversation_manual_mode(UUID, UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION resume_conversation_automation(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION resolve_conversation_handover(UUID, UUID) TO service_role;
