# OracleStreet Autonomous Build Queue

Status: active indefinitely  
Owner: OracleStreet autonomous loop  
Last reset: 2026-04-27

## Standing mission

Build OracleStreet into a full private email sending CMS with PostgreSQL-backed persistence, remote PostgreSQL connectors/query tools, reputation-safe sending, PowerMTA integration, visible admin UI, and hard operational gates.

Reference target: `docs/13_FULL_EMAIL_CMS_TARGET.md`, `docs/14_MTA_WARMUP_LIST_HYGIENE_PLAN.md`, and `docs/15_FEATURE_INVENTORY_AND_NEXT_FLOWS.md`.

## Current priority stack

### O1 — VPS PostgreSQL foundation

Acceptance:
- PostgreSQL server/client installed on VPS.
- Local database and app role exist.
- `ORACLESTREET_DATABASE_URL` is generated/preserved in `/etc/oraclestreet/oraclestreet.env`.
- `backend/migrations/*.sql` are applied on deploy.
- Health/schema endpoint shows migrations and database config safely.

Verification:
- `ssh oraclestreet-vps 'psql --version && pg_isready'`
- `./scripts/deploy-vps.sh`
- `curl http://stuffprettygood.com/api/health`
- `curl http://stuffprettygood.com/api/schema/migrations`

### O2 — PostgreSQL persistence migration

Acceptance:
- Move in-memory users/admin, contacts, suppressions, templates, campaigns, send queue, and email events toward PostgreSQL-backed storage.
- Keep safe fallback only for local tests.
- Add repository layer/tests for each module.

Status:
- PostgreSQL repository schema foundation now includes `004_policy_repository_foundation` for warm-up policies, reputation policies, and repository migration status, plus `GET /api/database/repositories` to expose audited module readiness without secrets.
- Contacts, suppressions, templates, campaigns, send queue, email events, users, admin sessions, audit log, warm-up policies, and reputation policies now have local `psql` runtime repository adapters enabled on VPS via `ORACLESTREET_PG_REPOSITORIES=contacts,suppressions,templates,campaigns,send_queue,email_events,users,admin_sessions,audit_log,warmup_policies,reputation_policies`, with in-memory fallback for tests/local adapter failure.

Verification:
- backend tests pass.
- migration tests pass.
- deploy health passes.

### O3 — Visible admin CMS screens

Status: initial safe-read workbench shipped; contact import, template creation/preview, campaign dry-run builder, send queue dry-run dispatch, suppression management, reporting CSV export workflows, and list hygiene cleanup planner dashboard shipped; remaining CRUD workflows still pending.

Acceptance:
- Boss can log in and see actual modules, not just placeholder cards.
- UI must expose contacts, data sources, templates, campaigns, send queue, suppressions, reputation/readiness, reporting, and admin/user surfaces.
- Each screen can initially be safe-read or dry-run, but it must be visible and tied to backend routes.
- Next upgrade: replace remaining safe-read panels with forms/actions for live-gated remote source probe/schema discovery, PostgreSQL persistence, and user/RBAC readiness.

Verification:
- Browser/manual smoke of `/` after login.
- API calls visible in network and no console errors.
- `npm test --prefix backend` includes a static assertion for the CMS workbench surfaces.

### O4 — Remote PostgreSQL connector and query runner

Status: visible source registration UI, source registry, encrypted secret refs, schema discovery planner UI/API, sync dry-run validation/audit, SELECT-only query validator/planner UI/API, live read-only schema/query execution gates, contact import preview/field mapping, and approved contact import execution shipped. Live execution remains disabled unless `ORACLESTREET_REMOTE_PG_EXECUTION_ENABLED=true`, encrypted secret refs exist, bounded limits/timeouts pass, and the exact operator approval phrase is supplied; errors are redacted and destructive SQL is rejected. Import preview maps rows through contact validation without mutating contacts; approved import requires a separate exact import phrase and records sync-run history.

