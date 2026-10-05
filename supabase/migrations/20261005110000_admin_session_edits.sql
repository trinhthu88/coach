-- ===========================================================================
-- Admin session edits (findings P-2, A-2)
--
--   1. guard_session_protected_fields() loses its Admin bypass. An Admin's
--      direct UPDATE could set any status, time, Coach, requirement or note,
--      skipping slot release, requirement checks and every lifecycle stamp.
--      Admins now change sessions through the same lifecycle functions as
--      everyone else, plus the two below.
--   2. session_admin_audit: one row per Admin reopen / reschedule, with the
--      reason, the actor, and the row before and after. Written only by those
--      functions; read by Admins.
--   3. admin_reschedule_session(): a live Coaching or coach-to-coach Peer
--      session moves to a new future time (optionally a new topic and meeting
--      link). The booking rules re-run against the new time.
--   4. admin_reopen_session(): cancelled -> pending_coach_approval (a future
--      start, the booking rules re-run); completed -> confirmed, so the unit
--      stops counting until the Coach completes it again.
--   5. confirm_peer_session(): the Peer counterpart of confirm_coaching_session,
--      so confirm-session can confirm and store the meeting link as the
--      caller instead of writing with the service role.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. No Admin bypass
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guard_session_protected_fields()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE u uuid := auth.uid();
BEGIN
  -- Trusted SQL (migrations, seeds, the service role) carries no user. Every
  -- user, Admins included, changes protected fields only through a lifecycle
  -- function, which raises app.session_transition.
  IF u IS NULL THEN RETURN NEW; END IF;
  IF current_setting('app.session_transition', true) = 'on' THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME = 'sessions' THEN
    -- The requirement and cohort a Coaching session is attributed to are set
    -- at booking (and moved only by reschedule_coaching_session()).
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.enrollment_id IS DISTINCT FROM OLD.enrollment_id
       OR NEW.cohort_requirement_id IS DISTINCT FROM OLD.cohort_requirement_id
       OR NEW.cohort_id IS DISTINCT FROM OLD.cohort_id
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
$function$;

-- ---------------------------------------------------------------------------
-- 2. Audit trail
-- ---------------------------------------------------------------------------
CREATE TABLE public.session_admin_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_kind text NOT NULL CHECK (session_kind IN ('coaching', 'peer')),
  session_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('reopen', 'reschedule')),
  reason text NOT NULL CHECK (length(btrim(reason)) > 0),
  -- No foreign keys: the trail outlives the session and the people on it.
  actor_id uuid NOT NULL,
  before_state jsonb NOT NULL,
  after_state jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX session_admin_audit_session_idx ON public.session_admin_audit (session_id, created_at);

ALTER TABLE public.session_admin_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.session_admin_audit FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.session_admin_audit TO authenticated;
CREATE POLICY "Session admin audit: admin read" ON public.session_admin_audit
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role));

-- ---------------------------------------------------------------------------
-- 3 + 4. Shared re-validation
-- ---------------------------------------------------------------------------
-- The booking rules, re-run for an existing session at a (new) time. For
-- Coaching these are book_coaching_session_internal()'s checks minus the slot:
-- an Admin may place a session outside published availability, so the slot's
-- exclusivity is replaced by a clash check against the Coach's other live
-- Coaching and Peer sessions. Peer's own rules (receiver enrollment, opt-in,
-- module, entitlement) re-run in validate_peer_session_enrollment() on the
-- UPDATE itself.
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
    SELECT s.peer_coach_id INTO v_coach FROM public.peer_sessions s WHERE s.id = p_session_id;
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

