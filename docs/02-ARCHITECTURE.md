# OracleStreet Architecture

## Current VPS baseline

- OS: Ubuntu 24.04
- Reverse proxy: Nginx
- Runtime: Node.js available on VPS
- Containers: Docker installed and kept active
- Frontend root: `/var/www/oraclestreet`
- Backend root: `/opt/oraclestreet/backend`
- Backend service: `oraclestreet-backend`
- Backend port: `127.0.0.1:4000`

## Recommended stack

- **Frontend**: React or Next.js admin console once screens begin.
- **Backend**: Node.js API service.
- **Database**: PostgreSQL for application data.
- **Remote source sync**: connector jobs that pull from external PostgreSQL into normalized local tables.
- **Email engine**: provider adapter pattern.
- **Queue**: start with PostgreSQL-backed job table; add Redis/BullMQ only when volume requires it.

## Request flow

```text
Browser by VPS IP
  -> Nginx :80
    -> /                 static frontend
    -> /api/*            backend proxy to 127.0.0.1:4000
      -> PostgreSQL app database
      -> optional remote PostgreSQL pull connectors
      -> email provider adapter
```

## Growth path

1. Static shell + health API.
2. Authentication + first admin.
3. PostgreSQL schema and migrations.
4. Contacts CRUD.
5. Campaign CRUD.
6. Template CRUD.
7. Email queue and provider adapter.
8. Remote PostgreSQL connector.
9. Analytics and affiliate attribution.
10. Domain + TLS + production hardening.
