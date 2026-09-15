-- Canonical coach eligibility: an account and its coach profile must both be
-- active.  Keep this check in one SECURITY DEFINER function so all booking
-- and discovery paths use identical, fail-closed semantics.
CREATE OR REPLACE FUNCTION public.is_coach_eligible(p_coach_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    -- Any authenticated caller may ask whether a coach is eligible; table RLS
    -- still controls which profile data the caller may see.
    auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.profiles p
      JOIN public.coach_profiles cp ON cp.id = p.id
      WHERE p.id = p_coach_id
        AND p.status = 'active'::public.user_status
        AND cp.approval_status = 'active'::public.user_status
    );
$$;

REVOKE EXECUTE ON FUNCTION public.is_coach_eligible(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_coach_eligible(uuid) TO authenticated;

-- The booking functions are authoritative server-side gates.  The caller
-- authorization above is intentionally retained by can_book_session.
CREATE OR REPLACE FUNCTION public.can_book_session(
  p_coachee_id uuid, p_coach_id uuid, p_enrollment_id uuid
) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  e public.programme_enrollments;
  module_config jsonb;
  receive_limit integer;
  used_count integer;
BEGIN
  IF p_coachee_id IS DISTINCT FROM auth.uid()
     AND NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN RETURN false; END IF;
  -- Use the canonical rule, while preserving enrollment ownership and allowlists.
  IF NOT public.is_coach_eligible(p_coach_id) THEN RETURN false; END IF;
  SELECT * INTO e FROM public.programme_enrollments
    WHERE id = p_enrollment_id AND user_id = p_coachee_id;
  IF NOT FOUND OR e.status NOT IN ('active'::public.enrollment_status, 'at_risk'::public.enrollment_status) THEN RETURN false; END IF;
  SELECT pm.config INTO module_config FROM public.programme_modules pm
    WHERE pm.programme_id = e.programme_id AND pm.module = 'coaching'::public.programme_module_type AND pm.enabled;
  IF NOT FOUND THEN RETURN false; END IF;
  IF public.has_role(p_coachee_id, 'coach'::public.app_role) THEN
    IF NOT EXISTS (SELECT 1 FROM public.coach_as_coachee_allowlist a
      WHERE a.coach_user_id = p_coachee_id AND a.selectable_coach_id = p_coach_id) THEN RETURN false; END IF;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM public.coachee_coach_allowlist a
      WHERE a.coachee_id = p_coachee_id AND a.coach_id = p_coach_id AND a.removed_at IS NULL) THEN RETURN false; END IF;
  END IF;
  receive_limit := NULLIF(module_config->>'receive_limit', '')::integer;
  SELECT count(*)::integer INTO used_count FROM public.sessions
    WHERE enrollment_id = p_enrollment_id AND coachee_id = p_coachee_id AND status = 'completed';
  RETURN receive_limit IS NULL OR used_count < receive_limit;
END;
$$;

-- Peer booking is a discovery/booking path too; retain its existing
-- enrollment and opt-in checks and add the canonical active-coach check.
CREATE OR REPLACE FUNCTION public.can_book_peer_session(
  p_peer_coach_id uuid, p_enrollment_id uuid
) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT public.is_coach_eligible(p_peer_coach_id)
    AND auth.uid() IS NOT NULL
    AND e.user_id=auth.uid()
    AND e.status IN ('active'::public.enrollment_status,'at_risk'::public.enrollment_status)
    AND e.user_id <> p_peer_coach_id
    AND EXISTS (SELECT 1 FROM public.coach_profiles cp
                WHERE cp.id=p_peer_coach_id AND cp.peer_coaching_opt_in)
    AND EXISTS (SELECT 1 FROM public.programme_modules pm
                WHERE pm.programme_id=e.programme_id
                  AND pm.module='peer_coaching'::public.programme_module_type
                  AND pm.enabled)
    AND (
      (SELECT NULLIF(pm.config->>'monthly_limit','')::integer
       FROM public.programme_modules pm
       WHERE pm.programme_id=e.programme_id
         AND pm.module='peer_coaching'::public.programme_module_type
         AND pm.enabled) IS NULL
      OR EXISTS (SELECT 1 FROM public.get_peer_session_usage(p_enrollment_id)
                WHERE used_count < monthly_limit)
    )
  FROM public.programme_enrollments e WHERE e.id=p_enrollment_id;
$$;