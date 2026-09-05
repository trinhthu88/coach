-- Spec: confidence trend appears ONLY in the end-of-programme report, not on
-- the live sponsor dashboard. Removes avg_confidence_score from
-- sponsor_programme_engagement() (daily-prompt-sourced) and adds a
-- dedicated sponsor_confidence_trend() sourced from reflection_submissions
-- instead, for report-only use.
--
-- DROP first: CREATE OR REPLACE cannot change a function's RETURNS TABLE
-- column list (SQLSTATE 42P13) — dropping avg_confidence_score from the OUT
-- parameters requires an explicit drop, not just a replace.
DROP FUNCTION IF EXISTS public.sponsor_programme_engagement();

CREATE FUNCTION public.sponsor_programme_engagement()
RETURNS TABLE (
  week_number INT,
  week_title TEXT,
  skill_card_completion_pct NUMERIC,
  quiz_avg_score NUMERIC,
  quiz_completion_pct NUMERIC,
  triad_completion_pct NUMERIC,
  daily_prompt_response_rate NUMERIC
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
    CASE WHEN uc.cnt > 0 THEN ROUND(COALESCE(tra.n_reflected, 0) * 100.0 / uc.cnt, 1) ELSE NULL END,
    CASE WHEN uc.cnt > 0 THEN ROUND(COALESCE(pa.n_responded, 0) * 100.0 / uc.cnt, 1) ELSE NULL END
  FROM org_weeks ow
  JOIN user_counts uc ON uc.programme_id = ow.programme_id
  LEFT JOIN skill_card sc ON sc.week_id = ow.week_id
  LEFT JOIN quiz_agg qa ON qa.week_id = ow.week_id
  LEFT JOIN triad_agg tra ON tra.week_id = ow.week_id
  LEFT JOIN prompt_agg pa ON pa.week_id = ow.week_id
  ORDER BY ow.week_number;
$$;

-- Confidence trend — sourced from reflection_submissions, NOT daily prompts.
-- Returns cohort average confidence per reflection checkpoint.
-- Used ONLY in the end-of-programme report (SponsorReport.tsx).
CREATE OR REPLACE FUNCTION public.sponsor_confidence_trend()
RETURNS TABLE (
  reflection_number INT,
  reflection_title TEXT,
  appears_at_week INT,
  avg_confidence NUMERIC,
  response_count BIGINT
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH org_users AS (
    SELECT DISTINCT pe.user_id, pe.programme_id
    FROM public.programme_enrollments pe
    WHERE pe.organization_id IS NOT NULL
      AND pe.organization_id = public.get_sponsor_org(auth.uid())
      AND pe.status = 'active'
  )
  SELECT
    pr.reflection_number,
    pr.title AS reflection_title,
    pr.appears_at_week,
    ROUND(AVG(rs.confidence_score), 1) AS avg_confidence,
    COUNT(rs.id) AS response_count
  FROM public.programme_reflections pr
  JOIN public.reflection_submissions rs ON rs.reflection_id = pr.id
  JOIN org_users ou ON ou.user_id = rs.user_id
    AND ou.programme_id = pr.programme_id
  GROUP BY pr.reflection_number, pr.title, pr.appears_at_week
  ORDER BY pr.reflection_number;
$$;

REVOKE EXECUTE ON FUNCTION public.sponsor_confidence_trend() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sponsor_confidence_trend() TO authenticated;
