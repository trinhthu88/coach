-- ============================================================================
-- TRIAD LEGACY RETIREMENT — DEPLOYMENT 2 ONLY.
--
-- This file deliberately lives in supabase/deployment-2/, not
-- supabase/migrations/. It is a standalone, later deployment artifact.
-- Deployment 1 and 20260919120000 must already be verified on the target
-- database before this file is run.
--
-- The explicit transaction and ON_ERROR_STOP make the file safe when invoked
-- directly with psql. Do not remove either: a failure after archive creation
-- must roll back before any DROP can be committed.
-- ============================================================================

\set ON_ERROR_STOP on
BEGIN;

DO $$
BEGIN
  IF to_regclass('public.triad_cutover_archive') IS NULL
     OR to_regclass('public.triad_groups') IS NULL
     OR to_regclass('public.triad_sessions') IS NULL
     OR to_regclass('public.triad_alternative_proposals') IS NULL
     OR to_regclass('public.triad_reflections') IS NULL
     OR to_regclass('public.triad_rounds') IS NULL
     OR to_regclass('public.programme_triad_rounds') IS NULL THEN
    RAISE EXCEPTION 'Triad retirement: required pre-retirement tables are missing';
  END IF;
END $$;

-- The one authoritative list used by the archive coverage checks and the
-- post-drop column check. The ALTER TABLE block below is generated from this
-- list so a guard cannot silently drift from the destructive operation.
CREATE TEMP TABLE _triad_retired_columns (
  table_name text NOT NULL,
  column_name text NOT NULL,
  ordinal integer NOT NULL,
  PRIMARY KEY (table_name, column_name)
) ON COMMIT DROP;

INSERT INTO _triad_retired_columns (table_name, column_name, ordinal) VALUES
  ('triad_groups', 'member_1_id', 10),
  ('triad_groups', 'member_2_id', 20),
  ('triad_groups', 'member_3_id', 30),
  ('triad_groups', 'enrollment_1_id', 40),
  ('triad_groups', 'enrollment_2_id', 50),
  ('triad_groups', 'enrollment_3_id', 60),
  ('triad_groups', 'programme_id', 70),
  ('triad_groups', 'round_number', 80),
  ('triad_groups', 'triad_round_id', 90),
  ('triad_groups', 'name', 100),
  ('triad_sessions', 'coach_enrollment_id', 10),
  ('triad_sessions', 'coachee_enrollment_id', 20),
  ('triad_sessions', 'observer_enrollment_id', 30),
  ('triad_sessions', 'member_1_response', 40),
  ('triad_sessions', 'member_2_response', 50),
  ('triad_sessions', 'member_3_response', 60),
  ('triad_sessions', 'proposed_start_time', 70),
  ('triad_sessions', 'proposed_end_time', 80),
  ('triad_sessions', 'start_time', 90),
  ('triad_sessions', 'proposed_by', 100),
  ('triad_alternative_proposals', 'proposed_by', 10),
  ('triad_alternative_proposals', 'member_1_response', 20),
  ('triad_alternative_proposals', 'member_2_response', 30),
  ('triad_alternative_proposals', 'member_3_response', 40),
  ('triad_reflections', 'participant_id', 10),
  ('triad_reflections', 'learned_as_coach', 20),
  ('triad_reflections', 'will_use_as_coach', 30),
  ('triad_reflections', 'learned_as_coachee', 40),
  ('triad_reflections', 'will_use_as_coachee', 50),
  ('triad_reflections', 'learned_as_observer', 60),
  ('triad_reflections', 'will_use_as_observer', 70);

DO $$
DECLARE n bigint;
BEGIN
  SELECT count(*) INTO n
  FROM _triad_retired_columns c
  WHERE NOT EXISTS (
    SELECT 1
    FROM information_schema.columns i
    WHERE i.table_schema = 'public'
      AND i.table_name = c.table_name
      AND i.column_name = c.column_name
  );
  IF n > 0 THEN
    RAISE EXCEPTION 'Triad retirement: % expected legacy columns are already missing', n;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'triad_groups'
      AND column_name = 'cohort_requirement_date_id'
      AND is_nullable = 'NO'
  ) THEN
    RAISE EXCEPTION 'Triad retirement: triad_groups.cohort_requirement_date_id must be required';
  END IF;
