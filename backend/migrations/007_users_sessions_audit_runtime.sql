-- Add users, admin sessions, and audit runtime repository metadata
CREATE TABLE IF NOT EXISTS admin_sessions (
  id text PRIMARY KEY,
  email text NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE audit_log
  ADD COLUMN IF NOT EXISTS app_event_id text,
  ADD COLUMN IF NOT EXISTS actor_email text,
  ADD COLUMN IF NOT EXISTS target text,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'ok';

CREATE UNIQUE INDEX IF NOT EXISTS audit_log_app_event_id_idx ON audit_log(app_event_id) WHERE app_event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS audit_log_actor_email_idx ON audit_log(actor_email);
CREATE INDEX IF NOT EXISTS admin_sessions_email_created_idx ON admin_sessions(email, created_at);
