# OracleStreet Product Spec

## Product

OracleStreet is a CMS and operations console for affiliate marketing. It manages users, affiliate partners, campaigns, email audiences, message templates, sending jobs, and performance records.

## First product scope: email-only

Comparable category: lightweight Mailchimp/Brevo-style campaign management, but owned, private, and extensible.

### Core modules

- **Admin users**: owner/admin login, roles, audit trail.
- **Contacts**: imported/pulled people or companies with email fields and metadata.
- **Segments**: saved filters over contacts.
- **Campaigns**: email campaign metadata, goal, audience, status.
- **Templates**: reusable email bodies and subject lines.
- **Send jobs**: queued email sends, retries, delivery status.
- **Affiliate records**: campaign-to-partner mapping, source tags, payout/reference fields.
- **Remote pulls**: connect to remote PostgreSQL and pull records into OracleStreet.

## Initial screens

1. Login
2. Dashboard
3. Contacts
4. Segments
5. Campaigns
6. Templates
7. Send jobs
8. Data sources / remote PostgreSQL connectors
9. Settings

## Non-negotiables

- PostgreSQL-first data model.
- No secrets in git.
- Every deploy smoke-tested.
- IP-based access first; domain and TLS later.
- Email sending provider abstraction so SMTP, Brevo, SES, or another provider can be swapped later.
