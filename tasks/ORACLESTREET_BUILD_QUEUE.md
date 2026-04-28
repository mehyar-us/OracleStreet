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
- Contacts, suppressions, templates, campaigns, send queue, email events, users, admin sessions, audit log, warm-up policies, reputation policies, remote import schedules, and controlled proof audits now have local `psql` runtime repository adapters enabled on VPS via `ORACLESTREET_PG_REPOSITORIES=contacts,suppressions,templates,campaigns,send_queue,email_events,users,admin_sessions,audit_log,warmup_policies,reputation_policies,data_source_import_schedules,controlled_live_test_proof_audits`, with in-memory fallback for tests/local adapter failure.

Verification:
- backend tests pass.
- migration tests pass.
- deploy health passes.

### O3 — Visible admin CMS screens

Status: initial safe-read workbench shipped; contact import, template creation/preview, campaign dry-run builder, send queue dry-run dispatch, suppression management, reporting dashboard/export workflows, and list hygiene cleanup planner dashboard shipped; remaining CRUD workflows still pending.

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
- CSV export previews for summary/campaign/events/suppressions shipped; reporting dashboard now adds campaign/source/domain/trend rollups; future work should persist/export deeper affiliate/audit timelines from PostgreSQL once repositories migrate.

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
1. Continued MTA/reputation operational depth.
2. Remaining CRUD polish for visible admin CMS screens.
3. Campaign calendar UX polish for multi-domain allocation views.

