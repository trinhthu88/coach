-- Mentoring's equivalent of can_book_session()/check_can_book_session()
-- (20260810150000_can_book_session_rpc.sql) — a single function reused by
-- both the mentoring_sessions INSERT RLS policy (next migration) and a
-- frontend-callable RPC wrapper, instead of duplicating the allowlist +
-- module-access check in two places.
--
-- Unlike can_book_session(), there is no session-limit cap here — the
-- mentoring spec doesn't call for one, so this only checks profile status,
-- module access, and allowlist membership.
--
-- Confirmed before writing this: has_module_access() (20260818130100_*),
-- mentoring_allowlist (20260818140200_*), and profiles.status/user_status
-- (20260429193745_*) all already exist.

CREATE OR REPLACE FUNCTION public.can_book_mentoring_session(p_mentee_id uuid, p_mentor_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _status public.user_status;
  _module_ok boolean;
  _allowed boolean;
BEGIN
  -- Self-or-admin only, same reasoning as can_book_session(): stops this
  -- being used as an RPC-callable probe of another user's mentoring access.
  IF p_mentee_id IS DISTINCT FROM auth.uid()
     AND NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RETURN false;
  END IF;

  SELECT status INTO _status FROM public.profiles WHERE id = p_mentee_id;
  IF _status IS NULL OR _status NOT IN ('active'::public.user_status, 'reach_limit'::public.user_status) THEN
    RETURN false;
  END IF;

  SELECT public.has_module_access(p_mentee_id, 'mentoring') INTO _module_ok;
  IF NOT _module_ok THEN
    RETURN false;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.mentoring_allowlist a
    WHERE a.mentee_user_id = p_mentee_id AND a.mentor_user_id = p_mentor_id
  ) INTO _allowed;

  RETURN _allowed;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.can_book_mentoring_session(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_book_mentoring_session(uuid, uuid) TO authenticated;

-- Thin wrapper pinned to the caller, for the frontend pre-submit eligibility
-- check (mirrors check_can_book_session()).
CREATE OR REPLACE FUNCTION public.check_can_book_mentoring_session(p_mentor_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.can_book_mentoring_session(auth.uid(), p_mentor_id);
$$;

REVOKE EXECUTE ON FUNCTION public.check_can_book_mentoring_session(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.check_can_book_mentoring_session(uuid) TO authenticated;
