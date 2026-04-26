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
- Contact import validation: `POST /api/contacts/import/validate` must return `401` without a session and reject rows missing valid email, explicit consent, source metadata, or with duplicate emails.
- Frontend login/dashboard card: served from `/`, calls the auth, dashboard, and migration APIs through the Nginx `/api/` proxy.
- Email config remains safe-test-only at `GET /api/email/config`; real sending stays disabled unless future safety gates pass.

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
