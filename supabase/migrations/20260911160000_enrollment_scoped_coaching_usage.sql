-- Replace the person-scoped coaching usage callable with an enrollment-scoped
-- version.  A user may have multiple historical enrollments, so neither the
-- limit nor usage may be aggregated by person.
CREATE OR REPLACE FUNCTION public.get_coachee_session_usage_for_enrollment(
  p_enrollment_id uuid
)
RETURNS TABLE(monthly_limit integer, used_this_month integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH selected AS (
    SELECT e.id, e.programme_id, e.user_id
    FROM public.programme_enrollments e
    WHERE e.id = p_enrollment_id
      AND e.status IN ('active'::public.enrollment_status, 'at_risk'::public.enrollment_status)
      AND (
        e.user_id = auth.uid()
        OR public.has_role(auth.uid(), 'admin'::public.app_role)
        OR public.coach_has_client(auth.uid(), e.user_id)
      )
  ),
  config AS (
    SELECT NULLIF(
      COALESCE(pm.config->>'receive_limit', pm.config->>'monthly_limit'), ''
    )::integer AS session_limit
    FROM selected e
    JOIN public.programme_modules pm
      ON pm.programme_id = e.programme_id
     AND pm.module = 'coaching'::public.programme_module_type
     AND pm.enabled
  )
  SELECT c.session_limit,
    (SELECT count(*)::integer
     FROM public.sessions s
     WHERE s.enrollment_id = e.id
       AND s.coachee_id = e.user_id
       AND s.status = 'completed')
  FROM selected e
  LEFT JOIN config c ON true;
$$;

REVOKE ALL ON FUNCTION public.get_coachee_session_usage_for_enrollment(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_coachee_session_usage_for_enrollment(uuid)
  TO authenticated;

-- No application caller uses the legacy person-scoped surface anymore.
REVOKE ALL ON FUNCTION public.get_coachee_session_usage(uuid)
  FROM PUBLIC, anon, authenticated;
DROP FUNCTION IF EXISTS public.get_coachee_session_usage(uuid);