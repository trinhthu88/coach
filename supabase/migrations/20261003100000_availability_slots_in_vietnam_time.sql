-- A coach's availability slot is a wall-clock time in Vietnam (ICT, UTC+7).
--
-- coach_availability stores slot_date + start_time/end_time as plain
-- `date`/`time`, exactly as the coach types them on the availability page
-- ("09:00".."10:00"). The booking page showed them as those times, but
-- book_coaching_session_internal / book_mentoring_session_internal read them
-- as UTC: from a browser in Vietnam, 09:00 was sent as 02:00 UTC and refused
-- as "outside the availability slot" -- every Coaching and Mentoring booking
-- failed. A reschedule (no start sent) booked the slot's time read as UTC,
-- seven hours late.
--
-- Slot times are now read in public.availability_slot_time_zone(), and the
-- booking pages build a slot's start in the same zone (src/lib/slotTime.ts),
-- whatever the browser's own time zone. Coaches carry no time zone of their
-- own yet; the function takes the coach so one can be added in one place.
-- Only these two slot conversions change; the rest of each function is its
-- previous definition (20261001110000_p1_source_of_truth.sql), unchanged.

CREATE OR REPLACE FUNCTION public.availability_slot_time_zone(p_coach_id uuid)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT 'Asia/Ho_Chi_Minh'::text;
$function$;

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
$function$

;

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
$function$

;

