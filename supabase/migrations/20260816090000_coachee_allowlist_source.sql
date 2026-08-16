-- Separate coach-self-invited clients from admin-added clients for cap-check purposes.
--
-- Bug: get_own_coach_invite_slots() and coach-invite-coachee's cap check both count
-- *every* active coachee_coach_allowlist row for a coach, with no regard for who created
-- it. An admin using admin-bulk-invite-users to assign a coachee to a coach was already
-- exempt from the cap check at creation time, but that same row silently counted against
-- the coach's remaining slots the next time the coach tried to self-invite — the cap was
-- only "not enforced on the admin path", never "scoped to the coach path". Fix: tag each
-- row with its origin and filter the cap logic on it, so only coach-initiated invites
-- consume a coach's own invite limit.

ALTER TABLE public.coachee_coach_allowlist
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'coach_invite'
    CHECK (source IN ('coach_invite', 'admin_added'));

-- Backfill: existing rows have no recorded origin, but created_by tells us who actually
-- ran the insert. coach-invite-coachee always passes callerId = the coach's own id
-- (assignCoachId: callerId), while admin-bulk-invite-users passes callerId = the admin's
-- id with assignCoachId = the target coach's id — a different person. So created_by
-- equal to coach_id means it was the coach's own self-invite; anything else was created
-- on the coachee's behalf by someone other than the coach (i.e. an admin).
UPDATE public.coachee_coach_allowlist
   SET source = 'admin_added'
 WHERE created_by IS DISTINCT FROM coach_id;

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
    AND a.source = 'coach_invite'
    AND ccp.approval_status = 'active';

  RETURN QUERY SELECT _used, COALESCE(_limit, 3);
END;
$$;
