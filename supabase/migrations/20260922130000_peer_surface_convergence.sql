-- Every Peer surface reads the same canonical rows (Peer canonical cutover,
-- phase 4).
--
-- Three defects, all of the same shape: a surface deciding for itself what a
-- Peer session is, instead of reading what the canonical model says.
--
-- 1. transition_session_status() -- the RPC the Sessions list and Session
--    Detail actually call -- gated Peer COMPLETION on an artefact:
--
--      peer          a peer_session_competency_feedback row must exist
--      coachee_peer  receiver_notes must be non-empty
--
--    So "the meeting happened" could not be recorded until somebody had
--    written up their feedback or their reflection. That is the conflation
--    Coaching removed in 20260921130000 and Mentoring in 20260921120000, still
--    live for Peer, and it is why a learner could sit on a session that plainly
--    took place with no way to say so.
--
--    The same function also refused ANY cancellation inside 24 hours. A
--    cut-off cannot make a session happen; it only leaves the record
--    disagreeing with reality, and -- now that a cancelled Peer session
--    releases its requirement -- it left the unit locked too.
--
-- 2. learner_session_history() rebuilt Peer from the raw tables, and did it
--    differently for each side. The RECEIVED side joined on the enrollment;
--    the GIVEN side joined on the USER and then guessed at scope with
--    "the session's enrollment is somewhere in my cohort". That guess is
--    wrong twice over now: a learner's historical enrollment leaks sessions
--    into their current one, and a legitimate CROSS-COHORT session is invisible
--    to the provider, because the receiver's enrollment is in another cohort.
--
-- 3. Peer rows came back with no requirement, so the learner's own history
--    could not say which unit a session was, while Sponsor views could.
--
-- All three go away by reading peer_session_participants, which already knows
-- -- per person, per session -- the enrollment and the requirement.

-- ---------------------------------------------------------------------------
-- 1. One Peer lifecycle writer, reachable from every caller
-- ---------------------------------------------------------------------------
--
-- transition_peer_session_status() is the canonical writer. Rather than leave
-- the legacy generic function beside it as a second opinion, its Peer branches
-- now DELEGATE. Any caller that has not migrated still gets the canonical
-- rules, and there is no path left to the artefact gate.
--
-- Coaching is untouched: it has its own canonical writers
-- (complete_coaching_session, cancel_coaching_session), and this function is
-- still the confirm path for them.

CREATE OR REPLACE FUNCTION public.transition_session_status(
  p_session_id uuid,
  p_kind text,
  p_action text,
  p_reason text DEFAULT NULL::text
)
RETURNS public.session_status
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

  EXECUTE format('SELECT * FROM public.%I WHERE id=$1', 'sessions') INTO r USING p_session_id;
  IF r IS NULL OR public.has_role(u,'admin'::public.app_role) THEN
    IF r IS NULL THEN RAISE EXCEPTION 'Session not found or access denied' USING ERRCODE='42501'; END IF;
  ELSIF u <> r.coach_id AND u <> r.coachee_id THEN
    RAISE EXCEPTION 'Session not found or access denied' USING ERRCODE='42501';
  END IF;
  IF p_action='confirm' AND r.status='pending_coach_approval' THEN next_status := 'confirmed';
  ELSIF p_action='cancel' AND r.status IN ('pending_coach_approval','confirmed') AND r.start_time > now()+interval '24 hours' THEN next_status := 'cancelled';
  ELSIF p_action='complete' AND r.status='confirmed' AND r.start_time <= now()
    AND length(trim(coalesce(r.coachee_notes,'')))>0 THEN next_status := 'completed';
  ELSE RAISE EXCEPTION 'Session transition is not permitted' USING ERRCODE='42501'; END IF;
  PERFORM set_config('app.session_transition', 'on', true);
  UPDATE public.sessions
     SET status=next_status,
         confirmed_at=CASE WHEN next_status='confirmed' THEN now() ELSE confirmed_at END,
         cancelled_at=CASE WHEN next_status='cancelled' THEN now() ELSE cancelled_at END,
         cancelled_by=CASE WHEN next_status='cancelled' THEN u ELSE cancelled_by END,
         cancel_reason=CASE WHEN next_status='cancelled' THEN p_reason ELSE cancel_reason END
   WHERE id=p_session_id;
  RETURN next_status;
