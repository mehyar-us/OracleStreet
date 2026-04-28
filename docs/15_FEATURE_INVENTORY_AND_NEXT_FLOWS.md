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
- RBAC route permission policy endpoint showing hardened surfaces and required permissions.
- RBAC effective-access review endpoint/UI showing current user permissions, per-user allowed/blocked route surfaces, role coverage, and pending invite/reset counts without mutating users or exposing secrets.
- Route-level permission enforcement for admin-user management, invite plans, audit log access, contact imports, data-source writes/import schedules, and other hardened write surfaces.
- Permission-denial audit events with no user mutation, role mutation, secret output, or delivery unlock.
- Admin user directory endpoint over the users repository/bootstrap admin fallback.
- Safe admin invite-plan endpoint that validates role/email, audits the plan, sends no email, creates no password/token, and mutates no users.
- PostgreSQL-backed manual-code invite creation, invite acceptance, password hashing, password-reset planning, and reset completion endpoints for multi-user activation.
- Users/RBAC UI can create pending invites, accept invites, plan password resets, and update existing user roles with owner/self-demotion/last-admin guardrails without email delivery or raw token/password output.
- Successful role changes revoke target user sessions so stale permissions cannot linger; session ledgers are checked during auth when available with safe fallback for bootstrap access.
- Admin session ledger API/UI lists active/revoked/expired sessions using hashed session prefixes only, with no raw cookie/token/password output and no user mutation.
- Admin session revocation API/UI can revoke all sessions for a selected user while optionally preserving the current self-session; audited, token-safe, and no role/password/email/delivery mutation.
- Raw passwords/tokens are not stored or exposed by the runtime adapter.

### Visible admin CMS workbench

- Dashboard metrics cards.
- Contacts panel.
- Contact import workflow.
- Template creator and safe preview workflow.
- Campaign builder workflow.
- Send queue dry-run dispatch workflow.
- Suppression management workflow.
- Remote PostgreSQL source/query/schema/import/scheduler surfaces.
- Reputation/readiness panel.
- Warm-up planner controls.
- Warm-up policy controls.
- Reputation auto-pause threshold controls.
- Controlled live-test runbook gate UI.
- MTA/reputation operations dashboard with provider, queue, event, suppression, blocker, and recommendation rollups.
- Provider readiness drilldown with safe provider rows, dispatch modes, and gate checklist.
- Reporting dashboard with campaign/source/domain/trend rollups plus export panel.
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
  - read-only source-quality detail drilldowns with per-source score, domain/risk breakdowns, sample contacts, and cleanup recommendations
  - read-only source hygiene action plans with per-source review gates, quarantine/refresh recommendations, and no audience mutation
  - read-only audience readiness reviews with ready/blocked counts, source/domain review gates, blocked samples, and no contact/suppression/segment mutation
  - domain concentration drilldowns
  - contact timeline stubs from imports, events, and dry-run jobs
  - read-only contact detail drilldowns with suppression, event, queue, timeline, and recommendation metadata
  - source × domain quality matrix with ready/blocked counts, review gates, risk flags, and no audience mutation
  - CSV export preview for current contact browser filters with source/consent/suppression/risk columns and no file write/contact mutation
  - read-only suppression review plan by reason/source/domain with repermission guardrails and no automatic unsuppression
  - read-only risk triage queue that groups risky contacts by risk flag/source/domain with operator recommendations and no automatic audience mutation
