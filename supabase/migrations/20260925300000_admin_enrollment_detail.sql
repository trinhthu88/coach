-- Admin user detail: one canonical section per enrollment.
--
-- The Admin coachee detail showed the CURRENT enrollment only (goals, the last
-- ten coaching sessions) and a flat history list, so an admin could not see a
-- past enrollment's modules, sessions, goals, actions, reflections, feedback
-- or satisfaction at all -- and nothing it did show came from the engines the
-- learner and the sponsor read.
--
-- Everything added here is a thin, admin-authorised projection of an engine
-- that already exists; no progress, overdue, goal or satisfaction logic is
-- re-implemented:
--
--   admin_user_enrollments(user)            programme_enrollments + canonical_enrollment_progress
--   admin_enrollment_module_progress(e)     canonical_module_progress (per-module overdue)
--   admin_enrollment_engagement(e)          canonical_enrollment_engagement
--   admin_enrollment_goals(e)               coachee_goals + canonical_goal_progress
--   admin_enrollment_goal_checkins(e)       goal_checkins (the goal rating history)
--   admin_enrollment_actions(e)             enrollment_actions
--   admin_learner_session_history(e)        canonical_session_history
--   admin_learner_reflection_feed(e)        canonical_reflection_feed (shared, non-private rows)
--
-- learner_session_history / learner_reflection_feed were self-scoped
-- (e.user_id = auth.uid()) with the whole body inline. Their bodies move,
-- verbatim except for that one predicate, into internal functions taking the
-- enrollment (revoked from clients); the learner functions keep their exact
-- signatures and return types and become self-scope wrappers, and the admin
-- wrappers call the same internal function. One definition, three callers.
--
-- Every admin wrapper is gated by public.has_role(auth.uid(), 'admin'): a
-- non-admin caller gets zero rows, never an error that leaks existence.

-- ---------------------------------------------------------------------------
-- 1. Session history: internal engine + learner (self) + admin wrappers
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.canonical_session_history(p_enrollment_id uuid)
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

