#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OPENCLAW_ENV="${OPENCLAW_ENV:-/home/mehya/.openclaw/.env}"
BRANCH="${1:-main}"
REMOTE="${ORACLESTREET_GIT_REMOTE:-origin}"

cd "$REPO_ROOT"

if [[ ! -f "$OPENCLAW_ENV" ]]; then
  echo "Missing OpenClaw env file: $OPENCLAW_ENV" >&2
  exit 1
fi

# Load only GITHUB_TOKEN from the shared OpenClaw env so autonomous runs can
# push without writing tokens into .git/config, docs, command output, or commit
# history. Parse the .env line instead of sourcing the whole file because some
# existing values are raw shell-special strings.
GITHUB_TOKEN="$(python3 - "$OPENCLAW_ENV" <<'PY'
import sys
from pathlib import Path
path = Path(sys.argv[1])
for raw in path.read_text(errors="ignore").splitlines():
    line = raw.strip()
    if not line or line.startswith("#") or "=" not in line:
        continue
    key, value = line.split("=", 1)
    if key.strip() == "GITHUB_TOKEN":
        value = value.strip().strip('"').strip("'")
        print(value)
        break
PY
)"
export GITHUB_TOKEN

if [[ -z "$GITHUB_TOKEN" ]]; then
  echo "GITHUB_TOKEN is not set in $OPENCLAW_ENV" >&2
  exit 1
fi

# Keep the remote token-free. GitHub auth is supplied via an ephemeral askpass
# helper, avoiding interactive prompts and avoiding token persistence.
git remote set-url "$REMOTE" "https://github.com/mehyar-us/OracleStreet.git"

ASKPASS="$(mktemp)"
cleanup() {
  rm -f "$ASKPASS"
}
trap cleanup EXIT
chmod 700 "$ASKPASS"
cat > "$ASKPASS" <<'ASKPASS_EOF'
#!/usr/bin/env bash
case "$1" in
  *Username*) printf '%s\n' 'x-access-token' ;;
  *Password*) printf '%s\n' "${GITHUB_TOKEN:?}" ;;
  *) printf '\n' ;;
esac
ASKPASS_EOF
chmod 700 "$ASKPASS"

GIT_TERMINAL_PROMPT=0 GIT_ASKPASS="$ASKPASS" git push "$REMOTE" "$BRANCH"
