-- Closes the "at risk" row flagged in RULES.md §3 (Relationship 4):
-- MentoringFindMentor.tsx independently queried mentoring_allowlist and
-- filtered mentor_profiles.is_active in JS, duplicating an eligibility
-- condition that can_book_mentoring_session() doesn't even check today —
-- so an inactive mentor was invisible in the list but still bookable via a
-- direct booking-page URL or RPC call. Fix both sides: teach
-- can_book_mentoring_session() about is_active, and give the frontend a
-- single RPC (mirroring get_own_coach_invite_slots()'s "pinned to
-- auth.uid()" style) instead of a client-side join/filter.

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
    SELECT 1
    FROM public.mentoring_allowlist a
    JOIN public.mentor_profiles mp ON mp.coach_user_id = a.mentor_user_id
    WHERE a.mentee_user_id = p_mentee_id
      AND a.mentor_user_id = p_mentor_id
      AND mp.is_active
  ) INTO _allowed;

  RETURN _allowed;
END;
$$;

-- Single source of truth for "which mentors can this mentee book" — used by
-- MentoringFindMentor.tsx in place of its former direct
-- mentoring_allowlist/mentor_profiles query + client-side is_active filter.
-- Pinned to auth.uid() so it can't be used to probe another user's pairing.
CREATE OR REPLACE FUNCTION public.get_my_mentors()
RETURNS TABLE(mentor_user_id uuid, bio text, expertise_tags text[], full_name text, avatar_url text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    mp.coach_user_id,
    mp.bio,
    mp.expertise_tags,
    p.full_name,
    p.avatar_url
  FROM public.mentoring_allowlist a
  JOIN public.mentor_profiles mp ON mp.coach_user_id = a.mentor_user_id
  JOIN public.profiles p ON p.id = mp.coach_user_id
  WHERE a.mentee_user_id = auth.uid()
    AND mp.is_active;
$$;

REVOKE EXECUTE ON FUNCTION public.get_my_mentors() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_mentors() TO authenticated;