-- The audited columns of one session, as one JSON object.
CREATE OR REPLACE FUNCTION public.admin_session_state_internal(p_kind text, p_session_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT CASE p_kind
    WHEN 'coaching' THEN (
      SELECT jsonb_build_object('status', s.status, 'start_time', s.start_time,
        'duration_minutes', s.duration_minutes, 'topic', s.topic, 'meeting_url', s.meeting_url,
        'slot_id', s.slot_id, 'cancelled_at', s.cancelled_at, 'cancelled_by', s.cancelled_by,
        'cancel_reason', s.cancel_reason)
      FROM public.sessions s WHERE s.id = p_session_id)
    ELSE (
      SELECT jsonb_build_object('status', s.status, 'start_time', s.start_time,
        'duration_minutes', s.duration_minutes, 'topic', s.topic, 'meeting_url', s.meeting_url,
        'cancelled_at', s.cancelled_at, 'cancelled_by', s.cancelled_by,
        'cancel_reason', s.cancel_reason)
      FROM public.peer_sessions s WHERE s.id = p_session_id)
  END;
$function$;
REVOKE ALL ON FUNCTION public.admin_session_state_internal(text, uuid) FROM PUBLIC, anon, authenticated;

-- Who may call, which kind, a reason, and the session row locked. Returns the
-- current status.
CREATE OR REPLACE FUNCTION public.admin_session_edit_preflight_internal(
  p_kind text, p_session_id uuid, p_reason text)
 RETURNS public.session_status
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_status public.session_status;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Only an Admin may edit a session this way' USING ERRCODE = '42501';
  END IF;
  IF p_kind NOT IN ('coaching', 'peer') THEN
    RAISE EXCEPTION 'Unknown session kind %', p_kind USING ERRCODE = '22023';
  END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'A reason is required' USING ERRCODE = '22023';
  END IF;
  IF p_kind = 'coaching' THEN
    SELECT s.status INTO v_status FROM public.sessions s WHERE s.id = p_session_id FOR UPDATE;
  ELSE
    SELECT s.status INTO v_status FROM public.peer_sessions s WHERE s.id = p_session_id FOR UPDATE;
  END IF;
  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Session % does not exist', p_session_id USING ERRCODE = '23503';
  END IF;
  RETURN v_status;
END;
$function$;
REVOKE ALL ON FUNCTION public.admin_session_edit_preflight_internal(text, uuid, text) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. admin_reschedule_session
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_reschedule_session(
  p_kind text, p_session_id uuid, p_start_time timestamptz, p_duration_minutes integer,
  p_reason text, p_topic text DEFAULT NULL, p_meeting_url text DEFAULT NULL)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_status public.session_status;
  v_before jsonb;
BEGIN
  v_status := public.admin_session_edit_preflight_internal(p_kind, p_session_id, p_reason);
  IF v_status NOT IN ('pending_coach_approval', 'confirmed') THEN
    RAISE EXCEPTION 'Only a live session can be rescheduled (status=%); reopen it first', v_status
      USING ERRCODE = '23514';
  END IF;
  PERFORM public.assert_admin_session_bookable_internal(p_kind, p_session_id, p_start_time, p_duration_minutes);

  v_before := public.admin_session_state_internal(p_kind, p_session_id);
  PERFORM set_config('app.session_transition', 'on', true);
  -- An empty topic keeps the current one; an empty link clears it.
  IF p_kind = 'coaching' THEN
    UPDATE public.sessions
       SET start_time = p_start_time,
           duration_minutes = p_duration_minutes,
           topic = coalesce(nullif(btrim(p_topic), ''), topic),
           meeting_url = CASE WHEN p_meeting_url IS NULL THEN meeting_url ELSE nullif(btrim(p_meeting_url), '') END,
           -- A session moved off its published slot no longer holds it;
           -- sync_coaching_slot_reservation() releases the slot.
           slot_id = CASE WHEN start_time = p_start_time AND duration_minutes = p_duration_minutes
                          THEN slot_id END
     WHERE id = p_session_id;
  ELSE
    UPDATE public.peer_sessions
       SET start_time = p_start_time,
           duration_minutes = p_duration_minutes,
           topic = coalesce(nullif(btrim(p_topic), ''), topic),
           meeting_url = CASE WHEN p_meeting_url IS NULL THEN meeting_url ELSE nullif(btrim(p_meeting_url), '') END
     WHERE id = p_session_id;
  END IF;

  INSERT INTO public.session_admin_audit (session_kind, session_id, action, reason, actor_id, before_state, after_state)
  VALUES (p_kind, p_session_id, 'reschedule', btrim(p_reason), auth.uid(), v_before,
          public.admin_session_state_internal(p_kind, p_session_id));
  RETURN p_session_id;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 4. admin_reopen_session
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_reopen_session(
  p_kind text, p_session_id uuid, p_reason text,
  p_start_time timestamptz DEFAULT NULL, p_duration_minutes integer DEFAULT NULL)
 RETURNS public.session_status
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_status public.session_status;
  v_before jsonb;
  v_next public.session_status;
  v_start timestamptz;
  v_duration integer;
BEGIN
  v_status := public.admin_session_edit_preflight_internal(p_kind, p_session_id, p_reason);
  v_before := public.admin_session_state_internal(p_kind, p_session_id);
  v_start := coalesce(p_start_time, (v_before->>'start_time')::timestamptz);
  v_duration := coalesce(p_duration_minutes, (v_before->>'duration_minutes')::integer);

  IF v_status = 'cancelled' THEN
    -- Back to a request the Coach accepts again, at a future time, against
    -- the same booking rules as a new booking.
    v_next := 'pending_coach_approval';
    PERFORM public.assert_admin_session_bookable_internal(p_kind, p_session_id, v_start, v_duration);
  ELSIF v_status = 'completed' THEN
    -- The session was recorded as held when it was not. It returns to
    -- confirmed at its own time; the unit stops counting until the Coach
    -- completes it again.
    IF p_start_time IS NOT NULL OR p_duration_minutes IS NOT NULL THEN
      RAISE EXCEPTION 'A completed session is reopened at its own time' USING ERRCODE = '22023';
    END IF;
    v_next := 'confirmed';
  ELSE
    RAISE EXCEPTION 'Only a cancelled or completed session can be reopened (status=%)', v_status
      USING ERRCODE = '23514';
  END IF;

  PERFORM set_config('app.session_transition', 'on', true);
  IF p_kind = 'coaching' THEN
    UPDATE public.sessions
       SET status = v_next,
           start_time = v_start,
           duration_minutes = v_duration,
           cancelled_at = NULL, cancelled_by = NULL, cancel_reason = NULL,
           confirmed_at = CASE WHEN v_next = 'pending_coach_approval' THEN NULL ELSE confirmed_at END,
           -- The slot was released at cancellation and may since be someone
           -- else's; a reopened request holds no slot.
           slot_id = CASE WHEN v_next = 'pending_coach_approval' THEN NULL ELSE slot_id END
     WHERE id = p_session_id;
  ELSE
    UPDATE public.peer_sessions
       SET status = v_next,
           start_time = v_start,
           duration_minutes = v_duration,
           cancelled_at = NULL, cancelled_by = NULL, cancel_reason = NULL,
           confirmed_at = CASE WHEN v_next = 'pending_coach_approval' THEN NULL ELSE confirmed_at END
     WHERE id = p_session_id;
  END IF;

  INSERT INTO public.session_admin_audit (session_kind, session_id, action, reason, actor_id, before_state, after_state)
  VALUES (p_kind, p_session_id, 'reopen', btrim(p_reason), auth.uid(), v_before,
          public.admin_session_state_internal(p_kind, p_session_id));
  RETURN v_next;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_reschedule_session(text, uuid, timestamptz, integer, text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_reopen_session(text, uuid, text, timestamptz, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_reschedule_session(text, uuid, timestamptz, integer, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_reopen_session(text, uuid, text, timestamptz, integer) TO authenticated;

-- ---------------------------------------------------------------------------
-- 5. confirm_peer_session
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.confirm_peer_session(p_session_id uuid, p_meeting_url text DEFAULT NULL)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  -- Authorisation (the provider or an Admin) and the pending -> confirmed
  -- rule live in transition_peer_session_status().
  PERFORM public.transition_peer_session_status('peer', p_session_id, 'confirmed', NULL);
  IF p_meeting_url IS NOT NULL THEN
    PERFORM set_config('app.session_transition', 'on', true);
    UPDATE public.peer_sessions SET meeting_url = p_meeting_url WHERE id = p_session_id;
  END IF;
  RETURN p_session_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.confirm_peer_session(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_peer_session(uuid, text) TO authenticated;
