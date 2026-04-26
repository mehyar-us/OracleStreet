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
- [ ] Add PostgreSQL app database
- [x] Add migrations
- [x] Add auth and first admin login
- [x] Add dashboard shell

## Phase 2 — CMS core

- [ ] Contacts CRUD/import
- [ ] Segments
- [ ] Campaign CRUD
- [ ] Templates
- [ ] Audit log

## Phase 3 — Email engine

- [ ] Dry-run email provider
- [ ] SMTP/provider adapter
- [ ] PowerMTA SMTP adapter
- [ ] Send queue
- [ ] Suppression/unsubscribe handling
- [ ] Rate limits and warm-up controls
- [ ] Bounce/complaint ingestion
- [ ] Event tracking

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
