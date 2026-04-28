# OracleStreet Email Marketing Platform Build Plan

## Mission

Build OracleStreet into a private email marketing platform for affiliate campaigns: audience management, segmentation, campaign creation, template management, send orchestration, delivery tracking, and PostgreSQL-backed reporting.

## Compliance boundary

OracleStreet is for lawful, permission-based email. The platform must enforce:

- opt-in/source tracking for contacts
- unsubscribe/suppression checks before send
- bounce and complaint suppression
- rate limits and warm-up controls
- campaign audit logs
- no sending to harvested, purchased, or unauthorized lists

## Core user flow

1. Admin logs in.
2. Admin imports or syncs contacts from PostgreSQL/source files.
3. Admin validates contact source/consent metadata.
4. Admin creates a segment.
5. Admin creates an email template.
6. Admin creates a campaign and selects segment + template.
7. System estimates audience, suppressions, and risk flags.
8. Admin schedules or sends campaign.
9. Send queue dispatches messages through provider adapter.
10. System records send/open/click/bounce/unsubscribe/complaint events.
11. Dashboard reports campaign and affiliate performance.

## Feature inventory and next flows

The current shipped feature inventory and next autonomous build flows live in `docs/15_FEATURE_INVENTORY_AND_NEXT_FLOWS.md`. The build loop must use that file as the durable source of truth for what exists and what to build next, especially:

1. Reporting dashboard depth and campaign/source trend drilldowns.
2. Remaining CRUD polish for visible admin CMS screens.
3. Campaign calendar UX polish for multi-domain allocation views.

## MVP build order

### 1. Auth + admin shell

- [x] login screen
- [x] first admin bootstrap from `/etc/oraclestreet/initial-admin.env`
- [x] session handling from `ORACLESTREET_SESSION_SECRET`
  - [x] local PostgreSQL admin session ledger on VPS with hashed token IDs and safe in-memory fallback
- [x] protected dashboard route
- [x] local PostgreSQL bootstrap admin user upsert on login with env password verification retained

### 2. PostgreSQL foundation

- app database connection
- migration system
- tables from `docs/03-DATA-MODEL.md`
- [x] email engine schema alignment migration for dry-run statuses, delivery events, tracking URLs, and queue safety metadata
- [x] policy repository foundation migration for warm-up policies, reputation policies, and repository migration status
- [x] local PostgreSQL runtime adapters for warm-up and reputation policy save/list/evaluate paths with safe in-memory fallback
- [x] seed/upsert first admin user at login without storing plaintext bootstrap password
- [x] remote PostgreSQL data source registry baseline with redacted metadata only and no sync/probe
- [x] encrypted remote PostgreSQL connection secret baseline with AES-256-GCM secret refs and no plaintext exposure
- [x] remote PostgreSQL sync dry-run job baseline with source/mapping validation and no network probes or row pulls
- [x] safe mapping/status UI baseline for remote PostgreSQL sources and sync dry-runs
- [x] sync audit log baseline for remote PostgreSQL dry-run actions

### 3. Contacts and suppressions

- [x] contacts list/import baseline
  - [x] validate-only import endpoint requiring admin session, explicit consent, source metadata, valid email, and no duplicate emails
  - [x] local PostgreSQL contact import/list runtime adapter on VPS with safe in-memory fallback
- [x] suppression list baseline
  - [x] local PostgreSQL suppression runtime adapter on VPS with safe in-memory fallback
- [x] unsubscribe endpoint baseline
- [x] source/consent fields required in import validation

### 4. Campaign CMS

- [x] campaigns draft/estimate baseline with suppression-aware audience checks
  - [x] local PostgreSQL campaign draft/status runtime adapter on VPS with safe in-memory fallback
- [x] templates CRUD baseline with unsubscribe-language gate
  - [x] local PostgreSQL template create/list/runtime adapter on VPS with safe in-memory fallback
- [x] segments/saved filters baseline with safe audience estimate and suppression exclusion
- [x] saved segment snapshots with PostgreSQL-backed reusable filters and reproducible audience metadata
- [x] preview/render test baseline with no delivery

### 5. Send engine

