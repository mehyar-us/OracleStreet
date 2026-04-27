# OracleStreet Testing and QA

## Rule

Every built feature must include a verification path before it is considered done. The deploy flow should not rely on trust or vibes; it should prove core behavior after every change.

## Required test layers

### 1. Unit tests

Use for pure backend logic:

- campaign validation
- segment filtering
- suppression checks
- template rendering
- PowerMTA/SMTP provider config validation
- send safety gates

### 2. Integration tests

Use for backend + PostgreSQL + service boundaries:

- admin bootstrap/auth
- contact import
- campaign creation
- send job creation
- dry-run email sending
- event recording
- remote PostgreSQL pull jobs

### 3. Email send/receive tests

Email must be tested safely before domain/provider launch:

- **Dry-run provider**: records intended mail without external delivery.
- **Local capture provider**: sends to a controlled mailbox/capture service only.
- **SMTP/PowerMTA config validation**: checks host, port, auth, TLS mode, and sender identity without blasting mail.
- **Controlled live send**: one test message to an owned inbox only after unsubscribe/suppression/rate-limit gates exist.
- **Receiving/bounce path**: parse controlled bounce/complaint/unsubscribe events into `email_events` and suppression tables.

No campaign-scale real sending until the compliance gates in `docs/10-POWERMTA-INTEGRATION.md` pass.

### 4. Deployment smoke tests

After every deploy:

- frontend returns HTTP 200
- `/api/health` returns OK
- backend service is active
- Nginx config passes
- watchdog timer is active
- Docker and SSH remain active

## Current baseline command

```bash
npm test --prefix backend
./scripts/deploy-vps.sh
```

## Current verified feature paths

