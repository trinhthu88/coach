-- ===========================================================================
-- Sessions hub from the session history (Prompt 9b, finding L-13)
--
-- The Sessions hub labelled only Coaching rows with their requirement
-- ("Coaching 2"), through a per-enrollment fulfilment call, and had no answer
-- to "when is my next session" other than sorting rows in the browser.
--
--   1. canonical_session_history (and learner_ / admin_learner_session_history)
--      gain requirement_due_on: the due date of the requirement each session
--      holds, so the hub reads unit and due date for every module from one row.
--   2. learner_next_session_by_module(enrollment): the next live session per
--      module (pending, confirmed or proposed; starting now or later), from the
--      same history. Peer practice (the Coach opt-in pool) earns nothing and is
--      not a programme "next session".
-- ===========================================================================

DROP FUNCTION IF EXISTS public.admin_learner_session_history(uuid);
DROP FUNCTION IF EXISTS public.learner_session_history(uuid);
DROP FUNCTION IF EXISTS public.canonical_session_history(uuid);

CREATE OR REPLACE FUNCTION public.canonical_session_history(p_enrollment_id uuid)
 RETURNS TABLE(session_key text, session_type text, source_table text, source_id uuid, module programme_module_type, participant_role text, title text, start_time timestamp with time zone, status text, counterpart_names text[], attributed_to_enrollment boolean, is_programme_evidence boolean, requirement_unit_number integer, requirement_due_on date)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH me AS (
    SELECT e.id AS enrollment_id, e.user_id, e.cohort_id
    FROM public.programme_enrollments e
    WHERE e.id = p_enrollment_id
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
    (SELECT d.ordinal FROM public.cohort_requirement_dates d WHERE d.id = r.requirement_id),
    -- The due date of the requirement this session holds (20261006180000).
    (SELECT d.due_on FROM public.cohort_requirement_dates d WHERE d.id = r.requirement_id)
  FROM rows r
  ORDER BY r.start_time DESC NULLS LAST;
$function$;

REVOKE ALL ON FUNCTION public.canonical_session_history(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.canonical_session_history(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.learner_session_history(p_enrollment_id uuid)
 RETURNS TABLE(session_key text, session_type text, source_table text, source_id uuid, module programme_module_type, participant_role text, title text, start_time timestamp with time zone, status text, counterpart_names text[], attributed_to_enrollment boolean, is_programme_evidence boolean, requirement_unit_number integer, requirement_due_on date)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  -- Learner self-view: own enrollment only.
  SELECT h.*
  FROM public.programme_enrollments e
  CROSS JOIN LATERAL public.canonical_session_history(e.id) h
  WHERE e.id = p_enrollment_id
    AND e.user_id = auth.uid()
    AND auth.uid() IS NOT NULL
  ORDER BY h.start_time DESC NULLS LAST;
$function$;

REVOKE ALL ON FUNCTION public.learner_session_history(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.learner_session_history(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_learner_session_history(p_enrollment_id uuid)
 RETURNS TABLE(session_key text, session_type text, source_table text, source_id uuid, module programme_module_type, participant_role text, title text, start_time timestamp with time zone, status text, counterpart_names text[], attributed_to_enrollment boolean, is_programme_evidence boolean, requirement_unit_number integer, requirement_due_on date)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT h.*
  FROM public.canonical_session_history(p_enrollment_id) h
  WHERE public.has_role(auth.uid(), 'admin'::public.app_role)
  ORDER BY h.start_time DESC NULLS LAST;
$function$;

REVOKE ALL ON FUNCTION public.admin_learner_session_history(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_learner_session_history(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.learner_next_session_by_module(p_enrollment_id uuid)
 RETURNS TABLE(module public.programme_module_type, next_session_at timestamptz, session_key text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  -- Learner self-view: own enrollment only.
  SELECT DISTINCT ON (h.module) h.module, h.start_time, h.session_key
  FROM public.programme_enrollments e
  CROSS JOIN LATERAL public.canonical_session_history(e.id) h
  WHERE e.id = p_enrollment_id
    AND e.user_id = auth.uid()
    AND auth.uid() IS NOT NULL
    AND h.status IN ('pending_coach_approval', 'confirmed', 'proposed')
    AND h.start_time >= now()
    AND h.source_table <> 'peer_sessions'
  ORDER BY h.module, h.start_time;
$function$;
REVOKE ALL ON FUNCTION public.learner_next_session_by_module(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.learner_next_session_by_module(uuid) TO authenticated, service_role;
