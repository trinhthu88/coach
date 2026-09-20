-- Deployment 2 Triad retirement readiness (READ-ONLY).
--
-- Run against the target database after Deployment 1 and
-- 20260919120000_triad_requirement_groups, but before executing:
--   supabase/deployment-2/20260919190000_triad_retire_legacy.sql
--
-- This verifier intentionally reads the legacy columns. It must not be used
-- after Deployment 2; use scripts/triad-deployment-2-verification.sql then.

\set ON_ERROR_STOP on
BEGIN TRANSACTION READ ONLY;

DO $$
DECLARE bad text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM supabase_migrations.schema_migrations
    WHERE version IN (
      '20260918185800', '20260918185850', '20260918185900',
      '20260918189000', '20260918190000', '20260918195000',
      '20260919120000'
    )
    GROUP BY version
    HAVING count(*) = 1
  ) THEN
    RAISE EXCEPTION 'Deployment 2 readiness: required migration ledger rows are missing';
  END IF;
  IF EXISTS (
    SELECT 1 FROM supabase_migrations.schema_migrations
    WHERE version = '20260919190000'
  ) THEN
    RAISE EXCEPTION 'Deployment 2 readiness: Deployment 2 is already in the ledger';
  END IF;
  IF to_regclass('public.triad_rounds') IS NULL
     OR to_regclass('public.programme_triad_rounds') IS NULL THEN
    RAISE EXCEPTION 'Deployment 2 readiness: legacy round storage is already absent';
  END IF;
  SELECT string_agg(table_name || '.' || column_name, ', ')
  INTO bad
  FROM (
    VALUES
      ('triad_groups', 'member_1_id'), ('triad_groups', 'member_2_id'),
      ('triad_groups', 'member_3_id'), ('triad_groups', 'enrollment_1_id'),
      ('triad_groups', 'enrollment_2_id'), ('triad_groups', 'enrollment_3_id'),
      ('triad_groups', 'programme_id'), ('triad_groups', 'round_number'),
      ('triad_groups', 'triad_round_id'), ('triad_groups', 'name'),
      ('triad_sessions', 'coach_enrollment_id'),
      ('triad_sessions', 'coachee_enrollment_id'),
      ('triad_sessions', 'observer_enrollment_id'),
      ('triad_sessions', 'member_1_response'),
      ('triad_sessions', 'member_2_response'),
      ('triad_sessions', 'member_3_response'),
      ('triad_sessions', 'proposed_start_time'),
      ('triad_sessions', 'proposed_end_time'),
      ('triad_sessions', 'start_time'), ('triad_sessions', 'proposed_by'),
      ('triad_alternative_proposals', 'proposed_by'),
      ('triad_alternative_proposals', 'member_1_response'),
      ('triad_alternative_proposals', 'member_2_response'),
      ('triad_alternative_proposals', 'member_3_response'),
      ('triad_reflections', 'participant_id'),
      ('triad_reflections', 'learned_as_coach'),
      ('triad_reflections', 'will_use_as_coach'),
      ('triad_reflections', 'learned_as_coachee'),
      ('triad_reflections', 'will_use_as_coachee'),
      ('triad_reflections', 'learned_as_observer'),
      ('triad_reflections', 'will_use_as_observer')
  ) AS required(table_name, column_name)
  WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.table_name = required.table_name
      AND c.column_name = required.column_name
  );
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'Deployment 2 readiness: legacy columns are already absent: %', bad;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'triad_groups'
      AND column_name = 'cohort_requirement_date_id' AND is_nullable = 'NO'
  ) THEN
    RAISE EXCEPTION 'Deployment 2 readiness: requirement-specific group link is missing';
  END IF;
END $$;

\echo '== Deployment 1 / legacy inventory'
SELECT
  (SELECT count(*) FROM public.triad_groups) AS groups,
  (SELECT count(*) FROM public.triad_sessions) AS sessions,
  (SELECT count(*) FROM public.triad_alternative_proposals) AS proposals,
  (SELECT count(*) FROM public.triad_reflections) AS reflections,
  (SELECT count(*) FROM public.triad_rounds) AS rounds,
  (SELECT count(*) FROM public.programme_triad_rounds) AS programme_rounds;

