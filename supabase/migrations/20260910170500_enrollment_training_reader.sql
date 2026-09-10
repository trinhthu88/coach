-- Explicit enrollment selection also isolates historical training completion.
CREATE OR REPLACE FUNCTION public.get_enrollment_training_weeks(p_enrollment_id uuid)
RETURNS TABLE (
  id uuid,
  week_number int,
  title text,
  title_vi text,
  subtitle text,
  subtitle_vi text,
  unlock_date date,
  effective_unlock_date date,
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
    COALESCE(
      cwo.unlock_date,
      CASE WHEN pe.cohort_id IS NOT NULL
        THEN (pe.start_date + ((tw.week_number - 1) * INTERVAL '7 days'))::date
        ELSE NULL
      END,
      tw.unlock_date
    ) AS effective_unlock_date,
    COALESCE(
      cwo.unlock_date,
      CASE WHEN pe.cohort_id IS NOT NULL
        THEN (pe.start_date + ((tw.week_number - 1) * INTERVAL '7 days'))::date
        ELSE NULL
      END,
      tw.unlock_date
    ) > CURRENT_DATE AS locked,
    tw.skill_card_visible,
    tp.viewed_at,
    tp.completed_at
  FROM public.programme_enrollments pe
  JOIN public.training_weeks tw ON tw.programme_id = pe.programme_id
  LEFT JOIN public.cohort_week_overrides cwo
    ON cwo.cohort_id = pe.cohort_id AND cwo.training_week_id = tw.id
  LEFT JOIN public.training_progress tp ON tp.training_week_id = tw.id AND tp.enrollment_id = pe.id
  WHERE pe.id = p_enrollment_id
    AND pe.user_id = auth.uid()
    AND tw.is_visible = true
    AND EXISTS (SELECT 1 FROM public.enrollment_module_snapshots ms WHERE ms.enrollment_id = pe.id AND ms.module = 'training'::public.programme_module_type)
  ORDER BY tw.week_number;
$$;

REVOKE EXECUTE ON FUNCTION public.get_enrollment_training_weeks(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_enrollment_training_weeks(uuid) TO authenticated;
