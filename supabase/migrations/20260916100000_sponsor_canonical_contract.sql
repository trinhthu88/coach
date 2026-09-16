-- Additive Sponsor source-of-truth contract.
--
-- Existing Sponsor RPCs are intentionally left unchanged. These functions
-- compose the hosted get_enrollment_progress() result with Sponsor-safe
-- metadata and aggregate it at cohort and organisation level.

CREATE OR REPLACE FUNCTION public.sponsor_canonical_enrollment_progress(
  p_cohort_id uuid DEFAULT NULL,
  p_as_of date DEFAULT current_date
)
RETURNS TABLE (
  enrollment_id uuid,
  learner_display_name text,
  programme_label text,
  cohort_id uuid,
  cohort_label text,
  programme_id uuid,
  enrollment_start_date date,
  enrollment_end_date date,
  programme_start_date date,
  programme_end_date date,
  enrollment_status public.enrollment_status,
  stored_enrollment_status public.enrollment_status,
  effective_enrollment_status public.enrollment_status,
  required_units integer,
  completed_units integer,
  due_units integer,
  booked_units integer,
  overdue_units integer,
  full_completion_pct numeric,
  due_adherence_pct numeric,
  pace_status text,
  progress_available boolean,
  coaching_required_units integer,
  coaching_completed_units integer,
  coaching_due_units integer,
  coaching_booked_units integer,
  training_required_units integer,
  training_completed_units integer,
  training_due_units integer,
  training_booked_units integer,
  peer_required_units integer,
  peer_completed_units integer,
  peer_due_units integer,
  peer_booked_units integer,
  mentoring_required_units integer,
  mentoring_completed_units integer,
  mentoring_due_units integer,
  mentoring_booked_units integer,
  triad_required_units integer,
  triad_completed_units integer,
  triad_due_units integer,
  triad_booked_units integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH sponsor AS (
    SELECT sp.organization_id
    FROM public.sponsor_profiles sp
    WHERE sp.user_id = auth.uid()
      AND auth.uid() IS NOT NULL
  ),
  eligible AS (
    SELECT
      e.id,
      e.programme_id,
      e.cohort_id,
      e.user_id,
      e.start_date,
      e.end_date,
      e.status,
      c.organization_id,
      c.name AS cohort_label,
      c.start_date AS programme_start_date,
      c.end_date AS programme_end_date,
      p.name AS programme_label,
      pr.full_name AS learner_display_name
    FROM public.programme_enrollments e
    JOIN public.cohorts c ON c.id = e.cohort_id
    JOIN public.programmes p ON p.id = e.programme_id
    JOIN public.profiles pr ON pr.id = e.user_id
    JOIN sponsor s ON s.organization_id = c.organization_id
    WHERE (p_cohort_id IS NULL OR e.cohort_id = p_cohort_id)
      AND (
        SELECT count(*)
        FROM public.programme_enrollments ec
        JOIN public.cohorts ec_c ON ec_c.id = ec.cohort_id
        WHERE ec.cohort_id = e.cohort_id
          AND ec_c.organization_id = c.organization_id
      ) >= public.sponsor_min_leaders_for_distribution()
  ),
  module_rows AS (
    SELECT
      e.*,
      g.module,
      g.completed_units AS module_completed_units,
      g.due_units AS module_due_units,
      g.required_units AS module_required_units,
      g.booked_units AS module_booked_units,
      g.pace_status AS module_pace_status
    FROM eligible e
    LEFT JOIN LATERAL public.get_enrollment_progress(e.id, p_as_of) g ON true
  ),
  grouped AS (
    SELECT
      e.id,
      e.learner_display_name,
      e.programme_label,
      e.cohort_id,
      e.cohort_label,
      e.programme_id,
      e.start_date,
      e.end_date,
      e.programme_start_date,
      e.programme_end_date,
      e.status,
      count(m.module)::integer AS module_count,
      coalesce(sum(m.module_required_units), 0)::integer AS required_units,
      coalesce(sum(m.module_completed_units), 0)::integer AS completed_units,
      coalesce(sum(m.module_due_units), 0)::integer AS due_units,
      coalesce(sum(m.module_booked_units), 0)::integer AS booked_units,
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
      count(m.module) FILTER (WHERE m.module_pace_status = 'behind') > 0 AS has_behind,
      count(m.module) FILTER (WHERE m.module_pace_status = 'scheduled') > 0 AS has_scheduled,
      count(m.module) FILTER (WHERE m.module_pace_status = 'on_track') > 0 AS has_on_track,
      count(m.module) FILTER (WHERE m.module_pace_status = 'ahead') > 0 AS has_ahead,
      coalesce(bool_and(m.module_pace_status = 'completed') FILTER (WHERE m.module IS NOT NULL), false) AS all_completed
    FROM eligible e
    LEFT JOIN module_rows m ON m.id = e.id
    GROUP BY
      e.id, e.learner_display_name, e.programme_label, e.cohort_id,
      e.cohort_label, e.programme_id, e.start_date, e.end_date,
      e.programme_start_date, e.programme_end_date, e.status
  ),
  calculated AS (
    SELECT
      g.*,
      CASE
        WHEN g.module_count = 0 THEN 'not_yet_due'
        WHEN g.has_behind THEN 'behind'
        WHEN g.has_scheduled THEN 'scheduled'
        WHEN g.has_on_track THEN 'on_track'
        WHEN g.has_ahead THEN 'ahead'
        WHEN g.all_completed THEN 'completed'
        ELSE 'not_yet_due'
      END AS calculated_pace_status
    FROM grouped g
  )
  SELECT
    c.id,
    c.learner_display_name,
    c.programme_label,
    c.cohort_id,
    c.cohort_label,
    c.programme_id,
    c.start_date,
    c.end_date,
    c.programme_start_date,
    c.programme_end_date,
    CASE
      WHEN c.status IN ('active', 'at_risk')
        AND c.programme_end_date < p_as_of
      THEN CASE WHEN c.all_completed THEN 'completed'::public.enrollment_status
                ELSE 'at_risk'::public.enrollment_status END
      ELSE c.status
    END,
    c.status,
    CASE
      WHEN c.status IN ('active', 'at_risk')
        AND c.programme_end_date < p_as_of
      THEN CASE WHEN c.all_completed THEN 'completed'::public.enrollment_status
                ELSE 'at_risk'::public.enrollment_status END
      ELSE c.status
    END,
    c.required_units,
    c.completed_units,
    c.due_units,
    c.booked_units,
    greatest(0, c.due_units - c.completed_units),
    CASE WHEN c.required_units = 0 THEN NULL
         ELSE round(least(c.completed_units, c.required_units) * 100.0 / c.required_units, 1)
    END,
    CASE WHEN c.due_units = 0 THEN NULL
         ELSE round(least(c.completed_units, c.due_units) * 100.0 / c.due_units, 1)
    END,
    c.calculated_pace_status,
    c.module_count > 0,
    c.coaching_required_units, c.coaching_completed_units, c.coaching_due_units, c.coaching_booked_units,
    c.training_required_units, c.training_completed_units, c.training_due_units, c.training_booked_units,
    c.peer_required_units, c.peer_completed_units, c.peer_due_units, c.peer_booked_units,
    c.mentoring_required_units, c.mentoring_completed_units, c.mentoring_due_units, c.mentoring_booked_units,
    c.triad_required_units, c.triad_completed_units, c.triad_due_units, c.triad_booked_units
  FROM calculated c
  ORDER BY c.cohort_label, c.learner_display_name, c.id;
$$;

CREATE OR REPLACE FUNCTION public.sponsor_canonical_programme_journey(
  p_cohort_id uuid,
  p_as_of date DEFAULT current_date
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH sponsor AS (
    SELECT sp.organization_id
    FROM public.sponsor_profiles sp
    WHERE sp.user_id = auth.uid()
      AND auth.uid() IS NOT NULL
  ),
  eligible AS (
    SELECT e.id, e.cohort_id
    FROM public.programme_enrollments e
    JOIN public.cohorts c ON c.id = e.cohort_id
    JOIN sponsor s ON s.organization_id = c.organization_id
    WHERE e.cohort_id = p_cohort_id
      AND (
        SELECT count(*)
        FROM public.programme_enrollments ec
        WHERE ec.cohort_id = e.cohort_id
      ) >= public.sponsor_min_leaders_for_distribution()
  ),
  schedule AS (
    SELECT e.id AS enrollment_id, s.module, m.due_on, m.required_units, m.training_week_id
    FROM eligible e
    JOIN public.enrollment_module_snapshots s ON s.enrollment_id = e.id
    JOIN public.enrollment_module_milestones m
      ON m.enrollment_module_snapshot_id = s.id
    WHERE m.due_on IS NOT NULL
  ),
  activity AS (
    SELECT a.enrollment_id, a.module, a.occurred_on,
      coalesce(s.status::text, 'completed') AS status
    FROM public.session_activity_attributions a
    LEFT JOIN public.sessions s
      ON a.source_activity_type = 'coaching' AND s.id = a.source_activity_id
    WHERE a.source_activity_type = 'coaching'
    UNION ALL
    SELECT a.enrollment_id, a.module, a.occurred_on,
      coalesce(s.status::text, 'completed')
    FROM public.session_activity_attributions a
    LEFT JOIN public.peer_sessions s
      ON a.source_activity_type = 'peer_coaching' AND s.id = a.source_activity_id
    WHERE a.source_activity_type = 'peer_coaching'
    UNION ALL
    SELECT a.enrollment_id, a.module, a.occurred_on,
      coalesce(s.status::text, 'completed')
    FROM public.session_activity_attributions a
    LEFT JOIN public.coachee_peer_sessions s
      ON a.source_activity_type = 'peer_coaching' AND s.id = a.source_activity_id
    WHERE a.source_activity_type = 'peer_coaching'
    UNION ALL
    SELECT a.enrollment_id, a.module, a.occurred_on,
      coalesce(s.status::text, 'completed')
    FROM public.session_activity_attributions a
    LEFT JOIN public.mentoring_sessions s
      ON a.source_activity_type = 'mentoring' AND s.id = a.source_activity_id
    WHERE a.source_activity_type = 'mentoring'
    UNION ALL
    SELECT a.enrollment_id, a.module, a.occurred_on,
      coalesce(s.status::text, 'completed')
    FROM public.session_activity_attributions a
    LEFT JOIN public.triad_sessions s
      ON a.source_activity_type = 'triad' AND s.id = a.source_activity_id
    WHERE a.source_activity_type = 'triad'
    UNION ALL
    SELECT a.enrollment_id, a.module, a.occurred_on, 'completed'
    FROM public.session_activity_attributions a
    WHERE a.source_activity_type IN ('training', 'quiz', 'daily_prompt')
  ),
  dates AS (
    SELECT s.due_on,
      string_agg(DISTINCT tw.title, ' · ') FILTER (WHERE tw.title IS NOT NULL) AS label
    FROM schedule s
    LEFT JOIN public.training_weeks tw ON tw.id = s.training_week_id
    GROUP BY s.due_on
  ),
  leader_checkpoints AS (
    SELECT d.due_on, e.id AS enrollment_id,
      coalesce((
        SELECT sum(s.required_units)::integer
        FROM schedule s
        WHERE s.enrollment_id = e.id AND s.due_on <= d.due_on
      ), 0)::integer AS required_units,
      coalesce((
        SELECT count(*)::integer
        FROM activity a
        WHERE a.enrollment_id = e.id
          AND a.status = 'completed'
          AND a.occurred_on <= p_as_of
          AND a.occurred_on <= d.due_on
          AND EXISTS (
            SELECT 1
            FROM schedule s
            WHERE s.enrollment_id = e.id
              AND s.module = a.module
              AND s.due_on <= d.due_on
          )
      ), 0)::integer AS completed_units
    FROM dates d
    CROSS JOIN eligible e
  ),
  totals AS (
    SELECT d.due_on, d.label,
      sum(l.required_units)::integer AS required_units,
      sum(least(l.completed_units, l.required_units))::integer AS completed_units,
      count(*)::integer AS total_leaders,
      count(*) FILTER (
        WHERE l.required_units > 0 AND l.completed_units >= l.required_units
      )::integer AS completed_leaders
    FROM dates d
    JOIN leader_checkpoints l ON l.due_on = d.due_on
    GROUP BY d.due_on, d.label
  ),
  numbered AS (
    SELECT row_number() OVER (ORDER BY due_on)::integer AS checkpoint_number, *
    FROM totals
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'checkpoint_number', checkpoint_number,
    'due_on', due_on,
    'label', coalesce(label, 'Programme checkpoint'),
    'required_units', required_units,
    'completed_units', completed_units,
    'completed_leaders', completed_leaders,
    'total_leaders', total_leaders,
    'state', CASE
      WHEN p_as_of < due_on THEN 'upcoming'
      WHEN p_as_of = due_on THEN 'current'
      WHEN required_units > 0 AND completed_units >= required_units THEN 'completed'
      ELSE 'overdue'
    END
  ) ORDER BY due_on), '[]'::jsonb)
  FROM numbered;
