-- Canonical Sponsor reporting metrics.
--
-- Every Sponsor surface must aggregate the same enrollment-grain rows.  The
-- helper is intentionally not executable by application roles; the three
-- public Sponsor RPCs below are its privacy-scoped projections.

DROP FUNCTION IF EXISTS public.sponsor_metric_rows(uuid, date);
CREATE FUNCTION public.sponsor_metric_rows(
  p_cohort_id uuid,
  p_as_of date
)
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
  booked_units integer,
  overdue_units integer,
  full_completion_pct numeric,
  due_adherence_pct numeric,
  schedule_coverage_pct numeric,
  pace_status text,
  assessable boolean,
  on_track boolean,
  health_status text,
  session_required_units integer,
  session_completed_units integer,
  session_due_units integer,
  session_booked_units integer,
  session_overdue_units integer,
  coaching_completed_count integer,
  mentoring_completed_count integer,
  peer_completed_count integer,
  triad_completed_count integer,
  goal_count integer,
  goal_setup boolean,
  goal_setup_count integer,
  goal_rated_count integer,
  goal_progress_pct numeric,
  open_action_count integer,
  total_action_count integer,
  completed_action_count integer,
  action_completion_pct numeric,
  satisfaction_avg numeric,
  satisfaction_rated_count integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH sponsor AS (
    SELECT DISTINCT sp.organization_id
    FROM public.sponsor_profiles sp
    WHERE sp.user_id = auth.uid()
      AND auth.uid() IS NOT NULL
  ), cohort_sizes AS (
    SELECT c.id AS cohort_id,
           c.organization_id,
           count(e.id)::integer AS enrollment_count
    FROM public.cohorts c
    JOIN sponsor sp ON sp.organization_id = c.organization_id
    LEFT JOIN public.programme_enrollments e ON e.cohort_id = c.id
    GROUP BY c.id, c.organization_id
  ), visible_cohorts AS (
    SELECT cs.*
    FROM cohort_sizes cs
    WHERE cs.enrollment_count >= public.sponsor_min_leaders_for_distribution()
  ), eligible AS (
    SELECT e.id,
           e.user_id,
           e.programme_id,
           e.cohort_id,
           e.status AS enrollment_status,
           e.start_date,
           e.end_date,
           c.name AS cohort_label,
           p.name AS programme_label,
           pr.full_name AS learner_display_name
    FROM public.programme_enrollments e
    JOIN visible_cohorts vc ON vc.cohort_id = e.cohort_id
    JOIN public.cohorts c ON c.id = e.cohort_id
    JOIN public.programmes p ON p.id = e.programme_id
    JOIN public.profiles pr ON pr.id = e.user_id
    WHERE p_cohort_id IS NULL OR e.cohort_id = p_cohort_id
  ), progress AS (
    SELECT e.id AS enrollment_id,
      coalesce(sum(ep.required_units), 0)::integer AS required_units,
      coalesce(sum(ep.completed_units), 0)::integer AS completed_units,
      coalesce(sum(ep.due_units), 0)::integer AS due_units,
      coalesce(sum(ep.booked_units), 0)::integer AS booked_units,
      coalesce(sum(ep.required_units) FILTER (
        WHERE ep.module IN (
          'coaching'::public.programme_module_type,
          'mentoring'::public.programme_module_type,
          'peer_coaching'::public.programme_module_type,
          'triads'::public.programme_module_type
        )
      ), 0)::integer AS session_required_units,
      coalesce(sum(ep.completed_units) FILTER (
        WHERE ep.module IN (
          'coaching'::public.programme_module_type,
          'mentoring'::public.programme_module_type,
          'peer_coaching'::public.programme_module_type,
          'triads'::public.programme_module_type
        )
      ), 0)::integer AS session_completed_units,
      coalesce(sum(ep.due_units) FILTER (
        WHERE ep.module IN (
          'coaching'::public.programme_module_type,
          'mentoring'::public.programme_module_type,
          'peer_coaching'::public.programme_module_type,
          'triads'::public.programme_module_type
        )
      ), 0)::integer AS session_due_units,
      coalesce(sum(ep.booked_units) FILTER (
        WHERE ep.module IN (
          'coaching'::public.programme_module_type,
          'mentoring'::public.programme_module_type,
          'peer_coaching'::public.programme_module_type,
          'triads'::public.programme_module_type
        )
      ), 0)::integer AS session_booked_units,
      count(*) FILTER (
        WHERE ep.module = 'coaching'::public.programme_module_type
          AND ep.completed_units > 0
      )::integer AS coaching_completed_count,
      count(*) FILTER (
        WHERE ep.module = 'mentoring'::public.programme_module_type
          AND ep.completed_units > 0
      )::integer AS mentoring_completed_count,
      count(*) FILTER (
        WHERE ep.module = 'peer_coaching'::public.programme_module_type
          AND ep.completed_units > 0
      )::integer AS peer_completed_count,
      count(*) FILTER (
        WHERE ep.module = 'triads'::public.programme_module_type
          AND ep.completed_units > 0
      )::integer AS triad_completed_count
    FROM eligible e
    LEFT JOIN LATERAL public.get_enrollment_progress(e.id, p_as_of) ep ON true
    GROUP BY e.id
  ), goals AS (
    SELECT e.id AS enrollment_id,
      count(g.id)::integer AS goal_count,
      count(g.id) FILTER (WHERE g.id IS NOT NULL AND g.status <> 'cancelled')::integer AS goal_setup_count,
      count(g.id) FILTER (
        WHERE gr.id IS NOT NULL
          AND gr.target_rating IS NOT NULL
          AND gr.start_rating IS NOT NULL
          AND gr.target_rating IS DISTINCT FROM gr.start_rating
      )::integer AS goal_rated_count,
      round(avg(
        CASE
          WHEN gr.target_rating IS NULL
            OR gr.start_rating IS NULL
            OR gr.target_rating = gr.start_rating
          THEN NULL
          ELSE least(100, greatest(0,
            (gr.current_rating - gr.start_rating) * 100.0
              / (gr.target_rating - gr.start_rating)
          ))
        END
      ), 1) AS goal_progress_pct
    FROM eligible e
    LEFT JOIN public.coachee_goals g ON g.enrollment_id = e.id
    LEFT JOIN public.coachee_goal_ratings gr
      ON gr.goal_id = g.id
     AND gr.enrollment_id = e.id
    GROUP BY e.id
  ), actions AS (
    SELECT e.id AS enrollment_id,
      count(a.id) FILTER (WHERE a.status IN ('open', 'in_progress'))::integer AS open_action_count,
      count(a.id)::integer AS total_action_count,
      count(a.id) FILTER (WHERE a.status = 'completed')::integer AS completed_action_count
    FROM eligible e
    LEFT JOIN public.enrollment_actions a ON a.enrollment_id = e.id
    GROUP BY e.id
  ), satisfaction AS (
    SELECT e.id AS enrollment_id,
      count(s.id)::integer AS satisfaction_rated_count,
      round(avg(s.coachee_rating), 2) AS satisfaction_avg
    FROM eligible e
    LEFT JOIN public.sessions s
      ON s.enrollment_id = e.id
     AND s.status = 'completed'
     AND s.coachee_rating IS NOT NULL
    GROUP BY e.id
  ), base AS (
    SELECT
      e.*,
      coalesce(pr.required_units, 0) AS required_units,
      coalesce(pr.completed_units, 0) AS completed_units,
      coalesce(pr.due_units, 0) AS due_units,
      coalesce(pr.booked_units, 0) AS booked_units,
      coalesce(pr.session_required_units, 0) AS session_required_units,
      coalesce(pr.session_completed_units, 0) AS session_completed_units,
      coalesce(pr.session_due_units, 0) AS session_due_units,
      coalesce(pr.session_booked_units, 0) AS session_booked_units,
      coalesce(pr.coaching_completed_count, 0) AS coaching_completed_count,
      coalesce(pr.mentoring_completed_count, 0) AS mentoring_completed_count,
      coalesce(pr.peer_completed_count, 0) AS peer_completed_count,
      coalesce(pr.triad_completed_count, 0) AS triad_completed_count,
      coalesce(g.goal_count, 0) AS goal_count,
      coalesce(g.goal_setup_count, 0) AS goal_setup_count,
      coalesce(g.goal_rated_count, 0) AS goal_rated_count,
      g.goal_progress_pct,
      coalesce(a.open_action_count, 0) AS open_action_count,
      coalesce(a.total_action_count, 0) AS total_action_count,
      coalesce(a.completed_action_count, 0) AS completed_action_count,
      s.satisfaction_avg,
      coalesce(s.satisfaction_rated_count, 0) AS satisfaction_rated_count
    FROM eligible e
    LEFT JOIN progress pr ON pr.enrollment_id = e.id
    LEFT JOIN goals g ON g.enrollment_id = e.id
    LEFT JOIN actions a ON a.enrollment_id = e.id
    LEFT JOIN satisfaction s ON s.enrollment_id = e.id
  ), classified AS (
    SELECT b.*,
      CASE
        WHEN b.enrollment_status = 'completed'::public.enrollment_status
          OR (b.required_units > 0 AND b.completed_units >= b.required_units)
          THEN 'completed'
        WHEN b.due_units = 0 THEN 'not_yet_due'
        WHEN b.completed_units > b.due_units THEN 'ahead'
        WHEN b.completed_units >= b.due_units THEN 'on_track'
        WHEN b.completed_units + b.booked_units >= b.due_units THEN 'scheduled'
        ELSE 'behind'
      END AS pace_status
    FROM base b
  )
  SELECT
    c.id,
    c.learner_display_name,
    c.programme_label,
    c.cohort_id,
    c.cohort_label,
    c.enrollment_status,
    c.required_units,
    c.completed_units,
    c.due_units,
    c.booked_units,
    greatest(0, c.due_units - c.completed_units)::integer,
    CASE WHEN c.required_units = 0 THEN NULL
      ELSE round(least(c.completed_units, c.required_units) * 100.0 / c.required_units, 1)
    END,
    CASE WHEN c.due_units = 0 THEN NULL
      ELSE round(least(c.completed_units, c.due_units) * 100.0 / c.due_units, 1)
    END,
    CASE WHEN c.due_units = 0 THEN NULL
      ELSE round(least(c.completed_units + c.booked_units, c.due_units) * 100.0 / c.due_units, 1)
    END,
    c.pace_status,
    (c.enrollment_status IN (
      'active'::public.enrollment_status,
      'at_risk'::public.enrollment_status
    ) AND c.required_units > 0 AND c.due_units > 0),
    CASE
      WHEN c.enrollment_status IN (
        'active'::public.enrollment_status,
        'at_risk'::public.enrollment_status
      ) AND c.required_units > 0 AND c.due_units > 0
      THEN c.pace_status IN ('on_track', 'ahead')
      ELSE NULL
    END,
    CASE
      WHEN c.enrollment_status = 'completed'::public.enrollment_status THEN 'completed'
      WHEN c.enrollment_status = 'paused'::public.enrollment_status THEN 'paused'
      WHEN c.enrollment_status = 'at_risk'::public.enrollment_status
        OR c.pace_status = 'behind' THEN 'at_risk'
      WHEN c.pace_status = 'not_yet_due' THEN 'not_assessed'
      ELSE 'healthy'
    END,
    c.session_required_units,
    c.session_completed_units,
    c.session_due_units,
    c.session_booked_units,
    greatest(0, c.session_due_units - c.session_completed_units)::integer,
    c.coaching_completed_count,
    c.mentoring_completed_count,
    c.peer_completed_count,
    c.triad_completed_count,
    c.goal_count,
    (c.goal_setup_count > 0),
    c.goal_setup_count,
    c.goal_rated_count,
    c.goal_progress_pct,
    c.open_action_count,
    c.total_action_count,
    c.completed_action_count,
    CASE WHEN c.total_action_count = 0 THEN NULL
      ELSE round(c.completed_action_count * 100.0 / c.total_action_count, 1)
    END,
    c.satisfaction_avg,
    c.satisfaction_rated_count
  FROM classified c
  ORDER BY c.cohort_label, c.learner_display_name, c.id;