Acceptance:
- Save remote PostgreSQL connection metadata and encrypted credential refs.
- Test connection with redacted errors.
- Discover schemas/tables.
- Run SELECT-only queries with required limit/timeout.
- Import preview and mapping to contact fields.
- Sync job history/audit.

Safety:
- No destructive SQL by default.
- No password display after save.
- No raw connection strings in logs.

### O5 — Reputation-safe send engine

Acceptance:
- Queue persisted in PostgreSQL.
- SMTP/PowerMTA adapter can run dry-run and controlled one-recipient live-test.
- Domain readiness, rate limit, warm-up, bounce/complaint, and suppression gates block unsafe sends.
- Warm-up schedule preview UI/API and in-memory operator warm-up policy/schedule-cap gate shipped; future work should move policies into PostgreSQL repositories.
- Reputation dashboard shows domain/provider health.

Safety:
- No campaign-scale real send until final human approval gate exists.

### O6 — Reporting and audit

Acceptance:
- Campaign reporting, engagement, provider events, bounce/complaint, and affiliate metadata dashboards.
- Audit timeline for contacts/campaigns/send jobs.
- CSV export previews for summary/campaign/events/suppressions shipped; future work should persist/export from PostgreSQL once repositories migrate.

## Loop rules

- Every run must read this queue, `docs/13_FULL_EMAIL_CMS_TARGET.md`, `docs/14_MTA_WARMUP_LIST_HYGIENE_PLAN.md`, and `docs/15_FEATURE_INVENTORY_AND_NEXT_FLOWS.md` before choosing work.
- Prefer the next unshipped flow from `docs/15_FEATURE_INVENTORY_AND_NEXT_FLOWS.md` over passive health checks.
- Prefer shipping one real product slice over only checking health.
- If Boss says “I see no features,” prioritize visible UI affordances tied to existing backend capability.
- Install/repair VPS PostgreSQL and deploy migrations autonomously when safe.
- Commit, push, deploy, and verify safe changes.
- Never commit secrets or raw DB credentials.


## O7 — MTA, warm-up training, and list hygiene

Status: active

Acceptance:
- Build visible list management: browse/search/filter contacts, consent/source visibility, duplicate/risky/stale contact cleanup planning, suppression review, and source-quality scoring.
- Build MTA/PowerMTA path as a gated provider adapter: config validation, local capture/dry-run, provider message IDs, accounting import, controlled one-recipient live-test gate.
- Build warm-up training: sender-domain/IP profiles, daily/hourly caps, ramp stages, per-domain allocation, bounce/complaint/deferral pause thresholds, and campaign-calendar cap enforcement.
- Build feedback loop: bounces/complaints/unsubscribes/events update suppressions, list health, source risk, and reputation dashboards.
- Keep real outbound campaign sending locked until all safety gates pass and Boss explicitly approves.

Next slices, from `docs/15_FEATURE_INVENTORY_AND_NEXT_FLOWS.md`:
1. Flow C — Multi-user/RBAC admin workflow.
2. Flow D — Remote PostgreSQL import scheduler.
3. Flow E — Controlled one-recipient MTA proof path/runbook.
4. Flow D — Remote PostgreSQL import scheduler.
5. Flow E — Controlled one-recipient MTA proof path/runbook, still manual/out-of-band after all readiness blockers are resolved and Boss explicitly approves.
6. Flow F — Reporting dashboard depth.

