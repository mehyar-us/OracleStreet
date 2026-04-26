# OracleStreet Email System

## Email-only first scope

The first release focuses only on email: importing contacts, segmenting them, building campaigns, sending messages, and recording events.

## Provider abstraction

Create a provider adapter interface:

- `sendEmail(message)`
- `validateSender(sender)`
- `handleWebhook(event)`
- `getSuppressionStatus(email)`

Candidate providers later: SMTP, Brevo, Amazon SES, Postmark, SendGrid. Start with a safe dry-run provider until deliverability configuration is ready.

## Compliance baseline

- Store unsubscribe status.
- Never email unsubscribed contacts.
- Track source of every contact.
- Keep audit logs for imports and sends.
- Add rate limits before real campaigns.

## PowerMTA path

PowerMTA should be implemented only as a compliant SMTP provider adapter after dry-run sending, suppressions, unsubscribe handling, rate limits, and audit logs exist. See `docs/10-POWERMTA-INTEGRATION.md`.
