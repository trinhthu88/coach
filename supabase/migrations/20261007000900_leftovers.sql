-- ===========================================================================
-- Leftovers (Prompt 14)
--
--   1. admin_update_coach_configuration no longer writes the retired
--      coach_as_coachee_allowlist (the Admin coach editor stops offering it).
--   2. canonical_training_learning_items dates a completed week in programme
--      time (AT TIME ZONE programme_time_zone()), not the server's UTC day.
--   3. The training-pdfs read policy is learner_training_week_open(): the
--      week open for the caller's ongoing enrollment, as every other Training
--      read -- not a stored unlock_date against CURRENT_DATE.
--   4. enrollment_is_ongoing() -- stored active, inside the enrollment's (else
--      its cohort's) dates -- is the one test in can_book_session,
--      can_book_mentoring_session_reason, can_book_peer_session,
--      coachee_peer_booking_allowed_internal (can_book_coachee_peer_session),
--      assert_peer_session_bookable_internal, the reminder targets and
--      admin_alerts_current. at_risk is never stored (20261006160000); a paused
--      or ended enrollment no longer books, is reminded or raises activity
--      alerts. "Programme at risk" still covers an enrollment that ended
--      incomplete. The Peer practice monthly cap is kept.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. The Admin coach editor: no allowlist
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.admin_update_coach_configuration(uuid, text, text, uuid[], uuid, uuid, uuid, uuid);
CREATE OR REPLACE FUNCTION public.admin_update_coach_configuration(p_coach_id uuid, p_full_name text, p_profile_status text, p_enrollment_id uuid DEFAULT NULL::uuid, p_programme_id uuid DEFAULT NULL::uuid, p_cohort_id uuid DEFAULT NULL::uuid, p_organization_id uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role)
     OR p_coach_id IS NULL
      OR p_profile_status NOT IN ('active', 'pending_approval', 'inactive', 'suspended', 'rejected', 'reach_limit')
  THEN
    RAISE EXCEPTION 'Only an administrator can update Coach configuration'
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.profiles
  SET full_name = NULLIF(left(trim(p_full_name), 200), ''),
      status = p_profile_status::public.user_status
  WHERE id = p_coach_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Coach profile not found' USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.coach_profiles
  SET approval_status = p_profile_status::public.user_status,
      last_approved_at = CASE
        WHEN p_profile_status = 'active' THEN COALESCE(last_approved_at, now())
        ELSE last_approved_at
      END
  WHERE id = p_coach_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Coach profile details not found' USING ERRCODE = 'P0002';
  END IF;

  -- A Coach's own Coach (as a learner) is their cohort's Coach pool; the
  -- retired coach_as_coachee_allowlist is neither read nor written here.

  -- Programme and cohort are required together; the organisation is the
  -- enrollment's own and optional (NULL defaults to the cohort's inside
  -- admin_create_programme_enrollment).
  IF p_programme_id IS NOT NULL OR p_cohort_id IS NOT NULL OR p_organization_id IS NOT NULL THEN
    IF p_programme_id IS NULL OR p_cohort_id IS NULL THEN
      RAISE EXCEPTION 'Programme and cohort are required together'
        USING ERRCODE = '22023';
    END IF;

    IF p_enrollment_id IS NULL THEN
      PERFORM public.admin_create_programme_enrollment(
        p_coach_id, p_programme_id, p_cohort_id, p_organization_id,
        public.programme_today(), NULL
      );
    END IF;
  END IF;
