# OracleStreet PostgreSQL Data Model Draft

## Core tables

- `users`: admin/operator accounts.
- `roles`: role definitions.
- `contacts`: email recipients and imported records.
- `contact_attributes`: flexible metadata for imported data.
- `segments`: saved contact filters.
- `campaigns`: campaign definition and lifecycle status.
- `campaign_contacts`: materialized campaign audience membership.
- `templates`: subject/body templates.
- `send_jobs`: batches for email sends.
- `email_events`: sent/open/click/bounce/unsubscribe events.
- `affiliate_partners`: partners and traffic sources.
- `affiliate_links`: campaign/source tracking records.
- `data_sources`: remote PostgreSQL connection definitions, encrypted at rest.
- `sync_runs`: remote pull logs and status.
- `audit_log`: admin actions.

## Remote PostgreSQL connector principle

OracleStreet should pull records into local normalized tables, not operate directly on remote production tables during user workflows. Remote credentials are secrets and must not be committed.
