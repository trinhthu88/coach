-- Learner session history + canonical reflection feed (read-only projections).
--
-- Two learner self-view projections over EXISTING records. Neither stores
-- anything: every row is read at call time from its original table, which
-- stays the single source of truth.
--
-- 1. learner_session_history(enrollment)
--    Every coaching / peer / mentoring / triad session record that belongs to
--    the learner's enrollment, with its real lifecycle status. Previously the
--    enrollment-scoped learner views read `peer_sessions` (the coach-to-coach
--    table) for peer practice, so a coachee's `coachee_peer_sessions` never
--    appeared, and the Triads page only knew about round-based groups.
--
--    Scope:
--      * received/booked sessions: the row's own enrollment_id is this
--        enrollment (coaching, mentoring, peer received);
--      * peer sessions the learner GAVE are stored under the receiver's
--        enrollment, so they are included when the receiver's enrollment is
--        in the same cohort (never across programmes/cohorts);
--      * triads: the triad-specific coach/coachee/observer enrollment columns.
--
--    `is_programme_evidence` is NOT a second completion rule: it is true
--    exactly when session_activity_attributions attributes the session to
--    this enrollment and the session is completed — the same rows and the
--    same status test sponsor_canonical_activity feeds into
--    canonical_module_progress. Module progress still caps at the configured
--    requirement; history shows every record.
--
-- 2. learner_reflection_feed(enrollment)
--    Learner-authored reflective text only, projected from its original
--    record: session reflections (sessions.coachee_notes,
--    coachee_peer_sessions.receiver_notes, peer_sessions.coachee_notes,
--    mentoring_sessions.mentee_notes), the learner's own session rating
--    comments, triad_reflections, goal_checkins written by the learner with a
--    note, training reflection answers, quiz reflection text, daily prompt
--    responses and explicit My Journey reflections (coachee_reflections).
--    Rows with no text are excluded (a bare rating stays goal/session
--    history, not a "reflection").
--    Never selected: coach_notes, coach_private_notes, provider_notes,
--    provider_private_notes, mentor_notes, mentoring_feedback,
--    coach_session_feedback, or anything a coach/admin/sponsor authored.
--
-- Both are SECURITY DEFINER and authorize exactly like the other
-- learner_canonical_* functions: the caller must own the enrollment.

