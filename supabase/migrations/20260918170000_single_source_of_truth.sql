-- One authoritative source per business fact.
--
-- Follows 20260918160000_cohort_requirement_schedule (stored cohort dates are
-- the canonical schedule). This migration removes the remaining parallel
-- engines found in the source-of-truth audit (docs/architecture/source-of-truth.md):
--
--   1. Completion / progress: ONE construction, canonical_enrollment_progress
--      (per-module canonical_module_progress -> totals, completion %, due
--      adherence %, overdue, pace, effective status). Learner, Sponsor and
--      Admin read it through thin eligibility wrappers. The former Admin
--      weighted snapshot aggregate (get_admin_enrollment_progress) becomes a
--      projection of it.
--   2. Schedule state: ONE construction for required-vs-scheduled units
--      (cohort_programme_schedule_state), shared by Admin schedule issues and
--      the Learner / Sponsor / Admin schedule-state RPCs.
--   3. Snapshot engine (enrollment_module_snapshots / _milestones via
--      get_enrollment_progress and the cadence functions) is retired from the
--      client API; it stays as historical/derived infrastructure only.
--   4. Superseded Sponsor RPCs with their own goal-progress formula now use
--      the canonical goal progress rule; unused legacy reporting RPCs are no
--      longer executable by clients.
--   5. programme_enrollments.progress_pct (a trigger-maintained, training-only
--      percentage nothing reads) is deprecated and no longer maintained.
--   6. Final-state guard: the migration fails unless the canonical schedule,
--      journey and progress functions have their intended definitions.