$$;

REVOKE ALL ON FUNCTION public.sponsor_metric_rows(uuid, date) FROM PUBLIC, anon, authenticated;

DROP FUNCTION IF EXISTS public.sponsor_enrollment_summaries(uuid);
CREATE FUNCTION public.sponsor_enrollment_summaries(p_cohort_id uuid)
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
  assessable boolean,
  on_track boolean,
  health_status text,
  session_required_units integer,
  session_completed_units integer,
  session_due_units integer,
  session_booked_units integer,
  session_overdue_units integer,
  goal_setup_count integer,
  goal_rated_count integer
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT r.enrollment_id, r.learner_display_name, r.programme_label,
    r.cohort_id, r.cohort_label, r.enrollment_status,
    r.required_units, r.completed_units, r.due_units, r.due_adherence_pct,
    r.pace_status, r.coaching_completed_count, r.mentoring_completed_count,
    r.peer_completed_count, r.triad_completed_count, r.goal_count,
    r.open_action_count, r.completed_action_count,
    e.programme_id, e.start_date, e.end_date,
    c.start_date, c.end_date, r.full_completion_pct, r.booked_units,
    r.overdue_units, r.schedule_coverage_pct, r.goal_setup,
    r.goal_progress_pct, r.total_action_count, r.action_completion_pct,
    r.satisfaction_avg, r.satisfaction_rated_count, r.assessable, r.on_track,
    r.health_status, r.session_required_units, r.session_completed_units,
    r.session_due_units, r.session_booked_units, r.session_overdue_units,
    r.goal_setup_count, r.goal_rated_count
  FROM public.sponsor_metric_rows(p_cohort_id, current_date) r
  JOIN public.programme_enrollments e ON e.id = r.enrollment_id
  JOIN public.cohorts c ON c.id = r.cohort_id;
