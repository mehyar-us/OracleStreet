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
2. Copies frontend files to `/var/www/oraclestreet`.
3. Copies backend files to `/opt/oraclestreet/backend`.
4. Installs backend production dependencies if needed.
5. Installs/updates systemd service.
6. Tests and reloads Nginx.
7. Runs local VPS smoke checks.

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
