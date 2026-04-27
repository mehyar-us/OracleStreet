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
- [x] PowerMTA config validation baseline
- [x] Controlled test-send dry-run endpoint
- [x] SMTP/provider adapter config validation
- [x] PowerMTA SMTP adapter config validation
- [x] Send queue dry-run enqueue baseline
- [x] Campaign-to-send-queue dry-run enqueue baseline
- [x] Send queue dry-run dispatch baseline
- [x] Suppression/unsubscribe handling baseline
- [x] Rate limits and warm-up controls baseline
- [x] Bounce/complaint ingestion baseline
- [x] Event tracking baseline

## Phase 4 — Remote PostgreSQL pulls

- [ ] Data source registry
- [ ] Encrypted connection secrets
- [ ] Sync jobs
- [ ] Mapping UI
- [ ] Sync audit logs

## Phase 5 — Production hardening

- [ ] Domain
- [ ] TLS
- [ ] Backups
- [ ] Monitoring
- [ ] Rate limits
- [ ] Role-based access controls

## Email platform execution docs

- `docs/09-EMAIL-MARKETING-PLATFORM-BUILD.md`
- `docs/10-POWERMTA-INTEGRATION.md`
