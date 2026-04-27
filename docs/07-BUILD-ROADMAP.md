# OracleStreet Build Roadmap

## Phase 0 — Baseline

- [x] VPS reset for OracleStreet
- [x] SSH alias and key auth
- [x] Nginx frontend + backend proxy baseline
- [x] Docs folder and deployment flow
- [x] Placeholder frontend and health backend

## Immediate Boss Reset — Full CMS Features

- [x] Install PostgreSQL server/client on VPS
- [x] Define full email sending CMS target in `docs/13_FULL_EMAIL_CMS_TARGET.md`
- [x] Add persistent autonomous queue in `tasks/ORACLESTREET_BUILD_QUEUE.md`
- [x] Teach deploy to preserve/generate `ORACLESTREET_DATABASE_URL` and apply migrations
- [ ] Convert in-memory module baselines to PostgreSQL-backed persistence
- [x] Add PostgreSQL repository foundation migration/readiness for policy tables and module status
- [x] Add contacts/suppressions local PostgreSQL runtime adapter with safe in-memory fallback
- [x] Add templates/campaigns local PostgreSQL runtime adapter with safe in-memory fallback
- [x] Build initial visible admin screens for contacts, data sources, templates, campaigns, send queue, reputation, and reporting
- [x] Add visible contact import validate/store workflow to admin workbench
- [x] Add visible template creation/preview workflow to admin workbench
- [x] Add visible campaign estimate/approve/schedule/enqueue dry-run workflow to admin workbench
- [x] Add visible send queue dry-run dispatch workflow to admin workbench
- [x] Add visible suppression management workflow to admin workbench
- [x] Add visible reporting CSV export workflow to admin workbench
- [ ] Convert remaining visible admin screens from safe-read panels into full CRUD workflows
- [x] Add visible remote PostgreSQL source registration workflow to admin workbench
- [x] Add remote PostgreSQL schema discovery planner UI/API
- [x] Add SELECT-only remote PostgreSQL query validator/planner UI/API
- [ ] Add live remote PostgreSQL probe/schema discovery/query execution behind pg-driver and approval gates
- [x] Add warm-up planner controls UI
- [x] Add warm-up policy persistence and campaign schedule cap enforcement baseline
- [x] Add reputation dashboard auto-pause controls UI

## Phase 1 — Product skeleton

- [ ] Choose frontend framework
- [x] Choose backend framework
- [x] Add PostgreSQL app database readiness/status baseline
- [x] Add migrations
- [x] Add email engine schema alignment migration
- [x] Add auth and first admin login
- [x] Add dashboard shell

## Phase 2 — CMS core

- [x] Contacts list/import baseline
- [x] Segments/safe audience estimate baseline
- [x] Campaign draft/estimate baseline
- [x] Templates safe preview baseline
- [x] Audit log baseline

## Phase 3 — PMTA-first Email Engine

- [x] Dry-run email provider baseline
- [x] Local capture provider baseline
- [x] PowerMTA config validation baseline
- [x] Controlled test-send dry-run endpoint
- [x] SMTP/provider adapter config validation
- [x] Safe provider adapter interface baseline
- [x] PowerMTA SMTP adapter config validation
- [x] Send queue dry-run enqueue baseline
- [x] Campaign dry-run approval baseline
- [x] Campaign dry-run scheduling baseline
- [x] Campaign-to-send-queue dry-run enqueue baseline
- [x] Send queue dry-run dispatch baseline
- [x] Send queue readiness safe-gate baseline
- [x] Suppression/unsubscribe handling baseline
- [x] Campaign unsubscribe link injection baseline
- [x] Tracked unsubscribe link suppression baseline
- [x] Rate limits and warm-up controls baseline
- [x] Bounce/complaint ingestion baseline
- [x] Manual bounce parser validation baseline
- [x] Manual parsed bounce ingest baseline
- [x] Bounce mailbox readiness safe-gate baseline
- [x] PowerMTA accounting CSV import validation baseline
- [x] PowerMTA accounting CSV import ingest baseline
- [x] Provider message ID event metadata baseline
- [x] Provider message event lookup baseline
- [x] Provider message traceability schema migration
- [x] Manual event CSV import validation baseline
- [x] Manual event CSV import ingest baseline
- [x] Event tracking baseline
- [x] Open/click engagement tracking baseline
- [x] Campaign tracking URL injection baseline
- [x] Dry-run dispatch event tracking baseline
- [x] Manual delivery event ingest baseline
- [x] Campaign reporting safe summary baseline
- [x] Campaign engagement reporting baseline
- [x] Dashboard campaign engagement summary baseline
- [x] Frontend safe metrics dashboard baseline
- [x] Real sending readiness safe-gate baseline
- [x] Controlled live-test readiness safe-gate baseline
- [x] Sender domain readiness safe-gate baseline

## Phase 4 — Remote PostgreSQL pulls

- [x] Data source registry baseline
- [x] Encrypted connection secrets baseline
- [x] Sync jobs dry-run validation baseline
- [x] Mapping UI safe status baseline
- [x] Sync audit logs baseline

## Phase 5 — Production hardening

- [x] Domain readiness safe-gate baseline
- [x] TLS readiness safe-gate baseline
- [x] Backup readiness safe-gate baseline
- [x] Monitoring readiness safe-gate baseline
- [x] Platform rate-limit readiness safe-gate baseline
- [x] RBAC readiness safe-gate baseline

## Email platform execution docs

- `docs/13_FULL_EMAIL_CMS_TARGET.md`
- `tasks/ORACLESTREET_BUILD_QUEUE.md`
- `docs/09-EMAIL-MARKETING-PLATFORM-BUILD.md`
- `docs/10-POWERMTA-INTEGRATION.md`
