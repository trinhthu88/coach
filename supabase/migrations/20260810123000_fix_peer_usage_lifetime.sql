-- Phase 4: fix get_coach_peer_session_usage to count lifetime usage, not calendar-month.
--
-- coach_session_limits.peer_monthly_limit is enforced as a LIFETIME total by
-- enforce_coach_as_coachee_limit() (counts ALL peer_sessions rows, no date filter).
-- get_coach_peer_session_usage instead only counted rows within the current calendar
-- month, so BookSession.tsx's displayed "used_this_month" / overLimit check could let a
-- coach keep booking past their real lifetime cap simply by waiting for next month.
-- The non-peer coach-as-coachee usage query in BookSession.tsx has no date filter and
-- is the correct reference. This migration drops the date_trunc('month', ...) filter,
-- keeping the function name, signature, and return shape identical.

CREATE OR REPLACE FUNCTION public.get_coach_peer_session_usage(_coach_id uuid)
RETURNS TABLE(peer_monthly_limit integer, used_this_month integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    COALESCE(
      (SELECT csl.peer_monthly_limit FROM public.coach_session_limits csl WHERE csl.coach_user_id = _coach_id),
      (SELECT csl.peer_monthly_limit FROM public.coach_session_limits csl WHERE csl.coach_user_id IS NULL),
      4
    ) AS peer_monthly_limit,
    (
      SELECT COUNT(*)::int FROM public.peer_sessions ps
      WHERE ps.peer_coachee_id = _coach_id
        AND ps.status IN ('pending_coach_approval','confirmed','completed')
    ) AS used_this_month;
$$;
