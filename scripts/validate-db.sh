#!/usr/bin/env bash
set -euo pipefail

# Docker-capable local validation only. No command in this script links to,
# resets, pushes to, or otherwise contacts a remote Supabase project.
readonly SUPABASE_CLI_VERSION="${SUPABASE_CLI_VERSION:-2.117.0}"
types_output="$(mktemp)"
stack_started=false

supabase_cli() {
  npx --yes "supabase@${SUPABASE_CLI_VERSION}" "$@"
}

cleanup() {
  local exit_code=$?
  rm -f "$types_output"
  if [[ "$stack_started" == true ]]; then
    supabase_cli stop --no-backup || true
  fi
  exit "$exit_code"
}
trap cleanup EXIT

printf '%s\n' '==> Supabase CLI version'
supabase_cli --version
printf '%s\n' '==> Starting local Supabase'
supabase_cli start
stack_started=true
printf '%s\n' '==> Resetting local database, migrations, and configured seed data'
# `db reset --local` applies every migration in filename order and then the
# repository's configured local seed file, if present. This project currently
# keeps its fixture seed data as forward migrations.
supabase_cli db reset --local
printf '%s\n' '==> Running database tests'
supabase_cli test db --local supabase/tests
printf '%s\n' '==> Linting local database'
supabase_cli db lint --local
printf '%s\n' '==> Checking generated Supabase TypeScript types'
supabase_cli gen types typescript --local --schema public > "$types_output"
diff -u src/integrations/supabase/types.ts "$types_output"
printf '%s\n' '==> Running TypeScript checks'
npx tsc --noEmit
printf '%s\n' '==> Running lint'
npm run lint
printf '%s\n' '==> Running application tests'
npm run test
printf '%s\n' '==> Building production frontend'
npm run build
