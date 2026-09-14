#!/usr/bin/env bash
set -euo pipefail

# Docker-capable local validation only. No command in this script links to,
# resets, pushes to, or otherwise contacts a remote Supabase project.
readonly SUPABASE_CLI_VERSION="${SUPABASE_CLI_VERSION:-2.117.0}"
readonly SUPABASE_CLI_BIN="${SUPABASE_CLI_BIN:-}"
types_output="$(mktemp)"
snapshot_before="$(mktemp)"
snapshot_after="$(mktemp)"
snapshot_sql_file="$(mktemp)"
diagnostic_log=""
stack_started=false
if [[ -n "${RUNNER_TEMP:-}" ]]; then
  diagnostic_log="${RUNNER_TEMP}/database-validation.log"
  exec >"${diagnostic_log}" 2>&1
fi

supabase_cli() {
  if [[ -n "$SUPABASE_CLI_BIN" ]]; then
    "$SUPABASE_CLI_BIN" "$@"
  elif [[ -x "$PWD/.local/bin/supabase" ]]; then
    "$PWD/.local/bin/supabase" "$@"
  elif command -v supabase >/dev/null 2>&1; then
    supabase "$@"
  else
    npx --yes "supabase@${SUPABASE_CLI_VERSION}" "$@"
  fi
}

run_guarded_local_seed() {
  PGOPTIONS='-c app.seed_environment=local' \
    psql --no-psqlrc --set=ON_ERROR_STOP=1 \
      --file supabase/seed.sql \
      "${DB_URL:?local database URL unavailable}"
}

cleanup() {
  local exit_code=$?
  if [[ "$exit_code" -ne 0 && -n "$diagnostic_log" ]]; then
    cp "$diagnostic_log" "${RUNNER_TEMP}/clariva-generated-types.ts" || true
  fi
  rm -f "$types_output" "$snapshot_before" "$snapshot_after" "$snapshot_sql_file"
  if [[ "$stack_started" == true ]]; then
    supabase_cli stop --no-backup || true
  fi
  exit "$exit_code"
}
trap cleanup EXIT

printf '%s\n' '==> Supabase CLI version'
supabase_cli --version
printf '%s\n' '==> Starting local Supabase'
PGOPTIONS='-c app.seed_environment=local' supabase_cli start
stack_started=true
printf '%s\n' '==> Resetting local database, migrations, and configured seed data'
# `db reset --local` applies every migration and then supabase/seed.sql.
# PGOPTIONS is the seed's explicit local-only guard.
PGOPTIONS='-c app.seed_environment=local' supabase_cli db reset --local
printf '%s\n' '==> Local/test backfill readiness report'
supabase_cli db query --local --file scripts/enrollment-backfill-readiness.sql
printf '%s\n' '==> Running signed-client sponsor isolation test against local Supabase'
[[ -x supabase/tests/sponsor_isolation_test.mjs ]] || {
  printf '%s\n' 'sponsor_isolation_test.mjs must be executable' >&2
  exit 1
}
# Read credentials from the local stack only; never use linked-project env vars.
eval "$(supabase_cli status -o env)"
expected_migrations="$(find supabase/migrations -maxdepth 1 -type f -name '*.sql' | wc -l | tr -d ' ')"
applied_migrations="$(psql --no-psqlrc --set=ON_ERROR_STOP=1 -Atqc \
  'SELECT count(*) FROM supabase_migrations.schema_migrations' \
  "${DB_URL:?local database URL unavailable}")"
if [[ "$applied_migrations" != "$expected_migrations" ]]; then
  printf 'Migration replay count mismatch: expected %s, applied %s\n' \
    "$expected_migrations" "$applied_migrations" >&2
  exit 1
fi
for migration_version in \
  20260912090000 \
  20260912100000 \
  20260912110000 \
  20260912120000 \
  20260912130000 \
  20260912140000; do
  psql --no-psqlrc --set=ON_ERROR_STOP=1 -Atqc \
    "SELECT 1 FROM supabase_migrations.schema_migrations WHERE version LIKE '${migration_version}%'" \
    "${DB_URL:?local database URL unavailable}" | grep -qx '1' || {
      printf 'Required P0/P1 migration was not recorded: %s\n' "$migration_version" >&2
      exit 1
    }
done
printf 'Migration replay verified: %s/%s repository migrations applied\n' \
  "$applied_migrations" "$expected_migrations"
if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
  {
    printf 'migration_count=%s\n' "$applied_migrations"
    printf 'migration_replay=passed\n'
  } >> "$GITHUB_OUTPUT"
fi
printf '%s\n' '==> Validating local demo Auth users'
DEMO_AUTH_TEST_PASSWORD="CI-local-${GITHUB_RUN_ID:-${RANDOM}}-Password!" \
  node scripts/validate-local-auth.mjs
VITE_SUPABASE_URL="${API_URL:-http://127.0.0.1:54321}" \
VITE_SUPABASE_ANON_KEY="${ANON_KEY:?local anon key unavailable}" \
SUPABASE_SERVICE_ROLE_KEY="${SERVICE_ROLE_KEY:?local service key unavailable}" \
  node supabase/tests/sponsor_isolation_test.mjs
