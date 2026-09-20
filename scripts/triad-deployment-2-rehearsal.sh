#!/usr/bin/env bash
set -euo pipefail

# Isolated Deployment 2 rehearsal.
#
# This script only accepts a loopback PostgreSQL URL. It snapshots a local
# pre-retirement database, restores that snapshot before each scenario, and
# runs fault-injected copies of the standalone candidate where a scenario
# requires an internal failure. It never links, pushes, or connects to a
# remote Supabase project.
#
# Usage:
#   REHEARSAL_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres \
#     scripts/triad-deployment-2-rehearsal.sh

readonly CANDIDATE="supabase/deployment-2/20260919190000_triad_retire_legacy.sql"
readonly POST_VERIFY="scripts/triad-deployment-2-post-retirement-verification.sql"
readonly FIXTURE="${REHEARSAL_FIXTURE_SQL:-scripts/triad-deployment-2-rehearsal-fixture.sql}"
readonly MIGRATION_ID="20260919190000_triad_retire_legacy"
readonly WORK_DIR="$(mktemp -d)"
readonly BASE_DUMP="$WORK_DIR/pre-deployment-2.dump"
readonly CANDIDATE_COPY="$WORK_DIR/candidate.sql"
readonly LOG_FILE="$WORK_DIR/psql.log"
readonly SNAPSHOT_BEFORE="$WORK_DIR/snapshot-before"
readonly SNAPSHOT_AFTER="$WORK_DIR/snapshot-after"

cleanup() {
  rm -rf "$WORK_DIR"
}
trap cleanup EXIT

readonly DB_URL="${REHEARSAL_DB_URL:?set REHEARSAL_DB_URL to an isolated local PostgreSQL database}"
case "$DB_URL" in
  *127.0.0.1*|*localhost*) ;;
  *)
    echo "Refusing non-loopback REHEARSAL_DB_URL; production is not a rehearsal target." >&2
    exit 1
    ;;
esac

psql_local() {
  psql --no-psqlrc -X -v ON_ERROR_STOP=1 "$DB_URL" "$@"
}

if [[ "${REHEARSAL_BOOTSTRAP_FIXTURE:-false}" == true ]]; then
  psql_local --file "$FIXTURE"
fi

dump_args() {
  printf '%s\n' \
    --table=public.triad_groups \
    --table=public.triad_sessions \
    --table=public.triad_alternative_proposals \
    --table=public.triad_reflections \
    --table=public.triad_rounds \
    --table=public.programme_triad_rounds \
    --table=public.triad_cutover_archive
}

snapshot() {
  local output="$1"
  : > "$output"
  {
    echo "== schema"
    pg_dump --no-owner --no-acl --schema-only \
      $(dump_args) "$DB_URL" | sed -E '/^\\(un)?restrict /d'
    echo "== data"
    pg_dump --no-owner --no-acl --data-only --inserts \
      $(dump_args) "$DB_URL" | sed -E '/^\\(un)?restrict /d'
  } > "$output"
  sha256sum "$output" | cut -d' ' -f1
}

restore_base() {
  pg_restore --clean --if-exists --exit-on-error --no-owner --no-acl \
    --dbname "$DB_URL" "$BASE_DUMP" >/dev/null
}

make_candidate() {
  local mode="$1"
  local output="$2"
  cp "$CANDIDATE" "$output"
  case "$mode" in
    original) ;;
    missing-archive)
      perl -0pi -e \
        "s|-- REHEARSAL_AFTER_ARCHIVE_BOUNDARY|DELETE FROM public.triad_cutover_archive WHERE ctid IN (SELECT ctid FROM public.triad_cutover_archive WHERE object_name = 'triad_groups.legacy' LIMIT 1);\\n-- REHEARSAL_AFTER_ARCHIVE_BOUNDARY|" \
        "$output"
      ;;
    failure-after-archive)
      perl -0pi -e \
        "s|-- REHEARSAL_AFTER_ARCHIVE_BOUNDARY|DO \\\$\\\$ BEGIN RAISE EXCEPTION 'rehearsal injected failure after archive creation'; END \\\$\\\$;\\n-- REHEARSAL_AFTER_ARCHIVE_BOUNDARY|" \
        "$output"
      ;;
    failure-during-destructive)
      perl -0pi -e \
        "s|-- REHEARSAL_DESTRUCTIVE_BOUNDARY|RAISE EXCEPTION 'rehearsal injected failure during destructive changes';|" \
        "$output"
      ;;
    *)
      echo "Unknown rehearsal candidate mode: $mode" >&2
      exit 1
      ;;
  esac
}

run_candidate() {
  local mode="$1"
  make_candidate "$mode" "$CANDIDATE_COPY"
  if ! psql_local --file "$CANDIDATE_COPY" >"$LOG_FILE" 2>&1; then
    cat "$LOG_FILE" >&2
    return 1
  fi
}

run_post_verify() {
  if ! psql_local --file "$POST_VERIFY" >"$LOG_FILE" 2>&1; then
    cat "$LOG_FILE" >&2
    return 1
  fi
}

expect_candidate_failure() {
  local mode="$1"
  local expected_pattern="${2:-rehearsal injected failure|archive rows are missing or stale|archive conflicts differ}"
  if run_candidate "$mode"; then
    cat "$LOG_FILE"
    echo "Expected Deployment 2 rehearsal failure did not occur: $mode" >&2
    exit 1
  fi
  grep -Eq "$expected_pattern" "$LOG_FILE" || {
    cat "$LOG_FILE"
    echo "Unexpected failure reason for rehearsal mode: $mode" >&2
    exit 1
  }
}

