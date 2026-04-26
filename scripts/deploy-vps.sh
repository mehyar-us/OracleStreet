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

ssh "$SSH_ALIAS" 'mkdir -p /opt/oraclestreet/backend /var/www/oraclestreet /etc/oraclestreet'
rsync -az --delete frontend/ "$SSH_ALIAS:/var/www/oraclestreet/"
rsync -az --delete backend/ "$SSH_ALIAS:/opt/oraclestreet/backend/"

ssh "$SSH_ALIAS" 'bash -s' <<'REMOTE'
set -euo pipefail
cat > /etc/systemd/system/oraclestreet-backend.service <<'SERVICE'
[Unit]
Description=OracleStreet Backend API
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/oraclestreet/backend
EnvironmentFile=-/etc/oraclestreet/oraclestreet.env
ExecStart=/usr/bin/node /opt/oraclestreet/backend/server.js
Restart=always
RestartSec=3
User=root
Group=root

[Install]
WantedBy=multi-user.target
SERVICE

cd /opt/oraclestreet/backend
if [ -f package.json ]; then
  npm install --omit=dev --no-audit --no-fund
fi

systemctl daemon-reload
systemctl enable --now oraclestreet-backend >/dev/null
systemctl restart oraclestreet-backend
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
systemctl is-active --quiet nginx
systemctl is-active --quiet docker
systemctl is-active --quiet ssh
REMOTE

echo "Deploy complete: $COMMIT"
