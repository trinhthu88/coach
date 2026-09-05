-- Spec: admin can have 0-7 prompts per week with individual visibility
-- toggles and flexible day offsets, not exactly 7 fixed day_number slots.

-- 1. Add is_visible
ALTER TABLE public.daily_prompts
  ADD COLUMN IF NOT EXISTS is_visible BOOLEAN NOT NULL DEFAULT true;

-- 2. Rename day_number → day_offset (semantically: offset from week unlock)
ALTER TABLE public.daily_prompts RENAME COLUMN day_number TO day_offset;

-- 3. Drop the rigid CHECK and UNIQUE
ALTER TABLE public.daily_prompts DROP CONSTRAINT IF EXISTS daily_prompts_day_number_check;
ALTER TABLE public.daily_prompts DROP CONSTRAINT IF EXISTS daily_prompts_training_week_id_day_number_key;

-- 4. Add flexible CHECK: 1-7 or NULL
ALTER TABLE public.daily_prompts
  ADD CONSTRAINT daily_prompts_day_offset_check CHECK (day_offset IS NULL OR day_offset BETWEEN 1 AND 7);

-- 5. Add a sort_order column for ordering within a week
ALTER TABLE public.daily_prompts
  ADD COLUMN IF NOT EXISTS sort_order INT NOT NULL DEFAULT 0;

-- get_todays_prompt() must be rebuilt for the day_number → day_offset rename
-- and to only surface is_visible prompts. A prompt with day_offset = NULL
-- ("any day this week") matches every day of its training_week, ordered by
-- sort_order so an admin can control which "any day" prompt wins if more
-- than one is due the same day as a day-pinned one.
CREATE OR REPLACE FUNCTION public.get_todays_prompt()
RETURNS TABLE (
  prompt_id UUID,
  prompt_text TEXT,
  prompt_text_vi TEXT,
  week_number INT,
  week_title TEXT,
  week_title_vi TEXT,
  already_responded BOOLEAN,
  response_text TEXT
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
    dpr.response_text
  FROM day_in_week diw
  JOIN public.daily_prompts dp ON dp.training_week_id = diw.tw_id
    AND dp.is_visible = true
    AND (dp.day_offset IS NULL OR dp.day_offset = diw.day_num)
  LEFT JOIN public.daily_prompt_responses dpr ON dpr.daily_prompt_id = dp.id AND dpr.user_id = auth.uid()
  ORDER BY dp.day_offset NULLS LAST, dp.sort_order
  LIMIT 1;
$$;

REVOKE EXECUTE ON FUNCTION public.get_todays_prompt() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_todays_prompt() TO authenticated;
