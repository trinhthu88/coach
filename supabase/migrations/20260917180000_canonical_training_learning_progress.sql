-- Canonical Training / Learning child-item progress.
--
-- Training is configured at the programme-module level, but its actual
-- denominator is the active required child learning items selected by the
-- module.  A selected visible skill card is one child unit.  This keeps the
-- parent requirement authoritative at the child level and prevents optional
-- or hidden content from entering the denominator.

CREATE OR REPLACE FUNCTION public.canonical_training_learning_items(
  p_enrollment_id uuid,
  p_as_of date DEFAULT current_date
)
RETURNS TABLE (
  item_type text,
  item_id uuid,
  training_week_id uuid,
  due_on date,
  required_units integer,
  completed_units integer,
  completed_on date
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH enrollment AS (
    SELECT e.id, e.programme_id, e.cohort_id,
      c.start_date AS cohort_start_date,
      c.end_date AS cohort_end_date
    FROM public.programme_enrollments e
    JOIN public.cohorts c ON c.id = e.cohort_id
    WHERE e.id = p_enrollment_id
  ), configured AS (
    SELECT e.*,
      pm.config,
      coalesce(pm.config->'distribution_settings', '{}'::jsonb) AS settings
    FROM enrollment e
    JOIN public.programme_modules pm
      ON pm.programme_id = e.programme_id
     AND pm.module = 'training'::public.programme_module_type
     AND pm.enabled
     AND coalesce((pm.config->>'required')::boolean, false)
  ), selected_weeks AS (
    SELECT DISTINCT c.id AS enrollment_id, tw.id AS training_week_id,
      tw.week_number, tw.is_visible, tw.skill_card_visible,
      coalesce(cwo.is_visible, true) AS override_visible,
      least(
        c.cohort_end_date,
        coalesce(
          cwo.unlock_date,
          tw.unlock_date,
          (c.cohort_start_date + ((tw.week_number - 1) * interval '7 days'))::date
        )
      ) AS due_on
    FROM configured c
    CROSS JOIN LATERAL jsonb_array_elements_text(
      CASE
        WHEN jsonb_typeof(c.settings->'training_week_ids') = 'array'
        THEN c.settings->'training_week_ids'
        ELSE '[]'::jsonb
      END
    ) selected(week_id)
    JOIN public.training_weeks tw
      ON tw.id::text = selected.week_id
     AND tw.programme_id = c.programme_id
    LEFT JOIN public.cohort_week_overrides cwo
      ON cwo.cohort_id = c.cohort_id
     AND cwo.training_week_id = tw.id
  )
  SELECT
    'skill_cards'::text,
    sw.training_week_id,
    sw.training_week_id,
    sw.due_on,
    1,
    CASE
      WHEN tp.completed_at IS NOT NULL
       AND tp.completed_at::date <= p_as_of
      THEN 1 ELSE 0
    END::integer,
    tp.completed_at::date
  FROM selected_weeks sw
  LEFT JOIN public.training_progress tp
    ON tp.enrollment_id = sw.enrollment_id
   AND tp.training_week_id = sw.training_week_id
  WHERE sw.is_visible
    AND sw.skill_card_visible
    AND sw.override_visible
    AND sw.due_on IS NOT NULL;
$$;

CREATE OR REPLACE FUNCTION public.canonical_training_learning_summary(
  p_enrollment_id uuid,
  p_as_of date DEFAULT current_date
)
RETURNS TABLE (
  configured_required_units integer,
  required_units integer,
  completed_units integer,
  due_units integer,
  completed_due_units integer,
  overdue_units integer,
  requirement_mismatch boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
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
$$;

-- This is intentionally a separate validation contract.  The stored parent
-- value remains useful for detecting Admin configuration drift, but it never
-- replaces the child-derived value used by progress.
CREATE OR REPLACE FUNCTION public.validate_training_learning_requirements(
  p_programme_id uuid DEFAULT NULL
)
RETURNS TABLE (
  programme_id uuid,
  stored_required_units integer,
  active_required_child_units integer,
  requirement_mismatch boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH configured AS (
    SELECT pm.programme_id,
      coalesce(public.programme_config_integer(pm.config, 'required_units'), 0)::integer
        AS stored_required_units,
      coalesce(pm.config->'distribution_settings', '{}'::jsonb) AS settings
    FROM public.programme_modules pm
    WHERE pm.module = 'training'::public.programme_module_type
      AND pm.enabled
      AND coalesce((pm.config->>'required')::boolean, false)
      AND (p_programme_id IS NULL OR pm.programme_id = p_programme_id)
  ), children AS (
    SELECT c.programme_id, count(DISTINCT tw.id)::integer AS active_required_child_units
    FROM configured c
    JOIN public.training_weeks tw
      ON tw.programme_id = c.programme_id
    CROSS JOIN LATERAL jsonb_array_elements_text(
      CASE
        WHEN jsonb_typeof(c.settings->'training_week_ids') = 'array'
        THEN c.settings->'training_week_ids'
        ELSE '[]'::jsonb
      END
    ) selected(week_id)
    WHERE tw.id::text = selected.week_id
      AND tw.is_visible
      AND tw.skill_card_visible
    GROUP BY c.programme_id
  )
  SELECT c.programme_id,
    c.stored_required_units,
    coalesce(ch.active_required_child_units, 0),
    c.stored_required_units <> coalesce(ch.active_required_child_units, 0)
  FROM configured c
  LEFT JOIN children ch ON ch.programme_id = c.programme_id
  WHERE public.has_role(auth.uid(), 'admin'::public.app_role)
  ORDER BY c.programme_id;
$$;

-- Replace the Training-linked schedule with one row per canonical child.
-- Other modules retain their established Admin-configured schedules.
CREATE OR REPLACE FUNCTION public.sponsor_canonical_module_schedule(
  p_enrollment_id uuid
)
RETURNS TABLE (
  module public.programme_module_type,
  required_units integer,
  due_on date,
  milestone_units integer,
  training_week_id uuid
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH enrollment AS (
    SELECT e.programme_id, e.cohort_id,
      c.start_date AS cohort_start_date,
      c.end_date AS cohort_end_date
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
      coalesce(nullif(pm.config->>'distribution_mode', ''), 'flexible') AS distribution_mode,
      coalesce(pm.config->'distribution_settings', '{}'::jsonb) AS distribution_settings,
      e.programme_id, e.cohort_id, e.cohort_start_date, e.cohort_end_date
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
  SELECT cm.module, cm.required_units, cm.cohort_end_date, cm.required_units, NULL::uuid
  FROM configured_modules cm
  WHERE cm.required_units > 0 AND cm.distribution_mode = 'flexible'

  UNION ALL
  SELECT cm.module, cm.required_units,
    cm.cohort_start_date + CASE
      WHEN units.sequence_no = cm.required_units
      THEN cm.cohort_end_date - cm.cohort_start_date
      WHEN cm.cohort_end_date > cm.cohort_start_date
      THEN greatest(1, ((cm.cohort_end_date - cm.cohort_start_date)
        * units.sequence_no / cm.required_units))
      ELSE 0
    END,
    1, NULL::uuid
  FROM configured_modules cm
  CROSS JOIN LATERAL generate_series(1, cm.required_units) AS units(sequence_no)
  WHERE cm.required_units > 0 AND cm.distribution_mode = 'evenly_distributed'

  UNION ALL
  SELECT cm.module,
    cm.required_units,
    least(
      cm.cohort_end_date,
      (cm.cohort_start_date + ((units.sequence_no - 1)
        * coalesce(public.programme_config_integer(cm.distribution_settings, 'interval_months'), 1)
        * interval '1 month'))::date
    ),
    1, NULL::uuid
  FROM configured_modules cm
  CROSS JOIN LATERAL generate_series(1, cm.required_units) AS units(sequence_no)
  WHERE cm.required_units > 0 AND cm.distribution_mode = 'monthly_frequency'

  UNION ALL
  SELECT cm.module,
    cm.required_units,
    NULLIF(custom.entry->>'due_on', '')::date,
    coalesce(public.programme_config_integer(custom.entry, 'required_units'), 1),
    NULL::uuid
  FROM configured_modules cm
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(cm.distribution_settings->'milestones') = 'array'
      THEN cm.distribution_settings->'milestones' ELSE '[]'::jsonb END
  ) AS custom(entry)
  WHERE cm.required_units > 0 AND cm.distribution_mode = 'custom'

  UNION ALL
  SELECT cm.module,
    cm.required_units,
    least(
      cm.cohort_end_date,
      coalesce(
        cwo.unlock_date,
        coalesce(tw.unlock_date,
          (cm.cohort_start_date + ((tw.week_number - 1) * interval '7 days'))::date)
      )
    ),
    1, tw.id
  FROM configured_modules cm
  CROSS JOIN LATERAL jsonb_array_elements_text(
    CASE WHEN jsonb_typeof(cm.distribution_settings->'training_week_ids') = 'array'
      THEN cm.distribution_settings->'training_week_ids' ELSE '[]'::jsonb END
  ) WITH ORDINALITY AS selected(week_id, selection_order)
  JOIN public.training_weeks tw
    ON tw.programme_id = cm.programme_id
   AND tw.id::text = selected.week_id
  LEFT JOIN public.cohort_week_overrides cwo
    ON cwo.cohort_id = cm.cohort_id
   AND cwo.training_week_id = tw.id
  WHERE cm.required_units > 0
    AND cm.distribution_mode = 'training_linked'
    AND selected.selection_order <= cm.required_units

  UNION ALL
  SELECT 'training'::public.programme_module_type,
    sum(i.required_units) OVER ()::integer,
    i.due_on,
    i.required_units,
    i.training_week_id
  FROM public.canonical_training_learning_items(p_enrollment_id, current_date) i;
$$;

CREATE OR REPLACE FUNCTION public.sponsor_canonical_activity(
  p_enrollment_id uuid
)
RETURNS TABLE (
  module public.programme_module_type,
  occurred_on date,
  status text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT a.module, a.occurred_on, coalesce(s.status::text, 'completed')
  FROM public.session_activity_attributions a
  LEFT JOIN public.sessions s ON s.id = a.source_activity_id
  WHERE a.enrollment_id = p_enrollment_id
    AND a.source_activity_type = 'coaching'

  UNION ALL
  SELECT a.module, a.occurred_on, coalesce(s.status::text, 'completed')
  FROM public.session_activity_attributions a
  LEFT JOIN public.peer_sessions s ON s.id = a.source_activity_id
  WHERE a.enrollment_id = p_enrollment_id
    AND a.source_activity_type = 'peer_coaching'

  UNION ALL
  SELECT a.module, a.occurred_on, coalesce(s.status::text, 'completed')
  FROM public.session_activity_attributions a
  LEFT JOIN public.coachee_peer_sessions s ON s.id = a.source_activity_id
  WHERE a.enrollment_id = p_enrollment_id
    AND a.source_activity_type = 'peer_coaching'
    AND NOT EXISTS (
      SELECT 1 FROM public.peer_sessions existing_peer
      WHERE existing_peer.id = a.source_activity_id
    )

  UNION ALL
  SELECT a.module, a.occurred_on, coalesce(s.status::text, 'completed')
  FROM public.session_activity_attributions a
  LEFT JOIN public.mentoring_sessions s ON s.id = a.source_activity_id
  WHERE a.enrollment_id = p_enrollment_id
    AND a.source_activity_type = 'mentoring'

  UNION ALL
  SELECT a.module, a.occurred_on, coalesce(s.status::text, 'completed')
  FROM public.session_activity_attributions a
  LEFT JOIN public.triad_sessions s ON s.id = a.source_activity_id
  WHERE a.enrollment_id = p_enrollment_id
    AND a.source_activity_type = 'triad'

  UNION ALL
  SELECT a.module, a.occurred_on, 'completed'
  FROM public.session_activity_attributions a
  WHERE a.enrollment_id = p_enrollment_id
    AND a.source_activity_type IN ('quiz', 'daily_prompt')

  UNION ALL
  SELECT 'training'::public.programme_module_type,
    i.completed_on,
    'completed'
  FROM public.canonical_training_learning_items(p_enrollment_id, current_date) i
  WHERE i.completed_units > 0
    AND i.completed_on IS NOT NULL;
$$;

CREATE OR REPLACE FUNCTION public.canonical_module_progress(
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
  overdue_units integer,
  pace_status text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH schedule AS (
    SELECT * FROM public.sponsor_canonical_module_schedule(p_enrollment_id)
  ), modules AS (
    SELECT s.module,
      max(s.required_units)::integer AS required_units,
      coalesce(sum(s.milestone_units)
        FILTER (WHERE s.due_on <= p_as_of), 0)::integer AS due_units
    FROM schedule s
    GROUP BY s.module
  ), learning AS (
    SELECT *
    FROM public.canonical_training_learning_summary(p_enrollment_id, p_as_of)
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
  ), values AS (
    SELECT m.module, m.required_units,
      CASE WHEN m.module = 'training'
        THEN coalesce(l.completed_units, 0)
        ELSE coalesce(c.completed_activity_units, 0)
      END::integer AS completed_activity_units,
      CASE WHEN m.module = 'training'
        THEN coalesce(l.completed_units, 0)
        ELSE least(coalesce(c.completed_activity_units, 0), m.required_units)
      END::integer AS completed_units,
      CASE WHEN m.module = 'training'
        THEN coalesce(l.due_units, 0)
        ELSE m.due_units
      END::integer AS due_units,
      CASE WHEN m.module = 'training' THEN 0
        ELSE least(
          coalesce(c.raw_booked_units, 0),
          greatest(m.required_units - least(coalesce(c.completed_activity_units, 0), m.required_units), 0)
        )
      END::integer AS booked_units,
      CASE WHEN m.module = 'training'
        THEN coalesce(l.overdue_units, 0)
        ELSE greatest(0, m.due_units - least(coalesce(c.completed_activity_units, 0), m.due_units))
      END::integer AS overdue_units
    FROM modules m
    LEFT JOIN counts c ON c.module = m.module
    LEFT JOIN learning l ON m.module = 'training'
  )
  SELECT v.module, v.required_units, v.completed_activity_units,
    least(v.completed_units, v.required_units)::integer,
    v.due_units, v.booked_units, v.overdue_units,
    CASE
      WHEN v.required_units = 0 OR v.completed_units >= v.required_units THEN 'completed'
      WHEN v.due_units = 0 THEN 'not_yet_due'
      WHEN v.completed_units >= v.due_units THEN
        CASE WHEN v.completed_units > v.due_units THEN 'ahead' ELSE 'on_track' END
      WHEN v.completed_units + v.booked_units >= v.due_units THEN 'scheduled'
      ELSE 'behind'
    END
  FROM values v
  ORDER BY v.module;
$$;

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
  SELECT module, required_units, completed_activity_units, completed_units,
    due_units, booked_units, pace_status
  FROM public.canonical_module_progress(p_enrollment_id, p_as_of);
$$;

-- Keep the established Sponsor result shape while sourcing overdue from the
-- child-aware module result instead of due minus an undifferentiated total.
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
  FROM calculated c
  ORDER BY c.cohort_label, c.learner_display_name, c.id;
$$;

-- Learner self-view uses the same child-aware module source while retaining
-- its own self-authorization boundary.
CREATE OR REPLACE FUNCTION public.learner_canonical_progress(
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
  WITH eligible AS (
    SELECT e.id, e.programme_id, e.cohort_id, e.user_id, e.start_date,
      e.end_date, e.status, c.name AS cohort_label,
      c.start_date AS programme_start_date, c.end_date AS programme_end_date,
      p.name AS programme_label, pr.full_name AS learner_display_name
    FROM public.programme_enrollments e
    JOIN public.cohorts c ON c.id = e.cohort_id
    JOIN public.programmes p ON p.id = e.programme_id
    JOIN public.profiles pr ON pr.id = e.user_id
    WHERE e.id = p_enrollment_id
      AND e.user_id = auth.uid()
      AND auth.uid() IS NOT NULL
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
$$;

-- Keep the existing experience contracts (including their privacy and
-- engagement payloads), replacing only the learning breakdown with the shared
-- child-item result.
CREATE OR REPLACE FUNCTION public.canonical_learning_breakdown(
  p_enrollment_id uuid,
  p_as_of date DEFAULT current_date
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH progress AS (
    SELECT e.id AS enrollment_id, e.programme_id, e.cohort_id,
      c.start_date AS programme_start_date
    FROM public.programme_enrollments e
    JOIN public.cohorts c ON c.id = e.cohort_id
    WHERE e.id = p_enrollment_id
  ), weeks AS (
    SELECT p.*, tw.id AS training_week_id, tw.week_number,
      coalesce(cwo.is_visible, true) AS override_visible,
      coalesce(
        cwo.unlock_date,
        tw.unlock_date,
        (p.programme_start_date + ((tw.week_number - 1) * interval '7 days'))::date
      ) AS effective_unlock_date,
      tw.is_visible, tw.skill_card_visible
    FROM progress p
    JOIN public.training_weeks tw ON tw.programme_id = p.programme_id
    LEFT JOIN public.cohort_week_overrides cwo
      ON cwo.cohort_id = p.cohort_id
     AND cwo.training_week_id = tw.id
  ), items AS (
    SELECT i.item_type, i.item_id, i.due_on, i.completed_units > 0 AS completed
    FROM public.canonical_training_learning_items(p_enrollment_id, p_as_of) i

    UNION ALL
    SELECT 'quizzes'::text, a.id,
      CASE WHEN w.effective_unlock_date IS NULL THEN NULL
        ELSE w.effective_unlock_date + coalesce(a.due_offset_days, 7) END,
      asub.submitted_at IS NOT NULL
    FROM weeks w
    JOIN public.programme_modules pm
      ON pm.programme_id = w.programme_id
     AND pm.module = 'quiz'::public.programme_module_type
     AND pm.enabled
     AND coalesce((pm.config->>'required')::boolean, false)
    JOIN public.assignments a
      ON a.training_week_id = w.training_week_id
     AND a.assignment_type = 'quiz'::public.assignment_type
     AND a.is_visible
    LEFT JOIN public.assignment_submissions asub
      ON asub.enrollment_id = p_enrollment_id
     AND asub.assignment_id = a.id
     AND asub.submitted_at::date <= p_as_of
    WHERE w.is_visible AND w.override_visible

    UNION ALL
    SELECT 'reflections'::text, pr.id,
      CASE WHEN w.effective_unlock_date IS NULL THEN NULL
        ELSE w.effective_unlock_date + 6 END,
      rs.submitted_at IS NOT NULL
    FROM weeks w
    JOIN public.programme_modules pm
      ON pm.programme_id = w.programme_id
     AND pm.module = 'training'::public.programme_module_type
     AND pm.enabled
     AND coalesce((pm.config->>'required')::boolean, false)
    JOIN public.programme_reflections pr
      ON pr.programme_id = w.programme_id
     AND pr.appears_at_week = w.week_number
     AND pr.is_visible
    LEFT JOIN public.reflection_submissions rs
      ON rs.enrollment_id = p_enrollment_id
     AND rs.reflection_id = pr.id
     AND rs.submitted_at::date <= p_as_of
    WHERE w.is_visible AND w.override_visible

    UNION ALL
    SELECT 'daily_prompts'::text, dp.id,
      CASE WHEN w.effective_unlock_date IS NULL THEN NULL
        ELSE w.effective_unlock_date + (dp.day_offset - 1) END,
      dpr.responded_at IS NOT NULL
    FROM weeks w
    JOIN public.programme_modules pm
      ON pm.programme_id = w.programme_id
     AND pm.module = 'daily_prompt'::public.programme_module_type
     AND pm.enabled
     AND coalesce((pm.config->>'required')::boolean, false)
    JOIN public.daily_prompts dp ON dp.training_week_id = w.training_week_id
    LEFT JOIN public.daily_prompt_responses dpr
      ON dpr.enrollment_id = p_enrollment_id
     AND dpr.daily_prompt_id = dp.id
     AND dpr.responded_at::date <= p_as_of
    WHERE w.is_visible AND w.override_visible
  ), keys AS (
    SELECT * FROM (VALUES
      ('skill_cards'::text, 'Skill Cards'::text),
      ('quizzes'::text, 'Quizzes'::text),
      ('reflections'::text, 'Reflections'::text),
      ('daily_prompts'::text, 'Daily Prompts'::text)
    ) AS x(item_type, label)
  ), grouped AS (
    SELECT k.item_type, k.label,
      count(i.item_id)::integer AS required_units,
      count(i.item_id) FILTER (WHERE i.due_on IS NOT NULL AND i.due_on <= p_as_of)::integer AS due_units,
      count(i.item_id) FILTER (WHERE i.completed AND i.due_on IS NOT NULL AND i.due_on <= p_as_of)::integer AS completed_due_units,
      count(i.item_id) FILTER (WHERE i.completed)::integer AS completed_units,
      max(i.due_on) AS last_due_on
    FROM keys k
    LEFT JOIN items i ON i.item_type = k.item_type
    GROUP BY k.item_type, k.label
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'key', g.item_type,
    'label', g.label,
    'required_units', g.required_units,
    'due_units', g.due_units,
    'completed_units', least(g.completed_units, g.required_units),
    'progress_available', g.required_units > 0,
    'status', CASE
      WHEN g.required_units = 0 THEN 'unavailable'
      WHEN g.completed_units >= g.required_units THEN 'completed'
      WHEN g.due_units = 0 THEN 'upcoming'
      WHEN g.last_due_on IS NOT NULL AND p_as_of <= g.last_due_on THEN 'current'
      ELSE 'overdue'
    END
  ) ORDER BY g.item_type), '[]'::jsonb)
  FROM grouped g;
$$;

ALTER FUNCTION public.learner_canonical_experience(uuid, date)
  RENAME TO learner_canonical_experience_legacy;

CREATE OR REPLACE FUNCTION public.learner_canonical_experience(
  p_enrollment_id uuid,
  p_as_of date DEFAULT current_date
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN legacy.payload = '{}'::jsonb THEN legacy.payload
    ELSE jsonb_set(
      legacy.payload,
      '{learning_breakdown}',
      public.canonical_learning_breakdown(p_enrollment_id, p_as_of),
      true
    )
  END
  FROM (
    SELECT public.learner_canonical_experience_legacy(p_enrollment_id, p_as_of) AS payload
  ) legacy;
$$;

ALTER FUNCTION public.sponsor_canonical_leader_experience(uuid, date)
  RENAME TO sponsor_canonical_leader_experience_legacy;

CREATE OR REPLACE FUNCTION public.sponsor_canonical_leader_experience(
  p_enrollment_id uuid,
  p_as_of date DEFAULT current_date
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN legacy.payload = '{}'::jsonb THEN legacy.payload
    ELSE jsonb_set(
      legacy.payload,
      '{learning_breakdown}',
      public.canonical_learning_breakdown(p_enrollment_id, p_as_of),
      true
    )
  END
  FROM (
    SELECT public.sponsor_canonical_leader_experience_legacy(p_enrollment_id, p_as_of) AS payload
  ) legacy;
$$;

REVOKE ALL ON FUNCTION public.canonical_training_learning_items(uuid, date)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.canonical_training_learning_summary(uuid, date)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.canonical_module_progress(uuid, date)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.canonical_learning_breakdown(uuid, date)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.validate_training_learning_requirements(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.validate_training_learning_requirements(uuid)
  TO authenticated;

REVOKE ALL ON FUNCTION public.learner_canonical_experience_legacy(uuid, date)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.learner_canonical_experience(uuid, date)
  TO authenticated;
REVOKE ALL ON FUNCTION public.sponsor_canonical_leader_experience_legacy(uuid, date)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sponsor_canonical_leader_experience(uuid, date)
  TO authenticated;