REVOKE ALL ON FUNCTION public.canonical_session_history(uuid) FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION public.canonical_session_history(uuid) IS
  'INTERNAL -- every session (coaching, peer, mentoring, triad) belonging to one enrollment. Callers: learner_session_history (self), admin_learner_session_history (admin).';

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
GRANT EXECUTE ON FUNCTION public.learner_session_history(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_learner_session_history(p_enrollment_id uuid)
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
  SELECT h.*
  FROM public.canonical_session_history(p_enrollment_id) h
  WHERE public.has_role(auth.uid(), 'admin'::public.app_role)
  ORDER BY h.start_time DESC NULLS LAST;
$function$;

REVOKE ALL ON FUNCTION public.admin_learner_session_history(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_learner_session_history(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. Reflection feed: internal engine + learner (self) + admin wrappers
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.canonical_reflection_feed(
  p_enrollment_id uuid
)
RETURNS TABLE (
  reflection_key text,
  source_type text,
  source_table text,
  source_id uuid,
  module public.programme_module_type,
  occurred_at timestamptz,
  title text,
  body text,
  details jsonb,
  rating numeric,
  previous_rating numeric,
  linked_session_table text,
  linked_session_id uuid,
  linked_goal_id uuid,
  linked_activity_id uuid,
  is_private boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH me AS (
    SELECT e.id AS enrollment_id, e.user_id
    FROM public.programme_enrollments e
    WHERE e.id = p_enrollment_id
  ), feed AS (
    -- Coaching: the learner's own session reflection, from the canonical store.
    -- sessions.coachee_notes is no longer read here: it was a second place a
    -- Coaching reflection could live, so a learner who wrote one saw the other
    -- reported as missing. 20260921190000 copies every existing note into
    -- session_learning_reflections and this branch reads only that.
    SELECT 'coaching_session_reflection'::text AS source_type, 'sessions'::text AS source_table, s.id AS source_id,
      'coaching'::public.programme_module_type AS module, s.start_time AS occurred_at, s.topic AS title,
      btrim(r.body) AS body, NULL::jsonb AS details, NULL::numeric AS rating, NULL::numeric AS previous_rating,
      'sessions'::text AS linked_session_table, s.id AS linked_session_id, NULL::uuid AS linked_goal_id,
      s.id AS linked_activity_id, false AS is_private
    FROM public.sessions s
    JOIN me ON s.enrollment_id = me.enrollment_id AND s.coachee_id = me.user_id
    JOIN public.session_learning_reflections r
      ON r.enrollment_id = me.enrollment_id
     AND r.source_activity_type = 'coaching'
     AND r.source_activity_id = s.id
    WHERE nullif(btrim(r.body), '') IS NOT NULL

    UNION ALL
    SELECT 'coaching_session_rating', 'sessions', s.id, 'coaching', coalesce(s.coachee_rated_at, s.start_time), s.topic,
      btrim(s.coachee_rating_comment), NULL, s.coachee_rating, NULL,
      'sessions', s.id, NULL, s.id, false
    FROM public.sessions s
    JOIN me ON s.enrollment_id = me.enrollment_id AND s.coachee_id = me.user_id
    WHERE nullif(btrim(s.coachee_rating_comment), '') IS NOT NULL

    -- Peer practice (coachee-to-coachee): the receiver's own notes/comment.
    UNION ALL
    SELECT 'peer_session_reflection', 'coachee_peer_sessions', cps.id, 'peer_coaching', cps.start_time, cps.topic,
      btrim(cps.receiver_notes), NULL, NULL, NULL,
      'coachee_peer_sessions', cps.id, NULL, cps.id, false
    FROM public.coachee_peer_sessions cps
    JOIN me ON cps.enrollment_id = me.enrollment_id AND cps.peer_receiver_id = me.user_id
    WHERE nullif(btrim(cps.receiver_notes), '') IS NOT NULL

    UNION ALL
    SELECT 'peer_session_rating', 'coachee_peer_sessions', cps.id, 'peer_coaching', coalesce(cps.receiver_rated_at, cps.start_time), cps.topic,
      btrim(cps.receiver_rating_comment), NULL, cps.receiver_rating, NULL,
      'coachee_peer_sessions', cps.id, NULL, cps.id, false
    FROM public.coachee_peer_sessions cps
    JOIN me ON cps.enrollment_id = me.enrollment_id AND cps.peer_receiver_id = me.user_id
    WHERE nullif(btrim(cps.receiver_rating_comment), '') IS NOT NULL

    -- Peer coaching (coach-to-coach, when a coach is the enrolled learner).
    UNION ALL
    SELECT 'peer_session_reflection', 'peer_sessions', ps.id, 'peer_coaching', ps.start_time, ps.topic,
      btrim(ps.coachee_notes), NULL, NULL, NULL,
      'peer_sessions', ps.id, NULL, ps.id, false
    FROM public.peer_sessions ps
    JOIN me ON ps.enrollment_id = me.enrollment_id AND ps.peer_coachee_id = me.user_id
    WHERE nullif(btrim(ps.coachee_notes), '') IS NOT NULL

    UNION ALL
    SELECT 'peer_session_rating', 'peer_sessions', ps.id, 'peer_coaching', coalesce(ps.coachee_rated_at, ps.start_time), ps.topic,
      btrim(ps.coachee_rating_comment), NULL, ps.coachee_rating, NULL,
      'peer_sessions', ps.id, NULL, ps.id, false
    FROM public.peer_sessions ps
    JOIN me ON ps.enrollment_id = me.enrollment_id AND ps.peer_coachee_id = me.user_id
    WHERE nullif(btrim(ps.coachee_rating_comment), '') IS NOT NULL

    -- Mentoring: the mentee's own session notes.
    UNION ALL
    SELECT 'mentoring_session_reflection', 'mentoring_sessions', ms.id, 'mentoring', ms.start_time, ms.topic,
      btrim(ms.mentee_notes), NULL, NULL, NULL,
      'mentoring_sessions', ms.id, NULL, ms.id, false
    FROM public.mentoring_sessions ms
    JOIN me ON ms.enrollment_id = me.enrollment_id AND ms.mentee_id = me.user_id
    WHERE nullif(btrim(ms.mentee_notes), '') IS NOT NULL

    -- Triads: the learner's own post-session reflection answers (one
    -- submission per session and enrollment; answers per stable question).
    UNION ALL
    SELECT 'triad_reflection', 'triad_reflections', trf.id, 'triads', trf.submitted_at, NULL::text,
      ans.body,
      jsonb_strip_nulls(jsonb_build_object('answers', ans.answers,
        'session_start_time', ts.scheduled_start_time, 'triad_group_id', ts.triad_group_id,
        'requirement_unit', (SELECT d.ordinal FROM public.triad_groups g
                             JOIN public.cohort_requirement_dates d ON d.id = g.cohort_requirement_date_id
                             WHERE g.id = ts.triad_group_id))),
      trf.satisfaction_rating::numeric, NULL,
      'triad_sessions', trf.triad_session_id, NULL, trf.triad_session_id, false
    FROM public.triad_reflections trf
    JOIN me ON trf.enrollment_id = me.enrollment_id
    CROSS JOIN LATERAL (
      SELECT string_agg(btrim(a.answer_text), E'\n\n' ORDER BY q.display_order, q.id) AS body,
        jsonb_agg(jsonb_build_object(
          'question_id', q.id, 'question_key', q.question_key, 'section', q.section,
          'question', q.label, 'question_vi', q.label_vi, 'answer', btrim(a.answer_text))
          ORDER BY q.display_order, q.id) AS answers
      FROM public.triad_reflection_answers a
      JOIN public.triad_reflection_questions q ON q.id = a.question_id
      WHERE a.triad_reflection_id = trf.id AND nullif(btrim(a.answer_text), '') IS NOT NULL
    ) ans
    LEFT JOIN public.triad_sessions ts ON ts.id = trf.triad_session_id
    WHERE ans.body IS NOT NULL

    -- Goal check-ins the learner wrote, with their comment.
    UNION ALL
    SELECT 'goal_checkin', 'goal_checkins', gc.id, NULL, gc.created_at, g.title,
      btrim(gc.note), jsonb_build_object('source_activity_type', gc.source_activity_type),
      gc.new_rating::numeric, gc.previous_rating::numeric,
      CASE gc.source_activity_type
        WHEN 'coaching' THEN 'sessions'
        WHEN 'mentoring' THEN 'mentoring_sessions'
        WHEN 'peer_coaching' THEN (
          SELECT CASE WHEN EXISTS (SELECT 1 FROM public.coachee_peer_sessions x WHERE x.id = gc.source_activity_id)
            THEN 'coachee_peer_sessions' ELSE 'peer_sessions' END)
        WHEN 'triad' THEN 'triad_sessions'
        ELSE NULL
      END,
      CASE WHEN gc.source_activity_type IN ('coaching', 'mentoring', 'peer_coaching', 'triad') THEN gc.source_activity_id END,
      gc.goal_id, gc.source_activity_id, false
    FROM public.goal_checkins gc
    JOIN me ON gc.enrollment_id = me.enrollment_id AND gc.actor_user_id = me.user_id
    JOIN public.coachee_goals g ON g.id = gc.goal_id
    WHERE nullif(btrim(gc.note), '') IS NOT NULL

    -- Training / learning reflection prompt answers.
    UNION ALL
    SELECT 'training_reflection', 'reflection_submissions', rs.id, 'training', rs.submitted_at, pr.title,
      string_agg(btrim(ra.answer_text), E'\n\n' ORDER BY rq.sort_order, rq.id),
      jsonb_build_object(
        'answers', jsonb_agg(jsonb_build_object('question', rq.question_text, 'answer', btrim(ra.answer_text)) ORDER BY rq.sort_order, rq.id),
        'confidence_score', rs.confidence_score,
        'reflection_number', pr.reflection_number),
      NULL, NULL,
      NULL, NULL, NULL, rs.reflection_id, false
    FROM public.reflection_submissions rs
    JOIN me ON rs.enrollment_id = me.enrollment_id AND rs.user_id = me.user_id
    JOIN public.programme_reflections pr ON pr.id = rs.reflection_id
    JOIN public.reflection_answers ra ON ra.submission_id = rs.id
    JOIN public.reflection_questions rq ON rq.id = ra.question_id
    WHERE nullif(btrim(ra.answer_text), '') IS NOT NULL
    GROUP BY rs.id, rs.submitted_at, rs.confidence_score, rs.reflection_id, pr.title, pr.reflection_number

    UNION ALL
    SELECT 'quiz_reflection', 'assignment_submissions', asub.id, 'training', asub.submitted_at, a.title,
      btrim(asub.reflection_text), NULL, NULL, NULL,
      NULL, NULL, NULL, asub.assignment_id, false
    FROM public.assignment_submissions asub
    JOIN me ON asub.enrollment_id = me.enrollment_id AND asub.user_id = me.user_id
    JOIN public.assignments a ON a.id = asub.assignment_id
    WHERE nullif(btrim(asub.reflection_text), '') IS NOT NULL

    UNION ALL
    SELECT 'daily_prompt_response', 'daily_prompt_responses', dpr.id, 'training', coalesce(dpr.responded_at, dpr.created_at), dp.prompt_text,
      btrim(dpr.response_text), jsonb_strip_nulls(jsonb_build_object('confidence_score', dpr.confidence_score)), NULL, NULL,
      NULL, NULL, NULL, dpr.daily_prompt_id, false
    FROM public.daily_prompt_responses dpr
    JOIN me ON dpr.enrollment_id = me.enrollment_id AND dpr.user_id = me.user_id
    JOIN public.daily_prompts dp ON dp.id = dpr.daily_prompt_id
    WHERE nullif(btrim(dpr.response_text), '') IS NOT NULL

    -- Explicit My Journey reflections (private to the learner).
    UNION ALL
    SELECT 'journey_reflection', 'coachee_reflections', cr.id, NULL, cr.created_at, NULL,
      btrim(cr.body), jsonb_strip_nulls(jsonb_build_object('mood', nullif(btrim(cr.mood), ''))), NULL, NULL,
      NULL, NULL, NULL, NULL, true
    FROM public.coachee_reflections cr
    JOIN me ON cr.enrollment_id = me.enrollment_id AND cr.coachee_id = me.user_id
    WHERE nullif(btrim(cr.body), '') IS NOT NULL
  )
  SELECT f.source_type || ':' || f.source_id::text,
    f.source_type, f.source_table, f.source_id, f.module, f.occurred_at, f.title, f.body, f.details,
    f.rating, f.previous_rating, f.linked_session_table, f.linked_session_id, f.linked_goal_id,
    f.linked_activity_id, f.is_private
  FROM feed f
  ORDER BY f.occurred_at DESC NULLS LAST, f.source_type, f.source_id;
$$;

REVOKE ALL ON FUNCTION public.canonical_reflection_feed(uuid) FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION public.canonical_reflection_feed(uuid) IS
  'INTERNAL -- learner-authored reflections for one enrollment. Callers: learner_reflection_feed (self), admin_learner_reflection_feed (admin, non-private rows).';

CREATE OR REPLACE FUNCTION public.learner_reflection_feed(
  p_enrollment_id uuid
)
RETURNS TABLE (
  reflection_key text,
  source_type text,
  source_table text,
  source_id uuid,
  module public.programme_module_type,
  occurred_at timestamptz,
  title text,
  body text,
  details jsonb,
  rating numeric,
  previous_rating numeric,
  linked_session_table text,
  linked_session_id uuid,
  linked_goal_id uuid,
  linked_activity_id uuid,
  is_private boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  -- Learner self-view: own enrollment only (private rows included).
  SELECT f.*
  FROM public.programme_enrollments e
  CROSS JOIN LATERAL public.canonical_reflection_feed(e.id) f
  WHERE e.id = p_enrollment_id
    AND e.user_id = auth.uid()
    AND auth.uid() IS NOT NULL
  ORDER BY f.occurred_at DESC NULLS LAST, f.source_type, f.source_id;
$$;

REVOKE ALL ON FUNCTION public.learner_reflection_feed(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.learner_reflection_feed(uuid) TO authenticated;

-- Admin: the same feed minus the learner's private My Journey reflections
-- (is_private = "only you" in the learner UI).
CREATE OR REPLACE FUNCTION public.admin_learner_reflection_feed(
  p_enrollment_id uuid
)
RETURNS TABLE (
  reflection_key text,
  source_type text,
  source_table text,
  source_id uuid,
  module public.programme_module_type,
  occurred_at timestamptz,
  title text,
  body text,
  details jsonb,
  rating numeric,
  previous_rating numeric,
  linked_session_table text,
  linked_session_id uuid,
  linked_goal_id uuid,
  linked_activity_id uuid,
  is_private boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT f.*
  FROM public.canonical_reflection_feed(p_enrollment_id) f
  WHERE public.has_role(auth.uid(), 'admin'::public.app_role)
    AND NOT f.is_private
  ORDER BY f.occurred_at DESC NULLS LAST, f.source_type, f.source_id;
$$;

REVOKE ALL ON FUNCTION public.admin_learner_reflection_feed(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_learner_reflection_feed(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. Enrollment list with the canonical (effective) status
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_user_enrollments(p_user_id uuid, p_as_of date DEFAULT CURRENT_DATE)
RETURNS TABLE(enrollment_id uuid, programme_id uuid, programme_name text, cohort_id uuid, cohort_name text,
              organization_id uuid, organization_name text, start_date date, end_date date,
              stored_enrollment_status public.enrollment_status,
              effective_enrollment_status public.enrollment_status,
              required_units integer, completed_units integer, overdue_units integer,
              full_completion_pct numeric, progress_available boolean, created_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT e.id, e.programme_id, p.name::text, e.cohort_id, c.name::text,
         o.id, o.name::text, e.start_date, e.end_date,
         e.status, coalesce(cp.effective_enrollment_status, e.status),
         cp.required_units, cp.completed_units, cp.overdue_units,
         cp.full_completion_pct, coalesce(cp.progress_available, false), e.created_at
  FROM public.programme_enrollments e
  LEFT JOIN public.programmes p ON p.id = e.programme_id
  LEFT JOIN public.cohorts c ON c.id = e.cohort_id
  -- The enrollment's own organization is the source of truth (as for Sponsor).
  LEFT JOIN public.organizations o ON o.id = e.organization_id
  LEFT JOIN LATERAL public.canonical_enrollment_progress(e.id, p_as_of) cp ON true
  WHERE e.user_id = p_user_id
    AND public.has_role(auth.uid(), 'admin'::public.app_role)
  ORDER BY e.start_date DESC NULLS LAST, e.created_at DESC;
$$;

REVOKE ALL ON FUNCTION public.admin_user_enrollments(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_user_enrollments(uuid, date) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. Per-module progress (required / completed / due / booked / overdue)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_enrollment_module_progress(p_enrollment_id uuid, p_as_of date DEFAULT CURRENT_DATE)
RETURNS TABLE(module public.programme_module_type, required_units integer, completed_units integer,
              completed_activity_units integer, due_units integer, booked_units integer,
              overdue_units integer, pace_status text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT g.module, g.required_units, g.completed_units, g.completed_activity_units,
         g.due_units, g.booked_units, g.overdue_units, g.pace_status
  FROM public.canonical_module_progress(p_enrollment_id, p_as_of) g
  WHERE public.has_role(auth.uid(), 'admin'::public.app_role)
  ORDER BY g.module;
$$;

REVOKE ALL ON FUNCTION public.admin_enrollment_module_progress(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_enrollment_module_progress(uuid, date) TO authenticated;

-- ---------------------------------------------------------------------------
-- 5. Engagement (goals, actions, satisfaction) -- the sponsor/learner engine
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_enrollment_engagement(p_enrollment_id uuid)
RETURNS TABLE(goal_count integer, goal_setup boolean, goal_progress_pct numeric,
              open_action_count integer, completed_action_count integer, total_action_count integer,
              action_completion_pct numeric, satisfaction_avg numeric, satisfaction_rated_count integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT c.goal_count, c.goal_setup, c.goal_progress_pct,
         c.open_action_count, c.completed_action_count, c.total_action_count,
         c.action_completion_pct, c.satisfaction_avg, c.satisfaction_rated_count
  FROM public.canonical_enrollment_engagement(p_enrollment_id) c
  WHERE public.has_role(auth.uid(), 'admin'::public.app_role);
$$;

REVOKE ALL ON FUNCTION public.admin_enrollment_engagement(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_enrollment_engagement(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 6. Goals (canonical rating progress) and their rating history (check-ins)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_enrollment_goals(p_enrollment_id uuid)
RETURNS TABLE(goal_id uuid, title text, description text, status text, target_date date, sort_order integer,
              has_rating boolean, start_rating smallint, current_rating smallint, target_rating smallint,
              progress_pct numeric)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT g.id, g.title::text, g.description::text, g.status::text, g.target_date::date, g.sort_order::integer,
         gp.has_rating, gp.start_rating, gp.current_rating, gp.target_rating, gp.progress_pct
  FROM public.canonical_goal_progress(p_enrollment_id) gp
  JOIN public.coachee_goals g ON g.id = gp.goal_id
  WHERE public.has_role(auth.uid(), 'admin'::public.app_role)
  ORDER BY g.sort_order, g.created_at;
$$;

REVOKE ALL ON FUNCTION public.admin_enrollment_goals(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_enrollment_goals(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_enrollment_goal_checkins(p_enrollment_id uuid)
RETURNS TABLE(checkin_id uuid, goal_id uuid, previous_rating numeric, new_rating numeric, note text,
              source_activity_type text, source_activity_id uuid, actor_user_id uuid, actor_name text,
              created_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT gc.id, gc.goal_id, gc.previous_rating::numeric, gc.new_rating::numeric, nullif(btrim(gc.note), '')::text,
         gc.source_activity_type::text, gc.source_activity_id, gc.actor_user_id, pr.full_name::text, gc.created_at
  FROM public.goal_checkins gc
  LEFT JOIN public.profiles pr ON pr.id = gc.actor_user_id
  WHERE gc.enrollment_id = p_enrollment_id
    AND public.has_role(auth.uid(), 'admin'::public.app_role)
  ORDER BY gc.created_at DESC, gc.id;
$$;

REVOKE ALL ON FUNCTION public.admin_enrollment_goal_checkins(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_enrollment_goal_checkins(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 7. Actions of the enrollment (the rows canonical_enrollment_engagement counts)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_enrollment_actions(p_enrollment_id uuid)
RETURNS TABLE(action_id uuid, title text, description text, status text, due_date date, completed_at timestamptz,
              goal_id uuid, goal_title text, source_activity_type text, source_activity_id uuid, created_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT a.id, a.title::text, a.description::text, a.status::text, a.due_date::date, a.completed_at,
         a.goal_id, g.title::text, a.source_activity_type::text, a.source_activity_id, a.created_at
  FROM public.enrollment_actions a
  LEFT JOIN public.coachee_goals g ON g.id = a.goal_id
  WHERE a.enrollment_id = p_enrollment_id
    AND public.has_role(auth.uid(), 'admin'::public.app_role)
  ORDER BY (a.status IN ('open', 'in_progress')) DESC, a.due_date NULLS LAST, a.created_at DESC;
$$;

REVOKE ALL ON FUNCTION public.admin_enrollment_actions(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_enrollment_actions(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 8. Verification
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF pg_get_functiondef('public.learner_session_history(uuid)'::regprocedure) !~ 'canonical_session_history'
     OR pg_get_functiondef('public.admin_learner_session_history(uuid)'::regprocedure) !~ 'canonical_session_history' THEN
    RAISE EXCEPTION 'Admin detail: session history has more than one definition';
  END IF;
  IF pg_get_functiondef('public.canonical_session_history(uuid)'::regprocedure) !~ 'peer_session_participants' THEN
    RAISE EXCEPTION 'Admin detail: session history no longer reads the canonical peer participants';
  END IF;
  IF pg_get_functiondef('public.learner_reflection_feed(uuid)'::regprocedure) !~ 'canonical_reflection_feed'
     OR pg_get_functiondef('public.admin_learner_reflection_feed(uuid)'::regprocedure) !~ 'canonical_reflection_feed' THEN
    RAISE EXCEPTION 'Admin detail: reflection feed has more than one definition';
  END IF;
  IF pg_get_functiondef('public.canonical_reflection_feed(uuid)'::regprocedure) !~ 'session_learning_reflections' THEN
    RAISE EXCEPTION 'Admin detail: reflection feed no longer reads the canonical coaching store';
  END IF;
  IF has_function_privilege('authenticated', 'public.canonical_session_history(uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.canonical_reflection_feed(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Admin detail: an internal engine is client-callable';
  END IF;
  RAISE NOTICE 'Admin detail: per-enrollment admin wrappers over the canonical engines';
END $$;