END $$;

-- Capture the pre-drop RLS state of canonical objects. Deployment 2 does not
-- intentionally change these objects, but the post-drop assertion proves it.
CREATE TEMP TABLE _triad_rls_baseline AS
SELECT c.relname AS table_name, c.relrowsecurity, c.relforcerowsecurity
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN (
    'triad_groups', 'triad_group_members', 'triad_sessions',
    'triad_session_responses', 'triad_alternative_proposals',
    'triad_alternative_proposal_responses', 'triad_reflections',
    'triad_reflection_questions', 'triad_reflection_answers',
    'triad_cutover_archive'
  );

CREATE TEMP TABLE _triad_privilege_baseline AS
SELECT c.relname AS table_name, r.rolname AS role_name,
  has_table_privilege(r.rolname, c.oid, 'SELECT') AS can_select,
  has_table_privilege(r.rolname, c.oid, 'INSERT') AS can_insert,
  has_table_privilege(r.rolname, c.oid, 'UPDATE') AS can_update,
  has_table_privilege(r.rolname, c.oid, 'DELETE') AS can_delete
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
CROSS JOIN pg_roles r
WHERE n.nspname = 'public'
  AND r.rolname IN ('anon', 'authenticated')
  AND c.relname IN (
    'triad_groups', 'triad_group_members', 'triad_sessions',
    'triad_session_responses', 'triad_alternative_proposals',
    'triad_alternative_proposal_responses', 'triad_reflections',
    'triad_reflection_questions', 'triad_reflection_answers',
    'triad_cutover_archive'
  );

-- Expected archive rows are materialized before any insert. Every later
-- archive assertion compares against this exact typed source projection.
CREATE TEMP TABLE _triad_retirement_expected (
  object_name text NOT NULL,
  record_id uuid NOT NULL,
  payload jsonb NOT NULL,
  migration_id text NOT NULL,
  PRIMARY KEY (object_name, record_id)
) ON COMMIT DROP;

INSERT INTO _triad_retirement_expected
SELECT 'triad_groups.legacy', g.id,
  jsonb_build_object(
    'cohort_id', g.cohort_id, 'programme_id', g.programme_id, 'name', g.name,
    'round_number', g.round_number, 'triad_round_id', g.triad_round_id,
    'member_1_id', g.member_1_id, 'member_2_id', g.member_2_id,
    'member_3_id', g.member_3_id, 'enrollment_1_id', g.enrollment_1_id,
    'enrollment_2_id', g.enrollment_2_id, 'enrollment_3_id', g.enrollment_3_id
  ), '20260919190000_triad_retire_legacy'
FROM public.triad_groups g;

INSERT INTO _triad_retirement_expected
SELECT 'triad_sessions.legacy', s.id,
  jsonb_build_object(
    'triad_group_id', s.triad_group_id,
    'coach_enrollment_id', s.coach_enrollment_id,
    'coachee_enrollment_id', s.coachee_enrollment_id,
    'observer_enrollment_id', s.observer_enrollment_id,
    'member_1_response', s.member_1_response,
    'member_2_response', s.member_2_response,
    'member_3_response', s.member_3_response,
    'proposed_start_time', s.proposed_start_time,
    'proposed_end_time', s.proposed_end_time,
    'start_time', s.start_time,
    'proposed_by', s.proposed_by
  ), '20260919190000_triad_retire_legacy'
FROM public.triad_sessions s;

INSERT INTO _triad_retirement_expected
SELECT 'triad_alternative_proposals.legacy', p.id,
  jsonb_build_object(
    'triad_session_id', p.triad_session_id,
    'proposed_by', p.proposed_by,
    'member_1_response', p.member_1_response,
    'member_2_response', p.member_2_response,
    'member_3_response', p.member_3_response
  ), '20260919190000_triad_retire_legacy'
