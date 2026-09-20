-- book_coaching_session accepts a start time and duration inside the slot
-- (Coaching redesign, deployment 1).
--
-- The booking UI offers several start options within one availability slot
-- (src/pages/bookingSlots.ts computeStartOptions) and a duration choice, because
-- a published slot can be longer than a session. The first cut of
-- book_coaching_session derived both from the slot as a whole, which would have
-- silently discarded the learner's choice.
--
-- The values are accepted but never trusted: the requested window must fall
-- entirely inside the slot, so a caller cannot use them to book time the Coach
-- never published. Omitting them keeps the previous behaviour (the whole slot).

DROP FUNCTION IF EXISTS public.book_coaching_session(uuid, uuid, uuid, uuid, text);

CREATE OR REPLACE FUNCTION public.book_coaching_session(
  p_enrollment_id uuid,
  p_coach_id uuid,
  p_slot_id uuid,
  p_requirement_id uuid,
  p_topic text,
  p_start_time timestamptz DEFAULT NULL,
  p_duration_minutes integer DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_enr record;
  v_slot record;
  v_req record;
  v_slot_start timestamptz;
  v_slot_end timestamptz;
  v_start timestamptz;
  v_duration integer;
  v_session_id uuid;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
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
  IF v_enr.user_id IS DISTINCT FROM v_actor THEN
    RAISE EXCEPTION 'Enrollment does not belong to the authenticated user' USING ERRCODE = '42501';
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

  v_slot_start := (v_slot.slot_date + v_slot.start_time) AT TIME ZONE 'UTC';
  v_slot_end   := (v_slot.slot_date + v_slot.end_time) AT TIME ZONE 'UTC';

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
    p_enrollment_id, p_requirement_id, p_coach_id, v_actor,
    p_slot_id, p_topic, v_start, v_duration, 'pending_coach_approval'
  )
  RETURNING id INTO v_session_id;

  RETURN v_session_id;
END;
$$;

REVOKE ALL ON FUNCTION public.book_coaching_session(uuid, uuid, uuid, uuid, text, timestamptz, integer)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.book_coaching_session(uuid, uuid, uuid, uuid, text, timestamptz, integer)
  TO authenticated;

COMMENT ON FUNCTION public.book_coaching_session(uuid, uuid, uuid, uuid, text, timestamptz, integer) IS
  'Server-authoritative atomic Coaching booking. Locks the slot before '
  'validating, accepts an optional start/duration that must fall inside the '
  'published slot, and reserves the slot in the same transaction.';

-- reschedule_coaching_session calls the 5-argument form, which no longer
-- exists; repoint it at the new signature.
CREATE OR REPLACE FUNCTION public.reschedule_coaching_session(
  p_session_id uuid,
  p_new_slot_id uuid,
  p_reason text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_is_admin boolean;
  v_s record;
  v_new_session uuid;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  v_is_admin := public.has_role(v_actor, 'admin'::public.app_role);

  SELECT s.id, s.enrollment_id, s.cohort_requirement_id, s.coach_id, s.coachee_id,
         s.status, s.topic, s.slot_id, s.duration_minutes
    INTO v_s
  FROM public.sessions s WHERE s.id = p_session_id
  FOR UPDATE;

  IF v_s.id IS NULL THEN
    RAISE EXCEPTION 'Session % does not exist', p_session_id USING ERRCODE = '23503';
  END IF;
  IF NOT (v_is_admin OR v_actor = v_s.coach_id OR v_actor = v_s.coachee_id) THEN
    RAISE EXCEPTION 'Not authorised to reschedule this session' USING ERRCODE = '42501';
  END IF;
  IF v_s.status NOT IN ('pending_coach_approval', 'confirmed') THEN
    RAISE EXCEPTION 'Only a live session can be rescheduled (status=%)', v_s.status
      USING ERRCODE = '23514';
  END IF;

  PERFORM set_config('app.session_transition', 'on', true);

  UPDATE public.sessions
     SET status = 'rescheduled',
         cancelled_at = now(),
         cancelled_by = v_actor,
         cancel_reason = coalesce(p_reason, 'Rescheduled')
   WHERE id = p_session_id;

  v_new_session := public.book_coaching_session(
    v_s.enrollment_id, v_s.coach_id, p_new_slot_id, v_s.cohort_requirement_id,
    v_s.topic, NULL, v_s.duration_minutes);

  RETURN v_new_session;
END;
$$;

REVOKE ALL ON FUNCTION public.reschedule_coaching_session(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reschedule_coaching_session(uuid, uuid, text) TO authenticated;
