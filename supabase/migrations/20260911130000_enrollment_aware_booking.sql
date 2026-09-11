-- Booking authorization must be scoped to the programme enrollment being
-- consumed.  Keep the historical two-argument function as a safe compatibility
-- overload: it may only resolve an account with exactly one ongoing enrollment.

CREATE OR REPLACE FUNCTION public.can_book_session(
  p_coachee_id uuid,
  p_coach_id uuid,
  p_enrollment_id uuid
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
     AND NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RETURN false;
  END IF;

  SELECT * INTO e
  FROM public.programme_enrollments
  WHERE id = p_enrollment_id AND user_id = p_coachee_id;
  IF NOT FOUND OR e.status NOT IN ('active'::public.enrollment_status, 'at_risk'::public.enrollment_status) THEN
    RETURN false;
  END IF;

  -- The enrollment must actually include the coaching module.
  SELECT pm.config INTO module_config
  FROM public.programme_modules pm
  WHERE pm.programme_id = e.programme_id
    AND pm.module = 'coaching'::public.programme_module_type
    AND pm.enabled;
  IF NOT FOUND THEN RETURN false; END IF;

  IF public.has_role(p_coachee_id, 'coach'::public.app_role) THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.coach_as_coachee_allowlist a
      WHERE a.coach_user_id = p_coachee_id AND a.selectable_coach_id = p_coach_id
    ) THEN RETURN false; END IF;
  ELSE
    IF NOT EXISTS (
      SELECT 1 FROM public.coachee_coach_allowlist a
      WHERE a.coachee_id = p_coachee_id AND a.coach_id = p_coach_id
        AND a.removed_at IS NULL
    ) THEN RETURN false; END IF;
  END IF;

  receive_limit := NULLIF(module_config->>'receive_limit', '')::integer;
  SELECT count(*)::integer INTO used_count
  FROM public.sessions
  WHERE enrollment_id = p_enrollment_id
    AND coachee_id = p_coachee_id
    AND status = 'completed';
  RETURN receive_limit IS NULL OR used_count < receive_limit;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.can_book_session(uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_book_session(uuid, uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.can_book_session(p_coachee_id uuid, p_coach_id uuid)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE enrollment_id uuid;
BEGIN
  SELECT e.id INTO enrollment_id
  FROM public.programme_enrollments e
  WHERE e.user_id = p_coachee_id
    AND e.status IN ('active'::public.enrollment_status, 'at_risk'::public.enrollment_status);
  IF (SELECT count(*) FROM public.programme_enrollments e
      WHERE e.user_id = p_coachee_id
        AND e.status IN ('active'::public.enrollment_status, 'at_risk'::public.enrollment_status)) <> 1 THEN
    RETURN false;
  END IF;
  RETURN public.can_book_session(p_coachee_id, p_coach_id, enrollment_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.check_can_book_session(
  p_coach_id uuid,
  p_enrollment_id uuid DEFAULT NULL
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT CASE
    WHEN p_enrollment_id IS NULL THEN public.can_book_session(auth.uid(), p_coach_id)
    ELSE public.can_book_session(auth.uid(), p_coach_id, p_enrollment_id)
  END;
$$;

REVOKE EXECUTE ON FUNCTION public.check_can_book_session(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.check_can_book_session(uuid, uuid) TO authenticated;

DROP POLICY IF EXISTS "Sessions: coachee create own" ON public.sessions;
CREATE POLICY "Sessions: coachee create own" ON public.sessions
  FOR INSERT TO authenticated
  WITH CHECK (
    coachee_id = auth.uid()
    AND enrollment_id IS NOT NULL
    AND public.has_role(auth.uid(), 'coachee'::public.app_role)
    AND public.can_book_session(auth.uid(), coach_id, enrollment_id)
  );

DROP POLICY IF EXISTS "Sessions: coach create as coachee" ON public.sessions;
CREATE POLICY "Sessions: coach create as coachee" ON public.sessions
  FOR INSERT TO authenticated
  WITH CHECK (
    coachee_id = auth.uid()
    AND enrollment_id IS NOT NULL
    AND public.has_role(auth.uid(), 'coach'::public.app_role)
    AND public.can_book_session(auth.uid(), coach_id, enrollment_id)
  );

CREATE OR REPLACE FUNCTION public.validate_session_enrollment_booking()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NEW.enrollment_id IS NULL THEN
    RAISE EXCEPTION 'enrollment_id is required for programme coaching bookings' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.programme_enrollments e
    WHERE e.id = NEW.enrollment_id AND e.user_id = NEW.coachee_id
  ) THEN
    RAISE EXCEPTION 'Booking enrollment does not belong to the coachee' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sessions_enrollment_booking_scope ON public.sessions;
CREATE TRIGGER sessions_enrollment_booking_scope
  BEFORE INSERT ON public.sessions
  FOR EACH ROW EXECUTE FUNCTION public.validate_session_enrollment_booking();