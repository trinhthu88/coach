-- ===========================================================================
-- Peer booking rules (product decisions of 2026-10-06; findings L-6, P-3, P-5)
--
-- Two kinds of Peer session, two rules:
--
--   * A DYAD session (coachee_peer_sessions, with the Admin-assigned partner)
--     earns a Peer requirement. It is eligible on the same rule as Coaching
--     and Mentoring: a free Peer requirement (next_peer_requirement) + the
--     assigned partner + the goal gate. can_book_coachee_peer_session capped it
--     with receive_limit / monthly_limit over the enrollment's lifetime and
--     ignored the goal gate; a stored receive_limit below required_units made
--     the programme impossible to complete.
--   * PRACTICE (peer_sessions, the Coach opt-in pool) earns nothing. Its
--     allowance, programme_modules.config monthly_limit, is per calendar month
--     in Asia/Ho_Chi_Minh, as its name says. The booking check and
--     get_peer_session_usage counted the enrollment's whole lifetime instead.
--
-- 1. programme_time_zone(): the one programme time zone. The availability
--    slot time zone reads it.
-- 2. peer_practice_month_count_internal(): practice sessions in one Vietnamese
--    month -- the single count behind both the booking check and the usage a
--    page shows.
-- 3. assert_peer_session_bookable_internal() takes the session's start and
--    counts its month; the booking trigger and the Admin path pass it.
-- 4. can_book_coachee_peer_session(): free requirement + partner + goal gate.
--    The insert backstop checks partner + requirement; the goal gate keeps
--    its own backstop (enforce_booking_goal_gate) and exemptions.
-- 5. validate_programme_module_config() no longer compares the Peer target
--    with a limit: the practice limit caps practice, not requirements.
-- 6. The allowance readers nothing calls are dropped; no function reads
--    receive_limit, give_limit, programmes.coachee_session_limit or
--    mentoring_received_limit any more (the values stay, as history, until a
--    later cleanup).
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. The programme time zone
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.programme_time_zone()
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT 'Asia/Ho_Chi_Minh'::text;
$function$;
GRANT EXECUTE ON FUNCTION public.programme_time_zone() TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.availability_slot_time_zone(p_coach_id uuid)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT public.programme_time_zone();
$function$;

-- ---------------------------------------------------------------------------
-- 2. Practice sessions in one Vietnamese calendar month
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.peer_practice_month_count_internal(
  p_enrollment_id uuid, p_at timestamptz, p_exclude_session_id uuid DEFAULT NULL)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT count(*)::integer
  FROM public.peer_sessions ps
  WHERE ps.enrollment_id = p_enrollment_id
    AND ps.status IN ('pending_coach_approval', 'confirmed', 'completed')
    AND ps.id IS DISTINCT FROM p_exclude_session_id
    AND date_trunc('month', ps.start_time AT TIME ZONE public.programme_time_zone())
      = date_trunc('month', p_at AT TIME ZONE public.programme_time_zone());