- Dedupe/merge planning API/UI that previews exact-email and same-name-domain merge candidates, candidate primary contact, consent/source summary, and operator-review recommendations without mutating contacts or suppressions.
- Saved segment filter and audience snapshot workflow:
  - reusable consent/source/domain filters
  - suppression-aware estimates
  - PostgreSQL-backed segment metadata and snapshot records
  - snapshot sample-contact metadata for reproducible campaign audiences without delivery
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
- Affiliate/campaign metadata for program, offer, payout model, tracking-template configured flag, UTM source/campaign, and notes.
- Campaign affiliate summary API/UI rollups and safe campaign audit timeline.

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
- MTA operations dashboard API/UI for provider posture, queue readiness, event/suppression counts, reputation blockers, and next-safe-action recommendations.
- Provider readiness drilldown API/UI for selected provider, dry-run/local-capture/SMTP/PowerMTA rows, dispatch posture, and safety-gate checklist without probes or mutation.
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
- Reporting dashboard depth API/UI with campaign leaderboard, source performance, domain performance, event trends, queue status, source/domain/campaign/trend drilldowns, deliverability risk audit across sources/domains/campaigns, provider-message trace coverage, and aggregate-only safety posture.
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
- PostgreSQL runtime adapter for source registry and encrypted secret metadata.
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
- Remote import schedule planner with SELECT-only query, mapping profile, interval, approval phrase, and no automatic pulls.
- Remote import scheduler worker-plan surface that counts enabled/due schedules and lists required gates without starting a worker, opening remote connections, pulling rows, or mutating contacts.
- Remote import schedule manual runbook surface that selects a planned schedule and lists per-run read-only execution/contact-import approval gates without starting workers, connecting remotely, pulling rows, mutating contacts, outputting secrets, or unlocking delivery.
- Remote import schedule pause/re-enable API/UI with approval phrase required for re-enable; status changes never start workers, open remote connections, pull rows, mutate contacts, output secrets, or unlock delivery.
- Remote import scheduler timeline API/UI forecasts upcoming manual-run windows over a bounded horizon with blocked/manual-gate status, without starting workers, opening remote connections, pulling rows, mutating contacts, exposing secrets, or unlocking delivery.
- Remote import scheduler safety audit showing enabled/due/blocked/stale schedules, source/mapping blockers, recommendations, and no worker/connection/row/contact/secret/delivery mutation.
- PostgreSQL runtime adapter for remote import schedules.
- Sync-run/schedule history for preview/execution/planned recurrence.
- PostgreSQL-backed sync-run history with operator replay of prior dry-run validations.
- Live remote writes/destructive queries are not supported.

### Reputation, warm-up, and safety gates

- Email config safe defaults.
- Sending readiness gate.
- Sender domain readiness gate.
- Controlled live-test readiness gate.
- Warm-up planner API/UI for sender-domain caps and ramp schedule.
- Warm-up policy persistence in PostgreSQL runtime adapter.
- Campaign schedule cap enforcement baseline.
- Campaign calendar API/UI showing scheduled dry-runs against sender-domain warm-up caps, remaining capacity, over-cap days, read-only multi-domain allocation, read-only day drilldowns with campaign breakdowns/recommendations, read-only reschedule plans for tight/over-cap days, read-only capacity forecasts for next safe dry-run slots, and a read-only warm-up calendar operator board with open/tight/blocked/over-cap day rows, per-domain utilization, best next slot, and no schedule/queue/provider mutation.
- Reputation policy persistence in PostgreSQL runtime adapter.
- Auto-pause threshold controls for bounce, complaint, deferral, and provider-error signals.
- Recommendation-only auto-pause evaluation without mutating queues/providers.
- Recipient-domain reputation rollup over imported/dry-run delivery events with pause/throttle recommendations only.
- Controlled one-recipient MTA live-test runbook gate without sending.
- Controlled live-test proof audit log for manual/out-of-band one-recipient outcomes, provider message IDs, and dry-run/local-capture proof IDs without sending or mutating providers/queues.
- Seed/live-proof inbox observation planner that summarizes manual proof outcomes and required observation fields without connecting to inboxes, polling mailboxes, sending, mutating queues/providers, or exposing secrets.
- Controlled live-test proof packet endpoint/UI that assembles readiness blockers, latest dry-run/local-capture proof, manual provider-message evidence, observation counts, proof gaps, and operator checklist without sending, probing, connecting to inboxes, mutating queues/providers/suppressions, exposing secrets, or unlocking delivery.
- PostgreSQL runtime adapter for controlled live-test proof audits.
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
- RBAC route permission policy safe gate.
- Secret redaction in config/status surfaces.
- Runtime persistence migration `009_schedule_proof_runtime` for remote import schedules and controlled proof audits.
- Runtime persistence migration `010_campaign_affiliate_metadata` for campaign affiliate/planning metadata.
- Runtime persistence migration `011_data_source_registry_runtime` for remote source registry and encrypted secret metadata.
- Runtime persistence migration `012_user_invite_password_runtime` for invite acceptance and password reset metadata.
- Runtime persistence migration `013_segment_snapshots_runtime` for saved segment filters and reproducible audience snapshots.
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

### Flow A — Contact browser, source-quality drilldowns, and saved audience snapshots

Status: expanded baseline. The Contacts workbench calls `/api/contacts/browser` for protected search/filter plus source/domain drilldowns. The Segments workbench now calls `/api/segments` and `/api/segments/snapshots` for reusable filters and reproducible audience snapshots. It remains admin-only, PostgreSQL-backed where enabled, read/dry-run safe, and real delivery stays locked.

