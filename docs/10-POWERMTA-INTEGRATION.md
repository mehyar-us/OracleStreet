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
  -> Send job queue
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

1. Dry-run provider with full database event records.
2. Generic SMTP provider using same adapter interface.
3. PowerMTA provider config + validation.
4. Rate limiting/warm-up controls.
5. Bounce ingestion.
6. Dashboard reporting.
