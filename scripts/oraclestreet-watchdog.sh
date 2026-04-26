#!/usr/bin/env bash
set -euo pipefail

LOG=/var/log/oraclestreet-watchdog.log
STAMP="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
exec >>"$LOG" 2>&1

echo "[$STAMP] watchdog start"

heal_service() {
  local service="$1"
  if ! systemctl is-active --quiet "$service"; then
    echo "[$STAMP] restarting inactive service: $service"
    systemctl restart "$service" || true
  fi
}

heal_service ssh
heal_service docker
heal_service nginx
heal_service oraclestreet-backend

if ! nginx -t; then
  echo "[$STAMP] nginx config invalid; leaving service untouched for inspection"
  exit 1
fi

if ! curl -fsS --max-time 5 http://127.0.0.1:4000/health >/dev/null; then
  echo "[$STAMP] direct backend health failed; restarting backend"
  systemctl restart oraclestreet-backend || true
  sleep 2
fi

if ! curl -fsS --max-time 5 http://127.0.0.1/api/health >/dev/null; then
  echo "[$STAMP] proxied health failed; reloading nginx and backend"
  systemctl restart oraclestreet-backend || true
  systemctl reload nginx || systemctl restart nginx || true
  sleep 2
fi

if curl -fsS --max-time 5 http://127.0.0.1/api/health >/dev/null && curl -fsS -I --max-time 5 http://127.0.0.1/ >/dev/null; then
  echo "[$STAMP] watchdog ok"
  exit 0
fi

echo "[$STAMP] watchdog unresolved after heal attempt"
exit 1
