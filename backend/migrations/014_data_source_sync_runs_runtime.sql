-- Runtime data-source sync-run persistence and operator replay metadata
CREATE TABLE IF NOT EXISTS data_source_sync_runs (
  id text PRIMARY KEY,
  data_source_id text NOT NULL,
  data_source_name text NOT NULL,
  status text NOT NULL,
  mode text NOT NULL,
  validation jsonb NOT NULL DEFAULT '{}'::jsonb,
  mapping jsonb NOT NULL DEFAULT '{}'::jsonb,
  rows_seen integer NOT NULL DEFAULT 0,
  rows_imported integer NOT NULL DEFAULT 0,
  rows_pulled integer NOT NULL DEFAULT 0,
  real_sync boolean NOT NULL DEFAULT false,
  network_probe text NOT NULL DEFAULT 'skipped',
  replay_of text,
  actor_email text,
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);

CREATE INDEX IF NOT EXISTS data_source_sync_runs_source_idx ON data_source_sync_runs(data_source_id);
CREATE INDEX IF NOT EXISTS data_source_sync_runs_created_at_idx ON data_source_sync_runs(created_at DESC);
CREATE INDEX IF NOT EXISTS data_source_sync_runs_replay_of_idx ON data_source_sync_runs(replay_of);

INSERT INTO repository_migration_status (module, target_table, persistence_mode)
VALUES ('data_source_sync_runs', 'data_source_sync_runs', 'postgresql-ready-runtime-sync-run-replay')
ON CONFLICT (module) DO UPDATE SET
  target_table = EXCLUDED.target_table,
  persistence_mode = EXCLUDED.persistence_mode,
  updated_at = now();
