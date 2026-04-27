-- Add runtime persistence for remote import schedules and controlled proof audits
CREATE TABLE IF NOT EXISTS data_source_import_schedules (
  id text PRIMARY KEY,
  data_source_id text NOT NULL,
  data_source_name text NOT NULL,
  status text NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  interval_hours integer NOT NULL CHECK (interval_hours >= 1 AND interval_hours <= 720),
  next_run_preview_at timestamptz NOT NULL,
  projected_sql text NOT NULL,
  query_limit integer NOT NULL CHECK (query_limit >= 1 AND query_limit <= 500),
  timeout_ms integer NOT NULL CHECK (timeout_ms >= 100 AND timeout_ms <= 10000),
  mapping jsonb NOT NULL DEFAULT '{}'::jsonb,
  validation jsonb NOT NULL DEFAULT '{}'::jsonb,
  safety jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_email text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_data_source_import_schedules_created_at ON data_source_import_schedules (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_data_source_import_schedules_data_source ON data_source_import_schedules (data_source_id);

CREATE TABLE IF NOT EXISTS controlled_live_test_proof_audits (
  id text PRIMARY KEY,
  outcome text NOT NULL,
  recipient_masked text NOT NULL,
  recipient_owned boolean NOT NULL DEFAULT false,
  matches_configured_recipient boolean NOT NULL DEFAULT false,
  dry_run_proof_id text NOT NULL,
  provider_message_id text,
  notes text,
  actor_email text,
  safety jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  real_delivery_allowed boolean NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_controlled_live_test_proof_audits_created_at ON controlled_live_test_proof_audits (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_controlled_live_test_proof_audits_outcome ON controlled_live_test_proof_audits (outcome);

INSERT INTO repository_migration_status (module, target_table, persistence_mode)
VALUES
  ('data_source_import_schedules', 'data_source_import_schedules', 'postgresql-ready-runtime-schedule-ledger'),
  ('controlled_live_test_proof_audits', 'controlled_live_test_proof_audits', 'postgresql-ready-runtime-proof-audit')
ON CONFLICT (module) DO UPDATE SET
  target_table = EXCLUDED.target_table,
  persistence_mode = EXCLUDED.persistence_mode,
  updated_at = now();
