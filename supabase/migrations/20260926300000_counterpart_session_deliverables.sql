-- Post-session deliverables owed by the COUNTERPART (spec Part 8).
--
-- 20260925500000 made the learner's post-session deliverables one rule for all
-- four modules. The other side of a session also owes write-ups, and those
-- were not tracked anywhere: a coach who never wrote their session notes, or
-- a mentor who never sent feedback, showed no outstanding state.
--
-- This adds the counterpart half of the same pattern, reading ONLY the stores
-- that already exist (no new write path, no copy of any text):
--
--   session                 who        item                      required  store
--   sessions (Coaching)     coach      session_notes             yes       coach_session_private_notes (confidential)
--                           coach      feedback_to_learner       no        sessions.coach_notes (shared notes, "where applicable")
--   mentoring_sessions      mentor     session_notes             yes       mentoring_sessions.mentor_notes
--                           mentor     feedback_to_mentee        yes       mentoring_feedback
--   peer_sessions           receiver   peer_feedback             yes       peer_session_competency_feedback
--                           provider   session_notes             no        peer_coach_session_private_notes
--
-- Learner-to-learner Peer practice (coachee_peer_sessions) and Triads carry
-- their participants' deliverables in the learner rule (each participant's
-- reflection, check-in, action, rating; Triad group sharing unlocks on
-- reflections), so they add no counterpart rows here.
--
-- Confidentiality: the function returns booleans only -- never note or
-- feedback text -- and only to that counterpart or an Admin. Sponsors have no
-- path to it, and coach session notes stay in their own RLS-protected table.

CREATE OR REPLACE FUNCTION public.canonical_counterpart_deliverables(p_source_table text, p_session_id uuid)
RETURNS TABLE (
  user_id uuid,
  counterpart_role text,
  item text,
  required boolean,
  done boolean,
  session_completed boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  -- Coaching: the coach.
  SELECT s.coach_id, 'coach', x.item, x.required, x.done, s.status::text = 'completed'
  FROM public.sessions s
  CROSS JOIN LATERAL (VALUES
    ('session_notes', true,
      EXISTS (SELECT 1 FROM public.coach_session_private_notes n
              WHERE n.session_id = s.id AND nullif(btrim(n.body), '') IS NOT NULL)),
    ('feedback_to_learner', false, nullif(btrim(coalesce(s.coach_notes, '')), '') IS NOT NULL)
  ) AS x(item, required, done)
  WHERE p_source_table = 'sessions' AND s.id = p_session_id

  UNION ALL
  -- Mentoring: the mentor.
  SELECT m.mentor_id, 'mentor', x.item, x.required, x.done, m.status::text = 'completed'
  FROM public.mentoring_sessions m
  CROSS JOIN LATERAL (VALUES
    ('session_notes', true, nullif(btrim(coalesce(m.mentor_notes, '')), '') IS NOT NULL),
    ('feedback_to_mentee', true,
      EXISTS (SELECT 1 FROM public.mentoring_feedback f WHERE f.mentoring_session_id = m.id))
  ) AS x(item, required, done)
  WHERE p_source_table = 'mentoring_sessions' AND m.id = p_session_id

  UNION ALL
  -- Coach-to-coach Peer: feedback to the partner (receiver), notes (provider).
  SELECT p.peer_coachee_id, 'receiver', 'peer_feedback', true,
    EXISTS (SELECT 1 FROM public.peer_session_competency_feedback f WHERE f.peer_session_id = p.id),
    p.status::text = 'completed'
  FROM public.peer_sessions p
  WHERE p_source_table = 'peer_sessions' AND p.id = p_session_id

  UNION ALL
  SELECT p.peer_coach_id, 'provider', 'session_notes', false,
    EXISTS (SELECT 1 FROM public.peer_coach_session_private_notes n
            WHERE n.peer_session_id = p.id AND nullif(btrim(n.body), '') IS NOT NULL),
    p.status::text = 'completed'
  FROM public.peer_sessions p
  WHERE p_source_table = 'peer_sessions' AND p.id = p_session_id;
$$;
REVOKE ALL ON FUNCTION public.canonical_counterpart_deliverables(text, uuid) FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.canonical_counterpart_deliverables(text, uuid) IS
  'THE counterpart post-session deliverable rule (coach notes/feedback, mentor notes/feedback, peer feedback): '
  'booleans only, never text. Internal; read through session_counterpart_deliverables.';

-- The caller's own counterpart items for one session (Admin: every counterpart).
CREATE OR REPLACE FUNCTION public.session_counterpart_deliverables(p_source_table text, p_session_id uuid)
RETURNS TABLE (
  user_id uuid,
  counterpart_role text,
  item text,
  required boolean,
  done boolean,
  session_completed boolean,
  is_self boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT d.user_id, d.counterpart_role, d.item, d.required, d.done, d.session_completed,
    d.user_id = auth.uid()
  FROM public.canonical_counterpart_deliverables(p_source_table, p_session_id) d
  WHERE auth.uid() IS NOT NULL
    AND (d.user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'::public.app_role));
$$;
REVOKE ALL ON FUNCTION public.session_counterpart_deliverables(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.session_counterpart_deliverables(text, uuid) TO authenticated;

COMMENT ON FUNCTION public.session_counterpart_deliverables(text, uuid) IS
  'The calling coach/mentor/peer''s own post-session items for one session (Admin sees every counterpart). '
  'Outstanding = required AND NOT done on a completed session. Booleans only; never visible to a Sponsor.';
