-- Keep the organization-level Sponsor Dashboard summary on the same
-- sponsor-visible cohort population as sponsor_cohort_summaries(NULL).
--
-- The previous implementation restricted this aggregate to cohorts active on
-- current_date.  Cohort summaries intentionally include historical and
-- future sponsor-visible cohorts, so the two dashboard paths could not
-- reconcile.  The canonical metric rows and the existing organization-level
-- minimum-size suppression remain unchanged.
CREATE OR REPLACE FUNCTION public.sponsor_organisation_summary_legacy()
RETURNS TABLE (
  cohort_count integer,
  enrollment_count integer,
  active_count integer,
  at_risk_count integer,
  paused_count integer,
  completed_count integer,
  required_units integer,
  completed_units integer,
  due_units integer,
  booked_units integer,
  overdue_units integer,
  full_completion_pct numeric,
  due_adherence_pct numeric,
  schedule_coverage_pct numeric,
  not_yet_due_count integer,
  ahead_count integer,
  on_track_count integer,
  scheduled_count integer,
  behind_count integer,
  completed_pace_count integer,
  goal_count integer,
  goal_setup_count integer,
  goal_progress_pct numeric,
  total_action_count integer,
  completed_action_count integer,
  action_completion_pct numeric,
  satisfaction_avg numeric,
  satisfaction_rated_count integer,
  suppressed boolean,
  assessable_count integer,
  not_assessed_count integer,
  health_status text,
  session_required_units integer,
  session_completed_units integer,
  session_due_units integer,
  session_booked_units integer,
  session_overdue_units integer
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  WITH rows AS (
    SELECT r.*
    FROM public.sponsor_metric_rows(NULL, current_date) r
  ), cohorts AS (
    SELECT count(DISTINCT r.cohort_id)::integer AS cohort_count
    FROM rows r
  ), totals AS (
    SELECT count(*)::integer AS enrollment_count,
      count(*) FILTER (WHERE r.enrollment_status='active')::integer AS active_count,
      count(*) FILTER (WHERE r.enrollment_status='at_risk')::integer AS at_risk_count,
      count(*) FILTER (WHERE r.enrollment_status='paused')::integer AS paused_count,
      count(*) FILTER (WHERE r.enrollment_status='completed')::integer AS completed_count,
      sum(r.required_units)::integer AS required_units,
      sum(r.completed_units)::integer AS completed_units,
      sum(r.due_units)::integer AS due_units,
      sum(r.booked_units)::integer AS booked_units,
      sum(r.overdue_units)::integer AS overdue_units,
      count(*) FILTER (WHERE r.pace_status='not_yet_due')::integer AS not_yet_due_count,
      count(*) FILTER (WHERE r.pace_status='ahead')::integer AS ahead_count,
      count(*) FILTER (WHERE r.pace_status='on_track')::integer AS on_track_count,
      count(*) FILTER (WHERE r.pace_status='scheduled')::integer AS scheduled_count,
      count(*) FILTER (WHERE r.pace_status='behind')::integer AS behind_count,
      count(*) FILTER (WHERE r.pace_status='completed')::integer AS completed_pace_count,
      sum(r.goal_count)::integer AS goal_count,
      count(*) FILTER (WHERE r.goal_setup)::integer AS goal_setup_count,
      avg(r.goal_progress_pct) AS goal_progress_pct,
      sum(r.total_action_count)::integer AS total_action_count,
      sum(r.completed_action_count)::integer AS completed_action_count,
      sum(r.satisfaction_rated_count)::integer AS satisfaction_rated_count,
      sum(r.satisfaction_avg * r.satisfaction_rated_count)
        / nullif(sum(r.satisfaction_rated_count), 0) AS satisfaction_avg,
      count(*) FILTER (WHERE r.assessable)::integer AS assessable_count,
      count(*) FILTER (WHERE r.assessable IS NOT TRUE)::integer AS not_assessed_count,
      count(*) FILTER (WHERE r.on_track IS TRUE)::integer AS canonical_on_track_count,
      sum(r.session_required_units)::integer AS session_required_units,
      sum(r.session_completed_units)::integer AS session_completed_units,
      sum(r.session_due_units)::integer AS session_due_units,
      sum(r.session_booked_units)::integer AS session_booked_units,
      sum(r.session_overdue_units)::integer AS session_overdue_units
    FROM rows r
  ), visible AS (
    SELECT t.*,
      t.enrollment_count >= public.sponsor_min_leaders_for_distribution() AS is_visible
    FROM totals t
  )
  SELECT c.cohort_count,
    CASE WHEN NOT v.is_visible THEN NULL ELSE v.enrollment_count END,
    CASE WHEN NOT v.is_visible THEN NULL ELSE v.active_count END,
    CASE WHEN NOT v.is_visible THEN NULL ELSE v.at_risk_count END,
    CASE WHEN NOT v.is_visible THEN NULL ELSE v.paused_count END,
    CASE WHEN NOT v.is_visible THEN NULL ELSE v.completed_count END,
    CASE WHEN NOT v.is_visible OR v.required_units=0 THEN NULL ELSE v.required_units END,
    CASE WHEN NOT v.is_visible THEN NULL ELSE v.completed_units END,
    CASE WHEN NOT v.is_visible THEN NULL ELSE v.due_units END,
    CASE WHEN NOT v.is_visible THEN NULL ELSE v.booked_units END,
    CASE WHEN NOT v.is_visible THEN NULL ELSE v.overdue_units END,
    CASE WHEN NOT v.is_visible OR v.required_units=0 THEN NULL
      ELSE round(least(v.completed_units,v.required_units)*100.0/v.required_units,1) END,
    CASE WHEN NOT v.is_visible OR v.due_units=0 THEN NULL
      ELSE round(least(v.completed_units,v.due_units)*100.0/v.due_units,1) END,
    CASE WHEN NOT v.is_visible OR v.due_units=0 THEN NULL
      ELSE round(least(v.completed_units+v.booked_units,v.due_units)*100.0/v.due_units,1) END,
    CASE WHEN NOT v.is_visible THEN NULL ELSE v.not_yet_due_count END,
    CASE WHEN NOT v.is_visible THEN NULL ELSE v.ahead_count END,
    CASE WHEN NOT v.is_visible THEN NULL ELSE v.canonical_on_track_count END,
    CASE WHEN NOT v.is_visible THEN NULL ELSE v.scheduled_count END,
    CASE WHEN NOT v.is_visible THEN NULL ELSE v.behind_count END,
    CASE WHEN NOT v.is_visible THEN NULL ELSE v.completed_pace_count END,
    CASE WHEN NOT v.is_visible THEN NULL ELSE v.goal_count END,
    CASE WHEN NOT v.is_visible THEN NULL ELSE v.goal_setup_count END,
    CASE WHEN NOT v.is_visible THEN NULL ELSE v.goal_progress_pct END,
    CASE WHEN NOT v.is_visible THEN NULL ELSE v.total_action_count END,
    CASE WHEN NOT v.is_visible THEN NULL ELSE v.completed_action_count END,
    CASE WHEN NOT v.is_visible OR v.total_action_count=0 THEN NULL
      ELSE round(v.completed_action_count*100.0/v.total_action_count,1) END,
    CASE WHEN NOT v.is_visible THEN NULL ELSE v.satisfaction_avg END,
    CASE WHEN NOT v.is_visible THEN NULL ELSE v.satisfaction_rated_count END,
    (NOT v.is_visible),
    CASE WHEN NOT v.is_visible THEN NULL ELSE v.assessable_count END,
    CASE WHEN NOT v.is_visible THEN NULL ELSE v.not_assessed_count END,
    CASE WHEN NOT v.is_visible THEN NULL
      WHEN v.at_risk_count > 0 THEN 'at_risk'
      WHEN v.completed_count = v.enrollment_count THEN 'completed'
      WHEN v.assessable_count = 0 THEN 'not_assessed'
      ELSE 'healthy' END,
    CASE WHEN NOT v.is_visible THEN NULL ELSE v.session_required_units END,
    CASE WHEN NOT v.is_visible THEN NULL ELSE v.session_completed_units END,
    CASE WHEN NOT v.is_visible THEN NULL ELSE v.session_due_units END,
    CASE WHEN NOT v.is_visible THEN NULL ELSE v.session_booked_units END,
    CASE WHEN NOT v.is_visible THEN NULL ELSE v.session_overdue_units END
  FROM cohorts c CROSS JOIN visible v;
$function$;