END;
$function$;

COMMENT ON FUNCTION public.transition_session_status(uuid, text, text, text) IS
  'Legacy generic session transition. Its Peer branches delegate to '
  'transition_peer_session_status(), so Peer completion is never gated on '
  'feedback or a reflection and a late cancellation is recordable. The '
  'coaching branch is retained for the confirm path only.';

-- ---------------------------------------------------------------------------
-- 2. Learner Peer history comes from the participant rows
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.learner_session_history(p_enrollment_id uuid)
RETURNS TABLE(
  session_key text, session_type text, source_table text, source_id uuid,
  module programme_module_type, participant_role text, title text,
  start_time timestamp with time zone, status text, counterpart_names text[],
  attributed_to_enrollment boolean, is_programme_evidence boolean,
  requirement_unit_number integer)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH me AS (
    SELECT e.id AS enrollment_id, e.user_id, e.cohort_id
    FROM public.programme_enrollments e
    WHERE e.id = p_enrollment_id
      AND e.user_id = auth.uid()
      AND auth.uid() IS NOT NULL
  ), rows AS (
    SELECT 'coaching'::text AS session_type, 'sessions'::text AS source_table, s.id AS source_id,
      'coaching'::public.programme_module_type AS module, 'coachee'::text AS participant_role,
      s.topic AS title, s.start_time, s.status::text AS status,
      ARRAY[s.coach_id] AS counterpart_ids,
      s.cohort_requirement_id AS requirement_id
    FROM public.sessions s
    JOIN me ON s.enrollment_id = me.enrollment_id AND s.coachee_id = me.user_id

    UNION ALL
    -- Peer, BOTH sides and BOTH relationship tables, from the one canonical
    -- place that knows whose participation a session half is. The previous
    -- four hand-written branches resolved the given side by user and guessed
    -- its scope from the cohort; this resolves every side by ENROLLMENT, so a
    -- historical enrollment leaks nothing into a current one and a
    -- cross-cohort session is visible to both participants.
    SELECT 'peer_coaching',
      CASE p.session_kind WHEN 'peer' THEN 'peer_sessions' ELSE 'coachee_peer_sessions' END,
      p.peer_session_id, 'peer_coaching', p.participant_role,
      coalesce(ps.topic, cps.topic),
      coalesce(ps.start_time, cps.start_time),
      p.session_status::text,
      ARRAY[CASE
        WHEN p.session_kind = 'peer' THEN
          CASE WHEN p.participant_role = 'provider' THEN ps.peer_coachee_id ELSE ps.peer_coach_id END
        ELSE
          CASE WHEN p.participant_role = 'provider' THEN cps.peer_receiver_id ELSE cps.peer_provider_id END
      END],
      p.cohort_requirement_id
    FROM public.peer_session_participants p
    JOIN me ON p.enrollment_id = me.enrollment_id AND p.user_id = me.user_id
    LEFT JOIN public.peer_sessions ps
      ON p.session_kind = 'peer' AND ps.id = p.peer_session_id
    LEFT JOIN public.coachee_peer_sessions cps
      ON p.session_kind = 'coachee_peer' AND cps.id = p.peer_session_id

    UNION ALL
    SELECT 'mentoring', 'mentoring_sessions', ms.id, 'mentoring', 'mentee',
      ms.topic, ms.start_time, ms.status::text, ARRAY[ms.mentor_id],
      ms.cohort_requirement_id
    FROM public.mentoring_sessions ms
    JOIN me ON ms.enrollment_id = me.enrollment_id AND ms.mentee_id = me.user_id

    UNION ALL
    -- Triads: every member of the session's (historical) group owns the
    -- session (roles rotate, so there is no per-session role). The session
    -- is for its group's requirement ("Triad N"); no round, no week.
    SELECT 'triad', 'triad_sessions', ts.id, 'triads', 'participant',
      NULL::text, ts.scheduled_start_time, ts.status::text,
      coalesce(ARRAY(
        SELECT oe.user_id FROM public.triad_group_members om
        JOIN public.programme_enrollments oe ON oe.id = om.enrollment_id
        WHERE om.triad_group_id = ts.triad_group_id AND om.enrollment_id <> gm.enrollment_id
        ORDER BY om.member_order), ARRAY[]::uuid[]),
      g.cohort_requirement_date_id
    FROM public.triad_group_members gm
    JOIN me ON gm.enrollment_id = me.enrollment_id
    JOIN public.triad_groups g ON g.id = gm.triad_group_id
    JOIN public.triad_sessions ts ON ts.triad_group_id = gm.triad_group_id
  )
  SELECT
    r.session_type || ':' || r.source_table || ':' || r.source_id::text,
    r.session_type,
    r.source_table,
    r.source_id,
    r.module,
    r.participant_role,
    r.title,
    r.start_time,
    r.status,
    coalesce((
      SELECT array_agg(pr.full_name ORDER BY pr.full_name)
      FROM public.profiles pr
      WHERE pr.id = ANY (r.counterpart_ids)
    ), ARRAY[]::text[]),
    -- Raw attribution, kept as-is: it still answers "does this activity belong
    -- to my enrollment at all", which is a different question from fulfilment.
    EXISTS (
      SELECT 1 FROM public.session_activity_attributions a
      JOIN me ON a.enrollment_id = me.enrollment_id
      WHERE a.source_activity_id = r.source_id
    ),
    -- Programme evidence = canonical fulfilment. Peer joins the
    -- requirement-bound modules here: it has carried a requirement per
    -- participant since phase 1, so it no longer has to fall back to raw
    -- attribution, which could not tell a fulfilling session from extra
    -- activity beyond the required units.
    CASE
      WHEN r.source_table IN ('sessions', 'mentoring_sessions',
                              'peer_sessions', 'coachee_peer_sessions')
        THEN r.status = 'completed' AND r.requirement_id IS NOT NULL
      ELSE r.status = 'completed' AND EXISTS (
        SELECT 1 FROM public.session_activity_attributions a
        JOIN me ON a.enrollment_id = me.enrollment_id
        WHERE a.source_activity_id = r.source_id
      )
    END,
    (SELECT d.ordinal FROM public.cohort_requirement_dates d WHERE d.id = r.requirement_id)
  FROM rows r
  ORDER BY r.start_time DESC NULLS LAST;
