-- Migration 003 - reliable AI outcome actions and atomic escalation creation

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS ai_action_status   TEXT,
  ADD COLUMN IF NOT EXISTS ai_last_message_id UUID REFERENCES messages(id) ON DELETE SET NULL;

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS failure_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_conversations_ai_action_status
  ON conversations(ai_action_status);

-- Serialises escalation creation on the conversation row so webhook and
-- dashboard requests cannot create two open escalations for the same thread.
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
  v_conversation conversations%ROWTYPE;
  v_escalation   escalations%ROWTYPE;
  v_created      BOOLEAN := FALSE;
BEGIN
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'Escalation reason is required' USING ERRCODE = '22023';
  END IF;

  -- The row lock makes the find-or-create operation atomic per conversation.
  SELECT *
    INTO v_conversation
    FROM conversations
   WHERE id = p_conversation_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Conversation not found' USING ERRCODE = 'P0002';
  END IF;

  UPDATE conversations
     SET status = 'escalated'
   WHERE id = p_conversation_id
   RETURNING * INTO v_conversation;

  SELECT *
    INTO v_escalation
    FROM escalations
   WHERE conversation_id = p_conversation_id
     AND status IN ('pending', 'acknowledged')
   ORDER BY created_at DESC
   LIMIT 1;

  IF NOT FOUND THEN
    INSERT INTO escalations (
      conversation_id,
      reason,
      escalated_to,
      status
    )
    VALUES (
      p_conversation_id,
      btrim(p_reason),
      p_escalated_to,
      'pending'
    )
    RETURNING * INTO v_escalation;

    v_created := TRUE;
  ELSIF p_escalated_to IS NOT NULL AND v_escalation.escalated_to IS NULL THEN
    UPDATE escalations
       SET escalated_to = p_escalated_to
     WHERE id = v_escalation.id
     RETURNING * INTO v_escalation;
  END IF;

  RETURN QUERY
  SELECT to_jsonb(v_conversation), to_jsonb(v_escalation), v_created;
END;
$$;

REVOKE ALL ON FUNCTION ensure_conversation_escalation(UUID, TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ensure_conversation_escalation(UUID, TEXT, UUID) TO service_role;
