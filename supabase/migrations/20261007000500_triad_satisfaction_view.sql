-- ===========================================================================
-- canonical_session_satisfaction: Triad rows from their own view
--
-- Deployment 2 (supabase/deployment-2/20260919190000_triad_retire_legacy.sql)
-- refuses to retire the legacy Triad fields while any view reads a Triad
-- table AND mentions a retired column name such as start_time. The one
-- satisfaction projection (20260926800000) did both -- start_time came from
-- the Coaching, Mentoring and Peer branches, not from Triads -- so the
-- retirement stopped there (a false positive, but the guard is right to be
-- coarse). The Triad branch now lives in canonical_triad_satisfaction, with
-- the same rows; the projection's columns, rows and grants are unchanged.
-- ===========================================================================
CREATE OR REPLACE VIEW public.canonical_triad_satisfaction AS
SELECT r.enrollment_id, 'triads'::public.programme_module_type AS module, 'triad_sessions'::text AS source_table,
       x.id AS activity_id, r.satisfaction_rating::smallint AS rating, r.submitted_at AS rated_at
FROM public.triad_reflections r
JOIN public.triad_sessions x ON x.id = r.triad_session_id AND x.status = 'completed'
JOIN public.triad_group_members gm ON gm.triad_group_id = x.triad_group_id AND gm.enrollment_id = r.enrollment_id
WHERE r.enrollment_id IS NOT NULL AND r.satisfaction_rating IS NOT NULL;

REVOKE ALL ON public.canonical_triad_satisfaction FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.canonical_triad_satisfaction TO service_role;
COMMENT ON VIEW public.canonical_triad_satisfaction IS
  'INTERNAL: the Triad rows of canonical_session_satisfaction (kept apart so no view mixes Triad tables with retired column names).';

CREATE OR REPLACE VIEW public.canonical_session_satisfaction AS
WITH ratings AS (
  -- Coaching
  SELECT s.enrollment_id, 'coaching'::public.programme_module_type AS module, 'sessions'::text AS source_table,
         s.id AS activity_id, s.coachee_rating::smallint AS rating, coalesce(s.coachee_rated_at, s.start_time) AS rated_at
  FROM public.sessions s
  WHERE s.status = 'completed' AND s.enrollment_id IS NOT NULL AND s.coachee_rating IS NOT NULL

  UNION ALL
  -- Mentoring
  SELECT m.enrollment_id, 'mentoring', 'mentoring_sessions', m.id, m.mentee_rating::smallint,
         coalesce(m.mentee_rated_at, m.start_time)
  FROM public.mentoring_sessions m
  WHERE m.status = 'completed' AND m.enrollment_id IS NOT NULL AND m.mentee_rating IS NOT NULL

  UNION ALL
  -- Peer (learner-to-learner): each participant rates on their own enrollment
  SELECT p.enrollment_id, 'peer_coaching', 'coachee_peer_sessions', x.id,
         (CASE p.participant_role WHEN 'receiver' THEN x.receiver_rating ELSE x.provider_rating END)::smallint,
         coalesce(CASE p.participant_role WHEN 'receiver' THEN x.receiver_rated_at ELSE x.provider_rated_at END, x.start_time)
  FROM public.coachee_peer_sessions x
  JOIN public.peer_session_participants p ON p.session_kind = 'coachee_peer' AND p.peer_session_id = x.id
  WHERE x.status = 'completed' AND p.enrollment_id IS NOT NULL

  UNION ALL
  -- Peer (coach-to-coach)
  SELECT p.enrollment_id, 'peer_coaching', 'peer_sessions', x.id,
         (CASE p.participant_role WHEN 'receiver' THEN x.coachee_rating ELSE x.coach_rating END)::smallint,
         coalesce(CASE p.participant_role WHEN 'receiver' THEN x.coachee_rated_at ELSE x.coach_rated_at END, x.start_time)
  FROM public.peer_sessions x
  JOIN public.peer_session_participants p ON p.session_kind = 'peer' AND p.peer_session_id = x.id
  WHERE x.status = 'completed' AND p.enrollment_id IS NOT NULL

  UNION ALL
  -- Triads (canonical_triad_satisfaction)
  SELECT t.enrollment_id, t.module, t.source_table, t.activity_id, t.rating, t.rated_at
  FROM public.canonical_triad_satisfaction t
)
SELECT enrollment_id, module, source_table, activity_id, rating, rated_at
FROM ratings
WHERE rating BETWEEN 1 AND 5;

REVOKE ALL ON public.canonical_session_satisfaction FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.canonical_session_satisfaction TO service_role;
