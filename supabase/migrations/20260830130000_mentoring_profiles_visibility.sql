-- Real bug found by browser-testing the mentoring booking flow: a coachee
-- mentee got "Mentor not found" on MentoringBookSession.tsx even though
-- mentor_profiles/mentoring_allowlist were both set up correctly — because
-- profiles RLS was never taught about the mentoring relationship.
--
-- is_allowlisted_pair() (20260501185440_*) only checks
-- coachee_coach_allowlist, and shares_session_with() (same migration) only
-- checks sessions/peer_sessions. Neither knows about mentoring_allowlist or
-- mentoring_sessions, so a mentee who isn't also a coach (and so doesn't
-- get in via "Profiles: coaches view active coach directory",
-- 20260807211209_*, which only helps when both parties happen to be
-- coaches) had no RLS path to ever see their mentor's profile row — and a
-- mentor had no path to see their mentee's profile row post-booking either,
-- since shares_session_with() didn't know about mentoring_sessions.
--
-- MentoringFindMentor.tsx's list page avoided this because get_my_mentors()
-- is SECURITY DEFINER and joins profiles internally, bypassing RLS — but
-- MentoringBookSession.tsx's direct `profiles!inner(...)` join and
-- useMentoringSessionCore.ts's direct profiles query both go through RLS as
-- the calling user. Fixed at the root (the two shared helper functions
-- these two existing policies already call), not by rewriting the two call
-- sites into more RPCs — this also covers any future direct query the same
-- way.

CREATE OR REPLACE FUNCTION public.is_allowlisted_pair(_viewer uuid, _target uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.coachee_coach_allowlist a
    WHERE (a.coachee_id = _viewer AND a.coach_id = _target)
       OR (a.coach_id   = _viewer AND a.coachee_id = _target)
  ) OR EXISTS (
    SELECT 1 FROM public.mentoring_allowlist a
    WHERE (a.mentee_user_id = _viewer AND a.mentor_user_id = _target)
       OR (a.mentor_user_id = _viewer AND a.mentee_user_id = _target)
  );
$$;

CREATE OR REPLACE FUNCTION public.shares_session_with(_viewer uuid, _target uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.sessions s
    WHERE (s.coach_id = _viewer AND s.coachee_id = _target)
       OR (s.coachee_id = _viewer AND s.coach_id = _target)
  ) OR EXISTS (
    SELECT 1 FROM public.peer_sessions ps
    WHERE (ps.peer_coach_id = _viewer AND ps.peer_coachee_id = _target)
       OR (ps.peer_coachee_id = _viewer AND ps.peer_coach_id = _target)
  ) OR EXISTS (
    SELECT 1 FROM public.mentoring_sessions ms
    WHERE (ms.mentor_id = _viewer AND ms.mentee_id = _target)
       OR (ms.mentee_id = _viewer AND ms.mentor_id = _target)
  );
$$;
