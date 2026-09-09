-- sponsor_kpis().on_track_count previously just meant "enrollment_status =
-- 'active'" — i.e. "enrolled and not flagged," not actual engagement. That
-- reading is kept as enrolled_active_count (renamed, identical logic); a
-- new on_track_count now means real engagement: a leader who has completed
-- the skill card for every week that's been open at least 3 days (a grace
-- window so a week that unlocked yesterday doesn't immediately count
-- against them).
--
-- DROP first: adds an output column (enrolled_active_count) to
-- RETURNS TABLE, which CREATE OR REPLACE cannot do (SQLSTATE 42P13).
DROP FUNCTION IF EXISTS public.sponsor_kpis(uuid);

CREATE FUNCTION public.sponsor_kpis(p_cohort_id uuid DEFAULT NULL)
RETURNS TABLE(
  leaders_enrolled integer,
  enrolled_active_count integer,
  on_track_count integer,
  at_risk_count integer,
  sessions_used integer,
  sessions_entitled integer
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH org_enrollments AS (
    SELECT pe.*, prog.coachee_session_limit, c.start_date AS cohort_start_date
    FROM public.programme_enrollments pe
    JOIN public.programmes prog ON prog.id = pe.programme_id
    LEFT JOIN public.cohorts c ON c.id = pe.cohort_id
    WHERE COALESCE(pe.organization_id, c.organization_id) IS NOT NULL
      AND COALESCE(pe.organization_id, c.organization_id) = public.get_sponsor_org(auth.uid())
      AND (p_cohort_id IS NULL OR pe.cohort_id = p_cohort_id)
  ),
  org_sessions AS (
    SELECT DISTINCT ON (s.id) s.id
    FROM public.sessions s
    JOIN org_enrollments pe ON pe.user_id = s.coachee_id
    WHERE s.status = 'completed'
      AND s.start_time >= pe.start_date
      AND (pe.end_date IS NULL OR s.start_time < pe.end_date + INTERVAL '1 day')
  )
  SELECT
    (SELECT COUNT(DISTINCT user_id)::int FROM org_enrollments),
    (SELECT COUNT(DISTINCT user_id)::int FROM org_enrollments WHERE status = 'active'),
    (
      SELECT COUNT(DISTINCT pe.user_id)::int FROM org_enrollments pe
      WHERE NOT EXISTS (
        SELECT 1 FROM public.training_weeks tw
        LEFT JOIN public.cohort_week_overrides cwo
          ON cwo.cohort_id = pe.cohort_id AND cwo.training_week_id = tw.id
        WHERE tw.programme_id = pe.programme_id
          AND tw.is_visible = true
          AND COALESCE(
                cwo.unlock_date,
                CASE WHEN pe.cohort_id IS NOT NULL
                  THEN (pe.cohort_start_date + ((tw.week_number - 1) * INTERVAL '7 days'))::date
                  ELSE NULL
                END,
                tw.unlock_date
              ) <= CURRENT_DATE - INTERVAL '3 days'
          AND NOT EXISTS (
            SELECT 1 FROM public.training_progress tp
            WHERE tp.user_id = pe.user_id
              AND tp.training_week_id = tw.id
              AND tp.completed_at IS NOT NULL
          )
      )
    ),
    (SELECT COUNT(DISTINCT user_id)::int FROM org_enrollments WHERE status = 'at_risk'),
    (SELECT COUNT(*)::int FROM org_sessions),
    (SELECT COALESCE(SUM(coachee_session_limit), 0)::int FROM org_enrollments WHERE status = 'active');
$function$;

REVOKE EXECUTE ON FUNCTION public.sponsor_kpis(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sponsor_kpis(uuid) TO authenticated;
