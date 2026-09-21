-- P0-3: the Coach reads programme progress AND status from the canonical chain.
--
-- coach_canonical_enrollment_progress already returned completion, but the
-- Coach client list still derived a status of its own (overdue actions >= 5 ->
-- at risk, >= 1 -> needs attention) -- a second definition of "status" that no
-- other role shared. It now also returns the canonical pace_status (and the
-- effective enrollment status Admin and Sponsor show), straight from
-- canonical_enrollment_progress, so the Coach sees the same completion % and
-- the same status as the Learner, Admin and Sponsor for that enrollment.
--
-- Authorization joins through the coach's COHORT ASSIGNMENT
-- (cohort_coach_assignments for the enrollment's cohort) or a confirmed /
-- completed coaching session on the enrollment. The coach's client list is
-- still "the people I coach"; the assignment path only stops a newly assigned
-- coach from being refused before a first session exists.
DROP FUNCTION IF EXISTS public.coach_canonical_enrollment_progress(uuid[], date);
CREATE FUNCTION public.coach_canonical_enrollment_progress(p_enrollment_ids uuid[], p_as_of date DEFAULT CURRENT_DATE)
RETURNS TABLE(enrollment_id uuid, required_units integer, completed_units integer, due_units integer,
              overdue_units integer, full_completion_pct numeric, pace_status text,
              effective_enrollment_status public.enrollment_status, progress_available boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT p.enrollment_id, p.required_units, p.completed_units, p.due_units, p.overdue_units,
         p.full_completion_pct, p.pace_status, p.effective_enrollment_status, p.progress_available
  FROM (SELECT DISTINCT unnest(p_enrollment_ids) AS id) requested
  JOIN public.programme_enrollments e ON e.id = requested.id
  CROSS JOIN LATERAL public.canonical_enrollment_progress(requested.id, p_as_of) p
  WHERE auth.uid() IS NOT NULL
    AND (
      EXISTS (
        SELECT 1 FROM public.cohort_coach_assignments a
        WHERE a.cohort_id = e.cohort_id AND a.coach_id = auth.uid()
      )
      OR EXISTS (
        SELECT 1 FROM public.sessions s
        WHERE s.enrollment_id = requested.id
          AND s.coach_id = auth.uid()
          AND s.status IN ('confirmed', 'completed')
      )
    );
$$;
REVOKE ALL ON FUNCTION public.coach_canonical_enrollment_progress(uuid[], date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.coach_canonical_enrollment_progress(uuid[], date) TO authenticated;

COMMENT ON FUNCTION public.coach_canonical_enrollment_progress(uuid[], date) IS
  'Canonical completion and status (pace_status, effective_enrollment_status) for enrollments the caller coaches '
  '(cohort assignment or a coaching session). Same numbers and status as learner/admin/sponsor.';