- [x] `send_jobs` dry-run queue baseline
  - [x] local PostgreSQL send queue enqueue/list/dispatch runtime adapter on VPS with safe in-memory fallback
- [x] campaign dry-run approval baseline before queue enqueue
- [x] campaign dry-run scheduling baseline that records a future schedule without delivery
- [x] campaign-to-queue dry-run enqueue baseline with suppression/rate-limit gates
- [x] send queue readiness safe-gate baseline with dry-run dispatch posture and no mutation
- [x] controlled live-test readiness safe-gate baseline for one owned recipient with no send/mutation path
- [x] safe provider adapter interface baseline
- dry-run provider first
- PowerMTA SMTP provider after safety controls exist

### 6. Events + reporting

- [x] manual delivery event ingest baseline for delivered/deferred events without suppression or delivery
  - [x] local PostgreSQL email event record/list/provider-message runtime adapter on VPS with safe in-memory fallback
- [x] manual bounce parser validation baseline for DSN snippets without recording events or suppressions
- [x] manual parsed bounce ingest baseline that records bounce/deferred candidates and suppresses hard bounces only
- [x] bounce mailbox readiness safe-gate baseline that validates planned mailbox config without connecting or reading messages
- [x] PowerMTA accounting CSV import validation baseline for delivered/deferred/bounce rows without recording events
- [x] PowerMTA accounting CSV import ingest baseline that records valid delivered/deferred/bounce rows, provider message IDs, and suppresses hard bounces only
- [x] provider message event lookup baseline for PowerMTA traceability without probes or mutation
- [x] provider message traceability schema migration for PostgreSQL event persistence
- unsubscribe tracking
- [x] campaign reporting safe summary baseline

## Definition of safe sending readiness

PowerMTA or any real mail provider must not send production mail until these exist:

- suppression check in send path
- unsubscribe link injection baseline for campaign dry-run queue jobs
- sender/domain config documented
- bounce mailbox or webhook ingestion plan
- rate limits per domain/provider
- audit log for send jobs
- real-sending readiness gate that reports blockers without exposing secrets
- controlled one-recipient live-test readiness gate that still does not send without explicit human approval
- manual dry-run proof

## PMTA-first development priority

Boss prioritized PMTA/sending capability first. Build order is now: provider config validation, dry-run controlled test-send, SMTP adapter, PowerMTA adapter, receive/bounce testing, then production domain/TLS/DNS. Real outbound mail remains disabled until safety gates pass.


## Missing visible product features Boss called out

Boss noted that the deployed site does not yet feel like it has features. The autonomous loop must prioritize turning existing backend baselines into visible admin UI and PostgreSQL-backed workflows. Required visible surfaces:

- Contacts import/list with consent/source status.
- Remote PostgreSQL source setup, connection probe, schema discovery, SELECT-only query runner, import preview, and sync run history.
- Templates CRUD and preview.
- Campaign builder, estimate, approval, schedule, and dry-run queue enqueue.
- Send queue with dispatch/readiness state.
- Suppressions/unsubscribe/bounce/complaint views.
- Reputation/deliverability dashboard: sender domain readiness, PMTA config, warm-up/rate limits, bounce/complaint thresholds.
- Reporting dashboard: campaign engagement, provider message IDs, opens/clicks/bounces/complaints, audit log.
- Users/RBAC/admin management.

Every new backend capability should get either a visible UI affordance or a clear operator endpoint documented in the dashboard until a full frontend framework is selected.

## Visible CMS workbench baseline

