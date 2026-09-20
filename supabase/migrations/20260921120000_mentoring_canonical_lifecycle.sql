-- Mentoring canonical booking, lifecycle, field protection and slot safety
-- (Mentoring canonical cutover, phase 2).
--
-- Phase 1 gave Mentoring requirement attribution. Everything below the
-- attribution was still pre-canonical:
--
--   * booking was a raw client INSERT into mentoring_sessions, so there was no
--     slot lock, no server-side validation of the requested window, and the
--     requirement was filled in by the phase-1 compatibility trigger rather
--     than decided by the booking path;
--   * confirmation was a service-role UPDATE inside an Edge Function and
--     completion was a raw client UPDATE, so `status` had three writers and
--     none of them enforced a transition rule;
--   * guard_session_protected_fields() had no mentoring_sessions branch and no
--     trigger, so a participant could rewrite enrollment_id, mentor_id,
--     mentee_id, status or the cancellation metadata directly;
--   * mentoring_sessions_slot_id_unique was unique on slot_id across EVERY
--     status, so a cancelled session held its slot forever, while nothing ever
--     set coach_availability.is_booked at request time -- the picker filters on
--     is_booked = false, so the slot stayed on offer to everyone else between
--     request and mentor confirmation.
--
-- This is the Coaching architecture applied to Mentoring, with Coaching's own
-- C3 lesson built in from the start: authorisation belongs to the entry point,
-- validation belongs to one shared internal function, and the two are never
-- fused.
--
-- Completion is operational only. A Mentoring session completes when the
-- meeting legitimately took place. The preparation document, the mentee's
-- reflection, the mentor's notes and the mentor's feedback are after-session
-- evidence: they are reported separately and gate nothing.

-- ---------------------------------------------------------------------------
-- 1. Slot safety
-- ---------------------------------------------------------------------------

-- The legacy index was unique on slot_id across every status, so once a slot
-- had been used it could never be booked again -- a cancelled session kept
-- holding it forever. Coaching dropped the identical index in 20260920110000;
-- Mentoring still had it.
DROP INDEX IF EXISTS public.mentoring_sessions_slot_id_unique;

-- The same guarantee, restricted to live sessions: no protection against
-- double-booking is lost, and a cancelled session releases its slot.
CREATE UNIQUE INDEX mentoring_sessions_one_live_session_per_slot
  ON public.mentoring_sessions (slot_id)
  WHERE slot_id IS NOT NULL
    AND status IN ('pending_coach_approval', 'confirmed');

-- Reservation happens at request time, not at mentor confirmation: the slot is
-- unavailable to everyone else the moment the request exists. Mirrors
-- sync_coaching_slot_reservation(); coach_availability.session_id carries no
-- foreign key, so it holds a mentoring session id just as it holds a coaching
-- one.
CREATE OR REPLACE FUNCTION public.sync_mentoring_slot_reservation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_live constant text[] := ARRAY['pending_coach_approval', 'confirmed'];
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.slot_id IS NOT NULL
     AND (NEW.slot_id IS DISTINCT FROM OLD.slot_id OR NOT (NEW.status::text = ANY(v_live))) THEN
    UPDATE public.coach_availability
      SET is_booked = false, session_id = NULL
      WHERE id = OLD.slot_id AND session_id = OLD.id;
  END IF;

  IF NEW.slot_id IS NOT NULL AND NEW.status::text = ANY(v_live) THEN
    UPDATE public.coach_availability
      SET is_booked = true, session_id = NEW.id
      WHERE id = NEW.slot_id;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER mentoring_sessions_sync_slot_reservation
  AFTER INSERT OR UPDATE ON public.mentoring_sessions
  FOR EACH ROW EXECUTE FUNCTION public.sync_mentoring_slot_reservation();

-- ---------------------------------------------------------------------------
-- 2. Protected lifecycle fields
-- ---------------------------------------------------------------------------
--
-- Adds the mentoring_sessions branch. The sessions / peer_sessions /
-- coachee_peer_sessions branches are reproduced verbatim from
-- 20260914071400; only the new ELSIF is added, so no existing behaviour moves.

