-- Phase 3: centralize booking eligibility (relationships 1 and 2 from RULES.md — the
-- coachee->coach allowlist and the coach-as-coachee allowlist, both of which insert into
-- `sessions`) into a single function, instead of duplicating the rule across an RLS
-- policy and a client-side re-derivation.
--
-- This also closes a real gap, not just a style issue: today neither "Sessions: coachee
-- create own" nor "Sessions: coach create as coachee" checks the session-limit cap at
-- INSERT time — the cap is only enforced reactively, via a trigger that flips
-- profiles.status to 'reach_limit' AFTER a session is marked completed. Nothing in the DB
-- currently stops a client from inserting past the limit; it's blocked only by the
-- frontend's disabled Confirm button (BookSession.tsx canSubmit). can_book_session() adds
-- a real DB-level backstop for that.
--
-- Confirmed before writing this: `has_role`, `coachee_coach_allowlist`,
-- `coach_as_coachee_allowlist`, `session_limits`, and `coach_session_limits` all already
-- exist (see 20260429193745_*, 20260430100320_*, 20260430143232_*, 20260429212627_*).
-- The COALESCE(personal override, global default row, 4) pattern below matches
-- get_coachee_session_usage() and enforce_coach_as_coachee_limit() exactly, so this
-- doesn't change what counts as "the limit" — it just gives booking-time INSERT the same
-- view of the limit that completion-time already had.

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
  -- Self-or-admin only: prevents using this as an RPC-callable probe to learn another
  -- user's session-limit/allowlist status. Both call sites (the RLS policies below, and
  -- the check_can_book_session() wrapper) always pass auth.uid() as p_coachee_id.
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
    -- Relationship 2: coach booking a mentor coach as their own coachee.
    SELECT EXISTS (
      SELECT 1 FROM public.coach_as_coachee_allowlist a
      WHERE a.coach_user_id = p_coachee_id AND a.selectable_coach_id = p_coach_id
    ) INTO _allowed;

    SELECT COALESCE(
      (SELECT csl.monthly_limit FROM public.coach_session_limits csl WHERE csl.coach_user_id = p_coachee_id),
      (SELECT csl.monthly_limit FROM public.coach_session_limits csl WHERE csl.coach_user_id IS NULL),
      4
    ) INTO _limit;
  ELSE
    -- Relationship 1: regular coachee booking a coach.
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

  RETURN _used < _limit;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.can_book_session(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_book_session(uuid, uuid) TO authenticated;

-- Thin RPC wrapper for the frontend: pins p_coachee_id to the caller so BookSession.tsx
-- can pre-check eligibility for a friendly message before submitting, without needing to
-- pass (or being able to spoof) a coachee id itself.
CREATE OR REPLACE FUNCTION public.check_can_book_session(p_coach_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.can_book_session(auth.uid(), p_coach_id);
$$;

REVOKE EXECUTE ON FUNCTION public.check_can_book_session(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.check_can_book_session(uuid) TO authenticated;

-- Point the two `sessions` INSERT policies at the shared function instead of their own
-- inline allowlist EXISTS checks. This also adds the session-limit enforcement described
-- above, which neither policy had before.
DROP POLICY IF EXISTS "Sessions: coachee create own" ON public.sessions;
CREATE POLICY "Sessions: coachee create own"
  ON public.sessions
  FOR INSERT TO authenticated
  WITH CHECK (
    coachee_id = auth.uid()
    AND public.has_role(auth.uid(), 'coachee'::public.app_role)
    AND public.can_book_session(auth.uid(), coach_id)
  );

DROP POLICY IF EXISTS "Sessions: coach create as coachee" ON public.sessions;
CREATE POLICY "Sessions: coach create as coachee"
  ON public.sessions
  FOR INSERT TO authenticated
  WITH CHECK (
    coachee_id = auth.uid()
    AND public.has_role(auth.uid(), 'coach'::public.app_role)
    AND public.can_book_session(auth.uid(), coach_id)
  );
