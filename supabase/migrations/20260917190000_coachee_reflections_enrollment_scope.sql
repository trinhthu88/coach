-- Private learner reflections must resolve to the enrollment they were
-- written in, the same as every other development record (goals, actions,
-- goal ratings). Previously coachee_reflections had no enrollment_id at
-- all, so the Journey/Dashboard could only ever query them by coachee_id —
-- correct for a learner with one programme, but wrong the moment someone
-- has more than one enrollment over time (their private reflections would
-- mix across programmes with no way to tell them apart).
--
-- Nullable, not NOT NULL: historical rows may predate any resolvable
-- enrollment, or the coachee may have had more than one candidate
-- enrollment active on that date, which must never be guessed (see the
-- backfill below and historical-ownership-retirement precedent used
-- elsewhere in this schema for the same class of problem).
ALTER TABLE public.coachee_reflections
  ADD COLUMN enrollment_id uuid REFERENCES public.programme_enrollments(id) ON DELETE SET NULL;

CREATE INDEX coachee_reflections_enrollment_idx
  ON public.coachee_reflections(enrollment_id);

-- Deterministic, certainty-only backfill: a reflection's enrollment_id is
-- set only when exactly one of the coachee's enrollments was active
-- (start_date <= created_at::date, and end_date is null or >=
-- created_at::date) on the day the reflection was written. Rows with zero
-- or multiple candidate enrollments are left NULL rather than guessed.
DO $backfill$
DECLARE
  updated_count integer;
  ambiguous_count integer;
BEGIN
  WITH candidates AS (
    SELECT
      r.id AS reflection_id,
      e.id AS enrollment_id,
      count(*) OVER (PARTITION BY r.id) AS candidate_count
    FROM public.coachee_reflections r
    JOIN public.programme_enrollments e
      ON e.user_id = r.coachee_id
     AND e.start_date <= r.created_at::date
     AND (e.end_date IS NULL OR e.end_date >= r.created_at::date)
    WHERE r.enrollment_id IS NULL
  ), unambiguous AS (
    SELECT reflection_id, enrollment_id
    FROM candidates
    WHERE candidate_count = 1
  )
  UPDATE public.coachee_reflections r
  SET enrollment_id = u.enrollment_id
  FROM unambiguous u
  WHERE r.id = u.reflection_id;
  GET DIAGNOSTICS updated_count = ROW_COUNT;

  SELECT count(DISTINCT reflection_id) INTO ambiguous_count
  FROM (
    SELECT r.id AS reflection_id, count(*) AS candidate_count
    FROM public.coachee_reflections r
    JOIN public.programme_enrollments e
      ON e.user_id = r.coachee_id
     AND e.start_date <= r.created_at::date
     AND (e.end_date IS NULL OR e.end_date >= r.created_at::date)
    WHERE r.enrollment_id IS NULL
    GROUP BY r.id
    HAVING count(*) > 1
  ) ambiguous;

  RAISE NOTICE 'coachee_reflections enrollment backfill: % rows resolved, % rows left null (multiple candidate enrollments)', updated_count, ambiguous_count;
END;
$backfill$;

-- New rows must carry an enrollment the same coachee actually owns — the
-- same integrity check enrollment_actions/enrollment_goals already enforce
-- via triggers, applied here so a reflection can never be tagged with
-- someone else's enrollment.
CREATE OR REPLACE FUNCTION public.validate_coachee_reflection_enrollment()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NEW.enrollment_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.programme_enrollments e
    WHERE e.id = NEW.enrollment_id AND e.user_id = NEW.coachee_id
  ) THEN
    RAISE EXCEPTION 'Reflection enrollment must belong to the reflecting coachee' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER coachee_reflections_validate_enrollment
  BEFORE INSERT OR UPDATE OF enrollment_id ON public.coachee_reflections
  FOR EACH ROW EXECUTE FUNCTION public.validate_coachee_reflection_enrollment();
