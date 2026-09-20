-- Deployment 2 Triad retirement verification (READ-ONLY).
--
-- Run only after Deployment 2 has been applied to the target database.
-- This script intentionally does not query dropped tables or dropped columns.

\set ON_ERROR_STOP on
BEGIN TRANSACTION READ ONLY;

DO $$
DECLARE bad text; n bigint;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM supabase_migrations.schema_migrations
    WHERE version = '20260919190000'
  ) THEN
    RAISE EXCEPTION 'Deployment 2 verification: migration is not in the ledger';
  END IF;
  IF to_regclass('public.triad_rounds') IS NOT NULL
     OR to_regclass('public.programme_triad_rounds') IS NOT NULL THEN
    RAISE EXCEPTION 'Deployment 2 verification: legacy round table remains';
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
  ) AS retired(table_name, column_name)
  WHERE EXISTS (
    SELECT 1 FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.table_name = retired.table_name
      AND c.column_name = retired.column_name
  );
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'Deployment 2 verification: retired columns remain: %', bad;
  END IF;

  IF to_regprocedure('public.triad_is_seed_identifier(uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'Deployment 2 verification: retired helper remains';
  END IF;

  IF to_regclass('public.cohort_requirement_dates') IS NULL
     OR to_regclass('public.triad_group_members') IS NULL
     OR to_regclass('public.triad_sessions') IS NULL
     OR to_regclass('public.triad_session_responses') IS NULL
     OR to_regclass('public.triad_alternative_proposal_responses') IS NOT NULL
        AND to_regclass('public.triad_alternative_proposal_responses') IS NULL
     OR to_regclass('public.triad_reflection_questions') IS NULL
     OR to_regclass('public.triad_reflection_answers') IS NULL THEN
    RAISE EXCEPTION 'Deployment 2 verification: canonical structures are missing';
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
    RAISE EXCEPTION 'Deployment 2 verification: canonical ownership columns are missing';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'canonical_module_progress')
     OR NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'canonical_triad_completion')
     OR NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'canonical_triad_requirement_fulfilment') THEN
    RAISE EXCEPTION 'Deployment 2 verification: canonical progress functions are missing';
  END IF;
END $$;

DO $$
DECLARE n bigint;
BEGIN
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
  IF n > 0 THEN RAISE EXCEPTION 'Deployment 2 verification: % invalid groups', n; END IF;

  SELECT count(*) INTO n
  FROM (
    SELECT m.enrollment_id, g.cohort_requirement_date_id
    FROM public.triad_group_members m
    JOIN public.triad_groups g ON g.id = m.triad_group_id AND g.is_active
    GROUP BY m.enrollment_id, g.cohort_requirement_date_id
    HAVING count(*) > 1
  ) duplicates;
  IF n > 0 THEN
    RAISE EXCEPTION 'Deployment 2 verification: % duplicate active requirement assignments', n;
  END IF;

  SELECT count(*) INTO n
  FROM public.triad_sessions s
  JOIN public.triad_group_members m ON m.triad_group_id = s.triad_group_id
  LEFT JOIN public.session_activity_attributions a
    ON a.source_activity_type = 'triad'
   AND a.source_activity_id = s.id
   AND a.enrollment_id = m.enrollment_id
  WHERE s.status <> 'cancelled'
    AND s.scheduled_start_time IS NOT NULL
    AND a.id IS NULL;
  IF n > 0 THEN
    RAISE EXCEPTION 'Deployment 2 verification: % sessions lack member evidence', n; END IF;

  SELECT count(*) INTO n
  FROM public.triad_alternative_proposals p
  JOIN public.triad_sessions s ON s.id = p.triad_session_id
  JOIN public.triad_group_members m ON m.triad_group_id = s.triad_group_id
  LEFT JOIN public.triad_alternative_proposal_responses r
    ON r.proposal_id = p.id AND r.enrollment_id = m.enrollment_id
  WHERE r.proposal_id IS NULL;
  IF n > 0 THEN
    RAISE EXCEPTION 'Deployment 2 verification: % proposal responses are missing', n; END IF;

  SELECT count(*) INTO n
  FROM public.triad_reflections r
  WHERE r.enrollment_id IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM public.triad_reflection_answers a
       WHERE a.triad_reflection_id = r.id
     );
  IF n > 0 THEN
    RAISE EXCEPTION 'Deployment 2 verification: % reflections lack normalized answers', n; END IF;

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
    RAISE EXCEPTION 'Deployment 2 verification: % canonical progress mismatches', n; END IF;
