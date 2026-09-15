-- Keep programme dates on the existing sponsor cohort summary surface.
-- Dates are cohort-level metadata and remain safe to return for suppressed
-- cohorts; learner rows continue to require the existing threshold gate.
DROP FUNCTION IF EXISTS public.sponsor_cohort_summaries(uuid);

CREATE OR REPLACE FUNCTION public.sponsor_cohort_summaries(
  p_cohort_id uuid DEFAULT NULL
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
  due_adherence_pct numeric,
  pace_status text,
  coaching_completed_count integer,
  mentoring_completed_count integer,
  peer_completed_count integer,
  triad_completed_count integer,
  goal_count integer,
  open_action_count integer,
  completed_action_count integer,
  active_count integer,
  at_risk_count integer,
  paused_count integer,
  completed_count integer,
  not_yet_due_count integer,
  ahead_count integer,
  on_track_count integer,
  scheduled_count integer,
  behind_count integer,
  full_completion_pct numeric,
  booked_units integer,
  overdue_units integer,
  schedule_coverage_pct numeric,
  completed_pace_count integer,
  satisfaction_avg numeric,
  satisfaction_rated_count integer,
  goal_setup_count integer,
  goal_progress_pct numeric,
  total_action_count integer,
  action_completion_pct numeric,
  on_track_pct numeric
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH sponsor AS (
    SELECT organization_id FROM public.sponsor_profiles WHERE user_id = auth.uid()
  ), cohort_list AS (
    SELECT c.id AS cohort_id, c.name AS cohort_label, p.name AS programme_label,
           c.start_date AS programme_start_date, c.end_date AS programme_end_date,
           count(e.id)::integer AS enrollment_count
    FROM public.cohorts c
    JOIN public.programmes p ON p.id = c.programme_id
    JOIN sponsor s ON s.organization_id = c.organization_id
    LEFT JOIN public.programme_enrollments e ON e.cohort_id = c.id
    WHERE p_cohort_id IS NULL OR c.id = p_cohort_id
    GROUP BY c.id, c.name, p.name, c.start_date, c.end_date
  ), rows AS (
    SELECT
      cl.cohort_id AS scoped_cohort_id,
      r.required_units,
      r.completed_units,
      r.due_units,
      r.pace_status,
      r.coaching_completed_count,
      r.mentoring_completed_count,
      r.peer_completed_count,
      r.triad_completed_count,
      r.goal_count,
      r.open_action_count,
      r.completed_action_count,
      r.total_action_count,
      r.action_completion_pct,
      r.goal_setup,
      r.goal_progress_pct,
      r.satisfaction_avg,
      r.satisfaction_rated_count,
      r.overdue_units,
      r.booked_units,
      r.enrollment_status
    FROM cohort_list cl
    LEFT JOIN LATERAL public.sponsor_enrollment_summaries(cl.cohort_id) r ON true
  ), grouped AS (
    SELECT cl.cohort_id, cl.cohort_label, cl.programme_label,
      cl.programme_start_date, cl.programme_end_date, cl.enrollment_count AS n,
      sum(r.required_units)::integer required_units, sum(r.completed_units)::integer completed_units,
      sum(r.due_units)::integer due_units,
      least(100, round(sum(r.completed_units) * 100.0 / nullif(sum(r.due_units),0), 1)) due_adherence_pct,
      sum(r.coaching_completed_count)::integer coaching,
      sum(r.mentoring_completed_count)::integer mentoring,
      sum(r.peer_completed_count)::integer peer,
      sum(r.triad_completed_count)::integer triad,
      sum(r.goal_count)::integer goals, sum(r.open_action_count)::integer open_actions,
      sum(r.completed_action_count)::integer completed_actions,
      sum(r.total_action_count)::integer total_actions,
      round(sum(r.completed_action_count) * 100.0 / nullif(sum(r.total_action_count),0),1) action_completion_pct,
      count(*) FILTER (WHERE r.goal_setup)::integer goal_setup_count,
      round(avg(r.goal_progress_pct),1) goal_progress_pct,
      sum(r.satisfaction_avg * r.satisfaction_rated_count) / nullif(sum(r.satisfaction_rated_count),0) satisfaction_avg,
      sum(r.satisfaction_rated_count)::integer satisfaction_rated_count,
      count(*) FILTER (WHERE r.pace_status='behind')::integer behind,
      count(*) FILTER (WHERE r.pace_status='scheduled')::integer scheduled,
      count(*) FILTER (WHERE r.pace_status='on_track')::integer on_track,
      count(*) FILTER (WHERE r.pace_status='ahead')::integer ahead,
      count(*) FILTER (WHERE r.pace_status='completed')::integer finished,
      count(*) FILTER (WHERE r.enrollment_status='active')::integer active_count,
      count(*) FILTER (WHERE r.enrollment_status='at_risk')::integer at_risk_count,
      count(*) FILTER (WHERE r.enrollment_status='paused')::integer paused_count,
      count(*) FILTER (WHERE r.enrollment_status='completed')::integer completed_count,
      count(*) FILTER (WHERE r.pace_status='not_yet_due')::integer not_yet_due_count,
      round(count(*) FILTER (WHERE r.pace_status='on_track') * 100.0 /
        nullif(cl.enrollment_count,0),1) on_track_pct,
      sum(r.overdue_units)::integer overdue_units,
      least(100, round(sum(r.completed_units) * 100.0 / nullif(sum(r.required_units),0),1)) full_completion_pct,
      sum(r.booked_units)::integer booked_units,
      least(100, round(sum(r.completed_units + r.booked_units) * 100.0 / nullif(sum(r.due_units),0),1)) schedule_coverage_pct,
      count(*) FILTER (WHERE r.pace_status='completed')::integer completed_pace_count
    FROM cohort_list cl
    LEFT JOIN rows r ON r.scoped_cohort_id = cl.cohort_id
    GROUP BY cl.cohort_id, cl.cohort_label, cl.programme_label,
      cl.programme_start_date, cl.programme_end_date, cl.enrollment_count
  )
  SELECT cohort_id, cohort_label, programme_label, programme_start_date, programme_end_date,
     CASE WHEN n < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE n END,
     n < public.sponsor_min_leaders_for_distribution(),
     CASE WHEN n < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE required_units END,
     CASE WHEN n < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE completed_units END,
     CASE WHEN n < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE due_units END,
     CASE WHEN n < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE due_adherence_pct END,
     CASE WHEN n < public.sponsor_min_leaders_for_distribution() THEN NULL
       WHEN behind > 0 THEN 'behind' WHEN scheduled > 0 THEN 'scheduled'
       WHEN on_track > 0 THEN 'on_track' WHEN ahead > 0 THEN 'ahead'
       WHEN finished = n THEN 'completed' ELSE 'not_yet_due' END,
     CASE WHEN n < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE coaching END,
     CASE WHEN n < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE mentoring END,
     CASE WHEN n < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE peer END,
     CASE WHEN n < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE triad END,
     CASE WHEN n < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE goals END,
     CASE WHEN n < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE open_actions END,
     CASE WHEN n < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE completed_actions END,
     CASE WHEN n < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE active_count END,
     CASE WHEN n < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE at_risk_count END,
     CASE WHEN n < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE paused_count END,
     CASE WHEN n < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE completed_count END,
     CASE WHEN n < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE not_yet_due_count END,
     CASE WHEN n < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE ahead END,
     CASE WHEN n < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE on_track END,
     CASE WHEN n < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE scheduled END,
     CASE WHEN n < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE behind END,
     CASE WHEN n < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE full_completion_pct END,
     CASE WHEN n < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE booked_units END,
     CASE WHEN n < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE overdue_units END,
     CASE WHEN n < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE schedule_coverage_pct END,
     CASE WHEN n < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE completed_pace_count END,
     CASE WHEN n < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE satisfaction_avg END,
     CASE WHEN n < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE satisfaction_rated_count END,
     CASE WHEN n < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE goal_setup_count END,
     CASE WHEN n < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE goal_progress_pct END,
     CASE WHEN n < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE total_actions END,
     CASE WHEN n < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE action_completion_pct END,
     CASE WHEN n < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE on_track_pct END
  FROM grouped ORDER BY cohort_label;
$$;

REVOKE ALL ON FUNCTION public.sponsor_cohort_summaries(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sponsor_cohort_summaries(uuid) TO authenticated;