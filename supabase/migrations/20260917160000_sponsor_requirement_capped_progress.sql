-- Keep Sponsor completion and overdue figures requirement-aware.
--
-- get_sponsor_programme_progress exposes both the raw activity count and the
-- required completion count. The latter must be capped per module before any
-- aggregate is built; otherwise one module can render 4/2 and its extras can
-- erase overdue required units from another module.

CREATE OR REPLACE FUNCTION public.get_sponsor_programme_progress(
  p_enrollment_id uuid,
  p_as_of date DEFAULT current_date
)
RETURNS TABLE (
  module public.programme_module_type,
  required_units integer,
  completed_activity_units integer,
  completed_units integer,
  due_units integer,
  booked_units integer,
  pace_status text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH schedule AS (
    SELECT *
    FROM public.sponsor_canonical_module_schedule(p_enrollment_id)
  ), modules AS (
    SELECT s.module,
      max(s.required_units)::integer AS required_units,
      least(
        max(s.required_units),
        coalesce(sum(s.milestone_units) FILTER (WHERE s.due_on <= p_as_of), 0)
      )::integer AS due_units
    FROM schedule s
    GROUP BY s.module
  ), activity AS (
    SELECT *
    FROM public.sponsor_canonical_activity(p_enrollment_id)
  ), counts AS (
    SELECT m.module,
      count(a.occurred_on) FILTER (
        WHERE a.status = 'completed'
          AND a.occurred_on <= p_as_of
      )::integer AS completed_activity_units,
      count(a.occurred_on) FILTER (
        WHERE a.status IN ('pending_coach_approval', 'confirmed')
          AND a.occurred_on >= p_as_of
      )::integer AS raw_booked_units
    FROM modules m
    LEFT JOIN activity a ON a.module = m.module
    GROUP BY m.module
  ), module_values AS (
    SELECT m.module, m.required_units,
      coalesce(c.completed_activity_units, 0)::integer AS completed_activity_units,
      least(
        coalesce(c.completed_activity_units, 0),
        m.required_units
      )::integer AS completed_units,
      m.due_units,
      least(
        coalesce(c.raw_booked_units, 0),
        greatest(
          m.required_units - least(coalesce(c.completed_activity_units, 0), m.required_units),
          0
        )
      )::integer AS booked_units
    FROM modules m
    LEFT JOIN counts c ON c.module = m.module
  )
  SELECT v.module, v.required_units, v.completed_activity_units,
    v.completed_units, v.due_units, v.booked_units,
    CASE
      WHEN v.required_units = 0 OR v.completed_units >= v.required_units THEN 'completed'
      WHEN v.due_units = 0 THEN 'not_yet_due'
      WHEN v.completed_units >= v.due_units THEN
        CASE WHEN v.completed_units > v.due_units THEN 'ahead' ELSE 'on_track' END
      WHEN v.completed_units + v.booked_units >= v.due_units THEN 'scheduled'
      ELSE 'behind'
    END
  FROM module_values v
  ORDER BY v.module;
$$;

CREATE OR REPLACE FUNCTION public.sponsor_canonical_enrollment_progress(
  p_cohort_id uuid DEFAULT NULL,
  p_as_of date DEFAULT current_date
)
RETURNS TABLE (
  enrollment_id uuid,
  learner_display_name text,
  programme_label text,
  cohort_id uuid,
  cohort_label text,
  programme_id uuid,
  enrollment_start_date date,
  enrollment_end_date date,
  programme_start_date date,
  programme_end_date date,
  enrollment_status public.enrollment_status,
  stored_enrollment_status public.enrollment_status,
  effective_enrollment_status public.enrollment_status,
  required_units integer,
  completed_units integer,
  due_units integer,
  booked_units integer,
  overdue_units integer,
  full_completion_pct numeric,
  due_adherence_pct numeric,
  pace_status text,
  progress_available boolean,
  coaching_required_units integer,
  coaching_completed_units integer,
  coaching_due_units integer,
  coaching_booked_units integer,
  training_required_units integer,
  training_completed_units integer,
  training_due_units integer,
  training_booked_units integer,
  peer_required_units integer,
  peer_completed_units integer,
  peer_due_units integer,
  peer_booked_units integer,
  mentoring_required_units integer,
  mentoring_completed_units integer,
  mentoring_due_units integer,
  mentoring_booked_units integer,
  triad_required_units integer,
  triad_completed_units integer,
  triad_due_units integer,
  triad_booked_units integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH sponsor AS (
    SELECT sp.organization_id
    FROM public.sponsor_profiles sp
    WHERE sp.user_id = auth.uid()
      AND auth.uid() IS NOT NULL
  ), eligible AS (
    SELECT e.id, e.programme_id, e.cohort_id, e.user_id,
      e.start_date, e.end_date, e.status, c.organization_id,
      c.name AS cohort_label, c.start_date AS programme_start_date,
      c.end_date AS programme_end_date, p.name AS programme_label,
      pr.full_name AS learner_display_name
    FROM public.programme_enrollments e
    JOIN public.cohorts c ON c.id = e.cohort_id
    JOIN public.programmes p ON p.id = e.programme_id
    JOIN public.profiles pr ON pr.id = e.user_id
    JOIN sponsor s ON s.organization_id = c.organization_id
    WHERE (p_cohort_id IS NULL OR e.cohort_id = p_cohort_id)
      AND (
        SELECT count(*)
        FROM public.programme_enrollments ec
        JOIN public.cohorts ec_c ON ec_c.id = ec.cohort_id
        WHERE ec.cohort_id = e.cohort_id
          AND ec_c.organization_id = c.organization_id
      ) >= public.sponsor_min_leaders_for_distribution()
  ), module_rows AS (
    SELECT e.*, g.module,
      g.completed_units AS module_completed_units,
      g.due_units AS module_due_units,
      g.required_units AS module_required_units,
      g.booked_units AS module_booked_units,
      g.pace_status AS module_pace_status
    FROM eligible e
    LEFT JOIN LATERAL public.get_sponsor_programme_progress(e.id, p_as_of) g ON true
  ), grouped AS (
    SELECT e.id, e.learner_display_name, e.programme_label, e.cohort_id,
      e.cohort_label, e.programme_id, e.start_date, e.end_date,
      e.programme_start_date, e.programme_end_date, e.status,
      count(m.module)::integer AS module_count,
      coalesce(sum(m.module_required_units), 0)::integer AS required_units,
      coalesce(sum(m.module_completed_units), 0)::integer AS completed_units,
      coalesce(sum(m.module_due_units), 0)::integer AS due_units,
      coalesce(sum(m.module_booked_units), 0)::integer AS booked_units,
      coalesce(sum(
        greatest(
          0,
          m.module_due_units - least(m.module_completed_units, m.module_required_units)
        )
      ), 0)::integer AS overdue_units,
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
      count(m.module) FILTER (WHERE m.module_pace_status = 'behind') > 0 AS has_behind,
      count(m.module) FILTER (WHERE m.module_pace_status = 'scheduled') > 0 AS has_scheduled,
      count(m.module) FILTER (WHERE m.module_pace_status = 'on_track') > 0 AS has_on_track,
      count(m.module) FILTER (WHERE m.module_pace_status = 'ahead') > 0 AS has_ahead,
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
        WHEN g.has_behind THEN 'behind'
        WHEN g.has_scheduled THEN 'scheduled'
        WHEN g.has_on_track THEN 'on_track'
        WHEN g.has_ahead THEN 'ahead'
        WHEN g.all_completed THEN 'completed'
        ELSE 'not_yet_due'
      END AS calculated_pace_status
    FROM grouped g
  )
  SELECT c.id, c.learner_display_name, c.programme_label, c.cohort_id,
    c.cohort_label, c.programme_id, c.start_date, c.end_date,
    c.programme_start_date, c.programme_end_date,
    CASE
      WHEN c.status IN ('active', 'at_risk')
        AND c.programme_end_date < p_as_of
      THEN CASE WHEN c.all_completed THEN 'completed'::public.enrollment_status
                ELSE 'at_risk'::public.enrollment_status END
      ELSE c.status
    END,
    c.status,
    CASE
      WHEN c.status IN ('active', 'at_risk')
        AND c.programme_end_date < p_as_of
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
  FROM calculated c
  ORDER BY c.cohort_label, c.learner_display_name, c.id;
$$;

-- Keep the dedicated leader RPC on the same canonical result rather than
-- maintaining a second progress formula.
CREATE OR REPLACE FUNCTION public.sponsor_canonical_leader_progress(
  p_enrollment_id uuid,
  p_as_of date DEFAULT current_date
)
RETURNS TABLE (
  enrollment_id uuid,
  learner_display_name text,
  programme_label text,
  cohort_id uuid,
  cohort_label text,
  programme_id uuid,
  enrollment_start_date date,
  enrollment_end_date date,
  programme_start_date date,
  programme_end_date date,
  enrollment_status public.enrollment_status,
  stored_enrollment_status public.enrollment_status,
  effective_enrollment_status public.enrollment_status,
  required_units integer,
  completed_units integer,
  due_units integer,
  booked_units integer,
  overdue_units integer,
  full_completion_pct numeric,
  due_adherence_pct numeric,
  pace_status text,
  progress_available boolean,
  coaching_required_units integer,
  coaching_completed_units integer,
  coaching_due_units integer,
  coaching_booked_units integer,
  training_required_units integer,
  training_completed_units integer,
  training_due_units integer,
  training_booked_units integer,
  peer_required_units integer,
  peer_completed_units integer,
  peer_due_units integer,
  peer_booked_units integer,
  mentoring_required_units integer,
  mentoring_completed_units integer,
  mentoring_due_units integer,
  mentoring_booked_units integer,
  triad_required_units integer,
  triad_completed_units integer,
  triad_due_units integer,
  triad_booked_units integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT p.*
  FROM public.sponsor_canonical_enrollment_progress(NULL, p_as_of) p
  WHERE p.enrollment_id = p_enrollment_id;
$$;

REVOKE ALL ON FUNCTION public.get_sponsor_programme_progress(uuid, date)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_sponsor_programme_progress(uuid, date)
  TO authenticated;