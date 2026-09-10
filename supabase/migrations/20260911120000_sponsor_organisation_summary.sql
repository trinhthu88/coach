-- Organisation-level sponsor metrics are deliberately aggregate-only.  The
-- organisation is resolved from auth.uid(); callers cannot supply an org id.
DROP FUNCTION IF EXISTS public.sponsor_organisation_summary();
CREATE FUNCTION public.sponsor_organisation_summary()
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
    SELECT c.id
    FROM public.cohorts c
    JOIN sponsor s ON s.organization_id = c.organization_id
  ), eligible AS (
    SELECT e.*
    FROM public.programme_enrollments e
    JOIN cohorts c ON c.id = e.cohort_id
  ), progress AS (
    SELECT e.id, e.status,
      coalesce(sum(p.required_units),0)::integer required_units,
      coalesce(sum(p.completed_units),0)::integer completed_units,
      coalesce(sum(p.due_units),0)::integer due_units,
      coalesce(sum(p.booked_units),0)::integer booked_units,
      count(*) FILTER (WHERE p.pace_status='not_yet_due')::integer not_yet_due_count,
      count(*) FILTER (WHERE p.pace_status='ahead')::integer ahead_count,
      count(*) FILTER (WHERE p.pace_status='on_track')::integer on_track_count,
      count(*) FILTER (WHERE p.pace_status='scheduled')::integer scheduled_count,
      count(*) FILTER (WHERE p.pace_status='behind')::integer behind_count,
      count(*) FILTER (WHERE p.pace_status='completed')::integer completed_pace_count
      ,CASE WHEN bool_or(p.pace_status='behind') THEN 'behind'
        WHEN bool_or(p.pace_status='scheduled') THEN 'scheduled'
        WHEN bool_or(p.pace_status='on_track') THEN 'on_track'
        WHEN bool_or(p.pace_status='ahead') THEN 'ahead'
        WHEN bool_and(p.pace_status='completed') THEN 'completed'
        ELSE 'not_yet_due' END pace_state
    FROM eligible e
    LEFT JOIN LATERAL public.get_enrollment_progress(e.id,current_date) p ON true
    GROUP BY e.id,e.status
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
      count(*) FILTER (WHERE status='active')::integer active_count,
      count(*) FILTER (WHERE status='at_risk')::integer at_risk_count,
      count(*) FILTER (WHERE status='paused')::integer paused_count,
      count(*) FILTER (WHERE status='completed')::integer completed_count,
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
REVOKE ALL ON FUNCTION public.sponsor_organisation_summary() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sponsor_organisation_summary() TO authenticated;