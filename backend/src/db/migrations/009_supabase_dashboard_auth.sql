-- Migration 009 - Bind dashboard operators to Supabase Auth identities

BEGIN;

ALTER TABLE admin_users
  ADD COLUMN IF NOT EXISTS auth_user_id UUID;

-- Safely link existing rows when an Auth user already has the same email.
-- Rows without a matching Auth user remain unlinked and cannot authenticate.
UPDATE admin_users AS operator
   SET auth_user_id = auth_user.id
  FROM auth.users AS auth_user
 WHERE operator.auth_user_id IS NULL
   AND lower(operator.email) = lower(auth_user.email);

CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_users_auth_user_id
  ON admin_users(auth_user_id)
  WHERE auth_user_id IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'admin_users_auth_user_id_fkey'
       AND conrelid = 'admin_users'::regclass
  ) THEN
    ALTER TABLE admin_users
      ADD CONSTRAINT admin_users_auth_user_id_fkey
      FOREIGN KEY (auth_user_id)
      REFERENCES auth.users(id)
      ON DELETE RESTRICT;
  END IF;
END;
$$;

COMMENT ON COLUMN admin_users.auth_user_id IS
  'Supabase Auth user UUID authorized to act as this dashboard operator.';

COMMIT;
