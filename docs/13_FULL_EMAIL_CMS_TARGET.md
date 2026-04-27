# OracleStreet Full Email Sending CMS Target

## Executive target

OracleStreet must become a private, PostgreSQL-backed email marketing CMS: contacts, audiences, remote data pulls, campaign builder, templates, send queue, PowerMTA/SMTP sending, reputation controls, events, reporting, admin users, and operational safety.

The current UI is still a control-room shell. The autonomous flow must keep converting backend baselines into visible admin product screens until the site feels like a real CMS, not a placeholder.

## Non-negotiable product modules

### 1. Users, auth, and roles

- first admin bootstrap
- users table in PostgreSQL
- roles: owner, admin, operator, analyst, read-only
- session management
- audit logs for privileged actions
- API auth for internal automations
- password rotation/reset path

### 2. Local VPS PostgreSQL foundation

- PostgreSQL installed on the VPS
- local database `oraclestreet`
- local app role `oraclestreet_app`
- `ORACLESTREET_DATABASE_URL` stored in `/etc/oraclestreet/oraclestreet.env`
- migrations applied from `backend/migrations/*.sql`
- migration ledger table
- backup readiness and restore runbook
- app gradually moved from in-memory baselines to PostgreSQL persistence

### 3. Remote PostgreSQL connectors

Boss specifically wants the ability to enter remote PostgreSQL credentials and pull/query data.

Required features:

- remote source registry: name, host, port, database, username, SSL mode, purpose
- encrypted credential storage; never display passwords after save
- connection test/probe with timeout and redacted errors
- schema/table discovery allowlist
- controlled SQL query runner:
  - SELECT-only by default
  - row limit required
  - timeout required
  - explain/dry-run mode
  - no destructive statements unless a future explicit admin gate exists
- mapping tool from remote rows to contacts/campaign fields
- import preview with counts and validation errors
- sync job scheduler
- sync run history and audit log

### 4. Contacts and consent

- contacts table persisted in PostgreSQL
- import CSV and remote PostgreSQL import
- source/consent fields required
- status: active, unsubscribed, bounced, complained, suppressed
- custom attributes
- tags/lists
- dedupe and merge
- validation and enrichment hooks

### 5. Suppression and compliance

- global suppression list
- campaign-level suppression
- unsubscribe handling
- complaint handling
- hard bounce suppression
- consent/source audit trail
- unsubscribe link injection in every marketing email
- legal footer controls
- no bypass path for suppression checks

### 6. Segments and audiences

- visual segment builder
- SQL-backed saved filters
- audience estimate before send
- suppression-aware final count
- risk flags: stale consent, high bounce domain, free-mail concentration, new-domain risk
- segment snapshots for campaign reproducibility

### 7. Templates and creative CMS

- template CRUD
- subject/preheader/body
- HTML + text versions
- variable/personalization engine
- unsubscribe/footer validation
- spam-word/risk linting
- preview renderer
- test render against sample contact
- asset library later

### 8. Campaign builder

- campaign table persisted in PostgreSQL
- draft -> approved -> scheduled -> sending -> paused -> completed states
- choose segment + template + sender identity
- estimate audience and risk
- approval gate
- schedule controls
- pause/resume/cancel
- A/B subject/content later
- affiliate tracking metadata

### 9. Sending engine

- send queue table persisted in PostgreSQL
- idempotent job IDs
- retry policy
- per-domain throttles
- per-provider throttles
- warm-up calendars
- bounce/complaint feedback integration
- dry-run provider
- local capture provider
- SMTP provider
- PowerMTA adapter
- controlled one-recipient live-test mode before any scale send

### 10. Reputation and deliverability

Boss specifically wants sending while maintaining reputation. Required gates:

- domain readiness: SPF, DKIM, DMARC, MX, reverse DNS notes
- TLS readiness
- sender identity readiness
- IP/domain warm-up profiles
- daily caps per domain/provider
- bounce rate thresholds
- complaint rate thresholds
- deferral monitoring
- automatic pause when thresholds trip
- list hygiene checks
- seed inbox/live test tracking later
- PowerMTA accounting import
- provider message ID traceability
- deliverability dashboard

### 11. Events and reporting

- sends, delivered, deferred, bounced, complained, opened, clicked, unsubscribed
- campaign engagement dashboard
- domain/provider reputation dashboard
- queue throughput
- failure reasons
- affiliate/campaign ROI fields later
- CSV export
- audit/event timeline per recipient and campaign

### 12. Operations

- watchdog
- deploy health
- database health
- backup health
- monitoring readiness
- rate-limit readiness
- RBAC readiness
- migrations and rollback
- release checklist

## Autonomous build order from here

The OracleStreet cron must stop treating the project as “health check only.” Every run should ship one real slice or advance one durable blocker.

Current shipped feature inventory and the next mandated build flows are maintained in `docs/15_FEATURE_INVENTORY_AND_NEXT_FLOWS.md`. The loop must read that file every run and use it to pick the next feature slice after checking the queue.

Priority order:

1. VPS PostgreSQL installation and migration automation.
2. PostgreSQL-backed users/admin/session readiness.
3. PostgreSQL persistence for contacts, suppressions, templates, campaigns, send queue, and events.
4. Admin UI screens for the existing backend modules so Boss can see/use features.
5. Remote PostgreSQL connector: save credentials, probe, schema discover, SELECT-only query runner, import preview.
6. Reputation-safe sending: warm-up/rate limit policies, domain readiness, PowerMTA config, controlled live-test gate.
7. Reporting dashboards and traceability.
8. Hardening: RBAC, backups, monitoring, audits, alerts.

## Definition of done for every feature

Each feature must include:

- backend route or persistence layer
- visible admin UI affordance unless purely operational
- tests
- safe default/dry-run posture
- no secrets in git/logs
- docs updated
- deploy verification

## Real sending boundary

OracleStreet must never become spam tooling. Real sending is blocked until all of these are true:

- consent/source enforcement is active
- unsubscribe/suppression is active in the send path
- bounce/complaint ingestion is active
- per-domain/provider rate limits are active
- warm-up controls are active
- sender domain DNS readiness passes
- audit logs exist
- one-recipient controlled live-test is explicitly selected
- production campaign-scale sending has a final human approval gate
