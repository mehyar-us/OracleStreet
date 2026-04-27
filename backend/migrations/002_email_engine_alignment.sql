-- Align PostgreSQL schema with current dry-run email engine safety gates

ALTER TABLE campaigns
  DROP CONSTRAINT IF EXISTS campaigns_status_check;

ALTER TABLE campaigns
  ADD CONSTRAINT campaigns_status_check CHECK (status IN (
    'draft',
    'approved',
    'approved_dry_run',
    'scheduled',
    'scheduled_dry_run',
    'sending',
    'sent',
    'paused',
    'cancelled'
  ));

ALTER TABLE send_jobs
  DROP CONSTRAINT IF EXISTS send_jobs_status_check;

ALTER TABLE send_jobs
  ADD CONSTRAINT send_jobs_status_check CHECK (status IN (
    'queued',
    'queued_dry_run',
    'dispatched_dry_run',
    'blocked',
    'sent',
    'failed'
  ));

ALTER TABLE send_jobs
  ALTER COLUMN campaign_id DROP NOT NULL,
  ALTER COLUMN contact_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS recipient_email text,
  ADD COLUMN IF NOT EXISTS subject text,
  ADD COLUMN IF NOT EXISTS source text,
  ADD COLUMN IF NOT EXISTS unsubscribe_url text,
  ADD COLUMN IF NOT EXISTS open_tracking_url text,
  ADD COLUMN IF NOT EXISTS click_tracking_url text,
  ADD COLUMN IF NOT EXISTS safety jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS dispatched_at timestamptz;

ALTER TABLE email_events
  DROP CONSTRAINT IF EXISTS email_events_event_type_check;

ALTER TABLE email_events
  ADD CONSTRAINT email_events_event_type_check CHECK (event_type IN (
    'queued',
    'blocked',
    'sent',
    'dispatched',
    'delivered',
    'deferred',
    'open',
    'click',
    'bounce',
    'unsubscribe',
    'complaint'
  ));

CREATE INDEX IF NOT EXISTS send_jobs_campaign_status_idx ON send_jobs(campaign_id, status);
CREATE INDEX IF NOT EXISTS send_jobs_recipient_email_idx ON send_jobs(recipient_email);
CREATE INDEX IF NOT EXISTS email_events_type_created_idx ON email_events(event_type, created_at);
