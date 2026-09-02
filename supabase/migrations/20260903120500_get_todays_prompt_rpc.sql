-- Phase 2 (daily prompts & nudges): resolves "today's prompt" for the
-- calling user — the day_number within their current training_week is
-- derived from unlock_date, not stored anywhere. SECURITY DEFINER bypasses
-- daily_prompts' RLS, so (unlike that table's own policy) this explicitly
-- re-checks has_programme_module('daily_prompt') itself — same pattern as
-- get_my_training_weeks() re-checking 'training'.
CREATE OR REPLACE FUNCTION public.get_todays_prompt()
RETURNS TABLE (
  prompt_id UUID,
  prompt_text TEXT,
  prompt_text_vi TEXT,
  week_number INT,
  week_title TEXT,
  week_title_vi TEXT,
  already_responded BOOLEAN,
  response_text TEXT,
  confidence_score SMALLINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH current_week AS (
    SELECT tw.id AS tw_id, tw.week_number, tw.title, tw.title_vi, tw.unlock_date
    FROM public.training_weeks tw
    JOIN public.programme_enrollments pe ON pe.programme_id = tw.programme_id
    WHERE pe.user_id = auth.uid()
      AND pe.status = 'active'
      AND tw.is_visible = true
      AND tw.unlock_date IS NOT NULL
      AND tw.unlock_date <= CURRENT_DATE
      AND public.has_programme_module('daily_prompt'::programme_module_type)
    ORDER BY tw.week_number DESC
    LIMIT 1
  ),
  day_in_week AS (
    SELECT
      cw.*,
      LEAST(7, GREATEST(1, (CURRENT_DATE - cw.unlock_date)::int + 1)) AS day_num
    FROM current_week cw
  )
  SELECT
    dp.id,
    dp.prompt_text,
    dp.prompt_text_vi,
    diw.week_number,
    diw.title,
    diw.title_vi,
    (dpr.id IS NOT NULL AND dpr.responded_at IS NOT NULL) AS already_responded,
    dpr.response_text,
    dpr.confidence_score
  FROM day_in_week diw
  JOIN public.daily_prompts dp ON dp.training_week_id = diw.tw_id AND dp.day_number = diw.day_num
  LEFT JOIN public.daily_prompt_responses dpr ON dpr.daily_prompt_id = dp.id AND dpr.user_id = auth.uid();
$$;

REVOKE EXECUTE ON FUNCTION public.get_todays_prompt() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_todays_prompt() TO authenticated;