CREATE OR REPLACE FUNCTION public.guard_session_protected_fields()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE u uuid := auth.uid();
BEGIN
  IF u IS NULL OR public.has_role(u, 'admin'::public.app_role) THEN RETURN NEW; END IF;
  IF current_setting('app.session_transition', true) = 'on' THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME = 'sessions' THEN
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.enrollment_id IS DISTINCT FROM OLD.enrollment_id
       OR NEW.coach_id IS DISTINCT FROM OLD.coach_id OR NEW.coachee_id IS DISTINCT FROM OLD.coachee_id
       OR NEW.topic IS DISTINCT FROM OLD.topic OR NEW.start_time IS DISTINCT FROM OLD.start_time
       OR NEW.duration_minutes IS DISTINCT FROM OLD.duration_minutes OR NEW.status IS DISTINCT FROM OLD.status
       OR NEW.cancelled_at IS DISTINCT FROM OLD.cancelled_at OR NEW.cancelled_by IS DISTINCT FROM OLD.cancelled_by
       OR NEW.cancel_reason IS DISTINCT FROM OLD.cancel_reason OR NEW.confirmed_at IS DISTINCT FROM OLD.confirmed_at
       OR NEW.action_items IS DISTINCT FROM OLD.action_items
       OR (u <> OLD.coach_id AND NEW.meeting_url IS DISTINCT FROM OLD.meeting_url)
       OR (u <> OLD.coach_id AND NEW.coach_notes IS DISTINCT FROM OLD.coach_notes)
       OR (u <> OLD.coachee_id AND NEW.coachee_notes IS DISTINCT FROM OLD.coachee_notes) THEN
      RAISE EXCEPTION 'Session protected fields may only be changed by the lifecycle service' USING ERRCODE='42501';
    END IF;
  ELSIF TG_TABLE_NAME = 'mentoring_sessions' THEN
    -- Programme ownership (enrollment, requirement, cohort), the participants,
    -- the appointment itself and every lifecycle stamp belong to the lifecycle
    -- service. Notes belong to their author. prep_file_* is deliberately NOT
    -- protected: the preparation document is the learner's optional evidence.
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.enrollment_id IS DISTINCT FROM OLD.enrollment_id
       OR NEW.cohort_requirement_id IS DISTINCT FROM OLD.cohort_requirement_id
       OR NEW.cohort_id IS DISTINCT FROM OLD.cohort_id
       OR NEW.mentor_id IS DISTINCT FROM OLD.mentor_id OR NEW.mentee_id IS DISTINCT FROM OLD.mentee_id
       OR NEW.topic IS DISTINCT FROM OLD.topic OR NEW.start_time IS DISTINCT FROM OLD.start_time
       OR NEW.duration_minutes IS DISTINCT FROM OLD.duration_minutes OR NEW.status IS DISTINCT FROM OLD.status
       OR NEW.cancelled_at IS DISTINCT FROM OLD.cancelled_at OR NEW.cancelled_by IS DISTINCT FROM OLD.cancelled_by
       OR NEW.cancel_reason IS DISTINCT FROM OLD.cancel_reason OR NEW.confirmed_at IS DISTINCT FROM OLD.confirmed_at
       OR NEW.action_items IS DISTINCT FROM OLD.action_items
       OR (u <> OLD.mentor_id AND NEW.meeting_url IS DISTINCT FROM OLD.meeting_url)
       OR (u <> OLD.mentor_id AND NEW.mentor_notes IS DISTINCT FROM OLD.mentor_notes)
       OR (u <> OLD.mentee_id AND NEW.mentee_notes IS DISTINCT FROM OLD.mentee_notes) THEN
      RAISE EXCEPTION 'Mentoring session protected fields may only be changed by the lifecycle service' USING ERRCODE='42501';
    END IF;
  ELSIF TG_TABLE_NAME = 'peer_sessions' THEN
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.enrollment_id IS DISTINCT FROM OLD.enrollment_id
       OR NEW.peer_coach_id IS DISTINCT FROM OLD.peer_coach_id OR NEW.peer_coachee_id IS DISTINCT FROM OLD.peer_coachee_id
       OR NEW.topic IS DISTINCT FROM OLD.topic OR NEW.start_time IS DISTINCT FROM OLD.start_time
       OR NEW.duration_minutes IS DISTINCT FROM OLD.duration_minutes OR NEW.status IS DISTINCT FROM OLD.status
       OR NEW.cancelled_at IS DISTINCT FROM OLD.cancelled_at OR NEW.cancelled_by IS DISTINCT FROM OLD.cancelled_by
       OR NEW.cancel_reason IS DISTINCT FROM OLD.cancel_reason OR NEW.confirmed_at IS DISTINCT FROM OLD.confirmed_at
       OR NEW.action_items IS DISTINCT FROM OLD.action_items
       OR (u <> OLD.peer_coach_id AND NEW.meeting_url IS DISTINCT FROM OLD.meeting_url)
       OR (u <> OLD.peer_coach_id AND NEW.coach_notes IS DISTINCT FROM OLD.coach_notes)
       OR (u <> OLD.peer_coachee_id AND NEW.coachee_notes IS DISTINCT FROM OLD.coachee_notes) THEN
      RAISE EXCEPTION 'Peer session protected fields may only be changed by the lifecycle service' USING ERRCODE='42501';
    END IF;
  ELSE
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.enrollment_id IS DISTINCT FROM OLD.enrollment_id
       OR NEW.peer_provider_id IS DISTINCT FROM OLD.peer_provider_id OR NEW.peer_receiver_id IS DISTINCT FROM OLD.peer_receiver_id
       OR NEW.topic IS DISTINCT FROM OLD.topic OR NEW.start_time IS DISTINCT FROM OLD.start_time
       OR NEW.duration_minutes IS DISTINCT FROM OLD.duration_minutes OR NEW.status IS DISTINCT FROM OLD.status
       OR NEW.cancelled_at IS DISTINCT FROM OLD.cancelled_at OR NEW.cancelled_by IS DISTINCT FROM OLD.cancelled_by
       OR NEW.cancel_reason IS DISTINCT FROM OLD.cancel_reason OR NEW.confirmed_at IS DISTINCT FROM OLD.confirmed_at
       OR NEW.action_items IS DISTINCT FROM OLD.action_items
       OR (u <> OLD.peer_provider_id AND NEW.meeting_url IS DISTINCT FROM OLD.meeting_url)
       OR (u <> OLD.peer_provider_id AND NEW.provider_notes IS DISTINCT FROM OLD.provider_notes)
       OR (u <> OLD.peer_receiver_id AND NEW.receiver_notes IS DISTINCT FROM OLD.receiver_notes) THEN
      RAISE EXCEPTION 'Coachee peer session protected fields may only be changed by the lifecycle service' USING ERRCODE='42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS mentoring_sessions_protected_fields ON public.mentoring_sessions;
