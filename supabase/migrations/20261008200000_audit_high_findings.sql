-- ===========================================================================
-- Audit 8 Oct, Part A: High findings and the booking window (Prompt 16 Part A)
--
--   H3. The Coach directory shows each Coach's held Coaching from the reported
--       population (coach_public_delivered_sessions, on
--       reported_held_sessions_internal: demo organisations excluded) -- the
--       same number as Admin -> Registrations. coach_profiles.sessions_completed
--       was never maintained ("0 sessions" for every Coach) and is dropped.
--   H4. One current-enrollment rule for every role: the user's enrollment for
--       which enrollment_is_ongoing() holds (active AND inside its dates, else
--       its cohort's). learner_current_enrollment() for the learner,
--       admin_current_enrollments() for Admin, both on
--       current_enrollment_internal(). A paused or past-end enrollment is not
--       current. resolve_current_enrollment (status only) is retired.
--   M1. Booking refuses a slot whose Vietnamese date is after
--       coalesce(enrollment.end_date, cohort.end_date):
--       assert_session_within_enrollment_internal, called by
--       book_coaching_session_internal, book_mentoring_session_internal,
--       book_peer_session and book_coachee_peer_session (each otherwise
--       unchanged).
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- H3. Held Coaching per Coach, for the directory
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.coach_public_delivered_sessions()
 RETURNS TABLE(coach_id uuid, delivered_sessions integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  -- The count admin_coach_delivery_summary reports; no learner detail.
  RETURN QUERY
  SELECT h.provider_id, count(*)::integer
  FROM public.reported_held_sessions_internal() h
  WHERE h.kind = 'coaching'
  GROUP BY h.provider_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.coach_public_delivered_sessions() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.coach_public_delivered_sessions() TO authenticated, service_role;

-- The guard no longer names the dropped column.
CREATE OR REPLACE FUNCTION public.guard_coach_profile_protected_fields()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF current_user NOT IN ('anon', 'authenticated') THEN RETURN NEW; END IF;
  IF public.has_role(auth.uid(), 'admin'::public.app_role) THEN RETURN NEW; END IF;
  -- A new profile starts from the column defaults: pending approval, no
  -- invite limit, the default rating, not featured, never approved.
  IF TG_OP = 'INSERT' THEN
    IF NEW.max_coachee_invites IS NOT NULL
       OR NEW.approval_status IS DISTINCT FROM 'pending_approval'::public.user_status
       OR NEW.rating_avg IS DISTINCT FROM 5.0
       OR NEW.is_featured IS DISTINCT FROM false
       OR NEW.last_approved_at IS NOT NULL THEN
      RAISE EXCEPTION 'Only an administrator can set a Coach''s approval, invite limit, rating or featured status'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.max_coachee_invites IS DISTINCT FROM OLD.max_coachee_invites
     OR NEW.approval_status IS DISTINCT FROM OLD.approval_status
     OR NEW.rating_avg IS DISTINCT FROM OLD.rating_avg
     OR NEW.is_featured IS DISTINCT FROM OLD.is_featured
     OR NEW.last_approved_at IS DISTINCT FROM OLD.last_approved_at THEN
    RAISE EXCEPTION 'Only an administrator can change a Coach''s approval, invite limit, rating or featured status'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$function$;

ALTER TABLE public.coach_profiles DROP COLUMN sessions_completed;

-- ---------------------------------------------------------------------------
-- H4. The current enrollment
-- ---------------------------------------------------------------------------
-- At most one enrollment per user is active/at_risk/paused
-- (ux_programme_enrollments_one_ongoing), so at most one is ongoing.
CREATE OR REPLACE FUNCTION public.current_enrollment_internal(p_user_id uuid, p_as_of date DEFAULT NULL)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT e.id
  FROM public.programme_enrollments e
  WHERE e.user_id = p_user_id
    AND public.enrollment_is_ongoing(e.id, coalesce(p_as_of, public.programme_today()))
  ORDER BY e.id
  LIMIT 1;
$function$;
REVOKE ALL ON FUNCTION public.current_enrollment_internal(uuid, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.current_enrollment_internal(uuid, date) TO service_role;

-- The signed-in learner's current enrollment: one row, or none.
CREATE OR REPLACE FUNCTION public.learner_current_enrollment()
 RETURNS TABLE(enrollment_id uuid)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  v_id := public.current_enrollment_internal(auth.uid());
  IF v_id IS NOT NULL THEN
    RETURN QUERY SELECT v_id;
  END IF;
END;
$function$;
REVOKE ALL ON FUNCTION public.learner_current_enrollment() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.learner_current_enrollment() TO authenticated, service_role;

-- Admin: per user with any enrollment, the current one (the learner's answer,
-- NULL when none is ongoing) and the latest record, which Admin lists still
-- show -- with its own status -- so a paused learner can be found and resumed.
CREATE OR REPLACE FUNCTION public.admin_current_enrollments()
 RETURNS TABLE(user_id uuid, enrollment_id uuid, latest_enrollment_id uuid)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Only an Admin may read every current enrollment' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT u.user_id,
         public.current_enrollment_internal(u.user_id),
         (SELECT e.id FROM public.programme_enrollments e
           WHERE e.user_id = u.user_id
           ORDER BY e.start_date DESC NULLS LAST, e.created_at DESC, e.id
           LIMIT 1)
  FROM (SELECT DISTINCT e.user_id FROM public.programme_enrollments e) u;
END;
$function$;
REVOKE ALL ON FUNCTION public.admin_current_enrollments() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_current_enrollments() TO authenticated, service_role;

DROP FUNCTION public.resolve_current_enrollment(uuid);

-- ---------------------------------------------------------------------------
-- M1. No session after the enrollment ends
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.assert_session_within_enrollment_internal(p_enrollment_id uuid, p_start timestamptz)
 RETURNS void
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_end date;
  v_day date := (p_start AT TIME ZONE public.programme_time_zone())::date;
BEGIN
  SELECT coalesce(e.end_date, c.end_date) INTO v_end
  FROM public.programme_enrollments e
  LEFT JOIN public.cohorts c ON c.id = e.cohort_id
  WHERE e.id = p_enrollment_id;
  IF v_end IS NOT NULL AND v_day > v_end THEN
    RAISE EXCEPTION 'The session is on %, after the enrollment ends on %', v_day, v_end
      USING ERRCODE = '23514';
  END IF;
END;
$function$;
REVOKE ALL ON FUNCTION public.assert_session_within_enrollment_internal(uuid, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assert_session_within_enrollment_internal(uuid, timestamptz) TO service_role;

-- The four booking functions as they stood (20261003100000, 20260925400000,
-- 20261007001000), each with the guard just before its INSERT.

CREATE OR REPLACE FUNCTION public.book_coaching_session_internal(p_enrollment_id uuid, p_coach_id uuid, p_slot_id uuid, p_requirement_id uuid, p_topic text, p_start_time timestamp with time zone DEFAULT NULL::timestamp with time zone, p_duration_minutes integer DEFAULT NULL::integer)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_enr record;
  v_slot record;
  v_req record;
  v_slot_start timestamptz;
  v_slot_end timestamptz;
  v_start timestamptz;
  v_duration integer;
  v_session_id uuid;
BEGIN
  -- Booking goal gate: a NEW booking needs an active goal after the grace
  -- period. A reschedule (same requirement released in this transaction) is
  -- not a new booking.
  IF NOT public.coaching_reschedule_in_progress(p_enrollment_id, p_requirement_id) THEN
    PERFORM public.assert_enrollment_goal_gate(p_enrollment_id);
  END IF;

  -- Lock the race-sensitive resource FIRST, before any validation, so two
  -- concurrent bookings for one slot cannot both pass their checks.
  SELECT ca.id, ca.coach_id, ca.slot_date, ca.start_time, ca.end_time,
         ca.is_booked, ca.slot_type
    INTO v_slot
  FROM public.coach_availability ca
  WHERE ca.id = p_slot_id
  FOR UPDATE;

  IF v_slot.id IS NULL THEN
    RAISE EXCEPTION 'Availability slot % does not exist', p_slot_id USING ERRCODE = '23503';
  END IF;

  SELECT e.id, e.user_id, e.cohort_id, e.programme_id, e.status
    INTO v_enr
  FROM public.programme_enrollments e
  WHERE e.id = p_enrollment_id;

  IF v_enr.id IS NULL THEN
    RAISE EXCEPTION 'Enrollment % does not exist', p_enrollment_id USING ERRCODE = '23503';
  END IF;
  IF v_enr.status <> 'active'::public.enrollment_status THEN
    RAISE EXCEPTION 'Enrollment is not active (status=%)', v_enr.status USING ERRCODE = '42501';
  END IF;
  IF v_enr.cohort_id IS NULL THEN
    RAISE EXCEPTION 'Enrollment has no cohort; Coaching cannot be booked' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.programme_modules m
    WHERE m.programme_id = v_enr.programme_id
      AND m.module = 'coaching'::public.programme_module_type
      AND m.enabled
  ) THEN
    RAISE EXCEPTION 'Coaching is not enabled for this programme' USING ERRCODE = '42501';
  END IF;

  SELECT d.id, d.cohort_id, d.module, d.due_on, d.ordinal
    INTO v_req
  FROM public.cohort_requirement_dates d
  WHERE d.id = p_requirement_id;

  IF v_req.id IS NULL THEN
    RAISE EXCEPTION 'Coaching requirement % does not exist', p_requirement_id USING ERRCODE = '23503';
  END IF;
  IF v_req.module <> 'coaching'::public.programme_module_type THEN
    RAISE EXCEPTION 'Requirement % is not a Coaching requirement', p_requirement_id USING ERRCODE = '23514';
  END IF;
  IF v_req.cohort_id IS DISTINCT FROM v_enr.cohort_id THEN
    RAISE EXCEPTION 'Requirement belongs to a different cohort' USING ERRCODE = '42501';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.sessions s
    WHERE s.cohort_requirement_id = p_requirement_id
      AND s.enrollment_id = p_enrollment_id
      AND s.status IN ('pending_coach_approval', 'confirmed', 'completed')
      -- A session completed before the requirement's window never counts,
      -- so it does not keep the requirement either (20261001110000).
      AND public.session_occupies_requirement(s.status, s.start_time, v_req.due_on)
  ) THEN
    RAISE EXCEPTION 'Coaching requirement % already has a live or completed session', p_requirement_id
      USING ERRCODE = '23505';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.cohort_coaching_coach_pool(v_enr.cohort_id) p
    WHERE p.coach_id = p_coach_id
  ) THEN
    RAISE EXCEPTION 'Coach % is not assigned to cohort %', p_coach_id, v_enr.cohort_id
      USING ERRCODE = '42501';
  END IF;

  IF v_slot.coach_id IS DISTINCT FROM p_coach_id THEN
    RAISE EXCEPTION 'Availability slot belongs to a different Coach' USING ERRCODE = '42501';
  END IF;
  IF v_slot.slot_type <> 'coaching'::public.availability_slot_type THEN
    RAISE EXCEPTION 'Availability slot is not a Coaching slot (type=%)', v_slot.slot_type
      USING ERRCODE = '23514';
  END IF;
  IF v_slot.is_booked THEN
    RAISE EXCEPTION 'Availability slot is no longer available' USING ERRCODE = '23505';
  END IF;

  v_slot_start := (v_slot.slot_date + v_slot.start_time) AT TIME ZONE public.availability_slot_time_zone(v_slot.coach_id);
  v_slot_end   := (v_slot.slot_date + v_slot.end_time) AT TIME ZONE public.availability_slot_time_zone(v_slot.coach_id);

  v_start := COALESCE(p_start_time, v_slot_start);
  v_duration := COALESCE(
    p_duration_minutes,
    GREATEST(EXTRACT(EPOCH FROM (v_slot_end - v_slot_start))::integer / 60, 1));

  IF v_duration <= 0 THEN
    RAISE EXCEPTION 'Duration must be positive' USING ERRCODE = '23514';
  END IF;

  -- The requested window must lie inside the published slot. This is what makes
  -- the caller-supplied values safe to accept.
  IF v_start < v_slot_start OR (v_start + make_interval(mins => v_duration)) > v_slot_end THEN
    RAISE EXCEPTION 'Requested time % for % minutes falls outside the availability slot (% to %)',
      v_start, v_duration, v_slot_start, v_slot_end USING ERRCODE = '23514';
  END IF;

  IF v_start < now() THEN
    RAISE EXCEPTION 'Availability slot is in the past' USING ERRCODE = '23514';
  END IF;

  -- M1: no slot after the enrollment ends (its own end date, else its cohort's).
  PERFORM public.assert_session_within_enrollment_internal(p_enrollment_id, v_start);

  PERFORM set_config('app.session_transition', 'on', true);

  INSERT INTO public.sessions (
    enrollment_id, cohort_requirement_id, coach_id, coachee_id,
    slot_id, topic, start_time, duration_minutes, status
  ) VALUES (
    p_enrollment_id, p_requirement_id, p_coach_id, v_enr.user_id,
    p_slot_id, p_topic, v_start, v_duration, 'pending_coach_approval'
  )
  RETURNING id INTO v_session_id;

  RETURN v_session_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.book_mentoring_session_internal(p_enrollment_id uuid, p_mentor_id uuid, p_slot_id uuid, p_topic text, p_requirement_id uuid DEFAULT NULL::uuid, p_start_time timestamp with time zone DEFAULT NULL::timestamp with time zone, p_duration_minutes integer DEFAULT NULL::integer)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_enr record;
  v_slot record;
  v_req record;
  v_requirement uuid;
  v_slot_start timestamptz;
  v_slot_end timestamptz;
  v_start timestamptz;
  v_duration integer;
  v_session_id uuid;
BEGIN
  -- Booking goal gate (Mentoring has no reschedule path through here).
  PERFORM public.assert_enrollment_goal_gate(p_enrollment_id);

  SELECT ca.id, ca.coach_id, ca.slot_date, ca.start_time, ca.end_time,
         ca.is_booked, ca.slot_type
    INTO v_slot
  FROM public.coach_availability ca WHERE ca.id = p_slot_id FOR UPDATE;

  IF v_slot.id IS NULL THEN
    RAISE EXCEPTION 'Availability slot % does not exist', p_slot_id USING ERRCODE = '23503';
  END IF;

  SELECT e.id, e.user_id, e.cohort_id, e.programme_id, e.status
    INTO v_enr
  FROM public.programme_enrollments e WHERE e.id = p_enrollment_id;

  IF v_enr.id IS NULL THEN
    RAISE EXCEPTION 'Enrollment % does not exist', p_enrollment_id USING ERRCODE = '23503';
  END IF;
  IF v_enr.status NOT IN ('active'::public.enrollment_status, 'at_risk'::public.enrollment_status) THEN
    RAISE EXCEPTION 'Enrollment is not active (status=%)', v_enr.status USING ERRCODE = '42501';
  END IF;
  IF v_enr.cohort_id IS NULL THEN
    RAISE EXCEPTION 'Enrollment has no cohort; Mentoring cannot be booked' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.programme_modules m
    WHERE m.programme_id = v_enr.programme_id
      AND m.module = 'mentoring'::public.programme_module_type AND m.enabled
  ) THEN
    RAISE EXCEPTION 'Mentoring is not enabled for this programme' USING ERRCODE = '42501';
  END IF;

  -- WHO first: eligibility does not depend on the schedule.
  IF NOT EXISTS (
    SELECT 1 FROM public.cohort_mentoring_mentor_pool(v_enr.cohort_id) p
    WHERE p.mentor_user_id = p_mentor_id
  ) THEN
    RAISE EXCEPTION 'Mentor % is not assigned to cohort %', p_mentor_id, v_enr.cohort_id
      USING ERRCODE = '42501';
  END IF;

  IF v_slot.coach_id IS DISTINCT FROM p_mentor_id THEN
    RAISE EXCEPTION 'Availability slot belongs to a different mentor' USING ERRCODE = '42501';
  END IF;
  IF v_slot.slot_type <> 'mentoring'::public.availability_slot_type THEN
    RAISE EXCEPTION 'Availability slot is not a Mentoring slot (type=%)', v_slot.slot_type
      USING ERRCODE = '23514';
  END IF;
  IF v_slot.is_booked THEN
    RAISE EXCEPTION 'Availability slot is no longer available' USING ERRCODE = '23505';
  END IF;

  -- WHICH requirement. Explicit always wins and is fully validated.
  IF p_requirement_id IS NOT NULL THEN
    SELECT d.id, d.cohort_id, d.programme_id, d.module, d.due_on INTO v_req
    FROM public.cohort_requirement_dates d WHERE d.id = p_requirement_id;

    IF v_req.id IS NULL THEN
      RAISE EXCEPTION 'Mentoring requirement % does not exist', p_requirement_id USING ERRCODE = '23503';
    END IF;
    IF v_req.module <> 'mentoring'::public.programme_module_type THEN
      RAISE EXCEPTION 'Requirement % is not a Mentoring requirement', p_requirement_id USING ERRCODE = '23514';
    END IF;
    IF v_req.cohort_id IS DISTINCT FROM v_enr.cohort_id
       OR v_req.programme_id IS DISTINCT FROM v_enr.programme_id THEN
      RAISE EXCEPTION 'Requirement belongs to a different cohort or programme' USING ERRCODE = '42501';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.mentoring_sessions s
      WHERE s.cohort_requirement_id = p_requirement_id
        AND s.enrollment_id = p_enrollment_id
        AND s.status IN ('pending_coach_approval', 'confirmed', 'completed')
        -- A session completed before the window does not keep the requirement.
        AND public.session_occupies_requirement(s.status, s.start_time, v_req.due_on)
    ) THEN
      RAISE EXCEPTION 'Mentoring requirement % already has a live or completed session', p_requirement_id
        USING ERRCODE = '23505';
    END IF;
    v_requirement := p_requirement_id;
  ELSE
    SELECT f.requirement_id INTO v_requirement
    FROM public.next_mentoring_requirement(p_enrollment_id) f;
    IF v_requirement IS NULL THEN
      RAISE EXCEPTION 'No unfulfilled Mentoring requirement remains for this enrollment'
        USING ERRCODE = '23505';
    END IF;
  END IF;

  v_slot_start := (v_slot.slot_date + v_slot.start_time) AT TIME ZONE public.availability_slot_time_zone(v_slot.coach_id);
  v_slot_end   := (v_slot.slot_date + v_slot.end_time) AT TIME ZONE public.availability_slot_time_zone(v_slot.coach_id);
  v_start := COALESCE(p_start_time, v_slot_start);
  v_duration := COALESCE(p_duration_minutes,
    GREATEST(EXTRACT(EPOCH FROM (v_slot_end - v_slot_start))::integer / 60, 1));

  IF v_duration <= 0 THEN
    RAISE EXCEPTION 'Duration must be positive' USING ERRCODE = '23514';
  END IF;
  IF v_start < v_slot_start OR (v_start + make_interval(mins => v_duration)) > v_slot_end THEN
    RAISE EXCEPTION 'Requested time % for % minutes falls outside the availability slot (% to %)',
      v_start, v_duration, v_slot_start, v_slot_end USING ERRCODE = '23514';
  END IF;
  IF v_start < now() THEN
    RAISE EXCEPTION 'Availability slot is in the past' USING ERRCODE = '23514';
  END IF;

  -- M1: no slot after the enrollment ends (its own end date, else its cohort's).
  PERFORM public.assert_session_within_enrollment_internal(p_enrollment_id, v_start);

  PERFORM set_config('app.session_transition', 'on', true);

  INSERT INTO public.mentoring_sessions (
    enrollment_id, cohort_requirement_id, mentor_id, mentee_id,
    slot_id, topic, start_time, duration_minutes, status
  ) VALUES (
    p_enrollment_id, v_requirement, p_mentor_id, v_enr.user_id,
    p_slot_id, p_topic, v_start, v_duration, 'pending_coach_approval'
  )
  RETURNING id INTO v_session_id;

  RETURN v_session_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.book_peer_session(p_peer_coach_id uuid, p_enrollment_id uuid, p_topic text, p_start_time timestamp with time zone, p_duration_minutes integer, p_slot_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  booked_id uuid;
  v_slot public.coach_availability;
  v_slot_start timestamptz;
  v_slot_end timestamptz;
BEGIN
  IF auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.programme_enrollments e
    WHERE e.id = p_enrollment_id AND e.user_id = auth.uid()
  ) THEN
    PERFORM public.assert_enrollment_goal_gate(p_enrollment_id);
  END IF;
  IF p_start_time IS NULL OR p_start_time < now() THEN
    RAISE EXCEPTION 'A session cannot be booked in the past' USING ERRCODE='22023';
  END IF;
  IF NOT public.can_book_peer_session(p_peer_coach_id,p_enrollment_id) THEN
    RAISE EXCEPTION 'Peer booking is not allowed for this enrollment' USING ERRCODE='42501';
  END IF;
  -- After the eligibility checks, so a refusal for the enrollment keeps its own
  -- error; then the slot, which coach-pool practice always has.
  IF p_slot_id IS NULL THEN
    RAISE EXCEPTION 'Choose one of the Coach''s Peer slots' USING ERRCODE = '22023';
  END IF;
  IF p_slot_id IS NOT NULL THEN
    SELECT * INTO v_slot FROM public.coach_availability WHERE id = p_slot_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Availability slot % does not exist', p_slot_id USING ERRCODE = '23503';
    END IF;
    IF v_slot.coach_id IS DISTINCT FROM p_peer_coach_id THEN
      RAISE EXCEPTION 'Availability slot belongs to a different Coach' USING ERRCODE = '42501';
    END IF;
    IF v_slot.slot_type <> 'peer'::public.availability_slot_type THEN
      RAISE EXCEPTION 'Availability slot is not a Peer slot (type=%)', v_slot.slot_type USING ERRCODE = '23514';
    END IF;
    IF v_slot.is_booked THEN
      RAISE EXCEPTION 'Availability slot is no longer available' USING ERRCODE = '23505';
    END IF;
    v_slot_start := (v_slot.slot_date + v_slot.start_time) AT TIME ZONE public.availability_slot_time_zone(v_slot.coach_id);
    v_slot_end   := (v_slot.slot_date + v_slot.end_time) AT TIME ZONE public.availability_slot_time_zone(v_slot.coach_id);
    IF p_duration_minutes IS NULL OR p_duration_minutes <= 0
       OR p_start_time < v_slot_start OR p_start_time + make_interval(mins => p_duration_minutes) > v_slot_end THEN
      RAISE EXCEPTION 'Requested time % for % minutes falls outside the availability slot (% to %)',
        p_start_time, p_duration_minutes, v_slot_start, v_slot_end USING ERRCODE = '23514';
    END IF;
  END IF;
  -- M1: no slot after the enrollment ends (its own end date, else its cohort's).
  PERFORM public.assert_session_within_enrollment_internal(p_enrollment_id, p_start_time);

  INSERT INTO public.peer_sessions
    (peer_coach_id,peer_coachee_id,enrollment_id,topic,start_time,duration_minutes,status,slot_id)
  VALUES
    (p_peer_coach_id,auth.uid(),p_enrollment_id,p_topic,p_start_time,
     p_duration_minutes,'pending_coach_approval'::public.session_status,p_slot_id)
  RETURNING id INTO booked_id;
  RETURN booked_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.book_coachee_peer_session(p_provider_id uuid, p_enrollment_id uuid, p_topic text, p_start_time timestamp with time zone, p_duration_minutes integer, p_slot_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE booked_id uuid;
BEGIN
  -- Booking goal gate first, for the learner's own enrollment, so a closed
  -- gate is reported as itself rather than as a generic "not allowed".
  IF auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.programme_enrollments e
    WHERE e.id = p_enrollment_id AND e.user_id = auth.uid()
  ) THEN
    PERFORM public.assert_enrollment_goal_gate(p_enrollment_id);
  END IF;
  IF p_start_time IS NULL OR p_start_time < now() THEN
    RAISE EXCEPTION 'A session cannot be booked in the past' USING ERRCODE='22023';
  END IF;
  IF NOT public.can_book_coachee_peer_session(p_provider_id,p_enrollment_id) THEN
    RAISE EXCEPTION 'Peer coaching entitlement has been exhausted or booking is not allowed' USING ERRCODE='42501';
  END IF;
  -- M1: no slot after the enrollment ends (its own end date, else its cohort's).
  PERFORM public.assert_session_within_enrollment_internal(p_enrollment_id, p_start_time);

  INSERT INTO public.coachee_peer_sessions
    (peer_provider_id,peer_receiver_id,enrollment_id,topic,start_time,duration_minutes,status,slot_id)
  VALUES (p_provider_id,auth.uid(),p_enrollment_id,p_topic,p_start_time,p_duration_minutes,
          'pending_coach_approval'::public.session_status,p_slot_id)
  RETURNING id INTO booked_id;
  RETURN booked_id;
END;
$function$;
