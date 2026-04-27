# OracleStreet Feature Inventory and Next Build Flows

Last updated: 2026-04-27 15:52 EDT  
Owner: OracleStreet autonomous product-build loop

## Purpose

This is the durable product inventory for OracleStreet. The autonomous loop must use this file to avoid forgetting what already exists and to keep building the remaining full email CMS surfaces in the right order.

OracleStreet is a private, PostgreSQL-first email marketing CMS and affiliate campaign platform. Real outbound sending remains locked until all compliance, reputation, and human approval gates pass.

## Current shipped feature inventory

### Infrastructure and deployment

- VPS reset/baseline for OracleStreet.
- Nginx frontend and backend proxy baseline.
- Backend health endpoint.
- Deployment script for VPS release.
- PostgreSQL server/client installed on VPS.
- Local database `oraclestreet` and app role `oraclestreet_app`.
- `ORACLESTREET_DATABASE_URL` preserved/generated in `/etc/oraclestreet/oraclestreet.env`.
- SQL migrations applied during deploy.
- `schema_migrations` ledger.
- Schema/migration status endpoint.
- Watchdog/self-heal service and timer.
- Backend test gate before deploy.
- GitHub push path via token without printing/persisting secrets.

### Admin, auth, users, and audit

- First admin bootstrap login.
- HttpOnly admin session cookie.
- Logout/session clear.
- Protected admin API surfaces.
- PostgreSQL runtime adapter for users.
- PostgreSQL runtime adapter for admin session ledger.
- PostgreSQL runtime adapter for audit log.
- Audit log baseline and visible audit panel.
- RBAC readiness endpoint and planned owner/admin/operator/analyst/read-only roles.
- Admin user directory endpoint over the users repository/bootstrap admin fallback.
- Safe admin invite-plan endpoint that validates role/email, audits the plan, sends no email, creates no password/token, and mutates no users.
- Raw passwords/tokens are not stored or exposed by the runtime adapter.

### Visible admin CMS workbench

- Dashboard metrics cards.
- Contacts panel.
- Contact import workflow.
- Template creator and safe preview workflow.
- Campaign builder workflow.
- Send queue dry-run dispatch workflow.
- Suppression management workflow.
- Remote PostgreSQL source/query/schema/import surfaces.
- Reputation/readiness panel.
- Warm-up planner controls.
- Warm-up policy controls.
- Reputation auto-pause threshold controls.
- Controlled live-test runbook gate UI.
- Reporting export panel.
- List hygiene planner dashboard.
- Audit panel.
- Users/RBAC panel with user directory, role permission matrix, blockers, and safe invite-plan controls.

### Contacts, consent, and list hygiene

- Contact list/import baseline.
- Contact import validation.
- Consent/source required for imports and dry-run sends.
- PostgreSQL runtime adapter for contacts.
- Suppression-aware segment audience estimates.
- Source/consent metadata display.
- List hygiene planner API/UI:
  - duplicate detection
  - risky/stale contact flags
  - suppressed contact visibility
  - source-quality scoring
  - domain concentration signals
  - cleanup recommendations
- Contact browser search/filter API/UI:
  - email/name/source/domain/status search
  - consent/source/domain/suppression/risk filters
  - source-quality drilldowns
  - domain concentration drilldowns
  - contact timeline stubs from imports, events, and dry-run jobs
- Safe in-memory fallback for local tests/adapter failures.

### Suppression and compliance

- Global suppression list baseline.
- PostgreSQL runtime adapter for suppressions.
- Manual suppression creation/update from admin workbench.
- Unsubscribe suppression recording.
- Bounce suppression.
- Complaint suppression.
- Dry-run queue blocks suppressed recipients.
- Unsubscribe link injection/tracking baseline.
- No designed bypass path for suppression checks.

### Templates and campaigns

- Template CRUD baseline.
- Template HTML/text safe preview.
- Unsubscribe language enforcement.
- PostgreSQL runtime adapter for templates.
- Campaign draft creation.
- Audience estimate.
- Dry-run approval.
- Dry-run schedule.
- Campaign-to-send-queue dry-run enqueue.
- PostgreSQL runtime adapter for campaigns.
- Campaign engagement reporting baseline.
- Affiliate/campaign metadata remains a future expansion lane.

### Send queue and email engine

