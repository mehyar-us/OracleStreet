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
18. [x] Campaign reporting safe summary baseline for dry-run queue, dispatch, event, and unsubscribe counts.
19. [x] Campaign dry-run scheduling baseline that records future schedules while keeping manual dispatch and no delivery.
20. [x] Manual event CSV import validation baseline for bounce/complaint files without recording or delivery.
21. [x] Manual event CSV import ingest baseline that atomically imports valid bounce/complaint files into events and suppressions without delivery.
22. [x] Tracked open/click event baseline that records engagement events without auth, redirects, delivery, or external probes.
23. [x] Campaign tracking URL injection baseline that adds open/click tracking URLs to dry-run campaign queue jobs without delivery.
24. [x] Campaign engagement reporting baseline with dry-run open/click counts and rates.
25. [x] Dashboard campaign engagement summary baseline that surfaces open/click totals and dry-run rates.
26. [x] Frontend safe metrics dashboard baseline that displays email events, suppressions, engagement, provider mode, and locked delivery state.
27. [x] Remote PostgreSQL data source registry baseline that validates and stores redacted source metadata without probing networks or syncing data.
28. [x] Encrypted data source connection secret baseline that can store PostgreSQL connection URLs behind `ORACLESTREET_DATA_SOURCE_SECRET_KEY` using AES-256-GCM while returning only redacted metadata/secret refs and keeping sync disabled.
29. [x] Remote PostgreSQL sync dry-run job baseline that validates registered sources/mapping without network probes, remote row pulls, imports, or enabling sync.
30. [x] Frontend remote PostgreSQL mapping/status UI baseline that displays registered source metadata and sync dry-run status after admin login without exposing secrets or pulling remote rows.
31. [x] Remote PostgreSQL sync audit log baseline that exposes sanitized sync dry-run audit events without secrets, probes, imports, or real sync.
32. [x] Web/domain readiness safe-gate baseline that reports expected domain DNS, fallback URLs, TLS planning, and smoke-test commands without DNS probes or unlocking delivery.
33. [x] TLS readiness safe-gate baseline that reports TLS mode, certificate candidates, prerequisites, and smoke tests without requesting certificates, editing Nginx, or unlocking delivery.
34. [x] Backup readiness safe-gate baseline that reports database backup path, schedule, retention, and restore/offsite recommendations without dumping data, writing files, or exposing secrets.
35. [x] Monitoring readiness safe-gate baseline that reports health/frontend/service/nginx/watchdog check plans and alert posture without probing networks or mutating services.

## Current validation endpoints

