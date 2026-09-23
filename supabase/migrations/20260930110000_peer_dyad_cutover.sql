-- ===========================================================================
-- Peer dyad cutover: the Admin-assigned dyad is the ONLY learner Peer
-- partner authority
-- ===========================================================================
--
-- Product rule (confirmed 2026-09-23):
--
--   Peer dyad = exactly two programme enrollments, assigned by an Admin.
--   Each participant stays enrollment-scoped; one physical Peer session
--   fulfils one Peer requirement for each participant independently
--   (peer_session_participants). Dynamic partner discovery -- the opted-in
--   own-cohort pool plus peer_cohort_permissions grants (20260922110000) --
--   is legacy and must not remain a competing booking authority.
--
-- 20260929100000 introduced peer_dyads and moved eligible_peer_partners,
-- peer_partner_enrollment and the partner-validation trigger onto it. This
-- migration finishes the cutover:
--
--   1. an enrollment belongs to at most ONE active dyad (the partner lookup
--      used LIMIT 1, so a second dyad silently picked an arbitrary partner);
--   2. admin_close_peer_dyad: the one way to end a pairing. Closing stops
--      FUTURE booking only; sessions already recorded keep their participants
--      and attribution;
--   3. peer_partner_is_eligible -- the rule every write path reads -- is the
--      dyad rule with the same usable-account and active-enrollment checks
--      eligible_peer_partners applies (it only asked "is there a dyad row");
--   4. can_book_coachee_peer_session regains the checks 20260929100000
--      dropped when it moved onto the dyad: not yourself, Peer enabled for the
--      programme, and the receive / monthly limit;
--   5. the legacy grant graph becomes read-only history: no DML for
--      authenticated users, and the pool helpers that read it are dropped.
--
-- Historical sessions are NOT rewritten or deleted, whoever the partners
-- were: every trigger below fires on INSERT (or on a change of the people),
-- never on a status change.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Membership: exactly two, same cohort + programme, one active dyad each
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.validate_peer_dyad()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  d public.peer_dyads;
  member_count integer;
BEGIN
  SELECT * INTO d FROM public.peer_dyads WHERE id = new.dyad_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Peer dyad does not exist' USING ERRCODE = '23503';
  END IF;
  IF new.status <> 'active' OR new.ended_at IS NOT NULL THEN
    RETURN new;  -- ending a membership is always allowed
  END IF;

  SELECT count(*) INTO member_count
  FROM public.peer_dyad_members
  WHERE dyad_id = new.dyad_id
    AND status = 'active'
    AND ended_at IS NULL
    AND NOT (TG_OP = 'UPDATE' AND enrollment_id = old.enrollment_id);
  IF member_count >= 2 THEN
    RAISE EXCEPTION 'A Peer dyad may have exactly two active enrollment members' USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.programme_enrollments e
    WHERE e.id = new.enrollment_id
      AND e.cohort_id = d.cohort_id
      AND e.programme_id = d.programme_id
      AND e.status IN ('active'::public.enrollment_status, 'at_risk'::public.enrollment_status)
  ) THEN
    RAISE EXCEPTION 'Peer dyad member must be an active enrollment in the dyad cohort and programme'
      USING ERRCODE = '42501';
  END IF;

  IF d.status = 'active' AND EXISTS (
    SELECT 1
    FROM public.peer_dyad_members m
    JOIN public.peer_dyads o ON o.id = m.dyad_id AND o.status = 'active'
    WHERE m.enrollment_id = new.enrollment_id
      AND m.status = 'active' AND m.ended_at IS NULL
      AND m.dyad_id <> new.dyad_id
  ) THEN
    RAISE EXCEPTION 'An enrollment may belong to only one active Peer dyad' USING ERRCODE = '23505';
  END IF;
  RETURN new;
END
$function$;

-- Re-opening a closed dyad must not give a member a second active partner.
CREATE OR REPLACE FUNCTION public.validate_peer_dyad_reopen()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF new.status = 'active' AND old.status IS DISTINCT FROM 'active' AND EXISTS (
    SELECT 1
    FROM public.peer_dyad_members m
    JOIN public.peer_dyad_members other
      ON other.enrollment_id = m.enrollment_id AND other.dyad_id <> m.dyad_id
     AND other.status = 'active' AND other.ended_at IS NULL
    JOIN public.peer_dyads o ON o.id = other.dyad_id AND o.status = 'active'
    WHERE m.dyad_id = new.id AND m.status = 'active' AND m.ended_at IS NULL
  ) THEN
    RAISE EXCEPTION 'An enrollment may belong to only one active Peer dyad' USING ERRCODE = '23505';
  END IF;
  new.updated_at := now();
  RETURN new;
END
$function$;

DROP TRIGGER IF EXISTS peer_dyads_validate_reopen ON public.peer_dyads;
CREATE TRIGGER peer_dyads_validate_reopen
  BEFORE UPDATE OF status ON public.peer_dyads
  FOR EACH ROW EXECUTE FUNCTION public.validate_peer_dyad_reopen();

COMMENT ON TABLE public.peer_dyads IS
  'An Admin-assigned learner Peer pair: exactly two active enrollments of one cohort + programme '
  '(peer_dyad_members). The only authority for learner Peer partner eligibility (20260930110000).';