END $$;

-- Admin, Learner, Sponsor and Journey surfaces must remain projections of the
-- shared canonical construction. This is a catalog assertion, not a
-- role-bypassing data query.
DO $$
DECLARE missing text;
BEGIN
  SELECT string_agg(name, ', ')
  INTO missing
  FROM (
    VALUES
      ('learner_canonical_progress'),
      ('admin_canonical_enrollment_progress'),
      ('sponsor_canonical_enrollment_progress'),
      ('sponsor_canonical_cohort_progress'),
      ('sponsor_canonical_organisation_progress')
  ) expected(name)
  WHERE NOT EXISTS (
    SELECT 1
    FROM pg_proc p
    WHERE p.proname = expected.name
      AND pg_get_functiondef(p.oid) ~ 'canonical_enrollment_progress'
  );
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'Deployment 2 verification: projections no longer use canonical progress: %', missing;
  END IF;
END $$;

-- The archive remains internal and client-inaccessible.
DO $$
DECLARE n bigint;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
    WHERE ns.nspname = 'public' AND c.relname = 'triad_cutover_archive'
      AND c.relrowsecurity
  ) THEN
    RAISE EXCEPTION 'Deployment 2 verification: archive RLS is disabled';
  END IF;
  SELECT count(*) INTO n
  FROM pg_policy p
  JOIN pg_class c ON c.oid = p.polrelid
  JOIN pg_namespace ns ON ns.oid = c.relnamespace
  WHERE ns.nspname = 'public' AND c.relname = 'triad_cutover_archive';
  IF n > 0
     OR has_table_privilege('anon', 'public.triad_cutover_archive', 'SELECT')
     OR has_table_privilege('authenticated', 'public.triad_cutover_archive', 'SELECT') THEN
    RAISE EXCEPTION 'Deployment 2 verification: archive privacy boundary changed';
  END IF;
END $$;

\echo '== Archive reconstruction coverage'
SELECT object_name, migration_id, count(*) AS archived_rows
FROM public.triad_cutover_archive
WHERE object_name IN (
  'triad_groups.legacy', 'triad_sessions.legacy',
  'triad_alternative_proposals.legacy', 'triad_reflections.legacy',
  'triad_rounds', 'programme_triad_rounds'
)
GROUP BY object_name, migration_id
ORDER BY object_name, migration_id;

\echo '== Progress cases'
SELECT
  count(*) FILTER (WHERE c.completed_units = c.required_units
                    AND c.required_units >= 2) AS two_of_two_or_more,
  count(*) FILTER (WHERE c.raw_completed_sessions > c.completed_units
                    AND c.completed_units < c.required_units) AS repeated_sessions_still_one_unit,
  count(*) FILTER (WHERE g.requirement_count > 1) AS distinct_requirement_groups
FROM public.programme_enrollments e
CROSS JOIN LATERAL public.canonical_triad_completion(e.id, current_date) c
LEFT JOIN LATERAL (
  SELECT count(DISTINCT tg.cohort_requirement_date_id) AS requirement_count
  FROM public.triad_group_members tgm
  JOIN public.triad_groups tg ON tg.id = tgm.triad_group_id AND tg.is_active
  WHERE tgm.enrollment_id = e.id
) g ON true;

\echo 'Deployment 2 verification passed'
ROLLBACK;