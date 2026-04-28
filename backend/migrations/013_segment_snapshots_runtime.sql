-- Runtime saved segment snapshot metadata for reproducible campaign audiences
ALTER TABLE segments
  ADD COLUMN IF NOT EXISTS estimated_audience integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS actor_email text,
  ADD COLUMN IF NOT EXISTS snapshot_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_snapshot_at timestamptz;

CREATE TABLE IF NOT EXISTS segment_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  segment_id text NOT NULL,
  segment_name text NOT NULL,
  filter_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  audience_count integer NOT NULL DEFAULT 0,
  contact_emails jsonb NOT NULL DEFAULT '[]'::jsonb,
  sample_contacts jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS segment_snapshots_segment_id_idx ON segment_snapshots(segment_id);
CREATE INDEX IF NOT EXISTS segment_snapshots_created_at_idx ON segment_snapshots(created_at DESC);

INSERT INTO repository_migration_status (module, target_table, persistence_mode)
VALUES ('segments', 'segments,segment_snapshots', 'postgresql-ready-runtime-segments-snapshots')
ON CONFLICT (module) DO UPDATE SET
  target_table = EXCLUDED.target_table,
  persistence_mode = EXCLUDED.persistence_mode,
  updated_at = now();