$$;

DROP FUNCTION IF EXISTS public.sponsor_cohort_summaries(uuid);
CREATE FUNCTION public.sponsor_cohort_summaries(p_cohort_id uuid DEFAULT NULL)
RETURNS TABLE (
  cohort_id uuid,
  cohort_label text,
  programme_label text,
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
  assessable_count integer,
  not_assessed_count integer,
  health_status text,
  session_required_units integer,
  session_completed_units integer,
  session_due_units integer,
  session_booked_units integer,
  session_overdue_units integer
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  WITH sponsor AS (
    SELECT DISTINCT organization_id
    FROM public.sponsor_profiles
    WHERE user_id = auth.uid()
  ), info AS (
    SELECT c.id AS cohort_id, c.name AS cohort_label, p.name AS programme_label,
      count(e.id)::integer AS enrollment_count
    FROM public.cohorts c
    JOIN sponsor sp ON sp.organization_id = c.organization_id
    JOIN public.programmes p ON p.id = c.programme_id
    LEFT JOIN public.programme_enrollments e ON e.cohort_id = c.id
    WHERE p_cohort_id IS NULL OR c.id = p_cohort_id
    GROUP BY c.id, c.name, p.name
  ), rows AS (
    SELECT * FROM public.sponsor_metric_rows(p_cohort_id, current_date)
  ), agg AS (
    SELECT
      r.cohort_id,
      sum(r.required_units)::integer AS required_units,
      sum(r.completed_units)::integer AS completed_units,
      sum(r.due_units)::integer AS due_units,
      sum(r.booked_units)::integer AS booked_units,
      sum(r.overdue_units)::integer AS overdue_units,
      sum(r.session_required_units)::integer AS session_required_units,
      sum(r.session_completed_units)::integer AS session_completed_units,
      sum(r.session_due_units)::integer AS session_due_units,
      sum(r.session_booked_units)::integer AS session_booked_units,
      sum(r.session_overdue_units)::integer AS session_overdue_units,
      sum(r.coaching_completed_count)::integer AS coaching_completed_count,
      sum(r.mentoring_completed_count)::integer AS mentoring_completed_count,
      sum(r.peer_completed_count)::integer AS peer_completed_count,
      sum(r.triad_completed_count)::integer AS triad_completed_count,
      sum(r.goal_count)::integer AS goal_count,
      sum(r.open_action_count)::integer AS open_action_count,
      sum(r.completed_action_count)::integer AS completed_action_count,
      sum(r.total_action_count)::integer AS total_action_count,
      sum(r.satisfaction_rated_count)::integer AS satisfaction_rated_count,
      sum(r.satisfaction_avg * r.satisfaction_rated_count)
        / nullif(sum(r.satisfaction_rated_count), 0) AS satisfaction_avg,
      count(*) FILTER (WHERE r.enrollment_status = 'active')::integer AS active_count,
      count(*) FILTER (WHERE r.enrollment_status = 'at_risk')::integer AS at_risk_count,
      count(*) FILTER (WHERE r.enrollment_status = 'paused')::integer AS paused_count,
      count(*) FILTER (WHERE r.enrollment_status = 'completed')::integer AS completed_count,
      count(*) FILTER (WHERE r.pace_status = 'not_yet_due')::integer AS not_yet_due_count,
      count(*) FILTER (WHERE r.pace_status = 'ahead')::integer AS ahead_count,
      count(*) FILTER (WHERE r.pace_status = 'on_track')::integer AS on_track_count,
      count(*) FILTER (WHERE r.pace_status = 'scheduled')::integer AS scheduled_count,
      count(*) FILTER (WHERE r.pace_status = 'behind')::integer AS behind_count,
      count(*) FILTER (WHERE r.pace_status = 'completed')::integer AS completed_pace_count,
      count(*) FILTER (WHERE r.goal_setup)::integer AS goal_setup_count,
      sum(r.goal_progress_pct * r.goal_rated_count)
        / nullif(sum(r.goal_rated_count), 0) AS goal_progress_pct,
      count(*) FILTER (WHERE r.assessable)::integer AS assessable_count,
      count(*) FILTER (WHERE r.assessable IS NOT TRUE)::integer AS not_assessed_count,
      count(*) FILTER (WHERE r.on_track IS TRUE)::integer AS canonical_on_track_count
    FROM rows r
    GROUP BY r.cohort_id
  )
  SELECT i.cohort_id, i.cohort_label, i.programme_label, i.enrollment_count,
    (i.enrollment_count < public.sponsor_min_leaders_for_distribution()),
    CASE WHEN i.enrollment_count < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE a.required_units END,
    CASE WHEN i.enrollment_count < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE a.completed_units END,
    CASE WHEN i.enrollment_count < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE a.due_units END,
    CASE WHEN i.enrollment_count < public.sponsor_min_leaders_for_distribution() THEN NULL
      WHEN a.due_units = 0 THEN NULL ELSE round(least(a.completed_units,a.due_units)*100.0/a.due_units,1) END,
    CASE WHEN i.enrollment_count < public.sponsor_min_leaders_for_distribution() THEN NULL
      WHEN a.completed_count = i.enrollment_count THEN 'completed'
      WHEN a.behind_count > 0 THEN 'behind'
      WHEN a.scheduled_count > 0 THEN 'scheduled'
      WHEN a.on_track_count > 0 THEN 'on_track'
      WHEN a.ahead_count > 0 THEN 'ahead'
      ELSE 'not_yet_due' END,
    CASE WHEN i.enrollment_count < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE a.coaching_completed_count END,
    CASE WHEN i.enrollment_count < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE a.mentoring_completed_count END,
    CASE WHEN i.enrollment_count < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE a.peer_completed_count END,
    CASE WHEN i.enrollment_count < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE a.triad_completed_count END,
    CASE WHEN i.enrollment_count < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE a.goal_count END,
    CASE WHEN i.enrollment_count < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE a.open_action_count END,
    CASE WHEN i.enrollment_count < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE a.completed_action_count END,
    CASE WHEN i.enrollment_count < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE a.active_count END,
    CASE WHEN i.enrollment_count < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE a.at_risk_count END,
    CASE WHEN i.enrollment_count < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE a.paused_count END,
    CASE WHEN i.enrollment_count < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE a.completed_count END,
    CASE WHEN i.enrollment_count < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE a.not_yet_due_count END,
    CASE WHEN i.enrollment_count < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE a.ahead_count END,
    CASE WHEN i.enrollment_count < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE a.canonical_on_track_count END,
    CASE WHEN i.enrollment_count < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE a.scheduled_count END,
    CASE WHEN i.enrollment_count < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE a.behind_count END,
    CASE WHEN i.enrollment_count < public.sponsor_min_leaders_for_distribution() THEN NULL
      WHEN a.required_units = 0 THEN NULL ELSE round(least(a.completed_units,a.required_units)*100.0/a.required_units,1) END,
    CASE WHEN i.enrollment_count < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE a.booked_units END,
    CASE WHEN i.enrollment_count < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE a.overdue_units END,
    CASE WHEN i.enrollment_count < public.sponsor_min_leaders_for_distribution() THEN NULL
      WHEN a.due_units = 0 THEN NULL ELSE round(least(a.completed_units+a.booked_units,a.due_units)*100.0/a.due_units,1) END,
    CASE WHEN i.enrollment_count < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE a.completed_pace_count END,
    CASE WHEN i.enrollment_count < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE a.satisfaction_avg END,
    CASE WHEN i.enrollment_count < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE a.satisfaction_rated_count END,
    CASE WHEN i.enrollment_count < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE a.goal_setup_count END,
    CASE WHEN i.enrollment_count < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE a.goal_progress_pct END,
    CASE WHEN i.enrollment_count < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE a.total_action_count END,
    CASE WHEN i.enrollment_count < public.sponsor_min_leaders_for_distribution() THEN NULL
      WHEN a.total_action_count = 0 THEN NULL ELSE round(a.completed_action_count*100.0/a.total_action_count,1) END,
    CASE WHEN i.enrollment_count < public.sponsor_min_leaders_for_distribution() THEN NULL
      WHEN a.assessable_count = 0 THEN NULL ELSE round(a.canonical_on_track_count*100.0/a.assessable_count,1) END,
    CASE WHEN i.enrollment_count < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE a.assessable_count END,
    CASE WHEN i.enrollment_count < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE a.not_assessed_count END,
    CASE WHEN i.enrollment_count < public.sponsor_min_leaders_for_distribution() THEN NULL
      WHEN a.at_risk_count > 0 THEN 'at_risk'
      WHEN a.completed_count = i.enrollment_count THEN 'completed'
      WHEN a.assessable_count = 0 THEN 'not_assessed'
      ELSE 'healthy' END,
    CASE WHEN i.enrollment_count < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE a.session_required_units END,
    CASE WHEN i.enrollment_count < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE a.session_completed_units END,
    CASE WHEN i.enrollment_count < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE a.session_due_units END,
    CASE WHEN i.enrollment_count < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE a.session_booked_units END,
    CASE WHEN i.enrollment_count < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE a.session_overdue_units END
  FROM info i
  LEFT JOIN agg a ON a.cohort_id = i.cohort_id
  ORDER BY i.cohort_label;
$$;

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
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  WITH rows AS (
    SELECT * FROM public.sponsor_metric_rows(NULL, current_date)
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
      sum(r.goal_progress_pct * r.goal_rated_count)
        / nullif(sum(r.goal_rated_count), 0) AS goal_progress_pct,
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
$$;

DROP FUNCTION IF EXISTS public.sponsor_satisfaction_summary(uuid);
CREATE FUNCTION public.sponsor_satisfaction_summary(p_cohort_id uuid)
RETURNS TABLE(cohort_id uuid, rated_session_count integer, avg_rating numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT r.cohort_id,
    sum(r.satisfaction_rated_count)::integer,
    sum(r.satisfaction_avg * r.satisfaction_rated_count)
      / nullif(sum(r.satisfaction_rated_count), 0)
  FROM public.sponsor_metric_rows(p_cohort_id, current_date) r
  GROUP BY r.cohort_id;
$$;

REVOKE ALL ON FUNCTION public.sponsor_enrollment_summaries(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sponsor_cohort_summaries(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sponsor_organisation_summary() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sponsor_satisfaction_summary(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sponsor_enrollment_summaries(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sponsor_cohort_summaries(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sponsor_organisation_summary() TO authenticated;
GRANT EXECUTE ON FUNCTION public.sponsor_satisfaction_summary(uuid) TO authenticated;