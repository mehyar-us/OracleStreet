# OracleStreet Email Marketing Platform Build Plan

## Mission

Build OracleStreet into a private email marketing platform for affiliate campaigns: audience management, segmentation, campaign creation, template management, send orchestration, delivery tracking, and PostgreSQL-backed reporting.

## Compliance boundary

OracleStreet is for lawful, permission-based email. The platform must enforce:

- opt-in/source tracking for contacts
- unsubscribe/suppression checks before send
- bounce and complaint suppression
- rate limits and warm-up controls
- campaign audit logs
- no sending to harvested, purchased, or unauthorized lists

## Core user flow

1. Admin logs in.
2. Admin imports or syncs contacts from PostgreSQL/source files.
3. Admin validates contact source/consent metadata.
4. Admin creates a segment.
5. Admin creates an email template.
6. Admin creates a campaign and selects segment + template.
7. System estimates audience, suppressions, and risk flags.
8. Admin schedules or sends campaign.
9. Send queue dispatches messages through provider adapter.
10. System records send/open/click/bounce/unsubscribe/complaint events.
11. Dashboard reports campaign and affiliate performance.

## MVP build order

### 1. Auth + admin shell

- [x] login screen
- [x] first admin bootstrap from `/etc/oraclestreet/initial-admin.env`
- [x] session handling from `ORACLESTREET_SESSION_SECRET`
- [x] protected dashboard route

### 2. PostgreSQL foundation

- app database connection
- migration system
- tables from `docs/03-DATA-MODEL.md`
- seed first admin user

### 3. Contacts and suppressions

- contacts CRUD/import
- suppression list
- unsubscribe endpoint
- source/consent fields required

### 4. Campaign CMS

- campaigns CRUD
- templates CRUD
- segments/saved filters
- preview/render test

### 5. Send engine

- `send_jobs` queue
- provider adapter interface
- dry-run provider first
- PowerMTA SMTP provider after safety controls exist

### 6. Events + reporting

- delivery events
- bounce parsing
- unsubscribe tracking
- campaign reporting dashboard

## Definition of safe sending readiness

PowerMTA or any real mail provider must not send production mail until these exist:

- suppression check in send path
- unsubscribe link injection
- sender/domain config documented
- bounce mailbox or webhook ingestion plan
- rate limits per domain/provider
- audit log for send jobs
- manual dry-run proof