Shipped:
- contact browser search by email/name/source/domain/status
- filters for consent status, source, domain, suppression state, stale/risky/role-account flags
- source-quality drilldown panel
- domain concentration drilldown
- contact timeline stub from imports, events, and campaign jobs
- saved consent/source/domain segment filters
- suppression-aware audience estimates
- reproducible segment snapshots with sample contact metadata

Acceptance:
- visible UI controls after login
- protected API query and snapshot endpoints
- PostgreSQL-backed where enabled
- tests for search/filter, saved filters, snapshots, and safety
- no private data exposure outside admin session
- no contact mutation, queue mutation, or delivery unlock

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

Status: shipped activation baseline. The admin workbench now includes a Users/RBAC panel backed by `GET /api/admin/users`, RBAC readiness, a role permission matrix, safe invite planning, PostgreSQL-backed pending invite creation, invite acceptance, and password reset planning/completion. Manual invite/reset codes are operator-supplied, hashed before storage, and never displayed by OracleStreet.

Shipped:
- user list/readiness panel
- invite/create operator/read-only workflow gated by admin session
- manual-code invite acceptance endpoint with password hashing
- manual-code password reset plan and completion endpoints
- role permission matrix UI
- audit events for role/user invite/reset actions
- password/token-safe invite and reset surfaces without emailing secrets
- role edit surface guarded against non-admin use, owner escalation, self-demotion out of manage_users, and last-admin demotion

Acceptance:
- protected routes for admin invite/reset planning
- public acceptance/reset completion endpoints require valid manual codes
- PostgreSQL users table used where enabled, bootstrap admin plus safe memory fallback otherwise
- tests for invite acceptance, password reset, role metadata, login, audit, and secret redaction
- no raw password/token/code display

### Flow D — Remote PostgreSQL import scheduler

Status: shipped safe baseline plus sync-run persistence/replay. The Remote PostgreSQL workbench now plans recurring contact import schedules over the existing SELECT-only query and contact mapping surfaces, and sync-run dry-run validation history is PostgreSQL-backed where enabled with operator replay controls. Schedule plans and replay records are protected, audited, redacted, approval-gated where relevant, and do not start background pulls or mutate contacts.

Shipped:
- source sync schedule form
- mapping profile persistence in safe schedule memory baseline
- dry-run next-sync preview timestamp
- sync schedule history UI with interval/status/query/mapping metadata
- exact approval gate for marking a schedule plan enabled
- PostgreSQL-backed sync-run history
- operator replay of prior sync validations without network probes/imports

Acceptance:
- no automatic live pulls unless future env/operator/worker gates pass
- all errors redacted
- tests for mapping/schedule validation
- no raw credentials in logs/UI

### Flow E — MTA controlled proof path

Status: shipped safe baseline. The Reputation/readiness workbench now includes the controlled live-test runbook gate plus a protected proof-audit workflow for manual/out-of-band one-owned-recipient proof metadata. The proof audit records dry-run/local-capture proof IDs, optional provider message IDs, outcomes, notes, masked recipient metadata, and audit events without sending, probing networks, mutating providers/queues/suppressions, exposing secrets, or unlocking real delivery.

Shipped:
- readiness checklist that combines provider config, sender domain readiness, rate-limit, bounce mailbox, and controlled-recipient proof gates
- one-message runbook output
- manual completion/audit record
- provider message trace stub for the proof

Acceptance:
- still does not send automatically
- requires explicit Boss/human approval phrase for every proof runbook
- tests prove no queue/provider mutation on planning or proof audit recording

### Flow F — Reporting dashboard depth

Status: shipped safe baseline plus affiliate metadata depth. The Reporting workbench now calls `/api/email/reporting/dashboard` for aggregate campaign/source/domain/trend insight and still links to CSV export previews. Campaign reporting includes affiliate metadata summaries, and the Campaigns workbench includes `/api/campaigns/affiliate-summary` plus `/api/campaigns/audit-timeline`. The endpoints are admin-only, aggregate/read-only except campaign draft metadata capture, contain no secrets, probe no networks, send nothing, and never unlock real delivery.

Shipped:
- campaign/source/domain report cards and leaderboard
- bounce/complaint/open/click event trend summaries
- source-quality/domain impact on engagement and suppression risk
- export buttons linked to existing CSV preview
- campaign affiliate program/offer/payout/UTM planning metadata
- campaign affiliate summary rollups
- campaign audit timeline from safe audit events

Acceptance:
- visible reporting UI
- protected API summary endpoint
- tests for totals, trend/source/domain aggregation, audit, and redaction

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