- Admin auth/session: `POST /api/auth/login`, `GET /api/auth/session`, `POST /api/auth/logout` with bootstrap credentials from `/etc/oraclestreet/initial-admin.env`. On VPS, successful login upserts the bootstrap admin into `users` and records/revokes hashed session ledger rows in `admin_sessions` when `ORACLESTREET_PG_REPOSITORIES` includes `users,admin_sessions`; signed cookies remain the verifier and plaintext passwords/tokens are never stored.
- Protected dashboard summary: `GET /api/dashboard` must return `401` without a session and safe-test counters with a valid admin session.
- Protected migration manifest: `GET /api/schema/migrations` must return `401` without a session and list SQL migrations with a valid admin session.
- PostgreSQL readiness/status: `GET /api/database/status` must require admin auth, validate PostgreSQL URL shape, redact credentials, and avoid live connection probes until the database driver/persistence slice is enabled.
- PostgreSQL repository readiness: `GET /api/database/repositories` must require admin auth, expose migration `004_policy_repository_foundation`, list module-to-table readiness for contacts/suppressions/templates/campaigns/send queue/events/warm-up/reputation/audit/users, audit the view, avoid secrets, avoid probes, and keep live repository writes disabled until the runtime adapter is enabled.
- Contact import/list baseline: `POST /api/contacts/import/validate` must return `401` without a session and reject rows missing valid email, explicit consent, source metadata, or with duplicate emails. `POST /api/contacts/import` must require admin auth, atomically reject invalid batches before storing any contact, and store/list valid consented contacts. On VPS, contacts use the local PostgreSQL `psql` repository adapter when `ORACLESTREET_PG_REPOSITORIES` includes `contacts`; tests/local adapter failure keep safe in-memory fallback.
- Segment/safe audience estimate baseline: `POST /api/segments/estimate` and `POST /api/segments` must require admin auth, filter only existing consented contacts, exclude suppressed contacts by default, report suppressed counts, and audit segment estimate/create actions.
- Template safe preview baseline: `POST /api/templates` and `POST /api/templates/preview` must require admin auth, reject HTML without unsubscribe language, render variable previews plus optional unsubscribe/open/click tracking URLs without delivery, update dashboard counts, and audit template create/preview actions. On VPS, templates use the local PostgreSQL `psql` repository adapter when `ORACLESTREET_PG_REPOSITORIES` includes `templates`; tests/local adapter failure keep safe in-memory fallback.
- Campaign draft/estimate baseline: `POST /api/campaigns/estimate` and `POST /api/campaigns` must require admin auth, require an existing segment and compliant template, estimate suppression-aware audience size, keep campaigns in `draft` with `realDeliveryAllowed: false`, update dashboard counts, and audit campaign estimate/create actions. On VPS, campaigns use the local PostgreSQL `psql` repository adapter when `ORACLESTREET_PG_REPOSITORIES` includes `campaigns`; tests/local adapter failure keep safe in-memory fallback.
- Campaign dry-run approval baseline: `POST /api/campaigns/approve-dry-run` must require admin auth, only approve draft campaigns, re-run segment/template compliance checks, require non-empty safe audience, mark the campaign `approved_dry_run`, keep `realDeliveryAllowed: false`, and audit the action.
- Campaign dry-run scheduling baseline: `POST /api/campaigns/schedule-dry-run` must require admin auth, only schedule approved dry-run campaigns, require a future `scheduledAt`, mark the campaign `scheduled_dry_run`, keep manual dispatch/no delivery, and audit the action.
- Campaign-to-queue dry-run baseline: `POST /api/campaigns/enqueue-dry-run` must require admin auth, only enqueue `approved_dry_run` or `scheduled_dry_run` campaigns, render the campaign template per contact, inject per-recipient `/api/unsubscribe`, `/api/track/open`, and `/api/track/click` URLs, exclude suppressed contacts through the segment estimate, apply send queue safety/rate-limit gates, create dry-run queue jobs only, mark campaign `queued_dry_run`, and audit the action.
- Campaign reporting safe summary: `GET /api/campaigns/reporting` must require admin auth, summarize per-campaign dry-run queued/dispatched jobs, internal events, open/click engagement counts/rates, and unsubscribe counts, audit the view, and keep `realDeliveryAllowed: false`.
- Frontend login/dashboard card: served from `/`, calls the auth, dashboard, and migration APIs through the Nginx `/api/` proxy, and displays safe product/email metrics including suppressions, events, bounce/complaint, opens/clicks, dry-run rates, provider mode, and locked real-sending state.
- Frontend CMS workbench: served from `/` after admin login, must expose visible safe-read surfaces for contacts, templates, campaigns, send queue, suppressions, remote PostgreSQL sources/sync runs, reputation/readiness, and audit events; tests must assert those surfaces exist in `frontend/index.html` until browser smoke automation is added.
- Frontend contact import workflow: the workbench must include visible validate/import controls wired to `/api/contacts/import/validate` and `/api/contacts/import`, require consent/source inputs in the pasted rows, report accepted/rejected counts, and refresh the contacts panel after safe import.
- List hygiene cleanup planner: `GET /api/list-hygiene/plan` must require admin auth, compute duplicate/risky/suppressed/stale/source-quality/domain-concentration signals, return cleanup recommendations, audit the view, mutate no contacts/suppressions, avoid network probes, and keep `realDeliveryAllowed: false`.
- Contact browser/search drilldowns: `GET /api/contacts/browser` must require admin auth, support email/name/source/domain/status search plus consent/source/domain/suppression/risk filters, return source-quality and domain concentration drilldowns, include contact timeline stubs from imports/events/jobs, audit searches, mutate no contacts/suppressions, avoid network probes, and keep `realDeliveryAllowed: false`.
- Frontend template creation workflow: the workbench must include visible safe draft template controls wired to `/api/templates` and `/api/templates/preview`, keep unsubscribe-language validation, report rejected validation errors, preview locally, refresh the templates panel, and never send mail.
- Frontend campaign builder workflow: the workbench must include visible campaign estimate/create/approve/schedule/enqueue controls wired to `/api/campaigns/estimate`, `/api/campaigns`, `/api/campaigns/approve-dry-run`, `/api/campaigns/schedule-dry-run`, and `/api/campaigns/enqueue-dry-run`; it must show audience/queue feedback, refresh campaign/queue panels, and keep `realDelivery` false.
- Frontend send queue dispatch workflow: the workbench must include a visible one-job dry-run dispatch control wired to `/api/send-queue/dispatch-next-dry-run`, show dispatched/rejected feedback, refresh queue state, record only internal dry-run events, and keep external delivery disabled.
- Frontend suppression management workflow: the workbench must include a visible add/update suppression form wired to `/api/suppressions`, require email/reason/source, support manual/unsubscribe/bounce/complaint reasons, show created/updated feedback, refresh suppression state, and keep suppressed recipients blocked from queue enqueue.
- Email config remains safe-test-only at `GET /api/email/config`; real sending stays disabled unless future safety gates pass.
- Local capture provider: with `ORACLESTREET_MAIL_PROVIDER=local-capture`, `POST /api/email/provider/validate` must require admin auth, validate `ORACLESTREET_LOCAL_CAPTURE_ALLOWED_DOMAIN`, never open a network connection, reject recipients outside the controlled domain, record accepted messages in memory, and expose them via protected `GET /api/email/local-capture` with `externalDelivery: false`.
- SMTP/PowerMTA provider validation: `POST /api/email/provider/validate` must require admin auth, report redacted readiness, skip network probes by default, and never expose passwords.
- Safe provider adapter interface: `GET /api/email/provider/adapter` must require admin auth, report dispatch capability/readiness, keep SMTP/PowerMTA `configured-but-locked`, redact secrets, audit the view, and never enable external delivery.
- Dry-run send queue: `POST /api/send-queue/enqueue` must require admin auth, reject messages missing consent/source/unsubscribe gates, enqueue compliant messages as `queued_dry_run`, and report `realDelivery: false`. `POST /api/send-queue/dispatch-next-dry-run` must require admin auth, dispatch one queued dry-run job at a time, mark it `dispatched_dry_run`, keep `dispatchMode: no_external_delivery`, record an internal `dispatched` event, and audit the action. On VPS, send queue jobs use the local PostgreSQL `psql` repository adapter when `ORACLESTREET_PG_REPOSITORIES` includes `send_queue`; tests/local adapter failure keep safe in-memory fallback.
- Send queue readiness safe gate: `GET /api/send-queue/readiness` must require admin auth, report queue totals, dry-run-only dispatch posture, sample queued job IDs, and safety gates without mutating the queue, dispatching, probing networks, exposing secrets, or unlocking real email delivery.
- Suppression/unsubscribe baseline: `POST /api/suppressions` must require admin auth; `GET`/`POST /api/unsubscribe` must record unsubscribe suppressions; tracked GET unsubscribe links must preserve campaign/contact metadata; suppressed recipients must be blocked from dry-run queue enqueue. On VPS, suppressions use the local PostgreSQL `psql` repository adapter when `ORACLESTREET_PG_REPOSITORIES` includes `suppressions`; tests/local adapter failure keep safe in-memory fallback.
- Rate-limit/warm-up baseline: `GET /api/email/rate-limits` must require admin auth; dry-run queue enqueue must enforce global and per-domain hourly caps before any provider path.
- Warm-up planner preview: `POST /api/email/warmup/plan` must require admin auth, validate sender domain/start cap/max cap/ramp/days, return day-by-day daily/hourly caps with bounce/complaint pause thresholds, audit preview actions, mutate no queues/providers/DNS, and keep `realDeliveryAllowed: false`.
- Warm-up policy, campaign calendar, and schedule-cap enforcement: `GET`/`POST /api/email/warmup/policy`, `POST /api/email/warmup/schedule-cap`, and `GET /api/campaigns/calendar` must require admin auth, validate sender-domain policy inputs, persist policy through local PostgreSQL on VPS when `ORACLESTREET_PG_REPOSITORIES` includes `warmup_policies`, show scheduled dry-runs against remaining sender-domain capacity, count existing scheduled campaigns on the same day/domain before allowing another dry-run schedule, audit view/save/evaluate actions, reject over-cap campaign dry-run schedules with `warmup_daily_cap_exceeded`, mutate no queues/providers/DNS, and keep `realDeliveryAllowed: false`. Tests/local adapter failure keep safe in-memory fallback.
- Reputation auto-pause controls: `GET`/`POST /api/email/reputation/policy` and `GET /api/email/reputation/auto-pause` must require admin auth, validate threshold/domain/minimum-event inputs, persist policy through local PostgreSQL on VPS when `ORACLESTREET_PG_REPOSITORIES` includes `reputation_policies`, evaluate current email events into counts/rates/breaches, audit view/save/evaluate actions, mutate only policy state, never pause queues/providers, and keep `realDeliveryAllowed: false`. Tests/local adapter failure keep safe in-memory fallback.
- Frontend warm-up/reputation workflow: `/` after admin login and reputation-gate load must show visible sender-domain warm-up controls wired to `/api/email/warmup/plan`, warm-up policy save/schedule-cap controls wired to `/api/email/warmup/policy` and `/api/email/warmup/schedule-cap`, auto-pause threshold save/evaluate controls wired to `/api/email/reputation/policy` and `/api/email/reputation/auto-pause`, plus controlled live-test runbook controls wired to `/api/email/controlled-live-test/plan`; it must render accepted/rejected feedback and avoid external writes or delivery unlocks.
- Manual bounce parser validation: `POST /api/email/bounce-parse/validate` must require admin auth, parse DSN-style text for final recipient, action/status, and diagnostic detail, classify hard bounces vs deferrals, preserve optional campaign/contact metadata, audit validation, and never record events, create suppressions, probe networks, or send mail.
- Manual parsed bounce ingest: `POST /api/email/bounce-parse/ingest` must require admin auth, parse the same DSN-style text, record hard bounces as bounce events with suppressions, record deferrals as deferred events without suppressions, audit ingest, avoid mailbox connections/network probes, and keep `realDelivery: false`.
- Bounce mailbox readiness safe gate: `GET /api/email/bounce-mailbox/readiness` must require admin auth, report redacted mailbox host/user/folder/TLS/polling posture, require polling disabled until approval, audit the view, never expose passwords, never connect to mailboxes, never read messages, never create suppressions, and keep `realDeliveryAllowed: false`.
- PowerMTA accounting CSV import validation: `POST /api/email/powermta/accounting/validate-import` must require admin auth, parse recipient/status/action/diagnostic/provider-message metadata, classify delivered/deferred/bounce rows, reject invalid recipients/statuses, audit validation, and never record events, create suppressions, probe networks, connect to mailboxes, or send mail.
- PowerMTA accounting CSV import ingest: `POST /api/email/powermta/accounting/import` must require admin auth, atomically reject invalid CSV rows before recording anything, record valid delivered/deferred/bounce rows as events, preserve optional provider message IDs, create suppressions for hard bounces only, audit ingest, and never probe networks, connect to mailboxes, send mail, or unlock delivery.
- Provider message event lookup: `GET /api/email/events/provider-message?providerMessageId=...` must require admin auth, return matching events for traceability, audit lookup, reject missing/oversized IDs, and never record events, create suppressions, probe networks, connect to mailboxes, send mail, or unlock delivery.
- Manual event CSV import validation: `POST /api/email/events/validate-import` must require admin auth, parse `type,email,source` CSV files, accept only `bounce`/`complaint` rows, preserve optional campaign/contact metadata, audit the validation, and never record events, create suppressions, probe networks, or send mail.
- Manual event CSV import ingest: `POST /api/email/events/import` must require admin auth, atomically reject CSV files with invalid rows before recording anything, import fully valid bounce/complaint rows into events and suppressions, preserve optional campaign/contact metadata, audit the import, and never probe networks or send mail.
- Engagement tracking baseline: `GET /api/track/open` and `GET /api/track/click` must record only open/click event metadata, preserve campaign/contact fields, require valid email, keep redirects disabled, avoid network probes or delivery, and surface open/click counts in safe reporting.
- Bounce/complaint ingest baseline: `POST /api/email/events/ingest` must require admin auth, accept only `bounce`/`complaint` manual batches, record events, create suppressions, and block affected recipients from queue enqueue. Manual ingest must reject internal-only `dispatched` events. On VPS, email events use the local PostgreSQL `psql` repository adapter when `ORACLESTREET_PG_REPOSITORIES` includes `email_events`; tests/local adapter failure keep safe in-memory fallback.
- Manual delivery event ingest baseline: `POST /api/email/delivery-events/ingest` must require admin auth, accept only `delivered`/`deferred` manual batches, preserve optional campaign/contact metadata, reject bounce/complaint/internal events, avoid suppressions, avoid network probes, and keep `realDelivery: false`.
- Safe reporting baseline: `GET /api/email/reporting` and `GET /api/dashboard` must require admin auth and summarize queue, suppression, bounce/complaint, open/click engagement, provider, rate-limit, and compliance-gate state without enabling delivery. Dashboard must include campaign engagement totals/rates and embedded campaign reporting.
- Reporting CSV export preview: `GET /api/email/reporting/export?dataset=summary|campaigns|events|suppressions` must require admin auth, reject unknown datasets, return CSV previews with row counts/filenames, include no secrets, audit export preview actions, and keep `realDeliveryAllowed: false`.
- Frontend reporting export workflow: `/` after admin login must show a visible reporting export panel wired to `/api/email/reporting/export`, allow summary/campaigns/events/suppressions datasets, render CSV preview feedback, and avoid external writes or delivery unlocks.
- Sending readiness safe gate: `GET /api/email/sending-readiness` must require admin auth, report provider/config/compliance blockers without exposing secrets, include sender-domain readiness, audit the view, and keep `readyForRealDelivery: false`/`realDeliveryAllowed: false` until a future explicit controlled-live approval path exists.
- Controlled live-test readiness safe gate: `GET /api/email/controlled-live-test/readiness` must require admin auth, require a non-dry-run provider, valid provider config, owned controlled recipient, sender domain readiness, bounce mailbox readiness, single-message rate limits, and explicit human approval; it must redact secrets, never send, never mutate queues/suppressions, and keep `realDeliveryAllowed: false`.
- Controlled live-test runbook gate: `POST /api/email/controlled-live-test/plan` must require admin auth, require configured owned recipient match, dry-run/local-capture proof ID, and exact approval phrase `I_APPROVE_ONE_OWNED_RECIPIENT_LIVE_TEST`; it may return a one-message manual runbook but must never send, probe networks, mutate queues/providers/suppressions, expose secrets, or unlock delivery.
- Controlled live-test proof audit: `GET`/`POST /api/email/controlled-live-test/proof-audit` must require admin auth, record only masked-recipient proof metadata/outcomes/provider message IDs/notes, require provider message IDs for manual-send outcome records, audit list/create actions, and never send, probe networks, mutate queues/providers/suppressions, expose secrets, or unlock delivery.
- Sender domain readiness safe gate: `GET /api/email/domain-readiness` must require admin auth, validate the default sender domain shape, report expected SPF/DKIM/DMARC/TLS requirements without DNS probing, audit the view, and never enable delivery.
- Web/domain readiness safe gate: `GET /api/web/domain-readiness` must require admin auth, report expected apex/www DNS records, primary/fallback health URLs, TLS mode planning, and smoke-test commands without DNS/network probes, HTTPS changes, or unlocking real email delivery.
- TLS readiness safe gate: `GET /api/web/tls-readiness` must require admin auth, report selected TLS mode, certificate candidate domains, prerequisites, and HTTP/HTTPS smoke-test commands without requesting certificates, editing Nginx, probing certificates, or unlocking real email delivery.
- Backup readiness safe gate: `GET /api/backups/readiness` must require admin auth, report redacted PostgreSQL backup command planning, backup path/schedule/retention, and restore/offsite recommendations without creating dumps, writing files, exposing secrets, or unlocking real email delivery.
- Monitoring readiness safe gate: `GET /api/monitoring/readiness` must require admin auth, report health/frontend/service/nginx/watchdog check plans, monitor interval, alert posture, and recommended commands without probing networks, mutating services, exposing secrets, or unlocking real email delivery.
- Platform rate-limit readiness safe gate: `GET /api/platform/rate-limit-readiness` must require admin auth, report admin/API/import/dry-run queue rate-limit posture, protected surfaces, and enforcement gaps without mutating traffic, storing IPs, exposing secrets, or unlocking real email delivery.
- RBAC readiness and safe admin user workflow: `GET /api/platform/rbac-readiness`, `GET /api/admin/users`, and `POST /api/admin/users/invite-plan` must require admin auth, report current single-admin access, planned least-privilege roles, protected surfaces, user directory metadata, and multi-user blockers without mutating users/roles, sending emails, generating/outputting tokens or passwords, exposing secrets, or unlocking real email delivery. Invite-plan actions must validate role/email and audit accepted/rejected plans.
- Data source registry baseline: `GET`/`POST /api/data-sources` must require admin auth, accept only PostgreSQL source URLs, redact passwords, skip network probes, keep `syncEnabled: false`, audit create/list actions, and never pull remote data.
- Encrypted data source secret baseline: `POST /api/data-sources` with `storeSecret: true` must require `ORACLESTREET_DATA_SOURCE_SECRET_KEY`, store only encrypted connection material with AES-256-GCM, return only redacted URL metadata plus an encrypted secret ref, and never expose plaintext secrets in create/list/error responses.
- Data source sync dry-run baseline: `GET`/`POST /api/data-source-sync-runs` must require admin auth, reject unknown source IDs, validate optional mapping fields, create listable dry-run validation records, skip network probes, import/pull zero remote rows, record future-live-sync blockers, audit actions, and keep `realSync: false`.
- Data source contact import preview: `POST /api/data-source-import/preview` must require admin auth, accept bounded sample/approved SELECT rows, map configured columns/defaults into contact fields, enforce email/explicit-consent/source/duplicate validation, return accepted/rejected samples, audit preview actions, avoid plaintext secrets, and never import or mutate contacts.
- Data source approved contact import: `POST /api/data-source-import/execute` must require admin auth, rerun preview validation, require exact import approval phrase `I_APPROVE_REMOTE_POSTGRESQL_CONTACT_IMPORT`, block any preview with rejected rows, import through the normal contact repository path, record imported/updated counts and sync-run history, audit attempts, avoid plaintext secrets, and keep real email delivery locked.
- Data source import scheduler: `GET`/`POST /api/data-source-import-schedules` must require admin auth, validate registered source, SELECT-only query, bounded limit/timeout, explicit contact mapping/default consent/source, interval range, and exact schedule approval phrase when marked enabled; return redacted schedule history and next-run preview metadata, audit accepted/rejected plans, avoid immediate remote pulls/background workers/contact mutation/secret output, and keep real email delivery locked.
- Data source schema discovery planner: `POST /api/data-source-schema/plan` must require admin auth, reject missing/unknown sources, require a safe schema allowlist, enforce bounded table/column limits and timeout, return redacted source metadata plus planned information_schema table/column queries, return zero tables/columns/rows, audit planning, and keep `realDiscovery: false` until live execution gates pass.
- Data source live schema discovery gate: `POST /api/data-source-schema/discover` must require admin auth, encrypted secret refs, `ORACLESTREET_REMOTE_PG_EXECUTION_ENABLED=true`, exact approval phrase `I_APPROVE_REMOTE_POSTGRESQL_READ_ONLY_EXECUTION`, schema allowlist, bounded table/column limits, bounded timeout, redacted errors, information_schema-only queries, no secret output, audit attempts, and stay blocked with zero tables/columns when any gate fails.
- Data source SELECT query validator: `POST /api/data-source-query/validate` must require admin auth, reject missing/unknown sources, enforce SELECT/CTE-only single statements, reject destructive SQL, require bounded limit and timeout, return redacted source metadata plus projected SQL/schema-discovery plan, pull zero rows, audit validation, and keep `realQuery: false` until live execution gates pass.
- Data source live SELECT execution gate: `POST /api/data-source-query/execute` must require admin auth, encrypted secret refs, `ORACLESTREET_REMOTE_PG_EXECUTION_ENABLED=true`, exact approval phrase `I_APPROVE_REMOTE_POSTGRESQL_READ_ONLY_EXECUTION`, SELECT-only single statement, bounded limit/timeout, redacted errors, no secret output, no destructive SQL, audit execution attempts, and stay blocked with zero rows when any gate fails.
- Frontend remote PostgreSQL source registration workflow: `/` after admin login must show a visible PostgreSQL source registration form in the remote PostgreSQL panel, call `/api/data-sources`, support encrypted secret refs, clear password fields after save, display only redacted metadata, and keep live sync/query execution disabled.
- Frontend remote PostgreSQL query workflow: `/` after admin login must show a visible SELECT-only query validator, gated live execution controls, contact import preview mapper, and approved import button in the remote PostgreSQL panel; call `/api/data-source-query/validate`, `/api/data-source-query/execute`, `/api/data-source-schema/discover`, `/api/data-source-import/preview`, and `/api/data-source-import/execute`; report accepted/blocked/preview/import status, avoid plaintext secrets, and keep live remote execution/import mutation disabled unless backend gates pass.
- Frontend remote PostgreSQL mapping/status UI baseline: `/` after admin login must show data source/sync dry-run counters and a redacted mapping/status panel, call only protected metadata endpoints, avoid plaintext secrets, and keep remote row pulls disabled.
- Data source sync audit log baseline: `GET /api/data-source-sync-audit` must require admin auth, return sanitized `data_source_sync*` events only, audit the view action, avoid plaintext secrets, and keep `realSync: false`.
- Audit log baseline: `GET /api/audit-log` must require admin auth, sanitize sensitive fields, and record key admin/compliance actions such as login attempts, provider validation, queue enqueue, suppression, unsubscribe, event ingest, and database status checks. On VPS, audit events use the local PostgreSQL `psql` repository adapter when `ORACLESTREET_PG_REPOSITORIES` includes `audit_log`; tests/local adapter failure keep safe in-memory fallback.
- Email engine schema alignment migration: `GET /api/schema/migrations` must require admin auth and list `002_email_engine_alignment`, which aligns PostgreSQL campaign/send-job/event status constraints and dry-run queue metadata columns with the current safe email engine without applying migrations or mutating the database from the API.
- Provider message traceability migration: `GET /api/schema/migrations` must list `003_provider_message_event_traceability`, which adds nullable `email_events.provider_message_id` plus filtered lookup indexes for PMTA/accounting traceability without storing secrets or applying migrations from the API.
- Policy repository foundation migration: `GET /api/schema/migrations` must list `004_policy_repository_foundation`, which creates `warmup_policies`, `reputation_policies`, and `repository_migration_status` for the PostgreSQL persistence migration path without storing secrets or applying migrations from the API. `008_policy_runtime_status` records policy runtime repository readiness metadata without storing secrets or applying migrations from the API.
- Campaign repository runtime migration: `GET /api/schema/migrations` must list `005_campaign_repository_runtime_ids`, which relaxes campaign segment/template IDs to text and adds dry-run campaign state metadata columns for the PostgreSQL runtime repository path without storing secrets or applying migrations from the API.
- Send queue/event runtime migration: `GET /api/schema/migrations` must list `006_send_queue_event_runtime_ids`, which relaxes send queue and email event runtime IDs/foreign-key columns and adds event provenance columns for the PostgreSQL runtime repository path without storing secrets or applying migrations from the API.
- Users/session/audit runtime migration: `GET /api/schema/migrations` must list `007_users_sessions_audit_runtime`, which adds the `admin_sessions` table and audit metadata columns for PostgreSQL runtime user/session/audit persistence without storing plaintext passwords/tokens or applying migrations from the API.

## Domain readiness checklist

Before connecting a domain:

- app health checks passing by IP
- admin auth working
- email dry-run tests passing
- SMTP/PowerMTA config validation passing
- unsubscribe endpoint working
- suppression table enforced
- DNS plan documented
- SPF/DKIM/DMARC plan documented
- TLS plan documented

## PMTA-first development priority

Boss prioritized PMTA/sending capability first. Build order is now: provider config validation, dry-run controlled test-send, SMTP adapter, PowerMTA adapter, receive/bounce testing, then production domain/TLS/DNS. Real outbound mail remains disabled until safety gates pass.

## Current domain wiring

OracleStreet is now wired toward `stuffprettygood.com` on VPS `187.124.147.49`. See `docs/12-DOMAIN-CLOUDFLARE.md`.
