# OracleStreet PowerMTA Integration

## Intent

PowerMTA support should be implemented as one email provider adapter inside OracleStreet's email engine. It should send legitimate, permission-based campaign mail through SMTP and feed delivery/bounce signals back into PostgreSQL.

## Hard boundary

Do not build or operate OracleStreet as a spam tool. PowerMTA integration must respect:

- consent/source metadata
- unsubscribe/suppression checks
- bounce/complaint handling
- sending limits and warm-up
- accurate sender identity
- applicable email law and provider rules

## Architecture

```text
Campaign
  -> Segment resolver
  -> Suppression filter
  -> Rendered message
  -> Send job queue (dry-run enqueue baseline live)
  -> Email provider adapter
      -> Dry-run adapter
      -> SMTP adapter
      -> PowerMTA SMTP adapter
  -> Event ingestion
  -> Reporting
```

## PowerMTA adapter shape

```ts
type EmailMessage = {
  to: string;
  from: string;
  replyTo?: string;
  subject: string;
  html: string;
  text?: string;
  campaignId: string;
  contactId: string;
  headers?: Record<string, string>;
};

type EmailProvider = {
  name: string;
  sendEmail(message: EmailMessage): Promise<{ providerMessageId: string }>;
  validateConfig(): Promise<void>;
};
```

## Required environment variables

These belong on the VPS in `/etc/oraclestreet/oraclestreet.env`, not git:

```bash
ORACLESTREET_MAIL_PROVIDER=dry-run # dry-run | local-capture | smtp | powermta
ORACLESTREET_POWERMTA_HOST=
ORACLESTREET_POWERMTA_PORT=587
ORACLESTREET_POWERMTA_USERNAME=
ORACLESTREET_POWERMTA_PASSWORD=
ORACLESTREET_POWERMTA_SECURE=false
ORACLESTREET_DEFAULT_FROM_EMAIL=
ORACLESTREET_DEFAULT_FROM_NAME=OracleStreet
ORACLESTREET_LOCAL_CAPTURE_ALLOWED_DOMAIN=example.test
```

## Send safety gates

Before dispatching through PowerMTA, backend must verify:

1. contact has valid email
2. contact is not unsubscribed
3. contact is not suppressed by bounce/complaint
4. contact has source/consent record
5. campaign is approved/scheduled
6. template rendered successfully
7. per-domain and global rate limits allow send
8. unsubscribe link exists in message

## Bounce/complaint handling

Initial implementation can ingest CSV/log imports manually. Production implementation should add mailbox/webhook parsing and write to:

- `email_events`
- suppression list
- campaign reporting tables

## Build sequence

1. [x] Dry-run provider with safe controlled test-send response.
1a. [x] Local capture provider baseline that records controlled-domain messages without external delivery.
2. [x] Generic SMTP provider config validation using the same safe adapter interface.
3. [x] PowerMTA provider config validation with no network probe or real delivery by default.
4. [x] Dry-run send queue enqueue baseline with consent/source/unsubscribe gates and no real delivery.
5. [x] Suppression/unsubscribe baseline that blocks queued dry-run recipients.
6. [x] Dry-run rate limit/warm-up baseline with per-domain and global hourly caps.
7. [x] Manual bounce/complaint ingest baseline that records events and suppresses recipients.
8. [x] Dashboard reporting baseline for safe dry-run queue, suppressions, events, and compliance gates.
9. [x] Campaign dry-run approval baseline that verifies audience/template compliance and keeps real delivery disabled.
10. [x] Campaign-to-send-queue dry-run enqueue baseline with rendered templates, segment audience, suppression exclusion, and no delivery.
11. [x] Send queue dry-run dispatch baseline that marks queued jobs as dispatched through the dry-run adapter without external delivery.
12. [x] Dry-run dispatch event tracking baseline that records internal `dispatched` events while keeping manual ingest limited to bounce/complaint.
13. [x] Real sending readiness safe-gate baseline that reports provider/config/compliance blockers while keeping delivery locked.
14. [x] Safe provider adapter interface baseline that exposes adapter capability/readiness without enabling external delivery.
15. [x] Campaign unsubscribe link injection baseline for dry-run queue jobs.
16. [x] Tracked unsubscribe link suppression baseline that accepts per-campaign GET links and records suppressions without auth.
17. [x] Sender domain readiness safe-gate baseline for SPF/DKIM/DMARC/TLS planning without DNS probing or delivery.

