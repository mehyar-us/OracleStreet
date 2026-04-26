#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SSH_ALIAS="${ORACLESTREET_VPS_SSH_ALIAS:-oraclestreet-vps}"

cd "$REPO_ROOT"

if [[ -n "$(git status --short)" ]]; then
  echo "Refusing deploy: git working tree has uncommitted changes." >&2
  echo "Commit first, then deploy." >&2
  exit 1
fi

COMMIT="$(git rev-parse --short HEAD)"
echo "Deploying OracleStreet commit $COMMIT to $SSH_ALIAS"

ssh "$SSH_ALIAS" 'mkdir -p /opt/oraclestreet/backend /opt/oraclestreet/scripts /var/www/oraclestreet /etc/oraclestreet'
rsync -az --delete frontend/ "$SSH_ALIAS:/var/www/oraclestreet/"
rsync -az --delete backend/ "$SSH_ALIAS:/opt/oraclestreet/backend/"
rsync -az scripts/oraclestreet-watchdog.sh "$SSH_ALIAS:/opt/oraclestreet/scripts/oraclestreet-watchdog.sh"

ssh "$SSH_ALIAS" 'bash -s' <<'REMOTE'
set -euo pipefail
install -d -m 750 /etc/oraclestreet
install -d -m 755 /opt/oraclestreet/backend /opt/oraclestreet/scripts /var/www/oraclestreet
chmod +x /opt/oraclestreet/scripts/oraclestreet-watchdog.sh

# Self-bootstrap runtime secrets. Existing values are preserved; missing values are generated.
if [ ! -f /etc/oraclestreet/oraclestreet.env ]; then
  touch /etc/oraclestreet/oraclestreet.env
  chmod 600 /etc/oraclestreet/oraclestreet.env
fi
ensure_secret() {
  key="$1"
  value_cmd="$2"
  if ! grep -q "^${key}=" /etc/oraclestreet/oraclestreet.env; then
    value="$(eval "$value_cmd")"
    printf '%s=%s\n' "$key" "$value" >> /etc/oraclestreet/oraclestreet.env
  fi
}
ensure_secret ORACLESTREET_APP_ENV 'printf production'
ensure_secret ORACLESTREET_BACKEND_HOST 'printf 127.0.0.1'
ensure_secret ORACLESTREET_BACKEND_PORT 'printf 4000'
ensure_secret ORACLESTREET_FRONTEND_ROOT 'printf /var/www/oraclestreet'
ensure_secret ORACLESTREET_SESSION_SECRET 'openssl rand -hex 32'
ensure_secret ORACLESTREET_INTERNAL_API_KEY 'openssl rand -hex 24'

if [ ! -f /etc/oraclestreet/initial-admin.env ]; then
  cat > /etc/oraclestreet/initial-admin.env <<ADMIN
ORACLESTREET_ADMIN_EMAIL=admin@oraclestreet.local
ORACLESTREET_ADMIN_PASSWORD=$(openssl rand -base64 30 | tr -d '\n')
ORACLESTREET_ADMIN_CREATED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
ADMIN
  chmod 600 /etc/oraclestreet/initial-admin.env
fi
chmod 600 /etc/oraclestreet/oraclestreet.env /etc/oraclestreet/initial-admin.env

cat > /etc/systemd/system/oraclestreet-backend.service <<'SERVICE'
[Unit]
Description=OracleStreet Backend API
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/oraclestreet/backend
EnvironmentFile=-/etc/oraclestreet/oraclestreet.env
EnvironmentFile=-/etc/oraclestreet/initial-admin.env
ExecStart=/usr/bin/node /opt/oraclestreet/backend/server.js
Restart=always
RestartSec=3
User=root
Group=root

[Install]
WantedBy=multi-user.target
SERVICE

cat > /etc/systemd/system/oraclestreet-watchdog.service <<'SERVICE'
[Unit]
Description=OracleStreet watchdog self-heal check
After=network.target nginx.service oraclestreet-backend.service

[Service]
Type=oneshot
ExecStart=/opt/oraclestreet/scripts/oraclestreet-watchdog.sh
SERVICE

cat > /etc/systemd/system/oraclestreet-watchdog.timer <<'TIMER'
[Unit]
Description=Run OracleStreet watchdog every 5 minutes

[Timer]
OnBootSec=2min
OnUnitActiveSec=5min
Unit=oraclestreet-watchdog.service
Persistent=true

[Install]
WantedBy=timers.target
TIMER

cd /opt/oraclestreet/backend
if [ -f package.json ]; then
  npm install --omit=dev --no-audit --no-fund
fi

systemctl daemon-reload
systemctl enable --now oraclestreet-backend >/dev/null
systemctl restart oraclestreet-backend
systemctl enable --now oraclestreet-watchdog.timer >/dev/null
nginx -t
systemctl reload nginx

for i in 1 2 3 4 5; do
  if curl -fsS http://127.0.0.1/api/health >/dev/null 2>&1; then
    break
  fi
  if [ "$i" = "5" ]; then
    echo "Backend health check failed after retries" >&2
    exit 1
  fi
  sleep 1
done
curl -fsS -I http://127.0.0.1/ >/dev/null
systemctl is-active --quiet oraclestreet-backend
systemctl is-active --quiet oraclestreet-watchdog.timer
systemctl is-active --quiet nginx
systemctl is-active --quiet docker
systemctl is-active --quiet ssh
REMOTE

echo "Deploy complete: $COMMIT"
