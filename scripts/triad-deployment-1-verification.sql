-- Triad deployment 1 verification (READ-ONLY). Gate for deployment 2.
--
-- Run against production AFTER deployment 1 (20260918185800 ..
-- 20260918195000) and BEFORE moving supabase/deployment-2/ into
-- supabase/migrations:
--   psql "$PROD_DB_URL" -v ON_ERROR_STOP=1 -f scripts/triad-deployment-1-verification.sql
-- Needs a role that can execute the canonical functions (postgres); nothing
-- is written. Every check raises on failure; the last line says PASSED.

BEGIN TRANSACTION READ ONLY;

DO $$
DECLARE bad text; n bigint;
BEGIN
  -- Ledger: deployment 1 applied, deployment 2 not.
  SELECT string_agg(v, ', ') INTO bad FROM unnest(ARRAY['20260918185800', '20260918185850', '20260918185900', '20260918189000', '20260918190000', '20260918195000']) v
  WHERE NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations s WHERE s.version = v);
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'deployment 1 migrations missing from the ledger: %', bad; END IF;
  IF to_regclass('public.triad_rounds') IS NULL THEN RAISE EXCEPTION 'legacy storage already dropped (deployment 2 ran early)'; END IF;

  -- Groups: cohort-level, 2-3 members of the group's cohort, one active group per enrollment.
  SELECT string_agg(g.id::text, ', ') INTO bad FROM public.triad_groups g
  WHERE g.cohort_id IS NULL
     OR (SELECT count(*) FROM public.triad_group_members m WHERE m.triad_group_id = g.id) NOT BETWEEN 2 AND 3
     OR EXISTS (SELECT 1 FROM public.triad_group_members m JOIN public.programme_enrollments e ON e.id = m.enrollment_id
                WHERE m.triad_group_id = g.id AND e.cohort_id IS DISTINCT FROM g.cohort_id);
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'invalid Triad groups: %', bad; END IF;
  SELECT string_agg(enrollment_id::text, ', ') INTO bad FROM (
    SELECT m.enrollment_id FROM public.triad_group_members m JOIN public.triad_groups g ON g.id = m.triad_group_id
    WHERE g.is_active GROUP BY m.enrollment_id HAVING count(*) > 1) x;
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'enrollments in several active groups: %', bad; END IF;

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
    AND pg_get_functiondef(p.oid) ~ '(coach|coachee|observer)_enrollment_id|member_[123]_(id|response)|enrollment_[123]_id|[a-z]\.(learned|will_use)_as_(coach|coachee|observer)|completion_deadline|programme_triad_rounds|public\.triad_rounds|triad_round_id|cohort_requirement_date_id';
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'functions still read retired Triad fields: %', bad; END IF;

  -- No REAL/UNKNOWN data was removed without a reviewed decision.
  SELECT count(*) INTO n FROM public.triad_cutover_archive a
  WHERE a.object_name = 'cleanup.triad_groups' AND a.payload->>'classification' = 'REAL/UNKNOWN'
    AND NOT EXISTS (SELECT 1 FROM public.triad_cutover_review_decisions d WHERE d.triad_group_id = a.record_id);
  IF n > 0 THEN RAISE EXCEPTION '% REAL/UNKNOWN groups removed without a reviewed decision', n; END IF;

  RAISE NOTICE 'Triad deployment 1 verification PASSED';
END $$;

\echo '== Canonical Triad completion per enrollment (compare with the readiness report, section 5)'
SELECT c.enrollment_id, c.required_units, c.raw_completed_sessions, c.completed_units, c.due_units, c.overdue_units, c.next_due_on
FROM public.programme_enrollments e CROSS JOIN LATERAL public.canonical_triad_completion(e.id, current_date) c
WHERE c.required_units > 0 AND EXISTS (SELECT 1 FROM public.triad_group_members m WHERE m.enrollment_id = e.id)
ORDER BY 1;

ROLLBACK;