The root frontend now exposes a protected admin CMS workbench after login. It loads live safe-read panels for contacts, list hygiene, templates, campaigns, send queue, suppressions, remote PostgreSQL sources/sync dry-runs, PostgreSQL repository migration readiness, reputation/readiness gates, and audit events. The contacts module includes a visible consent/source import workflow with validate-only and import actions backed by `/api/contacts/import/validate` and `/api/contacts/import`. It also includes a contact browser backed by `GET /api/contacts/browser` with email/name/source/domain/status search, consent/source/domain/suppression/risk filters, source-quality drilldowns, domain concentration drilldowns, and contact timeline stubs while staying read-only. Contact dedupe/merge planning is backed by `GET /api/contacts/dedupe-merge-plan`; it previews exact-email and same-name-domain merge candidates, candidate primary contact, and consent/source merge summaries without mutating contacts or suppressions. It also includes a list hygiene cleanup planner backed by `GET /api/list-hygiene/plan` that scores duplicate, risky, suppressed, stale, source-quality, and domain-concentration signals without mutating contacts, probing networks, or unlocking delivery. The Segments panel saves reusable consent/source/domain filters through `/api/segments` and captures reproducible suppression-aware audience snapshots through `/api/segments/snapshots`; snapshots store metadata/sample contacts only, do not mutate contacts, and do not unlock delivery. The templates module includes a visible safe draft creator wired to `/api/templates` and `/api/templates/preview`, preserving unsubscribe-language validation and no-delivery preview. The campaigns module includes a visible dry-run builder wired to estimate, create draft, approve, schedule, and enqueue dry-run endpoints while keeping real delivery disabled. The suppressions module includes a visible manual suppression workflow wired to `/api/suppressions`; it supports manual/unsubscribe/bounce/complaint reasons, requires source metadata, and reinforces the queue-blocking compliance gate. The send queue panel now includes a one-at-a-time dry-run dispatch control wired to `/api/send-queue/dispatch-next-dry-run`; it records internal dispatched events while keeping external delivery disabled. The remote PostgreSQL panel includes a visible source registration workflow wired to `/api/data-sources`; it accepts host/port/database/user/password/SSL fields, requests encrypted secret refs, and displays only redacted metadata after save. It also includes a schema discovery planner wired to `/api/data-source-schema/plan`; it enforces source ID, schema allowlists, table/column limits, timeout, redacted metadata, and returns planned information_schema queries without probing. The SELECT-only query validator/planner is wired to `/api/data-source-query/validate`; it enforces source ID, SELECT-only SQL, bounded limit/timeout, and redacted metadata. Gated live read-only execution controls are wired to `/api/data-source-schema/discover` and `/api/data-source-query/execute`; they require encrypted secret refs, `ORACLESTREET_REMOTE_PG_EXECUTION_ENABLED=true`, the exact approval phrase, bounded limits/timeouts, redacted errors, and still reject destructive SQL/default-disabled execution. The import preview mapper is wired to `/api/data-source-import/preview`; it maps selected/sample rows into contact fields, enforces email/consent/source/duplicate validation, audits preview actions, and never mutates contacts. Approved remote contact import is wired to `/api/data-source-import/execute`; it reruns preview validation, requires exact import approval phrase, imports through the same contact repository path, records sync-run history, and keeps real delivery locked. The reporting panel now includes a protected dashboard wired to `/api/email/reporting/dashboard` with aggregate campaign leaderboard, source performance, domain performance, event trend, and queue status rollups, plus a protected CSV export preview workflow wired to `/api/email/reporting/export` for summary, campaign, event, and suppression datasets; both return dry-run/aggregate metadata only, no secrets, and no delivery unlock. The reputation panel now includes a sender-domain warm-up planner wired to `/api/email/warmup/plan`, warm-up policy save/check controls wired to `GET/POST /api/email/warmup/policy` and `POST /api/email/warmup/schedule-cap`, recommendation-only auto-pause threshold controls wired to `GET/POST /api/email/reputation/policy` and `GET /api/email/reputation/auto-pause`, plus a recipient-domain reputation rollup wired to `/api/email/reputation/domain-rollup` and controlled one-recipient live-test runbook controls wired to `/api/email/controlled-live-test/plan`; operators can tune warm-up caps, block over-cap campaign dry-run schedules, tune bounce/complaint/deferral/provider-error thresholds, evaluate event rates, and prepare a no-send one-message MTA proof runbook without mutating queues, providers, DNS, or delivery state. The dashboard now also calls `GET /api/database/repositories` and shows the schema/runtime migration map for contacts, suppressions, templates, segments, campaigns, send queue, events, warm-up/reputation policies, audit, and users without exposing secrets or mutating data. Contacts, suppressions, templates, segments and segment snapshots, campaigns, send queue, email events, users, user invite/password workflow metadata, admin sessions, audit log, warm-up policies, reputation policies, remote import schedules, and controlled proof audits now support local PostgreSQL runtime persistence on the VPS through the safe `psql` adapter when `ORACLESTREET_PG_REPOSITORIES=contacts,suppressions,templates,segments,campaigns,send_queue,email_events,users,user_invite_password_workflow,admin_sessions,audit_log,warmup_policies,reputation_policies,data_sources,data_source_encrypted_secrets,data_source_sync_runs,data_source_import_schedules,controlled_live_test_proof_audits`, while tests/local failures keep an in-memory fallback. Migration `005_campaign_repository_runtime_ids` relaxes campaign runtime ID storage and adds dry-run campaign state metadata columns for the app repository path. Migration `006_send_queue_event_runtime_ids` relaxes send queue/email event runtime IDs and preserves event metadata for the app repository path. Migration `007_users_sessions_audit_runtime` adds the admin session ledger and audit metadata columns for the app repository path. Migration `008_policy_runtime_status` records policy runtime repository readiness metadata. Migration `009_schedule_proof_runtime` adds PostgreSQL runtime tables for remote import schedules and controlled proof audits. Migration `010_campaign_affiliate_metadata` adds safe campaign affiliate/planning metadata columns for affiliate program, offer ID, payout model, tracking template, UTM fields, notes, and JSON metadata. Migration `011_data_source_registry_runtime` adds local PostgreSQL runtime tables for remote source registry rows and encrypted source secret metadata. Migration `012_user_invite_password_runtime` adds PostgreSQL columns and indexes for invite acceptance and password reset metadata. Migration `013_segment_snapshots_runtime` adds segment snapshot metadata for reproducible audiences. Migration `014_data_source_sync_runs_runtime` adds PostgreSQL-backed sync-run history and operator replay metadata. The Users/RBAC panel now lists admin users from PostgreSQL where enabled or bootstrap fallback otherwise, shows the role permission matrix, the active route-permission policy, and blockers, and offers safe invite-plan, pending invite creation, invite acceptance, password reset planning controls, and guarded existing-user role updates. Invite/reset codes are operator-supplied and hashed before storage; OracleStreet sends no email and never outputs raw token/password material. Hardened route permission checks now guard admin-user management, role updates, invite planning, audit log access, contact-import mutations, and data-source write/schedule paths with audited `rbac_permission_denied` responses while preserving no user mutation, no role mutation, no secret output, and no delivery unlock. The Remote PostgreSQL panel now includes an import scheduler plan surface wired to `/api/data-source-import-schedules`, a gated worker-plan surface wired to `/api/data-source-import-schedules/worker-plan`, and a manual runbook surface wired to `/api/data-source-import-schedules/runbook`; it stores SELECT-only query, contact mapping, interval, approval-gated enabled state, and next-run preview metadata, then reports enabled/due schedules, required worker gates, and per-run read-only/contact-import approval steps without pulling rows, starting a worker, exposing secrets, opening remote connections, or mutating contacts. The controlled live-test panel now includes a proof audit path that records manual/out-of-band one-recipient proof metadata, optional provider message IDs, outcomes, and notes without sending or mutating providers/queues. It also exposes a seed/live-proof observation planner through `/api/email/controlled-live-test/seed-observation`; the planner summarizes proof outcomes and required manual observation fields without connecting to inboxes, polling mailboxes, sending, mutating queues/providers, or exposing secrets. The campaign builder now captures safe affiliate/campaign planning metadata, and the Campaigns/Reporting panels expose protected affiliate rollups, campaign audit timelines, and warm-up calendar day drilldowns through `/api/campaigns/affiliate-summary`, `/api/campaigns/audit-timeline`, and `/api/campaigns/calendar/drilldown` without secrets, network probes, schedule mutation, queue/provider mutation, or delivery unlocks. Remote source registry rows, encrypted source secret metadata, sync-run history/replay records, remote import schedules, and controlled proof audits now persist through PostgreSQL on VPS when their repository flags are enabled. Remaining panels are intentionally read/dry-run first while PostgreSQL persistence and safety gates are completed; the next backend step is continued MTA/reputation operational depth.
