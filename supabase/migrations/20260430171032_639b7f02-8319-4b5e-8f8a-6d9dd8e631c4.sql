
-- Treat coach_session_limits.monthly_limit and peer_monthly_limit as TOTAL caps (lifetime)
-- and auto-flip the coach's profile status to reach_limit when reached, or back to active when below.

CREATE OR REPLACE FUNCTION public.enforce_coach_as_coachee_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _coach UUID;
  _coach_limit INT;
  _peer_limit INT;
  _coach_used INT;
  _peer_used INT;
  _is_coach BOOLEAN;
  _current_status public.user_status;
BEGIN
  -- Determine which coach we are evaluating
  IF TG_TABLE_NAME = 'sessions' THEN
    _coach := COALESCE(NEW.coachee_id, OLD.coachee_id);
  ELSIF TG_TABLE_NAME = 'peer_sessions' THEN
    _coach := COALESCE(NEW.peer_coachee_id, OLD.peer_coachee_id);
  END IF;

  IF _coach IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  -- Only act if this user is actually a coach
  SELECT public.has_role(_coach, 'coach'::public.app_role) INTO _is_coach;
  IF NOT _is_coach THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  -- Resolve effective TOTAL limits (per-coach override -> default row -> 4)
  SELECT
    COALESCE(
      (SELECT csl.monthly_limit FROM public.coach_session_limits csl WHERE csl.coach_user_id = _coach),
      (SELECT csl.monthly_limit FROM public.coach_session_limits csl WHERE csl.coach_user_id IS NULL),
      4
    ),
    COALESCE(
      (SELECT csl.peer_monthly_limit FROM public.coach_session_limits csl WHERE csl.coach_user_id = _coach),
      (SELECT csl.peer_monthly_limit FROM public.coach_session_limits csl WHERE csl.coach_user_id IS NULL),
      4
    )
  INTO _coach_limit, _peer_limit;

  -- Count TOTAL completed sessions (lifetime)
  SELECT COUNT(*)::INT INTO _coach_used
    FROM public.sessions WHERE coachee_id = _coach AND status = 'completed';

  SELECT COUNT(*)::INT INTO _peer_used
    FROM public.peer_sessions WHERE peer_coachee_id = _coach AND status = 'completed';

  SELECT status INTO _current_status FROM public.profiles WHERE id = _coach;

  IF (_coach_used >= _coach_limit) OR (_peer_used >= _peer_limit) THEN
    IF _current_status IS DISTINCT FROM 'reach_limit'::public.user_status
       AND _current_status IN ('active'::public.user_status) THEN
      UPDATE public.profiles SET status = 'reach_limit'::public.user_status WHERE id = _coach;
    END IF;
  ELSE
    -- Below both limits: if currently flagged reach_limit, restore to active
    IF _current_status = 'reach_limit'::public.user_status THEN
      UPDATE public.profiles SET status = 'active'::public.user_status WHERE id = _coach;
    END IF;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_coach_as_coachee_limit_sessions ON public.sessions;
CREATE TRIGGER trg_enforce_coach_as_coachee_limit_sessions
AFTER INSERT OR UPDATE OF status OR DELETE ON public.sessions
FOR EACH ROW EXECUTE FUNCTION public.enforce_coach_as_coachee_limit();

DROP TRIGGER IF EXISTS trg_enforce_coach_as_coachee_limit_peer ON public.peer_sessions;
CREATE TRIGGER trg_enforce_coach_as_coachee_limit_peer
AFTER INSERT OR UPDATE OF status OR DELETE ON public.peer_sessions
FOR EACH ROW EXECUTE FUNCTION public.enforce_coach_as_coachee_limit();

-- Trigger that re-evaluates ALL coaches when their limits change (admin adjusts limits)
CREATE OR REPLACE FUNCTION public.reevaluate_coach_limits_on_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r RECORD;
  _coach_limit INT;
  _peer_limit INT;
  _coach_used INT;
  _peer_used INT;
  _default_coach INT;
  _default_peer INT;
BEGIN
  -- Default limits
  SELECT COALESCE(monthly_limit, 4), COALESCE(peer_monthly_limit, 4)
    INTO _default_coach, _default_peer
    FROM public.coach_session_limits WHERE coach_user_id IS NULL LIMIT 1;
  _default_coach := COALESCE(_default_coach, 4);
  _default_peer := COALESCE(_default_peer, 4);

  FOR r IN
    SELECT ur.user_id AS coach_id, p.status
      FROM public.user_roles ur
      JOIN public.profiles p ON p.id = ur.user_id
     WHERE ur.role = 'coach'::public.app_role
  LOOP
    SELECT COALESCE(
      (SELECT monthly_limit FROM public.coach_session_limits WHERE coach_user_id = r.coach_id),
      _default_coach
    ),
    COALESCE(
      (SELECT peer_monthly_limit FROM public.coach_session_limits WHERE coach_user_id = r.coach_id),
      _default_peer
    )
    INTO _coach_limit, _peer_limit;

    SELECT COUNT(*)::INT INTO _coach_used FROM public.sessions WHERE coachee_id = r.coach_id AND status = 'completed';
    SELECT COUNT(*)::INT INTO _peer_used FROM public.peer_sessions WHERE peer_coachee_id = r.coach_id AND status = 'completed';

    IF (_coach_used >= _coach_limit) OR (_peer_used >= _peer_limit) THEN
      IF r.status = 'active'::public.user_status THEN
        UPDATE public.profiles SET status = 'reach_limit'::public.user_status WHERE id = r.coach_id;
      END IF;
    ELSE
      IF r.status = 'reach_limit'::public.user_status THEN
        UPDATE public.profiles SET status = 'active'::public.user_status WHERE id = r.coach_id;
      END IF;
    END IF;
  END LOOP;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_reevaluate_coach_limits_on_change ON public.coach_session_limits;
CREATE TRIGGER trg_reevaluate_coach_limits_on_change
AFTER INSERT OR UPDATE OR DELETE ON public.coach_session_limits
FOR EACH ROW EXECUTE FUNCTION public.reevaluate_coach_limits_on_change();
