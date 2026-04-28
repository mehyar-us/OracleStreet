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

if [ -f backend/package.json ]; then
  npm test --prefix backend
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
ensure_secret ORACLESTREET_DOMAIN 'printf stuffprettygood.com'
ensure_secret ORACLESTREET_PUBLIC_BASE_URL 'printf http://stuffprettygood.com'
ensure_secret ORACLESTREET_SESSION_SECRET 'openssl rand -hex 32'
ensure_secret ORACLESTREET_INTERNAL_API_KEY 'openssl rand -hex 24'
ensure_secret ORACLESTREET_PG_REPOSITORIES 'printf contacts,suppressions,templates,segments,campaigns,send_queue,email_events,users,user_invite_password_workflow,admin_sessions,audit_log,warmup_policies,reputation_policies,data_sources,data_source_encrypted_secrets,data_source_import_schedules,controlled_live_test_proof_audits'
pg_repositories="$(grep '^ORACLESTREET_PG_REPOSITORIES=' /etc/oraclestreet/oraclestreet.env | tail -n1 | cut -d= -f2-)"
for repo in contacts suppressions templates segments campaigns send_queue email_events users user_invite_password_workflow admin_sessions audit_log warmup_policies reputation_policies data_sources data_source_encrypted_secrets data_source_import_schedules controlled_live_test_proof_audits; do
  case ",$pg_repositories," in
    *",$repo,"*) ;;
    *) pg_repositories="${pg_repositories:+$pg_repositories,}$repo" ;;
  esac
done
python3 - "$pg_repositories" <<'PY'
from pathlib import Path
import sys
path = Path('/etc/oraclestreet/oraclestreet.env')
lines = path.read_text().splitlines()
value = sys.argv[1]
for i, line in enumerate(lines):
    if line.startswith('ORACLESTREET_PG_REPOSITORIES='):
        lines[i] = f'ORACLESTREET_PG_REPOSITORIES={value}'
        break
else:
    lines.append(f'ORACLESTREET_PG_REPOSITORIES={value}')
path.write_text('\n'.join(lines) + '\n')
PY
ensure_secret ORACLESTREET_DATABASE_NAME 'printf oraclestreet'
ensure_secret ORACLESTREET_DATABASE_USER 'printf oraclestreet_app'
ensure_secret ORACLESTREET_DATABASE_PASSWORD 'openssl rand -hex 24'
if ! grep -q '^ORACLESTREET_DATABASE_URL=' /etc/oraclestreet/oraclestreet.env; then
  db_name="$(grep '^ORACLESTREET_DATABASE_NAME=' /etc/oraclestreet/oraclestreet.env | tail -n1 | cut -d= -f2-)"
  db_user="$(grep '^ORACLESTREET_DATABASE_USER=' /etc/oraclestreet/oraclestreet.env | tail -n1 | cut -d= -f2-)"
  db_pass="$(grep '^ORACLESTREET_DATABASE_PASSWORD=' /etc/oraclestreet/oraclestreet.env | tail -n1 | cut -d= -f2-)"
  printf 'ORACLESTREET_DATABASE_URL=postgresql://%s:%s@127.0.0.1:5432/%s?sslmode=disable\n' "$db_user" "$db_pass" "$db_name" >> /etc/oraclestreet/oraclestreet.env
fi

if [ ! -f /etc/oraclestreet/initial-admin.env ]; then
  cat > /etc/oraclestreet/initial-admin.env <<ADMIN
ORACLESTREET_ADMIN_EMAIL=admin@oraclestreet.local
ORACLESTREET_ADMIN_PASSWORD=$(openssl rand -base64 30 | tr -d '\n')
ORACLESTREET_ADMIN_CREATED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
ADMIN
  chmod 600 /etc/oraclestreet/initial-admin.env
fi
chmod 600 /etc/oraclestreet/oraclestreet.env /etc/oraclestreet/initial-admin.env

# Ensure local PostgreSQL exists and has OracleStreet schema before backend start.
export DEBIAN_FRONTEND=noninteractive
if ! command -v psql >/dev/null 2>&1; then
  apt-get update -y
  apt-get install -y postgresql postgresql-client
fi
systemctl enable --now postgresql >/dev/null 2>&1 || service postgresql start >/dev/null 2>&1

db_name="$(grep '^ORACLESTREET_DATABASE_NAME=' /etc/oraclestreet/oraclestreet.env | tail -n1 | cut -d= -f2-)"
db_user="$(grep '^ORACLESTREET_DATABASE_USER=' /etc/oraclestreet/oraclestreet.env | tail -n1 | cut -d= -f2-)"
db_pass="$(grep '^ORACLESTREET_DATABASE_PASSWORD=' /etc/oraclestreet/oraclestreet.env | tail -n1 | cut -d= -f2-)"
runuser -u postgres -- psql -v ON_ERROR_STOP=1 <<SQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${db_user}') THEN
    CREATE ROLE ${db_user} LOGIN PASSWORD '${db_pass}';
  ELSE
    ALTER ROLE ${db_user} WITH LOGIN PASSWORD '${db_pass}';
  END IF;
END
\$\$;
SELECT 'CREATE DATABASE ${db_name} OWNER ${db_user}' WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = '${db_name}')\gexec
GRANT ALL PRIVILEGES ON DATABASE ${db_name} TO ${db_user};
SQL
runuser -u postgres -- psql -v ON_ERROR_STOP=1 -d "$db_name" <<SQL
CREATE TABLE IF NOT EXISTS schema_migrations (
  id text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL PRIVILEGES ON SCHEMA public TO ${db_user};
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO ${db_user};
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO ${db_user};
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO ${db_user};
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO ${db_user};
SQL
if [ -d /opt/oraclestreet/backend/migrations ]; then
  for migration in /opt/oraclestreet/backend/migrations/*.sql; do
    [ -f "$migration" ] || continue
    migration_id="$(basename "$migration" .sql)"
    if ! runuser -u postgres -- psql -tAc "SELECT 1 FROM schema_migrations WHERE id='${migration_id}'" -d "$db_name" | grep -q 1; then
      runuser -u postgres -- psql -v ON_ERROR_STOP=1 -d "$db_name" -f "$migration"
      runuser -u postgres -- psql -v ON_ERROR_STOP=1 -d "$db_name" -c "INSERT INTO schema_migrations(id) VALUES ('${migration_id}') ON CONFLICT DO NOTHING;"
    fi
  done
fi

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

cat > /etc/nginx/sites-available/oraclestreet <<'NGINX'
# OracleStreet production baseline
# Frontend root: /var/www/oraclestreet
# Backend target: http://127.0.0.1:4000
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name stuffprettygood.com www.stuffprettygood.com 187.124.147.49 _;

    root /var/www/oraclestreet;
    index index.html;

    location /api/ {
        proxy_pass http://127.0.0.1:4000/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }

    location / {
        try_files $uri $uri/ /index.html;
    }
}
NGINX
rm -f /etc/nginx/sites-enabled/*
ln -s /etc/nginx/sites-available/oraclestreet /etc/nginx/sites-enabled/oraclestreet

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