-- ---------------------------------------------------------------------------
-- 1. Completion / progress — one construction
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.canonical_enrollment_progress(p_enrollment_id uuid, p_as_of date DEFAULT CURRENT_DATE)
 RETURNS TABLE(enrollment_id uuid, learner_display_name text, programme_label text, cohort_id uuid, cohort_label text, programme_id uuid, enrollment_start_date date, enrollment_end_date date, programme_start_date date, programme_end_date date, enrollment_status enrollment_status, stored_enrollment_status enrollment_status, effective_enrollment_status enrollment_status, required_units integer, completed_units integer, due_units integer, booked_units integer, overdue_units integer, full_completion_pct numeric, due_adherence_pct numeric, pace_status text, progress_available boolean, coaching_required_units integer, coaching_completed_units integer, coaching_due_units integer, coaching_booked_units integer, training_required_units integer, training_completed_units integer, training_due_units integer, training_booked_units integer, peer_required_units integer, peer_completed_units integer, peer_due_units integer, peer_booked_units integer, mentoring_required_units integer, mentoring_completed_units integer, mentoring_due_units integer, mentoring_booked_units integer, triad_required_units integer, triad_completed_units integer, triad_due_units integer, triad_booked_units integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $canon$
  WITH eligible AS (
    SELECT e.id, e.programme_id, e.cohort_id, e.user_id, e.start_date,
      e.end_date, e.status, c.name AS cohort_label,
      c.start_date AS programme_start_date, c.end_date AS programme_end_date,
      p.name AS programme_label, pr.full_name AS learner_display_name
    FROM public.programme_enrollments e
    JOIN public.cohorts c ON c.id = e.cohort_id
    JOIN public.programmes p ON p.id = e.programme_id
    JOIN public.profiles pr ON pr.id = e.user_id
    WHERE e.id = p_enrollment_id
  ), module_rows AS (
    SELECT e.*, g.module,
      g.required_units AS module_required_units,
      g.completed_units AS module_completed_units,
      g.due_units AS module_due_units,
      g.booked_units AS module_booked_units,
      g.overdue_units AS module_overdue_units,
      g.pace_status AS module_pace_status
    FROM eligible e
    LEFT JOIN LATERAL public.canonical_module_progress(e.id, p_as_of) g ON true
  ), grouped AS (
    SELECT e.id, e.learner_display_name, e.programme_label, e.cohort_id,
      e.cohort_label, e.programme_id, e.start_date, e.end_date,
      e.programme_start_date, e.programme_end_date, e.status,
      count(m.module)::integer AS module_count,
      coalesce(sum(m.module_required_units), 0)::integer AS required_units,
      coalesce(sum(m.module_completed_units), 0)::integer AS completed_units,
      coalesce(sum(m.module_due_units), 0)::integer AS due_units,
      coalesce(sum(m.module_booked_units), 0)::integer AS booked_units,
      coalesce(sum(m.module_overdue_units), 0)::integer AS overdue_units,
      coalesce(max(m.module_required_units) FILTER (WHERE m.module = 'coaching'), 0)::integer AS coaching_required_units,
      coalesce(max(m.module_completed_units) FILTER (WHERE m.module = 'coaching'), 0)::integer AS coaching_completed_units,
      coalesce(max(m.module_due_units) FILTER (WHERE m.module = 'coaching'), 0)::integer AS coaching_due_units,
      coalesce(max(m.module_booked_units) FILTER (WHERE m.module = 'coaching'), 0)::integer AS coaching_booked_units,
      coalesce(max(m.module_required_units) FILTER (WHERE m.module = 'training'), 0)::integer AS training_required_units,
      coalesce(max(m.module_completed_units) FILTER (WHERE m.module = 'training'), 0)::integer AS training_completed_units,
      coalesce(max(m.module_due_units) FILTER (WHERE m.module = 'training'), 0)::integer AS training_due_units,
      coalesce(max(m.module_booked_units) FILTER (WHERE m.module = 'training'), 0)::integer AS training_booked_units,
      coalesce(max(m.module_required_units) FILTER (WHERE m.module = 'peer_coaching'), 0)::integer AS peer_required_units,
      coalesce(max(m.module_completed_units) FILTER (WHERE m.module = 'peer_coaching'), 0)::integer AS peer_completed_units,
      coalesce(max(m.module_due_units) FILTER (WHERE m.module = 'peer_coaching'), 0)::integer AS peer_due_units,
      coalesce(max(m.module_booked_units) FILTER (WHERE m.module = 'peer_coaching'), 0)::integer AS peer_booked_units,
      coalesce(max(m.module_required_units) FILTER (WHERE m.module = 'mentoring'), 0)::integer AS mentoring_required_units,
      coalesce(max(m.module_completed_units) FILTER (WHERE m.module = 'mentoring'), 0)::integer AS mentoring_completed_units,
      coalesce(max(m.module_due_units) FILTER (WHERE m.module = 'mentoring'), 0)::integer AS mentoring_due_units,
      coalesce(max(m.module_booked_units) FILTER (WHERE m.module = 'mentoring'), 0)::integer AS mentoring_booked_units,
      coalesce(max(m.module_required_units) FILTER (WHERE m.module = 'triads'), 0)::integer AS triad_required_units,
      coalesce(max(m.module_completed_units) FILTER (WHERE m.module = 'triads'), 0)::integer AS triad_completed_units,
      coalesce(max(m.module_due_units) FILTER (WHERE m.module = 'triads'), 0)::integer AS triad_due_units,
      coalesce(max(m.module_booked_units) FILTER (WHERE m.module = 'triads'), 0)::integer AS triad_booked_units,
      count(m.module) FILTER (WHERE m.module_pace_status = 'behind')::integer AS behind_count,
      count(m.module) FILTER (WHERE m.module_pace_status = 'scheduled')::integer AS scheduled_count,
      count(m.module) FILTER (WHERE m.module_pace_status = 'on_track')::integer AS on_track_count,
      count(m.module) FILTER (WHERE m.module_pace_status = 'ahead')::integer AS ahead_count,
      coalesce(bool_and(m.module_pace_status = 'completed')
        FILTER (WHERE m.module IS NOT NULL), false) AS all_completed
    FROM eligible e
    LEFT JOIN module_rows m ON m.id = e.id
    GROUP BY e.id, e.learner_display_name, e.programme_label, e.cohort_id,
      e.cohort_label, e.programme_id, e.start_date, e.end_date,
      e.programme_start_date, e.programme_end_date, e.status
  ), calculated AS (
    SELECT g.*,
      CASE
        WHEN g.module_count = 0 THEN 'not_yet_due'
        WHEN g.behind_count > 0 THEN 'behind'
        WHEN g.scheduled_count > 0 THEN 'scheduled'
        WHEN g.on_track_count > 0 THEN 'on_track'
        WHEN g.ahead_count > 0 THEN 'ahead'
        WHEN g.all_completed THEN 'completed'
        ELSE 'not_yet_due'
      END AS calculated_pace_status
    FROM grouped g
  )
  SELECT c.id, c.learner_display_name, c.programme_label, c.cohort_id,
    c.cohort_label, c.programme_id, c.start_date, c.end_date,
    c.programme_start_date, c.programme_end_date,
    CASE
      WHEN c.status IN ('active', 'at_risk') AND c.programme_end_date < p_as_of
      THEN CASE WHEN c.all_completed THEN 'completed'::public.enrollment_status
                ELSE 'at_risk'::public.enrollment_status END
      ELSE c.status
    END,
    c.status,
    CASE
      WHEN c.status IN ('active', 'at_risk') AND c.programme_end_date < p_as_of
      THEN CASE WHEN c.all_completed THEN 'completed'::public.enrollment_status
                ELSE 'at_risk'::public.enrollment_status END
      ELSE c.status
    END,
    c.required_units, c.completed_units, c.due_units, c.booked_units,
    c.overdue_units,
    CASE WHEN c.required_units = 0 THEN NULL
      ELSE round(least(c.completed_units, c.required_units) * 100.0 / c.required_units, 1)
    END,
    CASE WHEN c.due_units = 0 THEN NULL
      ELSE round(least(c.completed_units, c.due_units) * 100.0 / c.due_units, 1)
    END,
    c.calculated_pace_status, c.module_count > 0,
    c.coaching_required_units, c.coaching_completed_units, c.coaching_due_units, c.coaching_booked_units,
    c.training_required_units, c.training_completed_units, c.training_due_units, c.training_booked_units,
    c.peer_required_units, c.peer_completed_units, c.peer_due_units, c.peer_booked_units,
    c.mentoring_required_units, c.mentoring_completed_units, c.mentoring_due_units, c.mentoring_booked_units,
    c.triad_required_units, c.triad_completed_units, c.triad_due_units, c.triad_booked_units
  FROM calculated c;
$canon$;

REVOKE ALL ON FUNCTION public.canonical_enrollment_progress(uuid, date) FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.canonical_enrollment_progress(uuid, date) IS
  'THE canonical enrollment completion/progress construction (required, completed, due, overdue, completion %, due adherence %, pace, effective status). Internal: every role reads it through an eligibility wrapper.';

CREATE OR REPLACE FUNCTION public.learner_canonical_progress(p_enrollment_id uuid, p_as_of date DEFAULT CURRENT_DATE)
RETURNS TABLE(enrollment_id uuid, learner_display_name text, programme_label text, cohort_id uuid, cohort_label text, programme_id uuid, enrollment_start_date date, enrollment_end_date date, programme_start_date date, programme_end_date date, enrollment_status enrollment_status, stored_enrollment_status enrollment_status, effective_enrollment_status enrollment_status, required_units integer, completed_units integer, due_units integer, booked_units integer, overdue_units integer, full_completion_pct numeric, due_adherence_pct numeric, pace_status text, progress_available boolean, coaching_required_units integer, coaching_completed_units integer, coaching_due_units integer, coaching_booked_units integer, training_required_units integer, training_completed_units integer, training_due_units integer, training_booked_units integer, peer_required_units integer, peer_completed_units integer, peer_due_units integer, peer_booked_units integer, mentoring_required_units integer, mentoring_completed_units integer, mentoring_due_units integer, mentoring_booked_units integer, triad_required_units integer, triad_completed_units integer, triad_due_units integer, triad_booked_units integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  -- Learner self-view: own enrollment only.
  SELECT p.*
  FROM public.programme_enrollments e
  CROSS JOIN LATERAL public.canonical_enrollment_progress(e.id, p_as_of) p
  WHERE e.id = p_enrollment_id
    AND e.user_id = auth.uid()
    AND auth.uid() IS NOT NULL;
$$;

CREATE OR REPLACE FUNCTION public.sponsor_canonical_enrollment_progress(p_cohort_id uuid DEFAULT NULL::uuid, p_as_of date DEFAULT CURRENT_DATE)
RETURNS TABLE(enrollment_id uuid, learner_display_name text, programme_label text, cohort_id uuid, cohort_label text, programme_id uuid, enrollment_start_date date, enrollment_end_date date, programme_start_date date, programme_end_date date, enrollment_status enrollment_status, stored_enrollment_status enrollment_status, effective_enrollment_status enrollment_status, required_units integer, completed_units integer, due_units integer, booked_units integer, overdue_units integer, full_completion_pct numeric, due_adherence_pct numeric, pace_status text, progress_available boolean, coaching_required_units integer, coaching_completed_units integer, coaching_due_units integer, coaching_booked_units integer, training_required_units integer, training_completed_units integer, training_due_units integer, training_booked_units integer, peer_required_units integer, peer_completed_units integer, peer_due_units integer, peer_booked_units integer, mentoring_required_units integer, mentoring_completed_units integer, mentoring_due_units integer, mentoring_booked_units integer, triad_required_units integer, triad_completed_units integer, triad_due_units integer, triad_booked_units integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  -- Sponsor: own organisation's cohorts, minimum-cohort-size rule unchanged.
  WITH sponsor AS (
    SELECT sp.organization_id
    FROM public.sponsor_profiles sp
    WHERE sp.user_id = auth.uid()
      AND auth.uid() IS NOT NULL
  ), eligible AS (
    SELECT e.id
    FROM public.programme_enrollments e
    JOIN public.cohorts c ON c.id = e.cohort_id
    JOIN sponsor s ON s.organization_id = c.organization_id
    WHERE (p_cohort_id IS NULL OR e.cohort_id = p_cohort_id)
      AND (
        SELECT count(*)
        FROM public.programme_enrollments ec
        JOIN public.cohorts ec_c ON ec_c.id = ec.cohort_id
        WHERE ec.cohort_id = e.cohort_id
          AND ec_c.organization_id = c.organization_id
      ) >= public.sponsor_min_leaders_for_distribution()
  )
  SELECT p.*
  FROM eligible e
  CROSS JOIN LATERAL public.canonical_enrollment_progress(e.id, p_as_of) p
  ORDER BY p.cohort_label, p.learner_display_name, p.enrollment_id;
$$;

-- Admin: any enrollment, same numbers.
CREATE OR REPLACE FUNCTION public.admin_canonical_enrollment_progress(p_enrollment_ids uuid[], p_as_of date DEFAULT CURRENT_DATE)
RETURNS TABLE(enrollment_id uuid, learner_display_name text, programme_label text, cohort_id uuid, cohort_label text, programme_id uuid, enrollment_start_date date, enrollment_end_date date, programme_start_date date, programme_end_date date, enrollment_status enrollment_status, stored_enrollment_status enrollment_status, effective_enrollment_status enrollment_status, required_units integer, completed_units integer, due_units integer, booked_units integer, overdue_units integer, full_completion_pct numeric, due_adherence_pct numeric, pace_status text, progress_available boolean, coaching_required_units integer, coaching_completed_units integer, coaching_due_units integer, coaching_booked_units integer, training_required_units integer, training_completed_units integer, training_due_units integer, training_booked_units integer, peer_required_units integer, peer_completed_units integer, peer_due_units integer, peer_booked_units integer, mentoring_required_units integer, mentoring_completed_units integer, mentoring_due_units integer, mentoring_booked_units integer, triad_required_units integer, triad_completed_units integer, triad_due_units integer, triad_booked_units integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT p.*
  FROM (SELECT DISTINCT unnest(p_enrollment_ids) AS id) requested
  CROSS JOIN LATERAL public.canonical_enrollment_progress(requested.id, p_as_of) p
  WHERE public.has_role(auth.uid(), 'admin'::public.app_role);
$$;

REVOKE ALL ON FUNCTION public.admin_canonical_enrollment_progress(uuid[], date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_canonical_enrollment_progress(uuid[], date) TO authenticated;

-- The former Admin weighted snapshot aggregate, now a projection of the
-- canonical completion % (kept for API compatibility).
CREATE OR REPLACE FUNCTION public.get_admin_enrollment_progress(p_enrollment_ids uuid[], p_as_of date DEFAULT CURRENT_DATE)
RETURNS TABLE(enrollment_id uuid, full_completion_pct numeric)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT p.enrollment_id, p.full_completion_pct
  FROM public.admin_canonical_enrollment_progress(p_enrollment_ids, p_as_of) p;
$$;

-- Admin view of the ONE shared journey construction.
CREATE OR REPLACE FUNCTION public.admin_canonical_enrollment_journey(p_enrollment_id uuid, p_as_of date DEFAULT CURRENT_DATE)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN public.has_role(auth.uid(), 'admin'::public.app_role)
     AND EXISTS (SELECT 1 FROM public.programme_enrollments e WHERE e.id = p_enrollment_id AND e.cohort_id IS NOT NULL)
    THEN public.canonical_enrollment_journey(p_enrollment_id, p_as_of)
    ELSE '[]'::jsonb
  END;
$$;

REVOKE ALL ON FUNCTION public.admin_canonical_enrollment_journey(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_canonical_enrollment_journey(uuid, date) TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. Schedule state — required (programme) vs scheduled (cohort) units
-- ---------------------------------------------------------------------------
-- Deterministic mismatch rule: requirements come from the programme, dates
-- from the cohort. When they disagree nothing is invented or dropped; every
-- role receives the same explicit state until an Admin reconciles it.
CREATE OR REPLACE FUNCTION public.cohort_programme_schedule_state(p_cohort_id uuid, p_programme_id uuid)
RETURNS TABLE (
  module public.programme_module_type,
  required_units integer,
  scheduled_units integer,
  state text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH scope AS (
    SELECT pm.module,
      CASE
        WHEN coalesce((pm.config->>'required')::boolean, false)
        THEN coalesce(public.programme_config_integer(pm.config, 'required_units'), 0)
        ELSE 0
      END AS required_units
    FROM public.programme_modules pm
    WHERE pm.programme_id = p_programme_id
      AND pm.enabled
      AND pm.module <> 'training'::public.programme_module_type
  ), scheduled AS (
    SELECT d.module, sum(d.units)::integer AS units
    FROM public.cohort_requirement_dates d
    WHERE d.cohort_id = p_cohort_id
      AND d.programme_id = p_programme_id
    GROUP BY d.module
  )
  SELECT coalesce(s.module, sc.module),
    coalesce(s.required_units, 0),
    coalesce(sc.units, 0),
    CASE
      WHEN coalesce(s.required_units, 0) = coalesce(sc.units, 0) THEN 'aligned'
      WHEN coalesce(s.required_units, 0) > coalesce(sc.units, 0) THEN 'missing_dates'
      ELSE 'surplus_dates'
    END
  FROM (SELECT * FROM scope WHERE required_units > 0) s
  FULL JOIN scheduled sc ON sc.module = s.module
  ORDER BY 1;
$$;

REVOKE ALL ON FUNCTION public.cohort_programme_schedule_state(uuid, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.canonical_enrollment_schedule_state(p_enrollment_id uuid)
RETURNS TABLE (
  module public.programme_module_type,
  required_units integer,
  scheduled_units integer,
  state text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT s.*
  FROM public.programme_enrollments e
  CROSS JOIN LATERAL public.cohort_programme_schedule_state(e.cohort_id, e.programme_id) s
  WHERE e.id = p_enrollment_id
    AND e.cohort_id IS NOT NULL;
$$;

REVOKE ALL ON FUNCTION public.canonical_enrollment_schedule_state(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.learner_canonical_schedule_state(p_enrollment_id uuid)
RETURNS TABLE (module public.programme_module_type, required_units integer, scheduled_units integer, state text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT s.*
  FROM public.programme_enrollments e
  CROSS JOIN LATERAL public.canonical_enrollment_schedule_state(e.id) s
  WHERE e.id = p_enrollment_id
    AND e.user_id = auth.uid()
    AND auth.uid() IS NOT NULL;
$$;

CREATE OR REPLACE FUNCTION public.sponsor_canonical_leader_schedule_state(p_enrollment_id uuid)
RETURNS TABLE (module public.programme_module_type, required_units integer, scheduled_units integer, state text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT s.*
  FROM public.programme_enrollments e
  JOIN public.cohorts c ON c.id = e.cohort_id
  JOIN public.sponsor_profiles sp
    ON sp.organization_id = c.organization_id
   AND sp.user_id = auth.uid()
  CROSS JOIN LATERAL public.canonical_enrollment_schedule_state(e.id) s
  WHERE e.id = p_enrollment_id
    AND auth.uid() IS NOT NULL
    AND (
      SELECT count(*) FROM public.programme_enrollments same_cohort
      WHERE same_cohort.cohort_id = e.cohort_id
    ) >= public.sponsor_min_leaders_for_distribution();
$$;

CREATE OR REPLACE FUNCTION public.admin_canonical_schedule_state(p_enrollment_id uuid)
RETURNS TABLE (module public.programme_module_type, required_units integer, scheduled_units integer, state text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT s.*
  FROM public.canonical_enrollment_schedule_state(p_enrollment_id) s
  WHERE public.has_role(auth.uid(), 'admin'::public.app_role);
$$;

REVOKE ALL ON FUNCTION public.learner_canonical_schedule_state(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.sponsor_canonical_leader_schedule_state(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_canonical_schedule_state(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.learner_canonical_schedule_state(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sponsor_canonical_leader_schedule_state(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_canonical_schedule_state(uuid) TO authenticated;

-- Admin schedule issues reuse the same required-vs-scheduled construction.
CREATE OR REPLACE FUNCTION public.cohort_requirement_schedule_issues(p_cohort_id uuid)
RETURNS TABLE (
  programme_id uuid,
  module public.programme_module_type,
  issue text,
  required_units integer,
  scheduled_units integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Only admins can review cohort requirement schedules' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  WITH cohort AS (
    SELECT c.start_date, c.end_date FROM public.cohorts c WHERE c.id = p_cohort_id
  ), st AS (
    SELECT sp.programme_id AS programme_id, s.module AS module, s.required_units AS required_units,
      s.scheduled_units AS scheduled_units, s.state AS state
    FROM public.cohort_scheduled_programmes(p_cohort_id) sp
    CROSS JOIN LATERAL public.cohort_programme_schedule_state(p_cohort_id, sp.programme_id) s
  )
  SELECT st.programme_id, st.module,
    CASE WHEN st.required_units = 0 THEN 'out_of_scope' ELSE st.state END,
    CASE WHEN st.required_units = 0 THEN NULL::integer ELSE st.required_units END,
    st.scheduled_units
  FROM st
  WHERE st.state <> 'aligned'
  UNION ALL
  SELECT d.programme_id, d.module, 'outside_cohort'::text, max(st.required_units), sum(d.units)::integer
  FROM public.cohort_requirement_dates d
  CROSS JOIN cohort co
  LEFT JOIN st ON st.programme_id = d.programme_id AND st.module = d.module
  WHERE d.cohort_id = p_cohort_id
    AND (d.due_on < co.start_date OR d.due_on > co.end_date)
  GROUP BY d.programme_id, d.module;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. Snapshot engine: historical / derived only, not a client-facing source
-- ---------------------------------------------------------------------------
COMMENT ON TABLE public.enrollment_module_snapshots IS
  'DERIVED / HISTORICAL. Per-enrollment record of the module configuration at enrollment time (used for activity-to-milestone attribution history). NOT a source of current requirements, dates or completion: use programme_modules, cohort_requirement_dates and canonical_enrollment_progress.';
COMMENT ON TABLE public.enrollment_module_milestones IS
  'DERIVED / HISTORICAL. Enrollment-date-anchored milestones generated at enrollment time; used only to record which milestone an activity was attributed to. NOT the canonical due date (cohort_requirement_dates) and NOT a completion source (canonical_enrollment_progress).';
COMMENT ON FUNCTION public.get_enrollment_progress(uuid, date) IS
  'HISTORICAL snapshot progress engine. Not client-callable; the canonical completion source is canonical_enrollment_progress.';

REVOKE EXECUTE ON FUNCTION public.get_enrollment_progress(uuid, date) FROM PUBLIC, anon, authenticated;
-- Snapshot cadence readers and superseded Sponsor reporting RPCs that no
-- surface uses. These exist on hosted production but are not created by any
-- migration in this repository (schema drift), so they are handled only when
-- present: revoked from clients, never dropped blindly.
DO $retire$
DECLARE
  fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'public.sponsor_leader_cadence_items(uuid,date)',
    'public.sponsor_cohort_cadence_items(uuid,date)',
    'public.sponsor_cohort_summaries_legacy(uuid)',
    'public.sponsor_organisation_summary_legacy()',
    'public.sponsor_metric_rows(uuid,date)',
    'public.sponsor_metric_rows_legacy(uuid,date)',
    'public.sponsor_enrollment_next_session(uuid)',
    'public.sponsor_leader_programme_history(uuid)'
  ] LOOP
    IF to_regprocedure(fn) IS NOT NULL THEN
      EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn);
      EXECUTE format('COMMENT ON FUNCTION %s IS %L', fn,
        'RETIRED — not client-callable; not created by the repository migration chain. Canonical sources: canonical_enrollment_progress, canonical_enrollment_journey.');
    END IF;
  END LOOP;
END
$retire$;

-- ---------------------------------------------------------------------------
-- 4. One goal / action engagement rule (canonical_enrollment_engagement)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sponsor_leader_engagement_summary(p_enrollment_id uuid)
RETURNS TABLE(goal_count integer, goal_setup boolean, goal_progress_pct numeric, open_action_count integer, completed_action_count integer, total_action_count integer, action_completion_pct numeric, satisfaction_avg numeric, satisfaction_rated_count integer, last_coaching_activity_on date)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  -- Projection of canonical_enrollment_engagement (the goal/action/
  -- satisfaction rule Learner and Sponsor metadata use) plus the latest
  -- canonical coaching activity date. Sponsor eligibility unchanged.
  WITH eligible AS (
    SELECT e.id
    FROM public.programme_enrollments e
    JOIN public.cohorts c ON c.id = e.cohort_id
    JOIN public.sponsor_profiles sp
      ON sp.organization_id = c.organization_id
     AND sp.user_id = auth.uid()
    WHERE e.id = p_enrollment_id
      AND auth.uid() IS NOT NULL
      AND (
        SELECT count(*)
        FROM public.programme_enrollments same_cohort
        WHERE same_cohort.cohort_id = e.cohort_id
      ) >= public.sponsor_min_leaders_for_distribution()
  )
  SELECT
    coalesce(ce.goal_count, 0), coalesce(ce.goal_setup, false), ce.goal_progress_pct,
    coalesce(ce.open_action_count, 0), coalesce(ce.completed_action_count, 0),
    coalesce(ce.total_action_count, 0), ce.action_completion_pct,
    ce.satisfaction_avg, coalesce(ce.satisfaction_rated_count, 0),
    (SELECT max(a.occurred_on) FILTER (WHERE a.status = 'completed')
     FROM public.sponsor_canonical_activity(e.id) a
     WHERE a.module = 'coaching')
  FROM eligible e
  LEFT JOIN LATERAL public.canonical_enrollment_engagement(e.id) ce ON true;
$$;

-- Older Sponsor summaries keep their API but use the canonical goal
-- progress rule (archived goals excluded; unrated / non-increasing targets
-- have no progress) — the rule canonical_goal_progress defines.
DO $goals$
DECLARE
  def text;
  patched text;
BEGIN
  def := pg_get_functiondef('public.sponsor_enrollment_summaries(uuid)'::regprocedure);
  patched := replace(def,
    'OR gr.target_rating = gr.start_rating THEN NULL',
    'OR gr.current_rating IS NULL OR gr.target_rating <= gr.start_rating THEN NULL');
  patched := replace(patched,
    'LEFT JOIN public.coachee_goals g ON g.enrollment_id = e.id',
    'LEFT JOIN public.coachee_goals g ON g.enrollment_id = e.id AND g.status <> ''archived''');
  IF patched = def OR position('current_rating IS NULL' IN patched) = 0 OR position('status <> ''archived''' IN patched) = 0 THEN
    RAISE EXCEPTION 'sponsor_enrollment_summaries goal rule not found';
  END IF;
  EXECUTE patched;

  def := pg_get_functiondef('public.sponsor_organisation_summary()'::regprocedure);
  patched := replace(def,
    'OR r.target_rating=r.start_rating THEN NULL',
    'OR r.current_rating IS NULL OR r.target_rating <= r.start_rating THEN NULL');
  patched := replace(patched,
    'LEFT JOIN public.coachee_goals g ON g.enrollment_id=e.id',
    'LEFT JOIN public.coachee_goals g ON g.enrollment_id=e.id AND g.status <> ''archived''');
  IF patched = def OR position('current_rating IS NULL' IN patched) = 0 OR position('status <> ''archived''' IN patched) = 0 THEN
    RAISE EXCEPTION 'sponsor_organisation_summary goal rule not found';
  END IF;
  EXECUTE patched;
END
$goals$;

-- ---------------------------------------------------------------------------
-- 5. Deprecated stored percentage
-- ---------------------------------------------------------------------------
-- progress_pct was a trigger-maintained training-week percentage that no
-- screen or canonical function reads. A second "completion %" must not
-- exist, so it is no longer maintained and is cleared.
DROP TRIGGER IF EXISTS trg_sessions_update_progress_pct ON public.sessions;
DROP TRIGGER IF EXISTS trg_training_progress_update_pct ON public.training_progress;
REVOKE EXECUTE ON FUNCTION public.refresh_all_progress_pct() FROM PUBLIC, anon, authenticated;
ALTER TABLE public.programme_enrollments ALTER COLUMN progress_pct DROP NOT NULL;
ALTER TABLE public.programme_enrollments ALTER COLUMN progress_pct DROP DEFAULT;
UPDATE public.programme_enrollments SET progress_pct = NULL WHERE progress_pct IS NOT NULL;
COMMENT ON COLUMN public.programme_enrollments.progress_pct IS
  'DEPRECATED — not maintained, always NULL. Completion is canonical_enrollment_progress.full_completion_pct.';

-- ---------------------------------------------------------------------------
-- 6. Final-state guard (runs on every replay and on hosted deployment)
-- ---------------------------------------------------------------------------
DO $guard$
DECLARE
  schedule_def text := pg_get_functiondef('public.sponsor_canonical_module_schedule(uuid)'::regprocedure);
BEGIN
  IF schedule_def !~ 'cohort_requirement_dates'
     OR schedule_def ~ 'evenly_distributed|monthly_frequency|distribution_mode|generate_series' THEN
    RAISE EXCEPTION 'sponsor_canonical_module_schedule is not reading stored cohort requirement dates';
  END IF;
  IF pg_get_functiondef('public.canonical_enrollment_journey(uuid,date)'::regprocedure) !~ 'sponsor_canonical_module_schedule'
     OR pg_get_functiondef('public.learner_canonical_journey(uuid,date)'::regprocedure) !~ 'canonical_enrollment_journey'
     OR pg_get_functiondef('public.sponsor_canonical_leader_journey(uuid,date)'::regprocedure) !~ 'canonical_enrollment_journey' THEN
    RAISE EXCEPTION 'Learner / Sponsor journeys must share canonical_enrollment_journey';
  END IF;
  IF pg_get_functiondef('public.learner_canonical_progress(uuid,date)'::regprocedure) !~ 'canonical_enrollment_progress'
     OR pg_get_functiondef('public.sponsor_canonical_enrollment_progress(uuid,date)'::regprocedure) !~ 'canonical_enrollment_progress'
     OR pg_get_functiondef('public.admin_canonical_enrollment_progress(uuid[],date)'::regprocedure) !~ 'canonical_enrollment_progress' THEN
    RAISE EXCEPTION 'Learner / Sponsor / Admin progress must share canonical_enrollment_progress';
  END IF;
END
$guard$;
