-- ===========================================================================
-- Missing decisions (Prompt 13: decisions 5, 7, 9)
--
--   1. 9e: organizations.is_demo (default false); the demo organisations are
--      marked.
--   2. reporting_enrollments(): THE reporting population -- every enrollment
--      except those of a demo organisation, which only that organisation's
--      own Sponsor still sees (the live demo's Demo Sponsor).
--   3. Every Admin and Sponsor rollup reads it: sponsor_visible_enrollments
--      (and with it every sponsor_* function), admin_alerts_current,
--      admin_goal_setup_overdue, admin_enrollment_inactivity,
--      admin_enrollment_satisfaction, triad_reflection_rate_internal (Admin
--      Analytics and the weekly admin email), and
--   4. admin_canonical_completion_rate, whose population is now chosen here,
--      not sent by the browser. The weekly admin email (service role) reads
--      reporting_enrollments() itself.
--   5. Decision 7: transition_mentoring_session_status cancels like Coaching
--      (free until 24 h before, a reason inside 24 h) and a learner no-show
--      counts as held (from the start only the Mentor or an Admin acts).
--   6. Decision 9: final_assessment_* columns in the progress rollups, so the
--      Sponsor module cards add up to the total.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Demo organisations
-- ---------------------------------------------------------------------------
-- Written by an Admin only ("Organizations: admin manage" is the one write
-- policy on organizations).
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.organizations.is_demo IS
  'A demonstration organisation: left out of every Admin and Sponsor rollup (reporting_enrollments), except for its own Sponsor (20261007000800).';
-- The demo seeds' organisations (seed-demo.sql, seed.sql) and the live-demo
-- design's "Clariva Demo Organization". The seeds also set the flag themselves.
UPDATE public.organizations SET is_demo = true
 WHERE id IN ('d0000000-0000-4000-8000-00000000bbbb', 'de0a0000-0000-4000-8000-00000000000a',
              '11111111-1111-4111-8111-111111111111')
    OR name IN ('Clariva Demo Organization A', 'Clariva Demo Organization B',
                'Clariva Erickson Demo Organisation', 'Clariva Demo Organization');

-- ---------------------------------------------------------------------------
-- 2. reporting_enrollments()
-- ---------------------------------------------------------------------------
-- An invoker SQL function with no SET clause, so the planner inlines it into
-- the definer functions that call it (sponsor_visible_enrollments is read on
-- every Sponsor page). Every name is schema-qualified. Not client-callable.
CREATE OR REPLACE FUNCTION public.reporting_enrollments()
 RETURNS TABLE(enrollment_id uuid, user_id uuid, programme_id uuid, cohort_id uuid, organization_id uuid,
               status public.enrollment_status)
 LANGUAGE sql
 STABLE
AS $function$
  SELECT e.id, e.user_id, e.programme_id, e.cohort_id, e.organization_id, e.status
  FROM public.programme_enrollments e
  LEFT JOIN public.organizations o ON o.id = e.organization_id
  WHERE NOT coalesce(o.is_demo, false)
     -- A demo organisation's own Sponsor still sees it.
     OR EXISTS (SELECT 1 FROM public.sponsor_profiles sp
                WHERE sp.user_id = auth.uid() AND sp.organization_id = e.organization_id);
$function$;
REVOKE ALL ON FUNCTION public.reporting_enrollments() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reporting_enrollments() TO service_role;

-- ---------------------------------------------------------------------------
-- 3. The population behind every rollup
-- ---------------------------------------------------------------------------
-- Sponsor: the predicate is part of THE visibility rule. A Sponsor's own
-- organisation always passes it, so a real Sponsor's view is unchanged and
-- the Demo Sponsor keeps a working demo; nobody else's demo rows can enter.
CREATE OR REPLACE FUNCTION public.sponsor_visible_enrollments()
 RETURNS TABLE(enrollment_id uuid, cohort_id uuid, organization_id uuid)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  -- THE sponsor visibility rule: an enrollment is visible to the calling
  -- sponsor iff its organization_id equals the sponsor's organisation, and
  -- the caller currently holds the sponsor role. A NULL enrollment
  -- organisation matches no sponsor. The cohort's organisation is
  -- deliberately not consulted.
  SELECT e.id, e.cohort_id, e.organization_id
  FROM public.sponsor_profiles sp
  JOIN public.programme_enrollments e
    ON e.organization_id = sp.organization_id
  JOIN public.reporting_enrollments() r ON r.enrollment_id = e.id
  WHERE sp.user_id = auth.uid()
    AND auth.uid() IS NOT NULL
    AND public.has_role(auth.uid(), 'sponsor'::public.app_role);
$function$;
-- Admin: alerts are computed for reported enrollments only; a flagged
-- session or stored alert of a demo enrollment is left out too.
CREATE OR REPLACE FUNCTION public.admin_alerts_current()
 RETURNS TABLE(alert_key text, stored_alert_id uuid, severity text, alert_type text, related_enrollment_id uuid, related_user_id uuid, related_coach_id uuid, subject_name text, subject_email text, coach_name text, count_value integer, pct_value numeric, occurred_on date, note text, stored_title text, stored_message text, created_at timestamp with time zone)
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
    JOIN public.reporting_enrollments() r ON r.enrollment_id = e.id
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
      AND (s.enrollment_id IS NULL OR s.enrollment_id IN (SELECT re.enrollment_id FROM public.reporting_enrollments() re))
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
  WHERE NOT a.resolved AND NOT (a.alert_type = ANY (live_types))
    AND (a.related_enrollment_id IS NULL OR a.related_enrollment_id IN (SELECT re.enrollment_id FROM public.reporting_enrollments() re));
END;
$function$;
CREATE OR REPLACE FUNCTION public.admin_goal_setup_overdue()
 RETURNS TABLE(enrollment_id uuid, user_id uuid, learner_name text, cohort_id uuid, goal_setup_deadline date)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT e.id, e.user_id, p.full_name, e.cohort_id, (s->>'goal_setup_deadline')::date
  FROM public.programme_enrollments e
  JOIN public.reporting_enrollments() r ON r.enrollment_id = e.id
  JOIN public.profiles p ON p.id = e.user_id
  CROSS JOIN LATERAL public.enrollment_goal_gate_state(e.id) s
  WHERE public.has_role(auth.uid(), 'admin'::public.app_role)
    AND e.status IN ('active'::public.enrollment_status, 'at_risk'::public.enrollment_status, 'paused'::public.enrollment_status)
    AND (s->>'goal_setup_overdue')::boolean
  ORDER BY (s->>'goal_setup_deadline')::date, p.full_name;
$function$;
CREATE OR REPLACE FUNCTION public.admin_enrollment_inactivity(p_programme_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(enrollment_id uuid, user_id uuid, full_name text, programme_id uuid, cohort_id uuid, last_activity_at timestamp with time zone, days_since_last_activity integer, is_inactive boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Only admins can read engagement signals' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT i.enrollment_id, i.user_id, pr.full_name, i.programme_id, i.cohort_id,
    i.last_activity_at, i.days_since_last_activity, i.is_inactive
  FROM public.canonical_enrollment_inactivity_internal(now()) i
  JOIN public.profiles pr ON pr.id = i.user_id
  WHERE (p_programme_id IS NULL OR i.programme_id = p_programme_id)
    AND i.enrollment_id IN (SELECT re.enrollment_id FROM public.reporting_enrollments() re);
END $function$;
-- The browser still names the enrollments; the server keeps only reported ones.
CREATE OR REPLACE FUNCTION public.admin_enrollment_satisfaction(p_enrollment_ids uuid[])
 RETURNS TABLE(enrollment_id uuid, module programme_module_type, rated_count integer, rating_sum integer, satisfaction_avg numeric, rating_counts integer[])
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT e.id, r.module, count(*)::integer, sum(r.rating)::integer, round(avg(r.rating), 2),
    ARRAY[
      count(*) FILTER (WHERE r.rating = 1),
      count(*) FILTER (WHERE r.rating = 2),
      count(*) FILTER (WHERE r.rating = 3),
      count(*) FILTER (WHERE r.rating = 4),
      count(*) FILTER (WHERE r.rating = 5)
    ]::integer[]
  FROM unnest(coalesce(p_enrollment_ids, ARRAY[]::uuid[])) AS x(id)
  JOIN public.programme_enrollments e ON e.id = x.id
  JOIN public.reporting_enrollments() re ON re.enrollment_id = e.id
  CROSS JOIN LATERAL public.canonical_enrollment_satisfaction(e.id) r
  WHERE public.has_role(auth.uid(), 'admin'::public.app_role)
  GROUP BY e.id, r.module;
$function$;
-- Read by admin_programme_triad_reflection_rate and the weekly admin email.
CREATE OR REPLACE FUNCTION public.triad_reflection_rate_internal(p_programme_id uuid, p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date)
 RETURNS TABLE(training_week_id uuid, is_total boolean, expected_reflections integer, submitted_reflections integer, rate_pct numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH expected AS (
    SELECT wk.training_week_id,
      EXISTS (SELECT 1 FROM public.triad_reflections r
              WHERE r.triad_session_id = s.id AND r.enrollment_id = m.enrollment_id) AS submitted
    FROM public.triad_sessions s
    JOIN public.triad_group_members m ON m.triad_group_id = s.triad_group_id
    JOIN public.programme_enrollments e ON e.id = m.enrollment_id
    JOIN public.reporting_enrollments() re ON re.enrollment_id = e.id
    LEFT JOIN LATERAL (
      SELECT i.training_week_id
      FROM public.canonical_training_learning_items(m.enrollment_id, public.programme_today()) i
      WHERE i.training_week_id IS NOT NULL AND i.due_on <= (s.scheduled_start_time AT TIME ZONE public.programme_time_zone())::date
      ORDER BY i.due_on DESC, i.training_week_id
      LIMIT 1
    ) wk ON true
    WHERE e.programme_id = p_programme_id
      AND s.status = 'completed'
      AND (p_from IS NULL OR (s.scheduled_start_time AT TIME ZONE public.programme_time_zone())::date >= p_from)
      AND (p_to IS NULL OR (s.scheduled_start_time AT TIME ZONE public.programme_time_zone())::date <= p_to)
  )
  SELECT x.training_week_id, grouping(x.training_week_id) = 1,
    count(*)::integer, count(*) FILTER (WHERE x.submitted)::integer,
    round(100.0 * count(*) FILTER (WHERE x.submitted) / nullif(count(*), 0), 1)
  FROM expected x
  GROUP BY ROLLUP (x.training_week_id);
$function$;
-- ---------------------------------------------------------------------------
-- 4. admin_canonical_completion_rate: the population is the server's
-- ---------------------------------------------------------------------------
-- Was (p_enrollment_ids uuid[], p_as_of): the Admin dashboard sent every
-- enrollment id it could read. Now: the reporting population, optionally one
-- programme. The service role may read it too.
DROP FUNCTION IF EXISTS public.admin_canonical_completion_rate(uuid[], date);
CREATE OR REPLACE FUNCTION public.admin_canonical_completion_rate(
  p_as_of date DEFAULT public.programme_today(), p_programme_id uuid DEFAULT NULL)
 RETURNS TABLE(enrollment_count integer, required_units integer, completed_units integer, full_completion_pct numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND (auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin'::public.app_role)) THEN
    RAISE EXCEPTION 'Only an Admin may read the completion rate' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  WITH rows AS (
    SELECT p.required_units, p.completed_units
    FROM public.reporting_enrollments() re
    CROSS JOIN LATERAL public.canonical_enrollment_progress(re.enrollment_id, p_as_of) p
    WHERE p.progress_available
      AND (p_programme_id IS NULL OR re.programme_id = p_programme_id)
  ), totals AS (
    SELECT count(*)::integer AS n,
      coalesce(sum(r.required_units), 0)::integer AS required,
      coalesce(sum(r.completed_units), 0)::integer AS completed
    FROM rows r
  )
  -- The Sponsor cohort / organisation formula.
  SELECT t.n, t.required, t.completed,
    CASE WHEN t.required = 0 THEN NULL ELSE round(least(t.completed, t.required) * 100.0 / t.required, 1) END
  FROM totals t;
END;
$function$;
REVOKE ALL ON FUNCTION public.admin_canonical_completion_rate(date, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_canonical_completion_rate(date, uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. Decision 7: Mentoring cancels like Coaching; a no-show counts as held
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.transition_mentoring_session_status(p_session_id uuid, p_status text, p_reason text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_is_admin boolean;
  v_s record;
  v_next public.session_status;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  v_is_admin := public.has_role(v_actor, 'admin'::public.app_role);

  IF p_status NOT IN ('confirmed', 'completed', 'cancelled') THEN
    RAISE EXCEPTION 'Unsupported Mentoring transition target %', p_status USING ERRCODE = '23514';
  END IF;
  v_next := p_status::public.session_status;

  SELECT s.id, s.mentor_id, s.mentee_id, s.status, s.start_time
    INTO v_s
  FROM public.mentoring_sessions s WHERE s.id = p_session_id
  FOR UPDATE;

  IF v_s.id IS NULL THEN
    RAISE EXCEPTION 'Mentoring session % does not exist', p_session_id USING ERRCODE = '23503';
  END IF;
  IF NOT (v_is_admin OR v_actor = v_s.mentor_id OR v_actor = v_s.mentee_id) THEN
    RAISE EXCEPTION 'Not authorised to change this Mentoring session' USING ERRCODE = '42501';
  END IF;

  IF v_next = 'confirmed'::public.session_status THEN
    IF v_s.status <> 'pending_coach_approval'::public.session_status THEN
      RAISE EXCEPTION 'Only a pending Mentoring session can be confirmed (status=%)', v_s.status
        USING ERRCODE = '23514';
    END IF;
    -- The mentor accepts the request; the mentee cannot accept on their behalf.
    IF NOT (v_is_admin OR v_actor = v_s.mentor_id) THEN
      RAISE EXCEPTION 'Only the mentor or an Admin may confirm a Mentoring session'
        USING ERRCODE = '42501';
    END IF;

  ELSIF v_next = 'completed'::public.session_status THEN
    IF v_s.status <> 'confirmed'::public.session_status THEN
      RAISE EXCEPTION 'Only a confirmed Mentoring session can be completed (status=%)', v_s.status
        USING ERRCODE = '23514';
    END IF;
    IF NOT (v_is_admin OR v_actor = v_s.mentor_id) THEN
      RAISE EXCEPTION 'Only the mentor or an Admin may mark a Mentoring session complete'
        USING ERRCODE = '42501';
    END IF;
    IF v_s.start_time > now() THEN
      RAISE EXCEPTION 'A session cannot be completed before it starts' USING ERRCODE = '23514';
    END IF;

  ELSE -- cancelled
    IF v_s.status NOT IN ('pending_coach_approval'::public.session_status,
                          'confirmed'::public.session_status) THEN
      RAISE EXCEPTION 'Only a live Mentoring session can be cancelled (status=%)', v_s.status
        USING ERRCODE = '23514';
    END IF;
    -- Decision 7, the Coaching rules (cancel_coaching_session). The Mentor
    -- and an Admin are never blocked. The mentee cancels freely until 24
    -- hours before, with a reason inside 24 hours, and not at all once the
    -- session has started: a no-show is the Mentor's to mark held.
    IF NOT v_is_admin AND v_actor = v_s.mentee_id AND v_actor IS DISTINCT FROM v_s.mentor_id THEN
      IF v_s.start_time <= now() THEN
        RAISE EXCEPTION 'The session has started: only the Mentor or an Admin can change it now'
          USING ERRCODE = '42501';
      END IF;
      IF v_s.start_time - now() < interval '24 hours' AND (p_reason IS NULL OR length(btrim(p_reason)) = 0) THEN
        RAISE EXCEPTION 'A reason is required to cancel within 24 hours of the session'
          USING ERRCODE = '23514';
      END IF;
    END IF;
  END IF;

  PERFORM set_config('app.session_transition', 'on', true);

  UPDATE public.mentoring_sessions
     SET status = v_next,
         confirmed_at = CASE WHEN v_next = 'confirmed'::public.session_status
                             THEN now() ELSE confirmed_at END,
         cancelled_at = CASE WHEN v_next = 'cancelled'::public.session_status
                             THEN now() ELSE cancelled_at END,
         cancelled_by = CASE WHEN v_next = 'cancelled'::public.session_status
                             THEN v_actor ELSE cancelled_by END,
         cancel_reason = CASE WHEN v_next = 'cancelled'::public.session_status
                              THEN p_reason ELSE cancel_reason END
   WHERE id = p_session_id;
  -- sync_mentoring_slot_reservation() releases the slot on cancellation; the
  -- partial unique indexes release the slot and the requirement by no longer
  -- matching this row.

  RETURN p_session_id;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 6. Decision 9: final_assessment_* in the progress rollups
-- ---------------------------------------------------------------------------
-- canonical_module_progress has always counted the Final Assessment in
-- required_units / completed_units; the per-module columns did not, so the
-- Sponsor module cards did not add up to the total. Each rollup gains the
-- same four (cohort rollups five, with completed leaders) columns after the
-- Triad ones. The return type changes, so each is dropped and recreated with
-- its grants; bodies are otherwise unchanged.
DROP FUNCTION IF EXISTS public.canonical_enrollment_progress(p_enrollment_id uuid, p_as_of date);
DROP FUNCTION IF EXISTS public.learner_canonical_progress(p_enrollment_id uuid, p_as_of date);
DROP FUNCTION IF EXISTS public.admin_canonical_enrollment_progress(p_enrollment_ids uuid[], p_as_of date);
DROP FUNCTION IF EXISTS public.sponsor_canonical_enrollment_progress(p_cohort_id uuid, p_as_of date);
DROP FUNCTION IF EXISTS public.sponsor_canonical_leader_progress(p_enrollment_id uuid, p_as_of date);
DROP FUNCTION IF EXISTS public.sponsor_canonical_enrollment_metadata(p_cohort_id uuid, p_enrollment_id uuid, p_as_of date);
DROP FUNCTION IF EXISTS public.sponsor_canonical_cohort_progress_one(p_cohort_id uuid, p_as_of date);
DROP FUNCTION IF EXISTS public.sponsor_canonical_cohort_progress(p_cohort_id uuid, p_as_of date);
DROP FUNCTION IF EXISTS public.sponsor_canonical_organisation_progress(p_as_of date);

CREATE OR REPLACE FUNCTION public.canonical_enrollment_progress(p_enrollment_id uuid, p_as_of date DEFAULT programme_today())
 RETURNS TABLE(enrollment_id uuid, learner_display_name text, programme_label text, cohort_id uuid, cohort_label text, programme_id uuid, enrollment_start_date date, enrollment_end_date date, programme_start_date date, programme_end_date date, enrollment_status enrollment_status, stored_enrollment_status enrollment_status, effective_enrollment_status enrollment_status, required_units integer, completed_units integer, due_units integer, booked_units integer, overdue_units integer, full_completion_pct numeric, due_adherence_pct numeric, pace_status text, progress_available boolean, coaching_required_units integer, coaching_completed_units integer, coaching_due_units integer, coaching_booked_units integer, training_required_units integer, training_completed_units integer, training_due_units integer, training_booked_units integer, peer_required_units integer, peer_completed_units integer, peer_due_units integer, peer_booked_units integer, mentoring_required_units integer, mentoring_completed_units integer, mentoring_due_units integer, mentoring_booked_units integer, triad_required_units integer, triad_completed_units integer, triad_due_units integer, triad_booked_units integer, final_assessment_required_units integer, final_assessment_completed_units integer, final_assessment_due_units integer, final_assessment_booked_units integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH eligible AS (
    SELECT e.id, e.programme_id, e.cohort_id, e.user_id,
      -- The enrollment's EFFECTIVE window: its own dates, else its cohort's.
      -- An ongoing enrollment normally carries no end date of its own, and
      -- every surface (learner header, journey card, sponsor, admin) must
      -- show one date range, not "May 25 - ".
      coalesce(e.start_date, c.start_date) AS start_date,
      coalesce(e.end_date, c.end_date) AS end_date, e.status, c.name AS cohort_label,
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
      coalesce(max(m.module_required_units) FILTER (WHERE m.module = 'final_assessment'), 0)::integer AS final_assessment_required_units,
      coalesce(max(m.module_completed_units) FILTER (WHERE m.module = 'final_assessment'), 0)::integer AS final_assessment_completed_units,
      coalesce(max(m.module_due_units) FILTER (WHERE m.module = 'final_assessment'), 0)::integer AS final_assessment_due_units,
      coalesce(max(m.module_booked_units) FILTER (WHERE m.module = 'final_assessment'), 0)::integer AS final_assessment_booked_units,
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
      -- 20261001110000: the end that freezes progress (enrollment end, else
      -- cohort end) is the end that settles the status.
      WHEN c.status IN ('active', 'at_risk') AND c.end_date < p_as_of
      THEN CASE WHEN c.all_completed THEN 'completed'::public.enrollment_status
                ELSE 'at_risk'::public.enrollment_status END
      -- A stored at_risk is a legacy progress word in the lifecycle column:
      -- the enrollment is ongoing, so it is active; risk is pace_status.
      WHEN c.status = 'at_risk' THEN 'active'::public.enrollment_status
      ELSE c.status
    END,
    c.status,
    CASE
      -- 20261001110000: the end that freezes progress (enrollment end, else
      -- cohort end) is the end that settles the status.
      WHEN c.status IN ('active', 'at_risk') AND c.end_date < p_as_of
      THEN CASE WHEN c.all_completed THEN 'completed'::public.enrollment_status
                ELSE 'at_risk'::public.enrollment_status END
      -- A stored at_risk is a legacy progress word in the lifecycle column:
      -- the enrollment is ongoing, so it is active; risk is pace_status.
      WHEN c.status = 'at_risk' THEN 'active'::public.enrollment_status
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
    c.triad_required_units, c.triad_completed_units, c.triad_due_units, c.triad_booked_units,
    c.final_assessment_required_units, c.final_assessment_completed_units, c.final_assessment_due_units, c.final_assessment_booked_units
  FROM calculated c;
$function$;
REVOKE ALL ON FUNCTION public.canonical_enrollment_progress(p_enrollment_id uuid, p_as_of date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.canonical_enrollment_progress(p_enrollment_id uuid, p_as_of date) TO service_role;

CREATE OR REPLACE FUNCTION public.learner_canonical_progress(p_enrollment_id uuid, p_as_of date DEFAULT programme_today())
 RETURNS TABLE(enrollment_id uuid, learner_display_name text, programme_label text, cohort_id uuid, cohort_label text, programme_id uuid, enrollment_start_date date, enrollment_end_date date, programme_start_date date, programme_end_date date, enrollment_status enrollment_status, stored_enrollment_status enrollment_status, effective_enrollment_status enrollment_status, required_units integer, completed_units integer, due_units integer, booked_units integer, overdue_units integer, full_completion_pct numeric, due_adherence_pct numeric, pace_status text, progress_available boolean, coaching_required_units integer, coaching_completed_units integer, coaching_due_units integer, coaching_booked_units integer, training_required_units integer, training_completed_units integer, training_due_units integer, training_booked_units integer, peer_required_units integer, peer_completed_units integer, peer_due_units integer, peer_booked_units integer, mentoring_required_units integer, mentoring_completed_units integer, mentoring_due_units integer, mentoring_booked_units integer, triad_required_units integer, triad_completed_units integer, triad_due_units integer, triad_booked_units integer, final_assessment_required_units integer, final_assessment_completed_units integer, final_assessment_due_units integer, final_assessment_booked_units integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  -- Learner self-view: own enrollment only.
  SELECT p.*
  FROM public.programme_enrollments e
  CROSS JOIN LATERAL public.canonical_enrollment_progress(e.id, p_as_of) p
  WHERE e.id = p_enrollment_id
    AND e.user_id = auth.uid()
    AND auth.uid() IS NOT NULL;
$function$;
REVOKE ALL ON FUNCTION public.learner_canonical_progress(p_enrollment_id uuid, p_as_of date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.learner_canonical_progress(p_enrollment_id uuid, p_as_of date) TO service_role;
GRANT EXECUTE ON FUNCTION public.learner_canonical_progress(p_enrollment_id uuid, p_as_of date) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_canonical_enrollment_progress(p_enrollment_ids uuid[], p_as_of date DEFAULT programme_today())
 RETURNS TABLE(enrollment_id uuid, learner_display_name text, programme_label text, cohort_id uuid, cohort_label text, programme_id uuid, enrollment_start_date date, enrollment_end_date date, programme_start_date date, programme_end_date date, enrollment_status enrollment_status, stored_enrollment_status enrollment_status, effective_enrollment_status enrollment_status, required_units integer, completed_units integer, due_units integer, booked_units integer, overdue_units integer, full_completion_pct numeric, due_adherence_pct numeric, pace_status text, progress_available boolean, coaching_required_units integer, coaching_completed_units integer, coaching_due_units integer, coaching_booked_units integer, training_required_units integer, training_completed_units integer, training_due_units integer, training_booked_units integer, peer_required_units integer, peer_completed_units integer, peer_due_units integer, peer_booked_units integer, mentoring_required_units integer, mentoring_completed_units integer, mentoring_due_units integer, mentoring_booked_units integer, triad_required_units integer, triad_completed_units integer, triad_due_units integer, triad_booked_units integer, final_assessment_required_units integer, final_assessment_completed_units integer, final_assessment_due_units integer, final_assessment_booked_units integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT p.*
  FROM (SELECT DISTINCT unnest(p_enrollment_ids) AS id) requested
  CROSS JOIN LATERAL public.canonical_enrollment_progress(requested.id, p_as_of) p
  WHERE public.has_role(auth.uid(), 'admin'::public.app_role);
$function$;
REVOKE ALL ON FUNCTION public.admin_canonical_enrollment_progress(p_enrollment_ids uuid[], p_as_of date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_canonical_enrollment_progress(p_enrollment_ids uuid[], p_as_of date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_canonical_enrollment_progress(p_enrollment_ids uuid[], p_as_of date) TO service_role;

CREATE OR REPLACE FUNCTION public.sponsor_canonical_enrollment_progress(p_cohort_id uuid DEFAULT NULL::uuid, p_as_of date DEFAULT programme_today())
 RETURNS TABLE(enrollment_id uuid, learner_display_name text, programme_label text, cohort_id uuid, cohort_label text, programme_id uuid, enrollment_start_date date, enrollment_end_date date, programme_start_date date, programme_end_date date, enrollment_status enrollment_status, stored_enrollment_status enrollment_status, effective_enrollment_status enrollment_status, required_units integer, completed_units integer, due_units integer, booked_units integer, overdue_units integer, full_completion_pct numeric, due_adherence_pct numeric, pace_status text, progress_available boolean, coaching_required_units integer, coaching_completed_units integer, coaching_due_units integer, coaching_booked_units integer, training_required_units integer, training_completed_units integer, training_due_units integer, training_booked_units integer, peer_required_units integer, peer_completed_units integer, peer_due_units integer, peer_booked_units integer, mentoring_required_units integer, mentoring_completed_units integer, mentoring_due_units integer, mentoring_booked_units integer, triad_required_units integer, triad_completed_units integer, triad_due_units integer, triad_booked_units integer, final_assessment_required_units integer, final_assessment_completed_units integer, final_assessment_due_units integer, final_assessment_booked_units integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  -- Sponsor: the sponsor's visible enrollments (enrollment organisation),
  -- optionally narrowed to one cohort. Numbers come from the one canonical
  -- construction.
  SELECT p.*
  FROM public.sponsor_visible_enrollments() v
  CROSS JOIN LATERAL public.canonical_enrollment_progress(v.enrollment_id, p_as_of) p
  WHERE p_cohort_id IS NULL OR v.cohort_id = p_cohort_id
  ORDER BY p.cohort_label, p.learner_display_name, p.enrollment_id;
$function$;
REVOKE ALL ON FUNCTION public.sponsor_canonical_enrollment_progress(p_cohort_id uuid, p_as_of date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sponsor_canonical_enrollment_progress(p_cohort_id uuid, p_as_of date) TO service_role;
GRANT EXECUTE ON FUNCTION public.sponsor_canonical_enrollment_progress(p_cohort_id uuid, p_as_of date) TO authenticated;

CREATE OR REPLACE FUNCTION public.sponsor_canonical_leader_progress(p_enrollment_id uuid, p_as_of date DEFAULT programme_today())
 RETURNS TABLE(enrollment_id uuid, learner_display_name text, programme_label text, cohort_id uuid, cohort_label text, programme_id uuid, enrollment_start_date date, enrollment_end_date date, programme_start_date date, programme_end_date date, enrollment_status enrollment_status, stored_enrollment_status enrollment_status, effective_enrollment_status enrollment_status, required_units integer, completed_units integer, due_units integer, booked_units integer, overdue_units integer, full_completion_pct numeric, due_adherence_pct numeric, pace_status text, progress_available boolean, coaching_required_units integer, coaching_completed_units integer, coaching_due_units integer, coaching_booked_units integer, training_required_units integer, training_completed_units integer, training_due_units integer, training_booked_units integer, peer_required_units integer, peer_completed_units integer, peer_due_units integer, peer_booked_units integer, mentoring_required_units integer, mentoring_completed_units integer, mentoring_due_units integer, mentoring_booked_units integer, triad_required_units integer, triad_completed_units integer, triad_due_units integer, triad_booked_units integer, final_assessment_required_units integer, final_assessment_completed_units integer, final_assessment_due_units integer, final_assessment_booked_units integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT p.*
  FROM public.sponsor_canonical_enrollment_progress(NULL, p_as_of) p
  WHERE p.enrollment_id = p_enrollment_id
    AND EXISTS (
      SELECT 1
      FROM public.sponsor_visible_enrollments() v
      WHERE v.enrollment_id = p.enrollment_id
    );
$function$;
REVOKE ALL ON FUNCTION public.sponsor_canonical_leader_progress(p_enrollment_id uuid, p_as_of date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sponsor_canonical_leader_progress(p_enrollment_id uuid, p_as_of date) TO service_role;
GRANT EXECUTE ON FUNCTION public.sponsor_canonical_leader_progress(p_enrollment_id uuid, p_as_of date) TO authenticated;

CREATE OR REPLACE FUNCTION public.sponsor_canonical_enrollment_metadata(p_cohort_id uuid DEFAULT NULL::uuid, p_enrollment_id uuid DEFAULT NULL::uuid, p_as_of date DEFAULT programme_today())
 RETURNS TABLE(enrollment_id uuid, learner_display_name text, programme_label text, cohort_id uuid, cohort_label text, programme_id uuid, enrollment_start_date date, enrollment_end_date date, programme_start_date date, programme_end_date date, enrollment_status enrollment_status, stored_enrollment_status enrollment_status, effective_enrollment_status enrollment_status, required_units integer, completed_units integer, due_units integer, booked_units integer, overdue_units integer, full_completion_pct numeric, due_adherence_pct numeric, pace_status text, progress_available boolean, coaching_required_units integer, coaching_completed_units integer, coaching_due_units integer, coaching_booked_units integer, training_required_units integer, training_completed_units integer, training_due_units integer, training_booked_units integer, peer_required_units integer, peer_completed_units integer, peer_due_units integer, peer_booked_units integer, mentoring_required_units integer, mentoring_completed_units integer, mentoring_due_units integer, mentoring_booked_units integer, triad_required_units integer, triad_completed_units integer, triad_due_units integer, triad_booked_units integer, final_assessment_required_units integer, final_assessment_completed_units integer, final_assessment_due_units integer, final_assessment_booked_units integer, goal_count integer, goal_setup boolean, goal_progress_pct numeric, open_action_count integer, completed_action_count integer, total_action_count integer, action_completion_pct numeric, satisfaction_avg numeric, satisfaction_rated_count integer, needs_attention boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH base AS (
    SELECT p.*
    FROM public.sponsor_canonical_enrollment_progress(p_cohort_id, p_as_of) p
    WHERE p_enrollment_id IS NULL OR p.enrollment_id = p_enrollment_id
  )
  SELECT b.*,
    coalesce(c.goal_count, 0),
    coalesce(c.goal_setup, false),
    c.goal_progress_pct,
    coalesce(c.open_action_count, 0),
    coalesce(c.completed_action_count, 0),
    coalesce(c.total_action_count, 0),
    c.action_completion_pct,
    c.satisfaction_avg,
    coalesce(c.satisfaction_rated_count, 0),
    public.sponsor_needs_attention(b.pace_status, b.overdue_units)
  FROM base b
  LEFT JOIN LATERAL public.canonical_enrollment_engagement(b.enrollment_id) c ON true
  ORDER BY b.cohort_label, b.learner_display_name, b.enrollment_id;
$function$;
REVOKE ALL ON FUNCTION public.sponsor_canonical_enrollment_metadata(p_cohort_id uuid, p_enrollment_id uuid, p_as_of date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sponsor_canonical_enrollment_metadata(p_cohort_id uuid, p_enrollment_id uuid, p_as_of date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sponsor_canonical_enrollment_metadata(p_cohort_id uuid, p_enrollment_id uuid, p_as_of date) TO service_role;

CREATE OR REPLACE FUNCTION public.sponsor_canonical_cohort_progress_one(p_cohort_id uuid, p_as_of date DEFAULT programme_today())
 RETURNS TABLE(cohort_id uuid, cohort_label text, programme_label text, programme_start_date date, programme_end_date date, enrollment_count integer, suppressed boolean, required_units integer, completed_units integer, due_units integer, booked_units integer, overdue_units integer, full_completion_pct numeric, due_adherence_pct numeric, schedule_coverage_pct numeric, pace_status text, active_count integer, at_risk_count integer, paused_count integer, completed_count integer, not_yet_due_count integer, ahead_count integer, on_track_count integer, scheduled_count integer, behind_count integer, completed_pace_count integer, on_track_pct numeric, coaching_required_units integer, coaching_completed_units integer, coaching_due_units integer, coaching_booked_units integer, coaching_completed_leaders integer, training_required_units integer, training_completed_units integer, training_due_units integer, training_booked_units integer, training_completed_leaders integer, peer_required_units integer, peer_completed_units integer, peer_due_units integer, peer_booked_units integer, peer_completed_leaders integer, mentoring_required_units integer, mentoring_completed_units integer, mentoring_due_units integer, mentoring_booked_units integer, mentoring_completed_leaders integer, triad_required_units integer, triad_completed_units integer, triad_due_units integer, triad_booked_units integer, triad_completed_leaders integer, final_assessment_required_units integer, final_assessment_completed_units integer, final_assessment_due_units integer, final_assessment_booked_units integer, final_assessment_completed_leaders integer, programme_journey jsonb, progress_source_complete boolean, satisfaction_avg numeric, satisfaction_rated_count integer, adherence_credited_units integer, coverage_credited_units integer, needs_attention_count integer, health_signal text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH visible AS (
    -- The sponsor's visible enrollments in this cohort (enrollment
    -- organisation). No row at all when the sponsor has none here.
    SELECT v.enrollment_id
    FROM public.sponsor_visible_enrollments() v
    WHERE v.cohort_id = p_cohort_id
  ), cohort_row AS (
    SELECT c.id, c.name, p.name AS programme_label, c.start_date, c.end_date,
      (SELECT count(*) FROM visible)::integer AS enrollment_count
    FROM public.cohorts c
    JOIN public.programmes p ON p.id = c.programme_id
    WHERE c.id = p_cohort_id
      AND EXISTS (SELECT 1 FROM visible)
  ), rows AS (
    SELECT r.*
    FROM public.sponsor_canonical_enrollment_progress(p_cohort_id, p_as_of) r
  ), satisfaction AS (
    -- Rating-weighted mean of the canonical per-enrollment satisfaction
    -- (canonical_enrollment_engagement), visible enrollments only.
    SELECT
      sum(g.satisfaction_avg * g.satisfaction_rated_count)
        FILTER (WHERE g.satisfaction_avg IS NOT NULL AND g.satisfaction_rated_count > 0) AS weighted_sum,
      coalesce(sum(g.satisfaction_rated_count)
        FILTER (WHERE g.satisfaction_avg IS NOT NULL AND g.satisfaction_rated_count > 0), 0)::integer AS rated_count
    FROM visible v
    CROSS JOIN LATERAL public.canonical_enrollment_engagement(v.enrollment_id) g
  ), grouped AS (
    SELECT c.id, c.name, c.programme_label, c.start_date, c.end_date,
      c.enrollment_count,
      coalesce(sum(r.required_units), 0)::integer AS required_units,
      coalesce(sum(r.completed_units), 0)::integer AS completed_units,
      coalesce(sum(r.due_units), 0)::integer AS due_units,
      coalesce(sum(r.booked_units), 0)::integer AS booked_units,
      -- One overdue rule (20261006130000): the cohort's overdue units and its
      -- credited units are sums of the LEADERS' own, so a leader who is ahead
      -- never offsets another leader's overdue unit.
      coalesce(sum(r.overdue_units), 0)::integer AS overdue_units,
      coalesce(sum(least(r.completed_units, r.due_units)), 0)::integer AS adherence_credited_units,
      coalesce(sum(least(r.completed_units + r.booked_units, r.due_units)), 0)::integer AS coverage_credited_units,
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
      coalesce(sum(r.coaching_required_units), 0)::integer AS coaching_required_units,
      coalesce(sum(r.coaching_completed_units), 0)::integer AS coaching_completed_units,
      coalesce(sum(r.coaching_due_units), 0)::integer AS coaching_due_units,
      coalesce(sum(r.coaching_booked_units), 0)::integer AS coaching_booked_units,
      count(r.enrollment_id) FILTER (WHERE r.coaching_required_units > 0 AND r.coaching_completed_units >= r.coaching_required_units)::integer AS coaching_completed_leaders,
      coalesce(sum(r.training_required_units), 0)::integer AS training_required_units,
      coalesce(sum(r.training_completed_units), 0)::integer AS training_completed_units,
      coalesce(sum(r.training_due_units), 0)::integer AS training_due_units,
      coalesce(sum(r.training_booked_units), 0)::integer AS training_booked_units,
      count(r.enrollment_id) FILTER (WHERE r.training_required_units > 0 AND r.training_completed_units >= r.training_required_units)::integer AS training_completed_leaders,
      coalesce(sum(r.peer_required_units), 0)::integer AS peer_required_units,
      coalesce(sum(r.peer_completed_units), 0)::integer AS peer_completed_units,
      coalesce(sum(r.peer_due_units), 0)::integer AS peer_due_units,
      coalesce(sum(r.peer_booked_units), 0)::integer AS peer_booked_units,
      count(r.enrollment_id) FILTER (WHERE r.peer_required_units > 0 AND r.peer_completed_units >= r.peer_required_units)::integer AS peer_completed_leaders,
      coalesce(sum(r.mentoring_required_units), 0)::integer AS mentoring_required_units,
      coalesce(sum(r.mentoring_completed_units), 0)::integer AS mentoring_completed_units,
      coalesce(sum(r.mentoring_due_units), 0)::integer AS mentoring_due_units,
      coalesce(sum(r.mentoring_booked_units), 0)::integer AS mentoring_booked_units,
      count(r.enrollment_id) FILTER (WHERE r.mentoring_required_units > 0 AND r.mentoring_completed_units >= r.mentoring_required_units)::integer AS mentoring_completed_leaders,
      coalesce(sum(r.triad_required_units), 0)::integer AS triad_required_units,
      coalesce(sum(r.triad_completed_units), 0)::integer AS triad_completed_units,
      coalesce(sum(r.triad_due_units), 0)::integer AS triad_due_units,
      coalesce(sum(r.triad_booked_units), 0)::integer AS triad_booked_units,
      count(r.enrollment_id) FILTER (WHERE r.triad_required_units > 0 AND r.triad_completed_units >= r.triad_required_units)::integer AS triad_completed_leaders,
      coalesce(sum(r.final_assessment_required_units), 0)::integer AS final_assessment_required_units,
      coalesce(sum(r.final_assessment_completed_units), 0)::integer AS final_assessment_completed_units,
      coalesce(sum(r.final_assessment_due_units), 0)::integer AS final_assessment_due_units,
      coalesce(sum(r.final_assessment_booked_units), 0)::integer AS final_assessment_booked_units,
      count(r.enrollment_id) FILTER (WHERE r.final_assessment_required_units > 0 AND r.final_assessment_completed_units >= r.final_assessment_required_units)::integer AS final_assessment_completed_leaders,
      count(r.enrollment_id) FILTER (WHERE public.sponsor_needs_attention(r.pace_status, r.overdue_units))::integer AS needs_attention_count,
      count(r.enrollment_id)::integer AS source_row_count
    FROM cohort_row c
    LEFT JOIN rows r ON r.cohort_id = c.id
    GROUP BY c.id, c.name, c.programme_label, c.start_date, c.end_date, c.enrollment_count
  ), calculated AS (
    SELECT g.*,
      CASE
        WHEN g.behind_count > 0 THEN 'behind'
        WHEN g.scheduled_count > 0 THEN 'scheduled'
        WHEN g.on_track_count > 0 THEN 'on_track'
        WHEN g.ahead_count > 0 THEN 'ahead'
        WHEN g.completed_pace_count = g.enrollment_count AND g.enrollment_count > 0 THEN 'completed'
        ELSE 'not_yet_due'
      END AS calculated_pace_status
    FROM grouped g
  )
  SELECT c.id, c.name, c.programme_label, c.start_date, c.end_date,
    c.enrollment_count,
    false,  -- see header: named data and exact rollups of it are not size-gated
    c.required_units,
    c.completed_units,
    c.due_units,
    c.booked_units,
    c.overdue_units,
    CASE WHEN c.required_units = 0 THEN NULL ELSE round(least(c.completed_units, c.required_units) * 100.0 / c.required_units, 1) END,
    CASE WHEN c.due_units = 0 THEN NULL ELSE round(c.adherence_credited_units * 100.0 / c.due_units, 1) END,
    CASE WHEN c.due_units = 0 THEN NULL ELSE round(c.coverage_credited_units * 100.0 / c.due_units, 1) END,
    c.calculated_pace_status,
    c.active_count,
    c.at_risk_count,
    c.paused_count,
    c.completed_count,
    c.not_yet_due_count,
    c.ahead_count,
    c.on_track_count,
    c.scheduled_count,
    c.behind_count,
    c.completed_pace_count,
    CASE WHEN c.enrollment_count = 0 THEN NULL ELSE round(c.on_track_count * 100.0 / c.enrollment_count, 1) END,
    c.coaching_required_units,
    c.coaching_completed_units,
    c.coaching_due_units,
    c.coaching_booked_units,
    c.coaching_completed_leaders,
    c.training_required_units,
    c.training_completed_units,
    c.training_due_units,
    c.training_booked_units,
    c.training_completed_leaders,
    c.peer_required_units,
    c.peer_completed_units,
    c.peer_due_units,
    c.peer_booked_units,
    c.peer_completed_leaders,
    c.mentoring_required_units,
    c.mentoring_completed_units,
    c.mentoring_due_units,
    c.mentoring_booked_units,
    c.mentoring_completed_leaders,
    c.triad_required_units,
    c.triad_completed_units,
    c.triad_due_units,
    c.triad_booked_units,
    c.triad_completed_leaders,
    c.final_assessment_required_units,
    c.final_assessment_completed_units,
    c.final_assessment_due_units,
    c.final_assessment_booked_units,
    c.final_assessment_completed_leaders,
    public.sponsor_canonical_programme_journey(c.id, p_as_of),
    c.source_row_count = c.enrollment_count,
    CASE WHEN s.rated_count = 0 THEN NULL ELSE round(s.weighted_sum / s.rated_count, 2) END,
    s.rated_count,
    c.adherence_credited_units,
    c.coverage_credited_units,
    c.needs_attention_count,
    public.sponsor_health_signal(c.needs_attention_count, c.enrollment_count)
  FROM calculated c
  CROSS JOIN satisfaction s
  ORDER BY c.name;
$function$;
REVOKE ALL ON FUNCTION public.sponsor_canonical_cohort_progress_one(p_cohort_id uuid, p_as_of date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sponsor_canonical_cohort_progress_one(p_cohort_id uuid, p_as_of date) TO service_role;

CREATE OR REPLACE FUNCTION public.sponsor_canonical_cohort_progress(p_cohort_id uuid DEFAULT NULL::uuid, p_as_of date DEFAULT programme_today())
 RETURNS TABLE(cohort_id uuid, cohort_label text, programme_label text, programme_start_date date, programme_end_date date, enrollment_count integer, suppressed boolean, required_units integer, completed_units integer, due_units integer, booked_units integer, overdue_units integer, full_completion_pct numeric, due_adherence_pct numeric, schedule_coverage_pct numeric, pace_status text, active_count integer, at_risk_count integer, paused_count integer, completed_count integer, not_yet_due_count integer, ahead_count integer, on_track_count integer, scheduled_count integer, behind_count integer, completed_pace_count integer, on_track_pct numeric, coaching_required_units integer, coaching_completed_units integer, coaching_due_units integer, coaching_booked_units integer, coaching_completed_leaders integer, training_required_units integer, training_completed_units integer, training_due_units integer, training_booked_units integer, training_completed_leaders integer, peer_required_units integer, peer_completed_units integer, peer_due_units integer, peer_booked_units integer, peer_completed_leaders integer, mentoring_required_units integer, mentoring_completed_units integer, mentoring_due_units integer, mentoring_booked_units integer, mentoring_completed_leaders integer, triad_required_units integer, triad_completed_units integer, triad_due_units integer, triad_booked_units integer, triad_completed_leaders integer, final_assessment_required_units integer, final_assessment_completed_units integer, final_assessment_due_units integer, final_assessment_booked_units integer, final_assessment_completed_leaders integer, programme_journey jsonb, progress_source_complete boolean, satisfaction_avg numeric, satisfaction_rated_count integer, adherence_credited_units integer, coverage_credited_units integer, needs_attention_count integer, health_signal text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  -- A cohort is listed for a sponsor iff it contains at least one of the
  -- sponsor's visible enrollments; each cohort row is computed one cohort at
  -- a time (bounded per-cohort path, 20260917150000).
  SELECT progress.*
  FROM (
    SELECT DISTINCT v.cohort_id
    FROM public.sponsor_visible_enrollments() v
    WHERE v.cohort_id IS NOT NULL
      AND (p_cohort_id IS NULL OR v.cohort_id = p_cohort_id)
  ) visible_cohort
  CROSS JOIN LATERAL public.sponsor_canonical_cohort_progress_one(visible_cohort.cohort_id, p_as_of) progress
  ORDER BY progress.cohort_label, progress.cohort_id;
$function$;
REVOKE ALL ON FUNCTION public.sponsor_canonical_cohort_progress(p_cohort_id uuid, p_as_of date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sponsor_canonical_cohort_progress(p_cohort_id uuid, p_as_of date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sponsor_canonical_cohort_progress(p_cohort_id uuid, p_as_of date) TO service_role;

CREATE OR REPLACE FUNCTION public.sponsor_canonical_organisation_progress(p_as_of date DEFAULT programme_today())
 RETURNS TABLE(cohort_count integer, enrollment_count integer, required_units integer, completed_units integer, due_units integer, booked_units integer, overdue_units integer, full_completion_pct numeric, due_adherence_pct numeric, schedule_coverage_pct numeric, coaching_required_units integer, coaching_completed_units integer, coaching_due_units integer, coaching_booked_units integer, training_required_units integer, training_completed_units integer, training_due_units integer, training_booked_units integer, peer_required_units integer, peer_completed_units integer, peer_due_units integer, peer_booked_units integer, mentoring_required_units integer, mentoring_completed_units integer, mentoring_due_units integer, mentoring_booked_units integer, triad_required_units integer, triad_completed_units integer, triad_due_units integer, triad_booked_units integer, final_assessment_required_units integer, final_assessment_completed_units integer, final_assessment_due_units integer, final_assessment_booked_units integer, suppressed_cohort_count integer, progress_source_complete boolean, active_count integer, at_risk_count integer, paused_count integer, completed_count integer, on_track_count integer, behind_count integer, satisfaction_avg numeric, satisfaction_rated_count integer, needs_attention_count integer, health_signal text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  -- The organisation rollup is the sum of the sponsor's visible cohort rows,
  -- which are themselves rollups of the sponsor's visible enrollments only.
  WITH cohort_rows AS (
    SELECT *
    FROM public.sponsor_canonical_cohort_progress(NULL, p_as_of)
  ), totals AS (
    SELECT
      count(*)::integer AS cohort_count,
      coalesce(sum(c.enrollment_count), 0)::integer AS enrollment_count,
      sum(c.required_units)::integer AS required_units,
      sum(c.completed_units)::integer AS completed_units,
      sum(c.due_units)::integer AS due_units,
      sum(c.booked_units)::integer AS booked_units,
      -- Sums of the cohort rows, which are sums of their leaders (20261006130000).
      sum(c.overdue_units)::integer AS overdue_units,
      sum(c.adherence_credited_units)::integer AS adherence_credited_units,
      sum(c.coverage_credited_units)::integer AS coverage_credited_units,
      sum(c.coaching_required_units)::integer AS coaching_required_units,
      sum(c.coaching_completed_units)::integer AS coaching_completed_units,
      sum(c.coaching_due_units)::integer AS coaching_due_units,
      sum(c.coaching_booked_units)::integer AS coaching_booked_units,
      sum(c.training_required_units)::integer AS training_required_units,
      sum(c.training_completed_units)::integer AS training_completed_units,
      sum(c.training_due_units)::integer AS training_due_units,
      sum(c.training_booked_units)::integer AS training_booked_units,
      sum(c.peer_required_units)::integer AS peer_required_units,
      sum(c.peer_completed_units)::integer AS peer_completed_units,
      sum(c.peer_due_units)::integer AS peer_due_units,
      sum(c.peer_booked_units)::integer AS peer_booked_units,
      sum(c.mentoring_required_units)::integer AS mentoring_required_units,
      sum(c.mentoring_completed_units)::integer AS mentoring_completed_units,
      sum(c.mentoring_due_units)::integer AS mentoring_due_units,
      sum(c.mentoring_booked_units)::integer AS mentoring_booked_units,
      sum(c.triad_required_units)::integer AS triad_required_units,
      sum(c.triad_completed_units)::integer AS triad_completed_units,
      sum(c.triad_due_units)::integer AS triad_due_units,
      sum(c.triad_booked_units)::integer AS triad_booked_units,
      sum(c.final_assessment_required_units)::integer AS final_assessment_required_units,
      sum(c.final_assessment_completed_units)::integer AS final_assessment_completed_units,
      sum(c.final_assessment_due_units)::integer AS final_assessment_due_units,
      sum(c.final_assessment_booked_units)::integer AS final_assessment_booked_units,
      count(*) FILTER (WHERE c.suppressed)::integer AS suppressed_cohort_count,
      coalesce(bool_and(c.progress_source_complete), false) AS progress_source_complete,
      coalesce(sum(c.active_count), 0)::integer AS active_count,
      coalesce(sum(c.at_risk_count), 0)::integer AS at_risk_count,
      coalesce(sum(c.paused_count), 0)::integer AS paused_count,
      coalesce(sum(c.completed_count), 0)::integer AS completed_count,
      coalesce(sum(c.on_track_count), 0)::integer AS on_track_count,
      coalesce(sum(c.behind_count), 0)::integer AS behind_count,
      coalesce(sum(c.needs_attention_count), 0)::integer AS needs_attention_count
    FROM cohort_rows c
  ), satisfaction AS (
    -- Same rating-weighted rule as the cohort rows, over the same visible
    -- enrollments (those in a cohort), computed from the unrounded source.
    SELECT
      sum(g.satisfaction_avg * g.satisfaction_rated_count)
        FILTER (WHERE g.satisfaction_avg IS NOT NULL AND g.satisfaction_rated_count > 0) AS weighted_sum,
      coalesce(sum(g.satisfaction_rated_count)
        FILTER (WHERE g.satisfaction_avg IS NOT NULL AND g.satisfaction_rated_count > 0), 0)::integer AS rated_count
    FROM public.sponsor_visible_enrollments() v
    CROSS JOIN LATERAL public.canonical_enrollment_engagement(v.enrollment_id) g
    WHERE v.cohort_id IS NOT NULL
  )
  SELECT t.cohort_count, t.enrollment_count,
    t.required_units, t.completed_units, t.due_units, t.booked_units,
    t.overdue_units,
    CASE WHEN t.required_units = 0 THEN NULL ELSE round(least(t.completed_units, t.required_units) * 100.0 / t.required_units, 1) END,
    CASE WHEN t.due_units = 0 THEN NULL ELSE round(t.adherence_credited_units * 100.0 / t.due_units, 1) END,
    CASE WHEN t.due_units = 0 THEN NULL ELSE round(t.coverage_credited_units * 100.0 / t.due_units, 1) END,
    t.coaching_required_units, t.coaching_completed_units, t.coaching_due_units, t.coaching_booked_units,
    t.training_required_units, t.training_completed_units, t.training_due_units, t.training_booked_units,
    t.peer_required_units, t.peer_completed_units, t.peer_due_units, t.peer_booked_units,
    t.mentoring_required_units, t.mentoring_completed_units, t.mentoring_due_units, t.mentoring_booked_units,
    t.triad_required_units, t.triad_completed_units, t.triad_due_units, t.triad_booked_units,
    t.final_assessment_required_units, t.final_assessment_completed_units, t.final_assessment_due_units, t.final_assessment_booked_units,
    t.suppressed_cohort_count, t.progress_source_complete,
    t.active_count, t.at_risk_count, t.paused_count, t.completed_count,
    t.on_track_count, t.behind_count,
    CASE WHEN s.rated_count = 0 THEN NULL ELSE round(s.weighted_sum / s.rated_count, 2) END,
    s.rated_count,
    t.needs_attention_count,
    public.sponsor_health_signal(t.needs_attention_count, t.enrollment_count)
  FROM totals t
  CROSS JOIN satisfaction s;
$function$;
REVOKE ALL ON FUNCTION public.sponsor_canonical_organisation_progress(p_as_of date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sponsor_canonical_organisation_progress(p_as_of date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sponsor_canonical_organisation_progress(p_as_of date) TO service_role;

COMMENT ON FUNCTION public.canonical_enrollment_progress(uuid, date) IS
  'THE canonical enrollment completion/progress construction (required, completed, due, overdue, completion %, due adherence %, pace, effective status). Internal: every role reads it through an eligibility wrapper.';

-- ---------------------------------------------------------------------------
-- 7. Decision 9: the retired "90% of sessions" alert setting
-- ---------------------------------------------------------------------------
-- Sponsor Settings no longer offers session_milestones; a new profile's
-- notification preferences do not carry it either (an existing one drops it
-- on its next save).
ALTER TABLE public.profiles ALTER COLUMN notification_prefs
  SET DEFAULT '{"weekly_digest": true, "at_risk_alerts": true, "monthly_auto_report": false}'::jsonb;