FROM public.triad_alternative_proposals p;

INSERT INTO _triad_retirement_expected
SELECT 'triad_reflections.legacy', r.id,
  jsonb_build_object(
    'triad_session_id', r.triad_session_id,
    'enrollment_id', r.enrollment_id,
    'participant_id', r.participant_id,
    'learned_as_coach', r.learned_as_coach,
    'will_use_as_coach', r.will_use_as_coach,
    'learned_as_coachee', r.learned_as_coachee,
    'will_use_as_coachee', r.will_use_as_coachee,
    'learned_as_observer', r.learned_as_observer,
    'will_use_as_observer', r.will_use_as_observer
  ), '20260919190000_triad_retire_legacy'
FROM public.triad_reflections r;

-- Round rows are full row snapshots. to_jsonb(row) preserves nulls and every
-- column, unlike a hand-picked projection.
INSERT INTO _triad_retirement_expected
SELECT 'triad_rounds', tr.id, to_jsonb(tr), '20260919190000_triad_retire_legacy'
FROM public.triad_rounds tr;

INSERT INTO _triad_retirement_expected
SELECT 'programme_triad_rounds', p.id, to_jsonb(p), '20260919190000_triad_retire_legacy'
FROM public.programme_triad_rounds p;

-- Required key coverage is explicit even though the exact JSONB equality check
-- below is the final source-of-truth comparison.
DO $$
DECLARE n bigint;
BEGIN
  SELECT count(*) INTO n FROM _triad_retirement_expected
  WHERE object_name = 'triad_groups.legacy'
    AND NOT (payload ?& ARRAY[
      'member_1_id', 'member_2_id', 'member_3_id',
      'enrollment_1_id', 'enrollment_2_id', 'enrollment_3_id',
      'programme_id', 'round_number', 'triad_round_id', 'name'
    ]);
  IF n > 0 THEN RAISE EXCEPTION 'Triad retirement: % group archive payloads miss retired keys', n; END IF;

  SELECT count(*) INTO n FROM _triad_retirement_expected
  WHERE object_name = 'triad_sessions.legacy'
    AND NOT (payload ?& ARRAY[
      'coach_enrollment_id', 'coachee_enrollment_id', 'observer_enrollment_id',
      'member_1_response', 'member_2_response', 'member_3_response',
      'proposed_start_time', 'proposed_end_time', 'start_time', 'proposed_by'
    ]);
  IF n > 0 THEN RAISE EXCEPTION 'Triad retirement: % session archive payloads miss retired keys', n; END IF;

  SELECT count(*) INTO n FROM _triad_retirement_expected
  WHERE object_name = 'triad_alternative_proposals.legacy'
    AND NOT (payload ?& ARRAY[
      'proposed_by', 'member_1_response', 'member_2_response', 'member_3_response'
    ]);
  IF n > 0 THEN RAISE EXCEPTION 'Triad retirement: % proposal archive payloads miss retired keys', n; END IF;

  SELECT count(*) INTO n FROM _triad_retirement_expected
  WHERE object_name = 'triad_reflections.legacy'
    AND NOT (payload ?& ARRAY[
      'participant_id', 'learned_as_coach', 'will_use_as_coach',
      'learned_as_coachee', 'will_use_as_coachee',
      'learned_as_observer', 'will_use_as_observer'
    ]);
  IF n > 0 THEN RAISE EXCEPTION 'Triad retirement: % reflection archive payloads miss retired keys', n; END IF;
END $$;

