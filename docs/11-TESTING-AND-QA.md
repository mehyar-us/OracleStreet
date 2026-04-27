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
- Template safe preview baseline: `POST /api/templates` and `POST /api/templates/preview` must require admin auth, reject HTML without unsubscribe language, render variable previews plus optional unsubscribe/open/click tracking URLs without delivery, update dashboard counts, and audit template create/preview actions.
- Campaign draft/estimate baseline: `POST /api/campaigns/estimate` and `POST /api/campaigns` must require admin auth, require an existing segment and compliant template, estimate suppression-aware audience size, keep campaigns in `draft` with `realDeliveryAllowed: false`, update dashboard counts, and audit campaign estimate/create actions.
- Campaign dry-run approval baseline: `POST /api/campaigns/approve-dry-run` must require admin auth, only approve draft campaigns, re-run segment/template compliance checks, require non-empty safe audience, mark the campaign `approved_dry_run`, keep `realDeliveryAllowed: false`, and audit the action.
- Campaign dry-run scheduling baseline: `POST /api/campaigns/schedule-dry-run` must require admin auth, only schedule approved dry-run campaigns, require a future `scheduledAt`, mark the campaign `scheduled_dry_run`, keep manual dispatch/no delivery, and audit the action.
- Campaign-to-queue dry-run baseline: `POST /api/campaigns/enqueue-dry-run` must require admin auth, only enqueue `approved_dry_run` or `scheduled_dry_run` campaigns, render the campaign template per contact, inject per-recipient `/api/unsubscribe`, `/api/track/open`, and `/api/track/click` URLs, exclude suppressed contacts through the segment estimate, apply send queue safety/rate-limit gates, create dry-run queue jobs only, mark campaign `queued_dry_run`, and audit the action.
- Campaign reporting safe summary: `GET /api/campaigns/reporting` must require admin auth, summarize per-campaign dry-run queued/dispatched jobs, internal events, open/click engagement counts/rates, and unsubscribe counts, audit the view, and keep `realDeliveryAllowed: false`.
- Frontend login/dashboard card: served from `/`, calls the auth, dashboard, and migration APIs through the Nginx `/api/` proxy, and displays safe product/email metrics including suppressions, events, bounce/complaint, opens/clicks, dry-run rates, provider mode, and locked real-sending state.
- Email config remains safe-test-only at `GET /api/email/config`; real sending stays disabled unless future safety gates pass.
- Local capture provider: with `ORACLESTREET_MAIL_PROVIDER=local-capture`, `POST /api/email/provider/validate` must require admin auth, validate `ORACLESTREET_LOCAL_CAPTURE_ALLOWED_DOMAIN`, never open a network connection, reject recipients outside the controlled domain, record accepted messages in memory, and expose them via protected `GET /api/email/local-capture` with `externalDelivery: false`.
- SMTP/PowerMTA provider validation: `POST /api/email/provider/validate` must require admin auth, report redacted readiness, skip network probes by default, and never expose passwords.
- Safe provider adapter interface: `GET /api/email/provider/adapter` must require admin auth, report dispatch capability/readiness, keep SMTP/PowerMTA `configured-but-locked`, redact secrets, audit the view, and never enable external delivery.
- Dry-run send queue: `POST /api/send-queue/enqueue` must require admin auth, reject messages missing consent/source/unsubscribe gates, enqueue compliant messages as `queued_dry_run`, and report `realDelivery: false`. `POST /api/send-queue/dispatch-next-dry-run` must require admin auth, dispatch one queued dry-run job at a time, mark it `dispatched_dry_run`, keep `dispatchMode: no_external_delivery`, record an internal `dispatched` event, and audit the action.
- Suppression/unsubscribe baseline: `POST /api/suppressions` must require admin auth; `GET`/`POST /api/unsubscribe` must record unsubscribe suppressions; tracked GET unsubscribe links must preserve campaign/contact metadata; suppressed recipients must be blocked from dry-run queue enqueue.
- Rate-limit/warm-up baseline: `GET /api/email/rate-limits` must require admin auth; dry-run queue enqueue must enforce global and per-domain hourly caps before any provider path.
- Manual event CSV import validation: `POST /api/email/events/validate-import` must require admin auth, parse `type,email,source` CSV files, accept only `bounce`/`complaint` rows, preserve optional campaign/contact metadata, audit the validation, and never record events, create suppressions, probe networks, or send mail.
- Manual event CSV import ingest: `POST /api/email/events/import` must require admin auth, atomically reject CSV files with invalid rows before recording anything, import fully valid bounce/complaint rows into events and suppressions, preserve optional campaign/contact metadata, audit the import, and never probe networks or send mail.
- Engagement tracking baseline: `GET /api/track/open` and `GET /api/track/click` must record only open/click event metadata, preserve campaign/contact fields, require valid email, keep redirects disabled, avoid network probes or delivery, and surface open/click counts in safe reporting.
- Bounce/complaint ingest baseline: `POST /api/email/events/ingest` must require admin auth, accept only `bounce`/`complaint` manual batches, record events, create suppressions, and block affected recipients from queue enqueue. Manual ingest must reject internal-only `dispatched` events.
- Manual delivery event ingest baseline: `POST /api/email/delivery-events/ingest` must require admin auth, accept only `delivered`/`deferred` manual batches, preserve optional campaign/contact metadata, reject bounce/complaint/internal events, avoid suppressions, avoid network probes, and keep `realDelivery: false`.
- Safe reporting baseline: `GET /api/email/reporting` and `GET /api/dashboard` must require admin auth and summarize queue, suppression, bounce/complaint, open/click engagement, provider, rate-limit, and compliance-gate state without enabling delivery. Dashboard must include campaign engagement totals/rates and embedded campaign reporting.
- Sending readiness safe gate: `GET /api/email/sending-readiness` must require admin auth, report provider/config/compliance blockers without exposing secrets, include sender-domain readiness, audit the view, and keep `readyForRealDelivery: false`/`realDeliveryAllowed: false` until a future explicit controlled-live approval path exists.
- Sender domain readiness safe gate: `GET /api/email/domain-readiness` must require admin auth, validate the default sender domain shape, report expected SPF/DKIM/DMARC/TLS requirements without DNS probing, audit the view, and never enable delivery.
- Web/domain readiness safe gate: `GET /api/web/domain-readiness` must require admin auth, report expected apex/www DNS records, primary/fallback health URLs, TLS mode planning, and smoke-test commands without DNS/network probes, HTTPS changes, or unlocking real email delivery.
- TLS readiness safe gate: `GET /api/web/tls-readiness` must require admin auth, report selected TLS mode, certificate candidate domains, prerequisites, and HTTP/HTTPS smoke-test commands without requesting certificates, editing Nginx, probing certificates, or unlocking real email delivery.
- Backup readiness safe gate: `GET /api/backups/readiness` must require admin auth, report redacted PostgreSQL backup command planning, backup path/schedule/retention, and restore/offsite recommendations without creating dumps, writing files, exposing secrets, or unlocking real email delivery.
- Monitoring readiness safe gate: `GET /api/monitoring/readiness` must require admin auth, report health/frontend/service/nginx/watchdog check plans, monitor interval, alert posture, and recommended commands without probing networks, mutating services, exposing secrets, or unlocking real email delivery.
- Platform rate-limit readiness safe gate: `GET /api/platform/rate-limit-readiness` must require admin auth, report admin/API/import/dry-run queue rate-limit posture, protected surfaces, and enforcement gaps without mutating traffic, storing IPs, exposing secrets, or unlocking real email delivery.
- RBAC readiness safe gate: `GET /api/platform/rbac-readiness` must require admin auth, report current single-admin access, planned least-privilege roles, protected surfaces, and multi-user blockers without mutating users/roles, exposing secrets, or unlocking real email delivery.
- Data source registry baseline: `GET`/`POST /api/data-sources` must require admin auth, accept only PostgreSQL source URLs, redact passwords, skip network probes, keep `syncEnabled: false`, audit create/list actions, and never pull remote data.
- Encrypted data source secret baseline: `POST /api/data-sources` with `storeSecret: true` must require `ORACLESTREET_DATA_SOURCE_SECRET_KEY`, store only encrypted connection material with AES-256-GCM, return only redacted URL metadata plus an encrypted secret ref, and never expose plaintext secrets in create/list/error responses.
- Data source sync dry-run baseline: `GET`/`POST /api/data-source-sync-runs` must require admin auth, reject unknown source IDs, validate optional mapping fields, create listable dry-run validation records, skip network probes, import/pull zero remote rows, record future-live-sync blockers, audit actions, and keep `realSync: false`.
- Frontend remote PostgreSQL mapping/status UI baseline: `/` after admin login must show data source/sync dry-run counters and a redacted mapping/status panel, call only protected metadata endpoints, avoid plaintext secrets, and keep remote row pulls disabled.
- Data source sync audit log baseline: `GET /api/data-source-sync-audit` must require admin auth, return sanitized `data_source_sync*` events only, audit the view action, avoid plaintext secrets, and keep `realSync: false`.
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
