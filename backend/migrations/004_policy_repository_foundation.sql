-- PostgreSQL policy repository foundation for warm-up and reputation controls
CREATE TABLE IF NOT EXISTS warmup_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  domain text NOT NULL UNIQUE,
  start_date date NOT NULL DEFAULT current_date,
  start_daily_cap integer NOT NULL CHECK (start_daily_cap >= 1 AND start_daily_cap <= 10000),
  max_daily_cap integer NOT NULL CHECK (max_daily_cap >= start_daily_cap AND max_daily_cap <= 100000),
  ramp_percent integer NOT NULL CHECK (ramp_percent >= 1 AND ramp_percent <= 100),
  days integer NOT NULL CHECK (days >= 1 AND days <= 365),
  per_domain_allocation text NOT NULL DEFAULT 'single-domain',
  enforcement_mode text NOT NULL DEFAULT 'dry-run-schedule-gate',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS reputation_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  domain text NOT NULL UNIQUE,
  bounce_rate_threshold numeric(6,5) NOT NULL DEFAULT 0.03000 CHECK (bounce_rate_threshold >= 0 AND bounce_rate_threshold <= 1),
  complaint_rate_threshold numeric(6,5) NOT NULL DEFAULT 0.00100 CHECK (complaint_rate_threshold >= 0 AND complaint_rate_threshold <= 1),
  deferral_rate_threshold numeric(6,5) NOT NULL DEFAULT 0.08000 CHECK (deferral_rate_threshold >= 0 AND deferral_rate_threshold <= 1),
  provider_error_rate_threshold numeric(6,5) NOT NULL DEFAULT 0.02000 CHECK (provider_error_rate_threshold >= 0 AND provider_error_rate_threshold <= 1),
  minimum_events integer NOT NULL DEFAULT 25 CHECK (minimum_events >= 1 AND minimum_events <= 100000),
  action_mode text NOT NULL DEFAULT 'recommendation_only',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS repository_migration_status (
  module text PRIMARY KEY,
  target_table text NOT NULL,
  persistence_mode text NOT NULL DEFAULT 'postgresql-ready-in-memory-runtime',
  live_repository_enabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO repository_migration_status (module, target_table)
VALUES
  ('contacts', 'contacts'),
  ('suppressions', 'suppressions'),
  ('templates', 'templates'),
  ('campaigns', 'campaigns'),
  ('send_queue', 'send_jobs'),
  ('email_events', 'email_events'),
  ('warmup_policies', 'warmup_policies'),
  ('reputation_policies', 'reputation_policies'),
  ('audit_log', 'audit_log'),
  ('users', 'users')
ON CONFLICT (module) DO UPDATE SET
  target_table = EXCLUDED.target_table,
  updated_at = now();

CREATE INDEX IF NOT EXISTS warmup_policies_domain_idx ON warmup_policies(domain);
CREATE INDEX IF NOT EXISTS reputation_policies_domain_idx ON reputation_policies(domain);
CREATE INDEX IF NOT EXISTS repository_migration_status_enabled_idx ON repository_migration_status(live_repository_enabled);