- Dry-run email provider.
- Local capture provider.
- SMTP provider config validation.
- PowerMTA SMTP adapter config validation.
- Provider adapter interface baseline.
- Send queue dry-run enqueue.
- Send queue dry-run dispatch.
- Send queue readiness safe gate.
- PostgreSQL runtime adapter for send queue jobs.
- Rate-limit enforcement before provider path.
- Provider message ID traceability.
- PowerMTA accounting CSV validation/ingest baseline.
- Real campaign-scale sending remains locked.

### Events, tracking, and reporting

- PostgreSQL runtime adapter for email events.
- Event types tracked/ingested:
  - dispatched
  - delivered
  - deferred
  - bounced
  - complained
  - opened
  - clicked
  - unsubscribed
- Manual event CSV validation/ingest.
- Manual delivery event ingest.
- Open/click engagement tracking baseline.
- Campaign tracking URL injection baseline.
- Campaign reporting safe summary.
- Campaign engagement dashboard summary.
- Reporting CSV export preview API/UI for:
  - summary
  - campaigns
  - events
  - suppressions
- Exports require admin auth, audit preview actions, and contain no secrets or delivery unlock.

### Remote PostgreSQL connector

- Remote PostgreSQL source registration UI/API.
- Redacted connection metadata.
- Encrypted secret refs.
- No password display after save.
- Sync dry-run validation/audit baseline.
- Schema discovery planner UI/API.
- SELECT-only query validator/planner UI/API.
- Live read-only schema/query execution gate with:
  - env enablement requirement
  - encrypted secret requirement
  - bounded limits/timeouts
  - exact operator approval phrase
  - redacted errors
  - destructive SQL rejection
- Remote PostgreSQL contact import preview with field mapping.
- Approved remote contact import execution with exact approval phrase.
- Sync-run history for preview/execution.
- Live remote writes/destructive queries are not supported.

### Reputation, warm-up, and safety gates

- Email config safe defaults.
- Sending readiness gate.
- Sender domain readiness gate.
- Controlled live-test readiness gate.
- Warm-up planner API/UI for sender-domain caps and ramp schedule.
- Warm-up policy persistence in PostgreSQL runtime adapter.
- Campaign schedule cap enforcement baseline.
- Campaign calendar API/UI showing scheduled dry-runs against sender-domain warm-up caps, remaining capacity, and over-cap days.
- Reputation policy persistence in PostgreSQL runtime adapter.
- Auto-pause threshold controls for bounce, complaint, deferral, and provider-error signals.
- Recommendation-only auto-pause evaluation without mutating queues/providers.
- Controlled one-recipient MTA live-test runbook gate without sending.
- Bounce/complaint ingestion updates suppressions and event state.
- Real delivery remains locked until final human approval.

### Operational hardening

- Database readiness/status.
- Domain readiness safe gate.
- TLS readiness safe gate.
- Backup readiness safe gate.
- Monitoring readiness safe gate.
- Platform rate-limit readiness safe gate.
- RBAC readiness safe gate.
- Secret redaction in config/status surfaces.
- Tests for every shipped slice.

## Current safety posture

OracleStreet must remain permission-based and reputation-safe.

Locked until explicit future approval:

- campaign-scale real sending
- destructive remote SQL
- suppression/unsubscribe/consent bypass
- raw credential display/logging
- production SMTP/PowerMTA dispatch beyond a controlled one-owned-recipient gate

Allowed now:

- local PostgreSQL-backed CMS persistence
- dry-run sending
- local capture to controlled addresses
- owned/controlled inbox tests only
- remote PostgreSQL read-only preview/import flows when all gates pass
- visible admin workflows that do not unlock real delivery

## Next build flows the autonomous loop must execute

The loop should keep shipping one of these per run, with tests, docs, commit, push, deploy, and smokes.

### Flow A — Contact browser and source-quality drilldowns

Status: shipped baseline. The Contacts workbench now calls `/api/contacts/browser` for protected search/filter plus source/domain drilldowns. It remains read-only, admin-only, PostgreSQL-backed through the existing repositories where enabled, and real delivery stays locked.

Shipped:
- contact browser search by email/name/source/domain/status
- filters for consent status, source, domain, suppression state, stale/risky/role-account flags
- source-quality drilldown panel
- domain concentration drilldown
- contact timeline stub from imports, events, and campaign jobs