-- Preserve every dependency intrinsic to the objects being retired. Indexes
-- owned by a retired column/table, defaults owned by a retired column/table,
-- and the known legacy-table trigger are expected to disappear with their
-- owner. Anything else remains an execution blocker.
CREATE TEMP TABLE _triad_retirement_indexes AS
SELECT DISTINCT ns.nspname AS schema_name, c.relname AS index_name
FROM pg_depend d
JOIN pg_class ref ON ref.oid = d.refobjid
JOIN pg_namespace refns ON refns.oid = ref.relnamespace
JOIN pg_class c ON d.classid = 'pg_class'::regclass AND c.oid = d.objid
JOIN pg_namespace ns ON ns.oid = c.relnamespace
LEFT JOIN pg_attribute a ON a.attrelid = ref.oid AND a.attnum = d.refobjsubid
WHERE refns.nspname = 'public'
  AND c.relkind IN ('i', 'I')
  AND d.deptype <> 'i'
  AND (
    ref.relname IN ('triad_rounds', 'programme_triad_rounds')
    OR (
      ref.relname IN (
        'triad_groups', 'triad_sessions',
        'triad_alternative_proposals', 'triad_reflections'
      )
      AND a.attname IN (SELECT column_name FROM _triad_retired_columns)
    )
  );

CREATE TEMP TABLE _triad_retirement_constraints AS
SELECT con.oid AS constraint_oid, ns.nspname AS schema_name,
  c.relname AS table_name, con.conname
FROM pg_constraint con
JOIN pg_class c ON c.oid = con.conrelid
JOIN pg_namespace ns ON ns.oid = c.relnamespace
WHERE ns.nspname = 'public'
  AND c.relname IN (
    'triad_groups', 'triad_sessions',
    'triad_alternative_proposals', 'triad_reflections',
    'triad_rounds', 'programme_triad_rounds'
  )
  AND (
    c.relname IN ('triad_rounds', 'programme_triad_rounds')
    OR EXISTS (
      SELECT 1
      FROM unnest(con.conkey) key(attnum)
      JOIN pg_attribute a
        ON a.attrelid = con.conrelid AND a.attnum = key.attnum
      WHERE a.attname IN (SELECT column_name FROM _triad_retired_columns)
    )
  );

CREATE TEMP TABLE _triad_retirement_defaults AS
SELECT d.oid AS default_oid, ns.nspname AS schema_name,
  c.relname AS table_name, a.attname AS column_name
FROM pg_attrdef d
JOIN pg_class c ON c.oid = d.adrelid
JOIN pg_namespace ns ON ns.oid = c.relnamespace
JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
WHERE ns.nspname = 'public'
  AND (
    c.relname IN ('triad_rounds', 'programme_triad_rounds')
    OR EXISTS (
      SELECT 1
      FROM _triad_retired_columns retired
      WHERE retired.table_name = c.relname
        AND retired.column_name = a.attname
    )
  );

CREATE TEMP TABLE _triad_retirement_triggers AS
SELECT t.oid AS trigger_oid, ns.nspname AS schema_name,
  c.relname AS table_name, t.tgname
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_namespace ns ON ns.oid = c.relnamespace
WHERE NOT t.tgisinternal
  AND ns.nspname = 'public'
  AND c.relname = 'triad_rounds'
  AND t.tgname = 'trg_triad_rounds_updated';

-- Reject any dependency other than an intrinsic retirement dependency before
-- DROP. The allow-list is deliberately catalog-backed and exact: a trigger on
-- a live canonical table, a default owned by a surviving column, or any
-- dependency from another object still fails closed.
DO $$
DECLARE offenders text;
BEGIN
  SELECT string_agg(pg_describe_object(d.classid, d.objid, d.objsubid), ', ')
  INTO offenders
  FROM pg_depend d
  JOIN pg_class ref ON ref.oid = d.refobjid
  JOIN pg_namespace refns ON refns.oid = ref.relnamespace
  LEFT JOIN pg_class dep ON d.classid = 'pg_class'::regclass AND dep.oid = d.objid
  LEFT JOIN pg_attribute a ON a.attrelid = ref.oid AND a.attnum = d.refobjsubid
  WHERE refns.nspname = 'public'
    AND d.deptype <> 'i'
    AND (
      ref.relname IN ('triad_rounds', 'programme_triad_rounds')
      OR (
        ref.relname IN (
          'triad_groups', 'triad_sessions',
          'triad_alternative_proposals', 'triad_reflections'
        )
        AND a.attname IN (SELECT column_name FROM _triad_retired_columns)
      )
    )
    AND NOT (d.classid = 'pg_class'::regclass AND dep.relkind = 'i')
    AND NOT (
      d.classid = 'pg_constraint'::regclass
      AND d.objid IN (SELECT constraint_oid FROM _triad_retirement_constraints)
    )
    AND NOT (
      d.classid = 'pg_attrdef'::regclass
      AND d.objid IN (SELECT default_oid FROM _triad_retirement_defaults)
    )
    AND NOT (
      d.classid = 'pg_trigger'::regclass
      AND d.objid IN (SELECT trigger_oid FROM _triad_retirement_triggers)
    );
  IF offenders IS NOT NULL THEN
    RAISE EXCEPTION 'Triad retirement: unexpected dependencies remain: %', offenders;
  END IF;
