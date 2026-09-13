-- Sponsor Leader Detail page (2026-09-13, follow-on spec).
--
-- This page must reuse -- never recompute -- the canonical Enrollment
-- Status / On Track / Cadence Completion / Goal Progress values already
-- produced by public.sponsor_enrollment_summaries(p_cohort_id) (fixed in
-- 20260913120000). The frontend calls that same RPC and looks up the one
-- row for the requested enrollment_id, so there is no second calculation
-- path to drift out of sync -- see the delivery report for confirmation.
--
-- This migration adds the three pieces of data the Leader page needs that
-- the cohort-level RPCs don't already carry:
--   1. sponsor_leader_cadence_items   -- the per-enrollment Programme Journey
--   2. sponsor_leader_programme_history -- prior completed enrollments for
--      the same person, within the sponsor's own organisation
--   3. sponsor_enrollment_next_session -- next scheduled 1:1 coaching date
--      only (no coach identity, no notes, no topic)
--
-- All three are SECURITY DEFINER and independently re-check that the
-- calling sponsor's organisation owns the enrollment's cohort, and that the
-- cohort still meets the k-anonymity floor
-- (sponsor_min_leaders_for_distribution) -- the same gate
-- sponsor_enrollment_summaries already applies, so a leader in a
-- below-threshold cohort is not reachable through these functions even by
-- guessing a URL.

DROP FUNCTION IF EXISTS public.sponsor_leader_cadence_items(uuid, date);
CREATE FUNCTION public.sponsor_leader_cadence_items(
  p_enrollment_id uuid,
  p_as_of date DEFAULT current_date
)
RETURNS TABLE (
  module public.programme_module_type,
  sequence integer,
  due_on date,
  window_end_on date,
  completed boolean
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  WITH sponsor AS (
    SELECT DISTINCT organization_id
    FROM public.sponsor_profiles
    WHERE user_id = auth.uid()
  ), scoped_enrollment AS (
    SELECT e.id
    FROM public.programme_enrollments e
    JOIN public.cohorts c ON c.id = e.cohort_id
    JOIN sponsor sp ON sp.organization_id = c.organization_id
    WHERE e.id = p_enrollment_id
      AND (
        SELECT count(*) FROM public.programme_enrollments ec WHERE ec.cohort_id = e.cohort_id
      ) >= public.sponsor_min_leaders_for_distribution()
  ), snapshots AS (
    SELECT s.id, s.module
    FROM public.enrollment_module_snapshots s
    JOIN scoped_enrollment se ON se.id = s.enrollment_id
    WHERE s.required = true
  ), progress AS (
    SELECT s.module, ep.completed_units
    FROM snapshots s
    JOIN LATERAL public.get_enrollment_progress(p_enrollment_id, p_as_of) ep
      ON ep.module = s.module
  )
  SELECT
    s.module,
    m.sequence,
    m.due_on,
    m.window_end_on,
    (coalesce(pr.completed_units, 0) >= m.sequence) AS completed
  FROM snapshots s
  JOIN public.enrollment_module_milestones m ON m.enrollment_module_snapshot_id = s.id
  LEFT JOIN progress pr ON pr.module = s.module
  ORDER BY m.due_on, s.module, m.sequence;
$$;

REVOKE ALL ON FUNCTION public.sponsor_leader_cadence_items(uuid, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sponsor_leader_cadence_items(uuid, date) TO authenticated;

DROP FUNCTION IF EXISTS public.sponsor_leader_programme_history(uuid);
CREATE FUNCTION public.sponsor_leader_programme_history(p_enrollment_id uuid)
RETURNS TABLE (
  enrollment_id uuid,
  programme_label text,
  cohort_label text,
  start_date date,
  end_date date,
  status public.enrollment_status
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  WITH sponsor AS (
    SELECT DISTINCT organization_id
    FROM public.sponsor_profiles
    WHERE user_id = auth.uid()
  ), current_enrollment AS (
    SELECT e.user_id, c.organization_id
    FROM public.programme_enrollments e
    JOIN public.cohorts c ON c.id = e.cohort_id
    JOIN sponsor sp ON sp.organization_id = c.organization_id
    WHERE e.id = p_enrollment_id
      AND (
        SELECT count(*) FROM public.programme_enrollments ec WHERE ec.cohort_id = e.cohort_id
      ) >= public.sponsor_min_leaders_for_distribution()
  )
  SELECT e.id, p.name, c.name, e.start_date, e.end_date, e.status
  FROM public.programme_enrollments e
  JOIN current_enrollment ce ON ce.user_id = e.user_id
  JOIN public.cohorts c ON c.id = e.cohort_id
  JOIN public.programmes p ON p.id = e.programme_id
  WHERE e.id <> p_enrollment_id
    AND e.status = 'completed'::public.enrollment_status
    AND c.organization_id = ce.organization_id
    AND (
      SELECT count(*) FROM public.programme_enrollments ec WHERE ec.cohort_id = e.cohort_id
    ) >= public.sponsor_min_leaders_for_distribution()
  ORDER BY e.end_date DESC NULLS LAST, e.start_date DESC;
$$;

REVOKE ALL ON FUNCTION public.sponsor_leader_programme_history(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sponsor_leader_programme_history(uuid) TO authenticated;

-- Next scheduled 1:1 coaching session -- date only. No topic, no meeting
-- link, no coach name: the coach identity/content withholding rule from the
-- existing Sponsor privacy model applies here exactly as it does elsewhere.
DROP FUNCTION IF EXISTS public.sponsor_enrollment_next_session(uuid);
CREATE FUNCTION public.sponsor_enrollment_next_session(p_enrollment_id uuid)
RETURNS timestamptz
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  WITH sponsor AS (
    SELECT DISTINCT organization_id
    FROM public.sponsor_profiles
    WHERE user_id = auth.uid()
  ), scoped_enrollment AS (
    SELECT e.id
    FROM public.programme_enrollments e
    JOIN public.cohorts c ON c.id = e.cohort_id
    JOIN sponsor sp ON sp.organization_id = c.organization_id
    WHERE e.id = p_enrollment_id
      AND (
        SELECT count(*) FROM public.programme_enrollments ec WHERE ec.cohort_id = e.cohort_id
      ) >= public.sponsor_min_leaders_for_distribution()
  )
  SELECT min(s.start_time)
  FROM public.sessions s
  JOIN scoped_enrollment se ON se.id = s.enrollment_id
  WHERE s.status IN ('pending_coach_approval', 'confirmed')
    AND s.start_time >= now();
$$;

REVOKE ALL ON FUNCTION public.sponsor_enrollment_next_session(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sponsor_enrollment_next_session(uuid) TO authenticated;
