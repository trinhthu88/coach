-- ===========================================================================
-- One "today" (findings L-8, D-14, P-19, L-22; decision 2)
--
-- The programme runs in ONE time zone, Asia/Ho_Chi_Minh
-- (programme_time_zone(), 20261006120000). The canonical engine took dates in
-- UTC and "today" from the server: a session at 06:30 Vietnam time on 15 Oct
-- (23:30 UTC on 14 Oct) was fulfilled, completed and attributed on 14 Oct --
-- a day early, before its requirement window, or in the wrong week.
--
--   1. programme_today() = (now() AT TIME ZONE programme_time_zone())::date.
--   2. Every public function (78) is re-created with, mechanically:
--        CURRENT_DATE (body and "as of" defaults)  -> public.programme_today()
--        AT TIME ZONE 'UTC'                         -> AT TIME ZONE public.programme_time_zone()
--        <timestamp>::date                          -> (<timestamp> AT TIME ZONE public.programme_time_zone())::date
--      Nothing else in them changes. CREATE OR REPLACE keeps their grants.
--   3. The stored activity ledger (session_activity_attributions.occurred_on,
--      read by the canonical Triad fulfilment) is re-dated the same way.
--   4. Final-state guard: no public function reads CURRENT_DATE or takes a
--      date in UTC.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Today, in the programme time zone
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.programme_today()
 RETURNS date
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT (now() AT TIME ZONE public.programme_time_zone())::date;
$function$;
GRANT EXECUTE ON FUNCTION public.programme_today() TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. The functions
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_canonical_enrollment_journey(p_enrollment_id uuid, p_as_of date DEFAULT public.programme_today())
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT CASE
    WHEN public.has_role(auth.uid(), 'admin'::public.app_role)
     AND EXISTS (SELECT 1 FROM public.programme_enrollments e WHERE e.id = p_enrollment_id AND e.cohort_id IS NOT NULL)
    THEN public.canonical_enrollment_journey(p_enrollment_id, p_as_of)
    ELSE '[]'::jsonb
  END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_canonical_enrollment_progress(p_enrollment_ids uuid[], p_as_of date DEFAULT public.programme_today())
 RETURNS TABLE(enrollment_id uuid, learner_display_name text, programme_label text, cohort_id uuid, cohort_label text, programme_id uuid, enrollment_start_date date, enrollment_end_date date, programme_start_date date, programme_end_date date, enrollment_status enrollment_status, stored_enrollment_status enrollment_status, effective_enrollment_status enrollment_status, required_units integer, completed_units integer, due_units integer, booked_units integer, overdue_units integer, full_completion_pct numeric, due_adherence_pct numeric, pace_status text, progress_available boolean, coaching_required_units integer, coaching_completed_units integer, coaching_due_units integer, coaching_booked_units integer, training_required_units integer, training_completed_units integer, training_due_units integer, training_booked_units integer, peer_required_units integer, peer_completed_units integer, peer_due_units integer, peer_booked_units integer, mentoring_required_units integer, mentoring_completed_units integer, mentoring_due_units integer, mentoring_booked_units integer, triad_required_units integer, triad_completed_units integer, triad_due_units integer, triad_booked_units integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT p.*
  FROM (SELECT DISTINCT unnest(p_enrollment_ids) AS id) requested
  CROSS JOIN LATERAL public.canonical_enrollment_progress(requested.id, p_as_of) p
  WHERE public.has_role(auth.uid(), 'admin'::public.app_role);
$function$;

CREATE OR REPLACE FUNCTION public.admin_cohort_triad_learners(p_cohort_id uuid, p_as_of date DEFAULT public.programme_today())
 RETURNS TABLE(enrollment_id uuid, user_id uuid, full_name text, spoken_languages text[], programme_id uuid, enrollment_status enrollment_status, is_eligible boolean, required_units integer, raw_completed_sessions integer, completed_units integer, due_units integer, overdue_units integer, next_due_on date, requirements jsonb)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  PERFORM public.triad_assert_admin();
  RETURN QUERY SELECT * FROM public.triad_cohort_learners_internal(p_cohort_id, p_as_of);
END $function$;

CREATE OR REPLACE FUNCTION public.admin_cohort_triad_requirements(p_cohort_id uuid, p_as_of date DEFAULT public.programme_today())
 RETURNS TABLE(cohort_requirement_date_id uuid, programme_id uuid, unit_number integer, due_on date, required_units integer, eligible_enrollments integer, assigned_enrollments integer, fulfilled_enrollments integer, overdue_enrollments integer, active_groups integer, reflections_submitted integer, reflections_expected integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  PERFORM public.triad_assert_admin();
  RETURN QUERY
  SELECT d.id, d.programme_id, d.ordinal, d.due_on, public.triad_required_units_for_programme(d.programme_id),
    st.eligible, st.assigned, st.fulfilled, st.overdue,
    (SELECT count(*)::integer FROM public.triad_groups g WHERE g.cohort_requirement_date_id = d.id AND g.is_active),
    rf.submitted, rf.expected
  FROM public.cohort_requirement_dates d
  CROSS JOIN LATERAL (
    SELECT count(*) FILTER (WHERE l.is_eligible)::integer AS eligible,
      count(*) FILTER (WHERE l.is_eligible AND l.triad_group_id IS NOT NULL)::integer AS assigned,
      count(*) FILTER (WHERE l.fulfilled)::integer AS fulfilled,
      count(*) FILTER (WHERE l.overdue AND l.is_eligible)::integer AS overdue
    FROM public.triad_requirement_learners_internal(d.id, p_as_of) l
  ) st
  CROSS JOIN LATERAL (
    SELECT count(r.id)::integer AS submitted, count(*)::integer AS expected
    FROM public.triad_groups g
    JOIN public.triad_sessions s ON s.triad_group_id = g.id AND s.status = 'completed'
    JOIN public.triad_group_members m ON m.triad_group_id = g.id
    LEFT JOIN public.triad_reflections r ON r.triad_session_id = s.id AND r.enrollment_id = m.enrollment_id
    WHERE g.cohort_requirement_date_id = d.id
  ) rf
  WHERE d.cohort_id = p_cohort_id AND d.module = 'triads'::public.programme_module_type
    AND d.ordinal <= public.triad_required_units_for_programme(d.programme_id)
  ORDER BY d.programme_id, d.ordinal;
END $function$;

CREATE OR REPLACE FUNCTION public.admin_create_programme_enrollment(p_user_id uuid, p_programme_id uuid, p_cohort_id uuid, p_organization_id uuid, p_start_date date DEFAULT public.programme_today(), p_end_date date DEFAULT NULL::date)
 RETURNS programme_enrollments
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  selected_cohort public.cohorts;
  existing public.programme_enrollments;
  result public.programme_enrollments;
  effective_end_date date;
  effective_organization_id uuid;
BEGIN
  IF auth.role() <> 'service_role'
     AND NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Only an administrator or service role can create enrolments'
      USING ERRCODE = '42501';
  END IF;
  SELECT * INTO selected_cohort FROM public.cohorts
    WHERE id = p_cohort_id AND programme_id = p_programme_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The selected cohort does not belong to the selected programme'
      USING ERRCODE = 'P0001';
  END IF;
  -- The enrollment's organisation is its own fact (sponsor visibility reads
  -- it); the cohort's organisation is only the default.
  effective_organization_id := coalesce(p_organization_id, selected_cohort.organization_id);
  effective_end_date := coalesce(p_end_date, selected_cohort.end_date);
  IF effective_end_date IS NULL THEN
    RAISE EXCEPTION 'An enrollment end date is required to create its schedule snapshot'
      USING ERRCODE = 'P0001';
  END IF;
  IF (selected_cohort.start_date IS NOT NULL AND p_start_date < selected_cohort.start_date)
     OR (selected_cohort.end_date IS NOT NULL AND effective_end_date > selected_cohort.end_date)
     OR effective_end_date < p_start_date THEN
    RAISE EXCEPTION 'Enrollment dates must fall within the cohort dates' USING ERRCODE = 'P0001';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));
  SELECT * INTO existing FROM public.programme_enrollments
    WHERE user_id = p_user_id AND status IN ('active', 'at_risk', 'paused') FOR UPDATE;
  IF FOUND THEN
    RAISE EXCEPTION '%', jsonb_build_object(
      'code','ongoing_enrollment_exists','enrollment_id',existing.id,
      'programme_id',existing.programme_id,'cohort_id',existing.cohort_id,
      'status',existing.status,'start_date',existing.start_date,'end_date',existing.end_date
    )::text USING ERRCODE = 'P0001';
  END IF;
  INSERT INTO public.programme_enrollments
    (user_id, coachee_id, programme_id, cohort_id, organization_id, start_date, end_date, status)
  VALUES (p_user_id, p_user_id, p_programme_id, p_cohort_id, effective_organization_id,
          p_start_date, effective_end_date, 'active')
  RETURNING * INTO result;
  PERFORM public.generate_enrollment_schedule(result.id);
  RETURN result;
END $function$;

