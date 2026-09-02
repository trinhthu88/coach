-- Phase 0 (programme-module unification), part 4: point the sponsor_*
-- aggregate functions at programme_enrollments.user_id instead of
-- coachee_id, now that unification has added it (20260903100100_*).
-- Output column names are unchanged (coachee_id stays coachee_id) since
-- the frontend types (SponsorRosterRow etc.) key off them directly.

CREATE OR REPLACE FUNCTION public.sponsor_roster()
RETURNS TABLE (
  enrollment_id uuid,
  coachee_id uuid,
  full_name text,
  cohort_name text,
  enrollment_status public.enrollment_status,
  progress_pct integer,
  sessions_completed integer,
  sessions_entitled integer,
  goal_growth numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    pe.id AS enrollment_id,
    pe.user_id AS coachee_id,
    p.full_name,
    c.name AS cohort_name,
    pe.status AS enrollment_status,
    pe.progress_pct,
    (
      SELECT COUNT(*)::int FROM public.sessions s
      WHERE s.coachee_id = pe.user_id
        AND s.status = 'completed'
        AND s.start_time >= pe.start_date
        AND (pe.end_date IS NULL OR s.start_time < pe.end_date + INTERVAL '1 day')
    ) AS sessions_completed,
    prog.coachee_session_limit AS sessions_entitled,
    (
      SELECT AVG(
        LEAST(100, GREATEST(0,
          ROUND((gr.current_rating - gr.start_rating)::numeric / GREATEST(1, gr.target_rating - gr.start_rating) * 100)
        ))
      )
      FROM public.coachee_goals g
      JOIN public.coachee_goal_ratings gr ON gr.goal_id = g.id
      WHERE g.coachee_id = pe.user_id
    ) AS goal_growth
  FROM public.programme_enrollments pe
  JOIN public.profiles p ON p.id = pe.user_id
  JOIN public.programmes prog ON prog.id = pe.programme_id
  LEFT JOIN public.cohorts c ON c.id = pe.cohort_id
  WHERE pe.organization_id IS NOT NULL
    AND pe.organization_id = public.get_sponsor_org(auth.uid())
  ORDER BY p.full_name;
$$;

CREATE OR REPLACE FUNCTION public.sponsor_goal_growth_summary()
RETURNS TABLE (
  avg_growth numeric,
  pct_progressing numeric,
  enrolled_leaders_count integer,
  hit_target_count integer,
  meaningful_progress_count integer,
  just_started_count integer,
  flat_declined_count integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _org uuid := public.get_sponsor_org(auth.uid());
  _leader_count integer;
BEGIN
  IF _org IS NULL THEN
    RETURN;
  END IF;

  SELECT COUNT(DISTINCT pe.user_id) INTO _leader_count
  FROM public.programme_enrollments pe
  WHERE pe.organization_id = _org;

  RETURN QUERY
  WITH leader_pct AS (
    SELECT
      pe.user_id,
      AVG(
        LEAST(100, GREATEST(0,
          ROUND((gr.current_rating - gr.start_rating)::numeric / GREATEST(1, gr.target_rating - gr.start_rating) * 100)
        ))
      ) AS pct
    FROM public.programme_enrollments pe
    JOIN public.coachee_goals g ON g.coachee_id = pe.user_id
    JOIN public.coachee_goal_ratings gr ON gr.goal_id = g.id
    WHERE pe.organization_id = _org
    GROUP BY pe.user_id
  ),
  raw_growth AS (
    SELECT gr.current_rating - gr.start_rating AS growth
    FROM public.programme_enrollments pe
    JOIN public.coachee_goals g ON g.coachee_id = pe.user_id
    JOIN public.coachee_goal_ratings gr ON gr.goal_id = g.id
    WHERE pe.organization_id = _org
  )
  SELECT
    (SELECT AVG(growth) FROM raw_growth),
    CASE WHEN _leader_count > 0
      THEN 100.0 * (SELECT COUNT(*) FROM leader_pct WHERE pct >= 50) / _leader_count
      ELSE NULL
    END,
    _leader_count,
    CASE WHEN _leader_count >= public.sponsor_min_leaders_for_distribution()
      THEN (SELECT COUNT(*)::int FROM leader_pct WHERE pct >= 100) ELSE NULL END,
    CASE WHEN _leader_count >= public.sponsor_min_leaders_for_distribution()
      THEN (SELECT COUNT(*)::int FROM leader_pct WHERE pct >= 50 AND pct < 100) ELSE NULL END,
    CASE WHEN _leader_count >= public.sponsor_min_leaders_for_distribution()
      THEN (SELECT COUNT(*)::int FROM leader_pct WHERE pct > 0 AND pct < 50) ELSE NULL END,
    CASE WHEN _leader_count >= public.sponsor_min_leaders_for_distribution()
      THEN (SELECT COUNT(*)::int FROM leader_pct WHERE pct <= 0) ELSE NULL END;
END;
$$;

CREATE OR REPLACE FUNCTION public.sponsor_satisfaction_summary()
RETURNS TABLE (
  avg_rating numeric,
  rated_session_count integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH org_sessions AS (
    SELECT DISTINCT ON (s.id) s.id, s.coachee_rating
    FROM public.sessions s
    JOIN public.programme_enrollments pe ON pe.user_id = s.coachee_id
    WHERE pe.organization_id IS NOT NULL
      AND pe.organization_id = public.get_sponsor_org(auth.uid())
      AND s.status = 'completed'
      AND s.start_time >= pe.start_date
      AND (pe.end_date IS NULL OR s.start_time < pe.end_date + INTERVAL '1 day')
      AND s.coachee_rating IS NOT NULL
  )
  SELECT AVG(coachee_rating), COUNT(*)::int FROM org_sessions;
$$;

CREATE OR REPLACE FUNCTION public.sponsor_kpis()
RETURNS TABLE (
  leaders_enrolled integer,
  on_track_count integer,
  at_risk_count integer,
  sessions_used integer,
  sessions_entitled integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH org_enrollments AS (
    SELECT pe.*, prog.coachee_session_limit
    FROM public.programme_enrollments pe
    JOIN public.programmes prog ON prog.id = pe.programme_id
    WHERE pe.organization_id IS NOT NULL
      AND pe.organization_id = public.get_sponsor_org(auth.uid())
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
    (SELECT COUNT(DISTINCT user_id)::int FROM org_enrollments WHERE status = 'at_risk'),
    (SELECT COUNT(*)::int FROM org_sessions),
    (SELECT COALESCE(SUM(coachee_session_limit), 0)::int FROM org_enrollments WHERE status = 'active');
$$;

CREATE OR REPLACE FUNCTION public.sponsor_timeline()
RETURNS TABLE (
  earliest_start date,
  latest_end date,
  programme_names text[]
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    MIN(pe.start_date),
    MAX(COALESCE(pe.end_date, c.end_date)),
    ARRAY_AGG(DISTINCT prog.name ORDER BY prog.name)
  FROM public.programme_enrollments pe
  JOIN public.programmes prog ON prog.id = pe.programme_id
  LEFT JOIN public.cohorts c ON c.id = pe.cohort_id
  WHERE pe.organization_id IS NOT NULL
    AND pe.organization_id = public.get_sponsor_org(auth.uid())
$$;

CREATE OR REPLACE FUNCTION public.sponsor_can_view_coachee(_coachee_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.programme_enrollments pe
    WHERE pe.user_id = _coachee_id
      AND pe.organization_id IS NOT NULL
      AND pe.organization_id = public.get_sponsor_org(auth.uid())
  );
$$;
