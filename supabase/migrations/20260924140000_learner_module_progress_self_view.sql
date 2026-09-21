-- Learner self-view of canonical_module_progress, including overdue units.
--
-- 20260918180000 revoked canonical_module_progress from `authenticated`
-- (it is the internal engine, not a client read), but four learner hooks
-- (dashboard Coaching and Mentoring cards, My Journey programme usage, the
-- canonical Coaching page) still called it directly, so each failed with
-- "permission denied" and rendered empty. learner_canonical_module_progress
-- is the existing learner wrapper, but it predates overdue_units and reads
-- the older get_sponsor_programme_progress projection.
--
-- learner_module_progress exposes exactly the engine's rows -- the same ones
-- canonical_enrollment_progress sums for "% complete" and the Overdue KPI --
-- for the caller's own enrollment only.

CREATE OR REPLACE FUNCTION public.learner_module_progress(p_enrollment_id uuid, p_as_of date DEFAULT CURRENT_DATE)
RETURNS TABLE(module public.programme_module_type, required_units integer, completed_units integer,
              completed_activity_units integer, due_units integer, booked_units integer,
              overdue_units integer, pace_status text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT g.module, g.required_units, g.completed_units, g.completed_activity_units,
         g.due_units, g.booked_units, g.overdue_units, g.pace_status
  FROM public.programme_enrollments e
  CROSS JOIN LATERAL public.canonical_module_progress(e.id, p_as_of) g
  WHERE e.id = p_enrollment_id
    AND e.user_id = auth.uid()
    AND auth.uid() IS NOT NULL
  ORDER BY g.module;
$$;

REVOKE ALL ON FUNCTION public.learner_module_progress(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.learner_module_progress(uuid, date) TO authenticated;

COMMENT ON FUNCTION public.learner_module_progress(uuid, date) IS
  'Own-enrollment canonical_module_progress rows (required/completed/due/booked/overdue per module).';