END $$;

-- Function, view, policy, trigger, default, generated-expression, and
-- constraint guards. Generic names are checked only where the object is
-- demonstrably Triad-related, avoiding false positives from unrelated
-- coaching or peer-session functions that legitimately use start_time.
DO $$
DECLARE offenders text;
BEGIN
  SELECT string_agg(p.proname, ', ') INTO offenders
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.prokind = 'f'
    AND pg_get_functiondef(p.oid) ~ '\mEXECUTE\M'
    AND pg_get_functiondef(p.oid) ~
      '\m(public\.)?(triad_groups|triad_sessions|triad_alternative_proposals|triad_reflections|triad_rounds|programme_triad_rounds)\M'
    AND pg_get_functiondef(p.oid) ~
      '(coach|coachee|observer)_enrollment_id|member_[123]_(id|response)|enrollment_[123]_id|participant_id|(learned|will_use)_as_(coach|coachee|observer)|triad_rounds|programme_triad_rounds|triad_round_id|round_number|proposed_start_time|proposed_end_time|proposed_by';
  IF offenders IS NOT NULL THEN
    RAISE EXCEPTION 'Triad retirement: functions still refer to retired Triad fields: %', offenders;
  END IF;

  SELECT string_agg(n.nspname || '.' || c.relname, ', ') INTO offenders
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE c.relkind IN ('v', 'm')
    AND (
      pg_get_viewdef(c.oid, true) ~
        '(coach|coachee|observer)_enrollment_id|member_[123]_(id|response)|enrollment_[123]_id|participant_id|(learned|will_use)_as_(coach|coachee|observer)|triad_rounds|programme_triad_rounds|triad_round_id|round_number'
      OR (
        pg_get_viewdef(c.oid, true) ~
          '\m(triad_groups|triad_sessions|triad_alternative_proposals|triad_reflections)\M'
        AND pg_get_viewdef(c.oid, true) ~
          '(^|[^a-z_])(programme_id|name|start_time|proposed_start_time|proposed_end_time|proposed_by)([^a-z_]|$)'
      )
    );
  IF offenders IS NOT NULL THEN
    RAISE EXCEPTION 'Triad retirement: views still refer to retired Triad fields: %', offenders;
  END IF;

  SELECT string_agg(n.nspname || '.' || c.relname || '.' || p.polname, ', ') INTO offenders
  FROM pg_policy p
  JOIN pg_class c ON c.oid = p.polrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE c.relname IN (
      'triad_groups', 'triad_sessions',
      'triad_alternative_proposals', 'triad_reflections',
      'triad_rounds', 'programme_triad_rounds'
    )
    AND coalesce(pg_get_expr(p.polqual, p.polrelid), '') ||
        coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '') ~
        '(coach|coachee|observer)_enrollment_id|member_[123]_(id|response)|enrollment_[123]_id|participant_id|(learned|will_use)_as_(coach|coachee|observer)|triad_rounds|programme_triad_rounds|triad_round_id|round_number|proposed_start_time|proposed_end_time|start_time|proposed_by';
  IF offenders IS NOT NULL THEN
    RAISE EXCEPTION 'Triad retirement: policies still refer to retired Triad fields: %', offenders;
  END IF;

  SELECT string_agg(n.nspname || '.' || c.relname || '.' || t.tgname, ', ') INTO offenders
  FROM pg_trigger t
  JOIN pg_class c ON c.oid = t.tgrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE NOT t.tgisinternal
    AND c.relname IN (
      'triad_groups', 'triad_sessions',
      'triad_alternative_proposals', 'triad_reflections',
      'triad_rounds', 'programme_triad_rounds'
    )
    AND coalesce(pg_get_expr(t.tgqual, t.tgrelid), '') ~
      '(coach|coachee|observer)_enrollment_id|member_[123]_(id|response)|enrollment_[123]_id|participant_id|(learned|will_use)_as_(coach|coachee|observer)|triad_rounds|programme_triad_rounds|triad_round_id|round_number|proposed_start_time|proposed_end_time|start_time|proposed_by';
  IF offenders IS NOT NULL THEN
    RAISE EXCEPTION 'Triad retirement: triggers still refer to retired Triad fields: %', offenders;
  END IF;

  SELECT string_agg(n.nspname || '.' || c.relname || '.' || a.attname, ', ') INTO offenders
  FROM pg_attrdef d
  JOIN pg_class c ON c.oid = d.adrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
  WHERE c.relname IN (
      'triad_groups', 'triad_sessions',
      'triad_alternative_proposals', 'triad_reflections',
      'triad_rounds', 'programme_triad_rounds'
    )
    AND pg_get_expr(d.adbin, d.adrelid) ~
    '(coach|coachee|observer)_enrollment_id|member_[123]_(id|response)|enrollment_[123]_id|participant_id|(learned|will_use)_as_(coach|coachee|observer)|triad_rounds|programme_triad_rounds|triad_round_id|round_number|proposed_start_time|proposed_end_time|start_time|proposed_by';
  IF offenders IS NOT NULL THEN
    RAISE EXCEPTION 'Triad retirement: defaults/generated expressions still refer to retired fields: %', offenders;
  END IF;

  SELECT string_agg(n.nspname || '.' || c.relname || '.' || con.conname, ', ') INTO offenders
  FROM pg_constraint con
  JOIN pg_class c ON c.oid = con.conrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE pg_get_constraintdef(con.oid, true) ~
    '(coach|coachee|observer)_enrollment_id|member_[123]_(id|response)|enrollment_[123]_id|participant_id|(learned|will_use)_as_(coach|coachee|observer)|triad_rounds|programme_triad_rounds|triad_round_id|round_number|proposed_start_time|proposed_end_time|start_time|proposed_by'
    AND NOT EXISTS (
      SELECT 1 FROM _triad_retirement_constraints x
      WHERE x.constraint_oid = con.oid
    );
  IF offenders IS NOT NULL THEN
    RAISE EXCEPTION 'Triad retirement: constraints still refer to retired fields: %', offenders;
  END IF;
