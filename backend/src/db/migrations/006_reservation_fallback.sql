-- Migration 006 - Booking ID / guest-name fallback and atomic conversation linking

ALTER TABLE reservations
  ADD COLUMN IF NOT EXISTS booking_lookup_key TEXT;

ALTER TABLE guests
  ADD COLUMN IF NOT EXISTS name_lookup_key TEXT;

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS reservation_candidate_id UUID REFERENCES reservations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reservation_match_method TEXT,
  ADD COLUMN IF NOT EXISTS reservation_match_status TEXT,
  ADD COLUMN IF NOT EXISTS reservation_matched_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION normalise_booking_lookup_key(value TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT NULLIF(upper(regexp_replace(COALESCE(value, ''), '[^A-Za-z0-9]', '', 'g')), '');
$$;

CREATE OR REPLACE FUNCTION normalise_guest_name_lookup_key(value TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT NULLIF(lower(regexp_replace(btrim(COALESCE(value, '')), '[[:space:]]+', ' ', 'g')), '');
$$;

CREATE OR REPLACE FUNCTION set_reservation_booking_lookup_key()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.booking_lookup_key := normalise_booking_lookup_key(NEW.booking_id);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION set_guest_name_lookup_key()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.name_lookup_key := normalise_guest_name_lookup_key(NEW.full_name);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_reservations_booking_lookup_key ON reservations;
CREATE TRIGGER trg_reservations_booking_lookup_key
BEFORE INSERT OR UPDATE OF booking_id ON reservations
FOR EACH ROW EXECUTE FUNCTION set_reservation_booking_lookup_key();

DROP TRIGGER IF EXISTS trg_guests_name_lookup_key ON guests;
CREATE TRIGGER trg_guests_name_lookup_key
BEFORE INSERT OR UPDATE OF full_name ON guests
FOR EACH ROW EXECUTE FUNCTION set_guest_name_lookup_key();

UPDATE reservations
   SET booking_lookup_key = normalise_booking_lookup_key(booking_id)
 WHERE booking_lookup_key IS DISTINCT FROM normalise_booking_lookup_key(booking_id);

UPDATE guests
   SET name_lookup_key = normalise_guest_name_lookup_key(full_name)
 WHERE name_lookup_key IS DISTINCT FROM normalise_guest_name_lookup_key(full_name);

CREATE INDEX IF NOT EXISTS idx_reservations_booking_lookup_key
  ON reservations(booking_lookup_key)
  WHERE booking_lookup_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_guests_name_lookup_key
  ON guests(name_lookup_key)
  WHERE name_lookup_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_conversations_reservation_candidate
  ON conversations(reservation_candidate_id)
  WHERE reservation_candidate_id IS NOT NULL;

-- Serialises conversation find/create/link operations per WhatsApp number.
-- A previously unlinked conversation is reused when a later guest message
-- supplies a verified Booking ID, preventing split message histories.
CREATE OR REPLACE FUNCTION find_or_link_active_conversation(
  p_guest_phone              TEXT,
  p_reservation_id           UUID DEFAULT NULL,
  p_candidate_reservation_id UUID DEFAULT NULL,
  p_match_method             TEXT DEFAULT NULL,
  p_match_status             TEXT DEFAULT 'unmatched'
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_conversation conversations%ROWTYPE;
  v_previous_reservation_id UUID;
  v_previous_candidate_id UUID;
  v_created BOOLEAN := FALSE;
  v_preserve_existing_match BOOLEAN := FALSE;
BEGIN
  IF p_guest_phone IS NULL OR btrim(p_guest_phone) = '' THEN
    RAISE EXCEPTION 'Guest phone is required' USING ERRCODE = '22023';
  END IF;

  IF p_match_status NOT IN ('verified', 'provisional', 'ambiguous', 'mismatch', 'unmatched') THEN
    RAISE EXCEPTION 'Invalid reservation match status' USING ERRCODE = '22023';
  END IF;

  IF p_reservation_id IS NOT NULL AND p_match_status <> 'verified' THEN
    RAISE EXCEPTION 'A linked reservation must have verified status' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(btrim(p_guest_phone), 0));

  IF p_reservation_id IS NOT NULL THEN
    SELECT * INTO v_conversation
      FROM conversations
     WHERE guest_phone = btrim(p_guest_phone)
       AND reservation_id = p_reservation_id
       AND status IN ('open', 'escalated', 'manual')
     ORDER BY last_message_at DESC NULLS LAST, created_at DESC
     LIMIT 1
     FOR UPDATE;

    IF NOT FOUND THEN
      SELECT * INTO v_conversation
        FROM conversations
       WHERE guest_phone = btrim(p_guest_phone)
         AND reservation_id IS NULL
         AND status IN ('open', 'escalated', 'manual')
       ORDER BY last_message_at DESC NULLS LAST, created_at DESC
       LIMIT 1
       FOR UPDATE;
    END IF;
  ELSE
    SELECT * INTO v_conversation
      FROM conversations
     WHERE guest_phone = btrim(p_guest_phone)
       AND reservation_id IS NULL
       AND status IN ('open', 'escalated', 'manual')
     ORDER BY last_message_at DESC NULLS LAST, created_at DESC
     LIMIT 1
     FOR UPDATE;

    -- A concurrent webhook may have linked the previously unlinked thread
    -- while this request was waiting on the advisory lock. Reuse that thread
    -- instead of creating a second active conversation, but keep its verified
    -- match metadata because this request resolved without reservation context.
    IF NOT FOUND THEN
      SELECT * INTO v_conversation
        FROM conversations
       WHERE guest_phone = btrim(p_guest_phone)
         AND reservation_id IS NOT NULL
         AND status IN ('open', 'escalated', 'manual')
       ORDER BY last_message_at DESC NULLS LAST, created_at DESC
       LIMIT 1
       FOR UPDATE;

      IF FOUND THEN
        v_preserve_existing_match := TRUE;
      END IF;
    END IF;
  END IF;

  IF FOUND THEN
    v_previous_reservation_id := v_conversation.reservation_id;
    v_previous_candidate_id := v_conversation.reservation_candidate_id;

    UPDATE conversations
       SET reservation_id = COALESCE(p_reservation_id, reservation_id),
           reservation_candidate_id = CASE
             WHEN v_preserve_existing_match THEN reservation_candidate_id
             WHEN p_reservation_id IS NOT NULL THEN NULL
             ELSE p_candidate_reservation_id
           END,
           reservation_match_method = CASE
             WHEN v_preserve_existing_match THEN reservation_match_method
             ELSE p_match_method
           END,
           reservation_match_status = CASE
             WHEN v_preserve_existing_match THEN reservation_match_status
             ELSE p_match_status
           END,
           reservation_matched_at = CASE
             WHEN v_preserve_existing_match THEN reservation_matched_at
             WHEN p_match_status IN ('verified', 'provisional') THEN now()
             ELSE reservation_matched_at
           END,
           last_message_at = now()
     WHERE id = v_conversation.id
     RETURNING * INTO v_conversation;
  ELSE
    INSERT INTO conversations (
      guest_phone,
      reservation_id,
      reservation_candidate_id,
      reservation_match_method,
      reservation_match_status,
      reservation_matched_at,
      status,
      last_message_at
    ) VALUES (
      btrim(p_guest_phone),
      p_reservation_id,
      CASE WHEN p_reservation_id IS NULL THEN p_candidate_reservation_id ELSE NULL END,
      p_match_method,
      p_match_status,
      CASE WHEN p_match_status IN ('verified', 'provisional') THEN now() ELSE NULL END,
      'open',
      now()
    )
    RETURNING * INTO v_conversation;

    v_created := TRUE;
  END IF;

  IF p_reservation_id IS NOT NULL
     AND (v_created OR v_previous_reservation_id IS DISTINCT FROM p_reservation_id) THEN
    INSERT INTO conversation_events (
      conversation_id, event_type, metadata
    ) VALUES (
      v_conversation.id,
      'reservation_matched',
      jsonb_build_object(
        'method', p_match_method,
        'status', p_match_status,
        'reservation_id', p_reservation_id
      )
    );
  ELSIF p_candidate_reservation_id IS NOT NULL
        AND (v_created OR v_previous_candidate_id IS DISTINCT FROM p_candidate_reservation_id) THEN
    INSERT INTO conversation_events (
      conversation_id, event_type, metadata
    ) VALUES (
      v_conversation.id,
      'reservation_candidate_found',
      jsonb_build_object(
        'method', p_match_method,
        'status', p_match_status,
        'reservation_id', p_candidate_reservation_id
      )
    );
  END IF;

  RETURN to_jsonb(v_conversation);
END;
$$;

REVOKE ALL ON FUNCTION find_or_link_active_conversation(TEXT, UUID, UUID, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION find_or_link_active_conversation(TEXT, UUID, UUID, TEXT, TEXT) TO service_role;
