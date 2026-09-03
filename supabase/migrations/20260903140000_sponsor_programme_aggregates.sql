-- Phase 4 (L&D dashboards), part A: three more sponsor SECURITY DEFINER
-- functions, same pattern as 20260811110000_sponsor_aggregate_functions.sql
-- — internally scoped to get_sponsor_org(auth.uid()), no client-supplied org
-- id, no raw per-session/per-response rows exposed. get_sponsor_org()
-- returns NULL for a non-sponsor caller, and every WHERE below compares
-- against that NULL, so a non-sponsor (or unlinked-sponsor) caller gets zero
-- rows from all three functions without a separate guard clause.
--
-- sponsor_programme_engagement() is NOT a straight port of a single query
-- joining training_weeks to assignments/triad_sessions/daily_prompts —
-- doing that in one FROM clause fans out every metric by the cross-product
-- of the other joins (e.g. a week with 2 quiz assignments and 3 daily
-- prompts would count each quiz submission 3 times). Each metric is instead
-- pre-aggregated to one row per training_week_id in its own CTE, then all
-- of those are LEFT JOINed onto org_weeks on that same key — no fanout
-- possible since every join partner has at most one row per week.

CREATE OR REPLACE FUNCTION public.sponsor_programme_engagement()
RETURNS TABLE (
  week_number INT,
  week_title TEXT,
  skill_card_completion_pct NUMERIC,
  quiz_avg_score NUMERIC,
  quiz_completion_pct NUMERIC,
  triad_completion_pct NUMERIC,
  daily_prompt_response_rate NUMERIC,
  avg_confidence_score NUMERIC
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH org_users AS (
    SELECT DISTINCT pe.user_id, pe.programme_id
    FROM public.programme_enrollments pe
    WHERE pe.organization_id IS NOT NULL
      AND pe.organization_id = public.get_sponsor_org(auth.uid())
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
  triad_agg AS (
    SELECT ts.training_week_id AS week_id, COUNT(DISTINCT tr.participant_id) AS n_reflected
    FROM public.triad_sessions ts
    JOIN public.triad_reflections tr ON tr.triad_session_id = ts.id
    JOIN org_users ou ON ou.user_id = tr.participant_id
    WHERE ts.training_week_id IN (SELECT week_id FROM org_weeks)
    GROUP BY ts.training_week_id
  ),
  prompt_agg AS (
    SELECT dp.training_week_id AS week_id,
      COUNT(DISTINCT dpr.user_id) FILTER (WHERE dpr.responded_at IS NOT NULL) AS n_responded,
      AVG(dpr.confidence_score) AS avg_confidence
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
    CASE WHEN uc.cnt > 0 THEN ROUND(COALESCE(tra.n_reflected, 0) * 100.0 / uc.cnt, 1) ELSE NULL END,
    CASE WHEN uc.cnt > 0 THEN ROUND(COALESCE(pa.n_responded, 0) * 100.0 / uc.cnt, 1) ELSE NULL END,
    pa.avg_confidence
  FROM org_weeks ow
  JOIN user_counts uc ON uc.programme_id = ow.programme_id
  LEFT JOIN skill_card sc ON sc.week_id = ow.week_id
  LEFT JOIN quiz_agg qa ON qa.week_id = ow.week_id
  LEFT JOIN triad_agg tra ON tra.week_id = ow.week_id
  LEFT JOIN prompt_agg pa ON pa.week_id = ow.week_id
  ORDER BY ow.week_number;
$$;

-- Engagement red flags: participants (active enrollment) with no recorded
-- activity in the last 7 days, or none at all. missed_quizzes/missed_triads/
-- missed_prompts are each counted properly (not stubbed) — see the three
-- CTEs below, one per metric, each keyed on user_id so they LEFT JOIN onto
-- last_activity without fanout for the same reason org_weeks' metrics don't
-- fan out above.
CREATE OR REPLACE FUNCTION public.sponsor_engagement_red_flags()
RETURNS TABLE (
  user_id UUID,
  full_name TEXT,
  days_since_last_activity INT,
  missed_quizzes INT,
  missed_triads INT,
  missed_prompts INT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH org_users AS (
    SELECT DISTINCT pe.user_id, pe.programme_id
    FROM public.programme_enrollments pe
    WHERE pe.organization_id IS NOT NULL
      AND pe.organization_id = public.get_sponsor_org(auth.uid())
      AND pe.status = 'active'
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
    JOIN public.triad_sessions ts ON ou.user_id IN (ts.coach_role_id, ts.coachee_role_id, ts.observer_role_id)
      AND ts.session_date < CURRENT_DATE
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
$$;

-- Top anonymized reflection quotes: each triad_reflections row can surface
-- at most one quote (whichever of its 3 role fields is picked), chosen by
-- UNIONing the 3 role fields into candidate rows and keeping only genuinely
-- substantive ones (>20 chars after trimming), ranked by the reflection's
-- own satisfaction rating then recency. The task's reference version picked
-- the field via a CASE with a length check but then let a null/short
-- learned_as_coachee through as the fallback anyway (with role_played
-- mislabelled to match) — this version can't produce that mismatch because
-- role_played is fixed per branch of the UNION, not recomputed afterward.
CREATE OR REPLACE FUNCTION public.sponsor_top_reflections(p_limit INT DEFAULT 5)
RETURNS TABLE (
  anonymized_quote TEXT,
  week_number INT,
  role_played TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH org_reflections AS (
    SELECT tr.learned_as_coach, tr.learned_as_coachee, tr.learned_as_observer,
      tr.satisfaction_rating, tr.submitted_at, tw.week_number
    FROM public.triad_reflections tr
    JOIN public.triad_sessions ts ON ts.id = tr.triad_session_id
    JOIN public.triad_groups tg ON tg.id = ts.triad_group_id
    JOIN public.training_weeks tw ON tw.id = ts.training_week_id
    JOIN public.programme_enrollments pe ON pe.programme_id = tg.programme_id AND pe.user_id = tr.participant_id
    WHERE pe.organization_id IS NOT NULL
      AND pe.organization_id = public.get_sponsor_org(auth.uid())
  ),
  candidates AS (
    SELECT learned_as_coach AS quote, 'coach' AS role_played, week_number, satisfaction_rating, submitted_at FROM org_reflections
    UNION ALL
    SELECT learned_as_coachee, 'coachee', week_number, satisfaction_rating, submitted_at FROM org_reflections
    UNION ALL
    SELECT learned_as_observer, 'observer', week_number, satisfaction_rating, submitted_at FROM org_reflections
  )
  SELECT quote, week_number, role_played
  FROM candidates
  WHERE quote IS NOT NULL AND length(trim(quote)) > 20
  ORDER BY satisfaction_rating DESC NULLS LAST, submitted_at DESC
  LIMIT p_limit;
$$;

REVOKE EXECUTE ON FUNCTION public.sponsor_programme_engagement() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.sponsor_engagement_red_flags() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.sponsor_top_reflections(INT) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.sponsor_programme_engagement() TO authenticated;
GRANT EXECUTE ON FUNCTION public.sponsor_engagement_red_flags() TO authenticated;
GRANT EXECUTE ON FUNCTION public.sponsor_top_reflections(INT) TO authenticated;