END $$;

-- Every archive row must be inserted or already be an exact deterministic
-- match. A stale conflict remains unchanged and is rejected by the equality
-- check below; it can never be hidden by DO NOTHING.
INSERT INTO public.triad_cutover_archive AS archive
  (object_name, record_id, payload, migration_id)
SELECT object_name, record_id, payload, migration_id
FROM _triad_retirement_expected
ON CONFLICT (object_name, record_id) DO UPDATE
SET payload = archive.payload,
    migration_id = archive.migration_id
WHERE archive.payload IS NOT DISTINCT FROM EXCLUDED.payload;

-- REHEARSAL_AFTER_ARCHIVE_BOUNDARY

DO $$
DECLARE n bigint;
BEGIN
  SELECT count(*) INTO n
  FROM _triad_retirement_expected e
  LEFT JOIN public.triad_cutover_archive a
    ON a.object_name = e.object_name
   AND a.record_id = e.record_id
   AND a.payload IS NOT DISTINCT FROM e.payload
  WHERE a.record_id IS NULL;
  IF n > 0 THEN
    RAISE EXCEPTION 'Triad retirement: % archive rows are missing or stale', n;
  END IF;

  SELECT count(*) INTO n
  FROM public.triad_cutover_archive a
  WHERE a.migration_id = '20260919190000_triad_retire_legacy'
    AND NOT EXISTS (
      SELECT 1 FROM _triad_retirement_expected e
      WHERE e.object_name = a.object_name
        AND e.record_id = a.record_id
        AND e.payload IS NOT DISTINCT FROM a.payload
        AND e.migration_id = a.migration_id
    );
  IF n > 0 THEN
    RAISE EXCEPTION 'Triad retirement: % unexpected archive rows exist for this deployment', n;
  END IF;

  SELECT count(*) INTO n
  FROM _triad_retirement_expected e
  JOIN public.triad_cutover_archive a
    ON a.object_name = e.object_name AND a.record_id = e.record_id
  WHERE a.payload IS DISTINCT FROM e.payload
     OR (
       a.migration_id <> e.migration_id
       AND e.object_name NOT IN ('triad_rounds', 'programme_triad_rounds')
     );
  IF n > 0 THEN
    RAISE EXCEPTION 'Triad retirement: % archive conflicts differ from the typed source projection', n;
  END IF;