$$;

CREATE OR REPLACE FUNCTION public.sponsor_canonical_cohort_progress(
  p_cohort_id uuid DEFAULT NULL,
  p_as_of date DEFAULT current_date
)
RETURNS TABLE (
  cohort_id uuid,
  cohort_label text,
  programme_label text,
  programme_start_date date,
  programme_end_date date,
  enrollment_count integer,
  suppressed boolean,
  required_units integer,
  completed_units integer,
  due_units integer,
  booked_units integer,
  overdue_units integer,
  full_completion_pct numeric,
  due_adherence_pct numeric,
  schedule_coverage_pct numeric,
  pace_status text,
  active_count integer,
  at_risk_count integer,
  paused_count integer,
  completed_count integer,
  not_yet_due_count integer,
  ahead_count integer,
  on_track_count integer,
  scheduled_count integer,
  behind_count integer,
  completed_pace_count integer,
  on_track_pct numeric,
  coaching_required_units integer,
  coaching_completed_units integer,
  coaching_due_units integer,
  coaching_booked_units integer,
  coaching_completed_leaders integer,
  training_required_units integer,
  training_completed_units integer,
  training_due_units integer,
  training_booked_units integer,
  training_completed_leaders integer,
  peer_required_units integer,
  peer_completed_units integer,
  peer_due_units integer,
  peer_booked_units integer,
  peer_completed_leaders integer,
  mentoring_required_units integer,
  mentoring_completed_units integer,
  mentoring_due_units integer,
  mentoring_booked_units integer,
  mentoring_completed_leaders integer,
  triad_required_units integer,
  triad_completed_units integer,
  triad_due_units integer,
  triad_booked_units integer,
  triad_completed_leaders integer,
  programme_journey jsonb,
  progress_source_complete boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH sponsor AS (
    SELECT sp.organization_id
    FROM public.sponsor_profiles sp
    WHERE sp.user_id = auth.uid()
      AND auth.uid() IS NOT NULL
  ),
  cohorts AS (
    SELECT c.id, c.name, p.name AS programme_label, c.start_date, c.end_date,
      count(e.id)::integer AS enrollment_count
    FROM public.cohorts c
    JOIN public.programmes p ON p.id = c.programme_id
    JOIN sponsor s ON s.organization_id = c.organization_id
    LEFT JOIN public.programme_enrollments e ON e.cohort_id = c.id
    WHERE p_cohort_id IS NULL OR c.id = p_cohort_id
    GROUP BY c.id, c.name, p.name, c.start_date, c.end_date
  ),
  rows AS (
    SELECT r.*
    FROM public.sponsor_canonical_enrollment_progress(p_cohort_id, p_as_of) r
  ),
  grouped AS (
    SELECT
      c.id,
      c.name,
      c.programme_label,
      c.start_date,
      c.end_date,
      c.enrollment_count,
      coalesce(sum(r.required_units), 0)::integer AS required_units,
      coalesce(sum(r.completed_units), 0)::integer AS completed_units,
      coalesce(sum(r.due_units), 0)::integer AS due_units,
      coalesce(sum(r.booked_units), 0)::integer AS booked_units,
      count(r.enrollment_id) FILTER (WHERE r.effective_enrollment_status = 'active')::integer AS active_count,
      count(r.enrollment_id) FILTER (WHERE r.effective_enrollment_status = 'at_risk')::integer AS at_risk_count,
      count(r.enrollment_id) FILTER (WHERE r.effective_enrollment_status = 'paused')::integer AS paused_count,
      count(r.enrollment_id) FILTER (WHERE r.effective_enrollment_status = 'completed')::integer AS completed_count,
      count(r.enrollment_id) FILTER (WHERE r.pace_status = 'not_yet_due')::integer AS not_yet_due_count,
      count(r.enrollment_id) FILTER (WHERE r.pace_status = 'ahead')::integer AS ahead_count,
      count(r.enrollment_id) FILTER (WHERE r.pace_status = 'on_track')::integer AS on_track_count,
      count(r.enrollment_id) FILTER (WHERE r.pace_status = 'scheduled')::integer AS scheduled_count,
      count(r.enrollment_id) FILTER (WHERE r.pace_status = 'behind')::integer AS behind_count,
      count(r.enrollment_id) FILTER (WHERE r.pace_status = 'completed')::integer AS completed_pace_count,
      sum(r.coaching_required_units)::integer AS coaching_required_units,
      sum(r.coaching_completed_units)::integer AS coaching_completed_units,
      sum(r.coaching_due_units)::integer AS coaching_due_units,
      sum(r.coaching_booked_units)::integer AS coaching_booked_units,
      count(r.enrollment_id) FILTER (WHERE r.coaching_required_units > 0 AND r.coaching_completed_units >= r.coaching_required_units)::integer AS coaching_completed_leaders,
      sum(r.training_required_units)::integer AS training_required_units,
      sum(r.training_completed_units)::integer AS training_completed_units,
      sum(r.training_due_units)::integer AS training_due_units,
      sum(r.training_booked_units)::integer AS training_booked_units,
      count(r.enrollment_id) FILTER (WHERE r.training_required_units > 0 AND r.training_completed_units >= r.training_required_units)::integer AS training_completed_leaders,
      sum(r.peer_required_units)::integer AS peer_required_units,
      sum(r.peer_completed_units)::integer AS peer_completed_units,
      sum(r.peer_due_units)::integer AS peer_due_units,
      sum(r.peer_booked_units)::integer AS peer_booked_units,
      count(r.enrollment_id) FILTER (WHERE r.peer_required_units > 0 AND r.peer_completed_units >= r.peer_required_units)::integer AS peer_completed_leaders,
      sum(r.mentoring_required_units)::integer AS mentoring_required_units,
      sum(r.mentoring_completed_units)::integer AS mentoring_completed_units,
      sum(r.mentoring_due_units)::integer AS mentoring_due_units,
      sum(r.mentoring_booked_units)::integer AS mentoring_booked_units,
      count(r.enrollment_id) FILTER (WHERE r.mentoring_required_units > 0 AND r.mentoring_completed_units >= r.mentoring_required_units)::integer AS mentoring_completed_leaders,
      sum(r.triad_required_units)::integer AS triad_required_units,
      sum(r.triad_completed_units)::integer AS triad_completed_units,
      sum(r.triad_due_units)::integer AS triad_due_units,
      sum(r.triad_booked_units)::integer AS triad_booked_units,
      count(r.enrollment_id) FILTER (WHERE r.triad_required_units > 0 AND r.triad_completed_units >= r.triad_required_units)::integer AS triad_completed_leaders,
      count(r.enrollment_id)::integer AS source_row_count
    FROM cohorts c
    LEFT JOIN rows r ON r.cohort_id = c.id
    GROUP BY c.id, c.name, c.programme_label, c.start_date, c.end_date, c.enrollment_count
  ),
  calculated AS (
    SELECT g.*,
      CASE WHEN g.behind_count > 0 THEN 'behind'
        WHEN g.scheduled_count > 0 THEN 'scheduled'
        WHEN g.on_track_count > 0 THEN 'on_track'
        WHEN g.ahead_count > 0 THEN 'ahead'
        WHEN g.completed_pace_count = g.enrollment_count AND g.enrollment_count > 0 THEN 'completed'
        ELSE 'not_yet_due' END AS calculated_pace_status
    FROM grouped g
  )
  SELECT
    c.id,
    c.name,
    c.programme_label,
    c.start_date,
    c.end_date,
    CASE WHEN c.enrollment_count < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE c.enrollment_count END,
    c.enrollment_count < public.sponsor_min_leaders_for_distribution(),
    CASE WHEN c.enrollment_count < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE c.required_units END,
    CASE WHEN c.enrollment_count < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE c.completed_units END,
    CASE WHEN c.enrollment_count < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE c.due_units END,
    CASE WHEN c.enrollment_count < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE c.booked_units END,
    CASE WHEN c.enrollment_count < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE greatest(0, c.due_units - c.completed_units) END,
    CASE WHEN c.enrollment_count < public.sponsor_min_leaders_for_distribution() OR c.required_units = 0 THEN NULL ELSE round(least(c.completed_units, c.required_units) * 100.0 / c.required_units, 1) END,
    CASE WHEN c.enrollment_count < public.sponsor_min_leaders_for_distribution() OR c.due_units = 0 THEN NULL ELSE round(least(c.completed_units, c.due_units) * 100.0 / c.due_units, 1) END,
    CASE WHEN c.enrollment_count < public.sponsor_min_leaders_for_distribution() OR c.due_units = 0 THEN NULL ELSE round(least(c.completed_units + c.booked_units, c.due_units) * 100.0 / c.due_units, 1) END,
    CASE WHEN c.enrollment_count < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE c.calculated_pace_status END,
    CASE WHEN c.enrollment_count < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE c.active_count END,
    CASE WHEN c.enrollment_count < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE c.at_risk_count END,
    CASE WHEN c.enrollment_count < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE c.paused_count END,
    CASE WHEN c.enrollment_count < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE c.completed_count END,
    CASE WHEN c.enrollment_count < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE c.not_yet_due_count END,
    CASE WHEN c.enrollment_count < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE c.ahead_count END,
    CASE WHEN c.enrollment_count < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE c.on_track_count END,
    CASE WHEN c.enrollment_count < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE c.scheduled_count END,
    CASE WHEN c.enrollment_count < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE c.behind_count END,
    CASE WHEN c.enrollment_count < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE c.completed_pace_count END,
    CASE WHEN c.enrollment_count < public.sponsor_min_leaders_for_distribution() OR c.enrollment_count = 0 THEN NULL ELSE round(c.on_track_count * 100.0 / c.enrollment_count, 1) END,
    CASE WHEN c.enrollment_count < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE c.coaching_required_units END,
    CASE WHEN c.enrollment_count < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE c.coaching_completed_units END,
    CASE WHEN c.enrollment_count < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE c.coaching_due_units END,
    CASE WHEN c.enrollment_count < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE c.coaching_booked_units END,
    CASE WHEN c.enrollment_count < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE c.coaching_completed_leaders END,
    CASE WHEN c.enrollment_count < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE c.training_required_units END,
    CASE WHEN c.enrollment_count < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE c.training_completed_units END,
    CASE WHEN c.enrollment_count < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE c.training_due_units END,
    CASE WHEN c.enrollment_count < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE c.training_booked_units END,
    CASE WHEN c.enrollment_count < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE c.training_completed_leaders END,
    CASE WHEN c.enrollment_count < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE c.peer_required_units END,
    CASE WHEN c.enrollment_count < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE c.peer_completed_units END,
    CASE WHEN c.enrollment_count < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE c.peer_due_units END,
    CASE WHEN c.enrollment_count < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE c.peer_booked_units END,
    CASE WHEN c.enrollment_count < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE c.peer_completed_leaders END,
    CASE WHEN c.enrollment_count < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE c.mentoring_required_units END,
    CASE WHEN c.enrollment_count < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE c.mentoring_completed_units END,
    CASE WHEN c.enrollment_count < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE c.mentoring_due_units END,
    CASE WHEN c.enrollment_count < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE c.mentoring_booked_units END,
    CASE WHEN c.enrollment_count < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE c.mentoring_completed_leaders END,
    CASE WHEN c.enrollment_count < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE c.triad_required_units END,
    CASE WHEN c.enrollment_count < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE c.triad_completed_units END,
    CASE WHEN c.enrollment_count < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE c.triad_due_units END,
    CASE WHEN c.enrollment_count < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE c.triad_booked_units END,
    CASE WHEN c.enrollment_count < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE c.triad_completed_leaders END,
    CASE WHEN c.enrollment_count < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE public.sponsor_canonical_programme_journey(c.id, p_as_of) END,
    c.enrollment_count >= public.sponsor_min_leaders_for_distribution()
      AND c.source_row_count = c.enrollment_count
  FROM calculated c
  ORDER BY c.name;
$$;

CREATE OR REPLACE FUNCTION public.sponsor_canonical_organisation_progress(
  p_as_of date DEFAULT current_date
)
RETURNS TABLE (
  cohort_count integer,
  enrollment_count integer,
  required_units integer,
  completed_units integer,
  due_units integer,
  booked_units integer,
  overdue_units integer,
  full_completion_pct numeric,
  due_adherence_pct numeric,
  schedule_coverage_pct numeric,
  coaching_required_units integer,
  coaching_completed_units integer,
  coaching_due_units integer,
  coaching_booked_units integer,
  training_required_units integer,
  training_completed_units integer,
  training_due_units integer,
  training_booked_units integer,
  peer_required_units integer,
  peer_completed_units integer,
  peer_due_units integer,
  peer_booked_units integer,
  mentoring_required_units integer,
  mentoring_completed_units integer,
  mentoring_due_units integer,
  mentoring_booked_units integer,
  triad_required_units integer,
  triad_completed_units integer,
  triad_due_units integer,
  triad_booked_units integer,
  suppressed_cohort_count integer,
  progress_source_complete boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH cohorts AS (
    SELECT * FROM public.sponsor_canonical_cohort_progress(NULL, p_as_of)
  ),
  totals AS (
    SELECT
      count(*)::integer AS cohort_count,
      sum(coalesce(enrollment_count, 0))::integer AS enrollment_count,
      sum(required_units)::integer AS required_units,
      sum(completed_units)::integer AS completed_units,
      sum(due_units)::integer AS due_units,
      sum(booked_units)::integer AS booked_units,
      sum(coaching_required_units)::integer AS coaching_required_units,
      sum(coaching_completed_units)::integer AS coaching_completed_units,
      sum(coaching_due_units)::integer AS coaching_due_units,
      sum(coaching_booked_units)::integer AS coaching_booked_units,
      sum(training_required_units)::integer AS training_required_units,
      sum(training_completed_units)::integer AS training_completed_units,
      sum(training_due_units)::integer AS training_due_units,
      sum(training_booked_units)::integer AS training_booked_units,
      sum(peer_required_units)::integer AS peer_required_units,
      sum(peer_completed_units)::integer AS peer_completed_units,
      sum(peer_due_units)::integer AS peer_due_units,
      sum(peer_booked_units)::integer AS peer_booked_units,
      sum(mentoring_required_units)::integer AS mentoring_required_units,
      sum(mentoring_completed_units)::integer AS mentoring_completed_units,
      sum(mentoring_due_units)::integer AS mentoring_due_units,
      sum(mentoring_booked_units)::integer AS mentoring_booked_units,
      sum(triad_required_units)::integer AS triad_required_units,
      sum(triad_completed_units)::integer AS triad_completed_units,
      sum(triad_due_units)::integer AS triad_due_units,
      sum(triad_booked_units)::integer AS triad_booked_units,
      count(*) FILTER (WHERE suppressed)::integer AS suppressed_cohort_count,
      bool_and(progress_source_complete) AS progress_source_complete
    FROM cohorts
  )
  SELECT
    t.cohort_count,
    t.enrollment_count,
    t.required_units,
    t.completed_units,
    t.due_units,
    t.booked_units,
    greatest(0, t.due_units - t.completed_units),
    CASE WHEN t.required_units = 0 THEN NULL ELSE round(least(t.completed_units, t.required_units) * 100.0 / t.required_units, 1) END,
    CASE WHEN t.due_units = 0 THEN NULL ELSE round(least(t.completed_units, t.due_units) * 100.0 / t.due_units, 1) END,
    CASE WHEN t.due_units = 0 THEN NULL ELSE round(least(t.completed_units + t.booked_units, t.due_units) * 100.0 / t.due_units, 1) END,
    t.coaching_required_units, t.coaching_completed_units, t.coaching_due_units, t.coaching_booked_units,
    t.training_required_units, t.training_completed_units, t.training_due_units, t.training_booked_units,
    t.peer_required_units, t.peer_completed_units, t.peer_due_units, t.peer_booked_units,
    t.mentoring_required_units, t.mentoring_completed_units, t.mentoring_due_units, t.mentoring_booked_units,
    t.triad_required_units, t.triad_completed_units, t.triad_due_units, t.triad_booked_units,
    t.suppressed_cohort_count,
    t.progress_source_complete
  FROM totals t;
$$;

REVOKE ALL ON FUNCTION public.sponsor_canonical_enrollment_progress(uuid, date)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sponsor_canonical_programme_journey(uuid, date)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sponsor_canonical_cohort_progress(uuid, date)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sponsor_canonical_organisation_progress(date)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.sponsor_canonical_enrollment_progress(uuid, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sponsor_canonical_cohort_progress(uuid, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sponsor_canonical_organisation_progress(date) TO authenticated;