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
database_test_output="$(mktemp)"
second_database_test_output="$(mktemp)"
isolation_test_output="$(mktemp)"
lint_output="$(mktemp)"
types_check_output="$(mktemp)"
tsc_output="$(mktemp)"
snapshot_diff_output="$(mktemp)"
third_seed_output="$(mktemp)"
second_seed_output="$(mktemp)"
targeted_auth_output="$(mktemp)"
targeted_isolation_output="$(mktemp)"
targeted_pg_output="$(mktemp)"
deployment2_test_output="$(mktemp)"
stack_started=false

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
  rm -f "$types_output" "$snapshot_before" "$snapshot_after" "$snapshot_sql_file" "$database_test_output" "$second_database_test_output" "$isolation_test_output" "$lint_output" "$types_check_output" "$tsc_output" "$snapshot_diff_output" "$third_seed_output" "$second_seed_output" "$targeted_auth_output" "$targeted_isolation_output" "$targeted_pg_output" "$deployment2_test_output"
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
# Read credentials from the local stack only; never use linked-project env vars.
eval "$(supabase_cli status -o env)"
export VITE_SUPABASE_URL="${API_URL:-http://127.0.0.1:54321}"
export VITE_SUPABASE_ANON_KEY="${ANON_KEY:?local anon key unavailable}"
export SUPABASE_SERVICE_ROLE_KEY="${SERVICE_ROLE_KEY:?local service key unavailable}"
printf '%s\n' '==> Normalizing local Auth fixture fields for GoTrue'
psql --no-psqlrc --set=ON_ERROR_STOP=1 \
  "${DB_URL:?local database URL unavailable}" <<'SQL'
UPDATE auth.users
SET
  confirmation_token = coalesce(confirmation_token, ''),
  recovery_token = coalesce(recovery_token, ''),
  email_change_token_new = coalesce(email_change_token_new, ''),
  email_change = coalesce(email_change, ''),
  phone_change = coalesce(phone_change, ''),
  phone_change_token = coalesce(phone_change_token, ''),
  email_change_token_current = coalesce(email_change_token_current, ''),
  reauthentication_token = coalesce(reauthentication_token, ''),
  raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb),
  raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb)
WHERE confirmation_token IS NULL
   OR recovery_token IS NULL
   OR email_change_token_new IS NULL
   OR email_change IS NULL
   OR phone_change IS NULL
   OR phone_change_token IS NULL
   OR email_change_token_current IS NULL
   OR reauthentication_token IS NULL
   OR raw_app_meta_data IS NULL
   OR raw_user_meta_data IS NULL;
SQL
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
  20260914071400 \
  20260914071401 \
  20260914071403 \
  20260914071405 \
  20260914071406 \
  20260914071407; do
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
if ! DEMO_AUTH_TEST_PASSWORD="CI-local-${GITHUB_RUN_ID:-${RANDOM}}-Password!" \
  node scripts/validate-local-auth.mjs >"$targeted_auth_output" 2>&1; then
  cat "$targeted_auth_output"
  if [[ "${GITHUB_ACTIONS:-}" == true ]]; then
    while IFS= read -r failure_line; do
      [[ -z "$failure_line" ]] && continue
      failure_line="${failure_line//'%'/'%25'}"
      failure_line="${failure_line//$'\r'/'%0D'}"
      failure_line="${failure_line//$'\n'/'%0A'}"
      printf '::error title=Targeted Auth validation::%s\n' "$failure_line"
    done < "$targeted_auth_output"
  fi
  exit 1
fi
if [[ "${TARGETED_PGTAP_ONLY:-false}" == true ]]; then
  printf '%s\n' '==> Targeted affected-suite validation only'
  if ! node supabase/tests/sponsor_isolation_test.mjs >"$targeted_isolation_output" 2>&1; then
    cat "$targeted_isolation_output"
    if [[ "${GITHUB_ACTIONS:-}" == true ]]; then
      while IFS= read -r failure_line; do
        [[ -z "$failure_line" ]] && continue
        failure_line="${failure_line//'%'/'%25'}"
        failure_line="${failure_line//$'\r'/'%0D'}"
        failure_line="${failure_line//$'\n'/'%0A'}"
        printf '::error title=Targeted sponsor isolation::%s\n' "$failure_line"
      done < "$targeted_isolation_output"
    fi
    exit 1
  fi
  if ! supabase_cli test db --local \
    supabase/tests/enrollment_actions_test.sql \
    supabase/tests/peer_booking_enrollment_test.sql \
    supabase/tests/enrollment_schedule_backfill_test.sql >"$targeted_pg_output" 2>&1; then
    cat "$targeted_pg_output"
    if [[ "${GITHUB_ACTIONS:-}" == true ]]; then
      while IFS= read -r failure_line; do
        [[ -z "$failure_line" ]] && continue
        failure_line="${failure_line//'%'/'%25'}"
        failure_line="${failure_line//$'\r'/'%0D'}"
        failure_line="${failure_line//$'\n'/'%0A'}"
        printf '::error title=Targeted pgTAP suites::%s\n' "$failure_line"
      done < "$targeted_pg_output"
    fi
    exit 1
  fi
  exit 0
