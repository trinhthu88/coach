
-- Add per-session coachee rating
ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS coachee_rating SMALLINT,
  ADD COLUMN IF NOT EXISTS coachee_rating_comment TEXT,
  ADD COLUMN IF NOT EXISTS coachee_rated_at TIMESTAMPTZ;

-- Validate rating range via trigger (avoid CHECK with side-effects pattern)
CREATE OR REPLACE FUNCTION public.validate_session_rating()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.coachee_rating IS NOT NULL AND (NEW.coachee_rating < 1 OR NEW.coachee_rating > 5) THEN
    RAISE EXCEPTION 'coachee_rating must be between 1 and 5';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_session_rating ON public.sessions;
CREATE TRIGGER trg_validate_session_rating
BEFORE INSERT OR UPDATE ON public.sessions
FOR EACH ROW EXECUTE FUNCTION public.validate_session_rating();

-- Recompute coach rating average when a session rating changes
CREATE OR REPLACE FUNCTION public.recompute_coach_rating()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _avg NUMERIC;
BEGIN
  SELECT COALESCE(AVG(coachee_rating)::NUMERIC, 5.0)
    INTO _avg
    FROM public.sessions
   WHERE coach_id = NEW.coach_id AND coachee_rating IS NOT NULL;
  UPDATE public.coach_profiles
     SET rating_avg = ROUND(_avg, 2)
   WHERE id = NEW.coach_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_recompute_coach_rating ON public.sessions;
CREATE TRIGGER trg_recompute_coach_rating
AFTER INSERT OR UPDATE OF coachee_rating ON public.sessions
FOR EACH ROW
WHEN (NEW.coachee_rating IS NOT NULL)
EXECUTE FUNCTION public.recompute_coach_rating();