$function$;

-- ---------------------------------------------------------------------------
-- 3. Peer narrative is not readable by anon at the grant level
-- ---------------------------------------------------------------------------
--
-- RLS already keeps anon out: every Peer policy is TO authenticated, so an
-- anonymous caller matches none of them. The GRANT is still the wrong shape,
-- and the platform's own contract test for Mentoring asserts the opposite
-- (mentoring_canonical_contract_test, "not readable by anon") -- correctly,
-- and it has been failing because no migration ever revoked it.
--
-- Peer is brought into line at the same time, so the two Peer relationship
-- tables, the participant rows and the narrative stores all agree: defence in
-- depth, not policy alone.
REVOKE ALL ON public.mentoring_sessions FROM anon;
REVOKE ALL ON public.peer_sessions FROM anon;
REVOKE ALL ON public.coachee_peer_sessions FROM anon;
GRANT SELECT, INSERT, UPDATE ON public.peer_sessions TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.coachee_peer_sessions TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.mentoring_sessions TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. Verification
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF pg_get_functiondef('public.transition_session_status(uuid,text,text,text)'::regprocedure)
       ~ 'peer_session_competency_feedback' THEN
    RAISE EXCEPTION 'Peer phase 4: Peer completion is still gated on feedback';
  END IF;
  IF pg_get_functiondef('public.learner_session_history(uuid)'::regprocedure)
       !~ 'peer_session_participants' THEN
    RAISE EXCEPTION 'Peer phase 4: learner history still rebuilds Peer from raw tables';
  END IF;
  IF has_table_privilege('anon', 'public.coachee_peer_sessions', 'SELECT') THEN
    RAISE EXCEPTION 'Peer phase 4: Peer sessions are still granted to anon';
  END IF;
  RAISE NOTICE 'Peer phase 4: surfaces converged on canonical participant rows';
END $$;
