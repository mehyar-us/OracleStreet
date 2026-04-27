# OracleStreet Build Roadmap

## Phase 0 — Baseline

- [x] VPS reset for OracleStreet
- [x] SSH alias and key auth
- [x] Nginx frontend + backend proxy baseline
- [x] Docs folder and deployment flow
- [x] Placeholder frontend and health backend

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

- `docs/09-EMAIL-MARKETING-PLATFORM-BUILD.md`
- `docs/10-POWERMTA-INTEGRATION.md`
