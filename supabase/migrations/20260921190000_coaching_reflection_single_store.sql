-- One Coaching reflection store (audit findings C4 and C5).
--
-- A Coaching reflection could live in two places:
--
--   session_learning_reflections   the canonical evidence record, written by
--                                  the post-session checklist
--   sessions.coachee_notes         the field the session page has always
--                                  offered, and the one learner_reflection_feed
--                                  and the Admin "missing reflection" alert
--                                  actually read
--
-- So a learner who wrote the canonical reflection saw nothing in their own
-- reflection feed and was chased by an alert for a reflection they had
-- written; one who wrote coachee_notes saw a reflection that satisfied no
-- evidence check. Two answers to "has this learner reflected".
--
-- session_learning_reflections is the canonical store. Every existing note is
-- copied into it -- nothing is deleted, and coachee_notes keeps its data so
-- the migration is reversible and no history is lost -- and the reflection
-- feed now reads only the canonical store.

-- ---------------------------------------------------------------------------
-- 1. Copy every existing Coaching note into the canonical store
-- ---------------------------------------------------------------------------
--
-- ON CONFLICT DO NOTHING: where a learner already has a canonical reflection
-- for a session, that one wins. The note is never allowed to overwrite it.

INSERT INTO public.session_learning_reflections
  (enrollment_id, source_activity_type, source_activity_id, body, submitted_at)
SELECT s.enrollment_id, 'coaching', s.id, btrim(s.coachee_notes),
       coalesce(s.updated_at, s.start_time, now())
FROM public.sessions s
WHERE s.enrollment_id IS NOT NULL
  AND nullif(btrim(coalesce(s.coachee_notes, '')), '') IS NOT NULL
ON CONFLICT (enrollment_id, source_activity_type, source_activity_id) DO NOTHING;

COMMENT ON COLUMN public.sessions.coachee_notes IS
  'HISTORICAL for Coaching as of 2026-09-21: the canonical learner reflection '
  'is session_learning_reflections. Retained so the copy in 20260921190000 is '
  'reversible and no history is lost; nothing reads it for Coaching.';

-- ---------------------------------------------------------------------------
-- 2. The reflection feed reads the canonical store only
-- ---------------------------------------------------------------------------

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
-- ---------------------------------------------------------------------------
-- 3. Verification
-- ---------------------------------------------------------------------------

DO $$
DECLARE n bigint;
BEGIN
  -- Scoped to the Coaching branch: peer_sessions.coachee_notes and
  -- coachee_peer_sessions.receiver_notes are their modules' own canonical
  -- fields and must keep being read.
  IF pg_get_functiondef('public.learner_reflection_feed(uuid)'::regprocedure)
       ~ 'btrim\(s\.coachee_notes\)' THEN
    RAISE EXCEPTION 'Coaching reflection: the feed still reads sessions.coachee_notes';
  END IF;
  IF pg_get_functiondef('public.learner_reflection_feed(uuid)'::regprocedure)
       !~ 'session_learning_reflections' THEN
    RAISE EXCEPTION 'Coaching reflection: the feed does not read the canonical store';
  END IF;

  -- Every Coaching note must now also exist canonically.
  SELECT count(*) INTO n
  FROM public.sessions s
  WHERE s.enrollment_id IS NOT NULL
    AND nullif(btrim(coalesce(s.coachee_notes, '')), '') IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.session_learning_reflections r
      WHERE r.enrollment_id = s.enrollment_id
        AND r.source_activity_type = 'coaching'
        AND r.source_activity_id = s.id);
  IF n > 0 THEN
    RAISE EXCEPTION 'Coaching reflection: % notes were not copied to the canonical store', n;
  END IF;
END $$;
