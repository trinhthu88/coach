-- ===========================================================================
-- Session write lockdown (RULES_AUDIT.md, findings P-1, D-2, D-3, L-14, P-8)
--
--   1. No client role inserts into sessions, mentoring_sessions, peer_sessions
--      or coachee_peer_sessions. Every booking already has a SECURITY DEFINER
--      RPC that always creates pending_coach_approval; a direct INSERT let a
--      learner write a session already 'completed', and in the past, which
--      counted as a fulfilled unit. UPDATE stays granted: notes, meeting
--      links, the mentoring prep file and the Admin edit still write rows, and
--      guard_session_protected_fields() owns which columns they may touch.
--   2. The Coaching branch of transition_session_status() only confirms, and
--      only for the session's Coach or an Admin. The learner could confirm
--      their own request and complete their own session. Completion belongs to
--      complete_coaching_session(), cancellation to cancel_coaching_session().
--   3. sessions.cohort_requirement_id and cohort_id join the protected fields:
--      which requirement a Coaching session fulfils is decided at booking and
--      by reschedule_coaching_session(), never by an UPDATE from the app.
--   4. Peer and Triad sessions cannot be booked, scheduled or re-timed into
--      the past. A backdated session, completed straight away, fulfilled a
--      requirement without the meeting ever being arranged.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. No direct session INSERT from the API
-- ---------------------------------------------------------------------------
REVOKE INSERT ON public.sessions, public.mentoring_sessions, public.peer_sessions,
  public.coachee_peer_sessions FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2 + 3. Protected fields and the Coaching transition
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guard_session_protected_fields()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE u uuid := auth.uid();
BEGIN
  IF u IS NULL OR public.has_role(u, 'admin'::public.app_role) THEN RETURN NEW; END IF;
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

