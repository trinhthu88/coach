-- Two new sponsor RPCs for the dashboard's Satisfaction Trend chart and
-- Coach Utilisation panel. Same SECURITY DEFINER / get_sponsor_org()
-- pattern as every other sponsor_* function (20260811110000,
-- 20260903140000) — written with the cohort-organization_id fallback
-- (COALESCE(pe.organization_id, c.organization_id)) from the start rather
-- than the enrollment-only check the rest of that surface originally
-- shipped with; see 20260908110000_sponsor_visibility_cohort_fallback.sql
-- for why that fallback matters (a cohort tagged with an organisation is
-- otherwise invisible to that org's sponsor).
--
-- Spec said "group by created_at" for the trend — using sessions.start_time
-- instead: that's when the session actually happened, not when the row was
-- inserted (e.g. at booking time), which is what "monthly ratings trend"
-- should track. Matches the field sponsor_satisfaction_summary() already
-- scopes by.

CREATE OR REPLACE FUNCTION public.sponsor_satisfaction_trend()
RETURNS TABLE(month_start date, avg_rating numeric, rated_session_count integer)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH org_sessions AS (
    SELECT DISTINCT ON (s.id) s.id, s.coachee_rating, s.start_time
    FROM public.sessions s
    JOIN public.programme_enrollments pe ON pe.user_id = s.coachee_id
    LEFT JOIN public.cohorts c ON c.id = pe.cohort_id
    WHERE COALESCE(pe.organization_id, c.organization_id) IS NOT NULL
      AND COALESCE(pe.organization_id, c.organization_id) = public.get_sponsor_org(auth.uid())
      AND s.status = 'completed'
      AND s.coachee_rating IS NOT NULL
      AND s.start_time >= date_trunc('month', now()) - INTERVAL '5 months'
  )
  SELECT
    date_trunc('month', start_time)::date AS month_start,
    ROUND(AVG(coachee_rating), 1) AS avg_rating,
    COUNT(*)::int AS rated_session_count
  FROM org_sessions
  GROUP BY date_trunc('month', start_time)
  ORDER BY 1;
$function$;

CREATE OR REPLACE FUNCTION public.sponsor_coach_utilisation()
RETURNS TABLE(coach_name text, completed_sessions integer)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH org_sessions AS (
    SELECT DISTINCT ON (s.id) s.id, s.coach_id
    FROM public.sessions s
    JOIN public.programme_enrollments pe ON pe.user_id = s.coachee_id
    LEFT JOIN public.cohorts c ON c.id = pe.cohort_id
    WHERE COALESCE(pe.organization_id, c.organization_id) IS NOT NULL
      AND COALESCE(pe.organization_id, c.organization_id) = public.get_sponsor_org(auth.uid())
      AND s.status = 'completed'
  )
  SELECT p.full_name, COUNT(*)::int AS completed_sessions
  FROM org_sessions os
  JOIN public.profiles p ON p.id = os.coach_id
  GROUP BY p.full_name
  ORDER BY COUNT(*) DESC
  LIMIT 8;
$function$;

REVOKE EXECUTE ON FUNCTION public.sponsor_satisfaction_trend() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sponsor_satisfaction_trend() TO authenticated;
REVOKE EXECUTE ON FUNCTION public.sponsor_coach_utilisation() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sponsor_coach_utilisation() TO authenticated;