fi
printf '%s\n' '==> Local/test backfill readiness report'
supabase_cli db query --local --file scripts/enrollment-backfill-readiness.sql
if ! node supabase/tests/sponsor_isolation_test.mjs >"$isolation_test_output" 2>&1; then
  cat "$isolation_test_output"
  if [[ "${GITHUB_ACTIONS:-}" == true ]]; then
    while IFS= read -r failure_line; do
      [[ -z "$failure_line" ]] && continue
      failure_line="${failure_line//'%'/'%25'}"
      failure_line="${failure_line//$'\r'/'%0D'}"
      failure_line="${failure_line//$'\n'/'%0A'}"
      printf '::error title=Sponsor isolation validation::%s\n' "$failure_line"
    done < "$isolation_test_output"
  fi
  exit 1
fi
printf '%s\n' '==> Running database tests'
if ! supabase_cli test db --local supabase/tests >"$database_test_output" 2>&1; then
  cat "$database_test_output"
  if [[ "${GITHUB_ACTIONS:-}" == true ]]; then
    while IFS= read -r failure_line; do
      failure_line="${failure_line//'%'/'%25'}"
      failure_line="${failure_line//$'\r'/'%0D'}"
      failure_line="${failure_line//$'\n'/'%0A'}"
      printf '::error title=Database validation::%s\n' "$failure_line"
    done < <(grep -E '(^| )(not ok|ERROR|Error|error|failed|Failed|have:|want:)( |:|$)' "$database_test_output" | head -150 || true)
    cp "$database_test_output" "${RUNNER_TEMP}/clariva-generated-types.ts"
  fi
  exit 1
fi
cat "$database_test_output"
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
if ! supabase_cli db query --local --file "$snapshot_sql_file" >"$snapshot_before" 2>"$snapshot_diff_output"; then
  cat "$snapshot_diff_output"
  if [[ "${GITHUB_ACTIONS:-}" == true ]]; then
    while IFS= read -r failure_line; do
      [[ -z "$failure_line" ]] && continue
      failure_line="${failure_line//'%'/'%25'}"
      failure_line="${failure_line//$'\r'/'%0D'}"
      failure_line="${failure_line//$'\n'/'%0A'}"
      printf '::error title=Initial snapshot query::%s\n' "$failure_line"
    done < "$snapshot_diff_output"
  fi
  exit 1
fi
printf '%s\n' '==> Re-running the guarded seed for idempotency'
if ! run_guarded_local_seed >"$second_seed_output" 2>&1; then
  cat "$second_seed_output"
  if [[ "${GITHUB_ACTIONS:-}" == true ]]; then
    while IFS= read -r failure_line; do
      [[ -z "$failure_line" ]] && continue
      failure_line="${failure_line//'%'/'%25'}"
      failure_line="${failure_line//$'\r'/'%0D'}"
      failure_line="${failure_line//$'\n'/'%0A'}"
      printf '::error title=Seed idempotency replay::%s\n' "$failure_line"
    done < "$second_seed_output"
  fi
  exit 1
fi
if ! supabase_cli db query --local --file "$snapshot_sql_file" >"$snapshot_after" 2>"$snapshot_diff_output"; then
  cat "$snapshot_diff_output"
  if [[ "${GITHUB_ACTIONS:-}" == true ]]; then
    while IFS= read -r failure_line; do
      [[ -z "$failure_line" ]] && continue
      failure_line="${failure_line//'%'/'%25'}"
      failure_line="${failure_line//$'\r'/'%0D'}"
      failure_line="${failure_line//$'\n'/'%0A'}"
      printf '::error title=Repeated snapshot query::%s\n' "$failure_line"
    done < "$snapshot_diff_output"
  fi
  exit 1
