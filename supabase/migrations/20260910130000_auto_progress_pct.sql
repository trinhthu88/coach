-- programme_enrollments.progress_pct was a free-standing integer nobody
-- wrote to programmatically (only ever set by hand via admin UI/seed
-- data), so it silently drifted from what a leader had actually done.
-- compute_leader_progress() derives it instead: % of already-unlocked,
-- visible training weeks (for this leader's own cohort-relative unlock
-- schedule — same effective-unlock-date formula as
-- 20260910100000_cohort_week_overrides.sql) whose skill card the leader
-- has completed.
--
-- compute_leader_progress() takes p_user_id/p_enrollment_id (not pinned to
-- auth.uid()) because its two real callers — the triggers below and
-- sponsor_roster() — always run inside another SECURITY DEFINER function's
-- execution context, which needs to compute a *different* user's progress
-- than the caller. That's also exactly why it is NOT granted to
-- `authenticated`: unlike the sponsor_* RPC family (which self-scope to
-- get_sponsor_org(auth.uid())) or refresh_all_progress_pct() below (which
-- self-checks has_role admin), this function has no such internal guard —
-- granting it to authenticated would let any signed-in user probe any
-- other user's progress by RPC-calling it directly with an arbitrary
-- p_user_id/p_enrollment_id. Revoking from PUBLIC/anon and never granting
-- to authenticated keeps it reachable only from other SECURITY DEFINER
-- functions/triggers already running with elevated privileges, matching
-- RULES.md's documented "self-pinned unless explicitly scoped" convention
-- for parameterized functions.
CREATE OR REPLACE FUNCTION public.compute_leader_progress(
  p_user_id uuid,
  p_enrollment_id uuid
)
RETURNS integer
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH enrollment AS (
    SELECT pe.programme_id, pe.cohort_id, pe.start_date, c.start_date AS cohort_start
    FROM public.programme_enrollments pe
    LEFT JOIN public.cohorts c ON c.id = pe.cohort_id
    WHERE pe.id = p_enrollment_id
  ),
  total_weeks AS (
    SELECT COUNT(*) AS n
    FROM public.training_weeks tw
    JOIN enrollment e ON tw.programme_id = e.programme_id
    LEFT JOIN public.cohort_week_overrides cwo
      ON cwo.cohort_id = e.cohort_id AND cwo.training_week_id = tw.id
    WHERE tw.is_visible = true
      AND COALESCE(
            cwo.unlock_date,
            CASE WHEN e.cohort_id IS NOT NULL
              THEN (e.cohort_start + ((tw.week_number - 1) * INTERVAL '7 days'))::date
              ELSE NULL
            END,
            tw.unlock_date,
            CURRENT_DATE
          ) <= CURRENT_DATE
  ),
  completed_weeks AS (
    SELECT COUNT(DISTINCT tp.training_week_id) AS n
    FROM public.training_progress tp
    JOIN public.training_weeks tw ON tw.id = tp.training_week_id
    JOIN enrollment e ON tw.programme_id = e.programme_id
    WHERE tp.user_id = p_user_id
      AND tp.completed_at IS NOT NULL
  )
  SELECT
    CASE
      WHEN total_weeks.n = 0 THEN 0
      ELSE LEAST(100, ROUND(completed_weeks.n * 100.0 / total_weeks.n))::integer
    END
  FROM total_weeks, completed_weeks
$$;

REVOKE EXECUTE ON FUNCTION public.compute_leader_progress(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- Recompute on skill-card completion.
CREATE OR REPLACE FUNCTION public.trg_update_progress_from_training()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_enrollment_id uuid;
BEGIN
  SELECT pe.id INTO v_enrollment_id
  FROM public.programme_enrollments pe
  JOIN public.training_weeks tw ON tw.programme_id = pe.programme_id
  WHERE pe.user_id = NEW.user_id
    AND tw.id = NEW.training_week_id
    AND pe.status = 'active'
  ORDER BY pe.start_date DESC
  LIMIT 1;

  IF v_enrollment_id IS NOT NULL THEN
    UPDATE public.programme_enrollments
    SET progress_pct = public.compute_leader_progress(NEW.user_id, v_enrollment_id)
    WHERE id = v_enrollment_id;
  END IF;

  RETURN NEW;
END;
$$;

-- Trigger functions can't be invoked directly via SQL/RPC (Postgres
-- rejects calling a RETURNS trigger function outside trigger context), so
-- this REVOKE is hygiene rather than a meaningful access gate — kept for
-- consistency with every other function in this migration.
REVOKE EXECUTE ON FUNCTION public.trg_update_progress_from_training() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_training_progress_update_pct ON public.training_progress;
CREATE TRIGGER trg_training_progress_update_pct
AFTER INSERT OR UPDATE ON public.training_progress
FOR EACH ROW EXECUTE FUNCTION public.trg_update_progress_from_training();

