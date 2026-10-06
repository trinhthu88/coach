-- ===========================================================================
-- Admin Peer re-validation (follow-up to 20261005110000_admin_session_edits,
-- finding A-2)
--
-- admin_reschedule_session() and admin_reopen_session() promised to re-run
-- the booking rules. For a coach-to-coach Peer session they only re-ran the
-- past-start and clash checks: validate_peer_session_enrollment() fires on
-- UPDATE OF enrollment_id, peer_coach_id, peer_coachee_id, and neither Admin
-- function writes those columns. An Admin could reopen a cancelled Peer
-- session over an exhausted entitlement, or move one for an enrollment that
-- is no longer ongoing, a peer coach who opted out, or a programme whose Peer
-- module is off.
--
--   1. assert_peer_session_bookable_internal(): the Peer booking rules, one
--      owner. The trigger and the Admin path both call it.
--   2. validate_peer_session_enrollment() delegates to it (no behaviour
--      change at booking).
--   3. assert_admin_session_bookable_internal() calls it for Peer, with the
--      peer coach eligibility check book_peer_session applies through
--      can_book_peer_session().
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. The Peer booking rules
-- ---------------------------------------------------------------------------
-- The entitlement counts the enrollment's other live or completed Peer
-- sessions, so a live session being moved counts itself once, as at booking.
CREATE OR REPLACE FUNCTION public.assert_peer_session_bookable_internal(
  p_session_id uuid, p_enrollment_id uuid, p_peer_coach_id uuid, p_peer_coachee_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE received_limit integer; received_count integer;
BEGIN
  IF p_enrollment_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.programme_enrollments e
    WHERE e.id = p_enrollment_id AND e.user_id = p_peer_coachee_id
      AND e.status IN ('active'::public.enrollment_status, 'at_risk'::public.enrollment_status)
  ) THEN RAISE EXCEPTION 'Peer booking receiver enrollment is invalid' USING ERRCODE = '42501'; END IF;
  IF p_peer_coach_id = p_peer_coachee_id OR NOT EXISTS (
    SELECT 1 FROM public.coach_profiles cp WHERE cp.id = p_peer_coach_id AND cp.peer_coaching_opt_in
  ) THEN RAISE EXCEPTION 'Peer booking participant is invalid' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.programme_enrollments e
    JOIN public.programme_modules pm ON pm.programme_id = e.programme_id
      AND pm.module = 'peer_coaching'::public.programme_module_type AND pm.enabled
    WHERE e.id = p_enrollment_id
  ) THEN RAISE EXCEPTION 'Peer coaching is not enabled for this enrollment' USING ERRCODE = '42501'; END IF;
  SELECT NULLIF(pm.config->>'monthly_limit', '')::integer
    INTO received_limit
  FROM public.programme_enrollments e
  JOIN public.programme_modules pm ON pm.programme_id = e.programme_id
    AND pm.module = 'peer_coaching'::public.programme_module_type AND pm.enabled
  WHERE e.id = p_enrollment_id;
  IF received_limit IS NOT NULL THEN
    SELECT count(*)::integer INTO received_count FROM public.peer_sessions ps
    WHERE ps.enrollment_id = p_enrollment_id
      AND ps.status IN ('pending_coach_approval', 'confirmed', 'completed')
      AND ps.id IS DISTINCT FROM p_session_id;
    IF received_count >= received_limit THEN
      RAISE EXCEPTION 'Peer coaching entitlement has been exhausted' USING ERRCODE = '42501';
    END IF;
  END IF;
