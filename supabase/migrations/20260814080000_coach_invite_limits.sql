-- Coach-invited coachees with a capped invite limit.
--
-- 1) Soft-delete `coachee_coach_allowlist` via `removed_at` instead of hard-deleting rows,
--    so history (past sessions, audit trail) is preserved when a coach removes a client.
-- 2) Per-coach override for the invite cap (`coach_profiles.max_coachee_invites`); NULL
--    means "use the platform default of 3" — not used by any enforcement yet except the
--    new edge function in a later phase, this migration only adds the column.
-- 3) Every existing function/policy that reads `coachee_coach_allowlist` must now also
--    require `removed_at IS NULL`, or a soft-removed pair would still count as active.
--    Found via `grep -rln "coachee_coach_allowlist" supabase/migrations/`:
--      - coach_visible_to_coachee()      (20260430100320_*)
--      - coachee_has_allowlist()          (20260430100320_*)
--      - is_allowlisted_pair()            (20260501185440_*)
--      - can_book_session()               latest def in 20260811132000_* — this is what the
--        `sessions` "coachee create own" / "coach create as coachee" INSERT policies call
--        today (20260810120000_*'s inline EXISTS check was itself superseded by
--        20260810150000_* / 20260811132000_*'s can_book_session() indirection), so updating
--        this one function is what actually gates INSERT now.
-- 4) `remove_own_coachee()` is the only write path a coach gets on this table — no RLS
--    UPDATE policy is added for coaches, so a coach cannot touch any row but the one this
--    function targets (its own coach_id, matching coachee, still active).

-- 1) Soft-delete flag.
ALTER TABLE public.coachee_coach_allowlist
  ADD COLUMN IF NOT EXISTS removed_at timestamptz NULL;

-- 2) Per-coach override for the invite cap; NULL = platform default (3).
ALTER TABLE public.coach_profiles
  ADD COLUMN IF NOT EXISTS max_coachee_invites integer NULL;

-- 3a) coachee_has_allowlist()
CREATE OR REPLACE FUNCTION public.coachee_has_allowlist(_coachee_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.coachee_coach_allowlist
    WHERE coachee_id = _coachee_id AND removed_at IS NULL
  );
$$;

-- 3b) coach_visible_to_coachee()
CREATE OR REPLACE FUNCTION public.coach_visible_to_coachee(_coach_id uuid, _coachee_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.coachee_coach_allowlist
    WHERE coachee_id = _coachee_id AND coach_id = _coach_id AND removed_at IS NULL
  );
$$;

-- 3c) is_allowlisted_pair()
CREATE OR REPLACE FUNCTION public.is_allowlisted_pair(_viewer uuid, _target uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.coachee_coach_allowlist a
    WHERE ((a.coachee_id = _viewer AND a.coach_id = _target)
       OR (a.coach_id   = _viewer AND a.coachee_id = _target))
      AND a.removed_at IS NULL
  );
$$;

-- 3d) can_book_session() — latest definition (20260811132000_coach_programmes_enforcement.sql),
--     unchanged apart from the `removed_at IS NULL` guard on the relationship-1 allowlist check.
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
      WHERE a.coachee_id = p_coachee_id AND a.coach_id = p_coach_id AND a.removed_at IS NULL
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

-- 4) remove_own_coachee(): the only write path a coach gets on coachee_coach_allowlist.
--    No general RLS UPDATE policy is added for coaches — this SECURITY DEFINER function
--    is scoped to soft-removing exactly one row the caller owns as coach_id.
CREATE OR REPLACE FUNCTION public.remove_own_coachee(_coachee_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _row_count int;
BEGIN
  IF NOT public.has_role(auth.uid(), 'coach'::public.app_role) THEN
    RETURN false;
  END IF;

  UPDATE public.coachee_coach_allowlist
     SET removed_at = now()
   WHERE coach_id = auth.uid()
     AND coachee_id = _coachee_id
     AND removed_at IS NULL;

  GET DIAGNOSTICS _row_count = ROW_COUNT;
  RETURN _row_count > 0;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.remove_own_coachee(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.remove_own_coachee(uuid) TO authenticated;
