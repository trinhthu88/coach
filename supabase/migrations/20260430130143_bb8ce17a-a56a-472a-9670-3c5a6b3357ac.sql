-- 1) Add 'reach_limit' to user_status enum
ALTER TYPE public.user_status ADD VALUE IF NOT EXISTS 'reach_limit';

-- 2) Fix bump_profile_update_at: do not bump when only last_approved_at changes
CREATE OR REPLACE FUNCTION public.bump_profile_update_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- If only last_approved_at changed, don't bump last_profile_update_at
  IF NEW.last_approved_at IS DISTINCT FROM OLD.last_approved_at
     AND ROW(NEW.*) IS NOT DISTINCT FROM ROW(
       OLD.id, OLD.title, OLD.specialties, OLD.hourly_rate, OLD.years_experience,
       OLD.nationality, OLD.country_based, OLD.diplomas_certifications, OLD.is_featured,
       OLD.approval_status, OLD.rating_avg, OLD.sessions_completed, OLD.created_at,
       OLD.updated_at, NEW.last_approved_at, OLD.last_profile_update_at, OLD.calendly_url
     ) THEN
    RETURN NEW;
  END IF;
  NEW.last_profile_update_at = now();
  RETURN NEW;
END;
$function$;

-- 3) Trigger to enforce total session-limit cap and flip status to 'reach_limit'
-- The session_limits.monthly_limit value is reused as the LIFETIME cap on completed sessions.
CREATE OR REPLACE FUNCTION public.enforce_session_completion_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _limit INT;
  _completed INT;
BEGIN
  -- Only act when status becomes 'completed'
  IF NEW.status = 'completed' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'completed') THEN
    SELECT COALESCE(
      (SELECT sl.monthly_limit FROM public.session_limits sl WHERE sl.coachee_id = NEW.coachee_id),
      (SELECT sl.monthly_limit FROM public.session_limits sl WHERE sl.coachee_id IS NULL),
      4
    ) INTO _limit;

    SELECT COUNT(*)::int INTO _completed
      FROM public.sessions
     WHERE coachee_id = NEW.coachee_id AND status = 'completed';

    IF _completed >= _limit THEN
      UPDATE public.profiles SET status = 'reach_limit'::user_status WHERE id = NEW.coachee_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_sessions_enforce_limit ON public.sessions;
CREATE TRIGGER trg_sessions_enforce_limit
AFTER INSERT OR UPDATE OF status ON public.sessions
FOR EACH ROW
EXECUTE FUNCTION public.enforce_session_completion_limit();