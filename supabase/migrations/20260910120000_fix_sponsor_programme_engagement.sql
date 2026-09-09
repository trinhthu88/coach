-- Rewrites sponsor_programme_engagement() to fix three real bugs:
--
-- 1. It counted a week's completion % against every enrolled user, even
--    ones who joined after that week had already unlocked and closed —
--    understating completion for anyone who enrolled mid-programme.
--    Fixed by scoping the denominator per week to users whose enrollment
--    start_date was on/before that week's effective unlock date.
-- 2. Every week used the same org-wide unlock_date, so a second cohort
--    starting later saw the same "already open" weeks as the first —
--    fixed by reusing the cohort-relative effective_unlock_date formula
--    from 20260910100000_cohort_week_overrides.sql's
--    get_my_training_weeks() rewrite.
-- 3. triad_completion_pct/triad_satisfaction_avg were CROSS JOINed as a
--    single org-wide aggregate onto every week row regardless of which
--    cohort was requested — a cohort with zero triad activity would show
--    another cohort's numbers. Fixed to aggregate per triad_groups.cohort_id
--    and LEFT JOIN specifically on the requested cohort, returning NULL
--    (not 0%) when that cohort has no triad data at all.
--
-- Design note on "only weeks that are already open": the task spec that
-- produced this migration asked both to filter org_weeks down to
-- already-unlocked weeks AND to add an is_locked output column so the
-- sponsor UI can show future weeks greyed out rather than hidden — those
-- two are contradictory (a filtered-out row can't also be shown-but-
-- locked). Resolved in favor of the more specific, actionable one:
-- org_weeks keeps every visible week regardless of unlock state, and
-- is_locked tells the caller which ones haven't opened yet. A locked
-- week's completion percentages are just whatever they naturally compute
-- to (typically 0%, since nobody can complete a week that hasn't opened)
-- — the UI is expected to grey the row using is_locked, not read meaning
-- into that 0%.
--
-- DROP first: adds an output column (is_locked, effective_unlock_date) to
-- RETURNS TABLE, which CREATE OR REPLACE cannot do (SQLSTATE 42P13).
DROP FUNCTION IF EXISTS public.sponsor_programme_engagement(uuid);

CREATE FUNCTION public.sponsor_programme_engagement(p_cohort_id uuid DEFAULT NULL)
RETURNS TABLE(
  week_number integer,
  week_title text,
  effective_unlock_date date,
  is_locked boolean,
  skill_card_completion_pct numeric,
  quiz_avg_score numeric,
  quiz_completion_pct numeric,
  reflection_completion_pct numeric,
  triad_completion_pct numeric,
  triad_satisfaction_avg numeric,
  daily_prompt_response_rate numeric
)
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
      AND (p_cohort_id IS NULL OR pe.cohort_id = p_cohort_id)
  ),
  org_programmes AS (
    SELECT DISTINCT programme_id FROM org_users
  ),
  -- Effective unlock date for the cohort actually being queried
  -- (p_cohort_id) — same COALESCE chain as get_my_training_weeks():
  -- override row, then this cohort's start_date + (week_number-1) weeks,
  -- then the flat tw.unlock_date. When p_cohort_id is NULL (org-wide,
  -- no single cohort to be relative to), c.start_date/cwo both resolve to
  -- NULL and this falls straight through to tw.unlock_date, same as
  -- before this migration.
  org_weeks AS (
    SELECT
      tw.id AS week_id,
      tw.week_number,
      tw.title,
      tw.programme_id,
      COALESCE(
        cwo.unlock_date,
        c.start_date + ((tw.week_number - 1) * INTERVAL '7 days'),
        tw.unlock_date
      )::date AS effective_unlock_date
    FROM public.training_weeks tw
    JOIN org_programmes op ON op.programme_id = tw.programme_id
    LEFT JOIN public.cohorts c ON c.id = p_cohort_id
    LEFT JOIN public.cohort_week_overrides cwo
      ON cwo.cohort_id = p_cohort_id AND cwo.training_week_id = tw.id
    WHERE tw.is_visible = true
  ),
  -- Denominator fix: only count a user toward a given week's completion %
  -- if their enrollment had already started by the time that week opened
  -- — someone who enrolled after week 2 unlocked was never "in scope" for
  -- week 2, so their non-completion shouldn't drag that week's % down.
  user_counts AS (
    SELECT
      ow.week_id,
      COUNT(DISTINCT ou.user_id) AS cnt
    FROM org_weeks ow
    JOIN org_users ou ON ou.programme_id = ow.programme_id
    JOIN public.programme_enrollments pe
      ON pe.user_id = ou.user_id
      AND pe.start_date <= ow.effective_unlock_date
    GROUP BY ow.week_id
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
  -- Per-cohort (not org-wide) triad aggregate. Joined below on
  -- `tm.cohort_id IS NOT DISTINCT FROM p_cohort_id` rather than `=` so the
  -- cohort-scoped call (p_cohort_id NOT NULL, the normal case since
  -- SponsorCohortDetail.tsx always resolves a real cohort id) gets exactly
  -- that cohort's row, and NULL propagates as NULL (not 0%) when that
  -- cohort's triad_groups have no sessions yet.
  triad_metrics AS (
    SELECT
      tg.cohort_id,
      ROUND(
        COUNT(*) FILTER (WHERE ts.status = 'completed')::numeric * 100.0
        / NULLIF(COUNT(ts.id), 0),
      1) AS completion_pct,
      AVG(tr.satisfaction_rating) FILTER (WHERE tr.satisfaction_rating IS NOT NULL) AS satisfaction_avg
    FROM public.triad_groups tg
    JOIN public.triad_sessions ts ON ts.triad_group_id = tg.id
    LEFT JOIN public.triad_reflections tr ON tr.triad_session_id = ts.id
    WHERE (p_cohort_id IS NULL OR tg.cohort_id = p_cohort_id)
      AND tg.programme_id IN (SELECT programme_id FROM org_programmes)
    GROUP BY tg.cohort_id
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
    ow.effective_unlock_date,
    (ow.effective_unlock_date IS NOT NULL AND ow.effective_unlock_date > CURRENT_DATE) AS is_locked,
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
  JOIN user_counts uc ON uc.week_id = ow.week_id
  LEFT JOIN skill_card sc ON sc.week_id = ow.week_id
  LEFT JOIN quiz_agg qa ON qa.week_id = ow.week_id
  LEFT JOIN reflection_agg ra ON ra.week_number = ow.week_number
  LEFT JOIN triad_metrics tm ON tm.cohort_id IS NOT DISTINCT FROM p_cohort_id
  LEFT JOIN prompt_agg pa ON pa.week_id = ow.week_id
  ORDER BY ow.week_number;
$function$;

REVOKE EXECUTE ON FUNCTION public.sponsor_programme_engagement(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sponsor_programme_engagement(uuid) TO authenticated;
