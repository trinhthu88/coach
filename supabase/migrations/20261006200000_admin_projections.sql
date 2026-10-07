-- ===========================================================================
-- Admin projections (Prompt 9d: A-1, A-5, A-6, A-7, A-8, P-4, P-17)
--
--   1. admin_canonical_completion_rate(): Admin's completion rate is summed
--      like Sponsor's -- least(completed, required) units over required units
--      across the enrollments -- computed in SQL. The Admin Dashboard and
--      Analytics averaged per-enrollment percentages in the browser, which
--      weighs a 1-unit programme like a 12-unit one.
--   2. is_active_cohort_mentor(): a Mentor is a Coach with an active
--      cohort_mentors row (20260921200000). The mentoring routes admit them on
--      that, not only on the caller's own programme module.
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.admin_canonical_completion_rate(
  p_enrollment_ids uuid[], p_as_of date DEFAULT public.programme_today())
 RETURNS TABLE(enrollment_count integer, required_units integer, completed_units integer, full_completion_pct numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Only an Admin may read the completion rate' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  WITH rows AS (
    SELECT p.required_units, p.completed_units
    FROM (SELECT DISTINCT unnest(p_enrollment_ids) AS id) requested
    CROSS JOIN LATERAL public.canonical_enrollment_progress(requested.id, p_as_of) p
    WHERE p.progress_available
  ), totals AS (
    SELECT count(*)::integer AS n,
      coalesce(sum(r.required_units), 0)::integer AS required,
      coalesce(sum(r.completed_units), 0)::integer AS completed
    FROM rows r
  )
  -- The Sponsor cohort / organisation formula.
  SELECT t.n, t.required, t.completed,
    CASE WHEN t.required = 0 THEN NULL ELSE round(least(t.completed, t.required) * 100.0 / t.required, 1) END
  FROM totals t;
END;
$function$;
REVOKE ALL ON FUNCTION public.admin_canonical_completion_rate(uuid[], date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_canonical_completion_rate(uuid[], date) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.is_active_cohort_mentor()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.cohort_mentors m
    WHERE m.mentor_user_id = auth.uid() AND m.is_active);
$function$;
REVOKE ALL ON FUNCTION public.is_active_cohort_mentor() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_active_cohort_mentor() TO authenticated, service_role;
