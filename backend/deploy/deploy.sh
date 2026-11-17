#!/usr/bin/env bash
# Deploys the committed backend to the VPS. Run from backend/ on the owner's machine:
#   npm run deploy                  build HEAD, upload, migrate, restart, check /health
#   npm run deploy -- rollback      point current at the previous release and restart
#   npm run deploy -- rollback <release-name>
# Settings (environment): DEPLOY_HOST (default deploy@api.picplease.app),
#   HEALTH_URL (default https://api.picplease.app/health).
# One-time server setup and details: docs/backend/deploy.md.
set -euo pipefail

DEPLOY_HOST="${DEPLOY_HOST:-deploy@api.picplease.app}"
HEALTH_URL="${HEALTH_URL:-https://api.picplease.app/health}"
APP_DIR=/opt/picplease
KEEP_RELEASES=5

cd "$(dirname "$0")/.."

say() { printf '==> %s\n' "$*"; }
fail() { printf 'deploy: %s\n' "$*" >&2; exit 1; }

remote() { ssh -o BatchMode=yes "$DEPLOY_HOST" "$@"; }

# Waits until /health reports the expected commit (about 60 s at most).
check_health() {
  local want="$1" body=""
  for _ in $(seq 1 30); do
    body="$(curl -fsS --max-time 5 "$HEALTH_URL" 2>/dev/null || true)"
    if [[ "$body" == *"\"commit\":\"$want\""* ]]; then
      say "Live: $body"
      return 0
    fi
    sleep 2
  done
  fail "/health does not show $want (last answer: ${body:-none}). See: journalctl -u picplease-api -n 50"
}

rollback() {
  local target="${1:-}"
  say "Rolling back on $DEPLOY_HOST"
  local commit
  commit="$(remote bash -s -- "$APP_DIR" "$target" <<'REMOTE'
set -euo pipefail
app="$1"; target="$2"
cd "$app/releases"
current="$(basename "$(readlink "$app/current")")"
if [[ -z "$target" ]]; then
  # The release just before the current one (names are <commit>_<UTC time>).
  target="$(ls -1 | sort -t_ -k2 | awk -v c="$current" '$0 == c { print prev; exit } { prev = $0 }')"
fi
[[ -n "$target" && -d "$target" ]] || { echo "no release to roll back to" >&2; exit 1; }
ln -sfn "releases/$target" "$app/current.next"
mv -T "$app/current.next" "$app/current"
sudo -n /usr/bin/systemctl restart picplease-api.service
echo "${target%%_*}"
REMOTE
)"
  say "Rolled back to $commit (migrations are not reversed)"
  check_health "$commit"
}

if [[ "${1:-}" == "rollback" ]]; then
  rollback "${2:-}"
  exit 0
fi
[[ $# -eq 0 ]] || fail "unknown arguments: $*"

# 1. Build locally from a clean, committed tree.
[[ "$(node -v)" == v24.* ]] || fail "Node 24 required (found $(node -v))"
[[ -z "$(git status --porcelain)" ]] || fail "working tree is not clean; commit first"
commit="$(git rev-parse --short HEAD)"
release="${commit}_$(date -u +%Y%m%dT%H%M%SZ)"

say "Lint and build $commit"
npm run --silent lint
npm run --silent build
grep -q "\"commit\":\"$commit\"" dist/build-info.json || fail "dist/build-info.json does not match $commit"

# 2. Upload the release (compiled code and the lockfile only; no sources, no .env).
say "Upload release $release to $DEPLOY_HOST"
remote mkdir -p "$APP_DIR/releases/$release"
rsync -az --delete \
  dist package.json package-lock.json .npmrc .nvmrc \
  "$DEPLOY_HOST:$APP_DIR/releases/$release/"

# 3. Install, switch, migrate, restart. A failed migration switches back before any restart.
say "Install, migrate and restart"
remote bash -s -- "$APP_DIR" "$release" "$KEEP_RELEASES" <<'REMOTE'
set -euo pipefail
app="$1"; release="$2"; keep="$3"
cd "$app/releases/$release"
[[ "$(node -v)" == v24.* ]] || { echo "server Node is $(node -v), need 24" >&2; exit 1; }
npm ci --omit=dev --no-audit --no-fund --loglevel=error

previous="$(readlink "$app/current" || true)"
ln -sfn "releases/$release" "$app/current.next"
mv -T "$app/current.next" "$app/current"

if ! sudo -n /usr/bin/systemctl start picplease-migrate.service; then
  echo "migration failed; current switched back, API not restarted" >&2
  echo "see: journalctl -u picplease-migrate -n 50" >&2
  if [[ -n "$previous" ]]; then
    ln -sfn "$previous" "$app/current.next"
    mv -T "$app/current.next" "$app/current"
  fi
  exit 1
fi
sudo -n /usr/bin/systemctl restart picplease-api.service

# Keep the newest releases; never remove the live one.
live="$(basename "$(readlink "$app/current")")"
cd "$app/releases"
{ ls -1 | sort -t_ -k2 -r | grep -vx "$live" || true; } | tail -n +"$keep" |
  while read -r old; do rm -rf -- "$old"; done
REMOTE

# 4. Confirm the new build is live.
say "Check $HEALTH_URL"
check_health "$commit"
