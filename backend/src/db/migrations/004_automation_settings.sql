-- Migration 004 - dashboard-controlled AI automation settings

CREATE TABLE IF NOT EXISTS automation_settings (
  id                       TEXT        PRIMARY KEY,
  ai_auto_reply_enabled    BOOLEAN     NOT NULL DEFAULT false,
  auto_send_clarifications BOOLEAN     NOT NULL DEFAULT true,
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT automation_settings_global_only CHECK (id = 'global')
);

-- Browser clients never access this table directly. The backend service-role
-- client reads and updates it through authenticated /api/settings routes.
ALTER TABLE automation_settings ENABLE ROW LEVEL SECURITY;

INSERT INTO automation_settings (
  id,
  ai_auto_reply_enabled,
  auto_send_clarifications
)
VALUES ('global', false, true)
ON CONFLICT (id) DO NOTHING;