Latest shipped slice:
- Flow A contact source operations digest: priority source/remediation/quarantine/risk rows and audience readiness totals without contact/suppression/segment mutation.
- Flow F reporting operations digest: executive cards, priority risk rows, and next-best actions without queue/provider/suppression mutation.
- Flow E controlled final approval packet: pass/block evidence rows and max-one-message review checklist without send/probe/queue/provider/suppression mutation.
- Flow D remote PostgreSQL scheduler operations board: due/blocked/forecast rows and manual-runbook actions without worker/remote-read/contact mutation.
- Flow C RBAC operations review: read-only user/session posture, route coverage, and pending invite/reset follow-up board.
- Flow B campaign calendar warm-up cap review: read-only cap rows, campaign readiness, gates, and operator actions.
- Flow A source-quality remediation board: prioritized source hygiene/quarantine/domain action rows with read-only operator guidance.
- Flow E controlled live-test operator actions: prioritized blocker/proof-gap action plan and manual runbook with no automatic sending.
- Flow D remote import scheduler preflight: read-only prioritized due/blocker review rows and guardrails before any future remote read worker.
- Flow C RBAC role-change impact preview: read-only permission/surface/session-revocation preview before applying role updates.
- Flow B campaign calendar operator actions: prioritized manual action rows/runbook for warm-up cap and launch-readiness reviews with no schedule/queue/provider mutation.
- Flow B campaign calendar launch readiness: approval/schedule/warm-up gate rows for manual dry-run enqueue decisions with no schedule/queue/provider mutation.
- Flow A campaign handoff preview: CSV preview for ready/review/blocked cohorts with no contact/suppression/segment/queue/provider mutation.
- Flow A campaign fit plan: ready/review/blocked campaign audience cohorts with no contact/suppression/segment/queue/provider mutation.
- Flow A source detail review: import batch/form provenance gaps by source detail with no contact/suppression/segment mutation.
- Flow A consent provenance review: consent/source issue rows and samples with no contact/suppression/segment mutation.
- Flow A engagement recency plan: recently engaged/dormant/no-positive-engagement cohorts with recommendations and no contact/queue/provider mutation.
- Flow A domain risk plan: per-domain ready/blocked counts and warm-up allocation recommendations with no MX/network probes or domain/contact mutation.
- Flow A repermission plan: stale/missing-consent/do-not-contact review rows and samples with no outbound repermission sends or contact mutation.
- Flow A source quarantine plan: per-source quarantine recommendations, operator checklists, and safe audience rules without source/contact/segment mutation.
- Flow A audience exclusion preview: retained/excluded contact counts, exclusion reasons, and samples before segment snapshot/campaign use with no segment/contact/suppression mutation.
- Flow A contact risk triage queue: risk/source/domain operator review queues with samples, recommended actions, and no audience/contact/suppression mutation.
- Flow A suppression review plan: reason/source/domain suppression review rows and samples with explicit no-auto-unsuppression guardrails and no contact/suppression mutation.
- Flow A contact browser export preview: filtered CSV preview for contacts/source/consent/suppression/risk metadata without file writes or audience/contact mutation.
- Flow D remote PostgreSQL scheduler timeline: add bounded upcoming-run forecast API/UI for manual run review windows, keeping all worker/remote/contact/delivery actions locked.
- Flow D remote PostgreSQL scheduler control: add pause/re-enable schedule status API/UI with explicit approval for re-enable and no worker/remote/contact/delivery mutation.
- Flow C RBAC session control: add manage_users-protected user-session revocation from the admin UI with keep-current-self-session option and audit trail.
- Flow C RBAC session ledger: add token-safe admin session directory API/UI for active/revoked/expired sessions, protected by manage_users and audited as read-only.
- Flow C RBAC hardening: successful admin role updates now revoke target user sessions and auth checks validate the session ledger when available; route policy coverage also includes recent contact matrix and warm-up board routes.
- Flow B warm-up calendar operator board: `/api/campaigns/calendar/warmup-board` now combines multi-domain allocation, reschedule suggestions, and capacity forecast into visible open/tight/blocked/over-cap day rows plus per-domain utilization/best-next-slot guidance without schedule, queue, provider, network, or delivery mutation.
- Flow A source × domain quality matrix: `/api/contacts/source-quality-matrix` now gives a protected read-only source/domain matrix with ready/blocked counts, suppressed/stale/role/bounce/complaint risk signals, review gates, aggregate risk rows, and visible Contacts UI coverage without contact/suppression/segment/queue/provider mutation or delivery unlock.
- Remote source persistence for source registry/encrypted secret metadata: migration `011_data_source_registry_runtime` adds `data_source_registry` and `data_source_encrypted_secrets`; `/api/data-sources` now uses local PostgreSQL runtime persistence when enabled, keeps safe in-memory fallback, stores encrypted secret ciphertext metadata only, displays registry persistence in the UI, and never returns plaintext credentials.
- Affiliate/campaign metadata and audit timeline depth: migration `010_campaign_affiliate_metadata` adds campaign planning metadata columns; campaign drafts can capture affiliate program, offer ID, payout model, tracking-template configured flag, UTM source/campaign, and notes; `/api/campaigns/affiliate-summary` and `/api/campaigns/audit-timeline` expose protected no-secret/no-delivery rollups in the Campaigns UI; reporting carries affiliate metadata without unlocking delivery.
- RBAC enforcement hardening: added a protected route-permission policy endpoint, visible Users/RBAC policy surface, permission checks for hardened admin/user/audit/contact-import/data-source write paths, and audited `rbac_permission_denied` responses with no user mutation, role mutation, secret output, or delivery unlock.
- PostgreSQL persistence hardening for remote import schedules and controlled proof audits: migration `009_schedule_proof_runtime` adds `data_source_import_schedules` and `controlled_live_test_proof_audits`; both runtime paths now use local `psql` repositories on VPS when enabled, keep safe in-memory fallback for tests/adapter failure, never print secrets, and preserve no-pull/no-send/no-mutation posture.
- Flow F reporting deliverability audit: `/api/email/reporting/deliverability-audit` provides protected aggregate source/domain/campaign risk rows, provider-message trace coverage, blockers, and recommendations while remaining read-only with no secrets, probes, queue/provider/suppression mutation, or delivery unlock.
- Flow F reporting dashboard drilldown: `/api/email/reporting/drilldown` provides protected source/domain/campaign/trend drilldowns with counts, rates, sample metadata, event trends, campaign breakdowns, and recommendations while remaining aggregate/read-only with no secrets, probes, queue/provider mutation, or delivery unlock.
- Flow F reporting dashboard depth safe baseline: `/api/email/reporting/dashboard` provides protected aggregate campaign leaderboard, source performance, domain performance, event trend, queue-status, and export-link metadata; the Reporting UI exposes the cards/lists after login, audits dashboard views, includes no secrets, probes no networks, sends no email, and keeps real delivery locked.
- Flow E controlled one-recipient MTA proof path safe baseline: `/api/email/controlled-live-test/proof-audit` records manual/out-of-band proof outcomes, dry-run/local-capture proof IDs, optional provider message IDs, masked recipient metadata, and notes; it audits accepted/rejected records, sends no email, probes no network, mutates no queues/providers/suppressions, exposes no secrets, and the Reputation/readiness UI exposes proof audit history and controls after login.
- Flow D remote PostgreSQL import scheduler safe baseline: `/api/data-source-import-schedules` plans recurring imports from a SELECT-only query plus contact mapping profile, interval, next-run preview timestamp, and exact approval phrase when marked enabled; it audits accepted/rejected plans, stores no raw credentials, performs no immediate remote pull, starts no worker, mutates no contacts, and the Remote PostgreSQL UI exposes schedule planning/history after login.
- Flow A contact dedupe/merge planner baseline: `/api/contacts/dedupe-merge-plan` previews exact-email and same-name-domain merge candidates, picks a candidate primary record with consent/source summary, audits plan views, and the Contacts UI surfaces merge recommendations without contact/suppression mutation or delivery unlock.
- Flow E seed/live-proof observation planner: `/api/email/controlled-live-test/seed-observation` summarizes controlled proof audit outcomes, required manual observation fields, and latest observations while keeping inbox polling, mailbox connections, sends, provider/queue mutations, and delivery unlock disabled.
- Flow D scheduler safety audit: `/api/data-source-import-schedules/audit` reviews enabled/due/blocked/stale schedules, source/mapping blockers, and recommendations without starting workers, connecting remotely, pulling rows, mutating contacts, exposing secrets, or unlocking delivery.
- Flow D scheduler runbook baseline: `/api/data-source-import-schedules/runbook` selects a planned import schedule and displays the manual per-run read-only execution/contact-import approval checklist while keeping no-worker/no-connection/no-row-pull/no-contact-mutation/no-secret/no-delivery posture.
- Flow D scheduler worker-plan baseline: `/api/data-source-import-schedules/worker-plan` reports enabled/due remote import schedules, required worker gates, and no-worker/no-connection/no-row-pull/no-contact-mutation safety posture; the Remote PostgreSQL UI surfaces the worker plan without starting automatic pulls.
- MTA/reputation domain-rollup baseline: `/api/email/reputation/domain-rollup` aggregates delivery/bounce/complaint/deferral events by recipient domain, compares rates to recommendation-only reputation thresholds, audits rollup views, and the Reputation UI surfaces per-domain throttle/pause guidance without DNS probes, queue/provider mutation, or delivery unlock.
- Flow C effective-access review: `/api/platform/rbac-effective-access` shows manage-users-protected current permissions, per-user allowed/blocked surfaces, role coverage, pending invite/reset counts, and recommendations without user/role/password/token/email/delivery mutation.
- Flow C role-edit hardening baseline: `/api/admin/users/role` updates existing roles with manage-users authorization, owner-escalation guard, self-demotion guard, last-admin demotion guard, audit events, and no password/token/email/delivery output; Users/RBAC UI exposes the guarded role edit form.
- Flow D sync-run replay/persistence baseline: `/api/data-source-sync-runs` now persists dry-run sync validation history through PostgreSQL when enabled, `/api/data-source-sync-runs/replay` records operator-requested no-network/no-import replay records, and the Remote PostgreSQL UI exposes sync-run history/replay while keeping real sync disabled.
- Flow A saved segment snapshot baseline: `/api/segments` now persists reusable consent/source/domain filters through PostgreSQL when enabled; `/api/segments/snapshots` captures suppression-aware audience snapshots with sample contact metadata, no contact mutation, no delivery, and a visible Segments workbench for reproducible campaign audiences.
- Flow C Users/RBAC activation baseline: `/api/admin/users` lists admin users from PostgreSQL where enabled or bootstrap fallback otherwise; `/api/admin/users/invite-plan` validates no-mutation invite plans; `/api/admin/users/invite` creates PostgreSQL-backed pending invites with hashed manual codes; `/api/admin/users/accept-invite` activates users with password hashing; `/api/admin/users/password-reset-plan` and `/api/auth/password-reset/complete` support manual-code password resets. The Users/RBAC UI exposes directory status, role matrix, invite creation, invite acceptance, and reset planning without email delivery or raw token/password output.
- Flow A audience readiness review: `/api/contacts/audience-readiness` shows protected ready/blocked audience counts, source/domain review gates, blocked samples, and recommendations without contact/suppression/segment/queue/provider mutation or delivery unlock.
- Flow A source hygiene action plan: `/api/contacts/source-hygiene-plan` shows protected per-source review gates, priority, quarantine/refresh/review recommendations, and safe operator actions without contact/suppression/segment/queue/provider mutation or delivery unlock.
- Flow A source-quality detail drilldown: `/api/contacts/source-quality` shows protected per-source quality score, domain/risk breakdowns, sample contact metadata, and cleanup recommendations without contact/suppression/queue/provider mutation or delivery unlock.
- Provider readiness drilldown: `/api/email/provider/readiness-drilldown` shows protected provider rows, selected dispatch mode, configuration gate checklist, blockers, and recommendations without provider/queue mutation, network probes, secrets, or delivery unlock.
- MTA/reputation operations dashboard: `/api/email/mta-operations` shows protected provider posture, dry-run queue readiness, event/suppression counts, reputation domains, operational blockers, and next-safe-action recommendations without queue/provider/mailbox/network mutation or delivery unlock.
- Flow B campaign calendar capacity forecast: `/api/campaigns/calendar/capacity-forecast` shows protected next-safe-slot forecasts by sender domain, target audience count, blocked/tight/open days, best candidate slot, and recommendations without schedule/queue/provider mutation or delivery unlock.
- Flow B campaign calendar reschedule plan: `/api/campaigns/calendar/reschedule-plan` shows protected tight/over-cap warm-up days, candidate campaigns, suggested dates, and operator-only recommendations without schedule/queue/provider mutation or delivery unlock.
- Flow B campaign calendar multi-domain allocation: `/api/campaigns/calendar/allocation` shows protected multi-sender-domain capacity totals, tight/over-cap day counts, per-domain warm-up allocation rows, and recommendations without schedule/queue/provider mutation or delivery unlock.
- Flow B campaign calendar drilldown: `/api/campaigns/calendar/drilldown` shows a read-only selected sender-domain/day capacity usage, campaign breakdown, and warm-up recommendations without schedule/queue/provider mutation or delivery unlock.
- Flow B campaign calendar over warm-up caps: `/api/campaigns/calendar` shows scheduled dry-run campaigns by sender-domain/day, daily cap, planned count, remaining capacity, and over-cap state; scheduling now counts existing scheduled campaigns on the same day/domain before allowing another dry-run schedule, and the Campaigns UI exposes the calendar after login.
- Flow A contact detail drilldown: `/api/contacts/detail` provides protected per-contact source/consent/suppression/risk, event/queue counts, timeline metadata, and hygiene recommendations while remaining read-only with no contact/suppression/queue/provider mutation or delivery unlock.
- Flow A contact browser/search drilldowns: `/api/contacts/browser` provides protected email/name/source/domain/status search, consent/source/domain/suppression/risk filters, source-quality scores, domain concentration, and contact timeline stubs from imports/events/jobs; the Contacts UI exposes the controls after login and remains read-only/no-delivery.
- Remote PostgreSQL approved contact import: `/api/data-source-import/execute` reruns the preview validation, requires exact import approval phrase `I_APPROVE_REMOTE_POSTGRESQL_CONTACT_IMPORT`, imports only zero-rejection mapped contacts through the normal contact repository, records imported/updated counts plus sync-run history, and keeps delivery locked.
- Remote PostgreSQL contact import preview: `/api/data-source-import/preview` maps approved SELECT/sample rows into OracleStreet contact fields, enforces email/consent/source/duplicate validation, audits the preview, and never imports or mutates contacts.
- Live remote PostgreSQL read-only execution gate: `/api/data-source-schema/discover` and `/api/data-source-query/execute` can execute only when env/operator gates pass, use encrypted secret refs, enforce SELECT/information_schema-only limits/timeouts, redact errors, reject destructive SQL, and expose visible UI controls without plaintext secrets.
- Controlled one-recipient MTA live-test proof packet: `GET /api/email/controlled-live-test/proof-packet` now assembles readiness blockers, latest dry-run/local-capture proof, provider-message evidence, observation counts, proof gaps, and operator checklist without sending, probing, mailbox connections, queue/provider/suppression mutation, secret output, or delivery unlock.
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