fi
if ! diff -u "$snapshot_before" "$snapshot_after" >"$snapshot_diff_output" 2>&1; then
  cat "$snapshot_diff_output"
  if [[ "${GITHUB_ACTIONS:-}" == true ]]; then
    while IFS= read -r failure_line; do
      [[ -z "$failure_line" ]] && continue
      failure_line="${failure_line//'%'/'%25'}"
      failure_line="${failure_line//$'\r'/'%0D'}"
      failure_line="${failure_line//$'\n'/'%0A'}"
      printf '::error title=Seed idempotency diff::%s\n' "$failure_line"
    done < "$snapshot_diff_output"
  fi
  exit 1
fi
if ! run_guarded_local_seed >"$third_seed_output" 2>&1; then
  cat "$third_seed_output"
  if [[ "${GITHUB_ACTIONS:-}" == true ]]; then
    while IFS= read -r failure_line; do
      [[ -z "$failure_line" ]] && continue
      failure_line="${failure_line//'%'/'%25'}"
      failure_line="${failure_line//$'\r'/'%0D'}"
      failure_line="${failure_line//$'\n'/'%0A'}"
      printf '::error title=Repeated seed replay::%s\n' "$failure_line"
    done < "$third_seed_output"
  fi
  exit 1
fi
if ! supabase_cli test db --local supabase/tests >"$second_database_test_output" 2>&1; then
  cat "$second_database_test_output"
  if [[ "${GITHUB_ACTIONS:-}" == true ]]; then
    while IFS= read -r failure_line; do
      [[ -z "$failure_line" ]] && continue
      failure_line="${failure_line//'%'/'%25'}"
      failure_line="${failure_line//$'\r'/'%0D'}"
      failure_line="${failure_line//$'\n'/'%0A'}"
      printf '::error title=Repeated database validation::%s\n' "$failure_line"
    done < "$second_database_test_output"
  fi
  exit 1
