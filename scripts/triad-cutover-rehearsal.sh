#!/usr/bin/env bash
# Deployment-1 rehearsal on legacy Triad data. Needs a LOCAL database at the
# production state (supabase/migrations applied up to 20260918180000), e.g.:
#   supabase db reset --local --version 20260918180000 --no-seed
#   REHEARSAL_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres scripts/triad-cutover-rehearsal.sh
# Everything runs in one transaction and is rolled back.
#   pass 1: legacy fixture (DEMO/SEED conflicts, real groups, duplicates,
#           regrouping, same-time genuine sessions) -> deployment 1 -> assertions
#   pass 2: + a REAL/UNKNOWN conflicting group -> the cleanup must stop
set -uo pipefail
cd "$(dirname "$0")/.."
DB="${REHEARSAL_DB_URL:?set REHEARSAL_DB_URL to a local pre-cutover database}"
case "$DB" in *127.0.0.1*|*localhost*) ;; *) echo "Refusing to run against a non-local database" >&2; exit 2;; esac
CHAIN=(supabase/migrations/20260918185800_*.sql supabase/migrations/20260918185850_*.sql supabase/migrations/20260918185900_*.sql supabase/migrations/20260918189000_*.sql
       supabase/migrations/20260918190000_*.sql supabase/migrations/20260918195000_*.sql)
run() {
  { echo "BEGIN;"; echo "\\i scripts/triad-cutover-rehearsal/fixture.sql"; [[ -n "${1:-}" ]] && echo "\\i $1";
    for f in "${CHAIN[@]}"; do echo "\\i $f"; done
    [[ -n "${2:-}" ]] && echo "\\i $2"; echo "ROLLBACK;"; } | psql "$DB" -X -q -v ON_ERROR_STOP=1 2>&1
}
out1=$(run "" scripts/triad-cutover-rehearsal/assertions.sql); rc1=$?
echo "$out1" | grep -E "NOTICE:  Triad|ERROR" | sed 's/^psql:[^ ]* //'
[[ $rc1 -eq 0 ]] && echo "$out1" | grep -q "all assertions passed" || { echo "PASS 1 FAILED"; exit 1; }
real=$(mktemp); cat > "$real" <<'SQL'
alter table public.triad_groups disable trigger user;
insert into public.triad_groups (id, cohort_id, programme_id, member_1_id, member_2_id, enrollment_1_id, enrollment_2_id, is_active, assigned_by, group_language)
values ('49000000-4444-4444-8444-000000000001', 'd9000000-0000-0000-0000-0000000000c0', 'c9000000-0000-0000-0000-0000000000a0',
  'a9000000-0000-0000-0000-000000000011', 'a9000000-0000-0000-0000-000000000012',
  'e9000000-0000-0000-0000-000000000011', 'e9000000-0000-0000-0000-000000000012', true, 'admin', 'en');
alter table public.triad_groups enable trigger user;
SQL
out2=$(run "$real"); rc2=$?; rm -f "$real"
if [[ $rc2 -ne 0 ]] && echo "$out2" | grep -q "REAL/UNKNOWN Triad records conflict"; then
  echo "pass 2: the cleanup stopped on the REAL/UNKNOWN group, as required"
else
  echo "PASS 2 FAILED: the cleanup did not stop on a REAL/UNKNOWN conflict"; echo "$out2" | tail -5; exit 1
fi
echo "Triad cutover rehearsal: OK"