END $$;

-- Drop exactly the columns in _triad_retired_columns, in one transaction.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT table_name,
      string_agg(format('DROP COLUMN %I', column_name), ', ' ORDER BY ordinal) AS drop_clause
    FROM _triad_retired_columns
    GROUP BY table_name
    ORDER BY table_name
  LOOP
    EXECUTE format('ALTER TABLE public.%I %s', r.table_name, r.drop_clause);
    -- REHEARSAL_DESTRUCTIVE_BOUNDARY
  END LOOP;
END $$;

DROP TABLE public.triad_rounds;
DROP TABLE public.programme_triad_rounds;
DROP FUNCTION IF EXISTS public.triad_is_seed_identifier(uuid);

-- REHEARSAL_ARCHIVE_ASSERTION_BOUNDARY

-- Post-drop proof stays inside the transaction, before COMMIT.
DO $$
DECLARE offenders text; n bigint;
BEGIN
  IF to_regclass('public.triad_rounds') IS NOT NULL
     OR to_regclass('public.programme_triad_rounds') IS NOT NULL THEN
    RAISE EXCEPTION 'Triad retirement: legacy round tables still exist';
  END IF;

  SELECT count(*) INTO n
  FROM _triad_retired_columns c
  JOIN information_schema.columns i
    ON i.table_schema = 'public'
   AND i.table_name = c.table_name
   AND i.column_name = c.column_name;
  IF n > 0 THEN
    RAISE EXCEPTION 'Triad retirement: % retired columns remain', n;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM _triad_retirement_constraints x
    JOIN pg_constraint con ON con.oid = x.constraint_oid
  ) THEN
    RAISE EXCEPTION 'Triad retirement: expected legacy constraints remain';
  END IF;

  IF to_regprocedure('public.triad_is_seed_identifier(uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'Triad retirement: triad_is_seed_identifier still exists';
  END IF;

  SELECT string_agg(format('%I.%I', schema_name, index_name), ', ')
  INTO offenders
  FROM _triad_retirement_indexes i
  WHERE to_regclass(format('%I.%I', schema_name, index_name)) IS NOT NULL;
  IF offenders IS NOT NULL THEN
    RAISE EXCEPTION 'Triad retirement: dependent legacy indexes remain: %', offenders;
  END IF;

  IF to_regclass('public.cohort_requirement_dates') IS NULL
     OR to_regclass('public.triad_group_members') IS NULL
     OR to_regclass('public.triad_sessions') IS NULL
     OR to_regclass('public.triad_session_responses') IS NULL
     OR to_regclass('public.triad_alternative_proposal_responses') IS NULL
     OR to_regclass('public.triad_reflection_questions') IS NULL
     OR to_regclass('public.triad_reflection_answers') IS NULL THEN
    RAISE EXCEPTION 'Triad retirement: canonical Triad structures are missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'triad_groups'
      AND column_name = 'cohort_requirement_date_id' AND is_nullable = 'NO'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'triad_reflections'
      AND column_name = 'enrollment_id'
  ) THEN
    RAISE EXCEPTION 'Triad retirement: canonical ownership columns are missing';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'canonical_module_progress')
     OR NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'canonical_triad_completion')
     OR NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'canonical_triad_requirement_fulfilment') THEN
    RAISE EXCEPTION 'Triad retirement: canonical progress functions are missing';
  END IF;
