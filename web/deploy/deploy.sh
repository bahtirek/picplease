#!/usr/bin/env bash
# Deploys the committed helper page to the VPS. Run from web/ on the owner's machine:
#   npm run deploy                  test and build HEAD, upload, switch, check /version.json
#   npm run deploy -- rollback      point current at the previous release
#   npm run deploy -- rollback <release-name>
# Settings (environment): DEPLOY_HOST (default deploy@api.picplease.app, the same VPS),
#   VERSION_URL (default https://picplease.app/version.json).
# One-time server setup and details: docs/web/deploy.md.
set -euo pipefail

DEPLOY_HOST="${DEPLOY_HOST:-deploy@api.picplease.app}"
VERSION_URL="${VERSION_URL:-https://picplease.app/version.json}"
WEB_DIR=/var/www/picplease.app
KEEP_RELEASES=5

cd "$(dirname "$0")/.."

say() { printf '==> %s\n' "$*"; }
fail() { printf 'deploy: %s\n' "$*" >&2; exit 1; }

remote() { ssh -o BatchMode=yes "$DEPLOY_HOST" "$@"; }

# Waits until /version.json reports the expected commit (Nginx serves new files at once).
check_live() {
  local want="$1" body=""
  for _ in $(seq 1 10); do
    body="$(curl -fsS --max-time 5 "$VERSION_URL" 2>/dev/null || true)"
    if [[ "$body" == *"\"commit\":\"$want\""* ]]; then
      say "Live: $body"
      return 0
    fi
    sleep 2
  done
  fail "$VERSION_URL does not show $want (last answer: ${body:-none})"
}

rollback() {
  local target="${1:-}"
  say "Rolling back on $DEPLOY_HOST"
  local commit
  commit="$(remote bash -s -- "$WEB_DIR" "$target" <<'REMOTE'
set -euo pipefail
web="$1"; target="$2"
cd "$web/releases"
current="$(basename "$(readlink "$web/current")")"
if [[ -z "$target" ]]; then
  # The release just before the current one (names are <commit>_<UTC time>).
  target="$(ls -1 | sort -t_ -k2 | awk -v c="$current" '$0 == c { print prev; exit } { prev = $0 }')"
fi
[[ -n "$target" && -d "$target" ]] || { echo "no release to roll back to" >&2; exit 1; }
ln -sfn "releases/$target" "$web/current.next"
mv -T "$web/current.next" "$web/current"
echo "${target%%_*}"
REMOTE
)"
  say "Rolled back to $commit"
  check_live "$commit"
}

if [[ "${1:-}" == "rollback" ]]; then
  rollback "${2:-}"
  exit 0
fi
[[ $# -eq 0 ]] || fail "unknown arguments: $*"

# 1. Test and build locally from a clean, committed tree (production values: .env.production).
[[ "$(node -v)" == v24.* ]] || fail "Node 24 required (found $(node -v))"
[[ -z "$(git status --porcelain)" ]] || fail "working tree is not clean; commit first"
[[ ! -e .env.production.local && ! -e .env.local ]] || \
  fail ".env.local or .env.production.local would override production values; move it away"
commit="$(git rev-parse --short HEAD)"
release="${commit}_$(date -u +%Y%m%dT%H%M%SZ)"

say "Lint, test and build $commit"
npm run --silent lint
npm test --silent
npm run --silent build
printf '{"commit":"%s","builtAt":"%s"}\n' "$commit" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > dist/version.json
grep -q 'https://api.picplease.app' dist/assets/*.js || fail "build does not point at https://api.picplease.app"

# 2. Upload the release (static files only).
say "Upload release $release to $DEPLOY_HOST"
remote mkdir -p "$WEB_DIR/releases/$release"
rsync -az --delete --chmod=D755,F644 dist/ "$DEPLOY_HOST:$WEB_DIR/releases/$release/"

# 3. Switch current atomically, then prune old releases (never the live one).
say "Switch to $release"
remote bash -s -- "$WEB_DIR" "$release" "$KEEP_RELEASES" <<'REMOTE'
set -euo pipefail
web="$1"; release="$2"; keep="$3"
ln -sfn "releases/$release" "$web/current.next"
mv -T "$web/current.next" "$web/current"
live="$(basename "$(readlink "$web/current")")"
cd "$web/releases"
{ ls -1 | sort -t_ -k2 -r | grep -vx "$live" || true; } | tail -n +"$keep" |
  while read -r old; do rm -rf -- "$old"; done
REMOTE

# 4. Confirm the new build is live.
say "Check $VERSION_URL"
check_live "$commit"