-- ---------------------------------------------------------------------------
-- 2. Closing a dyad
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_close_peer_dyad(p_dyad_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Only Admin may close a Peer dyad' USING ERRCODE = '42501';
  END IF;
  UPDATE public.peer_dyads SET status = 'closed', updated_at = now()
  WHERE id = p_dyad_id AND status = 'active';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Peer dyad is not active' USING ERRCODE = 'P0002';
  END IF;
  UPDATE public.peer_dyad_members SET status = 'ended', ended_at = now()
  WHERE dyad_id = p_dyad_id AND status = 'active' AND ended_at IS NULL;
END
$function$;

REVOKE ALL ON FUNCTION public.admin_close_peer_dyad(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_close_peer_dyad(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. The eligibility rule every write path reads
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.peer_partner_is_eligible(
  p_enrollment_id uuid,
  p_partner_user_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.programme_enrollments e2
    JOIN public.profiles p ON p.id = e2.user_id
    WHERE e2.id = public.peer_dyad_partner_enrollment(p_enrollment_id, p_partner_user_id)
      AND e2.status IN ('active'::public.enrollment_status, 'at_risk'::public.enrollment_status)
      AND p.status IN ('active'::public.user_status, 'reach_limit'::public.user_status)
  );
$function$;

COMMENT ON FUNCTION public.peer_partner_is_eligible(uuid, uuid) IS
  'Whether p_partner_user_id may be the other side of a learner Peer session booked by p_enrollment_id: '
  'the partner is the enrollment''s Admin-assigned active dyad partner, with an active enrollment and a usable '
  'account. The same rule as eligible_peer_partners (20260930110000).';

CREATE OR REPLACE FUNCTION public.validate_coachee_peer_session_partner()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE owner_id uuid;
BEGIN
  IF new.peer_provider_id = new.peer_receiver_id THEN
    RAISE EXCEPTION 'A Peer session needs two different people' USING ERRCODE = '23514';
  END IF;
  IF new.enrollment_id IS NULL THEN
    RAISE EXCEPTION 'A Peer session must name the receiving learner''s enrollment' USING ERRCODE = '23502';
  END IF;
  SELECT e.user_id INTO owner_id FROM public.programme_enrollments e WHERE e.id = new.enrollment_id;
  IF owner_id IS DISTINCT FROM new.peer_receiver_id THEN
    RAISE EXCEPTION 'Peer session enrollment does not belong to the receiver' USING ERRCODE = '42501';
  END IF;
  IF NOT public.peer_partner_is_eligible(new.enrollment_id, new.peer_provider_id) THEN
    RAISE EXCEPTION 'Peer partner is not assigned to the receiver''s active dyad' USING ERRCODE = '42501';
  END IF;
  RETURN new;
END
$function$;

-- ---------------------------------------------------------------------------
-- 4. Booking gate: dyad + the checks 20260929100000 dropped
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.can_book_coachee_peer_session(
  p_provider_id uuid,
  p_enrollment_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  e public.programme_enrollments;
  cfg jsonb;
  limit_count integer;
  used_count integer;
BEGIN
  IF auth.uid() IS NULL OR p_provider_id = auth.uid() THEN
    RETURN false;
  END IF;
  SELECT * INTO e FROM public.programme_enrollments
  WHERE id = p_enrollment_id AND user_id = auth.uid();
  IF NOT FOUND OR e.status NOT IN ('active'::public.enrollment_status, 'at_risk'::public.enrollment_status) THEN
    RETURN false;
  END IF;
  -- WHO: the Admin-assigned dyad partner, and nobody else.
  IF NOT public.peer_partner_is_eligible(p_enrollment_id, p_provider_id) THEN
    RETURN false;
  END IF;
  cfg := public.enrollment_module_config(p_enrollment_id, 'peer_coaching'::public.programme_module_type);
  IF cfg IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.programme_modules pm
    WHERE pm.programme_id = e.programme_id
      AND pm.module = 'peer_coaching'::public.programme_module_type
      AND pm.enabled
  ) THEN
    RETURN false;
  END IF;
  limit_count := coalesce(public.programme_config_integer(cfg, 'receive_limit'),
                          public.programme_config_integer(cfg, 'monthly_limit'));
  SELECT count(*)::integer INTO used_count
  FROM public.coachee_peer_sessions
  WHERE enrollment_id = p_enrollment_id
    AND status IN ('pending_coach_approval', 'confirmed', 'completed');
  RETURN limit_count IS NULL OR used_count < limit_count;
END
$function$;

COMMENT ON FUNCTION public.can_book_coachee_peer_session(uuid, uuid) IS
  'Canonical learner-to-learner Peer booking eligibility for one enrollment: the provider is the enrollment''s '
  'Admin-assigned dyad partner (peer_partner_is_eligible), Peer is enabled, and the receive / monthly limit '
  'is not exhausted. The opt-in flag and cohort grants no longer grant anything (20260930110000).';

-- ---------------------------------------------------------------------------
-- 5. The legacy grant graph is read-only history
-- ---------------------------------------------------------------------------
REVOKE INSERT, UPDATE, DELETE ON public.peer_cohort_permissions FROM authenticated;
DROP POLICY IF EXISTS "Peer cohort permissions: admin manage" ON public.peer_cohort_permissions;
DROP POLICY IF EXISTS "Peer cohort permissions: admin read" ON public.peer_cohort_permissions;
CREATE POLICY "Peer cohort permissions: admin read"
  ON public.peer_cohort_permissions FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));
COMMENT ON TABLE public.peer_cohort_permissions IS
  'DEPRECATED (20260930110000). Legacy directional cohort grants of the dynamic Peer pool. Kept read-only as '
  'history; no function reads it for eligibility. Learner Peer partners come only from peer_dyads.';

DROP FUNCTION IF EXISTS public.peer_cohort_permission_issues();
DROP FUNCTION IF EXISTS public.peer_eligible_cohorts(uuid);