- `GET /api/audit-log` requires an admin session and lists sanitized in-memory audit events until PostgreSQL persistence is wired.
- `GET /api/email/config` exposes redacted provider readiness only.
- `POST /api/email/provider/validate` requires an admin session and validates selected provider configuration without sending mail or opening a network connection. `local-capture` validates an allowed controlled recipient domain and never opens a network connection.
- `GET /api/email/provider/adapter` requires an admin session and reports the selected safe provider adapter capability/readiness. SMTP/PowerMTA adapters remain `configured-but-locked`, redact secrets, and return `realDeliveryAllowed: false`.
- `POST /api/email/test-send` requires an admin session and is dry-run only.
- `POST /api/send-queue/enqueue` requires an admin session, applies the current safe test-message gates, and queues dry-run jobs only.
- `POST /api/campaigns/approve-dry-run` requires an admin session, re-validates campaign audience/template compliance, marks a draft campaign `approved_dry_run`, and keeps `realDelivery: false`.
- `POST /api/campaigns/schedule-dry-run` requires an admin session, requires `approved_dry_run`, validates a future `scheduledAt`, marks the campaign `scheduled_dry_run`, and keeps manual dispatch/no delivery.
- `POST /api/campaigns/enqueue-dry-run` requires an admin session, requires `approved_dry_run` or `scheduled_dry_run`, renders the campaign audience into dry-run queue jobs, injects per-recipient `/api/unsubscribe` and tracking URLs, applies suppression/rate-limit gates, and keeps `realDelivery: false`.
- `GET /api/send-queue` requires an admin session and lists in-memory dry-run queued jobs for smoke testing until PostgreSQL persistence is wired.
- `POST /api/send-queue/dispatch-next-dry-run` requires an admin session and dispatches exactly one queued dry-run job through the dry-run adapter path with `realDelivery: false`; successful dispatch records an internal `dispatched` email event.
- `POST /api/suppressions` and `GET /api/suppressions` require an admin session for manual suppression smoke testing.
- `GET /api/unsubscribe` / `GET /unsubscribe` accepts tracked link query params (`email`, `source`, `campaignId`, `contactId`) and records an unsubscribe suppression without auth or delivery. `POST /api/unsubscribe` remains available for JSON smoke tests.
- `GET /api/email/rate-limits` requires an admin session and returns dry-run warm-up caps. Queue enqueue enforces global and per-domain hourly limits before any provider path.
- `POST /api/email/events/validate-import` requires an admin session and validates manual CSV bounce/complaint imports without recording events, creating suppressions, probing networks, or sending mail.
- `POST /api/email/events/import` requires an admin session, atomically rejects invalid CSV files, and imports fully valid bounce/complaint rows into events and suppressions without probing networks or sending mail.
- `POST /api/email/events/ingest` requires an admin session and accepts manual `bounce`/`complaint` event batches only; accepted events create suppressions and do not trigger delivery. Internal `dispatched` events are recorded only by the dry-run dispatch path.
- `GET /api/track/open` and `GET /api/track/click` record tracked engagement events with campaign/contact metadata without auth, redirects, network probes, or delivery.
- `GET /api/email/events` requires an admin session and lists in-memory event records until PostgreSQL persistence is wired.
- `GET /api/email/local-capture` requires an admin session and lists captured local-provider messages for controlled smoke tests only.
- `GET /api/email/reporting` requires an admin session and summarizes queue, suppression, bounce/complaint, provider, rate-limit, and compliance-gate state without enabling delivery.
- `GET /api/email/sending-readiness` requires an admin session and reports real-sending readiness blockers without exposing secrets. It always returns `readyForRealDelivery: false`/`realDeliveryAllowed: false` until explicit future live-test approval work exists.
- `GET /api/email/domain-readiness` requires an admin session and reports default sender domain readiness, expected SPF/DKIM/DMARC records, and TLS requirements without DNS network probes or delivery.
- `GET /api/web/domain-readiness` requires an admin session and reports expected web DNS records, primary/fallback health URLs, TLS mode planning, and smoke-test commands without DNS/network probes, HTTPS changes, or delivery unlocks.
- `GET /api/web/tls-readiness` requires an admin session and reports selected TLS mode, certificate candidate domains, prerequisites, and HTTP/HTTPS smoke-test commands without requesting certificates, editing Nginx, probing certificates, or delivery unlocks.
- `GET /api/backups/readiness` requires an admin session and reports redacted database backup planning, storage path, schedule, retention, and restore/offsite recommendations without creating dumps, writing files, exposing secrets, or delivery unlocks.
- `GET /api/monitoring/readiness` requires an admin session and reports health/frontend/service/nginx/watchdog check plans, monitor interval, alert posture, and recommended commands without probing networks, mutating services, exposing secrets, or delivery unlocks.
- `GET /api/campaigns/reporting` requires an admin session and summarizes per-campaign dry-run queue, dispatch, event, engagement, and unsubscribe counts/rates without enabling delivery.
- `GET /api/dashboard` includes the same safe email reporting summary plus campaign engagement reporting totals/rates without enabling delivery.
- `/` frontend dashboard displays safe counters for queue, suppressions, events, bounce/complaint, open/click, rates, provider mode, and the locked real-sending state after admin login.
- `GET`/`POST /api/data-sources` requires an admin session and registers remote PostgreSQL source metadata with redacted URLs only. Optional `storeSecret: true` stores the connection URL in the encrypted secret baseline when `ORACLESTREET_DATA_SOURCE_SECRET_KEY` is configured, returns only an encrypted secret ref/metadata, skips connection probes, keeps `syncEnabled: false`, and does not pull data.
- `GET`/`POST /api/data-source-sync-runs` requires an admin session and creates/lists dry-run sync validation records for registered sources. It validates source existence and optional mapping fields, records blockers for future live sync, skips network probes, pulls/imports zero rows, and keeps `realSync: false`.
- `/` frontend dashboard displays a protected remote PostgreSQL mapping/status panel using redacted source metadata and dry-run sync counts only. It does not expose secrets, enable sync, or pull remote rows.
- `GET /api/data-source-sync-audit` requires an admin session and returns sanitized `data_source_sync*` audit events only. Viewing the audit is itself audited, returns no plaintext secrets, and keeps `realSync: false`.

## PMTA-first development priority

Boss prioritized PMTA/sending capability first. Build order is now: provider config validation, dry-run controlled test-send, SMTP adapter, PowerMTA adapter, receive/bounce testing, then production domain/TLS/DNS. Real outbound mail remains disabled until safety gates pass.
