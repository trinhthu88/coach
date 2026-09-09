-- Cohort-relative training week unlock dates.
--
-- Problem: training_weeks.unlock_date is one absolute date per programme,
-- shared by every cohort running that programme. A second cohort starting
-- later than the first either sees weeks unlock before it has even begun,
-- or (if unlock_date is pushed back for it) the first cohort's schedule
-- breaks instead. cohort_week_overrides lets an admin pin a specific
-- week's unlock date (or visibility) for one cohort without touching
-- training_weeks itself; get_my_training_weeks() below falls back to
-- computing an unlock date relative to the caller's own enrollment/cohort
-- start_date when no override row exists, and to the original
-- tw.unlock_date only when the enrollment has no cohort at all.
CREATE TABLE IF NOT EXISTS public.cohort_week_overrides (
  cohort_id        uuid NOT NULL REFERENCES public.cohorts(id) ON DELETE CASCADE,
  training_week_id uuid NOT NULL REFERENCES public.training_weeks(id) ON DELETE CASCADE,
  unlock_date      date,
  is_visible       boolean,
  PRIMARY KEY (cohort_id, training_week_id)
);

ALTER TABLE public.cohort_week_overrides ENABLE ROW LEVEL SECURITY;

-- Same shape as "Cohorts: authenticated view" / "Cohorts: admin manage"
-- (20260429193745_*) — any authenticated user may read (needed by every
-- enrolled leader's own get_my_training_weeks() call, which is
-- SECURITY DEFINER but still resolves through this table), only admins
-- may write.
DROP POLICY IF EXISTS "Cohort week overrides: authenticated view" ON public.cohort_week_overrides;
CREATE POLICY "Cohort week overrides: authenticated view" ON public.cohort_week_overrides
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Cohort week overrides: admin manage" ON public.cohort_week_overrides;
CREATE POLICY "Cohort week overrides: admin manage" ON public.cohort_week_overrides
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

-- Replace get_my_training_weeks(): `locked` is now computed from an
-- effective unlock date rather than the flat tw.unlock_date alone:
--   1. cohort_week_overrides row for this (cohort, week), if one exists
--   2. else, when the enrollment has a cohort, that cohort's start_date
--      plus (week_number - 1) weeks — so every cohort's week 1 unlocks on
--      its own start date regardless of when other cohorts of the same
--      programme started
--   3. else (no cohort on this enrollment at all — the pre-cohort
--      enrollment shape this table predates), tw.unlock_date exactly as
--      before this migration
-- effective_unlock_date is also returned directly so the frontend can
-- display *why* a week is locked without re-deriving this COALESCE chain.
--
-- DROP first: CREATE OR REPLACE cannot add a column to a function's
-- RETURNS TABLE (SQLSTATE 42P13) — same reason 20260905200200_* had to
-- drop first to add skill_card_visible.
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
  LEFT JOIN public.training_progress tp ON tp.training_week_id = tw.id AND tp.user_id = auth.uid()
  WHERE pe.user_id = auth.uid()
    AND pe.status = 'active'
    AND tw.is_visible = true
    AND public.has_programme_module('training'::programme_module_type)
  ORDER BY tw.week_number;
$$;

REVOKE EXECUTE ON FUNCTION public.get_my_training_weeks() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_training_weeks() TO authenticated;
