-- Repoint coach-side limit enforcement at coach_programme_enrollments / coach_programmes
-- instead of coach_session_limits. NULL on a coach_programmes limit column means
-- unlimited (never counts toward "reached limit" / never blocks booking) — this is new:
-- coach_session_limits columns were NOT NULL with a hardcoded default of 4, so nothing
-- was ever "unlimited" before. A coach with no coach_programme_enrollments row at all
-- (shouldn't happen for any coach that existed at migration time; can happen for a coach
-- approved after this migration before an admin enrolls them) falls back to 4 for both
-- dimensions, matching the old COALESCE(personal, global-default, 4) fallback chain's
-- final value.
--
-- Lifetime-total counting semantics (no calendar-month filter) are unchanged from the
-- Phase 4 fix in 20260810123000_fix_peer_usage_lifetime.sql and the original
-- enforce_coach_as_coachee_limit() — both continue to COUNT(*) over ALL matching rows.

-- 1. get_coach_peer_session_usage: peer_received_limit via enrollment, lifetime peer usage.
CREATE OR REPLACE FUNCTION public.get_coach_peer_session_usage(_coach_id uuid)
RETURNS TABLE(peer_monthly_limit integer, used_this_month integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    CASE WHEN cpe.coach_id IS NULL THEN 4 ELSE cp.peer_received_limit END AS peer_monthly_limit,
    (
      SELECT COUNT(*)::int FROM public.peer_sessions ps
      WHERE ps.peer_coachee_id = _coach_id
        AND ps.status IN ('pending_coach_approval','confirmed','completed')
    ) AS used_this_month
  FROM (SELECT _coach_id AS id) x
  LEFT JOIN public.coach_programme_enrollments cpe ON cpe.coach_id = x.id
  LEFT JOIN public.coach_programmes cp ON cp.id = cpe.coach_programme_id;
$$;

-- 2. enforce_coach_as_coachee_limit: mentee_sessions_limit + peer_received_limit via enrollment.
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
  _has_enrollment BOOLEAN;
BEGIN
  IF TG_TABLE_NAME = 'sessions' THEN
    _coach := COALESCE(NEW.coachee_id, OLD.coachee_id);
  ELSIF TG_TABLE_NAME = 'peer_sessions' THEN
    _coach := COALESCE(NEW.peer_coachee_id, OLD.peer_coachee_id);
  END IF;

  IF _coach IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT public.has_role(_coach, 'coach'::public.app_role) INTO _is_coach;
  IF NOT _is_coach THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT cpe.coach_id IS NOT NULL, cp.mentee_sessions_limit, cp.peer_received_limit
    INTO _has_enrollment, _coach_limit, _peer_limit
  FROM (SELECT _coach AS id) x
  LEFT JOIN public.coach_programme_enrollments cpe ON cpe.coach_id = x.id
  LEFT JOIN public.coach_programmes cp ON cp.id = cpe.coach_programme_id;

  IF NOT _has_enrollment THEN
    _coach_limit := 4;
    _peer_limit := 4;
  END IF;

  SELECT COUNT(*)::INT INTO _coach_used
    FROM public.sessions WHERE coachee_id = _coach AND status = 'completed';

  SELECT COUNT(*)::INT INTO _peer_used
    FROM public.peer_sessions WHERE peer_coachee_id = _coach AND status = 'completed';

  SELECT status INTO _current_status FROM public.profiles WHERE id = _coach;

  IF (_coach_limit IS NOT NULL AND _coach_used >= _coach_limit)
     OR (_peer_limit IS NOT NULL AND _peer_used >= _peer_limit) THEN
    IF _current_status IS DISTINCT FROM 'reach_limit'::public.user_status
       AND _current_status IN ('active'::public.user_status) THEN
      UPDATE public.profiles SET status = 'reach_limit'::public.user_status WHERE id = _coach;
    END IF;
  ELSE
    IF _current_status = 'reach_limit'::public.user_status THEN
      UPDATE public.profiles SET status = 'active'::public.user_status WHERE id = _coach;
    END IF;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- 3. reevaluate_coach_limits_on_change: re-scan every coach when admin edits a coach
--    programme's limits or changes a coach's enrollment (was: on coach_session_limits
--    changes; that table is no longer written by application code).
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
BEGIN
  FOR r IN
    SELECT ur.user_id AS coach_id, p.status
      FROM public.user_roles ur
      JOIN public.profiles p ON p.id = ur.user_id
     WHERE ur.role = 'coach'::public.app_role
  LOOP
    SELECT cp.mentee_sessions_limit, cp.peer_received_limit
      INTO _coach_limit, _peer_limit
    FROM public.coach_programme_enrollments cpe
    JOIN public.coach_programmes cp ON cp.id = cpe.coach_programme_id
    WHERE cpe.coach_id = r.coach_id;

    IF NOT FOUND THEN
      _coach_limit := 4;
      _peer_limit := 4;
    END IF;

    SELECT COUNT(*)::INT INTO _coach_used FROM public.sessions WHERE coachee_id = r.coach_id AND status = 'completed';
    SELECT COUNT(*)::INT INTO _peer_used FROM public.peer_sessions WHERE peer_coachee_id = r.coach_id AND status = 'completed';

    IF (_coach_limit IS NOT NULL AND _coach_used >= _coach_limit)
       OR (_peer_limit IS NOT NULL AND _peer_used >= _peer_limit) THEN
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

CREATE TRIGGER trg_reevaluate_coach_limits_on_enrollment_change
AFTER INSERT OR UPDATE OR DELETE ON public.coach_programme_enrollments
FOR EACH ROW EXECUTE FUNCTION public.reevaluate_coach_limits_on_change();

CREATE TRIGGER trg_reevaluate_coach_limits_on_programme_change
AFTER UPDATE ON public.coach_programmes
FOR EACH ROW EXECUTE FUNCTION public.reevaluate_coach_limits_on_change();

-- 4. can_book_session: booking-time (INSERT) gate for the coach-as-coachee relationship
--    must use the same source as completion-time enforcement above, or a coach could be
--    let through at booking time on stale coach_session_limits data and only get flagged
--    reactively after completion.
CREATE OR REPLACE FUNCTION public.can_book_session(p_coachee_id uuid, p_coach_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _status public.user_status;
  _is_coach boolean;
  _allowed boolean;
  _limit int;
  _used int;
BEGIN
  IF p_coachee_id IS DISTINCT FROM auth.uid()
     AND NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RETURN false;
  END IF;

  SELECT status INTO _status FROM public.profiles WHERE id = p_coachee_id;
  IF _status IS NULL OR _status NOT IN ('active'::public.user_status, 'reach_limit'::public.user_status) THEN
    RETURN false;
  END IF;

  SELECT public.has_role(p_coachee_id, 'coach'::public.app_role) INTO _is_coach;

  IF _is_coach THEN
    SELECT EXISTS (
      SELECT 1 FROM public.coach_as_coachee_allowlist a
      WHERE a.coach_user_id = p_coachee_id AND a.selectable_coach_id = p_coach_id
    ) INTO _allowed;

    SELECT cp.mentee_sessions_limit INTO _limit
    FROM public.coach_programme_enrollments cpe
    JOIN public.coach_programmes cp ON cp.id = cpe.coach_programme_id
    WHERE cpe.coach_id = p_coachee_id;

    IF NOT FOUND THEN
      _limit := 4;
    END IF;
  ELSE
    SELECT EXISTS (
      SELECT 1 FROM public.coachee_coach_allowlist a
      WHERE a.coachee_id = p_coachee_id AND a.coach_id = p_coach_id
    ) INTO _allowed;

    SELECT COALESCE(
      (SELECT sl.monthly_limit FROM public.session_limits sl WHERE sl.coachee_id = p_coachee_id),
      (SELECT sl.monthly_limit FROM public.session_limits sl WHERE sl.coachee_id IS NULL),
      4
    ) INTO _limit;
  END IF;

  IF NOT _allowed THEN
    RETURN false;
  END IF;

  SELECT COUNT(*)::int INTO _used
    FROM public.sessions WHERE coachee_id = p_coachee_id AND status = 'completed';

  RETURN _limit IS NULL OR _used < _limit;
END;
$$;
