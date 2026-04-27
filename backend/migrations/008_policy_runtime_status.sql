-- Mark warm-up and reputation policies as runtime repository modules
INSERT INTO repository_migration_status (module, target_table, persistence_mode)
VALUES
  ('admin_sessions', 'admin_sessions', 'postgresql-ready-runtime-ledger'),
  ('warmup_policies', 'warmup_policies', 'postgresql-ready-runtime-policy'),
  ('reputation_policies', 'reputation_policies', 'postgresql-ready-runtime-policy')
ON CONFLICT (module) DO UPDATE SET
  target_table = EXCLUDED.target_table,
  persistence_mode = EXCLUDED.persistence_mode,
  updated_at = now();
