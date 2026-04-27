# OracleStreet Deployment

## Local prerequisites

- SSH alias exists: `oraclestreet-vps`
- VPS has SSH key installed.
- VPS has Nginx, Docker, Node.js, and npm.
- Local repo is clean before deployment.

## Deploy command

```bash
./scripts/deploy-vps.sh
```

The script:

1. Checks repo status.
2. Runs backend tests before shipping.
3. Copies frontend files to `/var/www/oraclestreet`.
4. Copies backend files to `/opt/oraclestreet/backend`.
5. Installs backend production dependencies if needed.
6. Installs/updates systemd service.
7. Tests and reloads Nginx.
8. Runs local VPS smoke checks.

## VPS commands

```bash
ssh oraclestreet-vps
systemctl status oraclestreet-backend
journalctl -u oraclestreet-backend -n 100 --no-pager
nginx -t
```

## Rollback

The VPS reset backup is stored under `/root/oraclestreet-reset-backup-*`. Deployment backups should be added once releases become non-trivial.

## Auto-secrets and watchdog

Deploy now self-generates missing runtime secrets on the VPS and installs a systemd watchdog timer. See `docs/08-WATCHDOG-AND-AUTOSECRETS.md`.

## Current domain wiring

OracleStreet is now wired toward `stuffprettygood.com` on VPS `187.124.147.49`. See `docs/12-DOMAIN-CLOUDFLARE.md`.
