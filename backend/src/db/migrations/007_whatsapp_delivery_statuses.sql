-- Migration 007 - durable WhatsApp delivery status history and reconciliation

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS status_updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sent_at           TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS delivered_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS read_at           TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS failed_at         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS failure_code      TEXT,
  ADD COLUMN IF NOT EXISTS failure_details   JSONB;

CREATE TABLE IF NOT EXISTS message_delivery_events (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id         UUID        REFERENCES messages(id) ON DELETE CASCADE,
  wa_message_id      TEXT        NOT NULL,
  status             TEXT        NOT NULL CHECK (status IN ('sent', 'delivered', 'read', 'failed')),
  provider_timestamp TIMESTAMPTZ,
  recipient_phone    TEXT,
  failure_code       TEXT,
  failure_reason     TEXT,
  failure_details    JSONB,
  payload            JSONB       NOT NULL DEFAULT '{}'::JSONB,
  received_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  applied_at         TIMESTAMPTZ
);

-- Meta can retry the same status webhook. A missing provider timestamp is
-- normalised to epoch for deduplication purposes.
CREATE UNIQUE INDEX IF NOT EXISTS idx_message_delivery_events_dedupe
  ON message_delivery_events (
    wa_message_id,
    status,
    COALESCE(provider_timestamp, '1970-01-01 00:00:00+00'::TIMESTAMPTZ)
  );

CREATE INDEX IF NOT EXISTS idx_message_delivery_events_message
  ON message_delivery_events(message_id, received_at DESC);

CREATE INDEX IF NOT EXISTS idx_message_delivery_events_unapplied
  ON message_delivery_events(wa_message_id, received_at)
  WHERE applied_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_messages_delivery_status
  ON messages(delivery_status, status_updated_at DESC)
  WHERE direction = 'outbound';

