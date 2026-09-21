-- Coach view of a client's programme completion reads THE canonical engine.
--
-- The Coach's client list and client dialog showed "N sessions · X%" where X
-- was the share of the client's goal milestones linked to this coach that
-- were ticked -- a number labelled like programme progress that disagreed
-- with the same learner's dashboard, Admin list and Sponsor portal. There was
-- no coach-callable canonical read, so the client computed its own.
--
-- coach_canonical_enrollment_progress returns canonical_enrollment_progress
-- (completed required units / required units) for exactly the enrollments in
-- which the caller coaches the learner (a confirmed or completed coaching
-- session on that enrollment). Only the completion facts are exposed -- the
-- coach needs the number, not the learner's full programme profile.

CREATE OR REPLACE FUNCTION public.coach_canonical_enrollment_progress(p_enrollment_ids uuid[], p_as_of date DEFAULT CURRENT_DATE)
RETURNS TABLE(enrollment_id uuid, required_units integer, completed_units integer, overdue_units integer,
              full_completion_pct numeric, progress_available boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT p.enrollment_id, p.required_units, p.completed_units, p.overdue_units,
         p.full_completion_pct, p.progress_available
  FROM (SELECT DISTINCT unnest(p_enrollment_ids) AS id) requested
  CROSS JOIN LATERAL public.canonical_enrollment_progress(requested.id, p_as_of) p
  WHERE auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.sessions s
      WHERE s.enrollment_id = requested.id
        AND s.coach_id = auth.uid()
        AND s.status IN ('confirmed', 'completed')
    );
$$;

REVOKE ALL ON FUNCTION public.coach_canonical_enrollment_progress(uuid[], date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.coach_canonical_enrollment_progress(uuid[], date) TO authenticated;

COMMENT ON FUNCTION public.coach_canonical_enrollment_progress(uuid[], date) IS
  'Canonical completion for enrollments the caller coaches. Same numbers as learner/admin/sponsor.';