END;
$function$;
REVOKE ALL ON FUNCTION public.assert_peer_session_bookable_internal(uuid, uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assert_peer_session_bookable_internal(uuid, uuid, uuid, uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 2. The booking trigger delegates
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.validate_peer_session_enrollment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  PERFORM public.assert_peer_session_bookable_internal(
    NEW.id, NEW.enrollment_id, NEW.peer_coach_id, NEW.peer_coachee_id);
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. The Admin path runs the Peer rules
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.assert_admin_session_bookable_internal(
  p_kind text, p_session_id uuid, p_start timestamptz, p_duration integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_coach uuid;
  v_s record;
  v_enr record;
  v_req record;
BEGIN
  IF p_start IS NULL OR p_start < now() THEN
    RAISE EXCEPTION 'A session cannot be booked in the past' USING ERRCODE = '22023';
  END IF;
  IF p_duration IS NULL OR p_duration <= 0 THEN
    RAISE EXCEPTION 'Duration must be positive' USING ERRCODE = '23514';
  END IF;

  IF p_kind = 'coaching' THEN
    SELECT s.id, s.enrollment_id, s.cohort_requirement_id, s.coach_id INTO v_s
    FROM public.sessions s WHERE s.id = p_session_id;
    v_coach := v_s.coach_id;

    SELECT e.id, e.cohort_id, e.programme_id, e.status INTO v_enr
    FROM public.programme_enrollments e WHERE e.id = v_s.enrollment_id;
    IF v_enr.id IS NULL OR v_enr.status <> 'active'::public.enrollment_status THEN
      RAISE EXCEPTION 'Enrollment is not active' USING ERRCODE = '42501';
    END IF;
    IF v_enr.cohort_id IS NULL THEN
      RAISE EXCEPTION 'Enrollment has no cohort; Coaching cannot be booked' USING ERRCODE = '42501';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.programme_modules m
      WHERE m.programme_id = v_enr.programme_id
        AND m.module = 'coaching'::public.programme_module_type AND m.enabled
    ) THEN
      RAISE EXCEPTION 'Coaching is not enabled for this programme' USING ERRCODE = '42501';
    END IF;

    SELECT d.id, d.cohort_id, d.module, d.due_on INTO v_req
    FROM public.cohort_requirement_dates d WHERE d.id = v_s.cohort_requirement_id;
    IF v_req.id IS NULL OR v_req.module <> 'coaching'::public.programme_module_type
       OR v_req.cohort_id IS DISTINCT FROM v_enr.cohort_id THEN
      RAISE EXCEPTION 'The session is not attributed to a Coaching requirement of its cohort' USING ERRCODE = '42501';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.sessions o
      WHERE o.cohort_requirement_id = v_req.id
        AND o.enrollment_id = v_s.enrollment_id
        AND o.id <> p_session_id
        AND o.status IN ('pending_coach_approval', 'confirmed', 'completed')
        AND public.session_occupies_requirement(o.status, o.start_time, v_req.due_on)
    ) THEN
      RAISE EXCEPTION 'Coaching requirement % already has a live or completed session', v_req.id
        USING ERRCODE = '23505';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.cohort_coaching_coach_pool(v_enr.cohort_id) p WHERE p.coach_id = v_coach
    ) THEN
      RAISE EXCEPTION 'Coach % is not assigned to cohort %', v_coach, v_enr.cohort_id USING ERRCODE = '42501';
    END IF;
  ELSE
    SELECT s.id, s.enrollment_id, s.peer_coach_id, s.peer_coachee_id INTO v_s
    FROM public.peer_sessions s WHERE s.id = p_session_id;
    v_coach := v_s.peer_coach_id;
    -- book_peer_session's rules: the peer coach is still eligible, and the
    -- receiver's enrollment, the opt-in, the module and the entitlement pass.
    IF NOT public.is_coach_eligible(v_coach) THEN
      RAISE EXCEPTION 'Peer coach % is not eligible', v_coach USING ERRCODE = '42501';
    END IF;
    PERFORM public.assert_peer_session_bookable_internal(
      v_s.id, v_s.enrollment_id, v_s.peer_coach_id, v_s.peer_coachee_id);
  END IF;

  -- The Coach (Peer: the peer coach) is not in two live sessions at once.
  IF EXISTS (
    SELECT 1 FROM public.sessions o
    WHERE o.coach_id = v_coach AND o.status IN ('pending_coach_approval', 'confirmed')
      AND NOT (p_kind = 'coaching' AND o.id = p_session_id)
      AND tstzrange(o.start_time, o.start_time + make_interval(mins => o.duration_minutes))
          && tstzrange(p_start, p_start + make_interval(mins => p_duration))
    UNION ALL
    SELECT 1 FROM public.peer_sessions o
    WHERE o.peer_coach_id = v_coach AND o.status IN ('pending_coach_approval', 'confirmed')
      AND NOT (p_kind = 'peer' AND o.id = p_session_id)
      AND tstzrange(o.start_time, o.start_time + make_interval(mins => o.duration_minutes))
          && tstzrange(p_start, p_start + make_interval(mins => p_duration))
  ) THEN
    RAISE EXCEPTION 'The Coach already has a session at that time' USING ERRCODE = '23505';
  END IF;
END;
$function$;
REVOKE ALL ON FUNCTION public.assert_admin_session_bookable_internal(text, uuid, timestamptz, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assert_admin_session_bookable_internal(text, uuid, timestamptz, integer) TO service_role;