CREATE OR REPLACE FUNCTION public.transition_session_status(p_session_id uuid, p_kind text, p_action text, p_reason text DEFAULT NULL::text)
 RETURNS session_status
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE r record; u uuid := auth.uid(); next_status public.session_status;
BEGIN
  IF u IS NULL OR p_kind NOT IN ('coaching','peer','coachee_peer')
     OR p_action NOT IN ('confirm','cancel','complete') THEN RAISE EXCEPTION 'Invalid session transition' USING ERRCODE='42501'; END IF;

  -- Peer delegates, whole and entire: authorisation, permitted transitions,
  -- the no-artefact-gate completion rule and the requirement release all live
  -- in one place for both Peer tables.
  IF p_kind IN ('peer', 'coachee_peer') THEN
    PERFORM public.transition_peer_session_status(
      p_kind, p_session_id,
      CASE p_action WHEN 'confirm' THEN 'confirmed'
                    WHEN 'complete' THEN 'completed'
                    ELSE 'cancelled' END,
      p_reason);
    IF p_kind = 'peer' THEN
      SELECT s.status INTO next_status FROM public.peer_sessions s WHERE s.id = p_session_id;
    ELSE
      SELECT s.status INTO next_status FROM public.coachee_peer_sessions s WHERE s.id = p_session_id;
    END IF;
    RETURN next_status;
  END IF;

  -- Coaching: this path only CONFIRMS, and only for the session's Coach or an
  -- Admin. Completion is complete_coaching_session() (the Coach marks it
  -- held); cancellation is cancel_coaching_session() (it releases the slot
  -- and the requirement).
  IF p_action <> 'confirm' THEN
    RAISE EXCEPTION 'Coaching sessions are completed with complete_coaching_session and cancelled with cancel_coaching_session'
      USING ERRCODE='42501';
  END IF;
  SELECT * INTO r FROM public.sessions WHERE id = p_session_id;
  IF r IS NULL OR NOT (public.has_role(u,'admin'::public.app_role) OR u = r.coach_id) THEN
    RAISE EXCEPTION 'Only the assigned Coach or an Admin may confirm a Coaching session' USING ERRCODE='42501';
  END IF;
  IF r.status <> 'pending_coach_approval' THEN
    RAISE EXCEPTION 'Session transition is not permitted' USING ERRCODE='42501';
  END IF;
  next_status := 'confirmed';
  PERFORM set_config('app.session_transition', 'on', true);
  UPDATE public.sessions SET status = next_status, confirmed_at = now() WHERE id = p_session_id;
  RETURN next_status;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 4. No Peer or Triad session in the past
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.book_peer_session(p_peer_coach_id uuid, p_enrollment_id uuid, p_topic text, p_start_time timestamp with time zone, p_duration_minutes integer, p_slot_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE booked_id uuid;
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
  INSERT INTO public.coachee_peer_sessions
    (peer_provider_id,peer_receiver_id,enrollment_id,topic,start_time,duration_minutes,status,slot_id)
  VALUES (p_provider_id,auth.uid(),p_enrollment_id,p_topic,p_start_time,p_duration_minutes,
          'pending_coach_approval'::public.session_status,p_slot_id)
  RETURNING id INTO booked_id;
  RETURN booked_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.learner_triad_schedule_session(p_group_id uuid, p_start timestamp with time zone, p_end timestamp with time zone)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
  IF p_start < now() THEN
    RAISE EXCEPTION 'A session cannot be booked in the past' USING ERRCODE = '22023';
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
END $function$;

CREATE OR REPLACE FUNCTION public.learner_triad_propose_alternative(p_session_id uuid, p_start timestamp with time zone, p_end timestamp with time zone)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
  IF p_start < now() THEN
    RAISE EXCEPTION 'A session cannot be booked in the past' USING ERRCODE = '22023';
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
END $function$;

-- A proposal made for the future can still go stale before the last member
-- accepts it; it must not move the session into the past.
CREATE OR REPLACE FUNCTION public.triad_accept_proposal_if_unanimous(p_proposal_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE p public.triad_alternative_proposals; s public.triad_sessions;
BEGIN
  SELECT * INTO p FROM public.triad_alternative_proposals WHERE id = p_proposal_id FOR UPDATE;
  IF NOT FOUND OR p.status <> 'pending' THEN RETURN; END IF;
  SELECT * INTO s FROM public.triad_sessions WHERE id = p.triad_session_id FOR UPDATE;
  IF s.status NOT IN ('proposed', 'confirmed') THEN RETURN; END IF;
  IF EXISTS (
    SELECT 1 FROM public.triad_group_members m
    LEFT JOIN public.triad_alternative_proposal_responses r ON r.proposal_id = p.id AND r.enrollment_id = m.enrollment_id
    WHERE m.triad_group_id = s.triad_group_id AND r.response IS DISTINCT FROM 'accepted'
  ) THEN
    RETURN;
  END IF;
  IF p.proposed_start_time < now() THEN
    RAISE EXCEPTION 'A session cannot be booked in the past' USING ERRCODE = '22023';
  END IF;

  UPDATE public.triad_alternative_proposals SET status = 'accepted' WHERE id = p.id;
  UPDATE public.triad_alternative_proposals SET status = 'superseded'
  WHERE triad_session_id = s.id AND id <> p.id AND status = 'pending';
  UPDATE public.triad_sessions
  SET scheduled_start_time = p.proposed_start_time,
      scheduled_end_time = p.proposed_end_time
  WHERE id = s.id;
  INSERT INTO public.triad_session_responses (triad_session_id, enrollment_id, response, responded_at)
  SELECT s.id, m.enrollment_id, 'accepted', now()
  FROM public.triad_group_members m WHERE m.triad_group_id = s.triad_group_id
  ON CONFLICT (triad_session_id, enrollment_id) DO UPDATE SET response = 'accepted', responded_at = now();
  PERFORM public.triad_confirm_session_if_accepted(s.id);
END $function$;

CREATE OR REPLACE FUNCTION public.triad_create_group_internal(p_cohort_requirement_date_id uuid, p_enrollment_ids uuid[], p_group_language text, p_assigned_by text, p_start timestamp with time zone DEFAULT NULL::timestamp with time zone, p_end timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  req public.cohort_requirement_dates;
  group_id uuid;
  session_id uuid;
  n integer := coalesce(array_length(p_enrollment_ids, 1), 0);
BEGIN
  SELECT * INTO req FROM public.cohort_requirement_dates
  WHERE id = p_cohort_requirement_date_id AND module = 'triads'::public.programme_module_type;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Triad requirement not found' USING ERRCODE = 'P0002';
  END IF;
  IF n NOT BETWEEN 2 AND 3 OR (SELECT count(DISTINCT x) FROM unnest(p_enrollment_ids) x) <> n THEN
    RAISE EXCEPTION 'A Triad group needs 2 or 3 different learners' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(p_enrollment_ids) x
    LEFT JOIN public.programme_enrollments e ON e.id = x
    WHERE e.id IS NULL OR e.cohort_id IS DISTINCT FROM req.cohort_id OR e.programme_id IS DISTINCT FROM req.programme_id
       OR e.status NOT IN ('active', 'at_risk', 'paused')
  ) THEN
    RAISE EXCEPTION 'Triad members must be ongoing enrollments of this requirement''s cohort' USING ERRCODE = '42501';
  END IF;
  IF p_assigned_by NOT IN ('auto', 'admin') OR p_group_language NOT IN ('vi', 'en') THEN
    RAISE EXCEPTION 'Invalid assignment source or language' USING ERRCODE = '22023';
  END IF;
  IF (p_start IS NULL) <> (p_end IS NULL) OR p_end <= p_start THEN
    RAISE EXCEPTION 'A proposed time needs a start before its end' USING ERRCODE = '22023';
  END IF;
  IF p_start < now() THEN
    RAISE EXCEPTION 'A session cannot be booked in the past' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.triad_groups (cohort_requirement_date_id, assigned_by, group_language)
  VALUES (p_cohort_requirement_date_id, p_assigned_by, p_group_language)
  RETURNING id INTO group_id;
  INSERT INTO public.triad_group_members (triad_group_id, enrollment_id, member_order)
  SELECT group_id, x.enrollment_id, x.ord FROM unnest(p_enrollment_ids) WITH ORDINALITY AS x(enrollment_id, ord);
  IF p_start IS NOT NULL THEN
    INSERT INTO public.triad_sessions (triad_group_id, scheduled_start_time, scheduled_end_time, status)
    VALUES (group_id, p_start, p_end, 'proposed')
    RETURNING id INTO session_id;
    INSERT INTO public.triad_session_responses (triad_session_id, enrollment_id)
    SELECT session_id, m.enrollment_id FROM public.triad_group_members m WHERE m.triad_group_id = group_id;
  END IF;
  RETURN group_id;
END $function$;
