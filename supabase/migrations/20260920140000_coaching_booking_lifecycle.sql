-- Atomic Coaching booking, cancellation and rescheduling
-- (Coaching redesign, deployment 1).
--
-- Section 10: the moment a learner successfully requests a slot, that slot is
-- unavailable to everyone else. Previously a session was created as
-- pending_coach_approval while the slot only became unavailable at Coach
-- confirmation, which left a double-booking window. Reservation now happens
-- inside the same transaction as session creation.
--
-- Double-booking is prevented by two independent mechanisms, either of which
-- is sufficient:
--
--   1. The slot row is locked with SELECT ... FOR UPDATE before any check, so
--      two concurrent callers serialise; the loser re-reads the row and sees
--      it taken.
--   2. sessions_one_live_session_per_slot (20260920110000) is a partial unique
--      index, so even a caller bypassing this function entirely cannot create
--      a second live session on the same slot.
--
-- These lifecycle functions set app.session_transition, the existing escape
-- hatch guard_session_protected_fields() uses to distinguish the lifecycle
-- service from an ad-hoc table write.

-- ---------------------------------------------------------------------------
-- 1. Booking
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.book_coaching_session(
  p_enrollment_id uuid,
  p_coach_id uuid,
  p_slot_id uuid,
  p_requirement_id uuid,
  p_topic text
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
  v_start timestamptz;
  v_duration integer;
  v_session_id uuid;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  -- (2) Lock the race-sensitive resource FIRST, before any validation, so two
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

  -- (3) Load the enrollment.
  SELECT e.id, e.user_id, e.cohort_id, e.programme_id, e.status
    INTO v_enr
  FROM public.programme_enrollments e
  WHERE e.id = p_enrollment_id;

  IF v_enr.id IS NULL THEN
    RAISE EXCEPTION 'Enrollment % does not exist', p_enrollment_id USING ERRCODE = '23503';
  END IF;

  -- (4) Verify.
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

  -- Requirement must belong to this enrollment's cohort and be a Coaching one.
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

  -- Requirement must not already be fulfilled or reserved by a live session.
  IF EXISTS (
    SELECT 1 FROM public.sessions s
    WHERE s.cohort_requirement_id = p_requirement_id
      AND s.enrollment_id = p_enrollment_id
      AND s.status IN ('pending_coach_approval', 'confirmed', 'completed')
  ) THEN
    RAISE EXCEPTION 'Coaching requirement % already has a live or completed session', p_requirement_id
      USING ERRCODE = '23505';
  END IF;

  -- Coach must be in the cohort Coach pool. The frontend's coach_id is never
  -- trusted (section 9).
  IF NOT EXISTS (
    SELECT 1 FROM public.cohort_coaching_coach_pool(v_enr.cohort_id) p
    WHERE p.coach_id = p_coach_id
  ) THEN
    RAISE EXCEPTION 'Coach % is not assigned to cohort %', p_coach_id, v_enr.cohort_id
      USING ERRCODE = '42501';
  END IF;

  -- Slot must belong to that Coach, be a Coaching slot, and still be free.
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

  v_start := (v_slot.slot_date + v_slot.start_time) AT TIME ZONE 'UTC';
  v_duration := GREATEST(
    EXTRACT(EPOCH FROM (v_slot.end_time - v_slot.start_time))::integer / 60, 1);

  IF v_start < now() THEN
    RAISE EXCEPTION 'Availability slot is in the past' USING ERRCODE = '23514';
  END IF;

  -- (5) Create the session. cohort_id and the Coach-pool recheck are applied
  -- by validate_coaching_session_requirement(); (6) the slot is reserved by
  -- sync_coaching_slot_reservation(). Both run inside this transaction.
  PERFORM set_config('app.session_transition', 'on', true);

  INSERT INTO public.sessions (
    enrollment_id, cohort_requirement_id, coach_id, coachee_id,
    slot_id, topic, start_time, duration_minutes, status
  ) VALUES (
    p_enrollment_id, p_requirement_id, p_coach_id, v_actor,
    p_slot_id, p_topic, v_start, v_duration, 'pending_coach_approval'
  )
  RETURNING id INTO v_session_id;

  -- (7)
  RETURN v_session_id;
END;
$$;

REVOKE ALL ON FUNCTION public.book_coaching_session(uuid, uuid, uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.book_coaching_session(uuid, uuid, uuid, uuid, text) TO authenticated;

COMMENT ON FUNCTION public.book_coaching_session(uuid, uuid, uuid, uuid, text) IS
  'Server-authoritative atomic Coaching booking. Locks the slot before '
  'validating, creates the session as pending_coach_approval and reserves the '
  'slot in the same transaction.';

-- ---------------------------------------------------------------------------
-- 2. The next unmet Coaching requirement (section 8)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.next_coaching_requirement(p_enrollment_id uuid)
RETURNS TABLE (requirement_id uuid, ordinal integer, due_on date)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT f.requirement_id, f.ordinal, f.due_on
  FROM public.canonical_coaching_requirement_fulfilment(p_enrollment_id) f
  WHERE f.session_id IS NULL
  ORDER BY f.ordinal
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.next_coaching_requirement(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.next_coaching_requirement(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. Cancellation (sections 13 and 14)
-- ---------------------------------------------------------------------------
--
-- One authoritative cancellation path for every Coaching surface. It keeps the
-- behaviour the cancel-session Edge Function had (status, cancelled_at,
-- cancelled_by, cancel_reason, slot release) and adds requirement release,
-- which follows automatically: the partial unique indexes only bind live
-- sessions, so a cancelled row reserves neither slot nor requirement, and
-- canonical progress reflects that on the next read with nothing to recompute.
--
-- Section 14: a Coach or Admin may cancel at any time, including inside 24
-- hours. Refusing a late cancellation does not make the session happen; it
-- only creates a state where the record disagrees with reality. Who cancelled,
-- when, and why is always recorded, and late cancellations are flagged rather
-- than blocked.

CREATE OR REPLACE FUNCTION public.cancel_coaching_session(
  p_session_id uuid,
  p_reason text DEFAULT NULL
)
RETURNS TABLE (session_id uuid, was_late boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_is_admin boolean;
  v_s record;
  v_late boolean;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  v_is_admin := public.has_role(v_actor, 'admin'::public.app_role);

  SELECT s.id, s.coach_id, s.coachee_id, s.status, s.start_time, s.slot_id
    INTO v_s
  FROM public.sessions s WHERE s.id = p_session_id
  FOR UPDATE;

  IF v_s.id IS NULL THEN
    RAISE EXCEPTION 'Session % does not exist', p_session_id USING ERRCODE = '23503';
  END IF;

  IF NOT (v_is_admin OR v_actor = v_s.coach_id OR v_actor = v_s.coachee_id) THEN
    RAISE EXCEPTION 'Not authorised to cancel this session' USING ERRCODE = '42501';
  END IF;

  IF v_s.status NOT IN ('pending_coach_approval', 'confirmed') THEN
    RAISE EXCEPTION 'Session is not live (status=%)', v_s.status USING ERRCODE = '23514';
  END IF;

  -- A learner cancelling inside 24 hours must give a reason; Coach and Admin
  -- are never blocked.
  v_late := v_s.start_time - now() < interval '24 hours';
  IF v_late AND v_actor = v_s.coachee_id AND NOT v_is_admin
     AND (p_reason IS NULL OR length(btrim(p_reason)) = 0) THEN
    RAISE EXCEPTION 'A reason is required to cancel within 24 hours of the session'
      USING ERRCODE = '23514';
  END IF;

  PERFORM set_config('app.session_transition', 'on', true);

  UPDATE public.sessions
     SET status = 'cancelled',
         cancelled_at = now(),
         cancelled_by = v_actor,
         cancel_reason = p_reason
   WHERE id = p_session_id;
  -- sync_coaching_slot_reservation() releases the slot; the partial unique
  -- indexes release the requirement by no longer matching this row.

  RETURN QUERY SELECT p_session_id, v_late;
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_coaching_session(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_coaching_session(uuid, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. Rescheduling (section 15)
-- ---------------------------------------------------------------------------
--
-- The new slot is reserved before the old booking is released, inside one
-- transaction. If the new slot cannot be taken the whole statement rolls back
-- and the learner keeps the original session -- never released-then-stranded.

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
         s.status, s.topic, s.slot_id
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

  -- Release the requirement and slot first WITHIN this transaction, so the
  -- partial unique indexes admit the replacement. If anything below fails the
  -- rollback restores the original row untouched.
  UPDATE public.sessions
     SET status = 'rescheduled',
         cancelled_at = now(),
         cancelled_by = v_actor,
         cancel_reason = coalesce(p_reason, 'Rescheduled')
   WHERE id = p_session_id;

  -- Re-book atomically. Any failure here aborts the whole transaction,
  -- including the release above.
  v_new_session := public.book_coaching_session(
    v_s.enrollment_id, v_s.coach_id, p_new_slot_id, v_s.cohort_requirement_id, v_s.topic);

  RETURN v_new_session;
END;
$$;

REVOKE ALL ON FUNCTION public.reschedule_coaching_session(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reschedule_coaching_session(uuid, uuid, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 5. Coach marks the session held (section 16)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.complete_coaching_session(p_session_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_is_admin boolean;
  v_s record;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  v_is_admin := public.has_role(v_actor, 'admin'::public.app_role);

  SELECT s.id, s.coach_id, s.status, s.start_time INTO v_s
  FROM public.sessions s WHERE s.id = p_session_id FOR UPDATE;

  IF v_s.id IS NULL THEN
    RAISE EXCEPTION 'Session % does not exist', p_session_id USING ERRCODE = '23503';
  END IF;

  -- The Coach is the actor who marks a Coaching session held. A learner
  -- cannot, even for their own session.
  IF NOT (v_is_admin OR v_actor = v_s.coach_id) THEN
    RAISE EXCEPTION 'Only the assigned Coach or an Admin may mark a session complete'
      USING ERRCODE = '42501';
  END IF;
  IF v_s.status <> 'confirmed' THEN
    RAISE EXCEPTION 'Only a confirmed session can be completed (status=%)', v_s.status
      USING ERRCODE = '23514';
  END IF;
  IF v_s.start_time > now() THEN
    RAISE EXCEPTION 'A session cannot be completed before it starts' USING ERRCODE = '23514';
  END IF;

  PERFORM set_config('app.session_transition', 'on', true);

  UPDATE public.sessions SET status = 'completed' WHERE id = p_session_id;

  -- Deliberately does NOT complete the Coaching unit. The unit stays
  -- post-session-pending until the learner's four evidence gates are met; see
  -- coaching_session_evidence().
  RETURN p_session_id;
END;
$$;

REVOKE ALL ON FUNCTION public.complete_coaching_session(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_coaching_session(uuid) TO authenticated;
