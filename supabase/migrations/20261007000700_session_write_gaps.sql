-- ===========================================================================
-- Session write gaps (Prompt 12: B5-B7, P-1 leftovers)
--
--   1. book_peer_session validates p_slot_id: it exists, belongs to the peer
--      Coach, is a Peer slot, is not booked, and the booked time lies inside
--      it (the Coaching / Mentoring rule; the booking page offers starts
--      every 15 minutes inside a slot). Until now any id was accepted -- and
--      delete_booked_availability_slot() deletes the slot a Peer booking
--      carries, whoever's it was.
--   2. slot_id is a protected field on sessions, mentoring_sessions,
--      peer_sessions and coachee_peer_sessions; so is the mentoring prep
--      file, now written only by learner_submit_mentoring_prep_file (8).
--   3. sync_coaching_slot_reservation / sync_mentoring_slot_reservation hold
--      only a slot of the session's own Coach / Mentor.
--   4. No DELETE on the four session tables, no INSERT / UPDATE / DELETE on
--      triad_sessions, and no TRUNCATE on any of the five (TRUNCATE skips
--      RLS) for the client roles. Every write is a definer function.
--   5. The "admin manage" policies on the five tables read only.
--   6. guard_coach_profile_protected_fields covers is_featured and
--      last_approved_at, and runs BEFORE INSERT OR UPDATE: a Coach cannot
--      create their own profile already approved or featured.
--   7. The *_without_requirement() orphan diagnostics are not client-callable.
--   8. learner_submit_mentoring_prep_file records the prep file, stamped
--      with now() instead of the browser's clock.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. book_peer_session: the slot is the peer Coach's free Peer slot
-- ---------------------------------------------------------------------------
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
  INSERT INTO public.peer_sessions
    (peer_coach_id,peer_coachee_id,enrollment_id,topic,start_time,duration_minutes,status,slot_id)
  VALUES
    (p_peer_coach_id,auth.uid(),p_enrollment_id,p_topic,p_start_time,
     p_duration_minutes,'pending_coach_approval'::public.session_status,p_slot_id)
  RETURNING id INTO booked_id;
  RETURN booked_id;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 2. Protected fields: slot_id everywhere, the prep file on Mentoring
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
    -- at booking (and moved only by reschedule_coaching_session()), and so is
    -- the slot it holds.
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.enrollment_id IS DISTINCT FROM OLD.enrollment_id
       OR NEW.cohort_requirement_id IS DISTINCT FROM OLD.cohort_requirement_id
       OR NEW.cohort_id IS DISTINCT FROM OLD.cohort_id OR NEW.slot_id IS DISTINCT FROM OLD.slot_id
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
    -- the appointment and its slot, every lifecycle stamp and the prep file
    -- (learner_submit_mentoring_prep_file, stamped by the server) belong to
    -- the lifecycle service. Notes belong to their author.
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.enrollment_id IS DISTINCT FROM OLD.enrollment_id
       OR NEW.cohort_requirement_id IS DISTINCT FROM OLD.cohort_requirement_id
       OR NEW.cohort_id IS DISTINCT FROM OLD.cohort_id OR NEW.slot_id IS DISTINCT FROM OLD.slot_id
       OR NEW.mentor_id IS DISTINCT FROM OLD.mentor_id OR NEW.mentee_id IS DISTINCT FROM OLD.mentee_id
       OR NEW.topic IS DISTINCT FROM OLD.topic OR NEW.start_time IS DISTINCT FROM OLD.start_time
       OR NEW.duration_minutes IS DISTINCT FROM OLD.duration_minutes OR NEW.status IS DISTINCT FROM OLD.status
       OR NEW.cancelled_at IS DISTINCT FROM OLD.cancelled_at OR NEW.cancelled_by IS DISTINCT FROM OLD.cancelled_by
       OR NEW.cancel_reason IS DISTINCT FROM OLD.cancel_reason OR NEW.confirmed_at IS DISTINCT FROM OLD.confirmed_at
       OR NEW.action_items IS DISTINCT FROM OLD.action_items
       OR NEW.prep_file_path IS DISTINCT FROM OLD.prep_file_path
       OR NEW.prep_file_notes IS DISTINCT FROM OLD.prep_file_notes
       OR NEW.prep_file_submitted_at IS DISTINCT FROM OLD.prep_file_submitted_at
       OR (u <> OLD.mentor_id AND NEW.meeting_url IS DISTINCT FROM OLD.meeting_url)
       OR (u <> OLD.mentor_id AND NEW.mentor_notes IS DISTINCT FROM OLD.mentor_notes)
       OR (u <> OLD.mentee_id AND NEW.mentee_notes IS DISTINCT FROM OLD.mentee_notes) THEN
      RAISE EXCEPTION 'Mentoring session protected fields may only be changed by the lifecycle service' USING ERRCODE='42501';
    END IF;
  ELSIF TG_TABLE_NAME = 'peer_sessions' THEN
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.enrollment_id IS DISTINCT FROM OLD.enrollment_id
       OR NEW.slot_id IS DISTINCT FROM OLD.slot_id
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
       OR NEW.slot_id IS DISTINCT FROM OLD.slot_id
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
-- 3. Slot reservation: only the session's own Coach's / Mentor's slot
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_coaching_slot_reservation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_live constant text[] := ARRAY['pending_coach_approval', 'confirmed'];
  v_owner uuid;
