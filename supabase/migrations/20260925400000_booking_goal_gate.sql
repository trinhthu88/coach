-- Booking goal gate (spec Part 7): a learner needs at least one active
-- programme goal before booking, once the enrollment's grace period is over.
--
-- ONE rule, evaluated in ONE place (enrollment_goal_gate_state), and called by
-- every server booking path. The UI reads the same rule through
-- enrollment_goal_gate(); it never recomputes it.
--
-- ---------------------------------------------------------------------------
-- Definition of "day N"
-- ---------------------------------------------------------------------------
--
--   gate start  = cohorts.start_date of the enrollment's cohort, or
--                 programme_enrollments.start_date when the enrollment has no
--                 cohort or the cohort has no start_date.
--   day 1       = the gate start date itself.
--   day N       = gate start + (N - 1) days, measured on current_date (the
--                 database's date, UTC on Supabase).
--   grace       = days 1..7, i.e. current_date <= gate start + 6. Booking is
--                 open regardless of goals. A date before day 1 (a cohort that
--                 has not started yet) is also open.
--   blocked     = current_date >= gate start + 7 (day 8 onward) AND the
--                 enrollment has no goal with status 'active'.
--
-- ---------------------------------------------------------------------------
-- Where it is enforced
-- ---------------------------------------------------------------------------
--
--   book_coaching_session_internal   Coaching (learner book_coaching_session).
--                                    A reschedule is EXEMPT: it moves an
--                                    existing booking, it does not create a
--                                    new one (see the exemption below).
--   book_mentoring_session_internal  Mentoring, including an Admin booking on
--                                    the learner's behalf: the rule is about
--                                    the ENROLLMENT, not about who clicks.
--   book_coachee_peer_session        Peer (learner-to-learner). The gate
--                                    applies to the RECEIVER, the learner who
--                                    creates the booking with their enrollment.
--                                    The provider's goals are not checked.
--   book_peer_session                Coach-to-coach Peer for a coach who is a
--                                    learner (has an enrollment).
--   learner_triad_schedule_session   Triads: the proposing learner's
--   learner_triad_propose_alternative  enrollment. Accepting/declining an
--                                    existing proposal is not a booking and is
--                                    not gated. Admin group creation (which
--                                    may propose a first time) is not gated.
--
-- Plus a row-level backstop on INSERT into sessions, mentoring_sessions,
-- coachee_peer_sessions and peer_sessions: a learner who writes their OWN live
-- booking row directly (the INSERT RLS policies still admit that) hits the same
-- assertion (RPC inserts by the learner re-assert harmlessly). Service-role/
-- system writes (auth.uid() IS NULL) and rows written by someone other than the
-- enrollment's learner (an Admin, a Coach) are left to the RPC that wrote them;
-- the Coaching reschedule replacement is exempt here as in the RPC.
--
-- Error contract: RAISE ... 'goal_required_before_booking' USING ERRCODE
-- 'P0001', DETAIL = JSON {code, enrollment_id, gate_starts_on, grace_ends_on,
-- blocked_from}. The client maps the message to one translated sentence.
--
-- ---------------------------------------------------------------------------
-- Min / max goals
-- ---------------------------------------------------------------------------
--
-- Max 3 active goals per enrollment stays in validate_enrollment_goal().
-- Min 1: once the grace period is over, the learner cannot archive, delete,
-- complete or move away their LAST active goal of an ongoing enrollment
-- ('last_active_goal_required', P0001). Admin and system writes are exempt, so
-- data repair and cascaded deletes keep working.

-- ---------------------------------------------------------------------------
-- 1. The rule
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.enrollment_has_active_goal(p_enrollment_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.coachee_goals g
    WHERE g.enrollment_id = p_enrollment_id
      AND g.status = 'active'
  );
$$;

REVOKE ALL ON FUNCTION public.enrollment_has_active_goal(uuid) FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.enrollment_has_active_goal(uuid) IS
  'True when the enrollment has at least one goal with status active. INTERNAL: '
  'clients read enrollment_goal_gate(), which authorises the caller.';

CREATE OR REPLACE FUNCTION public.enrollment_goal_gate_start_date(p_enrollment_id uuid)
RETURNS date
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT COALESCE(c.start_date, e.start_date)
  FROM public.programme_enrollments e
  LEFT JOIN public.cohorts c ON c.id = e.cohort_id
  WHERE e.id = p_enrollment_id;
$$;

REVOKE ALL ON FUNCTION public.enrollment_goal_gate_start_date(uuid) FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.enrollment_goal_gate_start_date(uuid) IS
  'Day 1 of the booking goal gate: the cohort start_date, or the enrollment '
  'start_date when there is no cohort or the cohort has no start_date.';

-- THE single evaluation of the gate. Everything else reads this.
CREATE OR REPLACE FUNCTION public.enrollment_goal_gate_state(p_enrollment_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_start date;
  v_active integer;
  v_in_grace boolean;
  v_blocked boolean;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.programme_enrollments e WHERE e.id = p_enrollment_id) THEN
    RETURN NULL;
  END IF;

  v_start := public.enrollment_goal_gate_start_date(p_enrollment_id);

  SELECT count(*)::integer INTO v_active
  FROM public.coachee_goals g
  WHERE g.enrollment_id = p_enrollment_id AND g.status = 'active';

  -- Day 1..7 (and any date before day 1) is the grace period.
  v_in_grace := v_start IS NULL OR current_date < v_start + 7;
  v_blocked := NOT v_in_grace AND v_active = 0;

  RETURN jsonb_build_object(
    'enrollment_id', p_enrollment_id,
    'blocked', v_blocked,
    'reason', CASE WHEN v_blocked THEN 'goal_required_before_booking' END,
    'has_active_goal', v_active > 0,
    'active_goal_count', v_active,
    'max_active_goals', 3,
    'in_grace_period', v_in_grace,
    'gate_starts_on', v_start,
    'grace_ends_on', v_start + 6,
    'blocked_from', v_start + 7
  );
END;
$$;

REVOKE ALL ON FUNCTION public.enrollment_goal_gate_state(uuid) FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.enrollment_goal_gate_state(uuid) IS
  'THE booking goal gate: {blocked, reason, has_active_goal, active_goal_count, '
  'max_active_goals, in_grace_period, gate_starts_on, grace_ends_on, '
  'blocked_from}. Day 1 = gate start; days 1-7 are grace; blocked from day 8 '
  '(current_date >= start + 7) while no goal is active. INTERNAL.';

CREATE OR REPLACE FUNCTION public.enrollment_goal_gate_blocked(p_enrollment_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT COALESCE((public.enrollment_goal_gate_state(p_enrollment_id)->>'blocked')::boolean, false);
$$;

REVOKE ALL ON FUNCTION public.enrollment_goal_gate_blocked(uuid) FROM PUBLIC, anon, authenticated;

-- Client-readable: the learner for their own enrollment, or an Admin.
CREATE OR REPLACE FUNCTION public.enrollment_goal_gate(p_enrollment_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_owner uuid;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  SELECT e.user_id INTO v_owner FROM public.programme_enrollments e WHERE e.id = p_enrollment_id;
  IF v_owner IS NULL THEN
    RETURN NULL;
  END IF;
  IF v_owner IS DISTINCT FROM v_actor
     AND NOT public.has_role(v_actor, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Not authorised to read this enrollment' USING ERRCODE = '42501';
  END IF;
  RETURN public.enrollment_goal_gate_state(p_enrollment_id);
END;
$$;

REVOKE ALL ON FUNCTION public.enrollment_goal_gate(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.enrollment_goal_gate(uuid) TO authenticated;

COMMENT ON FUNCTION public.enrollment_goal_gate(uuid) IS
  'Booking goal gate for the caller''s own enrollment (or any, for an Admin). '
  'Same answer every booking RPC enforces through assert_enrollment_goal_gate().';

CREATE OR REPLACE FUNCTION public.assert_enrollment_goal_gate(p_enrollment_id uuid)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_state jsonb := public.enrollment_goal_gate_state(p_enrollment_id);
BEGIN
  IF v_state IS NOT NULL AND (v_state->>'blocked')::boolean THEN
    RAISE EXCEPTION 'goal_required_before_booking'
      USING ERRCODE = 'P0001',
        DETAIL = jsonb_build_object(
          'code', 'goal_required_before_booking',
          'enrollment_id', p_enrollment_id,
          'gate_starts_on', v_state->'gate_starts_on',
          'grace_ends_on', v_state->'grace_ends_on',
          'blocked_from', v_state->'blocked_from')::text,
        HINT = 'Create at least one programme goal before booking your next session.';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.assert_enrollment_goal_gate(uuid) FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.assert_enrollment_goal_gate(uuid) IS
  'Raises goal_required_before_booking (P0001) when enrollment_goal_gate_state '
  'says blocked. Called by every server booking path. INTERNAL.';

-- ---------------------------------------------------------------------------
-- 2. Coaching (base: 20260921100000)
-- ---------------------------------------------------------------------------
--
-- Reschedule exemption. reschedule_coaching_session() marks the old session
-- 'rescheduled' with cancelled_at = now() and then calls this function for the
-- SAME enrollment and requirement, in the same transaction. now() is the
-- transaction timestamp, so that row exists only inside a reschedule: a
-- learner cannot manufacture it for a fresh booking.

CREATE OR REPLACE FUNCTION public.coaching_reschedule_in_progress(
  p_enrollment_id uuid,
  p_requirement_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.sessions s
    WHERE s.enrollment_id = p_enrollment_id
      AND s.cohort_requirement_id IS NOT DISTINCT FROM p_requirement_id
      AND s.status = 'rescheduled'
      AND s.cancelled_at = now()
  );
$$;

REVOKE ALL ON FUNCTION public.coaching_reschedule_in_progress(uuid, uuid) FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.coaching_reschedule_in_progress(uuid, uuid) IS
  'True inside reschedule_coaching_session(): the same requirement of the same '
  'enrollment was released as rescheduled in THIS transaction (cancelled_at = '
  'now(), the transaction timestamp). The replacement is not a new booking, so '
  'the booking goal gate exempts it. INTERNAL.';

CREATE OR REPLACE FUNCTION public.book_coaching_session_internal(
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
    p_enrollment_id, p_requirement_id, p_coach_id, v_enr.user_id,
    p_slot_id, p_topic, v_start, v_duration, 'pending_coach_approval'
  )
  RETURNING id INTO v_session_id;

  RETURN v_session_id;
END;
$$;

REVOKE ALL ON FUNCTION public.book_coaching_session_internal(uuid, uuid, uuid, uuid, text, timestamptz, integer)
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Mentoring (base: 20260921160000)
-- ---------------------------------------------------------------------------

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

-- The Mentoring pre-check reports the gate once every other reason is 'ok', so
-- a structural problem (inactive, not in pool, limit reached) still wins, and
-- the mentor list (which reads can_book_mentoring_session_reason directly)
-- keeps showing mentors while the gate is closed.
CREATE OR REPLACE FUNCTION public.check_can_book_mentoring_session_reason_for_enrollment(
  p_mentor_id uuid,
  p_enrollment_id uuid
) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public, pg_temp AS $$
  SELECT CASE
    WHEN r.reason = 'ok' AND public.enrollment_goal_gate_blocked(p_enrollment_id)
      THEN 'goal_required_before_booking'
    ELSE r.reason
  END
  FROM (SELECT public.can_book_mentoring_session_reason(auth.uid(), p_mentor_id, p_enrollment_id) AS reason) r;
$$;

REVOKE ALL ON FUNCTION public.check_can_book_mentoring_session_reason_for_enrollment(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.check_can_book_mentoring_session_reason_for_enrollment(uuid,uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. Peer, learner-to-learner (bases: 20260922120000, 20260914071404)
-- ---------------------------------------------------------------------------

-- can_book_coachee_peer_session() is deliberately NOT gated: the Peer cap
-- trigger and INSERT policy call it for EVERY learner-written row, including
-- historical completed ones, while the gate only concerns new live bookings.
-- book_coachee_peer_session() and the coachee_peer_sessions_booking_goal_gate
-- trigger (section 7) cover every new Peer booking.

CREATE OR REPLACE FUNCTION public.book_coachee_peer_session(
  p_provider_id uuid, p_enrollment_id uuid, p_topic text,
  p_start_time timestamptz, p_duration_minutes integer, p_slot_id uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public, pg_temp
AS $$
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
  IF NOT public.can_book_coachee_peer_session(p_provider_id,p_enrollment_id) THEN
    RAISE EXCEPTION 'Peer coaching entitlement has been exhausted or booking is not allowed' USING ERRCODE='42501';
  END IF;
  INSERT INTO public.coachee_peer_sessions
    (peer_provider_id,peer_receiver_id,enrollment_id,topic,start_time,duration_minutes,status,slot_id)
  VALUES (p_provider_id,auth.uid(),p_enrollment_id,p_topic,p_start_time,p_duration_minutes,
          'pending_coach_approval'::public.session_status,p_slot_id)
  RETURNING id INTO booked_id;
  RETURN booked_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- 5. Peer, coach-to-coach for a coach who is a learner (base: 20260911150000)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.book_peer_session(
  p_peer_coach_id uuid, p_enrollment_id uuid, p_topic text,
  p_start_time timestamptz, p_duration_minutes integer, p_slot_id uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE booked_id uuid;
BEGIN
  IF auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.programme_enrollments e
    WHERE e.id = p_enrollment_id AND e.user_id = auth.uid()
  ) THEN
    PERFORM public.assert_enrollment_goal_gate(p_enrollment_id);
  END IF;
  IF NOT public.can_book_peer_session(p_peer_coach_id,p_enrollment_id) THEN
    RAISE EXCEPTION 'Peer booking is not allowed for this enrollment' USING ERRCODE='42501';
  END IF;
  INSERT INTO public.peer_sessions
    (peer_coach_id,peer_coachee_id,enrollment_id,topic,start_time,duration_minutes,status,slot_id)
  VALUES
    (p_peer_coach_id,auth.uid(),p_enrollment_id,p_topic,p_start_time,
     p_duration_minutes,'pending_coach_approval'::public.session_status,p_slot_id)
  RETURNING id INTO booked_id;
  RETURN booked_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- 6. Triads (bases: 20260919120000 schedule, 20260918190000 propose)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.learner_triad_schedule_session(p_group_id uuid, p_start timestamptz, p_end timestamptz)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE me uuid := public.triad_member_enrollment_for_user(p_group_id, auth.uid()); session_id uuid;
BEGIN
  IF me IS NULL THEN
    RAISE EXCEPTION 'Only members of this Triad group can do this' USING ERRCODE = '42501';
  END IF;
  -- Booking goal gate: the proposing learner's enrollment.
  PERFORM public.assert_enrollment_goal_gate(me);
  IF p_start IS NULL OR p_end IS NULL OR p_end <= p_start THEN
    RAISE EXCEPTION 'A session needs a start before its end' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.triad_sessions s WHERE s.triad_group_id = p_group_id AND s.status IN ('proposed', 'confirmed')) THEN
    RAISE EXCEPTION 'This group already has an open Triad session' USING ERRCODE = '23505';
  END IF;
  IF EXISTS (SELECT 1 FROM public.triad_sessions s WHERE s.triad_group_id = p_group_id AND s.status = 'completed') THEN
    RAISE EXCEPTION 'This group''s Triad is already completed' USING ERRCODE = '23505';
  END IF;
  INSERT INTO public.triad_sessions (triad_group_id, scheduled_start_time, scheduled_end_time, status)
  VALUES (p_group_id, p_start, p_end, 'proposed')
  RETURNING id INTO session_id;
  INSERT INTO public.triad_session_responses (triad_session_id, enrollment_id, response, responded_at)
  SELECT session_id, m.enrollment_id,
    CASE WHEN m.enrollment_id = me THEN 'accepted' ELSE 'pending' END,
    CASE WHEN m.enrollment_id = me THEN now() END
  FROM public.triad_group_members m WHERE m.triad_group_id = p_group_id;
  RETURN session_id;
END $$;

CREATE OR REPLACE FUNCTION public.learner_triad_propose_alternative(p_session_id uuid, p_start timestamptz, p_end timestamptz)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE me uuid := public.triad_caller_member_enrollment(p_session_id); s public.triad_sessions; proposal uuid;
BEGIN
  -- Booking goal gate: the proposing learner's enrollment.
  PERFORM public.assert_enrollment_goal_gate(me);
  SELECT * INTO s FROM public.triad_sessions WHERE id = p_session_id FOR UPDATE;
  IF s.status NOT IN ('proposed', 'confirmed') THEN
    RAISE EXCEPTION 'Only an open Triad session can be rescheduled' USING ERRCODE = '42501';
  END IF;
  IF p_start IS NULL OR p_end IS NULL OR p_end <= p_start THEN
    RAISE EXCEPTION 'An alternative needs a start before its end' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.triad_alternative_proposals (triad_session_id, proposed_by_enrollment_id, proposed_start_time, proposed_end_time, status)
  VALUES (p_session_id, me, p_start, p_end, 'pending')
  RETURNING id INTO proposal;
  INSERT INTO public.triad_alternative_proposal_responses (proposal_id, enrollment_id, response, responded_at)
  SELECT proposal, m.enrollment_id,
    CASE WHEN m.enrollment_id = me THEN 'accepted' ELSE 'pending' END,
    CASE WHEN m.enrollment_id = me THEN now() END
  FROM public.triad_group_members m WHERE m.triad_group_id = s.triad_group_id;
  RETURN proposal;
END $$;

-- ---------------------------------------------------------------------------
-- 7. Row-level backstop for a learner's direct INSERT of their own booking
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.enforce_booking_goal_gate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_actor uuid := auth.uid();
BEGIN
  IF NEW.enrollment_id IS NULL
     OR NEW.status::text NOT IN ('pending_coach_approval', 'confirmed')
     OR v_actor IS NULL THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.programme_enrollments e
    WHERE e.id = NEW.enrollment_id AND e.user_id = v_actor
  ) THEN
    RETURN NEW;
  END IF;
  -- The Coaching reschedule replacement is not a new booking (same exemption
  -- as book_coaching_session_internal). Only `sessions` has a reschedule
  -- that inserts a row, so the column is read only there.
  IF TG_TABLE_NAME = 'sessions' THEN
    IF public.coaching_reschedule_in_progress(NEW.enrollment_id, NEW.cohort_requirement_id) THEN
      RETURN NEW;
    END IF;
  END IF;
  -- RPC inserts reach here too (they asserted already); asserting again is
  -- idempotent and keeps this backstop independent of session GUCs.
  PERFORM public.assert_enrollment_goal_gate(NEW.enrollment_id);
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_booking_goal_gate() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS sessions_booking_goal_gate ON public.sessions;
CREATE TRIGGER sessions_booking_goal_gate
  BEFORE INSERT ON public.sessions
  FOR EACH ROW EXECUTE FUNCTION public.enforce_booking_goal_gate();

DROP TRIGGER IF EXISTS mentoring_sessions_booking_goal_gate ON public.mentoring_sessions;
CREATE TRIGGER mentoring_sessions_booking_goal_gate
  BEFORE INSERT ON public.mentoring_sessions
  FOR EACH ROW EXECUTE FUNCTION public.enforce_booking_goal_gate();

DROP TRIGGER IF EXISTS coachee_peer_sessions_booking_goal_gate ON public.coachee_peer_sessions;
CREATE TRIGGER coachee_peer_sessions_booking_goal_gate
  BEFORE INSERT ON public.coachee_peer_sessions
  FOR EACH ROW EXECUTE FUNCTION public.enforce_booking_goal_gate();

DROP TRIGGER IF EXISTS peer_sessions_booking_goal_gate ON public.peer_sessions;
CREATE TRIGGER peer_sessions_booking_goal_gate
  BEFORE INSERT ON public.peer_sessions
  FOR EACH ROW EXECUTE FUNCTION public.enforce_booking_goal_gate();

-- ---------------------------------------------------------------------------
-- 8. Minimum one active goal after the grace period
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.enforce_minimum_active_goal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_start date;
  v_result public.coachee_goals;
BEGIN
  -- A DELETE trigger must return OLD, an UPDATE trigger NEW.
  IF TG_OP = 'DELETE' THEN
    v_result := OLD;
  ELSE
    v_result := NEW;
  END IF;

  IF OLD.status IS DISTINCT FROM 'active' OR OLD.enrollment_id IS NULL THEN
    RETURN v_result;
  END IF;
  -- An update that keeps the goal active in the same enrollment is an edit.
  IF TG_OP = 'UPDATE'
     AND NEW.status = 'active'
     AND NEW.enrollment_id IS NOT DISTINCT FROM OLD.enrollment_id THEN
    RETURN NEW;
  END IF;
  -- The rule binds the learner. Admin and system writes (data repair,
  -- cascaded deletes) are exempt.
  IF v_actor IS NULL OR v_actor IS DISTINCT FROM OLD.coachee_id THEN
    RETURN v_result;
  END IF;
  -- Only an ongoing enrollment needs a goal to keep booking.
  IF NOT EXISTS (
    SELECT 1 FROM public.programme_enrollments e
    WHERE e.id = OLD.enrollment_id
      AND e.status IN ('active'::public.enrollment_status,
                       'at_risk'::public.enrollment_status,
                       'paused'::public.enrollment_status)
  ) THEN
    RETURN v_result;
  END IF;

  v_start := public.enrollment_goal_gate_start_date(OLD.enrollment_id);
  IF v_start IS NOT NULL AND current_date >= v_start + 7
     AND NOT EXISTS (
       SELECT 1 FROM public.coachee_goals g
       WHERE g.enrollment_id = OLD.enrollment_id
         AND g.status = 'active'
         AND g.id <> OLD.id
     ) THEN
    RAISE EXCEPTION 'last_active_goal_required'
      USING ERRCODE = 'P0001',
        DETAIL = jsonb_build_object('code', 'last_active_goal_required',
                                    'enrollment_id', OLD.enrollment_id,
                                    'goal_id', OLD.id)::text,
        HINT = 'Add another goal before removing your last active goal.';
  END IF;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_minimum_active_goal() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS coachee_goals_minimum_active ON public.coachee_goals;
CREATE TRIGGER coachee_goals_minimum_active
  BEFORE UPDATE OF status, enrollment_id OR DELETE ON public.coachee_goals
  FOR EACH ROW EXECUTE FUNCTION public.enforce_minimum_active_goal();

COMMENT ON FUNCTION public.enforce_minimum_active_goal() IS
  'Min 1 active goal: after the booking grace period the learner cannot '
  'archive, delete or otherwise retire the last active goal of an ongoing '
  'enrollment (last_active_goal_required, P0001). Max 3 lives in '
  'validate_enrollment_goal().';