-- Recompute on session completion too. Note: compute_leader_progress()'s
-- formula (per the task spec this migration implements) only looks at
-- training-week skill-card completion, not sessions — so today this fires
-- a recompute that lands on the same value skill-card completion would
-- have already produced. Kept as its own trigger (rather than skipped)
-- so a future session-aware revision of the formula picks up session
-- completions automatically without a second migration to add the hook.
CREATE OR REPLACE FUNCTION public.trg_update_progress_from_session()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_enrollment_id uuid;
BEGIN
  IF NEW.status <> 'completed' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'completed' THEN
    RETURN NEW;
  END IF;

  SELECT pe.id INTO v_enrollment_id
  FROM public.programme_enrollments pe
  WHERE pe.user_id = NEW.coachee_id
    AND pe.status = 'active'
  ORDER BY pe.start_date DESC
  LIMIT 1;

  IF v_enrollment_id IS NOT NULL THEN
    UPDATE public.programme_enrollments
    SET progress_pct = public.compute_leader_progress(NEW.coachee_id, v_enrollment_id)
    WHERE id = v_enrollment_id;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.trg_update_progress_from_session() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_sessions_update_progress_pct ON public.sessions;
CREATE TRIGGER trg_sessions_update_progress_pct
AFTER INSERT OR UPDATE OF status ON public.sessions
FOR EACH ROW EXECUTE FUNCTION public.trg_update_progress_from_session();

-- Admin-callable backfill for existing enrollments (self-checks admin
-- role, since it's meant to be reachable via RPC unlike
-- compute_leader_progress above).
CREATE OR REPLACE FUNCTION public.refresh_all_progress_pct()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_count integer := 0;
  r RECORD;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Only admins may refresh progress_pct';
  END IF;

  FOR r IN SELECT id, user_id FROM public.programme_enrollments WHERE status = 'active' LOOP
    UPDATE public.programme_enrollments
    SET progress_pct = public.compute_leader_progress(r.user_id, r.id)
    WHERE id = r.id;
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.refresh_all_progress_pct() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.refresh_all_progress_pct() TO authenticated;

-- FIX 5: sponsor_roster() now reports the same computed progress_pct
-- instead of the raw (previously hand-set, often-stale) column — same
-- RETURNS TABLE shape as 20260909043650_sponsor_rpc_cohort_filter.sql, so
-- this is a plain CREATE OR REPLACE, no DROP needed.
CREATE OR REPLACE FUNCTION public.sponsor_roster(p_cohort_id uuid DEFAULT NULL)
RETURNS TABLE(enrollment_id uuid, coachee_id uuid, full_name text, cohort_name text, enrollment_status enrollment_status, progress_pct integer, sessions_completed integer, sessions_entitled integer, goal_growth numeric)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT
    pe.id AS enrollment_id,
    pe.user_id AS coachee_id,
    p.full_name,
    c.name AS cohort_name,
    pe.status AS enrollment_status,
    public.compute_leader_progress(pe.user_id, pe.id) AS progress_pct,
    (
      SELECT COUNT(*)::int FROM public.sessions s
      WHERE s.coachee_id = pe.user_id
        AND s.status = 'completed'
        AND s.start_time >= pe.start_date
        AND (pe.end_date IS NULL OR s.start_time < pe.end_date + INTERVAL '1 day')
    ) AS sessions_completed,
    prog.coachee_session_limit AS sessions_entitled,
    (
      SELECT AVG(
        LEAST(100, GREATEST(0,
          ROUND((gr.current_rating - gr.start_rating)::numeric / GREATEST(1, gr.target_rating - gr.start_rating) * 100)
        ))
      )
      FROM public.coachee_goals g
      JOIN public.coachee_goal_ratings gr ON gr.goal_id = g.id
      WHERE g.coachee_id = pe.user_id
    ) AS goal_growth
  FROM public.programme_enrollments pe
  JOIN public.profiles p ON p.id = pe.user_id
  JOIN public.programmes prog ON prog.id = pe.programme_id
  LEFT JOIN public.cohorts c ON c.id = pe.cohort_id
  WHERE COALESCE(pe.organization_id, c.organization_id) IS NOT NULL
    AND COALESCE(pe.organization_id, c.organization_id) = public.get_sponsor_org(auth.uid())
    AND (p_cohort_id IS NULL OR pe.cohort_id = p_cohort_id)
  ORDER BY p.full_name;
$function$;

REVOKE EXECUTE ON FUNCTION public.sponsor_roster(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sponsor_roster(uuid) TO authenticated;