BEGIN
  -- A session takes a slot only of its own Coach (checked whenever it gets
  -- one: at insert or when the slot changes).
  IF NEW.slot_id IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.slot_id IS DISTINCT FROM OLD.slot_id) THEN
    SELECT ca.coach_id INTO v_owner FROM public.coach_availability ca WHERE ca.id = NEW.slot_id;
    IF FOUND AND v_owner IS DISTINCT FROM NEW.coach_id THEN
      RAISE EXCEPTION 'Availability slot belongs to a different Coach' USING ERRCODE = '42501';
    END IF;
  END IF;

  -- Release the previously held slot when the session stops being live or
  -- moves to a different slot.
  IF TG_OP = 'UPDATE' AND OLD.slot_id IS NOT NULL
     AND (NEW.slot_id IS DISTINCT FROM OLD.slot_id OR NOT (NEW.status::text = ANY(v_live))) THEN
    UPDATE public.coach_availability
      SET is_booked = false, session_id = NULL
      WHERE id = OLD.slot_id AND session_id = OLD.id;
  END IF;

  -- Reserve the current slot while the session is live. Reservation happens at
  -- pending_coach_approval, not at confirmation: the slot is unavailable to
  -- everyone else the moment the request exists.
  IF NEW.slot_id IS NOT NULL AND NEW.status::text = ANY(v_live) THEN
    UPDATE public.coach_availability
      SET is_booked = true, session_id = NEW.id
      WHERE id = NEW.slot_id AND coach_id = NEW.coach_id;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.sync_mentoring_slot_reservation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_live constant text[] := ARRAY['pending_coach_approval', 'confirmed'];
  v_owner uuid;
BEGIN
  IF NEW.slot_id IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.slot_id IS DISTINCT FROM OLD.slot_id) THEN
    SELECT ca.coach_id INTO v_owner FROM public.coach_availability ca WHERE ca.id = NEW.slot_id;
    IF FOUND AND v_owner IS DISTINCT FROM NEW.mentor_id THEN
      RAISE EXCEPTION 'Availability slot belongs to a different Mentor' USING ERRCODE = '42501';
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.slot_id IS NOT NULL
     AND (NEW.slot_id IS DISTINCT FROM OLD.slot_id OR NOT (NEW.status::text = ANY(v_live))) THEN
    UPDATE public.coach_availability
      SET is_booked = false, session_id = NULL
      WHERE id = OLD.slot_id AND session_id = OLD.id;
  END IF;

  IF NEW.slot_id IS NOT NULL AND NEW.status::text = ANY(v_live) THEN
    UPDATE public.coach_availability
      SET is_booked = true, session_id = NEW.id
      WHERE id = NEW.slot_id AND coach_id = NEW.mentor_id;
  END IF;

  RETURN NEW;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 4 + 5. Grants and the "admin manage" policies
-- ---------------------------------------------------------------------------
REVOKE DELETE, TRUNCATE ON public.sessions, public.mentoring_sessions, public.peer_sessions, public.coachee_peer_sessions
  FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.triad_sessions FROM anon, authenticated;

DROP POLICY IF EXISTS "Sessions: admin manage" ON public.sessions;
CREATE POLICY "Sessions: admin manage" ON public.sessions FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));
DROP POLICY IF EXISTS "MentoringSessions: admin manage" ON public.mentoring_sessions;
CREATE POLICY "MentoringSessions: admin manage" ON public.mentoring_sessions FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));
DROP POLICY IF EXISTS "Peer sessions: admin manage" ON public.peer_sessions;
CREATE POLICY "Peer sessions: admin manage" ON public.peer_sessions FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));
DROP POLICY IF EXISTS "CoacheePeerSessions: admin manage" ON public.coachee_peer_sessions;
CREATE POLICY "CoacheePeerSessions: admin manage" ON public.coachee_peer_sessions FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));
DROP POLICY IF EXISTS "Triad sessions: admin manage" ON public.triad_sessions;
CREATE POLICY "Triad sessions: admin manage" ON public.triad_sessions FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