END;
$function$;
REVOKE ALL ON FUNCTION public.admin_update_coach_configuration(uuid, text, text, uuid, uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_update_coach_configuration(uuid, text, text, uuid, uuid, uuid, uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Training completion in programme time
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.canonical_training_learning_items(p_enrollment_id uuid, p_as_of date DEFAULT programme_today())
 RETURNS TABLE(item_type text, item_id uuid, training_week_id uuid, due_on date, required_units integer, completed_units integer, completed_on date)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT
    'skill_cards'::text,
    f.training_week_id,
    f.training_week_id,
    f.due_on,
    1,
    CASE WHEN f.week_complete THEN 1 ELSE 0 END,
    CASE WHEN f.week_complete THEN
      (greatest(
        f.skill_card_completed_at,
        f.quiz_completed_at,
        f.reflection_completed_at
      ) AT TIME ZONE public.programme_time_zone())::date
    END
  FROM public.canonical_training_week_fulfilment(p_enrollment_id, p_as_of) f;
$function$;

-- ---------------------------------------------------------------------------
-- 3. training-pdfs: the week open for the caller
-- ---------------------------------------------------------------------------
-- Paths are {training_week_id}/{file}; anything else reads as closed (CASE,
-- so a non-uuid folder is never cast).
DROP POLICY IF EXISTS "Training PDFs: enrolled users read" ON storage.objects;
CREATE POLICY "Training PDFs: enrolled users read" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'training-pdfs' AND (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR CASE WHEN (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            THEN public.learner_training_week_open(((storage.foldername(name))[1])::uuid)
            ELSE false END));

-- ---------------------------------------------------------------------------
-- 4. enrollment_is_ongoing() everywhere a live enrollment is required
-- ---------------------------------------------------------------------------
-- The same predicate as of a given day, for the functions that answer "as of"
-- (the reminder targets); the one-argument form is that day = today.
CREATE OR REPLACE FUNCTION public.enrollment_is_ongoing(p_enrollment_id uuid, p_as_of date)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT coalesce((
    SELECT e.status = 'active'::public.enrollment_status
       AND p_as_of >= coalesce(e.start_date, c.start_date, '-infinity'::date)
       AND p_as_of <= coalesce(e.end_date, c.end_date, 'infinity'::date)
    FROM public.programme_enrollments e
    LEFT JOIN public.cohorts c ON c.id = e.cohort_id
    WHERE e.id = p_enrollment_id), false);
$function$;
REVOKE ALL ON FUNCTION public.enrollment_is_ongoing(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.enrollment_is_ongoing(uuid, date) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.enrollment_is_ongoing(p_enrollment_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT public.enrollment_is_ongoing(p_enrollment_id, public.programme_today());
$function$;

CREATE OR REPLACE FUNCTION public.can_book_session(p_coachee_id uuid, p_coach_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE enrollment_id uuid;
BEGIN
  SELECT e.id INTO enrollment_id
  FROM public.programme_enrollments e
  WHERE e.user_id = p_coachee_id
    AND public.enrollment_is_ongoing(e.id);
  IF (SELECT count(*) FROM public.programme_enrollments e
      WHERE e.user_id = p_coachee_id
        AND public.enrollment_is_ongoing(e.id)) <> 1 THEN
    RETURN false;
  END IF;
  RETURN public.can_book_session(p_coachee_id, p_coach_id, enrollment_id);
END;
$function$;
CREATE OR REPLACE FUNCTION public.can_book_session(p_coachee_id uuid, p_coach_id uuid, p_enrollment_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE e public.programme_enrollments;
BEGIN
  IF p_coachee_id IS DISTINCT FROM auth.uid()
     AND NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RETURN false;
  END IF;

  SELECT * INTO e FROM public.programme_enrollments
  WHERE id = p_enrollment_id AND user_id = p_coachee_id;
  IF NOT FOUND
     OR NOT public.enrollment_is_ongoing(e.id)
     OR e.cohort_id IS NULL THEN
    RETURN false;
  END IF;

  -- Never book into a cohort whose schedule does not match its programme.
  IF public.enrollment_schedule_violation(p_enrollment_id, 'coaching'::public.programme_module_type) IS NOT NULL THEN
    RETURN false;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.next_coaching_requirement(p_enrollment_id)) THEN
    RETURN false;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.cohort_coaching_coach_pool(e.cohort_id) p WHERE p.coach_id = p_coach_id) THEN
    RETURN false;
  END IF;

  RETURN NOT public.enrollment_goal_gate_blocked(p_enrollment_id);
END;
$function$;
CREATE OR REPLACE FUNCTION public.can_book_mentoring_session_reason(p_mentee_id uuid, p_mentor_id uuid, p_enrollment_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE e public.programme_enrollments;
BEGIN
  IF p_mentee_id IS DISTINCT FROM auth.uid()
     AND NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RETURN 'forbidden';
  END IF;

  SELECT * INTO e FROM public.programme_enrollments
  WHERE id = p_enrollment_id AND user_id = p_mentee_id;
  IF NOT FOUND
     OR NOT public.enrollment_is_ongoing(e.id) THEN
    RETURN 'inactive';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.programme_modules pm
    WHERE pm.programme_id = e.programme_id AND pm.module = 'mentoring' AND pm.enabled
  ) THEN
    RETURN 'module_access';
  END IF;

  IF e.cohort_id IS NULL THEN
    RETURN 'no_cohort';
  END IF;

  IF public.enrollment_schedule_violation(p_enrollment_id, 'mentoring'::public.programme_module_type) IS NOT NULL THEN
    RETURN 'cohort_schedule_invalid';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.cohort_mentoring_mentor_pool(e.cohort_id) p WHERE p.mentor_user_id = p_mentor_id
  ) THEN
    RETURN 'not_in_cohort_pool';
  END IF;

  IF public.programme_required_units(p_enrollment_id, 'mentoring'::public.programme_module_type) = 0 THEN
    RETURN 'no_mentoring_requirement';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.next_mentoring_requirement(p_enrollment_id)) THEN
    RETURN 'received_limit_reached';
  END IF;

  IF public.enrollment_goal_gate_blocked(p_enrollment_id) THEN
    RETURN 'goal_required_before_booking';
  END IF;

  RETURN 'ok';
END;
$function$;
CREATE OR REPLACE FUNCTION public.can_book_peer_session(p_peer_coach_id uuid, p_enrollment_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT public.is_coach_eligible(p_peer_coach_id)
    AND auth.uid() IS NOT NULL
    AND e.user_id=auth.uid()
    AND public.enrollment_is_ongoing(e.id)
    AND e.user_id <> p_peer_coach_id
    AND EXISTS (SELECT 1 FROM public.coach_profiles cp
                WHERE cp.id=p_peer_coach_id AND cp.peer_coaching_opt_in)
    AND EXISTS (SELECT 1 FROM public.programme_modules pm
                WHERE pm.programme_id=e.programme_id
                  AND pm.module='peer_coaching'::public.programme_module_type
                  AND pm.enabled)
    AND (
      (SELECT NULLIF(pm.config->>'monthly_limit','')::integer
       FROM public.programme_modules pm
       WHERE pm.programme_id=e.programme_id
         AND pm.module='peer_coaching'::public.programme_module_type
         AND pm.enabled) IS NULL
      OR EXISTS (SELECT 1 FROM public.get_peer_session_usage(p_enrollment_id)
                WHERE used_count < monthly_limit)
    )
  FROM public.programme_enrollments e WHERE e.id=p_enrollment_id;
$function$;
CREATE OR REPLACE FUNCTION public.coachee_peer_booking_allowed_internal(p_provider_id uuid, p_enrollment_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE e public.programme_enrollments;
BEGIN
  IF auth.uid() IS NULL OR p_provider_id = auth.uid() THEN
    RETURN false;
  END IF;
  SELECT * INTO e FROM public.programme_enrollments
  WHERE id = p_enrollment_id AND user_id = auth.uid();
  IF NOT FOUND OR NOT public.enrollment_is_ongoing(e.id) THEN
    RETURN false;
  END IF;
  -- WHO: the Admin-assigned dyad partner, and nobody else.
  IF NOT public.peer_partner_is_eligible(p_enrollment_id, p_provider_id) THEN
    RETURN false;
  END IF;
  -- HOW MANY: a Peer requirement of the cohort that no live or completed
  -- dyad session holds. No allowance enters it.
  RETURN EXISTS (SELECT 1 FROM public.next_peer_requirement(p_enrollment_id));
END
$function$;
CREATE OR REPLACE FUNCTION public.assert_peer_session_bookable_internal(p_session_id uuid, p_enrollment_id uuid, p_peer_coach_id uuid, p_peer_coachee_id uuid, p_start_time timestamp with time zone)
 RETURNS void
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE monthly integer;
BEGIN
  IF p_enrollment_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.programme_enrollments e
    WHERE e.id = p_enrollment_id AND e.user_id = p_peer_coachee_id
      AND public.enrollment_is_ongoing(e.id)
  ) THEN RAISE EXCEPTION 'Peer booking receiver enrollment is invalid' USING ERRCODE = '42501'; END IF;
  IF p_peer_coach_id = p_peer_coachee_id OR NOT EXISTS (
    SELECT 1 FROM public.coach_profiles cp WHERE cp.id = p_peer_coach_id AND cp.peer_coaching_opt_in
  ) THEN RAISE EXCEPTION 'Peer booking participant is invalid' USING ERRCODE = '42501'; END IF;
  SELECT public.programme_config_integer(pm.config, 'monthly_limit') INTO monthly
  FROM public.programme_enrollments e
  JOIN public.programme_modules pm ON pm.programme_id = e.programme_id
    AND pm.module = 'peer_coaching'::public.programme_module_type AND pm.enabled
  WHERE e.id = p_enrollment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Peer coaching is not enabled for this enrollment' USING ERRCODE = '42501';
  END IF;
  IF monthly IS NOT NULL
     AND public.peer_practice_month_count_internal(p_enrollment_id, p_start_time, p_session_id) >= monthly THEN
    RAISE EXCEPTION 'Peer coaching entitlement has been exhausted' USING ERRCODE = '42501';
  END IF;
END;
$function$;

-- Reminder targets.
CREATE OR REPLACE FUNCTION public.training_overdue_assignment_targets_internal(p_as_of date DEFAULT ((now() AT TIME ZONE programme_time_zone()))::date)
 RETURNS TABLE(user_id uuid, enrollment_id uuid, assignment_id uuid, training_week_id uuid, assignment_type text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH enrollments AS (
    SELECT e.id, e.user_id FROM public.programme_enrollments e
    WHERE public.enrollment_is_ongoing(e.id, p_as_of)
      AND e.cohort_id IS NOT NULL
  ), overdue_weeks AS (
    -- The Training requirement of the week is overdue (the calendar's rule).
    SELECT e.id AS enrollment_id, e.user_id, c.training_week_id
    FROM enrollments e
    CROSS JOIN LATERAL public.canonical_enrollment_requirement_calendar(e.id, p_as_of) c
    WHERE c.module = 'training'::public.programme_module_type AND c.is_overdue
  ), weeks AS (
    SELECT o.enrollment_id, o.user_id, w.*
    FROM (SELECT DISTINCT enrollment_id, user_id FROM overdue_weeks) o
    CROSS JOIN LATERAL public.canonical_training_week_fulfilment(o.enrollment_id, p_as_of) w
    WHERE EXISTS (SELECT 1 FROM overdue_weeks x
                  WHERE x.enrollment_id = o.enrollment_id AND x.training_week_id = w.training_week_id)
  )
  -- The part of the week still missing: its quiz and/or its reflection.
  SELECT w.user_id, w.enrollment_id, a.id, a.training_week_id, a.assignment_type::text
  FROM weeks w
  JOIN public.assignments a ON a.training_week_id = w.training_week_id AND a.is_visible
  WHERE (a.assignment_type = 'quiz' AND w.quiz_required AND NOT w.quiz_completed)
     OR (a.assignment_type = 'reflection' AND w.reflection_required AND NOT w.reflection_completed);
$function$;
CREATE OR REPLACE FUNCTION public.daily_prompt_targets_internal(p_as_of date DEFAULT ((now() AT TIME ZONE programme_time_zone()))::date)
 RETURNS TABLE(enrollment_id uuid, user_id uuid, prompt_id uuid, prompt_text text, prompt_text_vi text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT e.id, e.user_id, p.prompt_id, p.prompt_text, p.prompt_text_vi
  FROM public.programme_enrollments e
  CROSS JOIN LATERAL public.daily_prompt_for_enrollment_internal(e.id, p_as_of) p
  WHERE public.enrollment_is_ongoing(e.id, p_as_of)
    -- Already sent: send-daily-prompt seeds one response row per enrollment
    -- (older rows carry only the user).
    AND NOT EXISTS (SELECT 1 FROM public.daily_prompt_responses r
                    WHERE r.daily_prompt_id = p.prompt_id
                      AND (r.enrollment_id = e.id OR (r.enrollment_id IS NULL AND r.user_id = e.user_id)));
$function$;
CREATE OR REPLACE FUNCTION public.triad_reminder_targets_internal(p_as_of date DEFAULT programme_today(), p_cohort_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(cohort_id uuid, programme_id uuid, cohort_requirement_date_id uuid, milestone_number integer, due_on date, days_until_due integer, enrollment_id uuid, user_id uuid, triad_group_id uuid, open_session_status text, milestone_met boolean, milestone_overdue boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT d.cohort_id, d.programme_id, d.id, d.ordinal, d.due_on, (d.due_on - p_as_of)::integer,
    l.enrollment_id, l.user_id, l.triad_group_id, l.open_session_status, l.fulfilled, l.overdue
  FROM public.cohort_requirement_dates d
  CROSS JOIN LATERAL public.triad_requirement_learners_internal(d.id, p_as_of) l
  WHERE d.module = 'triads'::public.programme_module_type
    AND (p_cohort_id IS NULL OR d.cohort_id = p_cohort_id)
    AND d.ordinal <= public.triad_required_units_for_programme(d.programme_id)
    AND l.is_eligible
    AND public.enrollment_is_ongoing(l.enrollment_id, p_as_of);
$function$;

-- Admin alerts: the activity and progress alerts are for ongoing enrollments;
-- "Programme at risk" is, by definition, an enrollment that ended incomplete
-- (stored active, effective at_risk), so it reads the stored-active set.
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
  WITH stored_active AS (
    SELECT e.id, e.user_id, pr.full_name, pr.email, public.enrollment_is_ongoing(e.id) AS ongoing
    FROM public.programme_enrollments e
    JOIN public.reporting_enrollments() r ON r.enrollment_id = e.id
    JOIN public.profiles pr ON pr.id = e.user_id
    WHERE e.status = 'active'::public.enrollment_status
  ), pop AS (
    SELECT s.id, s.user_id, s.full_name, s.email FROM stored_active s WHERE s.ongoing
  ), progress AS (
    SELECT p.id, p.user_id, p.full_name, p.email, p.ongoing, c.effective_enrollment_status, c.pace_status,
      c.overdue_units, c.full_completion_pct
    FROM stored_active p
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
  WHERE g.ongoing AND g.effective_enrollment_status IS DISTINCT FROM 'at_risk'
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
  JOIN pop gp ON gp.id = o.enrollment_id
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

-- The coachee-peer cap trigger honours the lifecycle flag like
-- validate_coaching_session_cap: a row a lifecycle function (or trusted SQL
-- acting as one) has validated is not re-judged -- in particular a historical
-- session of an enrollment that is no longer ongoing.
CREATE OR REPLACE FUNCTION public.validate_coachee_peer_session_cap()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF current_setting('app.session_transition', true) = 'on' THEN
    RETURN NEW;
  END IF;
  IF NEW.enrollment_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(NEW.enrollment_id::text, 0));
  END IF;
  IF NEW.enrollment_id IS NULL OR NOT public.coachee_peer_booking_allowed_internal(NEW.peer_provider_id, NEW.enrollment_id) THEN
    RAISE EXCEPTION 'Peer coaching entitlement has been exhausted or booking is not allowed' USING ERRCODE='42501';
  END IF;
  RETURN NEW;
END;
$function$;

