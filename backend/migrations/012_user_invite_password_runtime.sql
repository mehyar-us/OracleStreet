-- Runtime invite acceptance and password reset metadata for multi-user activation
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS invited_by text,
  ADD COLUMN IF NOT EXISTS invite_token_hash text,
  ADD COLUMN IF NOT EXISTS invite_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS accepted_at timestamptz,
  ADD COLUMN IF NOT EXISTS password_set_at timestamptz,
  ADD COLUMN IF NOT EXISTS reset_token_hash text,
  ADD COLUMN IF NOT EXISTS reset_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS reset_requested_by text;

CREATE INDEX IF NOT EXISTS users_status_idx ON users(status);
CREATE INDEX IF NOT EXISTS users_invite_token_hash_idx ON users(invite_token_hash) WHERE invite_token_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS users_reset_token_hash_idx ON users(reset_token_hash) WHERE reset_token_hash IS NOT NULL;

INSERT INTO repository_migration_status (module, target_table, persistence_mode)
VALUES ('user_invite_password_workflow', 'users', 'postgresql-ready-runtime-invite-password-reset')
ON CONFLICT (module) DO UPDATE SET
  target_table = EXCLUDED.target_table,
  persistence_mode = EXCLUDED.persistence_mode,
  updated_at = now();