-- ---------------------------------------------------------------------------
-- 6. coach_profiles: is_featured and last_approved_at; INSERT too
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guard_coach_profile_protected_fields()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF current_user NOT IN ('anon', 'authenticated') THEN RETURN NEW; END IF;
  IF public.has_role(auth.uid(), 'admin'::public.app_role) THEN RETURN NEW; END IF;
  -- A new profile starts from the column defaults: pending approval, no
  -- invite limit, the default rating, nothing completed, not featured, never
  -- approved.
  IF TG_OP = 'INSERT' THEN
    IF NEW.max_coachee_invites IS NOT NULL
       OR NEW.approval_status IS DISTINCT FROM 'pending_approval'::public.user_status
       OR NEW.rating_avg IS DISTINCT FROM 5.0
       OR NEW.sessions_completed IS DISTINCT FROM 0
       OR NEW.is_featured IS DISTINCT FROM false
       OR NEW.last_approved_at IS NOT NULL THEN
      RAISE EXCEPTION 'Only an administrator can set a Coach''s approval, invite limit, rating, completed sessions or featured status'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.max_coachee_invites IS DISTINCT FROM OLD.max_coachee_invites
     OR NEW.approval_status IS DISTINCT FROM OLD.approval_status
     OR NEW.rating_avg IS DISTINCT FROM OLD.rating_avg
     OR NEW.sessions_completed IS DISTINCT FROM OLD.sessions_completed
     OR NEW.is_featured IS DISTINCT FROM OLD.is_featured
     OR NEW.last_approved_at IS DISTINCT FROM OLD.last_approved_at THEN
    RAISE EXCEPTION 'Only an administrator can change a Coach''s approval, invite limit, rating, completed sessions or featured status'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$function$;
DROP TRIGGER IF EXISTS guard_coach_profile_protected_fields ON public.coach_profiles;
CREATE TRIGGER guard_coach_profile_protected_fields
  BEFORE INSERT OR UPDATE ON public.coach_profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_coach_profile_protected_fields();

-- ---------------------------------------------------------------------------
-- 7. The orphan diagnostics: trusted SQL and the service role only
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.coaching_sessions_without_requirement() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mentoring_sessions_without_requirement() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.peer_participants_without_requirement() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.coaching_sessions_without_requirement() TO service_role;
GRANT EXECUTE ON FUNCTION public.mentoring_sessions_without_requirement() TO service_role;
GRANT EXECUTE ON FUNCTION public.peer_participants_without_requirement() TO service_role;

-- ---------------------------------------------------------------------------
-- 8. The mentoring prep file
-- ---------------------------------------------------------------------------
-- The mentee records the file they uploaded to mentoring-prep-files under
-- {session_id}/; the server stamps the time.
CREATE OR REPLACE FUNCTION public.learner_submit_mentoring_prep_file(p_session_id uuid, p_path text, p_notes text DEFAULT NULL)
 RETURNS timestamptz
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.mentoring_sessions ms WHERE ms.id = p_session_id AND ms.mentee_id = auth.uid()) THEN
    RAISE EXCEPTION 'Only the mentee submits the preparation file' USING ERRCODE = '42501';
  END IF;
  IF p_path IS NULL OR (storage.foldername(p_path))[1] IS DISTINCT FROM p_session_id::text
     OR NOT EXISTS (SELECT 1 FROM storage.objects o
                    WHERE o.bucket_id = 'mentoring-prep-files' AND o.name = p_path AND o.owner_id = auth.uid()::text) THEN
    RAISE EXCEPTION 'Upload the preparation file for this session first' USING ERRCODE = '22023';
  END IF;
  PERFORM set_config('app.session_transition', 'on', true);
  UPDATE public.mentoring_sessions
     SET prep_file_path = p_path, prep_file_notes = nullif(btrim(p_notes), ''), prep_file_submitted_at = now()
   WHERE id = p_session_id;
  PERFORM set_config('app.session_transition', '', true);
  RETURN now();
END;
$function$;
REVOKE ALL ON FUNCTION public.learner_submit_mentoring_prep_file(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.learner_submit_mentoring_prep_file(uuid, text, text) TO authenticated, service_role;
