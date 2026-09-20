-- Validate WHO before WHICH in Mentoring booking (found by real pgTAP execution).
--
-- book_mentoring_session_internal() resolved the requirement before checking
-- the cohort mentor pool. A learner whose requirements are all taken, booking
-- an ineligible mentor, was told "no unfulfilled Mentoring requirement
-- remains" (23505) rather than "that mentor is not assigned to your cohort"
-- (42501) -- the less actionable of the two, and the wrong one: mentor
-- eligibility does not depend on how many requirements are left.
--
-- Eligibility is a property of the relationship; availability is a property of
-- the schedule. The relationship is checked first.

CREATE OR REPLACE FUNCTION public.book_mentoring_session_internal(
  p_enrollment_id uuid,
  p_mentor_id uuid,
  p_slot_id uuid,
  p_topic text,
  p_requirement_id uuid DEFAULT NULL,
  p_start_time timestamptz DEFAULT NULL,
  p_duration_minutes integer DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
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
    SELECT d.id, d.cohort_id, d.programme_id, d.module INTO v_req
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

  v_slot_start := (v_slot.slot_date + v_slot.start_time) AT TIME ZONE 'UTC';
  v_slot_end   := (v_slot.slot_date + v_slot.end_time) AT TIME ZONE 'UTC';
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
$$;

REVOKE ALL ON FUNCTION public.book_mentoring_session_internal(uuid, uuid, uuid, text, uuid, timestamptz, integer)
  FROM PUBLIC, anon, authenticated;
