-- ===========================================================================
-- Learner enrollment context: one active enrollment, one date range.
-- ===========================================================================
--
-- 1. canonical_enrollment_progress.enrollment_start_date / enrollment_end_date
--    are the enrollment's EFFECTIVE window (own dates, else the cohort's). An
--    ongoing enrollment has no end date of its own, so the learner header read
--    "May 25, 2026 - " while the journey card read the cohort's "Mar 31, 2027".
--    Only the two output columns change; status and progress already used the
--    cohort end date.
-- 2. learner_enrollment_context(p_enrollment_id): the self-scoped identity of
--    ONE enrollment (programme, cohort, organisation, status, effective dates)
--    for the shared learner context (useActiveEnrollment). The client resolves
--    WHICH enrollment once (the single ongoing one); this answers WHAT it is.
-- 3. cohort_programme_schedule_state counts Training: its required units are
--    the programme's selected weeks, and its rows are the Training
--    requirements materialised by 20260928100000 (previously it reported
--    "8 of 0 required units").
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.canonical_enrollment_progress(p_enrollment_id uuid, p_as_of date DEFAULT CURRENT_DATE)
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
      WHEN c.status IN ('active', 'at_risk') AND c.programme_end_date < p_as_of
      THEN CASE WHEN c.all_completed THEN 'completed'::public.enrollment_status
                ELSE 'at_risk'::public.enrollment_status END
      ELSE c.status
    END,
    c.status,
    CASE
      WHEN c.status IN ('active', 'at_risk') AND c.programme_end_date < p_as_of
      THEN CASE WHEN c.all_completed THEN 'completed'::public.enrollment_status
                ELSE 'at_risk'::public.enrollment_status END
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

CREATE OR REPLACE FUNCTION public.learner_enrollment_context(p_enrollment_id uuid)
RETURNS TABLE (
  enrollment_id uuid, user_id uuid,
  programme_id uuid, programme_name text,
  cohort_id uuid, cohort_name text,
  organization_id uuid, organization_name text,
  stored_enrollment_status public.enrollment_status,
  effective_enrollment_status public.enrollment_status,
  is_ongoing boolean, start_date date, end_date date
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT e.id, e.user_id, e.programme_id, p.name, e.cohort_id, c.name,
    e.organization_id, o.name, e.status, cp.effective_enrollment_status,
    e.status IN ('active', 'at_risk', 'paused'),
    cp.enrollment_start_date, cp.enrollment_end_date
  FROM public.programme_enrollments e
  LEFT JOIN public.programmes p ON p.id = e.programme_id
  LEFT JOIN public.cohorts c ON c.id = e.cohort_id
  LEFT JOIN public.organizations o ON o.id = e.organization_id
  LEFT JOIN LATERAL public.canonical_enrollment_progress(e.id, CURRENT_DATE) cp ON true
  WHERE e.id = p_enrollment_id
    AND e.user_id = auth.uid();
$$;
REVOKE ALL ON FUNCTION public.learner_enrollment_context(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.learner_enrollment_context(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.cohort_programme_schedule_state(p_cohort_id uuid, p_programme_id uuid)
RETURNS TABLE(module public.programme_module_type, required_units integer, scheduled_units integer, state text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  WITH scope AS (
    SELECT pm.module,
      CASE
        WHEN coalesce((pm.config->>'required')::boolean, false)
        THEN coalesce(public.programme_config_integer(pm.config, 'required_units'), 0)
        ELSE 0
      END AS required_units
    FROM public.programme_modules pm
    WHERE pm.programme_id = p_programme_id
      AND pm.enabled
      AND pm.module <> 'training'::public.programme_module_type
    UNION ALL
    -- Training: one requirement per selected week of the programme.
    SELECT 'training'::public.programme_module_type, count(*)::integer
    FROM public.cohort_training_requirement_weeks(p_cohort_id) w
    WHERE w.programme_id = p_programme_id
    HAVING count(*) > 0
  ), scheduled AS (
    SELECT d.module, sum(d.units)::integer AS units
    FROM public.cohort_requirement_dates d
    WHERE d.cohort_id = p_cohort_id
      AND d.programme_id = p_programme_id
    GROUP BY d.module
  )
  SELECT coalesce(s.module, sc.module),
    coalesce(s.required_units, 0),
    coalesce(sc.units, 0),
    CASE
      WHEN coalesce(s.required_units, 0) = coalesce(sc.units, 0) THEN 'aligned'
      WHEN coalesce(s.required_units, 0) > coalesce(sc.units, 0) THEN 'missing_dates'
      ELSE 'surplus_dates'
    END
  FROM (SELECT * FROM scope WHERE required_units > 0) s
  FULL JOIN scheduled sc ON sc.module = s.module
  ORDER BY 1;
$function$;