CREATE OR REPLACE FUNCTION public.learner_session_history(
  p_enrollment_id uuid
)
RETURNS TABLE (
  session_key text,
  session_type text,
  source_table text,
  source_id uuid,
  module public.programme_module_type,
  participant_role text,
  title text,
  start_time timestamptz,
  status text,
  counterpart_names text[],
  round_number integer,
  training_week_number integer,
  attributed_to_enrollment boolean,
  is_programme_evidence boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH me AS (
    SELECT e.id AS enrollment_id, e.user_id, e.cohort_id
    FROM public.programme_enrollments e
    WHERE e.id = p_enrollment_id
      AND e.user_id = auth.uid()
      AND auth.uid() IS NOT NULL
  ), cohort_enrollments AS (
    SELECT pe.id
    FROM public.programme_enrollments pe
    JOIN me ON pe.cohort_id = me.cohort_id
  ), rows AS (
    SELECT 'coaching'::text AS session_type, 'sessions'::text AS source_table, s.id AS source_id,
      'coaching'::public.programme_module_type AS module, 'coachee'::text AS participant_role,
      s.topic AS title, s.start_time, s.status::text AS status,
      ARRAY[s.coach_id] AS counterpart_ids, NULL::integer AS round_number, NULL::integer AS training_week_number
    FROM public.sessions s
    JOIN me ON s.enrollment_id = me.enrollment_id AND s.coachee_id = me.user_id

    UNION ALL
    SELECT 'peer_coaching', 'coachee_peer_sessions', cps.id, 'peer_coaching', 'receiver',
      cps.topic, cps.start_time, cps.status::text, ARRAY[cps.peer_provider_id], NULL, NULL
    FROM public.coachee_peer_sessions cps
    JOIN me ON cps.enrollment_id = me.enrollment_id AND cps.peer_receiver_id = me.user_id

    UNION ALL
    SELECT 'peer_coaching', 'coachee_peer_sessions', cps.id, 'peer_coaching', 'provider',
      cps.topic, cps.start_time, cps.status::text, ARRAY[cps.peer_receiver_id], NULL, NULL
    FROM public.coachee_peer_sessions cps
    JOIN me ON cps.peer_provider_id = me.user_id
    WHERE cps.enrollment_id IN (SELECT id FROM cohort_enrollments)

    UNION ALL
    SELECT 'peer_coaching', 'peer_sessions', ps.id, 'peer_coaching', 'receiver',
      ps.topic, ps.start_time, ps.status::text, ARRAY[ps.peer_coach_id], NULL, NULL
    FROM public.peer_sessions ps
    JOIN me ON ps.enrollment_id = me.enrollment_id AND ps.peer_coachee_id = me.user_id

    UNION ALL
    SELECT 'peer_coaching', 'peer_sessions', ps.id, 'peer_coaching', 'provider',
      ps.topic, ps.start_time, ps.status::text, ARRAY[ps.peer_coachee_id], NULL, NULL
    FROM public.peer_sessions ps
    JOIN me ON ps.peer_coach_id = me.user_id
    WHERE ps.enrollment_id IN (SELECT id FROM cohort_enrollments)

    UNION ALL
    SELECT 'mentoring', 'mentoring_sessions', ms.id, 'mentoring', 'mentee',
      ms.topic, ms.start_time, ms.status::text, ARRAY[ms.mentor_id], NULL, NULL
    FROM public.mentoring_sessions ms
    JOIN me ON ms.enrollment_id = me.enrollment_id AND ms.mentee_id = me.user_id

    UNION ALL
    SELECT 'triad', 'triad_sessions', ts.id, 'triads',
      CASE
        WHEN ts.coach_enrollment_id = me.enrollment_id THEN 'coach'
        WHEN ts.coachee_enrollment_id = me.enrollment_id THEN 'coachee'
        ELSE 'observer'
      END,
      tr.title, coalesce(ts.start_time, ts.proposed_start_time), ts.status::text,
      array_remove(ARRAY[tg.member_1_id, tg.member_2_id, tg.member_3_id], me.user_id),
      coalesce(tr.round_number, tg.round_number), tw.week_number
    FROM public.triad_sessions ts
    JOIN me ON me.enrollment_id IN (ts.coach_enrollment_id, ts.coachee_enrollment_id, ts.observer_enrollment_id)
    LEFT JOIN public.triad_groups tg ON tg.id = ts.triad_group_id
    LEFT JOIN public.triad_rounds tr ON tr.id = tg.triad_round_id
    LEFT JOIN public.training_weeks tw ON tw.id = tr.training_week_id
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
    r.round_number,
    r.training_week_number,
    EXISTS (
      SELECT 1 FROM public.session_activity_attributions a
      JOIN me ON a.enrollment_id = me.enrollment_id
      WHERE a.source_activity_id = r.source_id
    ),
    r.status = 'completed' AND EXISTS (
      SELECT 1 FROM public.session_activity_attributions a
      JOIN me ON a.enrollment_id = me.enrollment_id
      WHERE a.source_activity_id = r.source_id
    )
  FROM rows r
  ORDER BY r.start_time DESC NULLS LAST;
$$;

REVOKE ALL ON FUNCTION public.learner_session_history(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.learner_session_history(uuid)
  TO authenticated;

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
  WITH me AS (
    SELECT e.id AS enrollment_id, e.user_id
    FROM public.programme_enrollments e
    WHERE e.id = p_enrollment_id
      AND e.user_id = auth.uid()
      AND auth.uid() IS NOT NULL
  ), feed AS (
    -- Coaching: the learner's own session reflection ("Client reflection").
    SELECT 'coaching_session_reflection'::text AS source_type, 'sessions'::text AS source_table, s.id AS source_id,
      'coaching'::public.programme_module_type AS module, s.start_time AS occurred_at, s.topic AS title,
      btrim(s.coachee_notes) AS body, NULL::jsonb AS details, NULL::numeric AS rating, NULL::numeric AS previous_rating,
      'sessions'::text AS linked_session_table, s.id AS linked_session_id, NULL::uuid AS linked_goal_id,
      s.id AS linked_activity_id, false AS is_private
    FROM public.sessions s
    JOIN me ON s.enrollment_id = me.enrollment_id AND s.coachee_id = me.user_id
    WHERE nullif(btrim(s.coachee_notes), '') IS NOT NULL

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

    -- Triads: the learner's own post-session reflection.
    UNION ALL
    SELECT 'triad_reflection', 'triad_reflections', trf.id, 'triads', trf.submitted_at, tr.title,
      concat_ws(E'\n\n',
        nullif(btrim(trf.learned_as_coach), ''), nullif(btrim(trf.will_use_as_coach), ''),
        nullif(btrim(trf.learned_as_coachee), ''), nullif(btrim(trf.will_use_as_coachee), ''),
        nullif(btrim(trf.learned_as_observer), ''), nullif(btrim(trf.will_use_as_observer), '')),
      jsonb_strip_nulls(jsonb_build_object(
        'learned_as_coach', nullif(btrim(trf.learned_as_coach), ''),
        'will_use_as_coach', nullif(btrim(trf.will_use_as_coach), ''),
        'learned_as_coachee', nullif(btrim(trf.learned_as_coachee), ''),
        'will_use_as_coachee', nullif(btrim(trf.will_use_as_coachee), ''),
        'learned_as_observer', nullif(btrim(trf.learned_as_observer), ''),
        'will_use_as_observer', nullif(btrim(trf.will_use_as_observer), ''),
        'round_number', coalesce(tr.round_number, tg.round_number))),
      trf.satisfaction_rating::numeric, NULL,
      'triad_sessions', trf.triad_session_id, NULL, trf.triad_session_id, false
    FROM public.triad_reflections trf
    JOIN me ON trf.enrollment_id = me.enrollment_id AND trf.participant_id = me.user_id
    LEFT JOIN public.triad_sessions ts ON ts.id = trf.triad_session_id
    LEFT JOIN public.triad_groups tg ON tg.id = ts.triad_group_id
    LEFT JOIN public.triad_rounds tr ON tr.id = tg.triad_round_id
    WHERE coalesce(nullif(btrim(trf.learned_as_coach), ''), nullif(btrim(trf.will_use_as_coach), ''),
      nullif(btrim(trf.learned_as_coachee), ''), nullif(btrim(trf.will_use_as_coachee), ''),
      nullif(btrim(trf.learned_as_observer), ''), nullif(btrim(trf.will_use_as_observer), '')) IS NOT NULL

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

REVOKE ALL ON FUNCTION public.learner_reflection_feed(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.learner_reflection_feed(uuid)
  TO authenticated;
