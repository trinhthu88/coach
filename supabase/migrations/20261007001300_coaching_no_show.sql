-- Coaching no-show rule (decision 7 follow-up, 7 Oct 2026).
--
-- Mentoring already refuses a mentee cancel once the session has started, so
-- a no-show counts as held. Coaching still let the learner cancel (with a
-- reason) or reschedule after the start, which freed the unit and erased the
-- no-show. Both learner paths now refuse from the start time; the Coach and
-- an Admin are never blocked. A learner cancel inside 24 hours, with a
-- reason, still frees the unit (product decision, unchanged).
--
-- Bodies are the current definitions (20260920140000 and 20260921100000)
-- with only the guard added. CREATE OR REPLACE keeps the existing grants.

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

  -- Once the session has started the learner can no longer cancel it: a
  -- no-show counts as held and is the Coach's (or an Admin's) to resolve.
  -- Same rule as Mentoring (decision 7).
  IF NOT v_is_admin AND v_actor = v_s.coachee_id AND v_actor IS DISTINCT FROM v_s.coach_id
     AND v_s.start_time <= now() THEN
    RAISE EXCEPTION 'The session has started: only the Coach or an Admin can change it now'
      USING ERRCODE = '42501';
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
         s.status, s.topic, s.slot_id, s.duration_minutes, s.start_time
    INTO v_s
  FROM public.sessions s WHERE s.id = p_session_id
  FOR UPDATE;

  IF v_s.id IS NULL THEN
    RAISE EXCEPTION 'Session % does not exist', p_session_id USING ERRCODE = '23503';
  END IF;

  -- The authorisation rule for rescheduling, applied HERE rather than
  -- inherited from the booking path: the Coach and an Admin may move a session
  -- they are responsible for, and the learner may move their own.
  IF NOT (v_is_admin OR v_actor = v_s.coach_id OR v_actor = v_s.coachee_id) THEN
    RAISE EXCEPTION 'Not authorised to reschedule this session' USING ERRCODE = '42501';
  END IF;
  IF v_s.status NOT IN ('pending_coach_approval', 'confirmed') THEN
    RAISE EXCEPTION 'Only a live session can be rescheduled (status=%)', v_s.status
      USING ERRCODE = '23514';
  END IF;

  -- Once the session has started the learner can no longer move it: a
  -- no-show counts as held and is the Coach's (or an Admin's) to resolve.
  -- Same rule as Mentoring (decision 7).
  IF NOT v_is_admin AND v_actor = v_s.coachee_id AND v_actor IS DISTINCT FROM v_s.coach_id
     AND v_s.start_time <= now() THEN
    RAISE EXCEPTION 'The session has started: only the Coach or an Admin can change it now'
      USING ERRCODE = '42501';
  END IF;

  PERFORM set_config('app.session_transition', 'on', true);

  -- Release the requirement and slot first WITHIN this transaction, so the
  -- partial unique indexes admit the replacement.
  UPDATE public.sessions
     SET status = 'rescheduled',
         cancelled_at = now(),
         cancelled_by = v_actor,
         cancel_reason = coalesce(p_reason, 'Rescheduled')
   WHERE id = p_session_id;

  -- The replacement fulfils the SAME requirement and keeps the same Coach and
  -- the same learner. Any failure here aborts the whole transaction, including
  -- the release above, so the learner is never left with neither slot.
  v_new_session := public.book_coaching_session_internal(
    v_s.enrollment_id, v_s.coach_id, p_new_slot_id, v_s.cohort_requirement_id,
    v_s.topic, NULL, v_s.duration_minutes);

  RETURN v_new_session;
END;
$$;