DO $$
DECLARE n bigint;
BEGIN
  -- Every active group is requirement-scoped and has 2-3 valid members.
  SELECT count(*) INTO n
  FROM public.triad_groups g
  LEFT JOIN public.cohort_requirement_dates d
    ON d.id = g.cohort_requirement_date_id
  WHERE d.id IS NULL
     OR d.module <> 'triads'::public.programme_module_type
     OR d.cohort_id IS DISTINCT FROM g.cohort_id
     OR (SELECT count(*) FROM public.triad_group_members m
         WHERE m.triad_group_id = g.id) NOT BETWEEN 2 AND 3
     OR EXISTS (
       SELECT 1
       FROM public.triad_group_members m
       JOIN public.programme_enrollments e ON e.id = m.enrollment_id
       WHERE m.triad_group_id = g.id
         AND (e.cohort_id IS DISTINCT FROM d.cohort_id
              OR e.programme_id IS DISTINCT FROM d.programme_id)
     );
  IF n > 0 THEN RAISE EXCEPTION 'Deployment 2 readiness: % invalid groups', n; END IF;

  SELECT count(*) INTO n
  FROM (
    SELECT m.enrollment_id, g.cohort_requirement_date_id
    FROM public.triad_group_members m
    JOIN public.triad_groups g
      ON g.id = m.triad_group_id AND g.is_active
    GROUP BY m.enrollment_id, g.cohort_requirement_date_id
    HAVING count(*) > 1
  ) duplicates;
  IF n > 0 THEN
    RAISE EXCEPTION 'Deployment 2 readiness: % duplicate active requirement assignments', n;
  END IF;

  SELECT count(*) INTO n
  FROM public.triad_sessions s
  JOIN public.triad_groups g ON g.id = s.triad_group_id
  JOIN public.triad_group_members m ON m.triad_group_id = g.id
  LEFT JOIN public.triad_session_responses r
    ON r.triad_session_id = s.id AND r.enrollment_id = m.enrollment_id
  WHERE r.triad_session_id IS NULL;
  IF n > 0 THEN
    RAISE EXCEPTION 'Deployment 2 readiness: % session member responses missing', n;
  END IF;

  SELECT count(*) INTO n
  FROM public.triad_alternative_proposals p
  JOIN public.triad_sessions s ON s.id = p.triad_session_id
  JOIN public.triad_group_members m ON m.triad_group_id = s.triad_group_id
  LEFT JOIN public.triad_alternative_proposal_responses r
    ON r.proposal_id = p.id AND r.enrollment_id = m.enrollment_id
  WHERE r.proposal_id IS NULL;
  IF n > 0 THEN
    RAISE EXCEPTION 'Deployment 2 readiness: % proposal member responses missing', n;
  END IF;

  SELECT count(*) INTO n
  FROM public.triad_reflections r
  WHERE r.enrollment_id IS NULL
     OR EXISTS (
       SELECT 1
       FROM public.triad_reflection_answers a
       WHERE a.triad_reflection_id = r.id
         AND nullif(btrim(a.answer_text), '') IS NULL
     )
     OR EXISTS (
       SELECT 1
       FROM public.triad_reflection_answers a
       JOIN public.triad_reflection_questions q ON q.id = a.question_id
       WHERE a.triad_reflection_id = r.id
         AND q.programme_id IS NULL
         AND q.is_active
         AND NOT EXISTS (
           SELECT 1 FROM public.triad_reflection_answers a2
           WHERE a2.triad_reflection_id = r.id
             AND a2.question_id = q.id
         )
     );
  IF n > 0 THEN
    RAISE EXCEPTION 'Deployment 2 readiness: % reflections have incomplete normalized ownership/answers', n;
  END IF;

  -- No unresolved historical removal decision may be carried into retirement.
  SELECT count(*) INTO n
  FROM public.triad_cutover_archive a
  WHERE a.object_name = 'cleanup.triad_groups'
    AND a.payload->>'classification' = 'REAL/UNKNOWN'
    AND NOT EXISTS (
      SELECT 1 FROM public.triad_cutover_review_decisions d
      WHERE d.triad_group_id = a.record_id
    );
  IF n > 0 THEN
    RAISE EXCEPTION 'Deployment 2 readiness: % unresolved REAL/UNKNOWN removals', n;
  END IF;

  -- The legacy retirement archive namespace must not already contain a
  -- conflicting row from a previous partial execution.
  SELECT count(*) INTO n
  FROM public.triad_cutover_archive
  WHERE migration_id = '20260919190000_triad_retire_legacy';
  IF n > 0 THEN
    RAISE EXCEPTION 'Deployment 2 readiness: % stale/partial retirement archive rows already exist', n;
  END IF;
END $$;