END $$;

-- Repeat the catalog reference checks after the drops. This catches dynamic
-- SQL or view/policy definitions that catalog dependencies cannot resolve.
DO $$
DECLARE offenders text;
BEGIN
  SELECT string_agg(p.proname, ', ') INTO offenders
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.prokind = 'f'
    AND pg_get_functiondef(p.oid) ~ '\mEXECUTE\M'
    AND pg_get_functiondef(p.oid) ~
      '\m(public\.)?(triad_groups|triad_sessions|triad_alternative_proposals|triad_reflections|triad_rounds|programme_triad_rounds)\M'
    AND pg_get_functiondef(p.oid) ~
      '(coach|coachee|observer)_enrollment_id|member_[123]_(id|response)|enrollment_[123]_id|participant_id|(learned|will_use)_as_(coach|coachee|observer)|triad_rounds|programme_triad_rounds|triad_round_id|round_number|proposed_start_time|proposed_end_time|proposed_by';
  IF offenders IS NOT NULL THEN
    RAISE EXCEPTION 'Triad retirement: post-drop functions refer to retired fields: %', offenders;
  END IF;

  SELECT string_agg(n.nspname || '.' || c.relname, ', ') INTO offenders
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE c.relkind IN ('v', 'm')
    AND pg_get_viewdef(c.oid, true) ~
      '\m(public\.)?(triad_rounds|programme_triad_rounds)\M';
  IF offenders IS NOT NULL THEN
    RAISE EXCEPTION 'Triad retirement: post-drop views refer to retired fields: %', offenders;
  END IF;
END $$;

DO $$
DECLARE n bigint;
BEGIN
  IF (SELECT count(*) FROM _triad_rls_baseline b
      JOIN pg_class c ON c.relname = b.table_name
      JOIN pg_namespace ns ON ns.oid = c.relnamespace
      WHERE ns.nspname = 'public'
        AND (b.relrowsecurity, b.relforcerowsecurity)
            IS DISTINCT FROM (c.relrowsecurity, c.relforcerowsecurity)) > 0 THEN
    RAISE EXCEPTION 'Triad retirement: canonical RLS state changed';
  END IF;

  SELECT count(*) INTO n
  FROM _triad_privilege_baseline b
  JOIN pg_class c ON c.relname = b.table_name
  JOIN pg_namespace ns ON ns.oid = c.relnamespace
  WHERE ns.nspname = 'public'
    AND (b.can_select, b.can_insert, b.can_update, b.can_delete)
        IS DISTINCT FROM (
          has_table_privilege(b.role_name, c.oid, 'SELECT'),
          has_table_privilege(b.role_name, c.oid, 'INSERT'),
          has_table_privilege(b.role_name, c.oid, 'UPDATE'),
          has_table_privilege(b.role_name, c.oid, 'DELETE')
        );
  IF n > 0 THEN
    RAISE EXCEPTION 'Triad retirement: anon/authenticated table privileges changed';
  END IF;

  IF has_table_privilege('anon', 'public.triad_cutover_archive', 'SELECT')
     OR has_table_privilege('authenticated', 'public.triad_cutover_archive', 'SELECT') THEN
    RAISE EXCEPTION 'Triad retirement: cutover archive is client-readable';
  END IF;
END $$;

COMMIT;