CREATE TRIGGER mentoring_sessions_protected_fields BEFORE UPDATE ON public.mentoring_sessions
  FOR EACH ROW EXECUTE FUNCTION public.guard_session_protected_fields();

-- ---------------------------------------------------------------------------
-- 3. The one validated Mentoring insert. INTERNAL: authorisation is the caller's.
-- ---------------------------------------------------------------------------
--
-- Split from its entry points deliberately. Coaching learned this the hard way
-- (C3): reschedule_coaching_session admitted the Coach and an Admin but
-- delegated to a booking function that demanded the caller own the enrollment,
-- so those paths could never work. Here the split exists from the start.

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
  -- Lock the race-sensitive resource FIRST, before any validation, so two
  -- concurrent bookings for one slot cannot both pass their checks. The
  -- partial unique index on live sessions is the independent second half.
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
  IF v_enr.status NOT IN ('active'::public.enrollment_status, 'at_risk'::public.enrollment_status) THEN
    RAISE EXCEPTION 'Enrollment is not active (status=%)', v_enr.status USING ERRCODE = '42501';
  END IF;
  IF v_enr.cohort_id IS NULL THEN
    RAISE EXCEPTION 'Enrollment has no cohort; Mentoring cannot be booked' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.programme_modules m
    WHERE m.programme_id = v_enr.programme_id
      AND m.module = 'mentoring'::public.programme_module_type
      AND m.enabled
  ) THEN
    RAISE EXCEPTION 'Mentoring is not enabled for this programme' USING ERRCODE = '42501';
  END IF;

  -- WHICH requirement. An explicit one always wins and is fully validated; with
  -- none supplied the booking path itself resolves the learner's next
  -- unfulfilled requirement, rather than leaving it to the phase-1
  -- compatibility trigger.
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

  -- WHO. The cohort mentor pool already requires an active mentor profile.
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
  -- the caller-supplied values safe to accept at all.
  IF v_start < v_slot_start OR (v_start + make_interval(mins => v_duration)) > v_slot_end THEN
    RAISE EXCEPTION 'Requested time % for % minutes falls outside the availability slot (% to %)',
      v_start, v_duration, v_slot_start, v_slot_end USING ERRCODE = '23514';
  END IF;
  IF v_start < now() THEN
    RAISE EXCEPTION 'Availability slot is in the past' USING ERRCODE = '23514';
  END IF;

  PERFORM set_config('app.session_transition', 'on', true);

  -- mentee_id comes from the enrollment, never from the caller: the enrollment
  -- is the only thing that knows whose session this is.
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

