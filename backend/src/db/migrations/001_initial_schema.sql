-- =============================================================================
-- Migration 001 – Initial schema
-- Run against your Supabase project via the SQL editor or supabase CLI.
-- =============================================================================

-- Raw webhook events (Phase 2 – audit log)
CREATE TABLE IF NOT EXISTS webhook_raw_events (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  payload     JSONB       NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Apartments master data
CREATE TABLE IF NOT EXISTS apartments (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT        NOT NULL,
  code        TEXT        UNIQUE NOT NULL,
  address     TEXT,
  map_link    TEXT,
  wifi_details JSONB,       -- { ssid, password }
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Per-apartment operational policies
CREATE TABLE IF NOT EXISTS apartment_policies (
  id                 UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  apartment_id       UUID    NOT NULL REFERENCES apartments(id) ON DELETE CASCADE,
  checkin_time       TIME    NOT NULL DEFAULT '14:00',
  checkout_time      TIME    NOT NULL DEFAULT '11:00',
  parking_info       TEXT,
  pet_policy         TEXT,
  extra_guest_policy TEXT,
  early_checkin_fee  NUMERIC(10,2),
  late_checkout_fee  NUMERIC(10,2),
  max_occupancy      INT,
  UNIQUE(apartment_id)
);

-- Apartment owners (optional, used for approval flows)
CREATE TABLE IF NOT EXISTS owners (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_name   TEXT NOT NULL,
  contact_info JSONB,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Guests
CREATE TABLE IF NOT EXISTS guests (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name    TEXT NOT NULL,
  phone_number TEXT UNIQUE NOT NULL,  -- E.164 format
  email        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Reservations
CREATE TABLE IF NOT EXISTS reservations (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_source TEXT,                           -- Airbnb, Booking.com, direct, …
  booking_id     TEXT        UNIQUE,             -- external reference
  apartment_id   UUID        NOT NULL REFERENCES apartments(id),
  guest_id       UUID        NOT NULL REFERENCES guests(id),
  checkin_date   DATE        NOT NULL,
  checkout_date  DATE        NOT NULL,
  status         TEXT        NOT NULL DEFAULT 'confirmed',  -- confirmed | checked_in | checked_out | cancelled
  notes          TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_reservations_guest_id      ON reservations(guest_id);
CREATE INDEX IF NOT EXISTS idx_reservations_checkin_date  ON reservations(checkin_date);

-- Conversations (one active thread per guest/reservation pair)
CREATE TABLE IF NOT EXISTS conversations (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  guest_phone     TEXT        NOT NULL,
  reservation_id  UUID        REFERENCES reservations(id),
  status          TEXT        NOT NULL DEFAULT 'open',  -- open | resolved | escalated | manual
  assigned_to     UUID        REFERENCES admin_users(id),
  last_message_at TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_conversations_guest_phone ON conversations(guest_phone);
CREATE INDEX IF NOT EXISTS idx_conversations_status      ON conversations(status);

-- Messages (inbound and outbound)
CREATE TABLE IF NOT EXISTS messages (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID        NOT NULL REFERENCES conversations(id),
  direction       TEXT        NOT NULL,   -- inbound | outbound
  source          TEXT        NOT NULL,   -- guest | ai | human | system
  content         TEXT,
  wa_message_id   TEXT        UNIQUE,     -- WhatsApp message ID for dedup & status updates
  delivery_status TEXT,                   -- sent | delivered | read | failed
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_wa_message_id   ON messages(wa_message_id);

-- Maintenance cases
CREATE TABLE IF NOT EXISTS maintenance_cases (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id),
  apartment_id    UUID NOT NULL REFERENCES apartments(id),
  category        TEXT,    -- plumbing | electrical | appliance | access | other
  severity        TEXT NOT NULL DEFAULT 'normal',  -- low | normal | high | urgent
  status          TEXT NOT NULL DEFAULT 'open',    -- open | in_progress | resolved
  description     TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Escalations (AI → human handover)
CREATE TABLE IF NOT EXISTS escalations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id),
  reason          TEXT NOT NULL,
  escalated_to    UUID REFERENCES admin_users(id),
  status          TEXT NOT NULL DEFAULT 'pending',  -- pending | acknowledged | resolved
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Admin / dashboard users
CREATE TABLE IF NOT EXISTS admin_users (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,
  email      TEXT UNIQUE NOT NULL,
  role       TEXT NOT NULL DEFAULT 'operator',  -- operator | supervisor | admin
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