CREATE OR REPLACE FUNCTION public.admin_enrollment_module_progress(p_enrollment_id uuid, p_as_of date DEFAULT public.programme_today())
 RETURNS TABLE(module programme_module_type, required_units integer, completed_units integer, completed_activity_units integer, due_units integer, booked_units integer, overdue_units integer, pace_status text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT g.module, g.required_units, g.completed_units, g.completed_activity_units,
         g.due_units, g.booked_units, g.overdue_units, g.pace_status
  FROM public.canonical_module_progress(p_enrollment_id, p_as_of) g
  WHERE public.has_role(auth.uid(), 'admin'::public.app_role)
  ORDER BY g.module;
$function$;

CREATE OR REPLACE FUNCTION public.admin_enrollment_requirement_calendar(p_enrollment_id uuid, p_as_of date DEFAULT public.programme_today())
 RETURNS TABLE(enrollment_id uuid, programme_id uuid, cohort_id uuid, organization_id uuid, module programme_module_type, requirement_id uuid, requirement_index integer, requirement_label text, training_week_id uuid, due_on date, is_required boolean, is_due_as_of boolean, is_completed boolean, completed_on date, is_overdue boolean, completion_source text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT c.* FROM public.canonical_enrollment_requirement_calendar(p_enrollment_id, p_as_of) c
  WHERE public.has_role(auth.uid(), 'admin'::public.app_role);
$function$;

CREATE OR REPLACE FUNCTION public.admin_ineligible_programme_activity()
 RETURNS TABLE(enrollment_id uuid, module programme_module_type, requirement_id uuid, requirement_index integer, training_week_id uuid, available_on date, due_on date, programme_end_date date, activity_on date, reason text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Only an admin can read the ineligible-activity diagnostic' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH enrollments AS (
    SELECT e.id, coalesce(e.end_date, c.end_date) AS end_on
    FROM public.programme_enrollments e
    LEFT JOIN public.cohorts c ON c.id = e.cohort_id
  ), sessions AS (
    SELECT en.id AS enrollment_id, 'coaching'::public.programme_module_type AS module,
      f.requirement_id, f.ordinal, NULL::uuid AS training_week_id, f.due_on, f.fulfilled_on, en.end_on
    FROM enrollments en CROSS JOIN LATERAL public.canonical_coaching_requirement_fulfilment(en.id) f
    WHERE f.fulfilled_on IS NOT NULL
    UNION ALL
    SELECT en.id, 'mentoring', f.requirement_id, f.ordinal, NULL, f.due_on, f.fulfilled_on, en.end_on
    FROM enrollments en CROSS JOIN LATERAL public.canonical_mentoring_requirement_fulfilment(en.id) f
    WHERE f.fulfilled_on IS NOT NULL
    UNION ALL
    SELECT en.id, 'peer_coaching', f.requirement_id, f.ordinal, NULL, f.due_on, f.fulfilled_on, en.end_on
    FROM enrollments en CROSS JOIN LATERAL public.canonical_peer_requirement_fulfilment(en.id) f
    WHERE f.fulfilled_on IS NOT NULL
    UNION ALL
    -- Triads: every completed session of the requirement's group (raw evidence).
    SELECT en.id, 'triads', d.id, d.ordinal, NULL, d.due_on, a.occurred_on, en.end_on
    FROM enrollments en
    JOIN public.triad_group_members m ON m.enrollment_id = en.id
    JOIN public.triad_groups g ON g.id = m.triad_group_id
    JOIN public.cohort_requirement_dates d ON d.id = g.cohort_requirement_date_id
    JOIN public.triad_sessions s ON s.triad_group_id = g.id AND s.status = 'completed'
    JOIN public.session_activity_attributions a
      ON a.source_activity_type = 'triad' AND a.source_activity_id = s.id AND a.enrollment_id = en.id
  ), training AS (
    -- Every piece of mandatory Training evidence, against its week's window.
    SELECT en.id AS enrollment_id, f.training_week_id, f.week_number, f.available_on, f.due_on, en.end_on,
      x.activity_on
    FROM enrollments en
    CROSS JOIN LATERAL public.canonical_training_week_fulfilment(en.id, public.programme_today()) f
    CROSS JOIN LATERAL (
      SELECT (tp.completed_at AT TIME ZONE public.programme_time_zone())::date AS activity_on
      FROM public.training_progress tp
      WHERE tp.enrollment_id = en.id AND tp.training_week_id = f.training_week_id AND tp.completed_at IS NOT NULL
      UNION ALL
      SELECT (sub.submitted_at AT TIME ZONE public.programme_time_zone())::date
      FROM public.assignments a
      JOIN public.assignment_submissions sub ON sub.assignment_id = a.id AND sub.enrollment_id = en.id
      WHERE a.training_week_id = f.training_week_id AND a.assignment_type = 'quiz' AND a.is_visible
        AND sub.submitted_at IS NOT NULL
      UNION ALL
      SELECT (rs.submitted_at AT TIME ZONE public.programme_time_zone())::date
      FROM public.programme_enrollments pe
      JOIN public.programme_reflections pr ON pr.programme_id = pe.programme_id AND pr.appears_at_week = f.week_number AND pr.is_visible
      JOIN public.reflection_submissions rs ON rs.reflection_id = pr.id AND rs.enrollment_id = en.id
      WHERE pe.id = en.id AND rs.submitted_at IS NOT NULL
    ) x
  )
  SELECT s.enrollment_id, s.module, s.requirement_id, s.ordinal, s.training_week_id,
    public.canonical_session_requirement_available_on(s.due_on), s.due_on, s.end_on, s.fulfilled_on,
    CASE WHEN s.fulfilled_on < public.canonical_session_requirement_available_on(s.due_on)
      THEN 'completed_before_available' ELSE 'completed_after_programme_end' END
  FROM sessions s
  WHERE s.fulfilled_on < public.canonical_session_requirement_available_on(s.due_on)
     OR (s.end_on IS NOT NULL AND s.fulfilled_on > s.end_on)
  UNION ALL
  SELECT t.enrollment_id, 'training'::public.programme_module_type, NULL::uuid, t.week_number, t.training_week_id,
    t.available_on, t.due_on, t.end_on, t.activity_on,
    CASE WHEN t.available_on IS NULL OR t.activity_on < t.available_on
      THEN 'completed_before_available' ELSE 'completed_after_programme_end' END
  FROM training t
  WHERE t.available_on IS NULL OR t.activity_on < t.available_on
     OR (t.end_on IS NOT NULL AND t.activity_on > t.end_on)
  ORDER BY 1, 2, 4, 9;
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_organization_enrollments(p_organization_id uuid, p_as_of date DEFAULT public.programme_today())
 RETURNS TABLE(enrollment_id uuid, user_id uuid, learner_name text, learner_email text, organization_id uuid, organization_name text, programme_id uuid, programme_name text, cohort_id uuid, cohort_name text, stored_enrollment_status enrollment_status, effective_enrollment_status enrollment_status, is_ongoing boolean, start_date date, end_date date, required_units integer, completed_units integer, due_units integer, overdue_units integer, full_completion_pct numeric, progress_available boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT e.id, e.user_id, pr.full_name, pr.email,
    e.organization_id, o.name,
    e.programme_id, p.name, e.cohort_id, c.name,
    e.status, cp.effective_enrollment_status,
    e.status IN ('active', 'at_risk', 'paused'),
    e.start_date, coalesce(e.end_date, c.end_date),
    cp.required_units, cp.completed_units, cp.due_units, cp.overdue_units,
    cp.full_completion_pct, coalesce(cp.progress_available, false)
  FROM public.programme_enrollments e
  JOIN public.organizations o ON o.id = e.organization_id
  LEFT JOIN public.profiles pr ON pr.id = e.user_id
  LEFT JOIN public.programmes p ON p.id = e.programme_id
  LEFT JOIN public.cohorts c ON c.id = e.cohort_id
  LEFT JOIN LATERAL public.canonical_enrollment_progress(e.id, p_as_of) cp ON true
  WHERE public.has_role(auth.uid(), 'admin'::public.app_role)
    AND e.organization_id = p_organization_id
  ORDER BY (e.status IN ('active', 'at_risk', 'paused')) DESC, c.name, pr.full_name;
$function$;

CREATE OR REPLACE FUNCTION public.admin_transition_enrollment(p_user_id uuid, p_programme_id uuid, p_cohort_id uuid, p_organization_id uuid DEFAULT NULL::uuid, p_effective_date date DEFAULT public.programme_today())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_cohort public.cohorts;
  v_programme_id uuid;
  v_organization_id uuid;
  v_effective date := coalesce(p_effective_date, public.programme_today());
  v_current public.programme_enrollments;
  v_has_current boolean;
  v_new public.programme_enrollments;
  v_start date;
BEGIN
  -- service_role: the admin-invite-users edge function, which has already
  -- verified that its caller is an administrator (same rule as
  -- admin_create_programme_enrollment).
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Only an administrator can change enrolments' USING ERRCODE = '42501';
  END IF;
  IF p_user_id IS NULL OR p_cohort_id IS NULL THEN
    RAISE EXCEPTION 'A person and a cohort are required' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user_id) THEN
    RAISE EXCEPTION 'Person not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_cohort FROM public.cohorts WHERE id = p_cohort_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cohort not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_cohort.programme_id IS NULL THEN
    RAISE EXCEPTION 'The selected cohort has no programme' USING ERRCODE = 'P0001';
  END IF;
  -- The cohort owns the programme; a conflicting explicit programme is an error.
  IF p_programme_id IS NOT NULL AND p_programme_id <> v_cohort.programme_id THEN
    RAISE EXCEPTION 'The selected cohort does not belong to the selected programme' USING ERRCODE = 'P0001';
  END IF;
  v_programme_id := v_cohort.programme_id;
  -- Organization is optional and defaults to the cohort's organization.
  v_organization_id := coalesce(p_organization_id, v_cohort.organization_id);
  IF v_organization_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.organizations WHERE id = v_organization_id) THEN
    RAISE EXCEPTION 'Organization not found' USING ERRCODE = 'P0002';
  END IF;

  -- Same lock admin_create_programme_enrollment takes (re-entrant in-session).
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  SELECT * INTO v_current FROM public.programme_enrollments
   WHERE user_id = p_user_id AND status IN ('active', 'at_risk', 'paused')
   FOR UPDATE;
  v_has_current := FOUND;

  IF v_has_current
     AND v_current.programme_id = v_programme_id
     AND v_current.cohort_id IS NOT DISTINCT FROM p_cohort_id THEN
    IF v_current.organization_id IS NOT DISTINCT FROM v_organization_id THEN
      RETURN jsonb_build_object('action', 'unchanged', 'enrollment_id', v_current.id);
    END IF;
    -- Organization-only change: a correction of the current enrollment. The
    -- value it replaces is kept in programme_enrollment_organization_changes.
    INSERT INTO public.programme_enrollment_organization_changes
      (enrollment_id, previous_organization_id, new_organization_id, changed_by)
    VALUES (v_current.id, v_current.organization_id, v_organization_id, auth.uid());
    UPDATE public.programme_enrollments
       SET organization_id = v_organization_id
     WHERE id = v_current.id;
    RETURN jsonb_build_object(
      'action', 'organization_updated',
      'enrollment_id', v_current.id,
      'previous_organization_id', v_current.organization_id
    );
  END IF;

  IF v_has_current THEN
    -- Close, never delete or rewrite programme/cohort/organization.
    UPDATE public.programme_enrollments
       SET status = 'completed'::public.enrollment_status,
           ended_reason = 'transferred',
           end_date = greatest(v_current.start_date, least(coalesce(v_current.end_date, v_effective), v_effective))
     WHERE id = v_current.id;
  END IF;

  -- A future cohort starts on its own start date.
  v_start := greatest(v_effective, coalesce(v_cohort.start_date, v_effective));
  v_new := public.admin_create_programme_enrollment(
    p_user_id, v_programme_id, p_cohort_id, v_organization_id, v_start, NULL
  );

  IF v_has_current THEN
    UPDATE public.programme_enrollments SET superseded_by = v_new.id WHERE id = v_current.id;
  END IF;

  RETURN jsonb_build_object(
    'action', CASE WHEN v_has_current THEN 'transitioned' ELSE 'created' END,
    'enrollment_id', v_new.id,
    'closed_enrollment_id', CASE WHEN v_has_current THEN v_current.id END
  );
END $function$;

CREATE OR REPLACE FUNCTION public.admin_update_coach_configuration(p_coach_id uuid, p_full_name text, p_profile_status text, p_selectable_coach_ids uuid[] DEFAULT '{}'::uuid[], p_enrollment_id uuid DEFAULT NULL::uuid, p_programme_id uuid DEFAULT NULL::uuid, p_cohort_id uuid DEFAULT NULL::uuid, p_organization_id uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  selected_coach_id uuid;
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

  DELETE FROM public.coach_as_coachee_allowlist
  WHERE coach_user_id = p_coach_id
    AND NOT (selectable_coach_id = ANY(COALESCE(p_selectable_coach_ids, '{}'::uuid[])));

  FOREACH selected_coach_id IN ARRAY COALESCE(p_selectable_coach_ids, '{}'::uuid[])
  LOOP
    INSERT INTO public.coach_as_coachee_allowlist (
      coach_user_id, selectable_coach_id, created_by
    ) VALUES (p_coach_id, selected_coach_id, auth.uid())
    ON CONFLICT (coach_user_id, selectable_coach_id) DO NOTHING;
  END LOOP;

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

CREATE OR REPLACE FUNCTION public.admin_user_enrollments(p_user_id uuid, p_as_of date DEFAULT public.programme_today())
 RETURNS TABLE(enrollment_id uuid, programme_id uuid, programme_name text, cohort_id uuid, cohort_name text, organization_id uuid, organization_name text, start_date date, end_date date, stored_enrollment_status enrollment_status, effective_enrollment_status enrollment_status, required_units integer, completed_units integer, overdue_units integer, full_completion_pct numeric, progress_available boolean, created_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT e.id, e.programme_id, p.name::text, e.cohort_id, c.name::text,
         o.id, o.name::text, e.start_date, e.end_date,
         e.status, coalesce(cp.effective_enrollment_status, e.status),
         cp.required_units, cp.completed_units, cp.overdue_units,
         cp.full_completion_pct, coalesce(cp.progress_available, false), e.created_at
  FROM public.programme_enrollments e
  LEFT JOIN public.programmes p ON p.id = e.programme_id
  LEFT JOIN public.cohorts c ON c.id = e.cohort_id
  -- The enrollment's own organization is the source of truth (as for Sponsor).
  LEFT JOIN public.organizations o ON o.id = e.organization_id
  LEFT JOIN LATERAL public.canonical_enrollment_progress(e.id, p_as_of) cp ON true
  WHERE e.user_id = p_user_id
    AND public.has_role(auth.uid(), 'admin'::public.app_role)
  ORDER BY e.start_date DESC NULLS LAST, e.created_at DESC;
$function$;

CREATE OR REPLACE FUNCTION public.attribute_activity_to_cadence_milestone(p_enrollment_id uuid, p_module text, p_activity_id uuid, p_occurred_on date)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  milestone uuid;
  source_type text;
  source_enrollment uuid;
  source_date date;
  source_count integer;
BEGIN
  IF p_enrollment_id IS NULL OR p_module IS NULL OR p_activity_id IS NULL
     OR p_occurred_on IS NULL THEN
    RAISE EXCEPTION 'Activity attribution requires enrollment, module, activity, and date'
      USING ERRCODE='P0001';
  END IF;
  -- Resolve the source without inferring ownership from a person's history.
  IF p_module='coaching' THEN
    source_type := 'coaching';
    SELECT count(*), (array_agg(enrollment_id))[1], max((start_time AT TIME ZONE public.programme_time_zone())::date) INTO source_count,source_enrollment,source_date
      FROM public.sessions WHERE id=p_activity_id;
  ELSIF p_module='peer_coaching' THEN
    SELECT count(*), (array_agg(enrollment_id))[1], max((start_time AT TIME ZONE public.programme_time_zone())::date) INTO source_count,source_enrollment,source_date
      FROM (SELECT enrollment_id,start_time FROM public.peer_sessions WHERE id=p_activity_id
            UNION ALL SELECT enrollment_id,start_time FROM public.coachee_peer_sessions WHERE id=p_activity_id) s;
    source_type := 'peer_coaching';
  ELSIF p_module='mentoring' THEN
    source_type := 'mentoring';
    SELECT count(*), (array_agg(enrollment_id))[1], max((start_time AT TIME ZONE public.programme_time_zone())::date) INTO source_count,source_enrollment,source_date
      FROM public.mentoring_sessions WHERE id=p_activity_id;
  ELSIF p_module='triads' THEN
    RAISE EXCEPTION 'Triad evidence is session evidence written by triad_sync_session_attributions' USING ERRCODE='P0001';
  ELSIF p_module='training' THEN
    source_type := 'training';
    SELECT count(*), (array_agg(enrollment_id))[1], max((completed_at AT TIME ZONE public.programme_time_zone())::date) INTO source_count,source_enrollment,source_date
      FROM public.training_progress WHERE id=p_activity_id AND completed_at IS NOT NULL;
  ELSIF p_module='quiz' THEN
    source_type := 'quiz';
    SELECT count(*), (array_agg(sub.enrollment_id))[1], max((sub.submitted_at AT TIME ZONE public.programme_time_zone())::date) INTO source_count,source_enrollment,source_date
      FROM public.assignment_submissions sub JOIN public.assignments a ON a.id=sub.assignment_id
      WHERE sub.id=p_activity_id AND a.assignment_type='quiz'::public.assignment_type;
  ELSIF p_module='daily_prompt' THEN
    source_type := 'daily_prompt';
    SELECT count(*), (array_agg(enrollment_id))[1], max((responded_at AT TIME ZONE public.programme_time_zone())::date) INTO source_count,source_enrollment,source_date
      FROM public.daily_prompt_responses WHERE id=p_activity_id;
  ELSE
    RAISE EXCEPTION 'Unsupported cadence activity module: %', p_module USING ERRCODE='P0001';
  END IF;
  IF public.is_historical_ownership_retired(source_type, p_activity_id)
     OR (source_type='peer_coaching' AND (
       public.is_historical_ownership_retired('peer_sessions',p_activity_id)
       OR public.is_historical_ownership_retired('coachee_peer_sessions',p_activity_id))) THEN
    RAISE EXCEPTION 'Retired activity cannot be attributed' USING ERRCODE='P0001';
  END IF;
  IF source_count <> 1 OR source_enrollment IS NULL OR source_enrollment <> p_enrollment_id
     OR source_date IS NULL OR source_date IS DISTINCT FROM p_occurred_on THEN
    RAISE EXCEPTION 'Activity source is missing, ambiguous, or not owned by enrollment'
      USING ERRCODE='P0001';
  END IF;

  SELECT m.id INTO milestone
  FROM public.enrollment_module_milestones m
  JOIN public.enrollment_module_snapshots s ON s.id=m.enrollment_module_snapshot_id
  WHERE s.enrollment_id=p_enrollment_id AND s.module=p_module::public.programme_module_type
    AND m.due_on <= p_occurred_on
    AND NOT EXISTS (SELECT 1 FROM public.session_activity_attributions a WHERE a.enrollment_id=p_enrollment_id AND a.milestone_id=m.id)
  ORDER BY m.due_on,m.id LIMIT 1;

  INSERT INTO public.session_activity_attributions
    (enrollment_id,module,source_activity_type,source_activity_id,occurred_on,milestone_id)
  VALUES (p_enrollment_id,p_module::public.programme_module_type,source_type,p_activity_id,p_occurred_on,milestone)
  ON CONFLICT (source_activity_type,source_activity_id,enrollment_id) DO NOTHING;
  RETURN milestone;
END $function$;

CREATE OR REPLACE FUNCTION public.attribute_new_activity_trigger()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_TABLE_NAME='sessions' THEN
    IF NEW.enrollment_id IS NOT NULL THEN
      PERFORM public.attribute_activity_to_cadence_milestone(
        NEW.enrollment_id,'coaching',NEW.id,(NEW.start_time AT TIME ZONE public.programme_time_zone())::date
      );
    END IF;
  ELSIF TG_TABLE_NAME IN ('peer_sessions','coachee_peer_sessions') THEN
    IF NEW.enrollment_id IS NOT NULL THEN
      PERFORM public.attribute_activity_to_cadence_milestone(
        NEW.enrollment_id,'peer_coaching',NEW.id,(NEW.start_time AT TIME ZONE public.programme_time_zone())::date
      );
    END IF;
  ELSIF TG_TABLE_NAME='mentoring_sessions' THEN
    IF NEW.enrollment_id IS NOT NULL THEN
      PERFORM public.attribute_activity_to_cadence_milestone(
        NEW.enrollment_id,'mentoring',NEW.id,(NEW.start_time AT TIME ZONE public.programme_time_zone())::date
      );
    END IF;
  ELSIF TG_TABLE_NAME='training_progress' THEN
    IF NEW.enrollment_id IS NOT NULL AND NEW.completed_at IS NOT NULL THEN
      PERFORM public.attribute_activity_to_cadence_milestone(
        NEW.enrollment_id,'training',NEW.id,(NEW.completed_at AT TIME ZONE public.programme_time_zone())::date
      );
    END IF;
  ELSIF TG_TABLE_NAME='assignment_submissions' THEN
    IF NEW.enrollment_id IS NOT NULL
       AND NEW.submitted_at IS NOT NULL
       AND EXISTS (
         SELECT 1
         FROM public.assignments a
         WHERE a.id = NEW.assignment_id
           AND a.assignment_type = 'quiz'
       )
    THEN
      PERFORM public.attribute_activity_to_cadence_milestone(
        NEW.enrollment_id,
        'quiz',
        NEW.id,
        (NEW.submitted_at AT TIME ZONE public.programme_time_zone())::date
      );
    END IF;
  ELSIF TG_TABLE_NAME='daily_prompt_responses' THEN
    IF NEW.enrollment_id IS NOT NULL AND NEW.responded_at IS NOT NULL THEN
      PERFORM public.attribute_activity_to_cadence_milestone(
        NEW.enrollment_id,'daily_prompt',NEW.id,(NEW.responded_at AT TIME ZONE public.programme_time_zone())::date
      );
    END IF;
  END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.backfill_coachee_reflection_enrollment_scope()
 RETURNS TABLE(resolved_count integer, ambiguous_count integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_resolved integer;
  v_ambiguous integer;
BEGIN
  WITH candidates AS (
    SELECT
      r.id AS reflection_id,
      e.id AS enrollment_id,
      count(*) OVER (PARTITION BY r.id) AS candidate_count
    FROM public.coachee_reflections r
    JOIN public.programme_enrollments e
      ON e.user_id = r.coachee_id
     AND e.start_date <= (r.created_at AT TIME ZONE public.programme_time_zone())::date
     AND (e.end_date IS NULL OR e.end_date >= (r.created_at AT TIME ZONE public.programme_time_zone())::date)
    WHERE r.enrollment_id IS NULL
  ), unambiguous AS (
    SELECT reflection_id, enrollment_id
    FROM candidates
    WHERE candidate_count = 1
  )
  UPDATE public.coachee_reflections r
  SET enrollment_id = u.enrollment_id
  FROM unambiguous u
  WHERE r.id = u.reflection_id;
  GET DIAGNOSTICS v_resolved = ROW_COUNT;

  SELECT count(DISTINCT reflection_id) INTO v_ambiguous
  FROM (
    SELECT r.id AS reflection_id, count(*) AS candidate_count
    FROM public.coachee_reflections r
    JOIN public.programme_enrollments e
      ON e.user_id = r.coachee_id
     AND e.start_date <= (r.created_at AT TIME ZONE public.programme_time_zone())::date
     AND (e.end_date IS NULL OR e.end_date >= (r.created_at AT TIME ZONE public.programme_time_zone())::date)
    WHERE r.enrollment_id IS NULL
    GROUP BY r.id
    HAVING count(*) > 1
  ) ambiguous;

  RAISE NOTICE 'coachee_reflections enrollment backfill: % rows resolved, % rows left null (multiple candidate enrollments)', v_resolved, v_ambiguous;
  RETURN QUERY SELECT v_resolved, v_ambiguous;
END;
$function$;

CREATE OR REPLACE FUNCTION public.canonical_coaching_requirement_fulfilment(p_enrollment_id uuid)
 RETURNS TABLE(requirement_id uuid, ordinal integer, due_on date, fulfilled_on date, booked_on date, session_id uuid, post_session_pending boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH enrollment AS (
    SELECT e.id, e.cohort_id, e.programme_id
    FROM public.programme_enrollments e WHERE e.id = p_enrollment_id
  ), requirements AS (
    SELECT d.id, d.ordinal, d.due_on
    FROM public.cohort_requirement_dates d
    JOIN enrollment e ON e.cohort_id = d.cohort_id AND e.programme_id = d.programme_id
    WHERE d.module = 'coaching'::public.programme_module_type
  ), per_requirement AS (
    SELECT r.id AS requirement_id, r.ordinal, r.due_on,
      (SELECT s.id FROM public.sessions s
        WHERE s.cohort_requirement_id = r.id
          AND s.enrollment_id = p_enrollment_id
          AND s.status IN ('pending_coach_approval', 'confirmed', 'completed')
        -- 20261001110000: a completed session inside the window, then a
        -- live one, then (only when nothing else exists) one completed before
        -- the window -- it is kept visible but never counts or blocks.
        ORDER BY CASE WHEN s.status = 'completed' AND public.session_occupies_requirement(s.status, s.start_time, r.due_on) THEN 0
                      WHEN s.status <> 'completed' THEN 1 ELSE 2 END, s.start_time
        LIMIT 1) AS session_id
    FROM requirements r
  )
  SELECT pr.requirement_id, pr.ordinal, pr.due_on,
    -- Operational completion, not evidence.
    CASE WHEN s.status = 'completed' THEN (s.start_time AT TIME ZONE public.programme_time_zone())::date END AS fulfilled_on,
    CASE WHEN s.id IS NOT NULL AND s.status <> 'completed'
         THEN (s.start_time AT TIME ZONE public.programme_time_zone())::date END AS booked_on,
    pr.session_id,
    coalesce(s.status = 'completed' AND NOT ev.evidence_complete, false) AS post_session_pending
  FROM per_requirement pr
  LEFT JOIN public.sessions s ON s.id = pr.session_id
  LEFT JOIN LATERAL public.coaching_session_evidence(pr.session_id) ev ON pr.session_id IS NOT NULL
  ORDER BY pr.ordinal;
$function$;

CREATE OR REPLACE FUNCTION public.canonical_enrollment_checkpoints(p_enrollment_id uuid, p_as_of date DEFAULT public.programme_today())
 RETURNS TABLE(due_on date, label text, module_scope jsonb, required_units integer, completed_units integer, state text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH requirements AS (
    SELECT * FROM public.canonical_enrollment_requirement_status(p_enrollment_id, p_as_of)
    WHERE due_on IS NOT NULL
  ), dates AS (
    SELECT r.due_on,
      string_agg(DISTINCT tw.title, ' · ' ORDER BY tw.title)
        FILTER (WHERE tw.title IS NOT NULL) AS label,
      to_jsonb(array_agg(DISTINCT r.module::text ORDER BY r.module::text)) AS module_scope
    FROM requirements r
    LEFT JOIN public.training_weeks tw ON tw.id = r.training_week_id
    GROUP BY r.due_on
  ), checkpoints AS (
    SELECT d.due_on, d.label, d.module_scope,
      count(*) FILTER (WHERE r.due_on <= d.due_on)::integer AS required_units,
      count(*) FILTER (WHERE r.due_on <= d.due_on AND r.completed_on IS NOT NULL)::integer AS completed_units,
      coalesce(bool_or(r.state = 'completed_late') FILTER (WHERE r.due_on = d.due_on), false) AS has_late,
      coalesce(bool_or(r.state <> 'upcoming')
        FILTER (WHERE r.due_on <= d.due_on AND r.completed_on IS NULL), false) AS has_available_open,
      coalesce(bool_or(r.state = 'upcoming')
        FILTER (WHERE r.due_on <= d.due_on AND r.completed_on IS NULL), false) AS has_unavailable_open,
      max(r.effective_as_of) AS effective_as_of
    FROM dates d
    CROSS JOIN requirements r
    GROUP BY d.due_on, d.label, d.module_scope
  )
  SELECT c.due_on, c.label, c.module_scope, c.required_units, c.completed_units,
    CASE
      WHEN c.required_units > 0 AND c.completed_units >= c.required_units
        THEN CASE WHEN c.has_late THEN 'completed_late' ELSE 'completed' END
      WHEN c.due_on < c.effective_as_of AND c.has_available_open THEN 'overdue'
      WHEN c.has_unavailable_open THEN 'upcoming'
      ELSE 'current'
    END
  FROM checkpoints c
  ORDER BY c.due_on;
$function$;

CREATE OR REPLACE FUNCTION public.canonical_enrollment_effective_as_of(p_enrollment_id uuid, p_as_of date DEFAULT public.programme_today())
 RETURNS date
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  -- Programme completion freezes at the programme end: the enrollment's own
  -- end date, else its cohort's (canonical_enrollment_progress.enrollment_end_date).
  SELECT CASE
    WHEN coalesce(e.end_date, c.end_date) IS NULL THEN p_as_of
    ELSE least(p_as_of, coalesce(e.end_date, c.end_date))
  END
  FROM public.programme_enrollments e
  LEFT JOIN public.cohorts c ON c.id = e.cohort_id
  WHERE e.id = p_enrollment_id;
$function$;

CREATE OR REPLACE FUNCTION public.canonical_enrollment_experience_base(p_enrollment_id uuid, p_as_of date DEFAULT public.programme_today())
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH progress AS (
    SELECT *
    FROM public.canonical_enrollment_progress(p_enrollment_id, p_as_of)
  ),
  eligible AS (
    SELECT
      p.enrollment_id,
      p.programme_id,
      p.cohort_id,
      p.programme_start_date
    FROM progress p
  ),
  schedule AS (
    SELECT
      e.enrollment_id,
      s.module,
      s.due_on,
      s.milestone_units,
      coalesce(tw.week_number, greatest(
        1,
        floor((s.due_on - e.programme_start_date)::numeric / 7)::integer + 1
      )) AS week_number
    FROM eligible e
    CROSS JOIN LATERAL public.sponsor_canonical_module_schedule(e.enrollment_id) s
    LEFT JOIN public.training_weeks tw ON tw.id = s.training_week_id
    WHERE s.due_on IS NOT NULL
  ),
  schedule_weeks AS (
    SELECT
      week_number,
      min(due_on) - 6 AS week_start,
      max(due_on) AS week_end,
      sum(milestone_units)::integer AS required_units
    FROM schedule
    GROUP BY week_number
  ),
  activity AS (
    SELECT
      e.enrollment_id,
      a.occurred_on,
      a.status,
      greatest(
        1,
        floor((a.occurred_on - e.programme_start_date)::numeric / 7)::integer + 1
      ) AS week_number
    FROM eligible e
    CROSS JOIN LATERAL public.sponsor_canonical_activity(e.enrollment_id) a
    WHERE a.occurred_on <= p_as_of
  ),
  weekly AS (
    SELECT
      sw.week_number,
      sw.week_start,
      sw.week_end,
      sw.required_units,
      least(
        sw.required_units,
        coalesce(sum(1) FILTER (WHERE a.status = 'completed'), 0)
      )::integer AS completed_units,
      coalesce(sum(1) FILTER (WHERE a.status = 'completed'), 0)::integer AS activity_units
    FROM schedule_weeks sw
    LEFT JOIN activity a ON a.week_number = sw.week_number
    GROUP BY sw.week_number, sw.week_start, sw.week_end, sw.required_units
  ),
  coaching AS (
    SELECT
      p.coaching_required_units AS required_units,
      p.coaching_completed_units AS completed_units,
      p.coaching_due_units AS due_units,
      p.coaching_booked_units AS booked_units,
      CASE
        WHEN p.coaching_required_units IS NULL OR p.coaching_required_units = 0 THEN NULL
        ELSE round(
          least(p.coaching_completed_units, p.coaching_required_units) * 100.0
          / p.coaching_required_units, 1
        )
      END AS utilisation_pct,
      (
        SELECT min(s.start_time)
        FROM public.sessions s
        WHERE s.enrollment_id = p.enrollment_id
          AND s.status IN ('pending_coach_approval', 'confirmed')
          AND s.start_time >= now()
      ) AS next_session_at
    FROM progress p
  )
  SELECT CASE
    WHEN NOT EXISTS (SELECT 1 FROM progress) THEN '{}'::jsonb
    ELSE jsonb_build_object(
      'weekly_participation',
      coalesce((
        SELECT jsonb_agg(jsonb_build_object(
          'week_number', w.week_number,
          'week_start', w.week_start,
          'week_end', w.week_end,
          'required_units', w.required_units,
          'due_units', CASE WHEN p_as_of >= w.week_end THEN w.required_units ELSE 0 END,
          'completed_units', w.completed_units,
          'activity_units', w.activity_units,
          'state', CASE
            WHEN p_as_of < w.week_start THEN 'upcoming'
            WHEN w.required_units > 0 AND w.completed_units >= w.required_units THEN 'completed'
            WHEN p_as_of <= w.week_end THEN 'current'
            ELSE 'overdue'
          END,
          'is_current', p_as_of >= w.week_start AND p_as_of <= w.week_end
        ) ORDER BY w.week_number)
        FROM weekly w
      ), '[]'::jsonb),
      -- 20261001120000: learning_breakdown is added by
      -- canonical_enrollment_experience (canonical_learning_breakdown).
      'coaching_utilisation',
      coalesce((SELECT to_jsonb(c) FROM coaching c), '{}'::jsonb)
    )
  END;
$function$;

CREATE OR REPLACE FUNCTION public.canonical_enrollment_experience(p_enrollment_id uuid, p_as_of date DEFAULT public.programme_today())
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  -- THE enrollment experience: weekly participation + coaching utilisation
  -- (canonical_enrollment_experience_base) with the canonical learning
  -- breakdown. Internal; Learner and Sponsor read it through wrappers.
  SELECT CASE
    WHEN base.payload = '{}'::jsonb THEN base.payload
    ELSE jsonb_set(
      base.payload,
      '{learning_breakdown}',
      public.canonical_learning_breakdown(p_enrollment_id, p_as_of),
      true
    )
  END
  FROM (SELECT public.canonical_enrollment_experience_base(p_enrollment_id, p_as_of) AS payload) base;
$function$;

CREATE OR REPLACE FUNCTION public.canonical_enrollment_progress(p_enrollment_id uuid, p_as_of date DEFAULT public.programme_today())
 RETURNS TABLE(enrollment_id uuid, learner_display_name text, programme_label text, cohort_id uuid, cohort_label text, programme_id uuid, enrollment_start_date date, enrollment_end_date date, programme_start_date date, programme_end_date date, enrollment_status enrollment_status, stored_enrollment_status enrollment_status, effective_enrollment_status enrollment_status, required_units integer, completed_units integer, due_units integer, booked_units integer, overdue_units integer, full_completion_pct numeric, due_adherence_pct numeric, pace_status text, progress_available boolean, coaching_required_units integer, coaching_completed_units integer, coaching_due_units integer, coaching_booked_units integer, training_required_units integer, training_completed_units integer, training_due_units integer, training_booked_units integer, peer_required_units integer, peer_completed_units integer, peer_due_units integer, peer_booked_units integer, mentoring_required_units integer, mentoring_completed_units integer, mentoring_due_units integer, mentoring_booked_units integer, triad_required_units integer, triad_completed_units integer, triad_due_units integer, triad_booked_units integer)
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
    c.triad_required_units, c.triad_completed_units, c.triad_due_units, c.triad_booked_units
  FROM calculated c;
$function$;

CREATE OR REPLACE FUNCTION public.canonical_enrollment_requirement_calendar(p_enrollment_id uuid, p_as_of date DEFAULT public.programme_today())
 RETURNS TABLE(enrollment_id uuid, programme_id uuid, cohort_id uuid, organization_id uuid, module programme_module_type, requirement_id uuid, requirement_index integer, requirement_label text, training_week_id uuid, due_on date, is_required boolean, is_due_as_of boolean, is_completed boolean, completed_on date, is_overdue boolean, completion_source text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH eff AS (
    SELECT coalesce(public.canonical_enrollment_effective_as_of(p_enrollment_id, p_as_of), p_as_of) AS as_of
  ), enrollment AS (
    SELECT e.id, e.programme_id, e.cohort_id, e.organization_id
    FROM public.programme_enrollments e
    JOIN public.cohorts c ON c.id = e.cohort_id
    WHERE e.id = p_enrollment_id
  ), session_units AS (
    SELECT pm.module, g.i AS ordinal
    FROM enrollment e
    JOIN public.programme_modules pm
      ON pm.programme_id = e.programme_id
     AND pm.enabled
     AND pm.module <> 'training'::public.programme_module_type
     AND coalesce((pm.config->>'required')::boolean, false)
    CROSS JOIN LATERAL generate_series(1, coalesce(public.programme_config_integer(pm.config, 'required_units'), 0)) g(i)
  ), fulfilment AS (
    SELECT f.requirement_id, f.fulfilled_on, 'coaching_session'::text AS source
    FROM public.canonical_coaching_requirement_fulfilment(p_enrollment_id) f
    UNION ALL
    SELECT f.requirement_id, f.fulfilled_on, 'mentoring_session'
    FROM public.canonical_mentoring_requirement_fulfilment(p_enrollment_id) f
    UNION ALL
    SELECT f.requirement_id, f.fulfilled_on, 'peer_session'
    FROM public.canonical_peer_requirement_fulfilment(p_enrollment_id) f
    UNION ALL
    SELECT f.cohort_requirement_date_id, f.fulfilled_on, 'triad_session'
    FROM public.canonical_triad_requirement_fulfilment(p_enrollment_id) f
  ), rows AS (
    SELECT u.module, d.id AS requirement_id, u.ordinal AS requirement_index,
      public.cohort_requirement_label(u.module, u.ordinal) AS requirement_label,
      NULL::uuid AS training_week_id, d.due_on,
      -- Counts only within [due_on - 14, effective as-of].
      CASE WHEN f.fulfilled_on BETWEEN public.canonical_session_requirement_available_on(d.due_on) AND (SELECT eff.as_of FROM eff)
        THEN f.fulfilled_on END AS completed_on,
      CASE WHEN f.fulfilled_on BETWEEN public.canonical_session_requirement_available_on(d.due_on) AND (SELECT eff.as_of FROM eff)
        THEN f.source END AS completion_source
    FROM session_units u
    CROSS JOIN enrollment e
    -- 20261001110000: only a requirement with its own stored date exists. A
    -- programme unit the cohort has not materialised is a schedule gap
    -- (requirement_integrity_issues), not a requirement nobody can complete.
    JOIN public.cohort_requirement_dates d
      ON d.cohort_id = e.cohort_id AND d.programme_id = e.programme_id
     AND d.module = u.module AND d.ordinal = u.ordinal
    LEFT JOIN fulfilment f ON f.requirement_id = d.id

    UNION ALL
    SELECT 'training'::public.programme_module_type, d.id,
      coalesce(d.ordinal, row_number() OVER (ORDER BY tw.week_number)::integer),
      public.cohort_requirement_label('training', coalesce(d.ordinal, tw.week_number), tw.week_number, tw.title),
      i.training_week_id, i.due_on,
      CASE WHEN i.completed_units > 0 THEN i.completed_on END,
      CASE WHEN i.completed_units > 0 THEN 'training_week' END
    FROM public.canonical_training_learning_items(p_enrollment_id, (SELECT eff.as_of FROM eff)) i
    CROSS JOIN enrollment e
    JOIN public.training_weeks tw ON tw.id = i.training_week_id
    JOIN public.cohort_requirement_dates d
      ON d.cohort_id = e.cohort_id AND d.programme_id = e.programme_id
     AND d.module = 'training'::public.programme_module_type AND d.training_week_id = i.training_week_id
  )
  SELECT e.id, e.programme_id, e.cohort_id, e.organization_id,
    r.module, r.requirement_id, r.requirement_index, r.requirement_label, r.training_week_id,
    r.due_on,
    true,
    r.due_on IS NOT NULL AND r.due_on <= (SELECT eff.as_of FROM eff),
    r.completed_on IS NOT NULL,
    r.completed_on,
    -- Overdue = the due date has PASSED and the requirement is still open.
    r.due_on IS NOT NULL AND r.due_on < (SELECT eff.as_of FROM eff) AND r.completed_on IS NULL,
    r.completion_source
  FROM rows r
  CROSS JOIN enrollment e
  ORDER BY r.module, r.requirement_index;
$function$;

CREATE OR REPLACE FUNCTION public.canonical_enrollment_requirement_status(p_enrollment_id uuid, p_as_of date DEFAULT public.programme_today())
 RETURNS TABLE(enrollment_id uuid, module programme_module_type, requirement_id uuid, requirement_index integer, requirement_label text, training_week_id uuid, available_on date, due_on date, completed_on date, effective_as_of date, state text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH eff AS (
    SELECT coalesce(public.canonical_enrollment_effective_as_of(p_enrollment_id, p_as_of), p_as_of) AS as_of
  ), availability AS (
    SELECT f.training_week_id, f.available_on
    FROM public.canonical_training_week_fulfilment(p_enrollment_id, p_as_of) f
  ), rows AS (
    SELECT c.enrollment_id, c.module, c.requirement_id, c.requirement_index, c.requirement_label,
      c.training_week_id, c.due_on, c.completed_on,
      CASE WHEN c.module = 'training'::public.programme_module_type
        THEN a.available_on
        ELSE public.canonical_session_requirement_available_on(c.due_on)
      END AS available_on
    FROM public.canonical_enrollment_requirement_calendar(p_enrollment_id, p_as_of) c
    LEFT JOIN availability a ON a.training_week_id = c.training_week_id
  )
  SELECT r.enrollment_id, r.module, r.requirement_id, r.requirement_index, r.requirement_label,
    r.training_week_id, r.available_on, r.due_on, r.completed_on, eff.as_of,
    CASE
      WHEN r.available_on IS NULL OR r.available_on > eff.as_of THEN 'upcoming'
      WHEN r.completed_on IS NOT NULL AND r.completed_on <= r.due_on THEN 'completed'
      WHEN r.completed_on IS NOT NULL THEN 'completed_late'
      WHEN r.due_on < eff.as_of THEN 'overdue'
      ELSE 'current'
    END
  FROM rows r
  CROSS JOIN eff
  ORDER BY r.due_on, r.module, r.requirement_index;
$function$;

CREATE OR REPLACE FUNCTION public.canonical_learning_breakdown(p_enrollment_id uuid, p_as_of date DEFAULT public.programme_today())
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH eff AS (
    SELECT coalesce(public.canonical_enrollment_effective_as_of(p_enrollment_id, p_as_of), p_as_of) AS as_of
  ), keys AS (
    SELECT * FROM (VALUES
      ('skill_cards'::text, 'Skill Cards'::text, 1),
      ('quizzes'::text, 'Quizzes'::text, 2),
      ('reflections'::text, 'Reflections'::text, 3),
      ('daily_prompts'::text, 'Daily Prompts'::text, 4)
    ) AS x(item_type, label, ord)
  ), grouped AS (
    SELECT k.item_type, k.label, k.ord,
      count(i.item_id)::integer AS required_units,
      count(i.item_id) FILTER (WHERE i.due_on IS NOT NULL AND i.due_on <= (SELECT eff.as_of FROM eff))::integer AS due_units,
      count(i.item_id) FILTER (WHERE i.completed AND i.due_on IS NOT NULL AND i.due_on <= (SELECT eff.as_of FROM eff))::integer AS completed_due_units,
      count(i.item_id) FILTER (WHERE i.completed)::integer AS completed_units,
      count(i.item_id) FILTER (WHERE NOT i.completed AND i.due_on IS NOT NULL AND i.due_on < (SELECT eff.as_of FROM eff))::integer AS overdue_units
    FROM keys k
    LEFT JOIN public.canonical_learning_items(p_enrollment_id, (SELECT eff.as_of FROM eff)) i ON i.item_type = k.item_type
    GROUP BY k.item_type, k.label, k.ord
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'key', g.item_type,
    'label', g.label,
    'required_units', g.required_units,
    'due_units', g.due_units,
    'completed_units', least(g.completed_units, g.required_units),
    'overdue_units', g.overdue_units,
    'progress_available', g.required_units > 0,
    'status', CASE
      WHEN g.required_units = 0 THEN 'unavailable'
      WHEN g.completed_units >= g.required_units THEN 'completed'
      WHEN g.due_units = 0 THEN 'upcoming'
      WHEN g.overdue_units > 0 THEN 'overdue'
      ELSE 'current'
    END
  ) ORDER BY g.ord), '[]'::jsonb)
  FROM grouped g;
$function$;

CREATE OR REPLACE FUNCTION public.canonical_learning_items(p_enrollment_id uuid, p_as_of date DEFAULT public.programme_today())
 RETURNS TABLE(training_week_id uuid, item_type text, item_id uuid, due_on date, completed boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH eff AS (
    SELECT coalesce(public.canonical_enrollment_effective_as_of(p_enrollment_id, p_as_of), p_as_of) AS as_of
  ), weeks AS (
    SELECT * FROM public.canonical_training_week_fulfilment(p_enrollment_id, (SELECT eff.as_of FROM eff))
  ), enrollment AS (
    SELECT e.id, e.programme_id
    FROM public.programme_enrollments e
    WHERE e.id = p_enrollment_id
  ), config AS (
    SELECT CASE
      WHEN jsonb_typeof(pm.config->'learning_components') = 'array'
        THEN pm.config->'learning_components'
      ELSE jsonb_build_array('skill_cards', 'reflections')
        || CASE WHEN EXISTS (
          SELECT 1 FROM public.programme_modules q
          WHERE q.programme_id = e.programme_id
            AND q.module = 'quiz'::public.programme_module_type
            AND q.enabled
            AND coalesce((q.config->>'required')::boolean, false)
        ) THEN jsonb_build_array('quizzes') ELSE '[]'::jsonb END
        || CASE WHEN EXISTS (
          SELECT 1 FROM public.programme_modules d
          WHERE d.programme_id = e.programme_id
            AND d.module = 'daily_prompt'::public.programme_module_type
            AND d.enabled
            AND coalesce((d.config->>'required')::boolean, false)
        ) THEN jsonb_build_array('daily_prompts') ELSE '[]'::jsonb END
    END AS components
    FROM enrollment e
    JOIN public.programme_modules pm
      ON pm.programme_id = e.programme_id
     AND pm.module = 'training'::public.programme_module_type
     AND pm.enabled
    LIMIT 1
  )
  SELECT w.training_week_id, 'skill_cards'::text, w.training_week_id, w.due_on,
    w.skill_card_completed
  FROM weeks w
  CROSS JOIN config c
  WHERE c.components ? 'skill_cards'

  UNION ALL
  SELECT w.training_week_id, 'quizzes'::text, a.id,
    w.available_on + coalesce(a.due_offset_days, 7),
    w.quiz_completed
  FROM weeks w
  CROSS JOIN config c
  JOIN public.assignments a
    ON a.training_week_id = w.training_week_id
   AND a.assignment_type = 'quiz'::public.assignment_type
   AND a.is_visible
  WHERE c.components ? 'quizzes'

  UNION ALL
  SELECT w.training_week_id, 'reflections'::text, pr.id,
    w.available_on + 6,
    w.reflection_completed
  FROM weeks w
  CROSS JOIN config c
  JOIN enrollment e ON true
  JOIN public.programme_reflections pr
    ON pr.programme_id = e.programme_id
   AND pr.appears_at_week = w.week_number
   AND pr.is_visible
  WHERE c.components ? 'reflections'

  UNION ALL
  SELECT w.training_week_id, 'daily_prompts'::text, dp.id,
    w.available_on + (coalesce(dp.day_offset, 1) - 1),
    (
      w.available_on IS NOT NULL
      AND w.available_on <= (SELECT eff.as_of FROM eff)
      AND EXISTS (
        SELECT 1
        FROM public.daily_prompt_responses dpr
        WHERE dpr.enrollment_id = p_enrollment_id
          AND dpr.daily_prompt_id = dp.id
          AND (dpr.responded_at AT TIME ZONE public.programme_time_zone())::date <= (SELECT eff.as_of FROM eff)
          AND (dpr.responded_at AT TIME ZONE public.programme_time_zone())::date >= w.available_on
      )
    )
  FROM weeks w
  CROSS JOIN config c
  JOIN public.daily_prompts dp
    ON dp.training_week_id = w.training_week_id
   AND dp.is_visible
  WHERE c.components ? 'daily_prompts';
$function$;

CREATE OR REPLACE FUNCTION public.canonical_mentoring_requirement_fulfilment(p_enrollment_id uuid)
 RETURNS TABLE(requirement_id uuid, ordinal integer, due_on date, fulfilled_on date, booked_on date, session_id uuid)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH enrollment AS (
    SELECT e.id, e.cohort_id, e.programme_id
    FROM public.programme_enrollments e WHERE e.id = p_enrollment_id
  ), requirements AS (
    SELECT d.id, d.ordinal, d.due_on
    FROM public.cohort_requirement_dates d
    JOIN enrollment e ON e.cohort_id = d.cohort_id AND e.programme_id = d.programme_id
    WHERE d.module = 'mentoring'::public.programme_module_type
  ), per_requirement AS (
    SELECT r.id AS requirement_id, r.ordinal, r.due_on,
      -- The single live-or-completed session by which THIS enrollment owns
      -- this requirement. The partial unique index guarantees at most one live
      -- session per learner per requirement; a completed one is terminal.
      (SELECT s.id FROM public.mentoring_sessions s
        WHERE s.cohort_requirement_id = r.id
          AND s.enrollment_id = p_enrollment_id
          AND s.status IN ('pending_coach_approval', 'confirmed', 'completed')
        -- 20261001110000: a completed session inside the window, then a
        -- live one, then (only when nothing else exists) one completed before
        -- the window -- it is kept visible but never counts or blocks.
        ORDER BY CASE WHEN s.status = 'completed' AND public.session_occupies_requirement(s.status, s.start_time, r.due_on) THEN 0
                      WHEN s.status <> 'completed' THEN 1 ELSE 2 END, s.start_time
        LIMIT 1) AS session_id
    FROM requirements r
  )
  SELECT pr.requirement_id, pr.ordinal, pr.due_on,
    -- A Mentoring requirement is fulfilled by a completed session. The
    -- preparation document, mentor feedback and mentee reflection are
    -- after-session evidence and gate nothing.
    CASE WHEN s.status = 'completed' THEN (s.start_time AT TIME ZONE public.programme_time_zone())::date END AS fulfilled_on,
    CASE WHEN s.id IS NOT NULL AND s.status <> 'completed'
         THEN (s.start_time AT TIME ZONE public.programme_time_zone())::date END AS booked_on,
    pr.session_id
  FROM per_requirement pr
  LEFT JOIN public.mentoring_sessions s ON s.id = pr.session_id
  ORDER BY pr.ordinal;
$function$;

CREATE OR REPLACE FUNCTION public.canonical_module_progress(p_enrollment_id uuid, p_as_of date DEFAULT public.programme_today())
 RETURNS TABLE(module programme_module_type, required_units integer, completed_activity_units integer, completed_units integer, due_units integer, booked_units integer, overdue_units integer, pace_status text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH calendar AS (
    SELECT * FROM public.canonical_enrollment_requirement_calendar(p_enrollment_id, p_as_of)
  ), modules AS (
    SELECT c.module,
      count(*)::integer AS required_units,
      count(*) FILTER (WHERE c.is_completed)::integer AS completed_units,
      count(*) FILTER (WHERE c.is_due_as_of)::integer AS due_units,
      count(*) FILTER (WHERE c.is_due_as_of AND c.is_completed)::integer AS completed_due_units,
      count(*) FILTER (WHERE c.is_overdue)::integer AS overdue_units
    FROM calendar c
    GROUP BY c.module
  ), activity AS (
    SELECT a.module,
      count(a.occurred_on) FILTER (WHERE a.status = 'completed' AND a.occurred_on <= p_as_of)::integer AS completed_activity_units,
      count(a.occurred_on) FILTER (
        WHERE a.status IN ('pending_coach_approval', 'confirmed') AND a.occurred_on >= p_as_of
      )::integer AS raw_booked_units
    FROM public.sponsor_canonical_activity(p_enrollment_id) a
    GROUP BY a.module
  ), values AS (
    SELECT m.module, m.required_units, m.completed_units, m.due_units, m.completed_due_units, m.overdue_units,
      CASE WHEN m.module = 'training' THEN m.completed_units
        ELSE greatest(coalesce(a.completed_activity_units, 0), m.completed_units) END::integer AS completed_activity_units,
      CASE WHEN m.module = 'training' THEN 0
        ELSE least(coalesce(a.raw_booked_units, 0), greatest(m.required_units - m.completed_units, 0))
      END::integer AS booked_units
    FROM modules m
    LEFT JOIN activity a ON a.module = m.module
  )
  SELECT v.module, v.required_units, v.completed_activity_units,
    least(v.completed_units, v.required_units)::integer,
    v.due_units, v.booked_units, v.overdue_units,
    CASE
      WHEN v.required_units = 0 OR v.completed_units >= v.required_units THEN 'completed'
      WHEN v.due_units = 0 THEN 'not_yet_due'
      WHEN v.completed_due_units >= v.due_units THEN
        CASE WHEN v.completed_units > v.due_units THEN 'ahead' ELSE 'on_track' END
      WHEN v.completed_due_units + v.booked_units >= v.due_units THEN 'scheduled'
      ELSE 'behind'
    END
  FROM values v
  ORDER BY v.module;
$function$;

CREATE OR REPLACE FUNCTION public.canonical_overdue_items(p_enrollment_id uuid, p_as_of date DEFAULT public.programme_today())
 RETURNS TABLE(module programme_module_type, overdue_units integer, due_units integer, oldest_due_on date)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT c.module,
    count(*) FILTER (WHERE c.is_overdue)::integer,
    count(*) FILTER (WHERE c.is_due_as_of)::integer,
    min(c.due_on) FILTER (WHERE c.is_overdue)
  FROM public.canonical_enrollment_requirement_calendar(p_enrollment_id, p_as_of) c
  GROUP BY c.module
  HAVING count(*) FILTER (WHERE c.is_overdue) > 0
  ORDER BY 4 NULLS LAST, 1;
$function$;

CREATE OR REPLACE FUNCTION public.canonical_peer_requirement_fulfilment(p_enrollment_id uuid)
 RETURNS TABLE(requirement_id uuid, ordinal integer, due_on date, fulfilled_on date, booked_on date, session_kind text, peer_session_id uuid)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH enrollment AS (
    SELECT e.id, e.cohort_id, e.programme_id
    FROM public.programme_enrollments e WHERE e.id = p_enrollment_id
  ), requirements AS (
    SELECT d.id, d.ordinal, d.due_on
    FROM public.cohort_requirement_dates d
    JOIN enrollment e ON e.cohort_id = d.cohort_id AND e.programme_id = d.programme_id
    WHERE d.module = 'peer_coaching'::public.programme_module_type
  ), attributed AS (
    -- The LIVE or completed DYAD participation this enrollment holds against
    -- each requirement. Practice from the Coach opt-in pool holds none
    -- (peer_practice_holds_no_requirement); a cancelled or rescheduled
    -- participation owns nothing, so the requirement reads as free.
    SELECT p.cohort_requirement_id AS requirement_id, p.session_kind, p.peer_session_id,
      p.session_status::text AS status, cps.start_time
    FROM public.peer_session_participants p
    JOIN public.coachee_peer_sessions cps ON cps.id = p.peer_session_id
    WHERE p.enrollment_id = p_enrollment_id
      AND p.session_kind = 'coachee_peer'
      AND p.cohort_requirement_id IS NOT NULL
      AND p.session_status IN ('pending_coach_approval'::public.session_status,
                               'confirmed'::public.session_status,
                               'completed'::public.session_status)
  )
  SELECT r.id, r.ordinal, r.due_on,
    -- A completed session is the completion evidence. Reflection, feedback,
    -- goals, actions and ratings are post-session artefacts and gate nothing.
    CASE WHEN a.status = 'completed' THEN (a.start_time AT TIME ZONE public.programme_time_zone())::date END,
    CASE WHEN a.status IN ('pending_coach_approval', 'confirmed')
         THEN (a.start_time AT TIME ZONE public.programme_time_zone())::date END,
    a.session_kind, a.peer_session_id
  FROM requirements r
  LEFT JOIN attributed a ON a.requirement_id = r.id
  ORDER BY r.ordinal;
$function$;

CREATE OR REPLACE FUNCTION public.canonical_training_learning_items(p_enrollment_id uuid, p_as_of date DEFAULT public.programme_today())
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
      greatest(
        f.skill_card_completed_at,
        f.quiz_completed_at,
        f.reflection_completed_at
      )::date
    END
  FROM public.canonical_training_week_fulfilment(p_enrollment_id, p_as_of) f;
$function$;

CREATE OR REPLACE FUNCTION public.canonical_training_learning_summary(p_enrollment_id uuid, p_as_of date DEFAULT public.programme_today())
 RETURNS TABLE(configured_required_units integer, required_units integer, completed_units integer, due_units integer, completed_due_units integer, overdue_units integer, requirement_mismatch boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH configured AS (
    SELECT coalesce(
      CASE
        WHEN coalesce((pm.config->>'required')::boolean, false)
        THEN public.programme_config_integer(pm.config, 'required_units')
        ELSE 0
      END,
      0
    )::integer AS configured_required_units
    FROM public.programme_enrollments e
    JOIN public.programme_modules pm
      ON pm.programme_id = e.programme_id
     AND pm.module = 'training'::public.programme_module_type
     AND pm.enabled
    WHERE e.id = p_enrollment_id
    ORDER BY pm.id
    LIMIT 1
  ), items AS (
    SELECT *
    FROM public.canonical_training_learning_items(p_enrollment_id, p_as_of)
  ), totals AS (
    SELECT
      coalesce(sum(i.required_units), 0)::integer AS required_units,
      coalesce(sum(i.completed_units), 0)::integer AS completed_units,
      coalesce(sum(i.required_units) FILTER (
        WHERE i.due_on <= p_as_of
      ), 0)::integer AS due_units,
      coalesce(sum(i.completed_units) FILTER (
        WHERE i.due_on <= p_as_of
      ), 0)::integer AS completed_due_units
    FROM items i
  )
  SELECT
    coalesce(c.configured_required_units, 0)::integer,
    t.required_units,
    least(t.completed_units, t.required_units)::integer,
    t.due_units,
    least(t.completed_due_units, t.due_units)::integer,
    greatest(0, t.due_units - least(t.completed_due_units, t.due_units))::integer,
    coalesce(c.configured_required_units, 0) <> t.required_units
  FROM totals t
  CROSS JOIN configured c;
$function$;

CREATE OR REPLACE FUNCTION public.canonical_training_week_fulfilment(p_enrollment_id uuid, p_as_of date DEFAULT public.programme_today())
 RETURNS TABLE(training_week_id uuid, week_number integer, due_on date, available_on date, unlock_on date, skill_card_required boolean, skill_card_completed boolean, skill_card_completed_at timestamp with time zone, quiz_required boolean, quiz_completed boolean, quiz_completed_at timestamp with time zone, reflection_required boolean, reflection_completed boolean, reflection_completed_at timestamp with time zone, daily_prompts_required integer, daily_prompts_completed integer, week_complete boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH eff AS (
    SELECT coalesce(public.canonical_enrollment_effective_as_of(p_enrollment_id, p_as_of), p_as_of) AS as_of
  ), enrollment AS (
    SELECT e.id, e.programme_id, e.cohort_id, c.start_date, c.end_date
    FROM public.programme_enrollments e
    JOIN public.cohorts c ON c.id = e.cohort_id
    WHERE e.id = p_enrollment_id
  ), configured AS (
    SELECT e.*,
      pm.config,
      CASE
        WHEN jsonb_typeof(pm.config->'learning_components') = 'array'
          THEN pm.config->'learning_components'
        ELSE jsonb_build_array('skill_cards', 'reflections')
          || CASE WHEN EXISTS (
            SELECT 1 FROM public.programme_modules q
            WHERE q.programme_id = e.programme_id
              AND q.module = 'quiz'::public.programme_module_type
              AND q.enabled
              AND coalesce((q.config->>'required')::boolean, false)
          ) THEN jsonb_build_array('quizzes') ELSE '[]'::jsonb END
          || CASE WHEN EXISTS (
            SELECT 1 FROM public.programme_modules d
            WHERE d.programme_id = e.programme_id
              AND d.module = 'daily_prompt'::public.programme_module_type
              AND d.enabled
              AND coalesce((d.config->>'required')::boolean, false)
          ) THEN jsonb_build_array('daily_prompts') ELSE '[]'::jsonb END
      END AS components
    FROM enrollment e
    JOIN public.programme_modules pm
      ON pm.programme_id = e.programme_id
     AND pm.module = 'training'::public.programme_module_type
     AND pm.enabled
     AND coalesce((pm.config->>'required')::boolean, false)
  ), selected AS (
    SELECT DISTINCT
      c.id AS enrollment_id,
      c.programme_id,
      c.cohort_id,
      tw.id AS training_week_id,
      tw.week_number,
      tw.is_visible,
      tw.skill_card_visible,
      coalesce(cwo.is_visible, true) AS override_visible,
      -- 20261001110000: the week's stored requirement date, never a computed
      -- stand-in. A week without a stored row is not a requirement (below).
      d.due_on AS due_on,
      -- Opens at its pacing date; with no pacing date at all, at its due date
      -- (previously the cohort END date, i.e. after it was due).
      least(
        c.end_date,
        coalesce(
          cwo.unlock_date,
          (c.start_date + ((tw.week_number - 1) * interval '7 days'))::date,
          tw.unlock_date,
          d.due_on
        )
      ) AS available_on,
      coalesce(cwo.unlock_date,
        (c.start_date + ((tw.week_number - 1) * interval '7 days'))::date,
        tw.unlock_date) AS unlock_on,
      c.components
    FROM configured c
    JOIN public.training_weeks tw ON tw.programme_id = c.programme_id
    LEFT JOIN LATERAL jsonb_array_elements_text(
      CASE
        WHEN jsonb_typeof(c.config->'distribution_settings'->'training_week_ids') = 'array'
          THEN c.config->'distribution_settings'->'training_week_ids'
        ELSE '[]'::jsonb
      END
    ) selected_week(week_id) ON true
    LEFT JOIN public.cohort_week_overrides cwo
      ON cwo.cohort_id = c.cohort_id
     AND cwo.training_week_id = tw.id
    JOIN public.cohort_requirement_dates d
      ON d.cohort_id = c.cohort_id
     AND d.programme_id = c.programme_id
     AND d.module = 'training'::public.programme_module_type
     AND d.training_week_id = tw.id
    WHERE jsonb_typeof(c.config->'distribution_settings'->'training_week_ids') IS DISTINCT FROM 'array'
       OR tw.id::text = selected_week.week_id
  ), quiz AS (
    SELECT
      s.training_week_id,
      count(a.id)::integer AS total,
      count(a.id) FILTER (
        WHERE sub.submitted_at IS NOT NULL
          AND (sub.submitted_at AT TIME ZONE public.programme_time_zone())::date <= (SELECT eff.as_of FROM eff)
          AND (sub.submitted_at AT TIME ZONE public.programme_time_zone())::date >= s.available_on
      )::integer AS completed,
      max(sub.submitted_at) FILTER (
        WHERE sub.submitted_at IS NOT NULL
          AND (sub.submitted_at AT TIME ZONE public.programme_time_zone())::date <= (SELECT eff.as_of FROM eff)
          AND (sub.submitted_at AT TIME ZONE public.programme_time_zone())::date >= s.available_on
      ) AS completed_at
    FROM selected s
    LEFT JOIN public.assignments a
      ON a.training_week_id = s.training_week_id
     AND a.assignment_type = 'quiz'::public.assignment_type
     AND a.is_visible
    LEFT JOIN public.assignment_submissions sub
      ON sub.assignment_id = a.id
     AND sub.enrollment_id = p_enrollment_id
    GROUP BY s.training_week_id
  ), reflection AS (
    SELECT
      s.training_week_id,
      count(pr.id)::integer AS total,
      count(pr.id) FILTER (
        WHERE rs.submitted_at IS NOT NULL
          AND (rs.submitted_at AT TIME ZONE public.programme_time_zone())::date <= (SELECT eff.as_of FROM eff)
          AND (rs.submitted_at AT TIME ZONE public.programme_time_zone())::date >= s.available_on
      )::integer AS completed,
      max(rs.submitted_at) FILTER (
        WHERE rs.submitted_at IS NOT NULL
          AND (rs.submitted_at AT TIME ZONE public.programme_time_zone())::date <= (SELECT eff.as_of FROM eff)
          AND (rs.submitted_at AT TIME ZONE public.programme_time_zone())::date >= s.available_on
      ) AS completed_at
    FROM selected s
    LEFT JOIN public.programme_reflections pr
      ON pr.programme_id = s.programme_id
     AND pr.appears_at_week = s.week_number
     AND pr.is_visible
    LEFT JOIN public.reflection_submissions rs
      ON rs.reflection_id = pr.id
     AND rs.enrollment_id = p_enrollment_id
    GROUP BY s.training_week_id
  ), prompts AS (
    SELECT
      s.training_week_id,
      count(dp.id)::integer AS total,
      count(dp.id) FILTER (
        WHERE dpr.responded_at IS NOT NULL
          AND (dpr.responded_at AT TIME ZONE public.programme_time_zone())::date <= (SELECT eff.as_of FROM eff)
          AND (dpr.responded_at AT TIME ZONE public.programme_time_zone())::date >= s.available_on
      )::integer AS completed
    FROM selected s
    LEFT JOIN public.daily_prompts dp
      ON dp.training_week_id = s.training_week_id
     AND dp.is_visible
    LEFT JOIN public.daily_prompt_responses dpr
      ON dpr.daily_prompt_id = dp.id
     AND dpr.enrollment_id = p_enrollment_id
    GROUP BY s.training_week_id
  ), values AS (
    SELECT
      s.training_week_id,
      s.week_number,
      s.due_on,
      s.available_on,
      s.unlock_on,
      (s.is_visible AND s.skill_card_visible AND s.override_visible) AS skill_card_required,
      tp.completed_at IS NOT NULL
        AND (tp.completed_at AT TIME ZONE public.programme_time_zone())::date <= (SELECT eff.as_of FROM eff)
        AND (tp.completed_at AT TIME ZONE public.programme_time_zone())::date >= s.available_on
        AND s.available_on IS NOT NULL
        AND s.available_on <= (SELECT eff.as_of FROM eff) AS skill_card_completed,
      CASE WHEN (tp.completed_at AT TIME ZONE public.programme_time_zone())::date BETWEEN s.available_on AND (SELECT eff.as_of FROM eff)
        THEN tp.completed_at END AS skill_card_completed_at,
      (s.components ? 'quizzes') AND coalesce(q.total, 0) > 0 AS quiz_required,
      (s.components ? 'quizzes')
        AND coalesce(q.total, 0) > 0
        AND coalesce(q.completed, 0) >= q.total
        AND s.available_on IS NOT NULL
        AND s.available_on <= (SELECT eff.as_of FROM eff) AS quiz_completed,
      q.completed_at AS quiz_completed_at,
      (s.components ? 'reflections') AND coalesce(r.total, 0) > 0 AS reflection_required,
      (s.components ? 'reflections')
        AND coalesce(r.total, 0) > 0
        AND coalesce(r.completed, 0) >= r.total
        AND s.available_on IS NOT NULL
        AND s.available_on <= (SELECT eff.as_of FROM eff) AS reflection_completed,
      r.completed_at AS reflection_completed_at,
      CASE WHEN s.components ? 'daily_prompts' THEN coalesce(p.total, 0) ELSE 0 END AS daily_prompts_required,
      CASE WHEN s.components ? 'daily_prompts' THEN coalesce(p.completed, 0) ELSE 0 END AS daily_prompts_completed
    FROM selected s
    LEFT JOIN public.training_progress tp
      ON tp.enrollment_id = p_enrollment_id
     AND tp.training_week_id = s.training_week_id
    LEFT JOIN quiz q ON q.training_week_id = s.training_week_id
    LEFT JOIN reflection r ON r.training_week_id = s.training_week_id
    LEFT JOIN prompts p ON p.training_week_id = s.training_week_id
    WHERE s.is_visible AND s.skill_card_visible AND s.override_visible
  )
  SELECT v.training_week_id,
    v.week_number,
    v.due_on,
    v.available_on,
    v.unlock_on,
    v.skill_card_required,
    v.skill_card_completed,
    v.skill_card_completed_at,
    v.quiz_required,
    v.quiz_completed,
    v.quiz_completed_at,
    v.reflection_required,
    v.reflection_completed,
    v.reflection_completed_at,
    v.daily_prompts_required,
    v.daily_prompts_completed,
    (
      v.skill_card_required AND v.skill_card_completed
      AND (NOT v.quiz_required OR v.quiz_completed)
      AND (NOT v.reflection_required OR v.reflection_completed)
    ) AS week_complete
  FROM values v
  ORDER BY v.week_number, v.training_week_id;
$function$;

CREATE OR REPLACE FUNCTION public.canonical_triad_completion(p_enrollment_id uuid, p_as_of date DEFAULT public.programme_today())
 RETURNS TABLE(enrollment_id uuid, programme_id uuid, cohort_id uuid, required_units integer, raw_completed_sessions integer, completed_by_as_of integer, completed_units integer, due_units integer, overdue_units integer, booked_units integer, pace_status text, next_due_on date, schedule jsonb)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH e AS (
    SELECT pe.id, pe.programme_id, pe.cohort_id FROM public.programme_enrollments pe WHERE pe.id = p_enrollment_id
  ), progress AS (
    SELECT p.* FROM public.canonical_module_progress(p_enrollment_id, p_as_of) p
    WHERE p.module = 'triads'::public.programme_module_type
  ), raw AS (
    SELECT count(DISTINCT s.id)::integer AS sessions
    FROM public.session_activity_attributions a
    JOIN public.triad_sessions s ON s.id = a.source_activity_id AND s.status = 'completed'
    WHERE a.enrollment_id = p_enrollment_id AND a.source_activity_type = 'triad' AND a.occurred_on <= p_as_of
  ), fulfil AS (
    SELECT f.*,
      (SELECT g.id FROM public.triad_groups g JOIN public.triad_group_members m ON m.triad_group_id = g.id
       WHERE g.cohort_requirement_date_id = f.cohort_requirement_date_id AND m.enrollment_id = p_enrollment_id
       ORDER BY g.is_active DESC, g.created_at DESC LIMIT 1) AS triad_group_id
    FROM public.canonical_triad_requirement_fulfilment(p_enrollment_id) f
  ), cal AS (
    -- Per-requirement state is the requirement calendar's (20261006130000):
    -- due = due_on <= as_of, overdue = due_on < as_of and still open.
    SELECT c.* FROM public.canonical_enrollment_requirement_calendar(p_enrollment_id, p_as_of) c
    WHERE c.module = 'triads'::public.programme_module_type
  )
  SELECT e.id, e.programme_id, e.cohort_id,
    coalesce(p.required_units, 0),
    r.sessions,
    coalesce(p.completed_activity_units, 0),
    coalesce(p.completed_units, 0),
    coalesce(p.due_units, 0),
    coalesce(p.overdue_units, 0),
    coalesce(p.booked_units, 0),
    coalesce(p.pace_status, 'not_required'),
    (SELECT min(c.due_on) FROM cal c WHERE NOT c.is_completed),
    coalesce((SELECT jsonb_agg(jsonb_build_object(
        'milestone', f.unit_number,
        'cohort_requirement_date_id', f.cohort_requirement_date_id,
        'due_on', f.due_on,
        'training_week_id', (SELECT d.training_week_id FROM public.cohort_requirement_dates d WHERE d.id = f.cohort_requirement_date_id),
        'is_due', coalesce(c.is_due_as_of, false),
        'fulfilled', coalesce(c.is_completed, false),
        -- this requirement is fulfilled (by its own group's session), never cumulative
        'satisfied', coalesce(c.is_completed, false),
        'fulfilled_on', c.completed_on,
        'overdue', coalesce(c.is_overdue, false),
        'triad_group_id', f.triad_group_id)
      ORDER BY f.unit_number)
      FROM fulfil f LEFT JOIN cal c ON c.requirement_id = f.cohort_requirement_date_id
      WHERE f.unit_number <= coalesce(p.required_units, 0)), '[]'::jsonb)
  FROM e
  CROSS JOIN raw r
  LEFT JOIN progress p ON true;
$function$;

CREATE OR REPLACE FUNCTION public.coach_canonical_enrollment_progress(p_enrollment_ids uuid[], p_as_of date DEFAULT public.programme_today())
 RETURNS TABLE(enrollment_id uuid, required_units integer, completed_units integer, due_units integer, overdue_units integer, full_completion_pct numeric, pace_status text, effective_enrollment_status enrollment_status, progress_available boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT p.enrollment_id, p.required_units, p.completed_units, p.due_units, p.overdue_units,
         p.full_completion_pct, p.pace_status, p.effective_enrollment_status, p.progress_available
  FROM (SELECT DISTINCT unnest(p_enrollment_ids) AS id) requested
  JOIN public.programme_enrollments e ON e.id = requested.id
  CROSS JOIN LATERAL public.canonical_enrollment_progress(requested.id, p_as_of) p
  WHERE auth.uid() IS NOT NULL
    AND (
      EXISTS (
        SELECT 1 FROM public.cohort_coach_assignments a
        WHERE a.cohort_id = e.cohort_id AND a.coach_id = auth.uid()
      )
      OR EXISTS (
        SELECT 1 FROM public.sessions s
        WHERE s.enrollment_id = requested.id
          AND s.coach_id = auth.uid()
          AND s.status IN ('confirmed', 'completed')
      )
    );
$function$;

CREATE OR REPLACE FUNCTION public.cohort_coaching_coach_pool(p_cohort_id uuid, p_as_of date DEFAULT public.programme_today())
 RETURNS TABLE(coach_id uuid)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT a.coach_id
  FROM public.cohort_coach_assignments a
  WHERE a.cohort_id = p_cohort_id
    AND a.is_active
    AND (a.active_from IS NULL OR a.active_from <= p_as_of)
    AND (a.active_until IS NULL OR a.active_until >= p_as_of);
$function$;

CREATE OR REPLACE FUNCTION public.cohort_mentoring_mentor_pool(p_cohort_id uuid, p_as_of date DEFAULT public.programme_today())
 RETURNS TABLE(mentor_user_id uuid)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  -- mentor_profiles is deliberately NOT consulted: a Mentor is a Coach with an
  -- assignment, and requiring a second provider record made a Coach with no
  -- mentor_profiles row unbookable however the Admin had assigned them.
  SELECT cm.mentor_user_id
  FROM public.cohort_mentors cm
  WHERE cm.cohort_id = p_cohort_id
    AND cm.is_active
    AND public.has_role(cm.mentor_user_id, 'coach'::public.app_role)
    AND (cm.active_from IS NULL OR cm.active_from <= p_as_of)
    AND (cm.active_until IS NULL OR cm.active_until >= p_as_of);
$function$;

CREATE OR REPLACE FUNCTION public.create_programme_enrollment(p_user_id uuid, p_programme_id uuid, p_cohort_id uuid, p_organization_id uuid, p_start_date date DEFAULT public.programme_today(), p_end_date date DEFAULT NULL::date)
 RETURNS programme_enrollments
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  existing public.programme_enrollments;
  result public.programme_enrollments;
  selected_cohort public.cohorts;
  effective_end_date date;
  effective_organization_id uuid;
begin
  if not public.has_role(auth.uid(), 'admin'::public.app_role) then
    raise exception 'Only an administrator can create enrolments' using errcode = '42501';
  end if;
  select * into selected_cohort from public.cohorts where id=p_cohort_id and programme_id=p_programme_id;
  if not found then
    raise exception 'The selected cohort does not belong to the selected programme' using errcode = 'P0001';
  end if;
  -- The enrollment's organisation is its own fact (sponsor visibility reads
  -- it); the cohort's organisation is only the default.
  effective_organization_id := coalesce(p_organization_id, selected_cohort.organization_id);
  effective_end_date := coalesce(p_end_date, selected_cohort.end_date);
  if effective_end_date is null then
    raise exception 'An enrollment end date is required to create its schedule snapshot' using errcode = 'P0001';
  end if;
  if (selected_cohort.start_date is not null and p_start_date < selected_cohort.start_date)
     or (selected_cohort.end_date is not null and effective_end_date > selected_cohort.end_date)
     or effective_end_date < p_start_date then
    raise exception 'Enrollment dates must fall within the cohort dates' using errcode = 'P0001';
  end if;
  -- Serialize enrollment attempts for one identity. The partial unique index
  -- remains the final race-safe guard even for callers that bypass this RPC.
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));
  select pe.* into existing from public.programme_enrollments pe
   where pe.user_id=p_user_id and pe.status in ('active','at_risk','paused') for update;
  if found then
    raise exception '%', jsonb_build_object(
      'code','ongoing_enrollment_exists','enrollment_id',existing.id,
      'programme_id',existing.programme_id,'cohort_id',existing.cohort_id,
      'status',existing.status,'start_date',existing.start_date,'end_date',existing.end_date
    )::text using errcode = 'P0001';
  end if;
  insert into public.programme_enrollments(user_id, programme_id, cohort_id, organization_id, start_date, end_date, status)
  values(p_user_id,p_programme_id,p_cohort_id,effective_organization_id,p_start_date,effective_end_date,'active') returning * into result;
  perform public.generate_enrollment_schedule(result.id);
  return result;
end $function$;

CREATE OR REPLACE FUNCTION public.enforce_minimum_active_goal()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_start date;
  v_result public.coachee_goals;
BEGIN
  -- A DELETE trigger must return OLD, an UPDATE trigger NEW.
  IF TG_OP = 'DELETE' THEN
    v_result := OLD;
  ELSE
    v_result := NEW;
  END IF;

  IF OLD.status IS DISTINCT FROM 'active' OR OLD.enrollment_id IS NULL THEN
    RETURN v_result;
  END IF;
  -- An update that keeps the goal active in the same enrollment is an edit.
  IF TG_OP = 'UPDATE'
     AND NEW.status = 'active'
     AND NEW.enrollment_id IS NOT DISTINCT FROM OLD.enrollment_id THEN
    RETURN NEW;
  END IF;
  -- The rule binds the learner. Admin and system writes (data repair,
  -- cascaded deletes) are exempt.
  IF v_actor IS NULL OR v_actor IS DISTINCT FROM OLD.coachee_id THEN
    RETURN v_result;
  END IF;
  -- Only an ongoing enrollment needs a goal to keep booking.
  IF NOT EXISTS (
    SELECT 1 FROM public.programme_enrollments e
    WHERE e.id = OLD.enrollment_id
      AND e.status IN ('active'::public.enrollment_status,
                       'at_risk'::public.enrollment_status,
                       'paused'::public.enrollment_status)
  ) THEN
    RETURN v_result;
  END IF;

  v_start := public.enrollment_goal_gate_start_date(OLD.enrollment_id);
  IF v_start IS NOT NULL AND public.programme_today() >= v_start + 7
     AND NOT EXISTS (
       SELECT 1 FROM public.coachee_goals g
       WHERE g.enrollment_id = OLD.enrollment_id
         AND g.status = 'active'
         AND g.id <> OLD.id
     ) THEN
    RAISE EXCEPTION 'last_active_goal_required'
      USING ERRCODE = 'P0001',
        DETAIL = jsonb_build_object('code', 'last_active_goal_required',
                                    'enrollment_id', OLD.enrollment_id,
                                    'goal_id', OLD.id)::text,
        HINT = 'Add another goal before removing your last active goal.';
  END IF;

  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.enrollment_coaching_coach_pool(p_enrollment_id uuid, p_as_of date DEFAULT public.programme_today())
 RETURNS TABLE(coach_id uuid)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT p.coach_id
  FROM public.programme_enrollments e
  CROSS JOIN LATERAL public.cohort_coaching_coach_pool(e.cohort_id, p_as_of) p
  WHERE e.id = p_enrollment_id;
$function$;

CREATE OR REPLACE FUNCTION public.enrollment_goal_gate_state(p_enrollment_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_start date;
  v_active integer;
  v_eligible boolean;
  v_opens date;
  v_due date;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.programme_enrollments e WHERE e.id = p_enrollment_id) THEN
    RETURN NULL;
  END IF;

  v_start := public.enrollment_goal_gate_start_date(p_enrollment_id);
  v_eligible := public.check_booking_eligibility(p_enrollment_id);
  SELECT p.opens_on, p.due_on INTO v_opens, v_due FROM public.enrollment_goal_setting_period(p_enrollment_id) p;
  SELECT count(*)::integer INTO v_active
  FROM public.coachee_goals g
  WHERE g.enrollment_id = p_enrollment_id AND g.status = 'active';

  RETURN jsonb_build_object(
    'enrollment_id', p_enrollment_id,
    'blocked', NOT v_eligible,
    'reason', CASE WHEN NOT v_eligible THEN 'goal_required_before_booking' END,
    'has_active_goal', v_eligible,
    'active_goal_count', v_active,
    'max_active_goals', 3,
    'gate_starts_on', v_start,
    'goal_setting_opens_on', v_opens,
    -- Compliance alert only; never part of the booking decision above.
    'goal_setup_deadline', v_due,
    'goal_setup_overdue', NOT v_eligible AND v_due IS NOT NULL AND public.programme_today() > v_due
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_enrollment_progress(p_enrollment_id uuid, p_as_of date DEFAULT public.programme_today())
 RETURNS TABLE(module programme_module_type, full_completion_pct numeric, due_adherence_pct numeric, pace_status text, completed_units integer, due_units integer, required_units integer, booked_units integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
WITH enrollment AS (
  SELECT e.*
  FROM public.programme_enrollments e
  WHERE e.id=p_enrollment_id
), authorized AS (
  SELECT 1
  FROM enrollment e
  WHERE e.user_id=auth.uid()
     OR public.has_role(auth.uid(),'admin'::public.app_role)
     OR public.coach_has_client(auth.uid(),e.user_id)
     OR public.sponsor_can_view_enrollment(e.id)
), snapshots AS (
  SELECT s.*
  FROM public.enrollment_module_snapshots s
  JOIN authorized ON true
  WHERE s.enrollment_id=p_enrollment_id
), activity AS (
  SELECT a.module,a.enrollment_id,coalesce(s.status::text,'completed') status,a.occurred_on
  FROM public.session_activity_attributions a
  JOIN public.sessions s ON s.id=a.source_activity_id
  WHERE a.enrollment_id=p_enrollment_id AND a.source_activity_type='coaching'
  UNION ALL
  SELECT a.module,a.enrollment_id,coalesce(s.status::text,'completed'),a.occurred_on
  FROM public.session_activity_attributions a
  JOIN public.peer_sessions s ON s.id=a.source_activity_id
  WHERE a.enrollment_id=p_enrollment_id AND a.source_activity_type='peer_coaching'
  UNION ALL
  SELECT a.module,a.enrollment_id,coalesce(s.status::text,'completed'),a.occurred_on
  FROM public.session_activity_attributions a
  JOIN public.coachee_peer_sessions s ON s.id=a.source_activity_id
  WHERE a.enrollment_id=p_enrollment_id AND a.source_activity_type='peer_coaching'
  UNION ALL
  SELECT a.module,a.enrollment_id,coalesce(s.status::text,'completed'),a.occurred_on
  FROM public.session_activity_attributions a
  JOIN public.mentoring_sessions s ON s.id=a.source_activity_id
  WHERE a.enrollment_id=p_enrollment_id AND a.source_activity_type='mentoring'
  UNION ALL
  SELECT a.module,a.enrollment_id,coalesce(s.status::text,'completed'),a.occurred_on
  FROM public.session_activity_attributions a
  JOIN public.triad_sessions s ON s.id=a.source_activity_id
  WHERE a.enrollment_id=p_enrollment_id AND a.source_activity_type='triad'
  UNION ALL
  SELECT a.module,a.enrollment_id,'completed',a.occurred_on
  FROM public.session_activity_attributions a
  WHERE a.enrollment_id=p_enrollment_id
    AND a.source_activity_type IN ('training','quiz','daily_prompt')
), counts AS (
  SELECT s.id,
    count(a.*) FILTER (
      WHERE a.status='completed' AND a.occurred_on<=p_as_of
    )::int completed,
    count(a.*) FILTER (
      WHERE a.status IN ('pending_coach_approval','confirmed')
        AND a.occurred_on>=p_as_of
    )::int raw_booked
  FROM snapshots s
  LEFT JOIN activity a
    ON a.enrollment_id=s.enrollment_id AND a.module=s.module
  GROUP BY s.id
), bounded_counts AS (
  SELECT id,completed,
    least(raw_booked,greatest(required_units-completed,0))::int booked
  FROM counts
  JOIN snapshots USING (id)
), due AS (
  SELECT s.id,
    coalesce(sum(m.required_units) FILTER (WHERE m.due_on<=p_as_of),0)::int units_due
  FROM snapshots s
  LEFT JOIN public.enrollment_module_milestones m
    ON m.enrollment_module_snapshot_id=s.id
  GROUP BY s.id
)
SELECT s.module,
  CASE WHEN s.required_units=0 THEN NULL
       ELSE round(least(c.completed,s.required_units)*100.0/s.required_units,1)
  END,
  CASE WHEN d.units_due=0 THEN NULL
       ELSE round(least(c.completed,d.units_due)*100.0/d.units_due,1)
  END,
  CASE
    WHEN s.required_units=0 OR c.completed>=s.required_units THEN 'completed'
    WHEN d.units_due=0 THEN 'not_yet_due'
    WHEN c.completed>=d.units_due THEN
      CASE WHEN c.completed>d.units_due THEN 'ahead' ELSE 'on_track' END
    WHEN c.completed+c.booked>=d.units_due THEN 'scheduled'
    ELSE 'behind'
  END,
  c.completed,d.units_due,s.required_units,c.booked
FROM snapshots s
JOIN bounded_counts c ON c.id=s.id
JOIN due d ON d.id=s.id;
$function$;

CREATE OR REPLACE FUNCTION public.get_enrollment_training_weeks(p_enrollment_id uuid)
 RETURNS TABLE(id uuid, week_number integer, title text, title_vi text, subtitle text, subtitle_vi text, unlock_date date, effective_unlock_date date, locked boolean, skill_card_visible boolean, viewed_at timestamp with time zone, completed_at timestamp with time zone, requirement_id uuid, requirement_due_on date, requirement_state text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH enrollment AS (
    SELECT pe.id, pe.programme_id, pe.cohort_id, pe.start_date
    FROM public.programme_enrollments pe
    WHERE pe.id = p_enrollment_id AND pe.user_id = auth.uid()
  ), training AS (
    SELECT e.*, pm.config
    FROM enrollment e
    JOIN public.programme_modules pm
      ON pm.programme_id = e.programme_id
     AND pm.module = 'training'::public.programme_module_type
     AND pm.enabled
  ), weeks AS (
    SELECT t.id AS enrollment_id, t.cohort_id, t.start_date, tw.*
    FROM training t
    JOIN public.training_weeks tw ON tw.programme_id = t.programme_id
    WHERE jsonb_typeof(t.config->'distribution_settings'->'training_week_ids') IS DISTINCT FROM 'array'
       OR (t.config->'distribution_settings'->'training_week_ids') ? tw.id::text
  ), calendar AS (
    SELECT c.training_week_id, c.requirement_id, c.due_on, c.state
    FROM public.canonical_enrollment_requirement_status(p_enrollment_id, public.programme_today()) c
    WHERE c.module = 'training'::public.programme_module_type
  ), fulfilment AS (
    SELECT * FROM public.canonical_training_week_fulfilment(p_enrollment_id, public.programme_today())
  )
  SELECT w.id, w.week_number, w.title, w.title_vi, w.subtitle, w.subtitle_vi, w.unlock_date,
    f.available_on,
    coalesce(f.available_on, cwo.unlock_date,
      CASE WHEN w.cohort_id IS NOT NULL
        THEN (w.start_date + ((w.week_number - 1) * interval '7 days'))::date
      END,
      w.unlock_date) > public.programme_today(),
    w.skill_card_visible,
    tp.viewed_at,
    CASE WHEN f.week_complete THEN greatest(
      f.skill_card_completed_at, f.quiz_completed_at, f.reflection_completed_at
    ) END,
    cal.requirement_id, cal.due_on,
    CASE
      WHEN cal.training_week_id IS NULL THEN 'not_required'
      ELSE cal.state
    END
  FROM weeks w
  LEFT JOIN public.cohort_week_overrides cwo
    ON cwo.cohort_id = w.cohort_id AND cwo.training_week_id = w.id
  LEFT JOIN public.training_progress tp
    ON tp.training_week_id = w.id AND tp.enrollment_id = w.enrollment_id
  LEFT JOIN calendar cal ON cal.training_week_id = w.id
  LEFT JOIN fulfilment f ON f.training_week_id = w.id
  WHERE w.is_visible = true AND coalesce(cwo.is_visible, true)
  ORDER BY w.week_number;
$function$;

CREATE OR REPLACE FUNCTION public.get_mentors_for_enrollment(p_enrollment_id uuid, p_as_of date DEFAULT public.programme_today())
 RETURNS TABLE(mentor_user_id uuid, full_name text, avatar_url text, bio text, expertise_tags text[])
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_cohort uuid;
BEGIN
  SELECT e.cohort_id INTO v_cohort
  FROM public.programme_enrollments e
  WHERE e.id = p_enrollment_id
    AND (e.user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'::public.app_role));

  -- No row means the enrollment does not exist or is not the caller's. Return
  -- nothing rather than raising, so the two cases are indistinguishable to a
  -- prober.
  IF v_cohort IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT p.mentor_user_id, pr.full_name, pr.avatar_url, pr.bio, cp.specialties
  FROM public.cohort_mentoring_mentor_pool(v_cohort, p_as_of) p
  LEFT JOIN public.profiles pr ON pr.id = p.mentor_user_id
  LEFT JOIN public.coach_profiles cp ON cp.id = p.mentor_user_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_my_training_weeks()
 RETURNS TABLE(id uuid, week_number integer, title text, title_vi text, subtitle text, subtitle_vi text, unlock_date date, effective_unlock_date date, locked boolean, skill_card_visible boolean, viewed_at timestamp with time zone, completed_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    tw.id,
    tw.week_number,
    tw.title,
    tw.title_vi,
    tw.subtitle,
    tw.subtitle_vi,
    tw.unlock_date,
    COALESCE(
      cwo.unlock_date,
      CASE WHEN pe.cohort_id IS NOT NULL
        THEN (pe.start_date + ((tw.week_number - 1) * INTERVAL '7 days'))::date
        ELSE NULL
      END,
      tw.unlock_date
    ) AS effective_unlock_date,
    COALESCE(
      cwo.unlock_date,
      CASE WHEN pe.cohort_id IS NOT NULL
        THEN (pe.start_date + ((tw.week_number - 1) * INTERVAL '7 days'))::date
        ELSE NULL
      END,
      tw.unlock_date
    ) > public.programme_today() AS locked,
    tw.skill_card_visible,
    tp.viewed_at,
    tp.completed_at
  FROM public.programme_enrollments pe
  JOIN public.training_weeks tw ON tw.programme_id = pe.programme_id
  LEFT JOIN public.cohort_week_overrides cwo
    ON cwo.cohort_id = pe.cohort_id AND cwo.training_week_id = tw.id
  LEFT JOIN public.training_progress tp ON tp.training_week_id = tw.id AND tp.user_id = auth.uid()
  WHERE pe.user_id = auth.uid()
    AND pe.status = 'active'
    AND tw.is_visible = true
    AND public.has_programme_module('training'::programme_module_type)
  ORDER BY tw.week_number;
$function$;

CREATE OR REPLACE FUNCTION public.get_sponsor_programme_journey(p_cohort_id uuid, p_as_of date DEFAULT public.programme_today())
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH eligible AS (
    SELECT v.enrollment_id AS id
    FROM public.sponsor_visible_enrollments() v
    WHERE v.cohort_id = p_cohort_id
  ), requirements AS (
    SELECT r.*
    FROM eligible e
    CROSS JOIN LATERAL public.canonical_enrollment_requirement_status(e.id, p_as_of) r
    WHERE r.due_on IS NOT NULL
  ), dates AS (
    SELECT r.due_on,
      string_agg(DISTINCT tw.title, ' · ' ORDER BY tw.title)
        FILTER (WHERE tw.title IS NOT NULL) AS label,
      to_jsonb(array_agg(DISTINCT r.module::text ORDER BY r.module::text)) AS module_scope
    FROM requirements r
    LEFT JOIN public.training_weeks tw ON tw.id = r.training_week_id
    GROUP BY r.due_on
  ), leader_checkpoints AS (
    SELECT d.due_on, e.id AS enrollment_id,
      count(r.*) FILTER (WHERE r.due_on <= d.due_on)::integer AS required_units,
      count(r.*) FILTER (WHERE r.due_on <= d.due_on AND r.completed_on IS NOT NULL)::integer AS completed_units,
      coalesce(bool_or(r.state = 'completed_late') FILTER (WHERE r.due_on = d.due_on), false) AS has_late,
      coalesce(bool_or(r.state <> 'upcoming')
        FILTER (WHERE r.due_on <= d.due_on AND r.completed_on IS NULL), false) AS has_available_open,
      coalesce(bool_or(r.state = 'upcoming')
        FILTER (WHERE r.due_on <= d.due_on AND r.completed_on IS NULL), false) AS has_unavailable_open,
      max(r.effective_as_of) AS effective_as_of
    FROM dates d
    CROSS JOIN eligible e
    LEFT JOIN requirements r ON r.enrollment_id = e.id
    GROUP BY d.due_on, e.id
  ), leader_states AS (
    SELECT l.*,
      CASE
        WHEN l.required_units > 0 AND l.completed_units >= l.required_units
          THEN CASE WHEN l.has_late THEN 'completed_late' ELSE 'completed' END
        WHEN l.due_on < l.effective_as_of AND l.has_available_open THEN 'overdue'
        WHEN l.has_unavailable_open THEN 'upcoming'
        ELSE 'current'
      END AS state
    FROM leader_checkpoints l
  ), totals AS (
    SELECT d.due_on, d.label, d.module_scope,
      sum(l.required_units)::integer AS required_units,
      sum(l.completed_units)::integer AS completed_units,
      count(*)::integer AS total_leaders,
      count(*) FILTER (WHERE l.state IN ('completed', 'completed_late'))::integer AS completed_leaders,
      bool_and(l.state IN ('completed', 'completed_late')) AS all_complete,
      bool_or(l.state = 'completed_late') AS any_late,
      bool_or(l.state = 'overdue') AS any_overdue,
      bool_or(l.state = 'upcoming') AS any_upcoming
    FROM dates d
    JOIN leader_states l ON l.due_on = d.due_on
    GROUP BY d.due_on, d.label, d.module_scope
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'checkpoint_number', n,
    'due_on', due_on,
    'label', label,
    'module_scope', module_scope,
    'required_units', required_units,
    'completed_units', completed_units,
    'completed_leaders', completed_leaders,
    'total_leaders', total_leaders,
    'state', CASE
      WHEN all_complete THEN CASE WHEN any_late THEN 'completed_late' ELSE 'completed' END
      WHEN any_overdue THEN 'overdue'
      WHEN any_upcoming THEN 'upcoming'
      ELSE 'current'
    END
  ) ORDER BY due_on), '[]'::jsonb)
  FROM (
    SELECT row_number() OVER (ORDER BY due_on)::integer AS n, t.*
    FROM totals t
  ) numbered;
$function$;

CREATE OR REPLACE FUNCTION public.get_sponsor_programme_progress(p_enrollment_id uuid, p_as_of date DEFAULT public.programme_today())
 RETURNS TABLE(module programme_module_type, required_units integer, completed_activity_units integer, completed_units integer, due_units integer, booked_units integer, pace_status text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT module, required_units, completed_activity_units, completed_units,
    due_units, booked_units, pace_status
  FROM public.canonical_module_progress(p_enrollment_id, p_as_of);
$function$;

CREATE OR REPLACE FUNCTION public.learner_canonical_experience(p_enrollment_id uuid, p_as_of date DEFAULT public.programme_today())
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT CASE
    WHEN EXISTS (
      SELECT 1 FROM public.programme_enrollments e
      WHERE e.id = p_enrollment_id AND e.user_id = auth.uid() AND auth.uid() IS NOT NULL
    )
    THEN public.canonical_enrollment_experience(p_enrollment_id, p_as_of)
    ELSE '{}'::jsonb
  END;
$function$;

CREATE OR REPLACE FUNCTION public.learner_canonical_journey(p_enrollment_id uuid, p_as_of date DEFAULT public.programme_today())
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  -- Learner self-view: own enrollment only. Same construction as Sponsor.
  SELECT CASE
    WHEN EXISTS (
      SELECT 1 FROM public.programme_enrollments e
      WHERE e.id = p_enrollment_id
        AND e.user_id = auth.uid()
        AND auth.uid() IS NOT NULL
        AND e.cohort_id IS NOT NULL
    )
    THEN public.canonical_enrollment_journey(p_enrollment_id, p_as_of)
    ELSE '[]'::jsonb
  END;
$function$;

CREATE OR REPLACE FUNCTION public.learner_canonical_module_progress(p_enrollment_id uuid, p_as_of date DEFAULT public.programme_today())
 RETURNS TABLE(module programme_module_type, required_units integer, completed_units integer, due_units integer, booked_units integer, pace_status text, full_completion_pct numeric, due_adherence_pct numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH eligible AS (
    SELECT e.id
    FROM public.programme_enrollments e
    WHERE e.id = p_enrollment_id
      AND e.user_id = auth.uid()
      AND auth.uid() IS NOT NULL
  )
  SELECT g.module, g.required_units, g.completed_units, g.due_units, g.booked_units,
    g.pace_status,
    CASE WHEN g.required_units = 0 THEN NULL
      ELSE round(least(g.completed_units, g.required_units) * 100.0 / g.required_units, 1)
    END,
    CASE WHEN g.due_units = 0 THEN NULL
      ELSE round(least(g.completed_units, g.due_units) * 100.0 / g.due_units, 1)
    END
  FROM eligible e
  CROSS JOIN LATERAL public.get_sponsor_programme_progress(e.id, p_as_of) g
  ORDER BY g.module;
$function$;

CREATE OR REPLACE FUNCTION public.learner_canonical_overdue_items(p_enrollment_id uuid, p_as_of date DEFAULT public.programme_today())
 RETURNS TABLE(module programme_module_type, overdue_units integer, due_units integer, oldest_due_on date)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  -- Learner self-view: own enrollment only.
  SELECT o.*
  FROM public.programme_enrollments e
  CROSS JOIN LATERAL public.canonical_overdue_items(e.id, p_as_of) o
  WHERE e.id = p_enrollment_id
    AND e.user_id = auth.uid()
    AND auth.uid() IS NOT NULL;
$function$;

CREATE OR REPLACE FUNCTION public.learner_canonical_progress(p_enrollment_id uuid, p_as_of date DEFAULT public.programme_today())
 RETURNS TABLE(enrollment_id uuid, learner_display_name text, programme_label text, cohort_id uuid, cohort_label text, programme_id uuid, enrollment_start_date date, enrollment_end_date date, programme_start_date date, programme_end_date date, enrollment_status enrollment_status, stored_enrollment_status enrollment_status, effective_enrollment_status enrollment_status, required_units integer, completed_units integer, due_units integer, booked_units integer, overdue_units integer, full_completion_pct numeric, due_adherence_pct numeric, pace_status text, progress_available boolean, coaching_required_units integer, coaching_completed_units integer, coaching_due_units integer, coaching_booked_units integer, training_required_units integer, training_completed_units integer, training_due_units integer, training_booked_units integer, peer_required_units integer, peer_completed_units integer, peer_due_units integer, peer_booked_units integer, mentoring_required_units integer, mentoring_completed_units integer, mentoring_due_units integer, mentoring_booked_units integer, triad_required_units integer, triad_completed_units integer, triad_due_units integer, triad_booked_units integer)
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

CREATE OR REPLACE FUNCTION public.learner_enrollment_context(p_enrollment_id uuid)
 RETURNS TABLE(enrollment_id uuid, user_id uuid, programme_id uuid, programme_name text, cohort_id uuid, cohort_name text, organization_id uuid, organization_name text, stored_enrollment_status enrollment_status, effective_enrollment_status enrollment_status, is_ongoing boolean, start_date date, end_date date)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT e.id, e.user_id, e.programme_id, p.name, e.cohort_id, c.name,
    e.organization_id, o.name, e.status, cp.effective_enrollment_status,
    e.status IN ('active', 'at_risk', 'paused'),
    cp.enrollment_start_date, cp.enrollment_end_date
  FROM public.programme_enrollments e
  LEFT JOIN public.programmes p ON p.id = e.programme_id
  LEFT JOIN public.cohorts c ON c.id = e.cohort_id
  LEFT JOIN public.organizations o ON o.id = e.organization_id
  LEFT JOIN LATERAL public.canonical_enrollment_progress(e.id, public.programme_today()) cp ON true
  WHERE e.id = p_enrollment_id
    AND e.user_id = auth.uid();
$function$;

CREATE OR REPLACE FUNCTION public.learner_module_progress(p_enrollment_id uuid, p_as_of date DEFAULT public.programme_today())
 RETURNS TABLE(module programme_module_type, required_units integer, completed_units integer, completed_activity_units integer, due_units integer, booked_units integer, overdue_units integer, pace_status text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT g.module, g.required_units, g.completed_units, g.completed_activity_units,
         g.due_units, g.booked_units, g.overdue_units, g.pace_status
  FROM public.programme_enrollments e
  CROSS JOIN LATERAL public.canonical_module_progress(e.id, p_as_of) g
  WHERE e.id = p_enrollment_id
    AND e.user_id = auth.uid()
    AND auth.uid() IS NOT NULL
  ORDER BY g.module;
$function$;

CREATE OR REPLACE FUNCTION public.learner_requirement_calendar(p_enrollment_id uuid, p_as_of date DEFAULT public.programme_today())
 RETURNS TABLE(enrollment_id uuid, programme_id uuid, cohort_id uuid, organization_id uuid, module programme_module_type, requirement_id uuid, requirement_index integer, requirement_label text, training_week_id uuid, due_on date, is_required boolean, is_due_as_of boolean, is_completed boolean, completed_on date, is_overdue boolean, completion_source text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT c.* FROM public.canonical_enrollment_requirement_calendar(p_enrollment_id, p_as_of) c
  WHERE EXISTS (SELECT 1 FROM public.programme_enrollments e WHERE e.id = p_enrollment_id AND e.user_id = auth.uid());
$function$;

CREATE OR REPLACE FUNCTION public.learner_training_week_items(p_enrollment_id uuid, p_as_of date DEFAULT public.programme_today())
 RETURNS TABLE(training_week_id uuid, item_type text, required_units integer, completed_units integer, due_units integer, overdue_units integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH eff AS (
    SELECT coalesce(public.canonical_enrollment_effective_as_of(p_enrollment_id, p_as_of), p_as_of) AS as_of
  ), weeks AS (
    SELECT f.training_week_id
    FROM public.canonical_training_week_fulfilment(p_enrollment_id, (SELECT eff.as_of FROM eff)) f
    JOIN public.programme_enrollments e ON e.id = p_enrollment_id
    WHERE e.user_id = auth.uid()
  ), keys AS (
    SELECT * FROM (VALUES
      ('skill_cards'::text),
      ('quizzes'::text),
      ('reflections'::text),
      ('daily_prompts'::text)
    ) AS x(item_type)
  ), grouped AS (
    SELECT w.training_week_id, k.item_type,
      count(i.item_id)::integer AS required_units,
      count(i.item_id) FILTER (WHERE i.completed)::integer AS completed_units,
      count(i.item_id) FILTER (WHERE i.due_on IS NOT NULL AND i.due_on <= (SELECT eff.as_of FROM eff))::integer AS due_units,
      count(i.item_id) FILTER (
        WHERE i.due_on IS NOT NULL AND i.due_on < (SELECT eff.as_of FROM eff) AND NOT i.completed
      )::integer AS overdue_units
    FROM weeks w
    CROSS JOIN keys k
    LEFT JOIN public.canonical_learning_items(p_enrollment_id, (SELECT eff.as_of FROM eff)) i
      ON i.training_week_id = w.training_week_id
     AND i.item_type = k.item_type
    GROUP BY w.training_week_id, k.item_type
  )
  SELECT * FROM grouped
  ORDER BY training_week_id,
    CASE item_type
      WHEN 'skill_cards' THEN 1
      WHEN 'quizzes' THEN 2
      WHEN 'reflections' THEN 3
      ELSE 4
    END;
$function$;

CREATE OR REPLACE FUNCTION public.learner_triad_status(p_enrollment_id uuid)
 RETURNS TABLE(enrollment_id uuid, required_units integer, raw_completed_sessions integer, completed_units integer, due_units integer, overdue_units integer, booked_units integer, pace_status text, next_due_on date, schedule jsonb)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT c.enrollment_id, c.required_units, c.raw_completed_sessions, c.completed_units, c.due_units,
    c.overdue_units, c.booked_units, c.pace_status, c.next_due_on, c.schedule
  FROM public.programme_enrollments e
  CROSS JOIN LATERAL public.canonical_triad_completion(e.id, public.programme_today()) c
  WHERE e.id = p_enrollment_id AND e.user_id = auth.uid() AND auth.uid() IS NOT NULL;
$function$;

CREATE OR REPLACE FUNCTION public.reattribute_activity_on_reschedule()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_module text;
BEGIN
  IF NEW.enrollment_id IS NULL THEN
    RETURN NEW;
  END IF;

  v_module := CASE TG_TABLE_NAME
    WHEN 'sessions' THEN 'coaching'
    WHEN 'mentoring_sessions' THEN 'mentoring'
    WHEN 'peer_sessions' THEN 'peer_coaching'
    WHEN 'coachee_peer_sessions' THEN 'peer_coaching'
  END;
  IF v_module IS NULL THEN
    RETURN NEW;
  END IF;

  -- Clear the stale attribution so the helper's ON CONFLICT DO NOTHING no
  -- longer suppresses the rewrite, then let it re-derive occurred_on and the
  -- milestone from the new date.
  DELETE FROM public.session_activity_attributions a
  WHERE a.enrollment_id = NEW.enrollment_id
    AND a.source_activity_type = v_module
    AND a.source_activity_id = NEW.id;

  PERFORM public.attribute_activity_to_cadence_milestone(
    NEW.enrollment_id, v_module, NEW.id, (NEW.start_time AT TIME ZONE public.programme_time_zone())::date);

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.session_occupies_requirement(p_status session_status, p_start_time timestamp with time zone, p_due_on date)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT p_status IN ('pending_coach_approval'::public.session_status, 'confirmed'::public.session_status)
      OR (p_status = 'completed'::public.session_status
          AND (p_start_time AT TIME ZONE public.programme_time_zone())::date >= public.canonical_session_requirement_available_on(p_due_on));
$function$;

CREATE OR REPLACE FUNCTION public.sponsor_canonical_activity(p_enrollment_id uuid)
 RETURNS TABLE(module programme_module_type, occurred_on date, status text, requirement_due_on date)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT 'coaching'::public.programme_module_type,
    coalesce(f.fulfilled_on, f.booked_on),
    CASE WHEN f.fulfilled_on IS NOT NULL THEN 'completed' ELSE 'confirmed' END,
    f.due_on
  FROM public.canonical_coaching_requirement_fulfilment(p_enrollment_id) f
  WHERE coalesce(f.fulfilled_on, f.booked_on) IS NOT NULL

  UNION ALL
  -- Peer: one row per cohort Peer requirement, never one per session.
  SELECT 'peer_coaching'::public.programme_module_type,
    coalesce(f.fulfilled_on, f.booked_on),
    CASE WHEN f.fulfilled_on IS NOT NULL THEN 'completed' ELSE 'confirmed' END,
    f.due_on
  FROM public.canonical_peer_requirement_fulfilment(p_enrollment_id) f
  WHERE coalesce(f.fulfilled_on, f.booked_on) IS NOT NULL

  UNION ALL
  SELECT 'mentoring'::public.programme_module_type,
    coalesce(f.fulfilled_on, f.booked_on),
    CASE WHEN f.fulfilled_on IS NOT NULL THEN 'completed' ELSE 'confirmed' END,
    f.due_on
  FROM public.canonical_mentoring_requirement_fulfilment(p_enrollment_id) f
  WHERE coalesce(f.fulfilled_on, f.booked_on) IS NOT NULL

  UNION ALL
  SELECT 'triads'::public.programme_module_type,
    coalesce(f.fulfilled_on, f.booked_on, f.proposed_on),
    CASE WHEN f.fulfilled_on IS NOT NULL THEN 'completed'
         WHEN f.booked_on IS NOT NULL THEN 'confirmed'
         ELSE 'proposed' END,
    f.due_on
  FROM public.canonical_triad_requirement_fulfilment(p_enrollment_id) f
  WHERE coalesce(f.fulfilled_on, f.booked_on, f.proposed_on) IS NOT NULL

  UNION ALL
  SELECT a.module, a.occurred_on, 'completed', NULL::date
  FROM public.session_activity_attributions a
  WHERE a.enrollment_id = p_enrollment_id
    AND a.source_activity_type IN ('quiz', 'daily_prompt')

  UNION ALL
  SELECT 'training'::public.programme_module_type,
    i.completed_on,
    'completed',
    NULL::date
  FROM public.canonical_training_learning_items(p_enrollment_id, public.programme_today()) i
  WHERE i.completed_units > 0
    AND i.completed_on IS NOT NULL;
$function$;

CREATE OR REPLACE FUNCTION public.sponsor_canonical_cohort_progress_one(p_cohort_id uuid, p_as_of date DEFAULT public.programme_today())
 RETURNS TABLE(cohort_id uuid, cohort_label text, programme_label text, programme_start_date date, programme_end_date date, enrollment_count integer, suppressed boolean, required_units integer, completed_units integer, due_units integer, booked_units integer, overdue_units integer, full_completion_pct numeric, due_adherence_pct numeric, schedule_coverage_pct numeric, pace_status text, active_count integer, at_risk_count integer, paused_count integer, completed_count integer, not_yet_due_count integer, ahead_count integer, on_track_count integer, scheduled_count integer, behind_count integer, completed_pace_count integer, on_track_pct numeric, coaching_required_units integer, coaching_completed_units integer, coaching_due_units integer, coaching_booked_units integer, coaching_completed_leaders integer, training_required_units integer, training_completed_units integer, training_due_units integer, training_booked_units integer, training_completed_leaders integer, peer_required_units integer, peer_completed_units integer, peer_due_units integer, peer_booked_units integer, peer_completed_leaders integer, mentoring_required_units integer, mentoring_completed_units integer, mentoring_due_units integer, mentoring_booked_units integer, mentoring_completed_leaders integer, triad_required_units integer, triad_completed_units integer, triad_due_units integer, triad_booked_units integer, triad_completed_leaders integer, programme_journey jsonb, progress_source_complete boolean, satisfaction_avg numeric, satisfaction_rated_count integer, adherence_credited_units integer, coverage_credited_units integer)
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
    public.sponsor_canonical_programme_journey(c.id, p_as_of),
    c.source_row_count = c.enrollment_count,
    CASE WHEN s.rated_count = 0 THEN NULL ELSE round(s.weighted_sum / s.rated_count, 2) END,
    s.rated_count,
    c.adherence_credited_units,
    c.coverage_credited_units
  FROM calculated c
  CROSS JOIN satisfaction s
  ORDER BY c.name;
$function$;

CREATE OR REPLACE FUNCTION public.sponsor_canonical_cohort_progress(p_cohort_id uuid DEFAULT NULL::uuid, p_as_of date DEFAULT public.programme_today())
 RETURNS TABLE(cohort_id uuid, cohort_label text, programme_label text, programme_start_date date, programme_end_date date, enrollment_count integer, suppressed boolean, required_units integer, completed_units integer, due_units integer, booked_units integer, overdue_units integer, full_completion_pct numeric, due_adherence_pct numeric, schedule_coverage_pct numeric, pace_status text, active_count integer, at_risk_count integer, paused_count integer, completed_count integer, not_yet_due_count integer, ahead_count integer, on_track_count integer, scheduled_count integer, behind_count integer, completed_pace_count integer, on_track_pct numeric, coaching_required_units integer, coaching_completed_units integer, coaching_due_units integer, coaching_booked_units integer, coaching_completed_leaders integer, training_required_units integer, training_completed_units integer, training_due_units integer, training_booked_units integer, training_completed_leaders integer, peer_required_units integer, peer_completed_units integer, peer_due_units integer, peer_booked_units integer, peer_completed_leaders integer, mentoring_required_units integer, mentoring_completed_units integer, mentoring_due_units integer, mentoring_booked_units integer, mentoring_completed_leaders integer, triad_required_units integer, triad_completed_units integer, triad_due_units integer, triad_booked_units integer, triad_completed_leaders integer, programme_journey jsonb, progress_source_complete boolean, satisfaction_avg numeric, satisfaction_rated_count integer, adherence_credited_units integer, coverage_credited_units integer)
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

CREATE OR REPLACE FUNCTION public.sponsor_canonical_enrollment_metadata(p_cohort_id uuid DEFAULT NULL::uuid, p_enrollment_id uuid DEFAULT NULL::uuid, p_as_of date DEFAULT public.programme_today())
 RETURNS TABLE(enrollment_id uuid, learner_display_name text, programme_label text, cohort_id uuid, cohort_label text, programme_id uuid, enrollment_start_date date, enrollment_end_date date, programme_start_date date, programme_end_date date, enrollment_status enrollment_status, stored_enrollment_status enrollment_status, effective_enrollment_status enrollment_status, required_units integer, completed_units integer, due_units integer, booked_units integer, overdue_units integer, full_completion_pct numeric, due_adherence_pct numeric, pace_status text, progress_available boolean, coaching_required_units integer, coaching_completed_units integer, coaching_due_units integer, coaching_booked_units integer, training_required_units integer, training_completed_units integer, training_due_units integer, training_booked_units integer, peer_required_units integer, peer_completed_units integer, peer_due_units integer, peer_booked_units integer, mentoring_required_units integer, mentoring_completed_units integer, mentoring_due_units integer, mentoring_booked_units integer, triad_required_units integer, triad_completed_units integer, triad_due_units integer, triad_booked_units integer, goal_count integer, goal_setup boolean, goal_progress_pct numeric, open_action_count integer, completed_action_count integer, total_action_count integer, action_completion_pct numeric, satisfaction_avg numeric, satisfaction_rated_count integer)
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
    coalesce(c.satisfaction_rated_count, 0)
  FROM base b
  LEFT JOIN LATERAL public.canonical_enrollment_engagement(b.enrollment_id) c ON true
  ORDER BY b.cohort_label, b.learner_display_name, b.enrollment_id;
$function$;

CREATE OR REPLACE FUNCTION public.sponsor_canonical_enrollment_progress(p_cohort_id uuid DEFAULT NULL::uuid, p_as_of date DEFAULT public.programme_today())
 RETURNS TABLE(enrollment_id uuid, learner_display_name text, programme_label text, cohort_id uuid, cohort_label text, programme_id uuid, enrollment_start_date date, enrollment_end_date date, programme_start_date date, programme_end_date date, enrollment_status enrollment_status, stored_enrollment_status enrollment_status, effective_enrollment_status enrollment_status, required_units integer, completed_units integer, due_units integer, booked_units integer, overdue_units integer, full_completion_pct numeric, due_adherence_pct numeric, pace_status text, progress_available boolean, coaching_required_units integer, coaching_completed_units integer, coaching_due_units integer, coaching_booked_units integer, training_required_units integer, training_completed_units integer, training_due_units integer, training_booked_units integer, peer_required_units integer, peer_completed_units integer, peer_due_units integer, peer_booked_units integer, mentoring_required_units integer, mentoring_completed_units integer, mentoring_due_units integer, mentoring_booked_units integer, triad_required_units integer, triad_completed_units integer, triad_due_units integer, triad_booked_units integer)
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

CREATE OR REPLACE FUNCTION public.sponsor_canonical_leader_experience(p_enrollment_id uuid, p_as_of date DEFAULT public.programme_today())
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT CASE
    WHEN public.sponsor_can_view_enrollment(p_enrollment_id)
      THEN public.canonical_enrollment_experience(p_enrollment_id, p_as_of)
    ELSE '{}'::jsonb
  END;
$function$;

CREATE OR REPLACE FUNCTION public.sponsor_canonical_leader_journey(p_enrollment_id uuid, p_as_of date DEFAULT public.programme_today())
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  -- Sponsor: visible enrollment only (enrollment organisation). Same
  -- construction as the learner self-view.
  SELECT CASE
    WHEN public.sponsor_can_view_enrollment(p_enrollment_id)
     AND EXISTS (
       SELECT 1 FROM public.programme_enrollments e
       WHERE e.id = p_enrollment_id AND e.cohort_id IS NOT NULL
     )
    THEN public.canonical_enrollment_journey(p_enrollment_id, p_as_of)
    ELSE '[]'::jsonb
  END;
$function$;

CREATE OR REPLACE FUNCTION public.sponsor_canonical_leader_progress(p_enrollment_id uuid, p_as_of date DEFAULT public.programme_today())
 RETURNS TABLE(enrollment_id uuid, learner_display_name text, programme_label text, cohort_id uuid, cohort_label text, programme_id uuid, enrollment_start_date date, enrollment_end_date date, programme_start_date date, programme_end_date date, enrollment_status enrollment_status, stored_enrollment_status enrollment_status, effective_enrollment_status enrollment_status, required_units integer, completed_units integer, due_units integer, booked_units integer, overdue_units integer, full_completion_pct numeric, due_adherence_pct numeric, pace_status text, progress_available boolean, coaching_required_units integer, coaching_completed_units integer, coaching_due_units integer, coaching_booked_units integer, training_required_units integer, training_completed_units integer, training_due_units integer, training_booked_units integer, peer_required_units integer, peer_completed_units integer, peer_due_units integer, peer_booked_units integer, mentoring_required_units integer, mentoring_completed_units integer, mentoring_due_units integer, mentoring_booked_units integer, triad_required_units integer, triad_completed_units integer, triad_due_units integer, triad_booked_units integer)
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

CREATE OR REPLACE FUNCTION public.sponsor_canonical_module_schedule(p_enrollment_id uuid)
 RETURNS TABLE(module programme_module_type, required_units integer, due_on date, milestone_units integer, training_week_id uuid)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  -- Requirement SCOPE comes from the programme; requirement DATES come from
  -- the cohort's canonical schedule (cohort_requirement_dates). No policy is
  -- interpreted here.
  WITH enrollment AS (
    SELECT e.programme_id, e.cohort_id
    FROM public.programme_enrollments e
    JOIN public.cohorts c ON c.id = e.cohort_id
    WHERE e.id = p_enrollment_id
  ), configured_modules AS (
    SELECT pm.module,
      CASE
        WHEN coalesce((pm.config->>'required')::boolean, false)
        THEN coalesce(public.programme_config_integer(pm.config, 'required_units'), 0)
        ELSE 0
      END AS required_units,
      e.programme_id, e.cohort_id
    FROM enrollment e
    JOIN public.programme_modules pm
      ON pm.programme_id = e.programme_id
     AND pm.enabled
     AND pm.module <> 'training'::public.programme_module_type
  )
  SELECT cm.module, cm.required_units, NULL::date, 0, NULL::uuid
  FROM configured_modules cm
  WHERE cm.required_units > 0

  UNION ALL
  SELECT cm.module, cm.required_units, d.due_on, d.units, d.training_week_id
  FROM configured_modules cm
  JOIN public.cohort_requirement_dates d
    ON d.cohort_id = cm.cohort_id
   AND d.programme_id = cm.programme_id
   AND d.module = cm.module
  WHERE cm.required_units > 0

  UNION ALL
  SELECT 'training'::public.programme_module_type,
    sum(i.required_units) OVER ()::integer,
    i.due_on,
    i.required_units,
    i.training_week_id
  FROM public.canonical_training_learning_items(p_enrollment_id, public.programme_today()) i;
$function$;

CREATE OR REPLACE FUNCTION public.sponsor_canonical_organisation_progress(p_as_of date DEFAULT public.programme_today())
 RETURNS TABLE(cohort_count integer, enrollment_count integer, required_units integer, completed_units integer, due_units integer, booked_units integer, overdue_units integer, full_completion_pct numeric, due_adherence_pct numeric, schedule_coverage_pct numeric, coaching_required_units integer, coaching_completed_units integer, coaching_due_units integer, coaching_booked_units integer, training_required_units integer, training_completed_units integer, training_due_units integer, training_booked_units integer, peer_required_units integer, peer_completed_units integer, peer_due_units integer, peer_booked_units integer, mentoring_required_units integer, mentoring_completed_units integer, mentoring_due_units integer, mentoring_booked_units integer, triad_required_units integer, triad_completed_units integer, triad_due_units integer, triad_booked_units integer, suppressed_cohort_count integer, progress_source_complete boolean, active_count integer, at_risk_count integer, paused_count integer, completed_count integer, on_track_count integer, behind_count integer, satisfaction_avg numeric, satisfaction_rated_count integer)
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
      count(*) FILTER (WHERE c.suppressed)::integer AS suppressed_cohort_count,
      coalesce(bool_and(c.progress_source_complete), false) AS progress_source_complete,
      coalesce(sum(c.active_count), 0)::integer AS active_count,
      coalesce(sum(c.at_risk_count), 0)::integer AS at_risk_count,
      coalesce(sum(c.paused_count), 0)::integer AS paused_count,
      coalesce(sum(c.completed_count), 0)::integer AS completed_count,
      coalesce(sum(c.on_track_count), 0)::integer AS on_track_count,
      coalesce(sum(c.behind_count), 0)::integer AS behind_count
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
    t.suppressed_cohort_count, t.progress_source_complete,
    t.active_count, t.at_risk_count, t.paused_count, t.completed_count,
    t.on_track_count, t.behind_count,
    CASE WHEN s.rated_count = 0 THEN NULL ELSE round(s.weighted_sum / s.rated_count, 2) END,
    s.rated_count
  FROM totals t
  CROSS JOIN satisfaction s;
$function$;

CREATE OR REPLACE FUNCTION public.sponsor_canonical_programme_journey(p_cohort_id uuid, p_as_of date DEFAULT public.programme_today())
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT public.get_sponsor_programme_journey(p_cohort_id, p_as_of);
$function$;

CREATE OR REPLACE FUNCTION public.sponsor_leader_requirement_calendar(p_enrollment_id uuid, p_as_of date DEFAULT public.programme_today())
 RETURNS TABLE(enrollment_id uuid, programme_id uuid, cohort_id uuid, organization_id uuid, module programme_module_type, requirement_id uuid, requirement_index integer, requirement_label text, training_week_id uuid, due_on date, is_required boolean, is_due_as_of boolean, is_completed boolean, completed_on date, is_overdue boolean, completion_source text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT c.* FROM public.canonical_enrollment_requirement_calendar(p_enrollment_id, p_as_of) c
  WHERE public.sponsor_can_view_enrollment(p_enrollment_id);
$function$;

CREATE OR REPLACE FUNCTION public.sync_peer_session_participants()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_kind text := CASE TG_TABLE_NAME WHEN 'peer_sessions' THEN 'peer' ELSE 'coachee_peer' END;
  v_receiver uuid;
  v_provider uuid;
  v_when date := (NEW.start_time AT TIME ZONE public.programme_time_zone())::date;
  v_provider_enrollment uuid;
  r record;
BEGIN
  IF TG_TABLE_NAME = 'peer_sessions' THEN
    v_receiver := NEW.peer_coachee_id; v_provider := NEW.peer_coach_id;
  ELSE
    v_receiver := NEW.peer_receiver_id; v_provider := NEW.peer_provider_id;
  END IF;

  -- The receiving side's enrollment is recorded on the session itself.
  INSERT INTO public.peer_session_participants
    (session_kind, peer_session_id, user_id, enrollment_id, participant_role)
  VALUES (v_kind, NEW.id, v_receiver, NEW.enrollment_id, 'receiver')
  ON CONFLICT (session_kind, peer_session_id, user_id) DO UPDATE
    SET enrollment_id = coalesce(public.peer_session_participants.enrollment_id, excluded.enrollment_id);

  -- The providing side. In a dyad session the partner's enrollment is the
  -- one that made them the receiver's assigned partner. A practice session's
  -- provider is a Coach who holds no cohort: only_enrollment_candidate()
  -- leaves an ambiguous Coach unattributed rather than guessing.
  IF v_kind = 'coachee_peer' THEN
    v_provider_enrollment := public.peer_partner_enrollment(NEW.enrollment_id, v_provider);
  ELSE
    v_provider_enrollment := public.only_enrollment_candidate(v_provider, NULL, v_when);
  END IF;

  INSERT INTO public.peer_session_participants
    (session_kind, peer_session_id, user_id, enrollment_id, participant_role)
  VALUES (v_kind, NEW.id, v_provider, v_provider_enrollment, 'provider')
  ON CONFLICT (session_kind, peer_session_id, user_id) DO UPDATE
    SET enrollment_id = coalesce(public.peer_session_participants.enrollment_id, excluded.enrollment_id);

  -- Only a dyad session earns a Peer requirement (20261005140000). Practice
  -- from the Coach opt-in pool keeps its participants and holds none.
  IF v_kind = 'coachee_peer' THEN
    FOR r IN
      SELECT p.id FROM public.peer_session_participants p
      WHERE p.session_kind = v_kind AND p.peer_session_id = NEW.id
    LOOP
      PERFORM public.peer_attribute_participant_internal(r.id);
    END LOOP;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.triad_cohort_learners_internal(p_cohort_id uuid, p_as_of date DEFAULT public.programme_today())
 RETURNS TABLE(enrollment_id uuid, user_id uuid, full_name text, spoken_languages text[], programme_id uuid, enrollment_status enrollment_status, is_eligible boolean, required_units integer, raw_completed_sessions integer, completed_units integer, due_units integer, overdue_units integer, next_due_on date, requirements jsonb)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT e.id, e.user_id, pr.full_name, coalesce(pr.spoken_languages, ARRAY[]::text[]), e.programme_id,
    e.status, e.status IN ('active', 'at_risk', 'paused'),
    c.required_units, c.raw_completed_sessions, c.completed_units, c.due_units, c.overdue_units, c.next_due_on,
    c.schedule
  FROM public.programme_enrollments e
  JOIN public.profiles pr ON pr.id = e.user_id
  CROSS JOIN LATERAL public.canonical_triad_completion(e.id, p_as_of) c
  WHERE e.cohort_id = p_cohort_id
    AND public.triad_required_units_for_programme(e.programme_id) > 0
  ORDER BY pr.full_name, e.id;
$function$;

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

CREATE OR REPLACE FUNCTION public.triad_reminder_targets_internal(p_as_of date DEFAULT public.programme_today(), p_cohort_id uuid DEFAULT NULL::uuid)
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
    AND l.is_eligible;
$function$;

CREATE OR REPLACE FUNCTION public.triad_requirement_candidates_internal(p_cohort_requirement_date_id uuid)
 RETURNS TABLE(enrollment_id uuid, user_id uuid, full_name text, spoken_languages text[], prior_partner_enrollment_ids uuid[], prior_partner_names text[])
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT l.enrollment_id, l.user_id, l.full_name, l.spoken_languages, l.prior_partner_enrollment_ids, l.prior_partner_names
  FROM public.triad_requirement_learners_internal(p_cohort_requirement_date_id, public.programme_today()) l
  WHERE l.is_eligible AND l.triad_group_id IS NULL
  ORDER BY l.full_name;
$function$;

CREATE OR REPLACE FUNCTION public.triad_requirement_learners_internal(p_cohort_requirement_date_id uuid, p_as_of date DEFAULT public.programme_today())
 RETURNS TABLE(cohort_requirement_date_id uuid, unit_number integer, due_on date, enrollment_id uuid, user_id uuid, full_name text, spoken_languages text[], enrollment_status enrollment_status, is_eligible boolean, triad_group_id uuid, open_session_status text, fulfilled boolean, fulfilled_on date, overdue boolean, prior_partner_enrollment_ids uuid[], prior_partner_names text[])
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH req AS (
    SELECT d.* FROM public.cohort_requirement_dates d
    WHERE d.id = p_cohort_requirement_date_id AND d.module = 'triads'::public.programme_module_type
  ), assigned AS (
    SELECT DISTINCT ON (m.enrollment_id) m.enrollment_id, g.id AS triad_group_id
    FROM req JOIN public.triad_groups g ON g.cohort_requirement_date_id = req.id AND g.is_active
    JOIN public.triad_group_members m ON m.triad_group_id = g.id
    ORDER BY m.enrollment_id, g.created_at DESC
  ), pop AS (
    SELECT e.* FROM req JOIN public.programme_enrollments e ON e.cohort_id = req.cohort_id AND e.programme_id = req.programme_id
    WHERE e.status IN ('active', 'at_risk', 'paused') OR e.id IN (SELECT enrollment_id FROM assigned)
  )
  SELECT req.id, req.ordinal, req.due_on, e.id, e.user_id, pr.full_name, coalesce(pr.spoken_languages, ARRAY[]::text[]),
    e.status, e.status IN ('active', 'at_risk', 'paused'),
    a.triad_group_id,
    (SELECT s.status FROM public.triad_sessions s WHERE s.triad_group_id = a.triad_group_id AND s.status IN ('proposed', 'confirmed') LIMIT 1),
    -- Per-requirement state is the requirement calendar's (20261006130000).
    coalesce(f.is_completed, false),
    f.completed_on,
    coalesce(f.is_overdue, false),
    coalesce(pp.ids, ARRAY[]::uuid[]), coalesce(pp.names, ARRAY[]::text[])
  FROM req
  CROSS JOIN pop e
  JOIN public.profiles pr ON pr.id = e.user_id
  LEFT JOIN assigned a ON a.enrollment_id = e.id
  LEFT JOIN LATERAL (
    SELECT x.is_completed, x.completed_on, x.is_overdue
    FROM public.canonical_enrollment_requirement_calendar(e.id, p_as_of) x
    WHERE x.requirement_id = req.id
  ) f ON true
  LEFT JOIN LATERAL (
    SELECT array_agg(DISTINCT om.enrollment_id) AS ids, array_agg(DISTINCT opr.full_name) AS names
    FROM public.triad_group_members mm
    JOIN public.triad_groups og ON og.id = mm.triad_group_id AND og.cohort_id = req.cohort_id
      AND og.cohort_requirement_date_id <> req.id
    JOIN public.triad_group_members om ON om.triad_group_id = og.id AND om.enrollment_id <> e.id
    JOIN public.programme_enrollments oe ON oe.id = om.enrollment_id
    JOIN public.profiles opr ON opr.id = oe.user_id
    WHERE mm.enrollment_id = e.id
  ) pp ON true
  ORDER BY pr.full_name, e.id;
$function$;

CREATE OR REPLACE FUNCTION public.triad_sync_session_attributions(p_session_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE s public.triad_sessions; occurred date;
BEGIN
  SELECT * INTO s FROM public.triad_sessions WHERE id = p_session_id;
  IF NOT FOUND THEN
    DELETE FROM public.session_activity_attributions
    WHERE source_activity_type = 'triad' AND source_activity_id = p_session_id;
    RETURN;
  END IF;
  IF public.is_historical_ownership_retired('triad', p_session_id) THEN RETURN; END IF;
  occurred := CASE WHEN s.status <> 'cancelled' THEN (s.scheduled_start_time AT TIME ZONE public.programme_time_zone())::date END;

  DELETE FROM public.session_activity_attributions a
  WHERE a.source_activity_type = 'triad' AND a.source_activity_id = p_session_id
    AND (occurred IS NULL OR a.occurred_on IS DISTINCT FROM occurred
         OR NOT EXISTS (SELECT 1 FROM public.triad_group_members m
                        WHERE m.triad_group_id = s.triad_group_id AND m.enrollment_id = a.enrollment_id));
  IF occurred IS NULL THEN RETURN; END IF;

  INSERT INTO public.session_activity_attributions
    (enrollment_id, module, source_activity_type, source_activity_id, occurred_on, milestone_id)
  SELECT m.enrollment_id, 'triads'::public.programme_module_type, 'triad', p_session_id, occurred, NULL
  FROM public.triad_group_members m
  WHERE m.triad_group_id = s.triad_group_id
  ON CONFLICT (source_activity_type, source_activity_id, enrollment_id) DO NOTHING;
END $function$;

CREATE OR REPLACE FUNCTION public.validate_peer_participant_enrollment()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_candidates integer;
  v_when date;
BEGIN
  IF NEW.enrollment_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.session_kind = 'peer' THEN
    SELECT (s.start_time AT TIME ZONE public.programme_time_zone())::date INTO v_when
    FROM public.peer_sessions s WHERE s.id = NEW.peer_session_id;
  ELSE
    SELECT (s.start_time AT TIME ZONE public.programme_time_zone())::date INTO v_when
    FROM public.coachee_peer_sessions s WHERE s.id = NEW.peer_session_id;
  END IF;

  SELECT count(*) INTO v_candidates
  FROM public.programme_enrollments e
  WHERE e.user_id = NEW.user_id
    AND (v_when IS NULL OR (v_when >= e.start_date AND (e.end_date IS NULL OR v_when <= e.end_date)));

  -- Exactly one candidate means the enrollment was determinable and should
  -- have been recorded. Zero (no programme) and several (ambiguous) are both
  -- legitimate reasons to carry no attribution.
  IF v_candidates = 1 THEN
    RAISE EXCEPTION 'Peer participation for % has a determinable enrollment and must record it', NEW.user_id
      USING ERRCODE = '23502';
  END IF;

  RETURN NEW;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 3. Re-date the activity ledger
-- ---------------------------------------------------------------------------
UPDATE public.session_activity_attributions a
   SET occurred_on = x.occurred_on
  FROM (
    SELECT a2.id, CASE a2.source_activity_type
      WHEN 'coaching' THEN (SELECT (s.start_time AT TIME ZONE public.programme_time_zone())::date FROM public.sessions s WHERE s.id = a2.source_activity_id)
      WHEN 'mentoring' THEN (SELECT (s.start_time AT TIME ZONE public.programme_time_zone())::date FROM public.mentoring_sessions s WHERE s.id = a2.source_activity_id)
      WHEN 'peer_coaching' THEN coalesce(
        (SELECT (s.start_time AT TIME ZONE public.programme_time_zone())::date FROM public.coachee_peer_sessions s WHERE s.id = a2.source_activity_id),
        (SELECT (s.start_time AT TIME ZONE public.programme_time_zone())::date FROM public.peer_sessions s WHERE s.id = a2.source_activity_id))
      WHEN 'triad' THEN (SELECT (s.scheduled_start_time AT TIME ZONE public.programme_time_zone())::date FROM public.triad_sessions s WHERE s.id = a2.source_activity_id)
      WHEN 'training' THEN (SELECT (t.completed_at AT TIME ZONE public.programme_time_zone())::date FROM public.training_progress t WHERE t.id = a2.source_activity_id)
      WHEN 'quiz' THEN (SELECT (q.submitted_at AT TIME ZONE public.programme_time_zone())::date FROM public.assignment_submissions q WHERE q.id = a2.source_activity_id)
      WHEN 'reflection' THEN (SELECT (q.submitted_at AT TIME ZONE public.programme_time_zone())::date FROM public.assignment_submissions q WHERE q.id = a2.source_activity_id)
      WHEN 'daily_prompt' THEN (SELECT (r.responded_at AT TIME ZONE public.programme_time_zone())::date FROM public.daily_prompt_responses r WHERE r.id = a2.source_activity_id)
    END AS occurred_on
    FROM public.session_activity_attributions a2
  ) x
 WHERE x.id = a.id AND x.occurred_on IS NOT NULL AND a.occurred_on IS DISTINCT FROM x.occurred_on;

-- ---------------------------------------------------------------------------
-- 4. Final-state guard
-- ---------------------------------------------------------------------------
DO $verify$
DECLARE bad text;
BEGIN
  SELECT string_agg(p.proname, ', ' ORDER BY p.proname) INTO bad
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND (p.prosrc ~* 'current_date' OR p.prosrc ~* 'at time zone ''utc'''
         OR pg_get_function_arguments(p.oid) ~* 'current_date');
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'Functions still date by the server or UTC: %', bad;
  END IF;
END
$verify$;
