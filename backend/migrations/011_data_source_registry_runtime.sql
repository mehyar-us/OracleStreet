-- Persist remote PostgreSQL source registry and encrypted secret metadata for safe runtime reuse
CREATE TABLE IF NOT EXISTS data_source_registry (
  id text PRIMARY KEY,
  name text NOT NULL,
  type text NOT NULL DEFAULT 'postgresql',
  status text NOT NULL DEFAULT 'registered_safe',
  redacted_url text,
  parsed jsonb NOT NULL DEFAULT '{}'::jsonb,
  secret_stored boolean NOT NULL DEFAULT false,
  secret_storage text NOT NULL DEFAULT 'metadata-only',
  encrypted_connection_ref jsonb,
  encryption jsonb NOT NULL DEFAULT '{}'::jsonb,
  connection_probe text NOT NULL DEFAULT 'skipped_registry_validation_only',
  sync_enabled boolean NOT NULL DEFAULT false,
  actor_email text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz
);

CREATE TABLE IF NOT EXISTS data_source_encrypted_secrets (
  id text PRIMARY KEY,
  algorithm text NOT NULL,
  iv text NOT NULL,
  ciphertext text NOT NULL,
  auth_tag text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_data_source_registry_created_at ON data_source_registry (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_data_source_registry_type ON data_source_registry (type);
CREATE INDEX IF NOT EXISTS idx_data_source_registry_secret_stored ON data_source_registry (secret_stored);

INSERT INTO repository_migration_status (module, target_table, persistence_mode)
VALUES
  ('data_sources', 'data_source_registry', 'postgresql-ready-runtime-registry'),
  ('data_source_encrypted_secrets', 'data_source_encrypted_secrets', 'postgresql-ready-runtime-secret-metadata')
ON CONFLICT (module) DO UPDATE SET
  target_table = EXCLUDED.target_table,
  persistence_mode = EXCLUDED.persistence_mode,
  updated_at = now();
