-- P1-7: ONE canonical satisfaction projection for all four modules.
--
-- canonical_session_satisfaction is THE numeric-rating source: one row per
-- rating a participating learner gave a COMPLETED session, on their own
-- enrollment, on the shared 1-5 scale.
--
--   module     source                                      rated_at
--   coaching   sessions.coachee_rating                     coachee_rated_at
--   mentoring  mentoring_sessions.mentee_rating            mentee_rated_at
--   peer       coachee_peer_sessions receiver/provider     receiver_/provider_rated_at
--              peer_sessions coachee/coach (by role)       coachee_/coach_rated_at
--   triads     triad_reflections.satisfaction_rating       submitted_at
--
-- The Mentoring and Peer ratings are the normalized post-session satisfaction
-- fields added in 20260925500000 (written by submit_session_satisfaction),
-- separate from the ICF competency feedback. Only the number is projected --
-- never a comment, reflection or session content.
--
-- canonical_enrollment_satisfaction() now reads this view, so every aggregate
-- built on it (canonical_enrollment_engagement.satisfaction_avg -> Sponsor
-- cohort/organisation/leader metadata, admin_enrollment_satisfaction -> Admin
-- Analytics and the enrollment detail) consumes the one projection.
--
-- The view runs with its owner's rights and is revoked from clients; they
-- read the authorised wrappers.

-- Every rating column is on the 1-5 scale (NOT VALID: enforced for every new
-- write without re-checking history; the view filters to 1-5 regardless).
ALTER TABLE public.sessions DROP CONSTRAINT IF EXISTS sessions_coachee_rating_range;
ALTER TABLE public.sessions
  ADD CONSTRAINT sessions_coachee_rating_range CHECK (coachee_rating IS NULL OR coachee_rating BETWEEN 1 AND 5) NOT VALID;
ALTER TABLE public.coachee_peer_sessions DROP CONSTRAINT IF EXISTS coachee_peer_sessions_receiver_rating_range;
ALTER TABLE public.coachee_peer_sessions
  ADD CONSTRAINT coachee_peer_sessions_receiver_rating_range CHECK (receiver_rating IS NULL OR receiver_rating BETWEEN 1 AND 5) NOT VALID;
ALTER TABLE public.peer_sessions DROP CONSTRAINT IF EXISTS peer_sessions_coachee_rating_range;
ALTER TABLE public.peer_sessions
  ADD CONSTRAINT peer_sessions_coachee_rating_range CHECK (coachee_rating IS NULL OR coachee_rating BETWEEN 1 AND 5) NOT VALID;

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
  -- Triads
  SELECT r.enrollment_id, 'triads', 'triad_sessions', x.id, r.satisfaction_rating::smallint, r.submitted_at
  FROM public.triad_reflections r
  JOIN public.triad_sessions x ON x.id = r.triad_session_id AND x.status = 'completed'
  JOIN public.triad_group_members gm ON gm.triad_group_id = x.triad_group_id AND gm.enrollment_id = r.enrollment_id
  WHERE r.enrollment_id IS NOT NULL AND r.satisfaction_rating IS NOT NULL
)
SELECT enrollment_id, module, source_table, activity_id, rating, rated_at
FROM ratings
WHERE rating BETWEEN 1 AND 5;

REVOKE ALL ON public.canonical_session_satisfaction FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.canonical_session_satisfaction TO service_role;

COMMENT ON VIEW public.canonical_session_satisfaction IS
  'THE canonical satisfaction projection: one numeric 1-5 rating per participating enrollment per completed session, '
  'for Coaching, Mentoring, Peer Coaching and Triads. Numbers only, never narrative. INTERNAL: aggregates read it via '
  'canonical_enrollment_satisfaction().';

-- Same signature and columns as 20260925500000; it now reads the one view.
CREATE OR REPLACE FUNCTION public.canonical_enrollment_satisfaction(p_enrollment_id uuid)
RETURNS TABLE (module public.programme_module_type, source_table text, session_id uuid, rating smallint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT v.module, v.source_table, v.activity_id, v.rating
  FROM public.canonical_session_satisfaction v
  WHERE v.enrollment_id = p_enrollment_id;
$$;
REVOKE ALL ON FUNCTION public.canonical_enrollment_satisfaction(uuid) FROM PUBLIC, anon, authenticated;
