# OracleStreet Autonomous Build Queue

Status: active indefinitely  
Owner: OracleStreet autonomous loop  
Last reset: 2026-04-27

## Standing mission

Build OracleStreet into a full private email sending CMS with PostgreSQL-backed persistence, remote PostgreSQL connectors/query tools, reputation-safe sending, PowerMTA integration, visible admin UI, and hard operational gates.

Reference target: `docs/13_FULL_EMAIL_CMS_TARGET.md`.

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

Verification:
- backend tests pass.
- migration tests pass.
- deploy health passes.

### O3 — Visible admin CMS screens

Status: initial safe-read workbench shipped; contact import, template creation/preview, campaign dry-run builder, and send queue dry-run dispatch workflows shipped; remaining CRUD workflows still pending.

Acceptance:
- Boss can log in and see actual modules, not just placeholder cards.
- UI must expose contacts, data sources, templates, campaigns, send queue, suppressions, reputation/readiness, reporting, and admin/user surfaces.
- Each screen can initially be safe-read or dry-run, but it must be visible and tied to backend routes.
- Next upgrade: replace remaining safe-read panels with forms/actions for remote source setup/probe/schema discovery, suppressions, and reporting exports.

Verification:
- Browser/manual smoke of `/` after login.
- API calls visible in network and no console errors.
- `npm test --prefix backend` includes a static assertion for the CMS workbench surfaces.

### O4 — Remote PostgreSQL connector and query runner

Status: visible source registration UI, source registry, encrypted secret refs, schema discovery planner UI/API, sync dry-run validation/audit, and SELECT-only query validator/planner UI/API shipped; live probe/schema/query execution still gated pending pg-driver integration and explicit operator approval.

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
- Reputation dashboard shows domain/provider health.

Safety:
- No campaign-scale real send until final human approval gate exists.

### O6 — Reporting and audit

Acceptance:
- Campaign reporting, engagement, provider events, bounce/complaint, and affiliate metadata dashboards.
- Audit timeline for contacts/campaigns/send jobs.
- CSV export later.

## Loop rules

- Every run must read this queue and `docs/13_FULL_EMAIL_CMS_TARGET.md` before choosing work.
- Prefer shipping one real product slice over only checking health.
- If Boss says “I see no features,” prioritize visible UI affordances tied to existing backend capability.
- Install/repair VPS PostgreSQL and deploy migrations autonomously when safe.
- Commit, push, deploy, and verify safe changes.
- Never commit secrets or raw DB credentials.