COMMENT ON FUNCTION public.book_mentoring_session_internal(uuid, uuid, uuid, text, uuid, timestamptz, integer) IS
  'THE validated Mentoring insert: slot lock, enrollment eligibility, '
  'requirement resolution and scope, cohort mentor pool, slot window. INTERNAL '
  'and not client-callable -- it decides WHAT IS VALID, never WHO MAY BOOK.';

CREATE OR REPLACE FUNCTION public.book_mentoring_session(
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
  v_actor uuid := auth.uid();
  v_owner uuid;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  -- The authorisation rule for booking: a learner books their own Mentoring.
  SELECT e.user_id INTO v_owner
  FROM public.programme_enrollments e WHERE e.id = p_enrollment_id;

  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'Enrollment % does not exist', p_enrollment_id USING ERRCODE = '23503';
  END IF;
  IF v_owner IS DISTINCT FROM v_actor AND NOT public.has_role(v_actor, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Enrollment does not belong to the authenticated user' USING ERRCODE = '42501';
  END IF;

  RETURN public.book_mentoring_session_internal(
    p_enrollment_id, p_mentor_id, p_slot_id, p_topic,
    p_requirement_id, p_start_time, p_duration_minutes);
END;
$$;

REVOKE ALL ON FUNCTION public.book_mentoring_session(uuid, uuid, uuid, text, uuid, timestamptz, integer)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.book_mentoring_session(uuid, uuid, uuid, text, uuid, timestamptz, integer)
  TO authenticated;

COMMENT ON FUNCTION public.book_mentoring_session(uuid, uuid, uuid, text, uuid, timestamptz, integer) IS
  'Server-authoritative atomic Mentoring booking by the learner who owns the '
  'enrollment (or an Admin on their behalf). Authorises, then delegates to '
  'book_mentoring_session_internal().';

-- ---------------------------------------------------------------------------
-- 4. Server-authoritative lifecycle
-- ---------------------------------------------------------------------------
--
-- One writer for mentoring_sessions.status, replacing the Edge Function's
-- service-role UPDATE and the client's direct UPDATE. Permitted transitions:
--
--   pending_coach_approval -> confirmed   mentor or Admin
--   pending_coach_approval -> cancelled   mentor, mentee or Admin
--   confirmed              -> completed   mentor or Admin, once it has started
--   confirmed              -> cancelled   mentor, mentee or Admin
--
-- Completion asks only whether the meeting could legitimately have happened.
-- It never asks for a preparation document, a reflection, mentor notes,
-- feedback, a goal check-in or an action: those are after-session evidence.

CREATE OR REPLACE FUNCTION public.transition_mentoring_session_status(
  p_session_id uuid,
  p_status text,
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
  v_next public.session_status;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  v_is_admin := public.has_role(v_actor, 'admin'::public.app_role);

  IF p_status NOT IN ('confirmed', 'completed', 'cancelled') THEN
    RAISE EXCEPTION 'Unsupported Mentoring transition target %', p_status USING ERRCODE = '23514';
  END IF;
  v_next := p_status::public.session_status;

  SELECT s.id, s.mentor_id, s.mentee_id, s.status, s.start_time
    INTO v_s
  FROM public.mentoring_sessions s WHERE s.id = p_session_id
  FOR UPDATE;

  IF v_s.id IS NULL THEN
    RAISE EXCEPTION 'Mentoring session % does not exist', p_session_id USING ERRCODE = '23503';
  END IF;
  IF NOT (v_is_admin OR v_actor = v_s.mentor_id OR v_actor = v_s.mentee_id) THEN
    RAISE EXCEPTION 'Not authorised to change this Mentoring session' USING ERRCODE = '42501';
  END IF;

  IF v_next = 'confirmed'::public.session_status THEN
    IF v_s.status <> 'pending_coach_approval'::public.session_status THEN
      RAISE EXCEPTION 'Only a pending Mentoring session can be confirmed (status=%)', v_s.status
        USING ERRCODE = '23514';
    END IF;
    -- The mentor accepts the request; the mentee cannot accept on their behalf.
    IF NOT (v_is_admin OR v_actor = v_s.mentor_id) THEN
      RAISE EXCEPTION 'Only the mentor or an Admin may confirm a Mentoring session'
        USING ERRCODE = '42501';
    END IF;

  ELSIF v_next = 'completed'::public.session_status THEN
    IF v_s.status <> 'confirmed'::public.session_status THEN
      RAISE EXCEPTION 'Only a confirmed Mentoring session can be completed (status=%)', v_s.status
        USING ERRCODE = '23514';
    END IF;
    IF NOT (v_is_admin OR v_actor = v_s.mentor_id) THEN
      RAISE EXCEPTION 'Only the mentor or an Admin may mark a Mentoring session complete'
        USING ERRCODE = '42501';
    END IF;
    IF v_s.start_time > now() THEN
      RAISE EXCEPTION 'A session cannot be completed before it starts' USING ERRCODE = '23514';
    END IF;

  ELSE -- cancelled
    IF v_s.status NOT IN ('pending_coach_approval'::public.session_status,
                          'confirmed'::public.session_status) THEN
      RAISE EXCEPTION 'Only a live Mentoring session can be cancelled (status=%)', v_s.status
        USING ERRCODE = '23514';
    END IF;
  END IF;

  PERFORM set_config('app.session_transition', 'on', true);

  UPDATE public.mentoring_sessions
     SET status = v_next,
         confirmed_at = CASE WHEN v_next = 'confirmed'::public.session_status
                             THEN now() ELSE confirmed_at END,
         cancelled_at = CASE WHEN v_next = 'cancelled'::public.session_status
                             THEN now() ELSE cancelled_at END,
         cancelled_by = CASE WHEN v_next = 'cancelled'::public.session_status
                             THEN v_actor ELSE cancelled_by END,
         cancel_reason = CASE WHEN v_next = 'cancelled'::public.session_status
                              THEN p_reason ELSE cancel_reason END
   WHERE id = p_session_id;
  -- sync_mentoring_slot_reservation() releases the slot on cancellation; the
  -- partial unique indexes release the slot and the requirement by no longer
  -- matching this row.

  RETURN p_session_id;
END;
$$;

REVOKE ALL ON FUNCTION public.transition_mentoring_session_status(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transition_mentoring_session_status(uuid, text, text) TO authenticated;

COMMENT ON FUNCTION public.transition_mentoring_session_status(uuid, text, text) IS
  'THE writer of mentoring_sessions.status. Operational lifecycle only: '
  'completion records that the meeting happened and never requires a '
  'preparation document, reflection, notes, feedback, goal check-in or action.';

-- ---------------------------------------------------------------------------
-- 5. Mentoring notes, written by their author only
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.update_mentoring_session_notes(
  p_session_id uuid,
  p_mentor_notes text DEFAULT NULL,
  p_mentee_notes text DEFAULT NULL,
  p_meeting_url text DEFAULT NULL
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
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  v_is_admin := public.has_role(v_actor, 'admin'::public.app_role);

  SELECT s.id, s.mentor_id, s.mentee_id INTO v_s
  FROM public.mentoring_sessions s WHERE s.id = p_session_id;

  IF v_s.id IS NULL THEN
    RAISE EXCEPTION 'Mentoring session % does not exist', p_session_id USING ERRCODE = '23503';
  END IF;
  IF NOT (v_is_admin OR v_actor = v_s.mentor_id OR v_actor = v_s.mentee_id) THEN
    RAISE EXCEPTION 'Not authorised to write on this Mentoring session' USING ERRCODE = '42501';
  END IF;

  -- Each party writes only their own side. Passing the other party's field is
  -- refused outright rather than silently dropped.
  IF p_mentor_notes IS NOT NULL AND NOT (v_is_admin OR v_actor = v_s.mentor_id) THEN
    RAISE EXCEPTION 'Only the mentor may write mentor notes' USING ERRCODE = '42501';
  END IF;
  IF p_mentee_notes IS NOT NULL AND NOT (v_is_admin OR v_actor = v_s.mentee_id) THEN
    RAISE EXCEPTION 'Only the mentee may write mentee notes' USING ERRCODE = '42501';
  END IF;
  IF p_meeting_url IS NOT NULL AND NOT (v_is_admin OR v_actor = v_s.mentor_id) THEN
    RAISE EXCEPTION 'Only the mentor may set the meeting link' USING ERRCODE = '42501';
  END IF;

  UPDATE public.mentoring_sessions
     SET mentor_notes = coalesce(p_mentor_notes, mentor_notes),
         mentee_notes = coalesce(p_mentee_notes, mentee_notes),
         meeting_url  = coalesce(p_meeting_url, meeting_url)
   WHERE id = p_session_id;

  RETURN p_session_id;
END;
$$;

REVOKE ALL ON FUNCTION public.update_mentoring_session_notes(uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_mentoring_session_notes(uuid, text, text, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 6. After-session evidence, reported and never gating
-- ---------------------------------------------------------------------------
--
-- The derived evidence contract asked for by the product rule. It answers
-- "what is still outstanding after this meeting", and deliberately returns no
-- unit/progress field of any kind: programme completion is decided solely by
-- canonical_mentoring_requirement_fulfilment(), and a second function that
-- looked like it could decide completion is exactly how evidence-gated
-- progress gets reintroduced.

CREATE OR REPLACE FUNCTION public.mentoring_session_evidence(p_session_id uuid)
RETURNS TABLE (
  session_id uuid,
  enrollment_id uuid,
  session_status text,
  has_prep_file boolean,
  has_mentee_reflection boolean,
  has_mentor_notes boolean,
  has_mentor_feedback boolean,
  has_goal_checkin boolean,
  action_count integer,
  goal_checkin_available boolean,
  evidence_complete boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  WITH s AS (
    SELECT m.id, m.enrollment_id, m.status, m.prep_file_path, m.mentee_notes, m.mentor_notes
    FROM public.mentoring_sessions m WHERE m.id = p_session_id
  ), gates AS (
    SELECT s.id, s.enrollment_id, s.status::text AS session_status,
      nullif(btrim(coalesce(s.prep_file_path, '')), '') IS NOT NULL AS has_prep_file,
      (nullif(btrim(coalesce(s.mentee_notes, '')), '') IS NOT NULL
        OR EXISTS (
          SELECT 1 FROM public.session_learning_reflections r
          WHERE r.enrollment_id = s.enrollment_id
            AND r.source_activity_type = 'mentoring' AND r.source_activity_id = s.id
        )) AS has_mentee_reflection,
      nullif(btrim(coalesce(s.mentor_notes, '')), '') IS NOT NULL AS has_mentor_notes,
      EXISTS (
        SELECT 1 FROM public.mentoring_feedback f WHERE f.mentoring_session_id = s.id
      ) AS has_mentor_feedback,
      EXISTS (
        SELECT 1 FROM public.goal_checkins c
        WHERE c.enrollment_id = s.enrollment_id
          AND c.source_activity_type = 'mentoring' AND c.source_activity_id = s.id
      ) AS has_goal_checkin,
      (SELECT count(*)::integer FROM public.enrollment_actions a
        WHERE a.enrollment_id = s.enrollment_id
          AND a.source_activity_type = 'mentoring' AND a.source_activity_id = s.id) AS action_count,
      EXISTS (
        SELECT 1 FROM public.coachee_goals g
        WHERE g.enrollment_id = s.enrollment_id AND g.status = 'active'
      ) AS goal_checkin_available
    FROM s
  )
  SELECT g.id, g.enrollment_id, g.session_status,
    g.has_prep_file, g.has_mentee_reflection, g.has_mentor_notes, g.has_mentor_feedback,
    g.has_goal_checkin, g.action_count, g.goal_checkin_available,
    -- Reporting only. Nothing downstream reads this to decide a unit.
    (g.has_mentee_reflection AND g.has_mentor_feedback
      AND (NOT g.goal_checkin_available OR g.has_goal_checkin)) AS evidence_complete
  FROM gates g;
$$;

REVOKE ALL ON FUNCTION public.mentoring_session_evidence(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mentoring_session_evidence(uuid) TO authenticated;

COMMENT ON FUNCTION public.mentoring_session_evidence(uuid) IS
  'After-session evidence completeness for one Mentoring session. REPORTING '
  'ONLY: it returns no unit or progress field, and nothing reads it to decide '
  'programme completion. The preparation document is reported, never required.';

-- ---------------------------------------------------------------------------
-- 7. Retire the remaining preparation-document gate
-- ---------------------------------------------------------------------------
--
-- 20260920210000 dropped the two triggers. The functions themselves are
-- retired here so no future trigger can attach them again by accident.

DROP FUNCTION IF EXISTS public.enforce_mentoring_prep_file_before_completion() CASCADE;
DROP FUNCTION IF EXISTS public.enforce_mentoring_feedback_requires_prep_file() CASCADE;

-- ---------------------------------------------------------------------------
-- 8. Verification
-- ---------------------------------------------------------------------------

DO $$
DECLARE n bigint;
BEGIN
  -- The lifecycle guard is attached.
  SELECT count(*) INTO n FROM pg_trigger t
  JOIN pg_class c ON c.oid = t.tgrelid
  WHERE c.relname = 'mentoring_sessions' AND NOT t.tgisinternal
    AND t.tgname = 'mentoring_sessions_protected_fields';
  IF n <> 1 THEN
    RAISE EXCEPTION 'Mentoring lifecycle: protected-field trigger is not attached';
  END IF;

  -- The all-status slot index is gone and the live-only one is in place.
  IF to_regclass('public.mentoring_sessions_slot_id_unique') IS NOT NULL THEN
    RAISE EXCEPTION 'Mentoring lifecycle: the all-status slot index still exists';
  END IF;
  IF to_regclass('public.mentoring_sessions_one_live_session_per_slot') IS NULL THEN
    RAISE EXCEPTION 'Mentoring lifecycle: the live-session slot index is missing';
  END IF;

  -- No preparation-document gate survives anywhere.
  SELECT count(*) INTO n FROM pg_proc p
  JOIN pg_namespace ns ON ns.oid = p.pronamespace AND ns.nspname = 'public'
  WHERE p.proname IN ('enforce_mentoring_prep_file_before_completion',
                      'enforce_mentoring_feedback_requires_prep_file');
  IF n > 0 THEN
    RAISE EXCEPTION 'Mentoring lifecycle: a preparation-document gate still exists';
  END IF;

  -- The internal booking function is not reachable from PostgREST.
  IF has_function_privilege('authenticated',
       'public.book_mentoring_session_internal(uuid, uuid, uuid, text, uuid, timestamptz, integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Mentoring lifecycle: the internal booking function is client-callable';
  END IF;
END $$;