-- PostgreSQL catalog dependency check. Automatic indexes on the retiring
-- columns/tables are expected; all other dependencies are a hard failure.
DO $$
DECLARE offenders text;
BEGIN
  SELECT string_agg(pg_describe_object(d.classid, d.objid, d.objsubid), ', ')
  INTO offenders
  FROM pg_depend d
  JOIN pg_class ref ON ref.oid = d.refobjid
  JOIN pg_namespace ns ON ns.oid = ref.relnamespace
  LEFT JOIN pg_class dep ON d.classid = 'pg_class'::regclass AND dep.oid = d.objid
  LEFT JOIN pg_attribute a ON a.attrelid = ref.oid AND a.attnum = d.refobjsubid
  WHERE ns.nspname = 'public'
    AND d.deptype <> 'i'
    AND (
      ref.relname IN ('triad_rounds', 'programme_triad_rounds')
      OR (
        ref.relname IN (
          'triad_groups', 'triad_sessions',
          'triad_alternative_proposals', 'triad_reflections'
        )
        AND a.attname IN (
          'member_1_id', 'member_2_id', 'member_3_id',
          'enrollment_1_id', 'enrollment_2_id', 'enrollment_3_id',
          'programme_id', 'round_number', 'triad_round_id', 'name',
          'coach_enrollment_id', 'coachee_enrollment_id',
          'observer_enrollment_id', 'member_1_response',
          'member_2_response', 'member_3_response',
          'proposed_start_time', 'proposed_end_time', 'start_time',
          'proposed_by', 'participant_id', 'learned_as_coach',
          'will_use_as_coach', 'learned_as_coachee',
          'will_use_as_coachee', 'learned_as_observer',
          'will_use_as_observer'
        )
      )
    )
    AND NOT (d.classid = 'pg_class'::regclass AND dep.relkind = 'i');
  IF offenders IS NOT NULL THEN
    RAISE EXCEPTION 'Deployment 2 readiness: unexpected catalog dependencies: %', offenders;
  END IF;
END $$;

DO $$
DECLARE n bigint;
BEGIN
  SELECT count(*) INTO n
  FROM public.programme_enrollments e
  JOIN LATERAL (
    SELECT * FROM public.canonical_module_progress(e.id, current_date)
    WHERE module = 'triads'::public.programme_module_type
  ) p ON true
  CROSS JOIN LATERAL public.canonical_triad_completion(e.id, current_date) c
  WHERE row(c.required_units, c.completed_by_as_of, c.completed_units,
            c.due_units, c.overdue_units, c.booked_units, c.pace_status)
        IS DISTINCT FROM
        row(p.required_units, p.completed_activity_units, p.completed_units,
            p.due_units, p.overdue_units, p.booked_units, p.pace_status);
  IF n > 0 THEN
    RAISE EXCEPTION 'Deployment 2 readiness: % canonical progress mismatches', n;
  END IF;
END $$;

\echo '== Progress and requirement coverage'
SELECT
  count(*) FILTER (WHERE c.completed_units = c.required_units
                    AND c.required_units >= 2) AS completed_two_or_more_requirements,
  count(*) FILTER (WHERE c.raw_completed_sessions > c.completed_units
                    AND c.completed_units < c.required_units) AS repeated_session_one_unit_cases,
  count(*) FILTER (WHERE g.requirement_count > 1) AS learners_with_distinct_requirement_groups
FROM public.programme_enrollments e
CROSS JOIN LATERAL public.canonical_triad_completion(e.id, current_date) c
LEFT JOIN LATERAL (
  SELECT count(DISTINCT tg.cohort_requirement_date_id) AS requirement_count
  FROM public.triad_group_members tgm
  JOIN public.triad_groups tg ON tg.id = tgm.triad_group_id AND tg.is_active
  WHERE tgm.enrollment_id = e.id
) g ON true;

DO $$
DECLARE n bigint;
BEGIN
  IF has_table_privilege('anon', 'public.triad_cutover_archive', 'SELECT')
     OR has_table_privilege('authenticated', 'public.triad_cutover_archive', 'SELECT') THEN
    RAISE EXCEPTION 'Deployment 2 readiness: archive is client-readable';
  END IF;
  SELECT count(*) INTO n
  FROM pg_policy p
  JOIN pg_class c ON c.oid = p.polrelid
  JOIN pg_namespace ns ON ns.oid = c.relnamespace
  WHERE ns.nspname = 'public'
    AND c.relname = 'triad_cutover_archive';
  IF n > 0 THEN
    RAISE EXCEPTION 'Deployment 2 readiness: archive has an unexpected RLS policy';
  END IF;
END $$;

\echo 'Deployment 2 readiness checks passed'
ROLLBACK;