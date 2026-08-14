-- Phase 3 (coach-invite-coachee UI): the frontend needs to show "N of LIMIT clients
-- invited" next to the invite button, computed the same way the coach-invite-coachee
-- edge function computes its cap check.
--
-- Doing this as a direct client-side query (coachee_coach_allowlist + coachee_profiles)
-- would silently undercount: "Coachee profiles: coach view booked" only lets a coach
-- SELECT a coachee_profiles row for someone who has actually booked a session with
-- them (supabase/migrations/20260429212627_*), not merely someone on their allowlist.
-- A freshly-invited, not-yet-booked coachee would be invisible to that query. Rather
-- than loosen that RLS policy (out of scope, and broader than this feature needs), this
-- mirrors check_can_book_session()'s existing pattern: a SECURITY DEFINER function
-- self-pinned to auth.uid(), granted to authenticated only, returning just the two
-- numbers the UI needs.

CREATE OR REPLACE FUNCTION public.get_own_coach_invite_slots()
RETURNS TABLE(used_slots integer, invite_limit integer)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _limit int;
  _used int;
BEGIN
  IF NOT public.has_role(auth.uid(), 'coach'::public.app_role) THEN
    RETURN QUERY SELECT 0, 3;
    RETURN;
  END IF;

  SELECT COALESCE(cp.max_coachee_invites, 3) INTO _limit
  FROM public.coach_profiles cp WHERE cp.id = auth.uid();

  SELECT COUNT(*)::int INTO _used
  FROM public.coachee_coach_allowlist a
  JOIN public.coachee_profiles ccp ON ccp.id = a.coachee_id
  WHERE a.coach_id = auth.uid()
    AND a.removed_at IS NULL
    AND ccp.approval_status = 'active';

  RETURN QUERY SELECT _used, COALESCE(_limit, 3);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_own_coach_invite_slots() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_own_coach_invite_slots() TO authenticated;