fi
cat "$second_database_test_output"
printf '%s\n' '==> Applying deployment 2 (supabase/deployment-2) and re-running database tests'
# Deployment 2 retires the legacy Triad storage after deployment 1 is
# verified in production. It is not in supabase/migrations, so a plain push
# of deployment 1 can never apply it; here it is applied on top of the
# replayed chain so both stages stay valid, and the generated types below are
# checked against the final (deployment 2) schema.
for deployment2_migration in supabase/deployment-2/*.sql; do
  if ! psql --no-psqlrc --set=ON_ERROR_STOP=1 --single-transaction \
    --file "$deployment2_migration" "${DB_URL:?local database URL unavailable}" >"$deployment2_test_output" 2>&1; then
    cat "$deployment2_test_output"
    [[ "${GITHUB_ACTIONS:-}" == true ]] && printf '::error title=Deployment 2 migration::%s failed\n' "$deployment2_migration"
    exit 1
  fi
done
if ! supabase_cli test db --local supabase/tests >"$deployment2_test_output" 2>&1; then
  cat "$deployment2_test_output"
  if [[ "${GITHUB_ACTIONS:-}" == true ]]; then
    while IFS= read -r failure_line; do
      [[ -z "$failure_line" ]] && continue
      failure_line="${failure_line//'%'/'%25'}"
      failure_line="${failure_line//$'\r'/'%0D'}"
      failure_line="${failure_line//$'\n'/'%0A'}"
      printf '::error title=Deployment 2 database validation::%s\n' "$failure_line"
    done < "$deployment2_test_output"
  fi
  exit 1
fi
cat "$deployment2_test_output"
printf '%s\n' '==> Running Deployment 2 post-retirement verification sequence'
if ! psql --no-psqlrc --set=ON_ERROR_STOP=1 \
  --file scripts/triad-deployment-2-post-retirement-verification.sql \
  "${DB_URL:?local database URL unavailable}" >"$deployment2_test_output" 2>&1; then
  cat "$deployment2_test_output"
  if [[ "${GITHUB_ACTIONS:-}" == true ]]; then
    printf '::error title=Deployment 2 post-retirement verification::failed\n'
  fi
  exit 1
fi
cat "$deployment2_test_output"
printf '%s\n' '==> Linting local database'
if ! supabase_cli db lint --local >"$lint_output" 2>&1; then
  cat "$lint_output"
  if [[ "${GITHUB_ACTIONS:-}" == true ]]; then
    while IFS= read -r failure_line; do
      [[ -z "$failure_line" ]] && continue
      failure_line="${failure_line//'%'/'%25'}"
      failure_line="${failure_line//$'\r'/'%0D'}"
      failure_line="${failure_line//$'\n'/'%0A'}"
      printf '::error title=Database lint::%s\n' "$failure_line"
    done < "$lint_output"
  fi
  exit 1
fi
cat "$lint_output"
printf '%s\n' '==> Checking generated Supabase TypeScript types'
if ! supabase_cli gen types typescript --local --schema public > "$types_output" 2>"$types_check_output"; then
  cat "$types_check_output"
  if [[ "${GITHUB_ACTIONS:-}" == true ]]; then
    while IFS= read -r failure_line; do
      [[ -z "$failure_line" ]] && continue
      failure_line="${failure_line//'%'/'%25'}"
      failure_line="${failure_line//$'\r'/'%0D'}"
      failure_line="${failure_line//$'\n'/'%0A'}"
      printf '::error title=Supabase type generation::%s\n' "$failure_line"
    done < "$types_check_output"
  fi
  exit 1
fi
if [[ "${GITHUB_ACTIONS:-}" == true ]]; then
  cp "$types_output" "${RUNNER_TEMP}/clariva-generated-types.ts"
fi
if ! diff -u src/integrations/supabase/types.ts "$types_output" >"$types_check_output" 2>&1; then
  cat "$types_check_output"
  if [[ "${GITHUB_ACTIONS:-}" == true ]]; then
    while IFS= read -r failure_line; do
      [[ -z "$failure_line" ]] && continue
      failure_line="${failure_line//'%'/'%25'}"
      failure_line="${failure_line//$'\r'/'%0D'}"
      failure_line="${failure_line//$'\n'/'%0A'}"
      printf '::error title=Generated Supabase types differ::%s\n' "$failure_line"
    done < "$types_check_output"
  fi
  exit 1
fi
printf '%s\n' '==> Running TypeScript checks'
if ! npx tsc --noEmit >"$tsc_output" 2>&1; then
  cat "$tsc_output"
  if [[ "${GITHUB_ACTIONS:-}" == true ]]; then
    while IFS= read -r failure_line; do
      [[ -z "$failure_line" ]] && continue
      failure_line="${failure_line//'%'/'%25'}"
      failure_line="${failure_line//$'\r'/'%0D'}"
      failure_line="${failure_line//$'\n'/'%0A'}"
      printf '::error title=TypeScript check::%s\n' "$failure_line"
    done < "$tsc_output"
  fi
  exit 1
fi
cat "$tsc_output"
printf '%s\n' '==> Running lint'
if ! npm run lint >"$tsc_output" 2>&1; then
  cat "$tsc_output"
  if [[ "${GITHUB_ACTIONS:-}" == true ]]; then
    while IFS= read -r failure_line; do
      [[ -z "$failure_line" ]] && continue
      failure_line="${failure_line//'%'/'%25'}"
      failure_line="${failure_line//$'\r'/'%0D'}"
      failure_line="${failure_line//$'\n'/'%0A'}"
      printf '::error title=Application lint::%s\n' "$failure_line"
    done < "$tsc_output"
  fi
  exit 1
fi
cat "$tsc_output"
printf '%s\n' '==> Running application tests'
if ! npm run test >"$tsc_output" 2>&1; then
  cat "$tsc_output"
  if [[ "${GITHUB_ACTIONS:-}" == true ]]; then
    while IFS= read -r failure_line; do
      [[ -z "$failure_line" ]] && continue
      failure_line="${failure_line//'%'/'%25'}"
      failure_line="${failure_line//$'\r'/'%0D'}"
      failure_line="${failure_line//$'\n'/'%0A'}"
      printf '::error title=Application tests::%s\n' "$failure_line"
    done < "$tsc_output"
  fi
  exit 1
fi
cat "$tsc_output"
printf '%s\n' '==> Building production frontend'
if ! npm run build >"$tsc_output" 2>&1; then
  cat "$tsc_output"
  if [[ "${GITHUB_ACTIONS:-}" == true ]]; then
    while IFS= read -r failure_line; do
      [[ -z "$failure_line" ]] && continue
      failure_line="${failure_line//'%'/'%25'}"
      failure_line="${failure_line//$'\r'/'%0D'}"
      failure_line="${failure_line//$'\n'/'%0A'}"
      printf '::error title=Production build::%s\n' "$failure_line"
    done < "$tsc_output"
  fi
  exit 1
fi
cat "$tsc_output"
