# OracleStreet Ultimate Development Flow

## Objective

Build OracleStreet as a private, continuously deployed CMS for affiliate marketing users, campaigns, subscriber/contact records, and email sending workflows. First scope is email only, with future expansion into more channels after the email engine is stable.

## Operating loop

1. **Define**: every feature starts as a short doc or issue with acceptance criteria.
2. **Build locally**: update `frontend/`, `backend/`, database migrations, and docs together.
3. **Verify**: run the smallest meaningful gate: lint/test/health check/manual browser check.
4. **Commit**: keep commits small and descriptive.
5. **Push**: push `main` to the private GitHub repo.
6. **Deploy**: run `./scripts/deploy-vps.sh` to ship current `main` to the VPS.
7. **Smoke test**: verify `/`, `/api/health`, and the admin login path.
8. **Record**: update docs when architecture, secrets, deployment, or product decisions change.

## Deployment model

- GitHub private repo is the source of truth.
- VPS is the production/staging host until a domain is purchased.
- Visit by server IP first.
- Nginx serves static frontend from `/var/www/oraclestreet`.
- Nginx proxies backend API traffic from `/api/` to `127.0.0.1:4000`.
- Backend runs as a systemd service: `oraclestreet-backend`.
- Secrets live outside git in `/etc/oraclestreet/*.env` on the VPS and local ignored docs/private files.

## CI/CD inspiration

The flow borrows the reliable parts of common SaaS deployment patterns: commit-addressable releases, VPS deploy over SSH, Nginx reverse proxy, Docker-ready host, explicit smoke checks, and rollbackable backups. Docker blue/green can be added after the first working product is online.

## Definition of done for each deploy

- `git status` clean locally before deploy.
- Commit pushed to `origin/main`.
- `nginx -t` passes on VPS.
- `systemctl is-active oraclestreet-backend nginx docker ssh` passes.
- `curl http://127.0.0.1/api/health` returns OK on VPS.
- Frontend returns HTTP `200` on VPS.
