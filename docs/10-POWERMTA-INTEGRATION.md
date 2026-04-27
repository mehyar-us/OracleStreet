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
ORACLESTREET_MAIL_PROVIDER=dry-run # dry-run | smtp | powermta
ORACLESTREET_POWERMTA_HOST=
ORACLESTREET_POWERMTA_PORT=587
ORACLESTREET_POWERMTA_USERNAME=
ORACLESTREET_POWERMTA_PASSWORD=
ORACLESTREET_POWERMTA_SECURE=false
ORACLESTREET_DEFAULT_FROM_EMAIL=
ORACLESTREET_DEFAULT_FROM_NAME=OracleStreet
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
2. [x] Generic SMTP provider config validation using the same safe adapter interface.
3. [x] PowerMTA provider config validation with no network probe or real delivery by default.
4. [x] Dry-run send queue enqueue baseline with consent/source/unsubscribe gates and no real delivery.
5. [x] Suppression/unsubscribe baseline that blocks queued dry-run recipients.
6. [x] Dry-run rate limit/warm-up baseline with per-domain and global hourly caps.
7. [x] Manual bounce/complaint ingest baseline that records events and suppresses recipients.
8. [ ] Dashboard reporting.

## Current validation endpoints

- `GET /api/email/config` exposes redacted provider readiness only.
- `POST /api/email/provider/validate` requires an admin session and validates selected provider configuration without sending mail or opening a network connection.
- `POST /api/email/test-send` requires an admin session and is dry-run only.
- `POST /api/send-queue/enqueue` requires an admin session, applies the current safe test-message gates, and queues dry-run jobs only.
- `GET /api/send-queue` requires an admin session and lists in-memory dry-run queued jobs for smoke testing until PostgreSQL persistence is wired.
- `POST /api/suppressions` and `GET /api/suppressions` require an admin session for manual suppression smoke testing.
- `POST /api/unsubscribe` records an unsubscribe suppression without sending mail; this is the baseline for future tracked unsubscribe links.
- `GET /api/email/rate-limits` requires an admin session and returns dry-run warm-up caps. Queue enqueue enforces global and per-domain hourly limits before any provider path.
- `POST /api/email/events/ingest` requires an admin session and accepts manual `bounce`/`complaint` event batches only; accepted events create suppressions and do not trigger delivery.
- `GET /api/email/events` requires an admin session and lists in-memory event records until PostgreSQL persistence is wired.

## PMTA-first development priority

Boss prioritized PMTA/sending capability first. Build order is now: provider config validation, dry-run controlled test-send, SMTP adapter, PowerMTA adapter, receive/bounce testing, then production domain/TLS/DNS. Real outbound mail remains disabled until safety gates pass.