-- Records every provider event first, then atomically replays all events for
-- the WhatsApp message in provider-time order. This makes duplicate and
-- out-of-order events safe and buffers events that arrive before wa_message_id
-- has been attached to the local message row.
CREATE OR REPLACE FUNCTION apply_whatsapp_delivery_status(
  p_wa_message_id      TEXT,
  p_status             TEXT,
  p_provider_timestamp TIMESTAMPTZ DEFAULT NULL,
  p_recipient_phone    TEXT DEFAULT NULL,
  p_failure_code       TEXT DEFAULT NULL,
  p_failure_reason     TEXT DEFAULT NULL,
  p_failure_details    JSONB DEFAULT NULL,
  p_payload            JSONB DEFAULT '{}'::JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_message           messages%ROWTYPE;
  v_event             message_delivery_events%ROWTYPE;
  v_status            TEXT;
  v_event_time        TIMESTAMPTZ;
  v_status_updated_at TIMESTAMPTZ;
  v_sent_at           TIMESTAMPTZ;
  v_delivered_at      TIMESTAMPTZ;
  v_read_at           TIMESTAMPTZ;
  v_failed_at         TIMESTAMPTZ;
  v_failure_code      TEXT;
  v_failure_reason    TEXT;
  v_failure_details   JSONB;
BEGIN
  IF p_wa_message_id IS NULL OR btrim(p_wa_message_id) = '' THEN
    RAISE EXCEPTION 'WhatsApp message ID is required' USING ERRCODE = '22023';
  END IF;

  IF p_status NOT IN ('sent', 'delivered', 'read', 'failed') THEN
    RAISE EXCEPTION 'Unsupported WhatsApp delivery status' USING ERRCODE = '22023';
  END IF;

  INSERT INTO message_delivery_events (
    wa_message_id,
    status,
    provider_timestamp,
    recipient_phone,
    failure_code,
    failure_reason,
    failure_details,
    payload
  ) VALUES (
    btrim(p_wa_message_id),
    p_status,
    p_provider_timestamp,
    p_recipient_phone,
    p_failure_code,
    p_failure_reason,
    p_failure_details,
    COALESCE(p_payload, '{}'::JSONB)
  )
  ON CONFLICT DO NOTHING;

  SELECT * INTO v_message
    FROM messages
   WHERE wa_message_id = btrim(p_wa_message_id)
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'applied', FALSE,
      'buffered', TRUE,
      'message', NULL
    );
  END IF;

  v_status := COALESCE(v_message.delivery_status, 'pending');
  v_status_updated_at := v_message.status_updated_at;
  v_sent_at := v_message.sent_at;
  v_delivered_at := v_message.delivered_at;
  v_read_at := v_message.read_at;
  v_failed_at := v_message.failed_at;
  v_failure_code := v_message.failure_code;
  v_failure_reason := v_message.failure_reason;
  v_failure_details := v_message.failure_details;

  FOR v_event IN
    SELECT *
      FROM message_delivery_events
     WHERE wa_message_id = btrim(p_wa_message_id)
     ORDER BY COALESCE(provider_timestamp, received_at), received_at, id
  LOOP
    v_event_time := COALESCE(v_event.provider_timestamp, v_event.received_at);

    IF v_event.status = 'sent' THEN
      v_sent_at := LEAST(COALESCE(v_sent_at, v_event_time), v_event_time);
      IF v_status IN ('pending', 'sent') THEN
        IF v_status <> 'sent' THEN
          v_status_updated_at := v_event_time;
        END IF;
        v_status := 'sent';
      END IF;
    ELSIF v_event.status = 'delivered' THEN
      v_delivered_at := LEAST(COALESCE(v_delivered_at, v_event_time), v_event_time);
      IF v_status <> 'read' THEN
        IF v_status <> 'delivered' THEN
          v_status_updated_at := v_event_time;
        END IF;
        v_status := 'delivered';
        v_failure_code := NULL;
        v_failure_reason := NULL;
        v_failure_details := NULL;
      END IF;
    ELSIF v_event.status = 'read' THEN
      v_read_at := LEAST(COALESCE(v_read_at, v_event_time), v_event_time);
      IF v_status <> 'read' THEN
        v_status_updated_at := v_event_time;
      END IF;
      v_status := 'read';
      v_failure_code := NULL;
      v_failure_reason := NULL;
      v_failure_details := NULL;
    ELSIF v_event.status = 'failed' THEN
      v_failed_at := LEAST(COALESCE(v_failed_at, v_event_time), v_event_time);
      IF v_status NOT IN ('delivered', 'read') THEN
        IF v_status <> 'failed' THEN
          v_status_updated_at := v_event_time;
        END IF;
        v_status := 'failed';
        v_failure_code := v_event.failure_code;
        v_failure_reason := v_event.failure_reason;
        v_failure_details := v_event.failure_details;
      END IF;
    END IF;
  END LOOP;

  UPDATE messages
     SET delivery_status = v_status,
         status_updated_at = COALESCE(v_status_updated_at, now()),
         sent_at = v_sent_at,
         delivered_at = v_delivered_at,
         read_at = v_read_at,
         failed_at = v_failed_at,
         failure_code = v_failure_code,
         failure_reason = v_failure_reason,
         failure_details = v_failure_details
   WHERE id = v_message.id
   RETURNING * INTO v_message;

  UPDATE message_delivery_events
     SET message_id = v_message.id,
         applied_at = COALESCE(applied_at, now())
   WHERE wa_message_id = btrim(p_wa_message_id);

  RETURN jsonb_build_object(
    'applied', TRUE,
    'buffered', FALSE,
    'message', to_jsonb(v_message)
  );
END;
$$;

REVOKE ALL ON FUNCTION apply_whatsapp_delivery_status(
  TEXT, TEXT, TIMESTAMPTZ, TEXT, TEXT, TEXT, JSONB, JSONB
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION apply_whatsapp_delivery_status(
  TEXT, TEXT, TIMESTAMPTZ, TEXT, TEXT, TEXT, JSONB, JSONB
) TO service_role;
