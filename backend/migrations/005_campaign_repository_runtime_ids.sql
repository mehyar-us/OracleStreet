-- Relax campaign repository IDs for application/runtime repository migration
ALTER TABLE campaigns
  DROP CONSTRAINT IF EXISTS campaigns_segment_id_fkey;

ALTER TABLE campaigns
  DROP CONSTRAINT IF EXISTS campaigns_template_id_fkey;

ALTER TABLE campaigns
  ALTER COLUMN segment_id TYPE text USING segment_id::text;

ALTER TABLE campaigns
  ALTER COLUMN template_id TYPE text USING template_id::text;

ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS estimated_audience integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS suppressed_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS approved_by text,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS scheduled_at timestamptz,
  ADD COLUMN IF NOT EXISTS sender_domain text,
  ADD COLUMN IF NOT EXISTS warmup_day integer,
  ADD COLUMN IF NOT EXISTS warmup_daily_cap integer,
  ADD COLUMN IF NOT EXISTS warmup_planned_count integer,
  ADD COLUMN IF NOT EXISTS scheduled_by text,
  ADD COLUMN IF NOT EXISTS queued_dry_run_count integer NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS campaigns_segment_id_text_idx ON campaigns(segment_id);
CREATE INDEX IF NOT EXISTS campaigns_template_id_text_idx ON campaigns(template_id);