$function$;
REVOKE ALL ON FUNCTION public.peer_practice_month_count_internal(uuid, timestamptz, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.peer_practice_month_count_internal(uuid, timestamptz, uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 3. Practice booking rules, counted by the session's month
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.assert_peer_session_bookable_internal(uuid, uuid, uuid, uuid);
CREATE OR REPLACE FUNCTION public.assert_peer_session_bookable_internal(
  p_session_id uuid, p_enrollment_id uuid, p_peer_coach_id uuid, p_peer_coachee_id uuid,
  p_start_time timestamptz)
 RETURNS void
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE monthly integer;
BEGIN
  IF p_enrollment_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.programme_enrollments e
    WHERE e.id = p_enrollment_id AND e.user_id = p_peer_coachee_id
      AND e.status IN ('active'::public.enrollment_status, 'at_risk'::public.enrollment_status)
  ) THEN RAISE EXCEPTION 'Peer booking receiver enrollment is invalid' USING ERRCODE = '42501'; END IF;
  IF p_peer_coach_id = p_peer_coachee_id OR NOT EXISTS (
    SELECT 1 FROM public.coach_profiles cp WHERE cp.id = p_peer_coach_id AND cp.peer_coaching_opt_in
  ) THEN RAISE EXCEPTION 'Peer booking participant is invalid' USING ERRCODE = '42501'; END IF;
  SELECT public.programme_config_integer(pm.config, 'monthly_limit') INTO monthly
  FROM public.programme_enrollments e
  JOIN public.programme_modules pm ON pm.programme_id = e.programme_id
    AND pm.module = 'peer_coaching'::public.programme_module_type AND pm.enabled
  WHERE e.id = p_enrollment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Peer coaching is not enabled for this enrollment' USING ERRCODE = '42501';
  END IF;
  IF monthly IS NOT NULL
     AND public.peer_practice_month_count_internal(p_enrollment_id, p_start_time, p_session_id) >= monthly THEN
    RAISE EXCEPTION 'Peer coaching entitlement has been exhausted' USING ERRCODE = '42501';
  END IF;
END;
$function$;
REVOKE ALL ON FUNCTION public.assert_peer_session_bookable_internal(uuid, uuid, uuid, uuid, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assert_peer_session_bookable_internal(uuid, uuid, uuid, uuid, timestamptz) TO service_role;

CREATE OR REPLACE FUNCTION public.validate_peer_session_enrollment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  PERFORM public.assert_peer_session_bookable_internal(
    NEW.id, NEW.enrollment_id, NEW.peer_coach_id, NEW.peer_coachee_id, NEW.start_time);
  RETURN NEW;
END;
$$;

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
    -- The practice allowance of the month the session moves INTO.
    PERFORM public.assert_peer_session_bookable_internal(
      v_s.id, v_s.enrollment_id, v_s.peer_coach_id, v_s.peer_coachee_id, p_start);
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

-- What a page shows: this Vietnamese month's practice sessions against the
-- limit -- the same count the booking check makes.
CREATE OR REPLACE FUNCTION public.get_peer_session_usage(p_enrollment_id uuid)
 RETURNS TABLE(monthly_limit integer, used_count integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT public.programme_config_integer(pm.config, 'monthly_limit'),
         public.peer_practice_month_count_internal(e.id, now(), NULL)
  FROM public.programme_enrollments e
  JOIN public.programme_modules pm ON pm.programme_id = e.programme_id
    AND pm.module = 'peer_coaching'::public.programme_module_type AND pm.enabled
  WHERE e.id = p_enrollment_id AND e.user_id = auth.uid()
    AND e.status IN ('active'::public.enrollment_status, 'at_risk'::public.enrollment_status);
$function$;

-- ---------------------------------------------------------------------------
-- 4. Dyad eligibility: free requirement + partner + goal gate
-- ---------------------------------------------------------------------------
-- WHO and HOW MANY, for the caller's own enrollment. The insert backstop
-- (validate_coachee_peer_session_cap) checks exactly this; the goal gate has
-- its own insert backstop, enforce_booking_goal_gate, which owns its
-- exemptions (a row written already completed is history, not a booking).
CREATE OR REPLACE FUNCTION public.coachee_peer_booking_allowed_internal(p_provider_id uuid, p_enrollment_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE e public.programme_enrollments;
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
  -- HOW MANY: a Peer requirement of the cohort that no live or completed
  -- dyad session holds. No allowance enters it.
  RETURN EXISTS (SELECT 1 FROM public.next_peer_requirement(p_enrollment_id));
END
$function$;
REVOKE ALL ON FUNCTION public.coachee_peer_booking_allowed_internal(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.coachee_peer_booking_allowed_internal(uuid, uuid) TO service_role;

-- Eligibility as the booking page and book_coachee_peer_session ask it.
CREATE OR REPLACE FUNCTION public.can_book_coachee_peer_session(p_provider_id uuid, p_enrollment_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT public.coachee_peer_booking_allowed_internal(p_provider_id, p_enrollment_id)
     AND NOT public.enrollment_goal_gate_blocked(p_enrollment_id);
$function$;

CREATE OR REPLACE FUNCTION public.validate_coachee_peer_session_cap()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NEW.enrollment_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(NEW.enrollment_id::text, 0));
  END IF;
  IF NEW.enrollment_id IS NULL OR NOT public.coachee_peer_booking_allowed_internal(NEW.peer_provider_id, NEW.enrollment_id) THEN
    RAISE EXCEPTION 'Peer coaching entitlement has been exhausted or booking is not allowed' USING ERRCODE='42501';
  END IF;
  RETURN NEW;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 5. The Peer target is not capped by the practice limit
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.validate_programme_module_config()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  required_units integer;
  required_flag boolean;
  triad_limit integer;
BEGIN
  required_units := COALESCE(public.programme_config_integer(NEW.config, 'required_units'), 0);
  required_flag := COALESCE((NEW.config->>'required')::boolean, false);

  IF required_flag AND required_units = 0 THEN
    RAISE EXCEPTION 'Required modules must have at least one required unit' USING ERRCODE = '22023';
  END IF;

  -- required_units is the whole answer for Coaching, Mentoring and Peer;
  -- Peer's monthly_limit caps practice only.
  IF NEW.module = 'triads'::public.programme_module_type THEN
    triad_limit := public.programme_config_integer(NEW.config, 'max_triads');
    IF triad_limit IS NOT NULL AND required_units > triad_limit THEN
      RAISE EXCEPTION 'Required target cannot exceed the maximum triad sessions per participant' USING ERRCODE = '22023';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 6. Allowance readers nothing calls
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.get_coachee_peer_session_usage(uuid);
DROP FUNCTION IF EXISTS public.get_coach_peer_session_usage(uuid);
DROP FUNCTION IF EXISTS public.check_mentoring_session_usage(uuid);
DROP FUNCTION IF EXISTS public.get_mentoring_session_usage_for_enrollment(uuid);
DROP FUNCTION IF EXISTS public.get_mentoring_session_usage(uuid);

-- ---------------------------------------------------------------------------
-- Final-state guard
-- ---------------------------------------------------------------------------
DO $verify$
DECLARE bad text;
BEGIN
  SELECT string_agg(p.proname, ', ' ORDER BY p.proname) INTO bad
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.prosrc ~ '(receive_limit|give_limit|coachee_session_limit|mentoring_received_limit)';
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'Functions still read a retired limit: %', bad;
  END IF;
END
$verify$;