Latest shipped slice:
- Flow B campaign calendar over warm-up caps: `/api/campaigns/calendar` shows scheduled dry-run campaigns by sender-domain/day, daily cap, planned count, remaining capacity, and over-cap state; scheduling now counts existing scheduled campaigns on the same day/domain before allowing another dry-run schedule, and the Campaigns UI exposes the calendar after login.
- Flow A contact browser/search drilldowns: `/api/contacts/browser` provides protected email/name/source/domain/status search, consent/source/domain/suppression/risk filters, source-quality scores, domain concentration, and contact timeline stubs from imports/events/jobs; the Contacts UI exposes the controls after login and remains read-only/no-delivery.
- Remote PostgreSQL approved contact import: `/api/data-source-import/execute` reruns the preview validation, requires exact import approval phrase `I_APPROVE_REMOTE_POSTGRESQL_CONTACT_IMPORT`, imports only zero-rejection mapped contacts through the normal contact repository, records imported/updated counts plus sync-run history, and keeps delivery locked.
- Remote PostgreSQL contact import preview: `/api/data-source-import/preview` maps approved SELECT/sample rows into OracleStreet contact fields, enforces email/consent/source/duplicate validation, audits the preview, and never imports or mutates contacts.
- Live remote PostgreSQL read-only execution gate: `/api/data-source-schema/discover` and `/api/data-source-query/execute` can execute only when env/operator gates pass, use encrypted secret refs, enforce SELECT/information_schema-only limits/timeouts, redact errors, reject destructive SQL, and expose visible UI controls without plaintext secrets.
- Controlled one-recipient MTA live-test runbook gate: `POST /api/email/controlled-live-test/plan` and the reputation UI now collect owned-recipient/proof/approval phrase and return a one-message runbook without sending, probing, mutating queues/providers, exposing secrets, or unlocking delivery.
- Warm-up/reputation policy PostgreSQL runtime adapter: warm-up policy list/save/schedule-cap evaluation and reputation policy save/evaluate now use local PostgreSQL tables through the `psql` adapter when enabled; recommendation-only posture and real-delivery lock remain intact.
- Users/admin sessions/audit PostgreSQL runtime adapter: admin login upserts the bootstrap admin into `users`, records a hashed session ledger in `admin_sessions`, and writes/list audit events through `audit_log` when enabled; signed cookies remain the auth verifier and raw tokens/passwords are never stored or exposed.
- Send queue/email events PostgreSQL runtime adapter: local VPS runtime can persist dry-run queue jobs, dry-run dispatch status, and delivery/engagement/bounce/complaint events through the local `psql` adapter when `ORACLESTREET_PG_REPOSITORIES` includes `send_queue,email_events`; migration `006_send_queue_event_runtime_ids` relaxes queue/event runtime IDs while real delivery remains locked.
- Templates/campaigns PostgreSQL runtime adapter: local VPS runtime can persist template drafts and campaign draft/approval/schedule/queue state through the local `psql` adapter when `ORACLESTREET_PG_REPOSITORIES=contacts,suppressions,templates,campaigns`; campaign runtime ID columns are relaxed for app-generated IDs while real delivery remains locked.
- Contacts/suppressions PostgreSQL runtime adapter: local VPS runtime can persist contact imports and suppression writes through the local `psql` adapter when `ORACLESTREET_PG_REPOSITORIES=contacts,suppressions`; list/segment/hygiene/queue gates read through the same repository and retain safe in-memory fallback for tests or adapter failure.
- PostgreSQL repository foundation: migration `004_policy_repository_foundation` adds warm-up/reputation policy tables and repository migration status, while `GET /api/database/repositories` and the dashboard expose audited schema readiness for contacts/suppressions/templates/campaigns/send queue/events/users without secrets or live data mutation.
- Warm-up policy persistence and campaign schedule cap enforcement: `GET/POST /api/email/warmup/policy` and `POST /api/email/warmup/schedule-cap` let operators persist in-memory warm-up profiles and block campaign dry-run schedules that exceed the sender-domain daily cap; queues/providers remain untouched and real delivery stays locked.
- Reputation auto-pause threshold controls: `GET/POST /api/email/reputation/policy` and `GET /api/email/reputation/auto-pause` let operators configure recommendation-only bounce/complaint/deferral/provider-error thresholds and evaluate events without mutating queues/providers or unlocking delivery.
- List hygiene dashboard + cleanup planner API/UI: `GET /api/list-hygiene/plan` computes duplicate/risky/suppressed/stale/source-quality/domain-concentration signals without mutating contacts, probing networks, or unlocking delivery; the Contacts workbench now surfaces cleanup recommendations.