Acceptance:
- visible UI controls after login
- protected API query endpoint
- PostgreSQL-backed where enabled
- tests for search/filter and safety
- no private data exposure outside admin session

### Flow B — Campaign calendar over warm-up caps

Status: shipped baseline. The Campaigns workbench now calls `/api/campaigns/calendar` to show scheduled dry-run campaigns against warm-up policy caps, including per-day planned count, daily cap, remaining capacity, and over-cap state. Scheduling now accounts for already scheduled dry-run campaigns on the same sender-domain/day before allowing another campaign.

Shipped:
- calendar/list of scheduled dry-run campaigns
- per-day sender-domain cap usage
- over-cap warning/blocking before schedule
- campaign schedule-cap API linked to warm-up policy
- dashboard widget for remaining capacity

Acceptance:
- visible campaign calendar UI
- schedule attempts blocked or warned when over cap
- tests for cap calculations
- no queue/provider mutation unless dry-run queue action is explicitly selected

### Flow C — Multi-user/RBAC admin workflow

Status: shipped safe baseline. The admin workbench now includes a Users/RBAC panel backed by `GET /api/admin/users`, RBAC readiness, a role permission matrix, and `POST /api/admin/users/invite-plan` for validating a planned invite/create workflow without sending email, generating passwords/tokens, or mutating users.

Shipped:
- user list/readiness panel
- invite/create operator/read-only placeholder flow gated by admin session
- role permission matrix UI
- audit events for role/user plan actions
- password/token-safe invite plan surface without emailing secrets

Acceptance:
- protected routes
- PostgreSQL users table used where enabled, bootstrap admin fallback otherwise
- tests for role metadata and audit
- no raw password/token display

### Flow D — Remote PostgreSQL import scheduler

Goal: move from one-off preview/import to recurring sync planning.

Build:
- source sync schedule form
- mapping profile persistence
- dry-run next-sync preview
- sync run history UI with imported/rejected counts
- exact approval gate for enabling a schedule

Acceptance:
- no automatic live pulls unless env/operator gates pass
- all errors redacted
- tests for mapping/schedule validation
- no raw credentials in logs/UI

### Flow E — MTA controlled proof path

Goal: approach a one-owned-recipient live proof without enabling scale sending.

Build:
- readiness checklist that combines provider config, sender domain readiness, warm-up policy, suppression, consent, and controlled-recipient proof
- one-message runbook export
- manual completion/audit record
- provider message trace stub for the proof

Acceptance:
- still does not send automatically
- requires explicit Boss/human approval phrase for every proof
- tests prove no queue/provider mutation on planning

### Flow F — Reporting dashboard depth

Goal: turn safe reports into operator-grade insight.

Build:
- campaign/domain/source report cards
- bounce/complaint/open/click trend summaries
- source-quality impact on engagement/suppression
- export buttons linked to existing CSV preview

Acceptance:
- visible reporting UI
- protected API summary endpoints
- tests for totals and redaction

## Required loop behavior

Every OracleStreet cron run must:

1. Read this file, `docs/13_FULL_EMAIL_CMS_TARGET.md`, `docs/14_MTA_WARMUP_LIST_HYGIENE_PLAN.md`, `tasks/ORACLESTREET_BUILD_QUEUE.md`, and the testing/deploy docs before choosing work.
2. Check for overlapping OracleStreet deploy/test/npm/git/SSH work.
3. Prefer the next unshipped flow from this file over passive health checks.
4. Patch code/docs safely.
5. Include or preserve meaningful tests for every feature.
6. Run `npm test --prefix backend` and `git diff --check`.
7. Secret-scan/sanity-check the diff before commit.
8. Commit and push with `./scripts/push-origin-main.sh`.
9. Deploy with `./scripts/deploy-vps.sh`.
10. Verify primary/fallback site, health, PostgreSQL readiness, and relevant UI/API smoke.
11. End with a visible update in the current WebChat/channel session.

## Access block for updates

- Site: http://stuffprettygood.com/
- Health: http://stuffprettygood.com/api/health
- Fallback IP: http://187.124.147.49/
- Repo: https://github.com/mehyar-us/OracleStreet
- VPS login: `ssh oraclestreet-vps`
- Temp admin creds: local `docs/.private/initial-admin.env` and VPS `/etc/oraclestreet/initial-admin.env`
