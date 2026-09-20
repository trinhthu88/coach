-- Triad REQUIREMENT-GROUP CORRECTION verification (READ-ONLY).
-- Gate for deployment 2.
--
-- Renamed from triad-deployment-1-verification.sql: the original deployment 1
-- (20260918185800 .. 20260918195000) has been live in production since
-- 2026-09-19, so this script's real subject is the requirement-group
-- correction 20260919120000 applied on top of it. It asserts BOTH are in the
-- ledger and that deployment 2 has not run.
--
-- Run against production AFTER the correction (20260919120000) and BEFORE
-- moving supabase/deployment-2/ into supabase/migrations:
--   psql "$PROD_DB_URL" -v ON_ERROR_STOP=1 -f scripts/triad-requirement-groups-verification.sql
-- Needs a role that can execute the canonical functions (postgres); nothing
-- is written. Every check raises on failure; the last line says PASSED.

BEGIN TRANSACTION READ ONLY;

DO $$
DECLARE bad text; n bigint;
BEGIN
  -- Ledger: deployment 1 applied, deployment 2 not.
  SELECT string_agg(v, ', ') INTO bad FROM unnest(ARRAY['20260918185800', '20260918185850', '20260918185900', '20260918189000', '20260918190000', '20260918195000', '20260919120000']) v
  WHERE NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations s WHERE s.version = v);
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'deployment 1 migrations missing from the ledger: %', bad; END IF;
  IF to_regclass('public.triad_rounds') IS NULL THEN RAISE EXCEPTION 'legacy storage already dropped (deployment 2 ran early)'; END IF;

  -- Groups: every group is for one Triad requirement of its own cohort, 2-3
  -- members of that requirement's cohort and programme, and an enrollment has
  -- at most one active group PER REQUIREMENT.
  SELECT string_agg(g.id::text, ', ') INTO bad FROM public.triad_groups g
  LEFT JOIN public.cohort_requirement_dates d ON d.id = g.cohort_requirement_date_id
  WHERE d.id IS NULL OR d.module <> 'triads' OR d.cohort_id IS DISTINCT FROM g.cohort_id
     OR (SELECT count(*) FROM public.triad_group_members m WHERE m.triad_group_id = g.id) NOT BETWEEN 2 AND 3
     OR EXISTS (SELECT 1 FROM public.triad_group_members m JOIN public.programme_enrollments e ON e.id = m.enrollment_id
                WHERE m.triad_group_id = g.id AND (e.cohort_id IS DISTINCT FROM d.cohort_id OR e.programme_id IS DISTINCT FROM d.programme_id));
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'invalid Triad groups: %', bad; END IF;
  SELECT string_agg(enrollment_id::text, ', ') INTO bad FROM (
    SELECT m.enrollment_id FROM public.triad_group_members m JOIN public.triad_groups g ON g.id = m.triad_group_id
    WHERE g.is_active GROUP BY m.enrollment_id, g.cohort_requirement_date_id HAVING count(*) > 1) x;
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'enrollments in several active groups for one Triad requirement: %', bad; END IF;
  IF to_regprocedure('public.triad_cohort_candidates_internal(uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'the cohort-scoped assignment pool still exists';
  END IF;

  -- Sessions and evidence: historical membership owns every live session.
  SELECT count(*) INTO n FROM public.triad_sessions s
  WHERE s.status <> 'cancelled' AND s.scheduled_start_time IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.triad_group_members m WHERE m.triad_group_id = s.triad_group_id
                AND NOT EXISTS (SELECT 1 FROM public.session_activity_attributions a
                                WHERE a.source_activity_type = 'triad' AND a.source_activity_id = s.id AND a.enrollment_id = m.enrollment_id));
  IF n > 0 THEN RAISE EXCEPTION '% live sessions missing member evidence', n; END IF;
  SELECT count(*) INTO n FROM public.session_activity_attributions a
  WHERE a.source_activity_type = 'triad'
    AND (a.milestone_id IS NOT NULL
         OR NOT EXISTS (SELECT 1 FROM public.triad_sessions s JOIN public.triad_group_members m ON m.triad_group_id = s.triad_group_id
                        WHERE s.id = a.source_activity_id AND m.enrollment_id = a.enrollment_id AND s.scheduled_start_time::date = a.occurred_on));
  IF n > 0 THEN RAISE EXCEPTION '% Triad evidence rows not owned by historical membership / dated on the session / free of requirement links', n; END IF;
  SELECT count(*) INTO n FROM (SELECT triad_group_id FROM public.triad_sessions WHERE status IN ('proposed', 'confirmed') GROUP BY 1 HAVING count(*) > 1) x;
  IF n > 0 THEN RAISE EXCEPTION '% groups with more than one open session', n; END IF;

  -- Legacy mirror: membership still equals the archived slot enrollments (nothing rewritten history).
  SELECT count(*) INTO n FROM public.triad_groups g
  WHERE g.enrollment_1_id IS NOT NULL
    AND ARRAY(SELECT x FROM unnest(ARRAY[g.enrollment_1_id, g.enrollment_2_id, g.enrollment_3_id]) x WHERE x IS NOT NULL ORDER BY x)
        IS DISTINCT FROM ARRAY(SELECT m.enrollment_id FROM public.triad_group_members m WHERE m.triad_group_id = g.id ORDER BY m.enrollment_id);
  IF n > 0 THEN RAISE EXCEPTION '% legacy groups whose membership differs from their slot enrollments', n; END IF;

  -- One completion rule: the Triad projection equals canonical module progress for every enrollment.
  SELECT count(*) INTO n
  FROM public.programme_enrollments e
  JOIN LATERAL (SELECT * FROM public.canonical_module_progress(e.id, current_date) p WHERE p.module = 'triads'::public.programme_module_type) p ON true
  CROSS JOIN LATERAL public.canonical_triad_completion(e.id, current_date) c
  WHERE (c.required_units, c.completed_by_as_of, c.completed_units, c.due_units, c.overdue_units, c.booked_units, c.pace_status)
        IS DISTINCT FROM (p.required_units, p.completed_activity_units, p.completed_units, p.due_units, p.overdue_units, p.booked_units, p.pace_status);
  IF n > 0 THEN RAISE EXCEPTION '% enrollments where the Triad projection differs from canonical progress', n; END IF;

  -- Runtime: nothing reads a retired Triad field (deployment 2 can drop them).
  SELECT string_agg(p.proname, ', ') INTO bad
  FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
  WHERE ns.nspname = 'public' AND p.prokind = 'f' AND p.proname <> 'triad_is_seed_identifier'
    AND pg_get_functiondef(p.oid) ~ '(coach|coachee|observer)_enrollment_id|member_[123]_(id|response)|enrollment_[123]_id|[a-z]\.(learned|will_use)_as_(coach|coachee|observer)|completion_deadline|programme_triad_rounds|public\.triad_rounds|triad_round_id';
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'functions still read retired Triad fields: %', bad; END IF;

  -- No REAL/UNKNOWN data was removed without a reviewed decision.
  SELECT count(*) INTO n FROM public.triad_cutover_archive a
  WHERE a.object_name = 'cleanup.triad_groups' AND a.payload->>'classification' = 'REAL/UNKNOWN'
    AND NOT EXISTS (SELECT 1 FROM public.triad_cutover_review_decisions d WHERE d.triad_group_id = a.record_id);
  IF n > 0 THEN RAISE EXCEPTION '% REAL/UNKNOWN groups removed without a reviewed decision', n; END IF;

  RAISE NOTICE 'Triad requirement-group correction verification PASSED';
