-- Phase 1 (training material delivery): training_weeks' own RLS ("enrolled
-- users view") only returns rows that are both published (is_visible) AND
-- already time-unlocked — by design, so the raw table can't be used to list
-- upcoming weeks for the "locked, greyed out, with unlock date" UI the
-- training list page needs. This RPC relaxes just the unlock_date half of
-- that gate for *listing* purposes (still requires is_visible = true, so an
-- unpublished/draft week never appears) — the underlying skill_card_html /
-- skill_card_elements / PDF storage stay behind the stricter table RLS,
-- which still enforces unlock_date, so a locked week's content genuinely
-- isn't fetchable early even though its title now is.
CREATE OR REPLACE FUNCTION public.get_my_training_weeks()
RETURNS TABLE (
  id uuid,
  week_number int,
  title text,
  title_vi text,
  subtitle text,
  subtitle_vi text,
  unlock_date date,
  locked boolean,
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