assert_rollback() {
  local before="$1"
  local after="$WORK_DIR/current-snapshot"
  local before_hash
  local after_hash
  before_hash="$(sha256sum "$before" | cut -d' ' -f1)"
  after_hash="$(snapshot "$after")"
  if [[ "$before_hash" != "$after_hash" ]]; then
    diff -u "$before" "$after" || true
    echo "Failed rehearsal transaction changed the isolated database." >&2
    exit 1
  fi
}

require_base() {
  local legacy_count archive_count group_count
  legacy_count="$(psql_local -Atqc "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('triad_rounds','programme_triad_rounds');")"
  archive_count="$(psql_local -Atqc "SELECT count(*) FROM public.triad_cutover_archive WHERE migration_id = '$MIGRATION_ID';")"
  group_count="$(psql_local -Atqc "SELECT count(*) FROM public.triad_groups;")"
  [[ "$legacy_count" == "2" ]] || { echo "Rehearsal database is not pre-Deployment-2." >&2; exit 1; }
  [[ "$archive_count" == "0" ]] || { echo "Rehearsal database already contains Deployment 2 archive rows." >&2; exit 1; }
  [[ "$group_count" -gt 0 ]] || { echo "Rehearsal requires at least one seeded triad group." >&2; exit 1; }
}

echo "== Snapshotting isolated pre-Deployment-2 database"
require_base
pg_dump --format=custom --no-owner --no-acl "$DB_URL" > "$BASE_DUMP"

echo "== Scenario 1/8: happy path"
restore_base
run_candidate original
run_post_verify
echo "passed: happy path and required post-retirement verification"

echo "== Scenario 2/8: correct pre-existing archive row"
restore_base
psql_local <<'SQL'
INSERT INTO public.triad_cutover_archive (object_name, record_id, payload, migration_id)
SELECT
  'triad_groups.legacy',
  g.id,
  jsonb_build_object(
    'cohort_id', g.cohort_id, 'programme_id', g.programme_id, 'name', g.name,
    'round_number', g.round_number, 'triad_round_id', g.triad_round_id,
    'member_1_id', g.member_1_id, 'member_2_id', g.member_2_id,
    'member_3_id', g.member_3_id, 'enrollment_1_id', g.enrollment_1_id,
    'enrollment_2_id', g.enrollment_2_id, 'enrollment_3_id', g.enrollment_3_id
  ),
  '20260919190000_triad_retire_legacy'
FROM public.triad_groups g
ORDER BY g.id
LIMIT 1;
SQL
run_candidate original
run_post_verify
echo "passed: correct pre-existing archive row"

echo "== Scenario 3/8: stale archive conflict"
restore_base
psql_local <<'SQL'
INSERT INTO public.triad_cutover_archive (object_name, record_id, payload, migration_id)
SELECT 'triad_groups.legacy', g.id, '{"stale": true}'::jsonb,
       '20260919190000_triad_retire_legacy'
FROM public.triad_groups g
ORDER BY g.id
LIMIT 1;
SQL
before_hash="$(snapshot "$SNAPSHOT_BEFORE")"
expect_candidate_failure original
assert_rollback "$SNAPSHOT_BEFORE"
echo "passed: stale archive conflict and rollback ($before_hash)"

echo "== Scenario 4/8: missing archive row during validation"
restore_base
before_hash="$(snapshot "$SNAPSHOT_BEFORE")"
expect_candidate_failure missing-archive
assert_rollback "$SNAPSHOT_BEFORE"
echo "passed: missing archive row and rollback ($before_hash)"

echo "== Scenario 5/8: failure after archive creation"
restore_base
before_hash="$(snapshot "$SNAPSHOT_BEFORE")"
expect_candidate_failure failure-after-archive
assert_rollback "$SNAPSHOT_BEFORE"
echo "passed: failure after archive creation and rollback ($before_hash)"

echo "== Scenario 6/8: failure during destructive changes"
restore_base
before_hash="$(snapshot "$SNAPSHOT_BEFORE")"
expect_candidate_failure failure-during-destructive
assert_rollback "$SNAPSHOT_BEFORE"
echo "passed: failure during destructive changes and rollback ($before_hash)"

echo "== Scenario 7/8: complete transaction rollback"
restore_base
before_hash="$(snapshot "$SNAPSHOT_BEFORE")"
expect_candidate_failure failure-during-destructive
after_hash="$(snapshot "$SNAPSHOT_AFTER")"
[[ "$before_hash" == "$after_hash" ]] || {
  diff -u "$SNAPSHOT_BEFORE" "$SNAPSHOT_AFTER" || true
  echo "Complete rollback fingerprint mismatch." >&2
  exit 1
}
echo "passed: complete transaction rollback ($before_hash)"

echo "== Scenario 8/8: deterministic retry after rollback"
restore_base
expect_candidate_failure failure-after-archive
run_candidate original
run_post_verify
echo "passed: deterministic retry after rollback"

echo "== Guard negative case: external dependency remains a hard failure"
restore_base
psql_local <<'SQL'
CREATE VIEW public.external_triad_retirement_dependency AS
SELECT member_1_id FROM public.triad_groups;
SQL
before_hash="$(snapshot "$SNAPSHOT_BEFORE")"
expect_candidate_failure original 'unexpected dependencies remain'
assert_rollback "$SNAPSHOT_BEFORE"
echo "passed: external dependency rejected and transaction rolled back ($before_hash)"

echo "Deployment 2 isolated rehearsal passed: 8/8 scenarios"