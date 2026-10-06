-- ===========================================================================
-- Admin alerts, computed on read (findings A-3, A-4, A-9, D-15)
--
-- AdminAlerts.tsx ran a "scan" in the Admin's browser: it read raw tables,
-- re-derived overdue / missed / at-risk rules the database owns, and wrote
-- the result into admin_alerts as a snapshot that went stale as soon as the
-- data changed. Several messages also claimed the Coach / Mentor "can't mark
-- this session complete" until the learner's reflection, competency feedback
-- or preparation file arrived; nothing gates completion on evidence.
--
-- admin_alerts_current() returns the alerts that are true NOW, from canonical
-- rows, as structured fields (the page words them, in English or Vietnamese):
--
--   programme_at_risk       canonical effective status = at_risk (critical)
--   needs_attention         behind pace OR >= 1 overdue unit (decision 8):
--                           canonical_enrollment_progress
--   overdue_actions         >= 3 open actions past their due date (>= 5: critical)
--   reflection_outstanding  completed sessions whose learner reflection is not
--                           in yet (canonical_session_deliverable_state) -- a
--                           reminder only
--   mentor_feedback_outstanding  completed Mentoring sessions without the
--                           Mentor's feedback -- a reminder only
--   prep_file_outstanding   confirmed Mentoring sessions already started with
--                           no preparation file -- a reminder only
--   stale_programme_participant  canonical_enrollment_inactivity_internal
--   low_quiz_scores         average quiz score below 50%
--   goal_setup_overdue      enrollment_goal_gate_state (via admin_goal_setup_overdue)
--   coach_flagged_session   coach_session_feedback.flag_for_admin
--
-- Unresolved admin_alerts rows of any OTHER type (written by Edge Functions)
-- are passed through with their id, so the Admin can still resolve them.
-- Population: enrollments that are active, at risk or paused. "Today" is the
-- programme time zone.
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.admin_alerts_current()
 RETURNS TABLE(
   alert_key text, stored_alert_id uuid, severity text, alert_type text,
   related_enrollment_id uuid, related_user_id uuid, related_coach_id uuid,
   subject_name text, subject_email text, coach_name text,
   count_value integer, pct_value numeric, occurred_on date, note text,
   stored_title text, stored_message text, created_at timestamptz)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_today date := (now() AT TIME ZONE public.programme_time_zone())::date;
  live_types text[] := ARRAY['programme_at_risk', 'needs_attention', 'overdue_actions', 'reflection_outstanding',
    'mentor_feedback_outstanding', 'prep_file_outstanding', 'stale_programme_participant', 'low_quiz_scores',
    'goal_setup_overdue', 'coach_flagged_session',
    -- retired scan types: their stored snapshots are superseded
    'feedback_response', 'mentoring_prep_file', 'mentoring_feedback', 'triad_not_scheduled'];
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Only an Admin may read alerts' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH pop AS (
    SELECT e.id, e.user_id, pr.full_name, pr.email
    FROM public.programme_enrollments e
    JOIN public.profiles pr ON pr.id = e.user_id
    WHERE e.status IN ('active'::public.enrollment_status, 'at_risk'::public.enrollment_status,
                       'paused'::public.enrollment_status)
  ), progress AS (
    SELECT p.id, p.user_id, p.full_name, p.email, c.effective_enrollment_status, c.pace_status,
      c.overdue_units, c.full_completion_pct
    FROM pop p
    CROSS JOIN LATERAL public.canonical_enrollment_progress(p.id, v_today) c
  ), actions AS (
    SELECT a.enrollment_id, count(*)::integer AS overdue
    FROM public.enrollment_actions a
    JOIN pop p ON p.id = a.enrollment_id
    WHERE a.status <> 'completed' AND a.due_date IS NOT NULL AND a.due_date < v_today
    GROUP BY a.enrollment_id
  ), completed_sessions AS (
    SELECT 'sessions'::text AS source_table, s.id, s.enrollment_id, s.start_time FROM public.sessions s
    JOIN pop p ON p.id = s.enrollment_id WHERE s.status = 'completed'
    UNION ALL
    SELECT 'coachee_peer_sessions', s.id, s.enrollment_id, s.start_time FROM public.coachee_peer_sessions s
    JOIN pop p ON p.id = s.enrollment_id WHERE s.status = 'completed'
    UNION ALL
    SELECT 'mentoring_sessions', s.id, s.enrollment_id, s.start_time FROM public.mentoring_sessions s
    JOIN pop p ON p.id = s.enrollment_id WHERE s.status = 'completed'
  ), reflections AS (
    SELECT cs.enrollment_id, count(*)::integer AS missing,
      max((cs.start_time AT TIME ZONE public.programme_time_zone())::date) AS latest_on
    -- The learner's own post-session state for this session (the canonical
    -- deliverable state every role's session view reads).
    FROM completed_sessions cs
    CROSS JOIN LATERAL public.canonical_session_deliverable_state(cs.source_table, cs.id, cs.enrollment_id) d
    WHERE NOT d.has_reflection
    GROUP BY cs.enrollment_id
  ), mentoring AS (
    SELECT m.enrollment_id,
      count(*) FILTER (WHERE m.status = 'completed' AND m.feedback_submitted_at IS NULL)::integer AS feedback_missing,
      count(*) FILTER (WHERE m.status = 'confirmed' AND m.start_time < now() AND m.prep_file_path IS NULL)::integer AS prep_missing
    FROM public.mentoring_sessions m
    JOIN pop p ON p.id = m.enrollment_id
    GROUP BY m.enrollment_id
  ), quiz AS (
    SELECT s.enrollment_id, avg(s.score_pct) AS avg_pct, count(*)::integer AS n
    FROM public.assignment_submissions s
    JOIN public.assignments a ON a.id = s.assignment_id AND a.assignment_type = 'quiz'
    JOIN pop p ON p.id = s.enrollment_id
    WHERE s.score_pct IS NOT NULL
    GROUP BY s.enrollment_id
  ), inactive AS (
    SELECT i.enrollment_id, i.last_activity_at
    FROM public.canonical_enrollment_inactivity_internal(now()) i
    JOIN pop p ON p.id = i.enrollment_id
    WHERE i.is_inactive
  ), flagged AS (
    SELECT f.session_id, f.coach_id, f.flag_notes, f.created_at, s.coachee_id, s.enrollment_id
    FROM public.coach_session_feedback f
    LEFT JOIN public.sessions s ON s.id = f.session_id
    WHERE f.flag_for_admin
  )
  SELECT 'programme_at_risk:' || g.id, NULL::uuid, 'critical', 'programme_at_risk', g.id, g.user_id, NULL::uuid,
    g.full_name, g.email, NULL::text, g.overdue_units, g.full_completion_pct, NULL::date, NULL::text,
    NULL::text, NULL::text, NULL::timestamptz
  FROM progress g WHERE g.effective_enrollment_status = 'at_risk'
  UNION ALL
  SELECT 'needs_attention:' || g.id, NULL, 'warning', 'needs_attention', g.id, g.user_id, NULL,
    g.full_name, g.email, NULL, g.overdue_units, NULL, NULL, g.pace_status, NULL, NULL, NULL
  FROM progress g
  WHERE g.effective_enrollment_status IS DISTINCT FROM 'at_risk'
    AND (g.pace_status = 'behind' OR g.overdue_units >= 1)
  UNION ALL
  SELECT 'overdue_actions:' || p.id, NULL, CASE WHEN a.overdue >= 5 THEN 'critical' ELSE 'warning' END,
    'overdue_actions', p.id, p.user_id, NULL, p.full_name, p.email, NULL, a.overdue, NULL, NULL, NULL, NULL, NULL, NULL
  FROM actions a JOIN pop p ON p.id = a.enrollment_id WHERE a.overdue >= 3
  UNION ALL
  SELECT 'reflection_outstanding:' || p.id, NULL, 'info', 'reflection_outstanding', p.id, p.user_id, NULL,
    p.full_name, p.email, NULL, r.missing, NULL, r.latest_on, NULL, NULL, NULL, NULL
  FROM reflections r JOIN pop p ON p.id = r.enrollment_id
  UNION ALL
  SELECT 'mentor_feedback_outstanding:' || p.id, NULL, 'info', 'mentor_feedback_outstanding', p.id, p.user_id, NULL,
    p.full_name, p.email, NULL, m.feedback_missing, NULL, NULL, NULL, NULL, NULL, NULL
  FROM mentoring m JOIN pop p ON p.id = m.enrollment_id WHERE m.feedback_missing > 0
  UNION ALL
  SELECT 'prep_file_outstanding:' || p.id, NULL, 'info', 'prep_file_outstanding', p.id, p.user_id, NULL,
    p.full_name, p.email, NULL, m.prep_missing, NULL, NULL, NULL, NULL, NULL, NULL
  FROM mentoring m JOIN pop p ON p.id = m.enrollment_id WHERE m.prep_missing > 0
  UNION ALL
  SELECT 'stale_programme_participant:' || p.id, NULL, 'warning', 'stale_programme_participant', p.id, p.user_id, NULL,
    p.full_name, p.email, NULL, NULL, NULL,
    (i.last_activity_at AT TIME ZONE public.programme_time_zone())::date, NULL, NULL, NULL, NULL
  FROM inactive i JOIN pop p ON p.id = i.enrollment_id
  UNION ALL
  SELECT 'low_quiz_scores:' || p.id, NULL, 'warning', 'low_quiz_scores', p.id, p.user_id, NULL,
    p.full_name, p.email, NULL, q.n, round(q.avg_pct, 0), NULL, NULL, NULL, NULL, NULL
  FROM quiz q JOIN pop p ON p.id = q.enrollment_id WHERE q.avg_pct < 50
  UNION ALL
  SELECT 'goal_setup_overdue:' || o.enrollment_id, NULL, 'warning', 'goal_setup_overdue', o.enrollment_id, o.user_id, NULL,
    o.learner_name, pr.email, NULL, NULL, NULL, o.goal_setup_deadline, NULL, NULL, NULL, NULL
  FROM public.admin_goal_setup_overdue() o
  JOIN public.profiles pr ON pr.id = o.user_id
  UNION ALL
  SELECT 'coach_flagged_session:' || f.session_id || ':' || f.coach_id, NULL, 'warning', 'coach_flagged_session',
    f.enrollment_id, f.coachee_id, f.coach_id, lp.full_name, NULL, cp.full_name, NULL, NULL,
    (f.created_at AT TIME ZONE public.programme_time_zone())::date, f.flag_notes, NULL, NULL, f.created_at
  FROM flagged f
  LEFT JOIN public.profiles lp ON lp.id = f.coachee_id
  LEFT JOIN public.profiles cp ON cp.id = f.coach_id
  UNION ALL
  SELECT 'stored:' || a.id, a.id, a.severity::text, a.alert_type, a.related_enrollment_id, a.related_coachee_id,
    a.related_coach_id, pr.full_name, pr.email, NULL, NULL, NULL, NULL, NULL, a.title, a.message, a.created_at
  FROM public.admin_alerts a
  LEFT JOIN public.profiles pr ON pr.id = a.related_coachee_id
  WHERE NOT a.resolved AND NOT (a.alert_type = ANY (live_types));
END;
$function$;
REVOKE ALL ON FUNCTION public.admin_alerts_current() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_alerts_current() TO authenticated, service_role;
