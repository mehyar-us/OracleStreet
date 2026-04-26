# OracleStreet Infrastructure Notes

## VPS environment variables

OracleStreet should use project-specific VPS variable names so deployment and automation are not tied to the original provider label.

Expected local secret variables:

```bash
ORACLESTREET_VPS_SERVER_IP=
ORACLESTREET_VPS_SERVER_USERNAME=root
ORACLESTREET_VPS_SERVER_PASS=
```

These values are secrets and must stay out of git. Keep them in the operator's local ignored `.env` file or a deployment secret manager.

## Connectivity check

A password-based SSH check was verified from the OpenClaw host on 2026-04-26. The VPS accepted the stored credentials and returned:

- login user: `root`
- hostname: `srv1466771`
- kernel family: Linux `6.8.0-90-generic` x86_64

Do not print the raw IP or password in logs, docs, commits, or chat summaries.
