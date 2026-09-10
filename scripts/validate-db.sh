#!/usr/bin/env bash
set -euo pipefail

# Docker-capable local validation only. No command in this script links to,
# resets, pushes to, or otherwise contacts a remote Supabase project.
readonly SUPABASE_CLI_VERSION="${SUPABASE_CLI_VERSION:-2.117.0}"
types_output="$(mktemp)"
snapshot_before="$(mktemp)"
snapshot_after="$(mktemp)"
snapshot_sql_file="$(mktemp)"
stack_started=false

supabase_cli() {
  npx --yes "supabase@${SUPABASE_CLI_VERSION}" "$@"
}

cleanup() {
  local exit_code=$?
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
supabase_cli start
stack_started=true
printf '%s\n' '==> Resetting local database, migrations, and configured seed data'
# `db reset --local` applies every migration and then supabase/seed.sql.
# PGOPTIONS is the seed's explicit local-only guard.
PGOPTIONS='-c app.seed_environment=local' supabase_cli db reset --local
printf '%s\n' '==> Running signed-client sponsor isolation test against local Supabase'
[[ -x supabase/tests/sponsor_isolation_test.mjs ]] || {
  printf '%s\n' 'sponsor_isolation_test.mjs must be executable' >&2
  exit 1
}
# Read credentials from the local stack only; never use linked-project env vars.
eval "$(supabase_cli status -o env)"
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
PGOPTIONS='-c app.seed_environment=local' supabase_cli db query --local --file supabase/seed.sql
supabase_cli db query --local --file "$snapshot_sql_file" > "$snapshot_after"
diff -u "$snapshot_before" "$snapshot_after"
PGOPTIONS='-c app.seed_environment=local' supabase_cli db query --local --file supabase/seed.sql
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
