# OracleStreet Watchdog and Auto-Secrets

## Policy

OracleStreet deploys should require zero human intervention for baseline runtime secrets. Deploy scripts generate missing secrets and preserve existing secrets.

## Auto-generated secrets

`./scripts/deploy-vps.sh` guarantees these files exist on the VPS:

- `/etc/oraclestreet/oraclestreet.env`
- `/etc/oraclestreet/initial-admin.env`

Generated or preserved keys include:

- `ORACLESTREET_SESSION_SECRET`
- `ORACLESTREET_INTERNAL_API_KEY`
- `ORACLESTREET_ADMIN_EMAIL`
- `ORACLESTREET_ADMIN_PASSWORD`

Secrets are not committed to git. They are created on deploy and kept on the VPS.

## Watchdog

The VPS runs a systemd timer:

```bash
systemctl status oraclestreet-watchdog.timer
systemctl list-timers | grep oraclestreet
journalctl -u oraclestreet-watchdog.service -n 100 --no-pager
cat /var/log/oraclestreet-watchdog.log
```

Cadence: every 5 minutes.

The watchdog checks and heals:

- SSH active
- Docker active
- Nginx active and config valid
- OracleStreet backend active
- direct backend health: `http://127.0.0.1:4000/health`
- proxied backend health: `http://127.0.0.1/api/health`
- frontend HTTP response

If a blocker loop appears, the watchdog attempts restart/reload first and logs unresolved states for escalation.
