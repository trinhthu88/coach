-- Sponsor overall satisfaction follow-up.
--
-- 20260913120000 fixed the cadence/on-track semantics and added the current
-- Sponsor response shapes. This migration keeps that deployed logic intact,
-- but replaces the old coaching-session-only satisfaction calculation with:
--   * completed 1:1 coachee ratings
--   * completed peer/coachee-peer ratings
--   * completed triad participant satisfaction ratings
--
-- Every included source is currently a validated 1–5 score. The normalizer is
-- still called for every event so a future standardized 1–10 input cannot be
-- averaged raw. Qualitative mentoring feedback, coach-private quality ratings,
-- and programme confidence/goal ratings are deliberately not satisfaction.

DROP FUNCTION IF EXISTS public.sponsor_normalize_satisfaction(numeric, numeric);
CREATE FUNCTION public.sponsor_normalize_satisfaction(
  p_score numeric,
  p_scale_max numeric
)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
STRICT
AS $$
  SELECT CASE
    WHEN p_scale_max <= 1 OR p_score < 1 OR p_score > p_scale_max THEN NULL
    ELSE round(1 + ((p_score - 1) * 4 / (p_scale_max - 1)), 4)
  END
$$;
REVOKE ALL ON FUNCTION public.sponsor_normalize_satisfaction(numeric, numeric) FROM PUBLIC, anon, authenticated;

