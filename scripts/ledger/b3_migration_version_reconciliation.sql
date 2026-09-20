-- B3 ledger reconciliation (production). NOT YET RUN — requires approval.
--
-- Ten repository migrations were applied to production through a raw /
-- tooling path that recorded them under different version numbers. Their
-- effects are live; only the ledger rows differ, so a plain
-- `supabase db push` would try to run the repository versions again.
--
-- Evidence (2026-09-19, read-only against production, see the readiness report):
--   * every object of the production public schema that the repository
--     defines is identical to a fresh replay of supabase/migrations up to
--     20260918180000: functions (md5 of pg_get_functiondef + security /
--     config / volatility / grants), columns, constraints, indexes, triggers,
--     policies, views and table grants — 0 differences;
--   * the SQL each ledger row recorded is token-identical to the repository
--     file for 9 of 10; 20260917173000 differs by one extra projected column
--     (c.organization_id) in a function body that 20260917180000 later
--     replaces — the live definition is byte-identical to the replay.
--
-- This script ONLY renames the ten ledger versions. It never re-runs a
-- migration or touches application data. It aborts unless every production
-- row exists with the expected name and no repository version is present.
--
--   psql "$PROD_DB_URL" -v ON_ERROR_STOP=1 -f scripts/ledger/b3_migration_version_reconciliation.sql
-- (equivalent: `supabase migration repair --status reverted <prod versions>`
--  then `--status applied <repo versions>`).

BEGIN;

CREATE TEMP TABLE _b3_map (prod_version text PRIMARY KEY, repo_version text UNIQUE, name text) ON COMMIT DROP;
INSERT INTO _b3_map VALUES
  ('20260917152126', '20260917160000', 'sponsor_requirement_capped_progress'),
  ('20260917153800', '20260917170000', 'sponsor_leader_next_booking'),
  ('20260917154057', '20260917171000', 'sponsor_leader_next_booking_fast'),
  ('20260917154321', '20260917172000', 'sponsor_leader_experience_fast_path'),
  ('20260917154647', '20260917173000', 'sponsor_leader_experience_direct_path'),
  ('20260917163735', '20260917180000', 'canonical_training_learning_progress'),
  ('20260917164325', '20260917181000', 'backfill_training_child_selection'),
  ('20260918134552', '20260917190000', 'coachee_reflections_enrollment_scope'),
  ('20260918134617', '20260918130000', 'learner_session_history_and_reflection_feed'),
  ('20260918141631', '20260918140000', 'learner_triad_members');

DO $guard$
DECLARE missing text; present text;
BEGIN
  SELECT string_agg(m.prod_version || ' ' || m.name, ', ') INTO missing
  FROM _b3_map m
  WHERE NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations s
                    WHERE s.version = m.prod_version AND s.name = m.name);
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'B3: expected production ledger rows are missing or renamed: %', missing;
  END IF;
  SELECT string_agg(m.repo_version, ', ') INTO present
  FROM _b3_map m
  WHERE EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations s WHERE s.version = m.repo_version);
  IF present IS NOT NULL THEN
    RAISE EXCEPTION 'B3: repository versions already present in the ledger: %', present;
  END IF;
END $guard$;

UPDATE supabase_migrations.schema_migrations s
SET version = m.repo_version
FROM _b3_map m
WHERE s.version = m.prod_version AND s.name = m.name;

DO $verify$
BEGIN
  IF (SELECT count(*) FROM supabase_migrations.schema_migrations s JOIN _b3_map m ON m.repo_version = s.version AND m.name = s.name) <> 10 THEN
    RAISE EXCEPTION 'B3: reconciliation did not produce the ten repository versions';
  END IF;
END $verify$;

COMMIT;
