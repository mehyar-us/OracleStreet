# OracleStreet MTA, Warm-Up, and List Hygiene Build Plan

## Mandate

OracleStreet must continuously build toward a full private email sending CMS with local VPS PostgreSQL, visible list management, controlled MTA/PowerMTA capability, reputation-safe warm-up, and list cleanup. This plan is the durable operating target for the autonomous OracleStreet loop.

Real outbound delivery remains gated. Build the machinery, planning, safety, observability, and controlled-test path first; never enable campaign-scale sending until all gates pass and Boss explicitly approves.

## Required Product Areas

### 1. Local PostgreSQL foundation

Must stay verified on every serious deploy:

- `psql` installed on `oraclestreet-vps`.
- PostgreSQL service accepting local connections.
- database: `oraclestreet`.
- app role: `oraclestreet_app`.
- migration ledger: `schema_migrations`.
- core tables: `users`, `contacts`, `contact_attributes`, `data_sources`, `sync_runs`, `segments`, `templates`, `campaigns`, `send_jobs`, `suppressions`, `email_events`, `audit_log`.
- deploy script applies migrations idempotently without printing DB passwords.

### 2. List management CMS

Build visible UI and API for:

- CSV paste/upload import validation and import.
- remote PostgreSQL source registration, encrypted credential refs, schema discovery, SELECT-only query planning, and eventually live approved read-only pulls.
- contact list browsing, search, filters, tags/attributes, source provenance, consent status, timestamps.
- list segmentation by source, consent status, attributes, suppressions, engagement, domain, recency, and campaign membership.
- duplicate detection and merge planning.
- invalid email syntax detection.
- role-account/address detection and optional exclusion.
- dead-domain/MX risk planning without unsafe network fan-out by default.
- unsubscribe, bounce, complaint, manual suppression management.
- list hygiene score: accepted contacts, risky contacts, suppressed contacts, stale contacts, missing consent/source.

### 3. Email sending CMS

Build visible UI and API for:

- template creation/preview with required unsubscribe language.
- campaign builder with audience estimate, draft creation, approval, scheduling, and dry-run enqueue.
- send queue monitor with one-at-a-time dry-run dispatch, retry state, paused state, failure reasons, and provider message IDs.
- future campaign calendar with scheduled sends, warm-up caps, per-domain allocation, and approval state.
- audit trail for every operator action.

### 4. MTA / PowerMTA path

Build OracleStreet’s MTA capability as a safe provider adapter, not as a spam tool.

Required capabilities:

- provider config validation for SMTP/PowerMTA without sending.
- controlled local capture/dry-run provider.
- PowerMTA SMTP adapter interface with redacted config.
- provider message ID preservation.
- PowerMTA accounting CSV validation/import for delivered/deferred/bounce events.
- bounce/complaint ingestion and suppression.
- controlled one-owned-recipient live test gate.
- real delivery remains disabled until safety gates pass and explicit human approval is present.

### 5. Warm-up / reputation training

Build warm-up as an operator-controlled training system:

- sender/domain/IP warm-up profiles.
- daily and hourly caps.
- per-domain recipient allocation.
- ramp percentage and max cap controls.
- pause thresholds for bounce rate, complaint rate, deferral spikes, provider errors, and unsubscribe spikes.
- automatic pause recommendation before automatic send unlock.
- campaign calendar must respect warm-up caps.
- dashboard shows current stage, planned sends, used sends, remaining cap, bounce/complaint risk, and next safe action.
- no background campaign-scale live delivery until explicit approval gate exists.

### 6. Reputation and cleanup feedback loop

Events must feed back into list quality and sending safety:

- hard bounce -> suppression.
- complaint -> suppression and high-risk signal.
- repeated deferral -> domain/provider throttling recommendation.
- unsubscribes -> suppression and list score adjustment.
- stale/no-engagement contacts -> cleanup candidate.
- high complaint/bounce list source -> source quarantine recommendation.
- reporting export previews for summary/campaign/events/suppressions.

## Autonomous Loop Requirements

Every OracleStreet loop run must:

1. Read this file, `docs/13_FULL_EMAIL_CMS_TARGET.md`, and `tasks/ORACLESTREET_BUILD_QUEUE.md` before selecting work.
2. Prefer one product slice that makes the CMS more visible and usable.
3. Keep building list management, MTA path, warm-up/reputation, PostgreSQL persistence, and remote PostgreSQL connector work until complete.
4. Run tests and deploy after safe changes.
5. Verify site health, VPS PostgreSQL readiness, table presence, backend service, watchdog timer, nginx config, and a UI/API smoke relevant to the slice.
6. Commit and push safe changes after secret scan.
7. Send a concise progress update to the OracleStreet session with commit, changed, verified, blocker, and next slice.

## Next Recommended Slices

1. Multi-user/RBAC enforcement hardening beyond the safe invite-plan baseline.
2. Affiliate/campaign metadata and audit timeline depth.
3. Remote source persistence for source registry/encrypted secret metadata.
5. One-message MTA proof execution remains manual/out-of-band after all readiness blockers are resolved and Boss explicitly approves.

Latest warm-up calendar slice: `GET /api/campaigns/calendar` now renders scheduled dry-run campaigns against sender-domain warm-up caps with planned count, daily cap, remaining capacity, and over-cap days. `POST /api/campaigns/schedule-dry-run` counts already scheduled campaigns on the same sender-domain/day and blocks over-cap schedules before any queue/provider mutation.
