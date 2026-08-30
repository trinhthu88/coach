-- Phase 1.5 (mentoring spec addendum): programme-defined session limits for
-- mentoring, both directions, superseding the earlier "no cap, by design"
-- state documented in RULES.md §3 Relationship 4. Mirrors the coach/coachee
-- programme-limit model already used for coaching/peer coaching
-- (20260811130000_coach_programmes_schema.sql /
-- 20260811132000_coach_programmes_enforcement.sql), not the older
-- session_limits/coach_session_limits pattern.
--
-- Two deliberate departures from the existing coach-side enforcement style:
--
-- 1. No enrollment => unlimited (NULL), not a hardcoded 4. The existing
--    coach-side functions fall back to 4 when a coach has no
--    coach_programme_enrollments row, matching the old
--    COALESCE(personal, global-default, 4) chain they replaced. That
--    fallback was a deliberate migration-compatibility shim for pre-existing
--    data; mentoring has no such legacy data to be compatible with, and the
--    task brief is explicit that an unset limit should mean unlimited, full
--    stop, not a hidden numeric default. So: no enrollment for either
--    direction simply returns NULL here.
--
-- 2. A coachee mentee can be enrolled in multiple simultaneous active
--    programmes (unlike a coach, who has exactly one active
--    coach_programme_enrollments row). Per product decision, a coachee's
--    effective received limit is the SUM of every active enrollment's
--    mentoring_received_limit — not the min, not the max. If ANY active
--    enrollment carries no limit (NULL = unlimited), the total is treated as
--    unlimited too: a programme that grants unlimited mentoring makes the
--    coachee's overall access unlimited regardless of what other programmes
--    say, since summing a finite number with "unlimited" is still
--    unlimited. Only when every active enrollment has a concrete (non-null)
--    limit does the sum apply.

ALTER TABLE public.coach_programmes
  ADD COLUMN mentoring_received_limit integer,
  ADD COLUMN mentoring_given_limit integer;

-- Unlike programmes' four existing limit columns (NOT NULL with numeric
-- defaults), this one is nullable with no default, matching
-- coach_programmes' NULL-means-unlimited convention rather than its own
-- table's older columns — see header comment.
ALTER TABLE public.programmes
  ADD COLUMN mentoring_received_limit integer;

-- get_mentoring_received_limit: the mentee side. Coaches resolve through
-- their single coach_programme_enrollments row; coachees sum across every
-- active programme_enrollments row (see header comment, point 2).
CREATE OR REPLACE FUNCTION public.get_mentoring_received_limit(p_user_id uuid)
RETURNS integer
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _is_coach boolean;
  _limit integer;
  _has_any boolean;
  _has_unlimited boolean;
BEGIN
  SELECT public.has_role(p_user_id, 'coach'::app_role) INTO _is_coach;

  IF _is_coach THEN
    SELECT cp.mentoring_received_limit INTO _limit
    FROM public.coach_programme_enrollments cpe
    JOIN public.coach_programmes cp ON cp.id = cpe.coach_programme_id
    WHERE cpe.coach_id = p_user_id;
    RETURN _limit; -- NULL both when unset and when there's no enrollment at all
  END IF;

  SELECT
    COUNT(*) > 0,
    bool_or(p.mentoring_received_limit IS NULL),
    SUM(p.mentoring_received_limit)
  INTO _has_any, _has_unlimited, _limit
  FROM public.programme_enrollments pe
  JOIN public.programmes p ON p.id = pe.programme_id
  WHERE pe.coachee_id = p_user_id AND pe.status = 'active'::enrollment_status;

  IF NOT _has_any OR _has_unlimited THEN
    RETURN NULL;
  END IF;
  RETURN _limit;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_mentoring_received_limit(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_mentoring_received_limit(uuid) TO authenticated;

-- get_mentoring_given_limit: the mentor side. Mentors are always coaches
-- (per mentor_profiles), so this is always a single coach_programme_enrollments
-- lookup — no role branching needed.
CREATE OR REPLACE FUNCTION public.get_mentoring_given_limit(p_mentor_id uuid)
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT cp.mentoring_given_limit
  FROM public.coach_programme_enrollments cpe
  JOIN public.coach_programmes cp ON cp.id = cpe.coach_programme_id
  WHERE cpe.coach_id = p_mentor_id;
$$;

REVOKE EXECUTE ON FUNCTION public.get_mentoring_given_limit(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_mentoring_given_limit(uuid) TO authenticated;

-- Usage pairs, mirroring get_coach_peer_session_usage's shape. Counting the
-- same in-flight + completed statuses as get_coachee_session_usage
-- (pending_coach_approval, confirmed, completed) rather than completed-only,
-- so a user can't stack more bookings than their limit while some are still
-- pending approval.
CREATE OR REPLACE FUNCTION public.get_mentoring_session_usage(p_user_id uuid)
RETURNS TABLE(limit_count integer, used_count integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    public.get_mentoring_received_limit(p_user_id),
    (SELECT COUNT(*)::int FROM public.mentoring_sessions ms
       WHERE ms.mentee_id = p_user_id
         AND ms.status IN ('pending_coach_approval','confirmed','completed'));
$$;

REVOKE EXECUTE ON FUNCTION public.get_mentoring_session_usage(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_mentoring_session_usage(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_mentoring_given_usage(p_mentor_id uuid)
RETURNS TABLE(limit_count integer, used_count integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    public.get_mentoring_given_limit(p_mentor_id),
    (SELECT COUNT(*)::int FROM public.mentoring_sessions ms
       WHERE ms.mentor_id = p_mentor_id
         AND ms.status IN ('pending_coach_approval','confirmed','completed'));
$$;

REVOKE EXECUTE ON FUNCTION public.get_mentoring_given_usage(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_mentoring_given_usage(uuid) TO authenticated;

-- Frontend-callable wrapper pinned to the caller, for "X of Y mentoring
-- sessions used" on MentoringBookSession.tsx — mirrors the self-pinned
-- check_can_book_mentoring_session() pattern rather than the older
-- get_coach_peer_session_usage()/get_coachee_session_usage() precedent
-- (which are directly callable with an arbitrary id argument); this keeps
-- mentoring's newer functions consistent with each other.
CREATE OR REPLACE FUNCTION public.check_mentoring_session_usage()
RETURNS TABLE(limit_count integer, used_count integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT * FROM public.get_mentoring_session_usage(auth.uid());
$$;

REVOKE EXECUTE ON FUNCTION public.check_mentoring_session_usage() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.check_mentoring_session_usage() TO authenticated;

-- Frontend-callable wrapper for "is this specific mentor still taking new
-- sessions" (used to grey out a mentor in the picker before the user even
-- tries to book them). Scoped to mentors the caller is actually allowlisted
-- with (or admin) — same anti-probing reasoning as
-- can_book_mentoring_session()'s self-or-admin check, just applied to a
-- third party's usage instead of the caller's own.
CREATE OR REPLACE FUNCTION public.check_mentoring_given_usage(p_mentor_id uuid)
RETURNS TABLE(limit_count integer, used_count integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) AND NOT EXISTS (
    SELECT 1 FROM public.mentoring_allowlist a
    WHERE a.mentee_user_id = auth.uid() AND a.mentor_user_id = p_mentor_id
  ) THEN
    RETURN;
  END IF;
  RETURN QUERY SELECT * FROM public.get_mentoring_given_usage(p_mentor_id);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.check_mentoring_given_usage(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.check_mentoring_given_usage(uuid) TO authenticated;