END $$;

\echo '== Canonical Triad completion per enrollment, with each requirement''s group and fulfilment'
SELECT c.enrollment_id, c.required_units, c.raw_completed_sessions, c.completed_units, c.due_units, c.overdue_units, c.next_due_on,
  (SELECT string_agg('Triad ' || (x->>'milestone') || ': ' || CASE WHEN (x->>'fulfilled')::boolean THEN 'fulfilled ' || (x->>'fulfilled_on')
     WHEN x->>'triad_group_id' IS NULL THEN 'no group' ELSE 'group ' || left(x->>'triad_group_id', 8) END, '; ' ORDER BY (x->>'milestone')::int)
   FROM jsonb_array_elements(c.schedule) x) AS requirements
FROM public.programme_enrollments e CROSS JOIN LATERAL public.canonical_triad_completion(e.id, current_date) c
WHERE c.required_units > 0 AND EXISTS (SELECT 1 FROM public.triad_group_members m WHERE m.enrollment_id = e.id)
ORDER BY 1;

\echo ''
\echo '== Evidence: group composition per Triad requirement (Triad 1 vs Triad 2 ... may differ)'
SELECT d.cohort_id, d.ordinal AS triad, right(g.id::text, 12) AS group_id,
       count(m.enrollment_id) AS members,
       string_agg(right(m.enrollment_id::text, 12), '+' ORDER BY m.enrollment_id) AS composition
FROM public.triad_groups g
JOIN public.cohort_requirement_dates d ON d.id = g.cohort_requirement_date_id
LEFT JOIN public.triad_group_members m ON m.triad_group_id = g.id
WHERE g.is_active
GROUP BY d.cohort_id, d.ordinal, g.id
ORDER BY d.cohort_id, d.ordinal, group_id;

\echo ''
\echo '== Evidence: learners grouped for more than one Triad requirement, and whether their partners changed'
WITH per_req AS (
  SELECT m.enrollment_id, d.cohort_id, d.ordinal,
         (SELECT string_agg(right(o.enrollment_id::text, 12), '+' ORDER BY o.enrollment_id)
          FROM public.triad_group_members o
          WHERE o.triad_group_id = g.id AND o.enrollment_id <> m.enrollment_id) AS partners
  FROM public.triad_group_members m
  JOIN public.triad_groups g ON g.id = m.triad_group_id AND g.is_active
  JOIN public.cohort_requirement_dates d ON d.id = g.cohort_requirement_date_id
)
SELECT enrollment_id, cohort_id,
       count(*) AS requirements_grouped,
       string_agg('Triad ' || ordinal || ': ' || coalesce(partners, '(alone)'), '; ' ORDER BY ordinal) AS partners_by_requirement,
       count(DISTINCT coalesce(partners, '')) > 1 AS partners_differ
FROM per_req
GROUP BY enrollment_id, cohort_id
HAVING count(*) > 1
ORDER BY 1;

ROLLBACK;
