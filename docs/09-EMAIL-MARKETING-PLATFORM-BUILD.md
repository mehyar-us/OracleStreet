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

## MVP build order

### 1. Auth + admin shell

- [x] login screen
- [x] first admin bootstrap from `/etc/oraclestreet/initial-admin.env`
- [x] session handling from `ORACLESTREET_SESSION_SECRET`
- [x] protected dashboard route

### 2. PostgreSQL foundation

- app database connection
- migration system
- tables from `docs/03-DATA-MODEL.md`
- [x] email engine schema alignment migration for dry-run statuses, delivery events, tracking URLs, and queue safety metadata
- seed first admin user
- [x] remote PostgreSQL data source registry baseline with redacted metadata only and no sync/probe
- [x] encrypted remote PostgreSQL connection secret baseline with AES-256-GCM secret refs and no plaintext exposure
- [x] remote PostgreSQL sync dry-run job baseline with source/mapping validation and no network probes or row pulls
- [x] safe mapping/status UI baseline for remote PostgreSQL sources and sync dry-runs
- [x] sync audit log baseline for remote PostgreSQL dry-run actions

### 3. Contacts and suppressions

- [x] contacts list/import baseline
  - [x] validate-only import endpoint requiring admin session, explicit consent, source metadata, valid email, and no duplicate emails
  - [x] in-memory contact import/list endpoint until PostgreSQL persistence is wired
- [x] suppression list baseline
- [x] unsubscribe endpoint baseline
- [x] source/consent fields required in import validation

### 4. Campaign CMS

- [x] campaigns draft/estimate baseline with suppression-aware audience checks
- [x] templates CRUD baseline with unsubscribe-language gate
- [x] segments/saved filters baseline with safe audience estimate and suppression exclusion
- [x] preview/render test baseline with no delivery

### 5. Send engine

- [x] `send_jobs` dry-run queue baseline
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

The root frontend now exposes a protected admin CMS workbench after login. It loads live safe-read panels for contacts, templates, campaigns, send queue, suppressions, remote PostgreSQL sources/sync dry-runs, reputation/readiness gates, and audit events. The contacts module includes a visible consent/source import workflow with validate-only and import actions backed by `/api/contacts/import/validate` and `/api/contacts/import`. The templates module includes a visible safe draft creator wired to `/api/templates` and `/api/templates/preview`, preserving unsubscribe-language validation and no-delivery preview. The campaigns module includes a visible dry-run builder wired to estimate, create draft, approve, schedule, and enqueue dry-run endpoints while keeping real delivery disabled. The remote PostgreSQL panel now includes a SELECT-only query validator/planner wired to `/api/data-source-query/validate`; it enforces source ID, SELECT-only SQL, bounded limit/timeout, redacted metadata, and keeps live remote execution locked until pg-driver and approval gates are added. Remaining panels are intentionally read/dry-run first while PostgreSQL persistence and safety gates are completed; the next frontend step is turning queue dispatch and live remote source probe/schema/query execution into gated workflows.