DROP FUNCTION IF EXISTS public.sponsor_satisfaction_events();
CREATE FUNCTION public.sponsor_satisfaction_events()
RETURNS TABLE(enrollment_id uuid, score numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT s.enrollment_id,
    public.sponsor_normalize_satisfaction(s.coachee_rating, 5)
  FROM public.sessions s
  WHERE s.status = 'completed' AND s.coachee_rating IS NOT NULL
  UNION ALL
  SELECT s.enrollment_id,
    public.sponsor_normalize_satisfaction(s.coachee_rating, 5)
  FROM public.peer_sessions s
  WHERE s.status = 'completed' AND s.coachee_rating IS NOT NULL
  UNION ALL
  SELECT s.enrollment_id,
    public.sponsor_normalize_satisfaction(s.receiver_rating, 5)
  FROM public.coachee_peer_sessions s
  WHERE s.status = 'completed' AND s.receiver_rating IS NOT NULL
  UNION ALL
  SELECT r.enrollment_id,
    public.sponsor_normalize_satisfaction(r.satisfaction_rating, 5)
  FROM public.triad_reflections r
  JOIN public.triad_sessions ts ON ts.id = r.triad_session_id
  WHERE ts.status = 'completed' AND r.satisfaction_rating IS NOT NULL;
$$;
REVOKE ALL ON FUNCTION public.sponsor_satisfaction_events() FROM PUBLIC, anon, authenticated;

-- Keep the deployed canonical implementation as a private implementation
-- function. The wrapper below changes only satisfaction columns.
ALTER FUNCTION public.sponsor_metric_rows(uuid, date)
  RENAME TO sponsor_metric_rows_legacy;

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
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  WITH base AS (
    SELECT * FROM public.sponsor_metric_rows_legacy(p_cohort_id, p_as_of)
  ), satisfaction AS (
    SELECT e.enrollment_id,
      round(avg(e.score), 2) AS satisfaction_avg,
      count(*)::integer AS satisfaction_rated_count
    FROM public.sponsor_satisfaction_events() e
    JOIN base b ON b.enrollment_id = e.enrollment_id
    GROUP BY e.enrollment_id
  )
  SELECT b.enrollment_id, b.learner_display_name, b.programme_label,
    b.cohort_id, b.cohort_label, b.enrollment_status,
    b.required_units, b.completed_units, b.due_units, b.booked_units,
    b.overdue_units, b.full_completion_pct, b.due_adherence_pct,
    b.schedule_coverage_pct, b.pace_status, b.assessable, b.on_track,
    b.health_status, b.session_required_units, b.session_completed_units,
    b.session_due_units, b.session_booked_units, b.session_overdue_units,
    b.coaching_completed_count, b.mentoring_completed_count,
    b.peer_completed_count, b.triad_completed_count, b.goal_count,
    b.goal_setup, b.goal_setup_count, b.goal_rated_count,
    b.goal_progress_pct, b.open_action_count, b.total_action_count,
    b.completed_action_count, b.action_completion_pct,
    s.satisfaction_avg, coalesce(s.satisfaction_rated_count, 0)
  FROM base b
  LEFT JOIN satisfaction s ON s.enrollment_id = b.enrollment_id
  ORDER BY b.cohort_label, b.learner_display_name, b.enrollment_id;
$$;
REVOKE ALL ON FUNCTION public.sponsor_metric_rows(uuid, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sponsor_metric_rows(uuid, date) TO authenticated;

-- The existing cohort RPC already gets its response count from the canonical
-- enrollment rows. Re-wrap only its average so each leader contributes one
-- equally weighted value, regardless of how many responses that leader gave.
ALTER FUNCTION public.sponsor_cohort_summaries(uuid)
  RENAME TO sponsor_cohort_summaries_legacy;

CREATE FUNCTION public.sponsor_cohort_summaries(p_cohort_id uuid DEFAULT NULL)
RETURNS TABLE (
  cohort_id uuid, cohort_label text, programme_label text,
  enrollment_count integer, suppressed boolean,
  required_units integer, completed_units integer, due_units integer,
  due_adherence_pct numeric, pace_status text,
  coaching_completed_count integer, mentoring_completed_count integer,
  peer_completed_count integer, triad_completed_count integer,
  goal_count integer, open_action_count integer, completed_action_count integer,
  active_count integer, at_risk_count integer, paused_count integer,
  completed_count integer, not_yet_due_count integer, ahead_count integer,
  on_track_count integer, scheduled_count integer, behind_count integer,
  full_completion_pct numeric, booked_units integer, overdue_units integer,
  schedule_coverage_pct numeric, completed_pace_count integer,
  satisfaction_avg numeric, satisfaction_rated_count integer,
  goal_setup_count integer, goal_progress_pct numeric,
  total_action_count integer, action_completion_pct numeric,
  on_track_pct numeric, assessable_count integer, not_assessed_count integer,
  health_status text, session_required_units integer,
  session_completed_units integer, session_due_units integer,
  session_booked_units integer, session_overdue_units integer,
  cohort_start_date date, cohort_end_date date, cohort_status text,
  current_week integer, total_weeks integer, cadence_completion_pct numeric
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  WITH old_summary AS (
    SELECT * FROM public.sponsor_cohort_summaries_legacy(p_cohort_id)
  ), equal_leader_average AS (
    SELECT r.cohort_id, avg(r.satisfaction_avg) AS satisfaction_avg
    FROM public.sponsor_metric_rows(p_cohort_id, current_date) r
    WHERE r.satisfaction_avg IS NOT NULL
    GROUP BY r.cohort_id
  )
  SELECT o.cohort_id, o.cohort_label, o.programme_label,
    o.enrollment_count, o.suppressed, o.required_units, o.completed_units,
    o.due_units, o.due_adherence_pct, o.pace_status,
    o.coaching_completed_count, o.mentoring_completed_count,
    o.peer_completed_count, o.triad_completed_count, o.goal_count,
    o.open_action_count, o.completed_action_count, o.active_count,
    o.at_risk_count, o.paused_count, o.completed_count,
    o.not_yet_due_count, o.ahead_count, o.on_track_count,
    o.scheduled_count, o.behind_count, o.full_completion_pct,
    o.booked_units, o.overdue_units, o.schedule_coverage_pct,
    o.completed_pace_count,
    CASE WHEN o.suppressed THEN NULL ELSE a.satisfaction_avg END,
    o.satisfaction_rated_count, o.goal_setup_count, o.goal_progress_pct,
    o.total_action_count, o.action_completion_pct, o.on_track_pct,
    o.assessable_count, o.not_assessed_count, o.health_status,
    o.session_required_units, o.session_completed_units, o.session_due_units,
    o.session_booked_units, o.session_overdue_units, o.cohort_start_date,
    o.cohort_end_date, o.cohort_status, o.current_week, o.total_weeks,
    o.cadence_completion_pct
  FROM old_summary o
  LEFT JOIN equal_leader_average a ON a.cohort_id = o.cohort_id;
$$;
REVOKE ALL ON FUNCTION public.sponsor_cohort_summaries(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sponsor_cohort_summaries(uuid) TO authenticated;

ALTER FUNCTION public.sponsor_organisation_summary()
  RENAME TO sponsor_organisation_summary_legacy;

CREATE FUNCTION public.sponsor_organisation_summary()
RETURNS TABLE (
  cohort_count integer, enrollment_count integer, active_count integer,
  at_risk_count integer, paused_count integer, completed_count integer,
  required_units integer, completed_units integer, due_units integer,
  booked_units integer, overdue_units integer, full_completion_pct numeric,
  due_adherence_pct numeric, schedule_coverage_pct numeric,
  not_yet_due_count integer, ahead_count integer, on_track_count integer,
  scheduled_count integer, behind_count integer, completed_pace_count integer,
  goal_count integer, goal_setup_count integer, goal_progress_pct numeric,
  total_action_count integer, completed_action_count integer,
  action_completion_pct numeric, satisfaction_avg numeric,
  satisfaction_rated_count integer, suppressed boolean,
  assessable_count integer, not_assessed_count integer, health_status text,
  session_required_units integer, session_completed_units integer,
  session_due_units integer, session_booked_units integer,
  session_overdue_units integer
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  WITH old_summary AS (
    SELECT * FROM public.sponsor_organisation_summary_legacy()
  ), equal_leader_average AS (
    SELECT avg(r.satisfaction_avg) AS satisfaction_avg
    FROM public.sponsor_metric_rows(NULL, current_date) r
    WHERE r.satisfaction_avg IS NOT NULL
  )
  SELECT o.cohort_count, o.enrollment_count, o.active_count, o.at_risk_count,
    o.paused_count, o.completed_count, o.required_units, o.completed_units,
    o.due_units, o.booked_units, o.overdue_units, o.full_completion_pct,
    o.due_adherence_pct, o.schedule_coverage_pct, o.not_yet_due_count,
    o.ahead_count, o.on_track_count, o.scheduled_count, o.behind_count,
    o.completed_pace_count, o.goal_count, o.goal_setup_count,
    o.goal_progress_pct, o.total_action_count, o.completed_action_count,
    o.action_completion_pct,
    CASE WHEN o.suppressed THEN NULL ELSE a.satisfaction_avg END,
    o.satisfaction_rated_count, o.suppressed, o.assessable_count,
    o.not_assessed_count, o.health_status, o.session_required_units,
    o.session_completed_units, o.session_due_units, o.session_booked_units,
    o.session_overdue_units
  FROM old_summary o
  CROSS JOIN equal_leader_average a;
$$;
REVOKE ALL ON FUNCTION public.sponsor_organisation_summary() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sponsor_organisation_summary() TO authenticated;