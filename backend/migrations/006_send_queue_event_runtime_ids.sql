-- Relax send queue and email event IDs for application/runtime repository migration
ALTER TABLE email_events
  DROP CONSTRAINT IF EXISTS email_events_campaign_id_fkey;

ALTER TABLE email_events
  DROP CONSTRAINT IF EXISTS email_events_contact_id_fkey;

ALTER TABLE email_events
  DROP CONSTRAINT IF EXISTS email_events_send_job_id_fkey;

ALTER TABLE send_jobs
  DROP CONSTRAINT IF EXISTS send_jobs_campaign_id_contact_id_key;

ALTER TABLE send_jobs
  DROP CONSTRAINT IF EXISTS send_jobs_campaign_id_fkey;

ALTER TABLE send_jobs
  DROP CONSTRAINT IF EXISTS send_jobs_contact_id_fkey;

ALTER TABLE send_jobs
  ALTER COLUMN id TYPE text USING id::text,
  ALTER COLUMN campaign_id TYPE text USING campaign_id::text,
  ALTER COLUMN contact_id TYPE text USING contact_id::text;

ALTER TABLE send_jobs
  ALTER COLUMN campaign_id DROP NOT NULL,
  ALTER COLUMN contact_id DROP NOT NULL;

ALTER TABLE email_events
  ALTER COLUMN id TYPE text USING id::text,
  ALTER COLUMN campaign_id TYPE text USING campaign_id::text,
  ALTER COLUMN contact_id TYPE text USING contact_id::text,
  ALTER COLUMN send_job_id TYPE text USING send_job_id::text;

ALTER TABLE email_events
  ADD COLUMN IF NOT EXISTS recipient_email text,
  ADD COLUMN IF NOT EXISTS source text,
  ADD COLUMN IF NOT EXISTS detail text,
  ADD COLUMN IF NOT EXISTS actor_email text;

CREATE INDEX IF NOT EXISTS send_jobs_id_status_idx ON send_jobs(id, status);
CREATE INDEX IF NOT EXISTS email_events_recipient_type_idx ON email_events(recipient_email, event_type);
