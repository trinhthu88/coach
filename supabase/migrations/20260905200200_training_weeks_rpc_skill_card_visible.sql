-- Surface skill_card_visible on get_my_training_weeks() so the training
-- list/timeline can tell a locked-out skill card apart from an unlocked one.
--
-- DROP first: CREATE OR REPLACE cannot add a column to a function's
-- RETURNS TABLE (SQLSTATE 42P13) — requires an explicit drop, not a replace.
DROP FUNCTION IF EXISTS public.get_my_training_weeks();

CREATE FUNCTION public.get_my_training_weeks()
RETURNS TABLE (
  id uuid,
  week_number int,
  title text,
  title_vi text,
  subtitle text,
  subtitle_vi text,
  unlock_date date,
  locked boolean,
  skill_card_visible boolean,
  viewed_at timestamptz,
  completed_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    tw.id,
    tw.week_number,
    tw.title,
    tw.title_vi,
    tw.subtitle,
    tw.subtitle_vi,
    tw.unlock_date,
    (tw.unlock_date IS NOT NULL AND tw.unlock_date > CURRENT_DATE) AS locked,
    tw.skill_card_visible,
    tp.viewed_at,
    tp.completed_at
  FROM public.programme_enrollments pe
  JOIN public.training_weeks tw ON tw.programme_id = pe.programme_id
  LEFT JOIN public.training_progress tp ON tp.training_week_id = tw.id AND tp.user_id = auth.uid()
  WHERE pe.user_id = auth.uid()
    AND pe.status = 'active'
    AND tw.is_visible = true
    AND public.has_programme_module('training'::programme_module_type)
  ORDER BY tw.week_number;
$$;

REVOKE EXECUTE ON FUNCTION public.get_my_training_weeks() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_training_weeks() TO authenticated;