## Current validation endpoints

- `GET /api/audit-log` requires an admin session and lists sanitized in-memory audit events until PostgreSQL persistence is wired.
- `GET /api/email/config` exposes redacted provider readiness only.
- `POST /api/email/provider/validate` requires an admin session and validates selected provider configuration without sending mail or opening a network connection. `local-capture` validates an allowed controlled recipient domain and never opens a network connection.
- `GET /api/email/provider/adapter` requires an admin session and reports the selected safe provider adapter capability/readiness. SMTP/PowerMTA adapters remain `configured-but-locked`, redact secrets, and return `realDeliveryAllowed: false`.
- `POST /api/email/test-send` requires an admin session and is dry-run only.
- `POST /api/send-queue/enqueue` requires an admin session, applies the current safe test-message gates, and queues dry-run jobs only.
- `POST /api/campaigns/approve-dry-run` requires an admin session, re-validates campaign audience/template compliance, marks a draft campaign `approved_dry_run`, and keeps `realDelivery: false`.
- `POST /api/campaigns/enqueue-dry-run` requires an admin session, requires `approved_dry_run`, renders the campaign audience into dry-run queue jobs, injects per-recipient `/api/unsubscribe` URLs, applies suppression/rate-limit gates, and keeps `realDelivery: false`.
- `GET /api/send-queue` requires an admin session and lists in-memory dry-run queued jobs for smoke testing until PostgreSQL persistence is wired.
- `POST /api/send-queue/dispatch-next-dry-run` requires an admin session and dispatches exactly one queued dry-run job through the dry-run adapter path with `realDelivery: false`; successful dispatch records an internal `dispatched` email event.
- `POST /api/suppressions` and `GET /api/suppressions` require an admin session for manual suppression smoke testing.
- `GET /api/unsubscribe` / `GET /unsubscribe` accepts tracked link query params (`email`, `source`, `campaignId`, `contactId`) and records an unsubscribe suppression without auth or delivery. `POST /api/unsubscribe` remains available for JSON smoke tests.
- `GET /api/email/rate-limits` requires an admin session and returns dry-run warm-up caps. Queue enqueue enforces global and per-domain hourly limits before any provider path.
- `POST /api/email/events/ingest` requires an admin session and accepts manual `bounce`/`complaint` event batches only; accepted events create suppressions and do not trigger delivery. Internal `dispatched` events are recorded only by the dry-run dispatch path.
- `GET /api/email/events` requires an admin session and lists in-memory event records until PostgreSQL persistence is wired.
- `GET /api/email/local-capture` requires an admin session and lists captured local-provider messages for controlled smoke tests only.
- `GET /api/email/reporting` requires an admin session and summarizes queue, suppression, bounce/complaint, provider, rate-limit, and compliance-gate state without enabling delivery.
- `GET /api/email/sending-readiness` requires an admin session and reports real-sending readiness blockers without exposing secrets. It always returns `readyForRealDelivery: false`/`realDeliveryAllowed: false` until explicit future live-test approval work exists.
- `GET /api/email/domain-readiness` requires an admin session and reports default sender domain readiness, expected SPF/DKIM/DMARC records, and TLS requirements without DNS network probes or delivery.
- `GET /api/dashboard` includes the same safe email reporting summary.

## PMTA-first development priority

Boss prioritized PMTA/sending capability first. Build order is now: provider config validation, dry-run controlled test-send, SMTP adapter, PowerMTA adapter, receive/bounce testing, then production domain/TLS/DNS. Real outbound mail remains disabled until safety gates pass.
