-- ============================================================
-- Sponsor aggregate data functions.
--
-- These are the ONLY way a sponsor account touches session/goal/rating
-- data. Each is scoped internally to get_sponsor_org(auth.uid()) — none
-- accept an organization id as a client-supplied parameter, so a sponsor
-- cannot request another org's data no matter what they pass in.
--
-- Deliberately NOT factored into a shared "org-scoped sessions" helper
-- function: a helper returning per-session (coachee_id, rating) rows would
-- itself be a raw-row leak if ever left callable directly via RPC. The
-- session/enrollment-window join is duplicated across sponsor_roster,
-- sponsor_satisfaction_summary, and sponsor_kpis instead — a few
-- duplicated lines are cheaper than a privilege-escalation footgun in
-- privacy-critical code.
--
-- Session attribution is scoped to the linked enrollment's start_date/
-- end_date window in all three functions that touch sessions, so a
-- leader's sessions from a prior, unlinked enrollment are never
-- attributed to this sponsor.
-- ============================================================

-- Named constant (Postgres has no true constants outside of functions) for
-- the minimum enrolled-leader count before the goal-growth distribution is
-- shown. Below this, a 4-bucket histogram over 3-4 people can de-anonymize
-- an individual by elimination.
CREATE OR REPLACE FUNCTION public.sponsor_min_leaders_for_distribution()
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT 5
$$;

-- ============================================================
-- sponsor_roster: one row per programme_enrollment linked to the
-- sponsor's org (a leader re-enrolled a second time in the same org shows
-- as two rows — two programme journeys, not a bug).
-- ============================================================
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
    pe.coachee_id,
    p.full_name,
    c.name AS cohort_name,
    pe.status AS enrollment_status,
    pe.progress_pct,
    (
      SELECT COUNT(*)::int FROM public.sessions s
      WHERE s.coachee_id = pe.coachee_id
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
      WHERE g.coachee_id = pe.coachee_id
    ) AS goal_growth
  FROM public.programme_enrollments pe
  JOIN public.profiles p ON p.id = pe.coachee_id
  JOIN public.programmes prog ON prog.id = pe.programme_id
  LEFT JOIN public.cohorts c ON c.id = pe.cohort_id
  WHERE pe.organization_id IS NOT NULL
    AND pe.organization_id = public.get_sponsor_org(auth.uid())
  ORDER BY p.full_name;
$$;

-- ============================================================
-- sponsor_goal_growth_summary
-- ============================================================
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

  SELECT COUNT(DISTINCT pe.coachee_id) INTO _leader_count
  FROM public.programme_enrollments pe
  WHERE pe.organization_id = _org;

  RETURN QUERY
  WITH leader_pct AS (
    SELECT
      pe.coachee_id,
      AVG(
        LEAST(100, GREATEST(0,
          ROUND((gr.current_rating - gr.start_rating)::numeric / GREATEST(1, gr.target_rating - gr.start_rating) * 100)
        ))
      ) AS pct
    FROM public.programme_enrollments pe
    JOIN public.coachee_goals g ON g.coachee_id = pe.coachee_id
    JOIN public.coachee_goal_ratings gr ON gr.goal_id = g.id
    WHERE pe.organization_id = _org
    GROUP BY pe.coachee_id
  ),
  raw_growth AS (
    SELECT gr.current_rating - gr.start_rating AS growth
    FROM public.programme_enrollments pe
    JOIN public.coachee_goals g ON g.coachee_id = pe.coachee_id
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

-- ============================================================
-- sponsor_satisfaction_summary: sessions table ONLY. peer_sessions is
-- practice between coaches, not something a sponsor's leaders participate
-- in, and no UI in this app ever writes peer_sessions.coachee_rating.
-- ============================================================
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
    JOIN public.programme_enrollments pe ON pe.coachee_id = s.coachee_id
    WHERE pe.organization_id IS NOT NULL
      AND pe.organization_id = public.get_sponsor_org(auth.uid())
      AND s.status = 'completed'
      AND s.start_time >= pe.start_date
      AND (pe.end_date IS NULL OR s.start_time < pe.end_date + INTERVAL '1 day')
      AND s.coachee_rating IS NOT NULL
  )
  SELECT AVG(coachee_rating), COUNT(*)::int FROM org_sessions;
$$;

-- ============================================================
-- sponsor_kpis
-- ============================================================
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
    JOIN org_enrollments pe ON pe.coachee_id = s.coachee_id
    WHERE s.status = 'completed'
      AND s.start_time >= pe.start_date
      AND (pe.end_date IS NULL OR s.start_time < pe.end_date + INTERVAL '1 day')
  )
  SELECT
    (SELECT COUNT(DISTINCT coachee_id)::int FROM org_enrollments),
    (SELECT COUNT(DISTINCT coachee_id)::int FROM org_enrollments WHERE status = 'active'),
    (SELECT COUNT(DISTINCT coachee_id)::int FROM org_enrollments WHERE status = 'at_risk'),
    (SELECT COUNT(*)::int FROM org_sessions),
    (SELECT COALESCE(SUM(coachee_session_limit), 0)::int FROM org_enrollments WHERE status = 'active');
$$;

-- ============================================================
-- sponsor_timeline: one summary row (earliest start, latest end, and the
-- distinct programme names involved) rather than one row per cohort,
-- matching the dashboard's single timeline card.
-- ============================================================
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

-- ============================================================
-- Grants: explicit hygiene, matching the existing get_primary_role
-- precedent. Not the primary security boundary (every function above
-- already returns nothing for a non-sponsor caller via the
-- get_sponsor_org() NULL-guard), but there's no reason to leave RPC
-- execute open to the anon role.
-- ============================================================
REVOKE EXECUTE ON FUNCTION public.sponsor_roster() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.sponsor_goal_growth_summary() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.sponsor_satisfaction_summary() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.sponsor_kpis() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.sponsor_timeline() FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.sponsor_roster() TO authenticated;
GRANT EXECUTE ON FUNCTION public.sponsor_goal_growth_summary() TO authenticated;
GRANT EXECUTE ON FUNCTION public.sponsor_satisfaction_summary() TO authenticated;
GRANT EXECUTE ON FUNCTION public.sponsor_kpis() TO authenticated;
GRANT EXECUTE ON FUNCTION public.sponsor_timeline() TO authenticated;
