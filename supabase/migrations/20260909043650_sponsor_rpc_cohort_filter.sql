-- Adds an optional p_cohort_id filter to every sponsor_* RPC that
-- useSponsorCohortData.ts needs, so cohort-detail pages can fetch
-- cohort-scoped data server-side instead of over-fetching org-wide rows
-- and filtering them client-side.
--
-- DROP first, not plain CREATE OR REPLACE: every function below currently
-- takes zero parameters. CREATE OR REPLACE FUNCTION only replaces a
-- function whose *argument types* match exactly — a different parameter
-- list (even one that's all-DEFAULT) creates a second, distinct overload
-- instead of replacing the original. That would leave both foo() and
-- foo(uuid) defined; since p_cohort_id has a DEFAULT, PostgREST can no
-- longer tell which overload a bare no-arg RPC call means and returns a
-- "Could not choose the best candidate function" (PGRST203) error — i.e.
-- exactly the "breaking existing callers" outcome we're trying to avoid.
-- DROP + CREATE leaves exactly one signature per function, so every
-- existing zero-arg call site (useSponsorDashboardData.ts) keeps working
-- unchanged, same as when other sponsor_* migrations dropped first to
-- change a RETURNS TABLE column list (20260905100700, 20260905200000).
-- CREATE OR REPLACE is still used for functions that aren't in this
-- migration's scope so they're untouched.
--
-- The cohort filter is additive only: it's ANDed onto the existing
-- COALESCE(pe.organization_id, c.organization_id) = get_sponsor_org(...)
-- org-scoping check already on every function, never a replacement for
-- it. p_cohort_id NULL (the default) means "no cohort filter" — identical
-- behavior to before this migration.

-- added p_cohort_id filter 20260909043650
DROP FUNCTION IF EXISTS public.sponsor_min_leaders_for_distribution(uuid);
DROP FUNCTION IF EXISTS public.sponsor_min_leaders_for_distribution();
CREATE FUNCTION public.sponsor_min_leaders_for_distribution()
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT 5
$$;
REVOKE EXECUTE ON FUNCTION public.sponsor_min_leaders_for_distribution() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sponsor_min_leaders_for_distribution() TO authenticated;

-- added p_cohort_id filter 20260909043650
DROP FUNCTION IF EXISTS public.sponsor_roster();
CREATE FUNCTION public.sponsor_roster(p_cohort_id uuid DEFAULT NULL)
RETURNS TABLE(enrollment_id uuid, coachee_id uuid, full_name text, cohort_name text, enrollment_status enrollment_status, progress_pct integer, sessions_completed integer, sessions_entitled integer, goal_growth numeric)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
  WHERE COALESCE(pe.organization_id, c.organization_id) IS NOT NULL
    AND COALESCE(pe.organization_id, c.organization_id) = public.get_sponsor_org(auth.uid())
    AND (p_cohort_id IS NULL OR pe.cohort_id = p_cohort_id)
  ORDER BY p.full_name;
$function$;
REVOKE EXECUTE ON FUNCTION public.sponsor_roster(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sponsor_roster(uuid) TO authenticated;

-- added p_cohort_id filter 20260909043650
DROP FUNCTION IF EXISTS public.sponsor_kpis();
CREATE FUNCTION public.sponsor_kpis(p_cohort_id uuid DEFAULT NULL)
RETURNS TABLE(leaders_enrolled integer, on_track_count integer, at_risk_count integer, sessions_used integer, sessions_entitled integer)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH org_enrollments AS (
    SELECT pe.*, prog.coachee_session_limit
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
    (SELECT COUNT(DISTINCT user_id)::int FROM org_enrollments WHERE status = 'at_risk'),
    (SELECT COUNT(*)::int FROM org_sessions),
    (SELECT COALESCE(SUM(coachee_session_limit), 0)::int FROM org_enrollments WHERE status = 'active');
$function$;
REVOKE EXECUTE ON FUNCTION public.sponsor_kpis(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sponsor_kpis(uuid) TO authenticated;

-- added p_cohort_id filter 20260909043650
DROP FUNCTION IF EXISTS public.sponsor_goal_growth_summary();
CREATE FUNCTION public.sponsor_goal_growth_summary(p_cohort_id uuid DEFAULT NULL)
RETURNS TABLE(avg_growth numeric, pct_progressing numeric, enrolled_leaders_count integer, hit_target_count integer, meaningful_progress_count integer, just_started_count integer, flat_declined_count integer)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _org uuid := public.get_sponsor_org(auth.uid());
  _leader_count integer;
BEGIN
  IF _org IS NULL THEN
    RETURN;
  END IF;

  SELECT COUNT(DISTINCT pe.user_id) INTO _leader_count
  FROM public.programme_enrollments pe
  LEFT JOIN public.cohorts c ON c.id = pe.cohort_id
  WHERE COALESCE(pe.organization_id, c.organization_id) = _org
    AND (p_cohort_id IS NULL OR pe.cohort_id = p_cohort_id);

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
    LEFT JOIN public.cohorts c ON c.id = pe.cohort_id
    JOIN public.coachee_goals g ON g.coachee_id = pe.user_id
    JOIN public.coachee_goal_ratings gr ON gr.goal_id = g.id
    WHERE COALESCE(pe.organization_id, c.organization_id) = _org
      AND (p_cohort_id IS NULL OR pe.cohort_id = p_cohort_id)
    GROUP BY pe.user_id
  ),
  raw_growth AS (
    SELECT gr.current_rating - gr.start_rating AS growth
    FROM public.programme_enrollments pe
    LEFT JOIN public.cohorts c ON c.id = pe.cohort_id
    JOIN public.coachee_goals g ON g.coachee_id = pe.user_id
    JOIN public.coachee_goal_ratings gr ON gr.goal_id = g.id
    WHERE COALESCE(pe.organization_id, c.organization_id) = _org
      AND (p_cohort_id IS NULL OR pe.cohort_id = p_cohort_id)
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
$function$;
REVOKE EXECUTE ON FUNCTION public.sponsor_goal_growth_summary(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sponsor_goal_growth_summary(uuid) TO authenticated;

-- added p_cohort_id filter 20260909043650
DROP FUNCTION IF EXISTS public.sponsor_satisfaction_summary();
CREATE FUNCTION public.sponsor_satisfaction_summary(p_cohort_id uuid DEFAULT NULL)
RETURNS TABLE(avg_rating numeric, rated_session_count integer)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH org_sessions AS (
    SELECT DISTINCT ON (s.id) s.id, s.coachee_rating
    FROM public.sessions s
    JOIN public.programme_enrollments pe ON pe.user_id = s.coachee_id
    LEFT JOIN public.cohorts c ON c.id = pe.cohort_id
    WHERE COALESCE(pe.organization_id, c.organization_id) IS NOT NULL
      AND COALESCE(pe.organization_id, c.organization_id) = public.get_sponsor_org(auth.uid())
      AND (p_cohort_id IS NULL OR pe.cohort_id = p_cohort_id)
      AND s.status = 'completed'
      AND s.start_time >= pe.start_date
      AND (pe.end_date IS NULL OR s.start_time < pe.end_date + INTERVAL '1 day')
      AND s.coachee_rating IS NOT NULL
  )
  SELECT AVG(coachee_rating), COUNT(*)::int FROM org_sessions;
$function$;
REVOKE EXECUTE ON FUNCTION public.sponsor_satisfaction_summary(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sponsor_satisfaction_summary(uuid) TO authenticated;

-- added p_cohort_id filter 20260909043650
DROP FUNCTION IF EXISTS public.sponsor_programme_engagement();
CREATE FUNCTION public.sponsor_programme_engagement(p_cohort_id uuid DEFAULT NULL)
RETURNS TABLE(week_number integer, week_title text, skill_card_completion_pct numeric, quiz_avg_score numeric, quiz_completion_pct numeric, reflection_completion_pct numeric, triad_completion_pct numeric, triad_satisfaction_avg numeric, daily_prompt_response_rate numeric)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  -- Every downstream CTE (org_programmes, user_counts, skill_card, quiz_agg,
  -- reflection_agg, triad_metrics, prompt_agg) joins back through org_users,
  -- so filtering org_users by cohort is sufficient to cohort-scope the
  -- whole function — org_weeks stays programme-scoped (weeks aren't a
  -- per-cohort concept), which is correct: it just narrows who counts
  -- toward each week's completion percentages.
  WITH org_users AS (
    SELECT DISTINCT pe.user_id, pe.programme_id
    FROM public.programme_enrollments pe
    LEFT JOIN public.cohorts c ON c.id = pe.cohort_id
    WHERE COALESCE(pe.organization_id, c.organization_id) IS NOT NULL
      AND COALESCE(pe.organization_id, c.organization_id) = public.get_sponsor_org(auth.uid())
      AND (p_cohort_id IS NULL OR pe.cohort_id = p_cohort_id)
  ),
  org_programmes AS (
    SELECT DISTINCT programme_id FROM org_users
  ),
  user_counts AS (
    SELECT programme_id, COUNT(DISTINCT user_id) AS cnt FROM org_users GROUP BY programme_id
  ),
  org_weeks AS (
    SELECT tw.id AS week_id, tw.week_number, tw.title, tw.programme_id
    FROM public.training_weeks tw
    JOIN org_programmes op ON op.programme_id = tw.programme_id
    WHERE tw.is_visible = true
  ),
  skill_card AS (
    SELECT tp.training_week_id AS week_id, COUNT(DISTINCT tp.user_id) AS n
    FROM public.training_progress tp
    JOIN org_users ou ON ou.user_id = tp.user_id
    WHERE tp.completed_at IS NOT NULL
      AND tp.training_week_id IN (SELECT week_id FROM org_weeks)
    GROUP BY tp.training_week_id
  ),
  quiz_assignments AS (
    SELECT id, training_week_id FROM public.assignments
    WHERE assignment_type = 'quiz' AND is_visible = true
      AND training_week_id IN (SELECT week_id FROM org_weeks)
  ),
  quiz_agg AS (
    SELECT qa.training_week_id AS week_id,
      AVG(asub.score_pct) AS avg_score,
      COUNT(DISTINCT asub.user_id) AS n_submitted
    FROM quiz_assignments qa
    JOIN public.assignment_submissions asub ON asub.assignment_id = qa.id
    JOIN org_users ou ON ou.user_id = asub.user_id
    GROUP BY qa.training_week_id
  ),
  reflection_agg AS (
    SELECT
      pr.appears_at_week AS week_number,
      COUNT(DISTINCT rs.user_id) AS n_submitted
    FROM public.programme_reflections pr
    JOIN public.reflection_submissions rs ON rs.reflection_id = pr.id
    JOIN org_users ou ON ou.user_id = rs.user_id
      AND ou.programme_id = pr.programme_id
    WHERE pr.programme_id IN (SELECT programme_id FROM org_programmes)
      AND pr.is_visible = true
    GROUP BY pr.appears_at_week
  ),
  triad_metrics AS (
    SELECT
      ROUND(COUNT(*) FILTER (WHERE ts.status = 'completed')::numeric * 100.0 / NULLIF(COUNT(ts.id), 0), 1) AS completion_pct,
      AVG(tr.satisfaction_rating) FILTER (WHERE tr.satisfaction_rating IS NOT NULL) AS satisfaction_avg
    FROM public.triad_groups tg
    JOIN org_users ou ON ou.user_id IN (tg.member_1_id, tg.member_2_id, tg.member_3_id)
    JOIN public.triad_sessions ts ON ts.triad_group_id = tg.id
    LEFT JOIN public.triad_reflections tr ON tr.triad_session_id = ts.id AND tr.participant_id = ou.user_id
  ),
  prompt_agg AS (
    SELECT dp.training_week_id AS week_id,
      COUNT(DISTINCT dpr.user_id) FILTER (WHERE dpr.responded_at IS NOT NULL) AS n_responded
    FROM public.daily_prompts dp
    JOIN public.daily_prompt_responses dpr ON dpr.daily_prompt_id = dp.id
    JOIN org_users ou ON ou.user_id = dpr.user_id
    WHERE dp.training_week_id IN (SELECT week_id FROM org_weeks)
    GROUP BY dp.training_week_id
  )
  SELECT
    ow.week_number,
    ow.title,
    CASE WHEN uc.cnt > 0 THEN ROUND(COALESCE(sc.n, 0) * 100.0 / uc.cnt, 1) ELSE NULL END,
    qa.avg_score,
    CASE WHEN uc.cnt > 0 THEN ROUND(COALESCE(qa.n_submitted, 0) * 100.0 / uc.cnt, 1) ELSE NULL END,
    CASE WHEN uc.cnt > 0 AND ra.n_submitted IS NOT NULL
         THEN ROUND(ra.n_submitted * 100.0 / uc.cnt, 1)
         ELSE NULL
    END,
    tm.completion_pct,
    tm.satisfaction_avg,
    CASE WHEN uc.cnt > 0 THEN ROUND(COALESCE(pa.n_responded, 0) * 100.0 / uc.cnt, 1) ELSE NULL END
  FROM org_weeks ow
  JOIN user_counts uc ON uc.programme_id = ow.programme_id
  LEFT JOIN skill_card sc ON sc.week_id = ow.week_id
  LEFT JOIN quiz_agg qa ON qa.week_id = ow.week_id
  LEFT JOIN reflection_agg ra ON ra.week_number = ow.week_number
  CROSS JOIN triad_metrics tm
  LEFT JOIN prompt_agg pa ON pa.week_id = ow.week_id
  ORDER BY ow.week_number;
$function$;
REVOKE EXECUTE ON FUNCTION public.sponsor_programme_engagement(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sponsor_programme_engagement(uuid) TO authenticated;

-- added p_cohort_id filter 20260909043650
DROP FUNCTION IF EXISTS public.sponsor_engagement_red_flags();
CREATE FUNCTION public.sponsor_engagement_red_flags(p_cohort_id uuid DEFAULT NULL)
RETURNS TABLE(user_id uuid, full_name text, days_since_last_activity integer, missed_quizzes integer, missed_triads integer, missed_prompts integer)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH org_users AS (
    SELECT DISTINCT pe.user_id, pe.programme_id
    FROM public.programme_enrollments pe
    LEFT JOIN public.cohorts c ON c.id = pe.cohort_id
    WHERE COALESCE(pe.organization_id, c.organization_id) IS NOT NULL
      AND COALESCE(pe.organization_id, c.organization_id) = public.get_sponsor_org(auth.uid())
      AND pe.status = 'active'
      AND (p_cohort_id IS NULL OR pe.cohort_id = p_cohort_id)
  ),
  last_activity AS (
    SELECT
      ou.user_id,
      GREATEST(
        (SELECT MAX(submitted_at) FROM public.assignment_submissions WHERE user_id = ou.user_id),
        (SELECT MAX(responded_at) FROM public.daily_prompt_responses WHERE user_id = ou.user_id),
        (SELECT MAX(submitted_at) FROM public.triad_reflections WHERE participant_id = ou.user_id),
        (SELECT MAX(completed_at) FROM public.training_progress WHERE user_id = ou.user_id)
      ) AS last_active
    FROM org_users ou
  ),
  missed_quizzes AS (
    SELECT ou.user_id, COUNT(*)::int AS n
    FROM org_users ou
    JOIN public.training_weeks tw ON tw.programme_id = ou.programme_id
      AND tw.is_visible = true
      AND (tw.unlock_date IS NULL OR tw.unlock_date <= CURRENT_DATE)
    JOIN public.assignments a ON a.training_week_id = tw.id
      AND a.assignment_type = 'quiz' AND a.is_visible = true
    LEFT JOIN public.assignment_submissions asub ON asub.assignment_id = a.id AND asub.user_id = ou.user_id
    WHERE asub.id IS NULL
    GROUP BY ou.user_id
  ),
  missed_triads AS (
    SELECT ou.user_id, COUNT(*)::int AS n
    FROM org_users ou
    JOIN public.triad_groups tg ON ou.user_id IN (tg.member_1_id, tg.member_2_id, tg.member_3_id)
    JOIN public.triad_sessions ts ON ts.triad_group_id = tg.id AND ts.status = 'completed'
    LEFT JOIN public.triad_reflections tr ON tr.triad_session_id = ts.id AND tr.participant_id = ou.user_id
    WHERE tr.id IS NULL
    GROUP BY ou.user_id
  ),
  missed_prompts AS (
    SELECT ou.user_id, COUNT(*)::int AS n
    FROM org_users ou
    JOIN public.training_weeks tw ON tw.programme_id = ou.programme_id
      AND tw.is_visible = true
      AND (tw.unlock_date IS NULL OR tw.unlock_date <= CURRENT_DATE)
    JOIN public.daily_prompts dp ON dp.training_week_id = tw.id
    LEFT JOIN public.daily_prompt_responses dpr ON dpr.daily_prompt_id = dp.id
      AND dpr.user_id = ou.user_id AND dpr.responded_at IS NOT NULL
    WHERE dpr.id IS NULL
    GROUP BY ou.user_id
  )
  SELECT
    la.user_id,
    p.full_name,
    COALESCE(EXTRACT(DAY FROM now() - la.last_active)::int, 999),
    COALESCE(mq.n, 0),
    COALESCE(mt.n, 0),
    COALESCE(mp.n, 0)
  FROM last_activity la
  JOIN public.profiles p ON p.id = la.user_id
  LEFT JOIN missed_quizzes mq ON mq.user_id = la.user_id
  LEFT JOIN missed_triads mt ON mt.user_id = la.user_id
  LEFT JOIN missed_prompts mp ON mp.user_id = la.user_id
  WHERE la.last_active IS NULL OR la.last_active < now() - INTERVAL '7 days'
  ORDER BY la.last_active NULLS FIRST;
$function$;
REVOKE EXECUTE ON FUNCTION public.sponsor_engagement_red_flags(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sponsor_engagement_red_flags(uuid) TO authenticated;

-- added p_cohort_id filter 20260909043650
DROP FUNCTION IF EXISTS public.sponsor_satisfaction_trend();
CREATE FUNCTION public.sponsor_satisfaction_trend(p_cohort_id uuid DEFAULT NULL)
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
      AND (p_cohort_id IS NULL OR pe.cohort_id = p_cohort_id)
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
REVOKE EXECUTE ON FUNCTION public.sponsor_satisfaction_trend(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sponsor_satisfaction_trend(uuid) TO authenticated;

-- added p_cohort_id filter 20260909043650
DROP FUNCTION IF EXISTS public.sponsor_coach_utilisation();
CREATE FUNCTION public.sponsor_coach_utilisation(p_cohort_id uuid DEFAULT NULL)
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
      AND (p_cohort_id IS NULL OR pe.cohort_id = p_cohort_id)
      AND s.status = 'completed'
  )
  SELECT p.full_name, COUNT(*)::int AS completed_sessions
  FROM org_sessions os
  JOIN public.profiles p ON p.id = os.coach_id
  GROUP BY p.full_name
  ORDER BY COUNT(*) DESC
  LIMIT 8;
$function$;
REVOKE EXECUTE ON FUNCTION public.sponsor_coach_utilisation(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sponsor_coach_utilisation(uuid) TO authenticated;
