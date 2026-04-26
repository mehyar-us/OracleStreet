# OracleStreet Secrets and Access

## Rule

Do not commit raw passwords, database URLs, email provider keys, SMTP credentials, or remote PostgreSQL credentials.

## First admin credential

Generated first admin credentials are stored outside git:

- Local: `docs/.private/initial-admin.env`
- VPS: `/etc/oraclestreet/initial-admin.env`

Retrieve locally:

```bash
cat docs/.private/initial-admin.env
```

Retrieve on VPS:

```bash
ssh oraclestreet-vps 'cat /etc/oraclestreet/initial-admin.env'
```

Rotate after the real auth system is implemented.

## Current SSH access

Use:

```bash
ssh oraclestreet-vps
```