printf '%s\n' '==> Running database tests'
supabase_cli test db --local supabase/tests
cat > "$snapshot_sql_file" <<'SQL'
SELECT table_name, row_count, md5(ids) AS id_hash
FROM (
  SELECT 'auth_users' AS table_name, count(*) AS row_count,
    string_agg(id::text, ',' ORDER BY id) AS ids FROM auth.users
  UNION ALL SELECT 'users', count(*), string_agg(id::text, ',' ORDER BY id) FROM public.profiles
  UNION ALL SELECT 'roles', count(*), string_agg((user_id::text||':'||role::text), ',' ORDER BY user_id,role) FROM public.user_roles
  UNION ALL SELECT 'coach_profiles', count(*), string_agg(id::text, ',' ORDER BY id) FROM public.coach_profiles
  UNION ALL SELECT 'mentor_profiles', count(*), string_agg(coach_user_id::text, ',' ORDER BY coach_user_id) FROM public.mentor_profiles
  UNION ALL SELECT 'programmes', count(*), string_agg(id::text, ',' ORDER BY id) FROM public.programmes
  UNION ALL SELECT 'cohorts', count(*), string_agg(id::text, ',' ORDER BY id) FROM public.cohorts
  UNION ALL SELECT 'enrollments', count(*), string_agg(id::text, ',' ORDER BY id) FROM public.programme_enrollments
  UNION ALL SELECT 'sessions', count(*), string_agg(id::text, ',' ORDER BY id) FROM public.sessions
  UNION ALL SELECT 'goals', count(*), string_agg(id::text, ',' ORDER BY id) FROM public.coachee_goals
  UNION ALL SELECT 'checkins', count(*), string_agg(id::text, ',' ORDER BY id) FROM public.goal_checkins
  UNION ALL SELECT 'actions', count(*), string_agg(id::text, ',' ORDER BY id) FROM public.enrollment_actions
  UNION ALL SELECT 'training', count(*), string_agg(id::text, ',' ORDER BY id) FROM public.training_progress
  UNION ALL SELECT 'assignments', count(*), string_agg(id::text, ',' ORDER BY id) FROM public.assignments
  UNION ALL SELECT 'assignment_submissions', count(*), string_agg(id::text, ',' ORDER BY id) FROM public.assignment_submissions
  UNION ALL SELECT 'daily_prompts', count(*), string_agg(id::text, ',' ORDER BY id) FROM public.daily_prompts
  UNION ALL SELECT 'daily_prompt_responses', count(*), string_agg(id::text, ',' ORDER BY id) FROM public.daily_prompt_responses
  UNION ALL SELECT 'reflections', count(*), string_agg(id::text, ',' ORDER BY id) FROM public.programme_reflections
  UNION ALL SELECT 'reflection_submissions', count(*), string_agg(id::text, ',' ORDER BY id) FROM public.reflection_submissions
  UNION ALL SELECT 'schedule_snapshots', count(*), string_agg(id::text, ',' ORDER BY id) FROM public.enrollment_module_snapshots
  UNION ALL SELECT 'schedule_milestones', count(*), string_agg(id::text, ',' ORDER BY id) FROM public.enrollment_module_milestones
  UNION ALL SELECT 'peer', count(*), string_agg(id::text, ',' ORDER BY id) FROM public.peer_sessions
  UNION ALL SELECT 'mentor', count(*), string_agg(id::text, ',' ORDER BY id) FROM public.mentoring_sessions
  UNION ALL SELECT 'triad', count(*), string_agg(id::text, ',' ORDER BY id) FROM public.triad_sessions
  UNION ALL SELECT 'private_notes', count(*), string_agg(session_id::text, ',' ORDER BY session_id) FROM public.coach_session_private_notes
) s GROUP BY table_name, row_count, ids ORDER BY table_name;
SQL
supabase_cli db query --local --file "$snapshot_sql_file" > "$snapshot_before"
printf '%s\n' '==> Re-running the guarded seed for idempotency'
run_guarded_local_seed
supabase_cli db query --local --file "$snapshot_sql_file" > "$snapshot_after"
diff -u "$snapshot_before" "$snapshot_after"
run_guarded_local_seed
supabase_cli test db --local supabase/tests
printf '%s\n' '==> Linting local database'
supabase_cli db lint --local
printf '%s\n' '==> Checking generated Supabase TypeScript types'
supabase_cli gen types typescript --local --schema public > "$types_output"
if [[ "${GITHUB_ACTIONS:-}" == true ]]; then
  cp "$types_output" "${RUNNER_TEMP}/clariva-generated-types.ts"
fi
diff -u src/integrations/supabase/types.ts "$types_output"
printf '%s\n' '==> Running TypeScript checks'
npx tsc --noEmit
printf '%s\n' '==> Running lint'
npm run lint
printf '%s\n' '==> Running application tests'
npm run test
printf '%s\n' '==> Building production frontend'
npm run build
