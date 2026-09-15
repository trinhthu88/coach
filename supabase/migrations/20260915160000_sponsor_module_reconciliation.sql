-- Extend the existing sponsor-safe reporting contract with module-level
-- denominators, schedule expectations, and completed-leader counts. Sponsor
-- progress is sourced from current Admin programme configuration plus
-- attributed leader activity; enrollment snapshots are not sponsor denominators.

DROP FUNCTION IF EXISTS public.sponsor_enrollment_summaries(uuid);
CREATE OR REPLACE FUNCTION public.sponsor_enrollment_summaries(p_cohort_id uuid)
RETURNS TABLE (
  enrollment_id uuid,
  learner_display_name text,
  programme_label text,
  cohort_id uuid,
  cohort_label text,
  enrollment_status public.enrollment_status,
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
  programme_id uuid,
  enrollment_start_date date,
  enrollment_end_date date,
  programme_start_date date,
  programme_end_date date,
  full_completion_pct numeric,
  booked_units integer,
  overdue_units integer,
  schedule_coverage_pct numeric,
  goal_setup boolean,
  goal_progress_pct numeric,
  total_action_count integer,
  action_completion_pct numeric,
  satisfaction_avg numeric,
  satisfaction_rated_count integer,
  coaching_required_units integer,
  coaching_completed_units integer,
  coaching_due_units integer,
  mentoring_required_units integer,
  mentoring_completed_units integer,
  mentoring_due_units integer,
  peer_required_units integer,
  peer_completed_units integer,
  peer_due_units integer,
  triad_required_units integer,
  triad_completed_units integer,
  triad_due_units integer,
  training_required_units integer,
  training_completed_units integer,
  training_due_units integer
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH authorized AS (
    SELECT sp.organization_id
    FROM public.sponsor_profiles sp
    WHERE sp.user_id = auth.uid()
      AND auth.uid() IS NOT NULL
  ), eligible AS (
    SELECT e.*, c.name AS cohort_label, p.name AS programme_label,
           c.start_date AS programme_start_date, c.end_date AS programme_end_date,
           pr.full_name AS learner_display_name
    FROM public.programme_enrollments e
    JOIN public.cohorts c ON c.id = e.cohort_id
    JOIN public.programmes p ON p.id = e.programme_id
    JOIN public.profiles pr ON pr.id = e.user_id
    JOIN authorized a ON a.organization_id = c.organization_id
    WHERE p_cohort_id IS NOT NULL
      AND e.cohort_id = p_cohort_id
      AND (SELECT count(*)
           FROM public.programme_enrollments ec
           JOIN public.cohorts ec_c ON ec_c.id = ec.cohort_id
           WHERE ec.cohort_id = p_cohort_id
             AND ec_c.organization_id = a.organization_id)
          >= public.sponsor_min_leaders_for_distribution()
  ), module_rows AS (
    SELECT e.id AS enrollment_id, g.module, g.required_units,
      g.completed_activity_units, g.completed_units, g.due_units,
      g.booked_units, g.pace_status
    FROM eligible e
    LEFT JOIN LATERAL public.get_sponsor_programme_progress(e.id, current_date) g ON true
  ), module_rollup AS (
    SELECT enrollment_id,
      max(required_units) FILTER (WHERE module = 'coaching')::integer coaching_required_units,
      max(completed_units) FILTER (WHERE module = 'coaching')::integer coaching_completed_units,
      max(due_units) FILTER (WHERE module = 'coaching')::integer coaching_due_units,
      max(required_units) FILTER (WHERE module = 'mentoring')::integer mentoring_required_units,
      max(completed_units) FILTER (WHERE module = 'mentoring')::integer mentoring_completed_units,
      max(due_units) FILTER (WHERE module = 'mentoring')::integer mentoring_due_units,
      max(required_units) FILTER (WHERE module = 'peer_coaching')::integer peer_required_units,
      max(completed_units) FILTER (WHERE module = 'peer_coaching')::integer peer_completed_units,
      max(due_units) FILTER (WHERE module = 'peer_coaching')::integer peer_due_units,
      max(required_units) FILTER (WHERE module = 'triads')::integer triad_required_units,
      max(completed_units) FILTER (WHERE module = 'triads')::integer triad_completed_units,
      max(due_units) FILTER (WHERE module = 'triads')::integer triad_due_units,
      max(required_units) FILTER (WHERE module = 'training')::integer training_required_units,
      max(completed_units) FILTER (WHERE module = 'training')::integer training_completed_units,
      max(due_units) FILTER (WHERE module = 'training')::integer training_due_units
    FROM module_rows
    GROUP BY enrollment_id
  ), progress AS (
    SELECT enrollment_id,
      coalesce(sum(required_units), 0)::integer required_units,
      coalesce(sum(completed_units), 0)::integer completed_units,
      coalesce(sum(due_units), 0)::integer due_units,
      CASE WHEN sum(due_units) = 0 THEN NULL
        ELSE least(100, round(sum(completed_units) * 100.0 / sum(due_units), 1)) END due_adherence_pct,
      CASE WHEN bool_or(pace_status = 'behind') THEN 'behind'
        WHEN bool_or(pace_status = 'scheduled') THEN 'scheduled'
        WHEN bool_or(pace_status = 'on_track') THEN 'on_track'
        WHEN bool_or(pace_status = 'ahead') THEN 'ahead'
        WHEN bool_and(pace_status = 'completed') THEN 'completed'
        ELSE 'not_yet_due' END pace_status,
      coalesce(sum(booked_units), 0)::integer booked_units
    FROM module_rows
    GROUP BY enrollment_id
  ), completed AS (
    SELECT enrollment_id,
       coalesce(sum(completed_activity_units) FILTER (WHERE module = 'coaching'), 0)::integer coaching,
       coalesce(sum(completed_activity_units) FILTER (WHERE module = 'mentoring'), 0)::integer mentoring,
       coalesce(sum(completed_activity_units) FILTER (WHERE module = 'peer_coaching'), 0)::integer peer,
       coalesce(sum(completed_activity_units) FILTER (WHERE module = 'triads'), 0)::integer triad
    FROM module_rows
    GROUP BY enrollment_id
  ), goals AS (
    SELECT e.id AS enrollment_id,
      count(g.id)::integer goal_count,
      count(g.id) FILTER (WHERE gr.id IS NOT NULL)::integer goal_setup,
      round(avg(CASE WHEN gr.target_rating IS NULL OR gr.start_rating IS NULL
        OR gr.target_rating = gr.start_rating THEN NULL
        ELSE least(100, greatest(0, (gr.current_rating - gr.start_rating) * 100.0 /
          (gr.target_rating - gr.start_rating))) END), 1) goal_progress_pct
    FROM eligible e
    LEFT JOIN public.coachee_goals g ON g.enrollment_id = e.id
    LEFT JOIN public.coachee_goal_ratings gr
      ON gr.goal_id = g.id AND gr.enrollment_id = e.id
    GROUP BY e.id
  ), actions AS (
    SELECT e.id AS enrollment_id,
      count(a.id) FILTER (WHERE a.status IN ('open','in_progress'))::integer open_action_count,
      count(a.id) FILTER (WHERE a.status = 'completed')::integer completed_action_count,
      count(a.id)::integer total_action_count
    FROM eligible e
    LEFT JOIN public.enrollment_actions a ON a.enrollment_id = e.id
    GROUP BY e.id
  ), satisfaction AS (
    SELECT e.id AS enrollment_id, count(s.id)::integer rated_count,
      round(avg(s.coachee_rating), 2) avg_rating
    FROM eligible e
    LEFT JOIN public.sessions s ON s.enrollment_id = e.id
      AND s.status = 'completed' AND s.coachee_rating IS NOT NULL
    GROUP BY e.id
  )
  SELECT e.id, e.learner_display_name, e.programme_label, e.cohort_id,
    e.cohort_label,
    CASE
      WHEN e.status = 'active' AND e.programme_end_date < current_date
        THEN CASE WHEN pr.pace_status = 'completed'
                  THEN 'completed'::public.enrollment_status
                  ELSE 'at_risk'::public.enrollment_status END
      ELSE e.status
    END,
    coalesce(pr.required_units, 0), coalesce(pr.completed_units, 0),
    coalesce(pr.due_units, 0), pr.due_adherence_pct, pr.pace_status,
    coalesce(x.coaching, 0), coalesce(x.mentoring, 0),
    coalesce(x.peer, 0), coalesce(x.triad, 0), coalesce(g.goal_count, 0),
    coalesce(a.open_action_count, 0), coalesce(a.completed_action_count, 0),
    e.programme_id, e.start_date, e.end_date, e.programme_start_date,
    e.programme_end_date,
    CASE WHEN coalesce(pr.required_units, 0) = 0 THEN NULL
      ELSE round(least(pr.completed_units, pr.required_units) * 100.0 /
        pr.required_units, 1) END,
    coalesce(pr.booked_units, 0),
    greatest(0, coalesce(pr.due_units, 0) - coalesce(pr.completed_units, 0)),
    CASE WHEN coalesce(pr.due_units, 0) = 0 THEN NULL
      ELSE round(least(pr.completed_units + pr.booked_units, pr.due_units) * 100.0 /
        pr.due_units, 1) END,
    (coalesce(g.goal_setup, 0) > 0), g.goal_progress_pct,
    coalesce(a.total_action_count, 0),
    CASE WHEN coalesce(a.total_action_count, 0) = 0 THEN NULL
      ELSE round(a.completed_action_count * 100.0 / a.total_action_count, 1) END,
    sat.avg_rating, coalesce(sat.rated_count, 0),
    coalesce(mr.coaching_required_units, 0),
     coalesce(mr.coaching_completed_units, 0),
    coalesce(mr.coaching_due_units, 0),
    coalesce(mr.mentoring_required_units, 0),
     coalesce(mr.mentoring_completed_units, 0),
    coalesce(mr.mentoring_due_units, 0),
    coalesce(mr.peer_required_units, 0),
     coalesce(mr.peer_completed_units, 0),
    coalesce(mr.peer_due_units, 0),
    coalesce(mr.triad_required_units, 0),
     coalesce(mr.triad_completed_units, 0),
    coalesce(mr.triad_due_units, 0),
    coalesce(mr.training_required_units, 0),
     coalesce(mr.training_completed_units, 0),
    coalesce(mr.training_due_units, 0)
  FROM eligible e
  LEFT JOIN progress pr ON pr.enrollment_id = e.id
  LEFT JOIN module_rollup mr ON mr.enrollment_id = e.id
  LEFT JOIN completed x ON x.enrollment_id = e.id
  LEFT JOIN goals g ON g.enrollment_id = e.id
  LEFT JOIN actions a ON a.enrollment_id = e.id
  LEFT JOIN satisfaction sat ON sat.enrollment_id = e.id
  ORDER BY e.cohort_label, e.learner_display_name, e.id;
$$;

DROP FUNCTION IF EXISTS public.sponsor_cohort_summaries(uuid);
CREATE OR REPLACE FUNCTION public.sponsor_cohort_summaries(p_cohort_id uuid DEFAULT NULL)
RETURNS TABLE (
  cohort_id uuid,
  cohort_label text,
  programme_label text,
  programme_start_date date,
  programme_end_date date,
  programme_total_weeks integer,
  programme_current_week integer,
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
  on_track_pct numeric,
  coaching_required_per_leader integer,
  coaching_entitled_units integer,
  coaching_completed_units integer,
  coaching_expected_units integer,
  coaching_completed_leaders integer,
  mentoring_required_per_leader integer,
  mentoring_entitled_units integer,
  mentoring_completed_units integer,
  mentoring_expected_units integer,
  mentoring_completed_leaders integer,
  peer_required_per_leader integer,
  peer_entitled_units integer,
  peer_completed_units integer,
  peer_expected_units integer,
  peer_completed_leaders integer,
  triad_required_per_leader integer,
  triad_entitled_units integer,
  triad_completed_units integer,
  triad_expected_units integer,
  triad_completed_leaders integer,
  training_required_per_leader integer,
  training_entitled_units integer,
  training_completed_units integer,
  training_expected_units integer,
  training_completed_leaders integer
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
    SELECT cl.cohort_id AS scoped_cohort_id, r.*
    FROM cohort_list cl
    LEFT JOIN LATERAL public.sponsor_enrollment_summaries(cl.cohort_id) r ON true
  ), grouped AS (
    SELECT cl.cohort_id, cl.cohort_label, cl.programme_label,
      cl.programme_start_date, cl.programme_end_date,
      cl.enrollment_count AS n,
      sum(r.required_units)::integer required_units,
      sum(r.completed_units)::integer completed_units,
      sum(r.due_units)::integer due_units,
      least(100, round(sum(r.completed_units) * 100.0 /
        nullif(sum(r.due_units), 0), 1)) due_adherence_pct,
      sum(r.coaching_completed_count)::integer coaching,
      sum(r.mentoring_completed_count)::integer mentoring,
      sum(r.peer_completed_count)::integer peer,
      sum(r.triad_completed_count)::integer triad,
      sum(r.goal_count)::integer goals,
      sum(r.open_action_count)::integer open_actions,
      sum(r.completed_action_count)::integer completed_actions,
      sum(r.total_action_count)::integer total_actions,
      round(sum(r.completed_action_count) * 100.0 /
        nullif(sum(r.total_action_count), 0), 1) action_completion_pct,
      count(*) FILTER (WHERE r.goal_setup)::integer goal_setup_count,
      round(avg(r.goal_progress_pct), 1) goal_progress_pct,
      sum(r.satisfaction_avg * r.satisfaction_rated_count) /
        nullif(sum(r.satisfaction_rated_count), 0) satisfaction_avg,
      sum(r.satisfaction_rated_count)::integer satisfaction_rated_count,
      count(*) FILTER (WHERE r.pace_status = 'behind')::integer behind,
      count(*) FILTER (WHERE r.pace_status = 'scheduled')::integer scheduled,
      count(*) FILTER (WHERE r.pace_status = 'on_track')::integer on_track,
      count(*) FILTER (WHERE r.pace_status = 'ahead')::integer ahead,
      count(*) FILTER (WHERE r.pace_status = 'completed')::integer finished,
      count(*) FILTER (WHERE r.enrollment_status = 'active')::integer active_count,
      count(*) FILTER (WHERE r.enrollment_status = 'at_risk')::integer at_risk_count,
      count(*) FILTER (WHERE r.enrollment_status = 'paused')::integer paused_count,
      count(*) FILTER (WHERE r.enrollment_status = 'completed')::integer completed_count,
      count(*) FILTER (WHERE r.pace_status = 'not_yet_due')::integer not_yet_due_count,
      round(count(*) FILTER (WHERE r.pace_status = 'on_track') * 100.0 /
        nullif(cl.enrollment_count, 0), 1) on_track_pct,
      sum(r.overdue_units)::integer overdue_units,
      least(100, round(sum(r.completed_units) * 100.0 /
        nullif(sum(r.required_units), 0), 1)) full_completion_pct,
      sum(r.booked_units)::integer booked_units,
      least(100, round(sum(r.completed_units + r.booked_units) * 100.0 /
        nullif(sum(r.due_units), 0), 1)) schedule_coverage_pct,
      count(*) FILTER (WHERE r.pace_status = 'completed')::integer completed_pace_count,
      max(r.coaching_required_units)::integer coaching_required_per_leader,
      sum(r.coaching_required_units)::integer coaching_entitled_units,
      sum(r.coaching_completed_units)::integer coaching_completed_units,
      sum(r.coaching_due_units)::integer coaching_expected_units,
      count(*) FILTER (WHERE r.coaching_required_units > 0
        AND r.coaching_completed_units >= r.coaching_required_units)::integer coaching_completed_leaders,
      max(r.mentoring_required_units)::integer mentoring_required_per_leader,
      sum(r.mentoring_required_units)::integer mentoring_entitled_units,
      sum(r.mentoring_completed_units)::integer mentoring_completed_units,
      sum(r.mentoring_due_units)::integer mentoring_expected_units,
      count(*) FILTER (WHERE r.mentoring_required_units > 0
        AND r.mentoring_completed_units >= r.mentoring_required_units)::integer mentoring_completed_leaders,
      max(r.peer_required_units)::integer peer_required_per_leader,
      sum(r.peer_required_units)::integer peer_entitled_units,
      sum(r.peer_completed_units)::integer peer_completed_units,
      sum(r.peer_due_units)::integer peer_expected_units,
      count(*) FILTER (WHERE r.peer_required_units > 0
        AND r.peer_completed_units >= r.peer_required_units)::integer peer_completed_leaders,
      max(r.triad_required_units)::integer triad_required_per_leader,
      sum(r.triad_required_units)::integer triad_entitled_units,
      sum(r.triad_completed_units)::integer triad_completed_units,
      sum(r.triad_due_units)::integer triad_expected_units,
      count(*) FILTER (WHERE r.triad_required_units > 0
        AND r.triad_completed_units >= r.triad_required_units)::integer triad_completed_leaders,
      max(r.training_required_units)::integer training_required_per_leader,
      sum(r.training_required_units)::integer training_entitled_units,
      sum(r.training_completed_units)::integer training_completed_units,
      sum(r.training_due_units)::integer training_expected_units,
      count(*) FILTER (WHERE r.training_required_units > 0
        AND r.training_completed_units >= r.training_required_units)::integer training_completed_leaders
    FROM cohort_list cl
    LEFT JOIN rows r ON r.scoped_cohort_id = cl.cohort_id
    GROUP BY cl.cohort_id, cl.cohort_label, cl.programme_label,
      cl.programme_start_date, cl.programme_end_date, cl.enrollment_count
  )
  SELECT cohort_id, cohort_label, programme_label, programme_start_date,
    programme_end_date,
    greatest(1, ceil((programme_end_date - programme_start_date) / 7.0)::integer),
    CASE
      WHEN current_date < programme_start_date THEN 0
      ELSE least(
        greatest(1, ceil((programme_end_date - programme_start_date) / 7.0)::integer),
        greatest(0, ((current_date - programme_start_date) / 7) + 1)
      )
    END,
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
    CASE WHEN n < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE on_track_pct END,
    CASE WHEN n < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE coaching_required_per_leader END,
    CASE WHEN n < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE coaching_entitled_units END,
    CASE WHEN n < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE coaching_completed_units END,
    CASE WHEN n < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE coaching_expected_units END,
    CASE WHEN n < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE coaching_completed_leaders END,
    CASE WHEN n < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE mentoring_required_per_leader END,
    CASE WHEN n < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE mentoring_entitled_units END,
    CASE WHEN n < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE mentoring_completed_units END,
    CASE WHEN n < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE mentoring_expected_units END,
    CASE WHEN n < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE mentoring_completed_leaders END,
    CASE WHEN n < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE peer_required_per_leader END,
    CASE WHEN n < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE peer_entitled_units END,
    CASE WHEN n < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE peer_completed_units END,
    CASE WHEN n < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE peer_expected_units END,
    CASE WHEN n < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE peer_completed_leaders END,
    CASE WHEN n < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE triad_required_per_leader END,
    CASE WHEN n < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE triad_entitled_units END,
    CASE WHEN n < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE triad_completed_units END,
    CASE WHEN n < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE triad_expected_units END,
    CASE WHEN n < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE triad_completed_leaders END,
    CASE WHEN n < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE training_required_per_leader END,
    CASE WHEN n < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE training_entitled_units END,
    CASE WHEN n < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE training_completed_units END,
    CASE WHEN n < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE training_expected_units END,
    CASE WHEN n < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE training_completed_leaders END
  FROM grouped ORDER BY cohort_label;
$$;

REVOKE ALL ON FUNCTION public.sponsor_enrollment_summaries(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sponsor_cohort_summaries(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sponsor_enrollment_summaries(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sponsor_cohort_summaries(uuid) TO authenticated;