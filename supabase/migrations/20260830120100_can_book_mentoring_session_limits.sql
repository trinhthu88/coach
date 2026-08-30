-- Phase 1.5 continued: fold the two new limit checks into the single
-- booking gate, per the task brief — "all four checks live in one
-- function, used both by the mentoring_sessions INSERT RLS policy... and by
-- a check_can_book_mentoring_session() RPC the frontend calls pre-submit."
--
-- can_book_mentoring_session(uuid, uuid) keeps its exact signature and
-- boolean return type so the existing RLS policy
-- ("MentoringSessions: mentee create own", 20260818140400_*) and the
-- existing check_can_book_mentoring_session() RPC need no changes and pick
-- up the new checks automatically via CREATE OR REPLACE. The actual logic
-- moves into can_book_mentoring_session_reason(), which returns which check
-- failed so the frontend can show "you're at your limit" vs "this mentor
-- isn't taking new sessions right now" instead of one generic message.

CREATE OR REPLACE FUNCTION public.can_book_mentoring_session_reason(p_mentee_id uuid, p_mentor_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _status public.user_status;
  _module_ok boolean;
  _allowed boolean;
  _received_limit int;
  _received_used int;
  _given_limit int;
  _given_used int;
BEGIN
  IF p_mentee_id IS DISTINCT FROM auth.uid()
     AND NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RETURN 'forbidden';
  END IF;

  SELECT status INTO _status FROM public.profiles WHERE id = p_mentee_id;
  IF _status IS NULL OR _status NOT IN ('active'::public.user_status, 'reach_limit'::public.user_status) THEN
    RETURN 'inactive';
  END IF;

  SELECT public.has_module_access(p_mentee_id, 'mentoring') INTO _module_ok;
  IF NOT _module_ok THEN
    RETURN 'module_access';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.mentoring_allowlist a
    JOIN public.mentor_profiles mp ON mp.coach_user_id = a.mentor_user_id
    WHERE a.mentee_user_id = p_mentee_id AND a.mentor_user_id = p_mentor_id AND mp.is_active
  ) INTO _allowed;
  IF NOT _allowed THEN
    RETURN 'not_allowlisted';
  END IF;

  SELECT * INTO _received_limit, _received_used FROM public.get_mentoring_session_usage(p_mentee_id);
  IF _received_limit IS NOT NULL AND _received_used >= _received_limit THEN
    RETURN 'received_limit_reached';
  END IF;

  SELECT * INTO _given_limit, _given_used FROM public.get_mentoring_given_usage(p_mentor_id);
  IF _given_limit IS NOT NULL AND _given_used >= _given_limit THEN
    RETURN 'given_limit_reached';
  END IF;

  RETURN 'ok';
END;
$$;

REVOKE EXECUTE ON FUNCTION public.can_book_mentoring_session_reason(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_book_mentoring_session_reason(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.can_book_mentoring_session(p_mentee_id uuid, p_mentor_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.can_book_mentoring_session_reason(p_mentee_id, p_mentor_id) = 'ok';
$$;

REVOKE EXECUTE ON FUNCTION public.can_book_mentoring_session(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_book_mentoring_session(uuid, uuid) TO authenticated;

-- New frontend-callable reason wrapper, pinned to the caller (mirrors
-- check_can_book_mentoring_session()).
CREATE OR REPLACE FUNCTION public.check_can_book_mentoring_session_reason(p_mentor_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.can_book_mentoring_session_reason(auth.uid(), p_mentor_id);
$$;

REVOKE EXECUTE ON FUNCTION public.check_can_book_mentoring_session_reason(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.check_can_book_mentoring_session_reason(uuid) TO authenticated;
