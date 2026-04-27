# OracleStreet Testing and QA

## Rule

Every built feature must include a verification path before it is considered done. The deploy flow should not rely on trust or vibes; it should prove core behavior after every change.

## Required test layers

### 1. Unit tests

Use for pure backend logic:

- campaign validation
- segment filtering
- suppression checks
- template rendering
- PowerMTA/SMTP provider config validation
- send safety gates

### 2. Integration tests

Use for backend + PostgreSQL + service boundaries:

- admin bootstrap/auth
- contact import
- campaign creation
- send job creation
- dry-run email sending
- event recording
- remote PostgreSQL pull jobs

### 3. Email send/receive tests

Email must be tested safely before domain/provider launch:

- **Dry-run provider**: records intended mail without external delivery.
- **Local capture provider**: sends to a controlled mailbox/capture service only.
- **SMTP/PowerMTA config validation**: checks host, port, auth, TLS mode, and sender identity without blasting mail.
- **Controlled live send**: one test message to an owned inbox only after unsubscribe/suppression/rate-limit gates exist.
- **Receiving/bounce path**: parse controlled bounce/complaint/unsubscribe events into `email_events` and suppression tables.

No campaign-scale real sending until the compliance gates in `docs/10-POWERMTA-INTEGRATION.md` pass.

### 4. Deployment smoke tests

After every deploy:

- frontend returns HTTP 200
- `/api/health` returns OK
- backend service is active
- Nginx config passes
- watchdog timer is active
- Docker and SSH remain active

## Current baseline command

```bash
npm test --prefix backend
./scripts/deploy-vps.sh
```

## Current verified feature paths

- Admin auth/session: `POST /api/auth/login`, `GET /api/auth/session`, `POST /api/auth/logout` with bootstrap credentials from `/etc/oraclestreet/initial-admin.env`.
- Protected dashboard summary: `GET /api/dashboard` must return `401` without a session and safe-test counters with a valid admin session.
- Protected migration manifest: `GET /api/schema/migrations` must return `401` without a session and list SQL migrations with a valid admin session.
- PostgreSQL readiness/status: `GET /api/database/status` must require admin auth, validate PostgreSQL URL shape, redact credentials, and avoid live connection probes until the database driver/persistence slice is enabled.
- Contact import/list baseline: `POST /api/contacts/import/validate` must return `401` without a session and reject rows missing valid email, explicit consent, source metadata, or with duplicate emails. `POST /api/contacts/import` must require admin auth, atomically reject invalid batches before storing any contact, and store/list valid consented contacts in memory until PostgreSQL persistence is wired.
- Segment/safe audience estimate baseline: `POST /api/segments/estimate` and `POST /api/segments` must require admin auth, filter only existing consented contacts, exclude suppressed contacts by default, report suppressed counts, and audit segment estimate/create actions.
- Template safe preview baseline: `POST /api/templates` and `POST /api/templates/preview` must require admin auth, reject HTML without unsubscribe language, render variable previews without delivery, update dashboard counts, and audit template create/preview actions.
- Campaign draft/estimate baseline: `POST /api/campaigns/estimate` and `POST /api/campaigns` must require admin auth, require an existing segment and compliant template, estimate suppression-aware audience size, keep campaigns in `draft` with `realDeliveryAllowed: false`, update dashboard counts, and audit campaign estimate/create actions.
- Campaign-to-queue dry-run baseline: `POST /api/campaigns/enqueue-dry-run` must require admin auth, only enqueue draft campaigns, render the campaign template per contact, exclude suppressed contacts through the segment estimate, apply send queue safety/rate-limit gates, create dry-run queue jobs only, mark campaign `queued_dry_run`, and audit the action.
- Frontend login/dashboard card: served from `/`, calls the auth, dashboard, and migration APIs through the Nginx `/api/` proxy.
- Email config remains safe-test-only at `GET /api/email/config`; real sending stays disabled unless future safety gates pass.
- Local capture provider: with `ORACLESTREET_MAIL_PROVIDER=local-capture`, `POST /api/email/provider/validate` must require admin auth, validate `ORACLESTREET_LOCAL_CAPTURE_ALLOWED_DOMAIN`, never open a network connection, reject recipients outside the controlled domain, record accepted messages in memory, and expose them via protected `GET /api/email/local-capture` with `externalDelivery: false`.
- SMTP/PowerMTA provider validation: `POST /api/email/provider/validate` must require admin auth, report redacted readiness, skip network probes by default, and never expose passwords.
- Dry-run send queue: `POST /api/send-queue/enqueue` must require admin auth, reject messages missing consent/source/unsubscribe gates, enqueue compliant messages as `queued_dry_run`, and report `realDelivery: false`. `POST /api/send-queue/dispatch-next-dry-run` must require admin auth, dispatch one queued dry-run job at a time, mark it `dispatched_dry_run`, keep `dispatchMode: no_external_delivery`, record an internal `dispatched` event, and audit the action.
- Suppression/unsubscribe baseline: `POST /api/suppressions` must require admin auth; `POST /api/unsubscribe` must record unsubscribe suppressions; suppressed recipients must be blocked from dry-run queue enqueue.
- Rate-limit/warm-up baseline: `GET /api/email/rate-limits` must require admin auth; dry-run queue enqueue must enforce global and per-domain hourly caps before any provider path.
- Bounce/complaint ingest baseline: `POST /api/email/events/ingest` must require admin auth, accept only `bounce`/`complaint` manual batches, record events, create suppressions, and block affected recipients from queue enqueue. Manual ingest must reject internal-only `dispatched` events.
- Safe reporting baseline: `GET /api/email/reporting` and `GET /api/dashboard` must require admin auth and summarize queue, suppression, bounce/complaint, provider, rate-limit, and compliance-gate state without enabling delivery.
- Audit log baseline: `GET /api/audit-log` must require admin auth, sanitize sensitive fields, and record key admin/compliance actions such as login attempts, provider validation, queue enqueue, suppression, unsubscribe, event ingest, and database status checks.

## Domain readiness checklist

Before connecting a domain:

- app health checks passing by IP
- admin auth working
- email dry-run tests passing
- SMTP/PowerMTA config validation passing
- unsubscribe endpoint working
- suppression table enforced
- DNS plan documented
- SPF/DKIM/DMARC plan documented
- TLS plan documented

## PMTA-first development priority

Boss prioritized PMTA/sending capability first. Build order is now: provider config validation, dry-run controlled test-send, SMTP adapter, PowerMTA adapter, receive/bounce testing, then production domain/TLS/DNS. Real outbound mail remains disabled until safety gates pass.

## Current domain wiring

OracleStreet is now wired toward `stuffprettygood.com` on VPS `187.124.147.49`. See `docs/12-DOMAIN-CLOUDFLARE.md`.
