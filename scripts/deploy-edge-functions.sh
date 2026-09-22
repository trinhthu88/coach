#!/bin/bash
# Deploy every repository edge function to the production project.
#
# Edge functions, like migrations, reach production only when someone runs
# this: Replit deploys the built frontend and nothing else. That gap is how
# production ended up serving a function set older than the repository --
# admin-provision-user missing while the frontend already called it, and four
# functions that no longer exist here still answering requests.
#
# Run from a clean `main` checkout, the deployment branch (CONTRIBUTING.md).
#
#   scripts/deploy-edge-functions.sh                 # deploy the repo's functions
#   scripts/deploy-edge-functions.sh --list          # show what would change, deploy nothing
#   scripts/deploy-edge-functions.sh --delete-retired  # also remove functions the repo dropped
#
# Authentication: `supabase login`, or SUPABASE_ACCESS_TOKEN in the
# environment. A token that cannot read the project's function list is
# rejected here rather than half way through deploying.
set -euo pipefail

cd "$(dirname "$0")/.."

PROJECT_REF="$(sed -n 's/^project_id = "\(.*\)"/\1/p' supabase/config.toml)"
FUNCTIONS_URL="https://${PROJECT_REF}.supabase.co/functions/v1"
SUPABASE_BIN="${SUPABASE_BIN:-supabase}"

mode="deploy"
delete_retired=0
for arg in "$@"; do
  case "$arg" in
    --list) mode="list" ;;
    --delete-retired) delete_retired=1 ;;
    *) echo "unknown argument: $arg" >&2; exit 2 ;;
  esac
done

# Functions the repository ships. Every one must be declared in config.toml:
# an undeclared function deploys with verify_jwt defaulted, which would change
# who may call it.
repo_functions=()
while IFS= read -r name; do repo_functions+=("$name"); done < <(
  find supabase/functions -mindepth 1 -maxdepth 1 -type d -not -name '_*' -printf '%f\n' | sort
)

undeclared=()
for fn in "${repo_functions[@]}"; do
  grep -q "^  \[functions\.${fn}\]$" supabase/config.toml || undeclared+=("$fn")
done
if [ ${#undeclared[@]} -gt 0 ]; then
  echo "STOP: not declared in supabase/config.toml: ${undeclared[*]}" >&2
  echo "Add [functions.<name>] with its verify_jwt before deploying." >&2
  exit 1
fi

branch="$(git rev-parse --abbrev-ref HEAD)"
if [ "$branch" != "main" ]; then
  echo "STOP: on '$branch'. Edge functions deploy from main only (CONTRIBUTING.md)." >&2
  exit 1
fi
if [ -n "$(git status --porcelain)" ]; then
  echo "STOP: working tree is dirty. Deploy exactly what is committed." >&2
  exit 1
fi

# Which functions answer today. A 404 means "not deployed"; anything else
# (200, 401) means the function exists.
deployed_state() {
  local fn="$1" code
  code="$(curl -s -o /dev/null -w '%{http_code}' -X OPTIONS "${FUNCTIONS_URL}/${fn}" \
    -H 'Origin: https://clariva.club' -H 'Access-Control-Request-Method: POST' || echo 000)"
  case "$code" in
    000) echo "unreachable" ;;
    404) echo "absent" ;;
    *)   echo "present" ;;
  esac
}

echo "project: ${PROJECT_REF}"
echo
echo "REPOSITORY FUNCTIONS"
for fn in "${repo_functions[@]}"; do
  state="$(deployed_state "$fn")"
  case "$state" in
    absent) echo "  $fn — MISSING in production, will be created" ;;
    *)      echo "  $fn — deployed, will be replaced with this checkout" ;;
  esac
done

# Functions still answering that this repository no longer defines. They are
# never removed implicitly: deleting one is irreversible and breaks any caller
# still using it.
retired=()
for fn in admin-bulk-invite-users invite-sponsor seed-demo-data seed-tasc-content; do
  [ -d "supabase/functions/$fn" ] && continue
  [ "$(deployed_state "$fn")" = "present" ] && retired+=("$fn")
done
if [ ${#retired[@]} -gt 0 ]; then
  echo
  echo "RETIRED, STILL DEPLOYED"
  for fn in "${retired[@]}"; do echo "  $fn"; done
  [ "$delete_retired" -eq 1 ] || echo "  (kept; pass --delete-retired to remove them)"
fi

if [ "$mode" = "list" ]; then
  echo
  echo "--list: nothing deployed."
  exit 0
fi

if [ -z "${SUPABASE_ACCESS_TOKEN:-}" ]; then
  "$SUPABASE_BIN" projects list >/dev/null 2>&1 || {
    echo >&2
    echo "STOP: not authenticated. Run 'supabase login', or export SUPABASE_ACCESS_TOKEN." >&2
    exit 1
  }
fi

echo
for fn in "${repo_functions[@]}"; do
  echo "--- deploying $fn"
  "$SUPABASE_BIN" functions deploy "$fn" --project-ref "$PROJECT_REF"
done

if [ "$delete_retired" -eq 1 ] && [ ${#retired[@]} -gt 0 ]; then
  echo
  for fn in "${retired[@]}"; do
    echo "--- deleting retired $fn"
    "$SUPABASE_BIN" functions delete "$fn" --project-ref "$PROJECT_REF"
  done
fi

echo
echo "VERIFY"
failed=0
for fn in "${repo_functions[@]}"; do
  state="$(deployed_state "$fn")"
  echo "  $fn — $state"
  [ "$state" = "present" ] || failed=1
done
if [ "$failed" -ne 0 ]; then
  echo "STOP: a repository function is still not answering." >&2
  exit 1
fi
echo
echo "All ${#repo_functions[@]} repository functions are deployed from $(git rev-parse --short HEAD)."
