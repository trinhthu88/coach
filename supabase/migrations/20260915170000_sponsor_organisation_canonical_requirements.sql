-- Keep Sponsor Dashboard organisation totals on the same Admin-defined
-- programme_modules requirements as cohort and roster reporting.
CREATE OR REPLACE FUNCTION public.sponsor_organisation_summary()
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
  suppressed boolean
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH sponsor AS (
    SELECT organization_id
    FROM public.sponsor_profiles
    WHERE user_id = auth.uid()
  ), cohorts AS (
    SELECT c.id, c.end_date
    FROM public.cohorts c
    JOIN sponsor s ON s.organization_id = c.organization_id
  ), eligible AS (
    SELECT e.*, c.end_date AS cohort_end_date
    FROM public.programme_enrollments e
    JOIN cohorts c ON c.id = e.cohort_id
  ), configured_modules AS (
    SELECT e.id AS enrollment_id, pm.module,
      CASE
        WHEN coalesce((pm.config->>'required')::boolean, false)
          THEN coalesce(public.programme_config_integer(pm.config, 'required_units'), 0)
        ELSE 0
      END AS required_units
    FROM eligible e
    JOIN public.programme_modules pm
      ON pm.programme_id = e.programme_id
     AND pm.enabled
  ), module_values AS (
    SELECT cm.enrollment_id, cm.module, cm.required_units,
      coalesce(g.completed_units, 0)::integer AS completed_activity_units,
      least(coalesce(g.completed_units, 0), cm.required_units)::integer AS completed_units,
      least(coalesce(g.due_units, 0), cm.required_units)::integer AS due_units,
      least(
        coalesce(g.booked_units, 0),
        greatest(cm.required_units - least(coalesce(g.completed_units, 0), cm.required_units), 0)
      )::integer AS booked_units
    FROM configured_modules cm
    LEFT JOIN LATERAL public.get_enrollment_progress(cm.enrollment_id, current_date) g
      ON g.module = cm.module
  ), module_rows AS (
    SELECT mv.*,
      CASE
        WHEN mv.required_units = 0 OR mv.completed_units >= mv.required_units THEN 'completed'
        WHEN mv.due_units = 0 THEN 'not_yet_due'
        WHEN mv.completed_units >= mv.due_units THEN
          CASE WHEN mv.completed_units > mv.due_units THEN 'ahead' ELSE 'on_track' END
        WHEN mv.completed_units + mv.booked_units >= mv.due_units THEN 'scheduled'
        ELSE 'behind'
      END AS pace_status
    FROM module_values mv
  ), progress AS (
    SELECT e.id, e.status, e.cohort_end_date,
      coalesce(sum(mr.required_units), 0)::integer required_units,
      coalesce(sum(mr.completed_units), 0)::integer completed_units,
      coalesce(sum(mr.due_units), 0)::integer due_units,
      coalesce(sum(mr.booked_units), 0)::integer booked_units,
      count(*) FILTER (WHERE mr.pace_status='not_yet_due')::integer not_yet_due_count,
      count(*) FILTER (WHERE mr.pace_status='ahead')::integer ahead_count,
      count(*) FILTER (WHERE mr.pace_status='on_track')::integer on_track_count,
      count(*) FILTER (WHERE mr.pace_status='scheduled')::integer scheduled_count,
      count(*) FILTER (WHERE mr.pace_status='behind')::integer behind_count,
      count(*) FILTER (WHERE mr.pace_status='completed')::integer completed_pace_count,
      CASE
        WHEN bool_or(mr.pace_status='behind') THEN 'behind'
        WHEN bool_or(mr.pace_status='scheduled') THEN 'scheduled'
        WHEN bool_or(mr.pace_status='on_track') THEN 'on_track'
        WHEN bool_or(mr.pace_status='ahead') THEN 'ahead'
        WHEN bool_and(mr.pace_status='completed') THEN 'completed'
        ELSE 'not_yet_due'
      END pace_state,
      CASE
        WHEN e.status = 'active' AND e.cohort_end_date < current_date
          THEN CASE WHEN bool_and(mr.pace_status='completed') THEN 'completed' ELSE 'at_risk' END
        ELSE e.status::text
      END effective_status
    FROM eligible e
    LEFT JOIN module_rows mr ON mr.enrollment_id = e.id
    GROUP BY e.id, e.status, e.cohort_end_date
  ), goals AS (
    SELECT e.id,
      count(g.id)::integer goal_count,
      (count(g.id) FILTER (WHERE r.id IS NOT NULL) > 0) goal_setup,
      avg(CASE WHEN r.target_rating IS NULL OR r.start_rating IS NULL
        OR r.target_rating=r.start_rating THEN NULL
        ELSE least(100,greatest(0,(r.current_rating-r.start_rating)*100.0 /
          (r.target_rating-r.start_rating))) END) goal_progress_pct
    FROM eligible e
    LEFT JOIN public.coachee_goals g ON g.enrollment_id=e.id
    LEFT JOIN public.coachee_goal_ratings r ON r.goal_id=g.id AND r.enrollment_id=e.id
    GROUP BY e.id
  ), actions AS (
    SELECT e.id,count(a.id)::integer total_action_count,
      count(a.id) FILTER (WHERE a.status='completed')::integer completed_action_count
    FROM eligible e LEFT JOIN public.enrollment_actions a ON a.enrollment_id=e.id
    GROUP BY e.id
  ), satisfaction AS (
    SELECT e.id,count(s.id)::integer rated_count,avg(s.coachee_rating) avg_rating
    FROM eligible e
    LEFT JOIN public.sessions s ON s.enrollment_id=e.id
      AND s.status='completed' AND s.coachee_rating IS NOT NULL
    GROUP BY e.id
  ), totals AS (
    SELECT count(*)::integer n,
      count(*) FILTER (WHERE effective_status='active')::integer active_count,
      count(*) FILTER (WHERE effective_status='at_risk')::integer at_risk_count,
      count(*) FILTER (WHERE effective_status='paused')::integer paused_count,
      count(*) FILTER (WHERE effective_status='completed')::integer completed_count,
      sum(required_units)::integer required_units,sum(completed_units)::integer completed_units,
      sum(due_units)::integer due_units,sum(booked_units)::integer booked_units,
      sum(greatest(0,due_units-completed_units))::integer overdue_units,
      count(*) FILTER (WHERE pace_state='not_yet_due')::integer not_yet_due_count,
      count(*) FILTER (WHERE pace_state='ahead')::integer ahead_count,
      count(*) FILTER (WHERE pace_state='on_track')::integer on_track_count,
      count(*) FILTER (WHERE pace_state='scheduled')::integer scheduled_count,
      count(*) FILTER (WHERE pace_state='behind')::integer behind_count,
      count(*) FILTER (WHERE pace_state='completed')::integer completed_pace_count,
      sum(g.goal_count)::integer goal_count,count(*) FILTER (WHERE g.goal_setup)::integer goal_setup_count,
      avg(g.goal_progress_pct) goal_progress_pct,
      sum(a.total_action_count)::integer total_action_count,
      sum(a.completed_action_count)::integer completed_action_count,
      sum(s.rated_count)::integer satisfaction_rated_count,
      sum(s.avg_rating*s.rated_count)/nullif(sum(s.rated_count),0) satisfaction_avg
    FROM progress p JOIN goals g ON g.id=p.id JOIN actions a ON a.id=p.id
      JOIN satisfaction s ON s.id=p.id
  ), org AS (SELECT count(*)::integer cohort_count FROM cohorts)
  SELECT org.cohort_count,
    CASE WHEN t.n < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE t.n END,
    CASE WHEN t.n < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE t.active_count END,
    CASE WHEN t.n < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE t.at_risk_count END,
    CASE WHEN t.n < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE t.paused_count END,
    CASE WHEN t.n < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE t.completed_count END,
    CASE WHEN t.n < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE t.required_units END,
    CASE WHEN t.n < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE t.completed_units END,
    CASE WHEN t.n < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE t.due_units END,
    CASE WHEN t.n < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE t.booked_units END,
    CASE WHEN t.n < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE t.overdue_units END,
    CASE WHEN t.n < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE least(100,round(t.completed_units*100.0/nullif(t.required_units,0),1)) END,
    CASE WHEN t.n < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE least(100,round(t.completed_units*100.0/nullif(t.due_units,0),1)) END,
    CASE WHEN t.n < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE least(100,round((t.completed_units+t.booked_units)*100.0/nullif(t.due_units,0),1)) END,
    CASE WHEN t.n < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE t.not_yet_due_count END,
    CASE WHEN t.n < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE t.ahead_count END,
    CASE WHEN t.n < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE t.on_track_count END,
    CASE WHEN t.n < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE t.scheduled_count END,
    CASE WHEN t.n < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE t.behind_count END,
    CASE WHEN t.n < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE t.completed_pace_count END,
    CASE WHEN t.n < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE t.goal_count END,
    CASE WHEN t.n < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE t.goal_setup_count END,
    CASE WHEN t.n < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE t.goal_progress_pct END,
    CASE WHEN t.n < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE t.total_action_count END,
    CASE WHEN t.n < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE t.completed_action_count END,
    CASE WHEN t.n < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE least(100,round(t.completed_action_count*100.0/nullif(t.total_action_count,0),1)) END,
    CASE WHEN t.n < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE t.satisfaction_avg END,
    CASE WHEN t.n < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE t.satisfaction_rated_count END,
    t.n < public.sponsor_min_leaders_for_distribution()
  FROM totals t CROSS JOIN org;
$$;