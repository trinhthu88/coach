-- Keep the canonical Sponsor schedule and journey on the current Admin and
-- Cohort sources after the training-learning progress migration.
--
-- This is intentionally forward-only. Earlier enrollment snapshots remain
-- available for historical enrollment features, but Sponsor reporting must not
-- read them.

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
        (cm.cohort_start_date + ((tw.week_number - 1) * interval '7 days'))::date
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

CREATE OR REPLACE FUNCTION public.sponsor_canonical_programme_journey(
  p_cohort_id uuid,
  p_as_of date DEFAULT current_date
)
RETURNS jsonb
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
    SELECT e.id, e.cohort_id
    FROM public.programme_enrollments e
    JOIN public.cohorts c ON c.id = e.cohort_id
    JOIN sponsor s ON s.organization_id = c.organization_id
    WHERE e.cohort_id = p_cohort_id
      AND (
        SELECT count(*)
        FROM public.programme_enrollments ec
        WHERE ec.cohort_id = e.cohort_id
      ) >= public.sponsor_min_leaders_for_distribution()
  ), schedule AS (
    SELECT e.id AS enrollment_id, s.module, s.due_on,
      s.required_units, s.milestone_units, s.training_week_id
    FROM eligible e
    CROSS JOIN LATERAL public.sponsor_canonical_module_schedule(e.id) s
    WHERE s.due_on IS NOT NULL
  ), activity AS (
    SELECT e.id AS enrollment_id, a.module, a.occurred_on, a.status
    FROM eligible e
    CROSS JOIN LATERAL public.sponsor_canonical_activity(e.id) a
  ), dates AS (
    SELECT s.due_on,
      string_agg(DISTINCT tw.title, ' · ' ORDER BY tw.title)
        FILTER (WHERE tw.title IS NOT NULL) AS training_label,
      string_agg(DISTINCT s.module::text, ' · ' ORDER BY s.module::text) AS module_label,
      to_jsonb(array_agg(DISTINCT s.module::text ORDER BY s.module::text)) AS module_scope
    FROM schedule s
    LEFT JOIN public.training_weeks tw ON tw.id = s.training_week_id
    GROUP BY s.due_on
  ), scoped_modules AS (
    SELECT d.due_on, e.id AS enrollment_id, s.module,
      least(max(s.required_units), sum(s.milestone_units))::integer AS required_units
    FROM dates d
    CROSS JOIN eligible e
    JOIN schedule s
      ON s.enrollment_id = e.id
     AND s.due_on <= d.due_on
    GROUP BY d.due_on, e.id, s.module
  ), leader_module_checkpoints AS (
    SELECT sm.due_on, sm.enrollment_id, sm.module, sm.required_units,
      count(a.occurred_on) FILTER (
        WHERE a.status = 'completed'
          AND a.occurred_on <= least(p_as_of, sm.due_on)
      )::integer AS completed_units
    FROM scoped_modules sm
    LEFT JOIN activity a
      ON a.enrollment_id = sm.enrollment_id
     AND a.module = sm.module
    GROUP BY sm.due_on, sm.enrollment_id, sm.module, sm.required_units
  ), leader_checkpoints AS (
    SELECT d.due_on, e.id AS enrollment_id,
      coalesce(sum(l.required_units), 0)::integer AS required_units,
      coalesce(sum(least(l.completed_units, l.required_units)), 0)::integer AS completed_units
    FROM dates d
    CROSS JOIN eligible e
    LEFT JOIN leader_module_checkpoints l
      ON l.due_on = d.due_on
     AND l.enrollment_id = e.id
    GROUP BY d.due_on, e.id
  ), totals AS (
    SELECT d.due_on,
      coalesce(d.training_label, d.module_label) AS label,
      d.module_scope,
      sum(l.required_units)::integer AS required_units,
      sum(l.completed_units)::integer AS completed_units,
      count(*)::integer AS total_leaders,
      count(*) FILTER (
        WHERE l.required_units > 0
          AND l.completed_units >= l.required_units
      )::integer AS completed_leaders
    FROM dates d
    JOIN leader_checkpoints l ON l.due_on = d.due_on
    GROUP BY d.due_on, d.training_label, d.module_label, d.module_scope
  ), numbered AS (
    SELECT row_number() OVER (ORDER BY due_on)::integer AS checkpoint_number, *
    FROM totals
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'checkpoint_number', checkpoint_number,
    'due_on', due_on,
    'label', label,
    'module_scope', module_scope,
    'required_units', required_units,
    'completed_units', completed_units,
    'completed_leaders', completed_leaders,
    'total_leaders', total_leaders,
    'state', CASE
      WHEN p_as_of < due_on THEN 'upcoming'
      WHEN p_as_of = due_on THEN 'current'
      WHEN required_units > 0 AND completed_units >= required_units THEN 'completed'
      ELSE 'overdue'
    END
  ) ORDER BY due_on), '[]'::jsonb)
  FROM numbered;
$$;

REVOKE ALL ON FUNCTION public.sponsor_canonical_module_schedule(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sponsor_canonical_module_schedule(uuid)
  TO authenticated;

REVOKE ALL ON FUNCTION public.sponsor_canonical_programme_journey(uuid, date)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sponsor_canonical_programme_journey(uuid, date)
  TO authenticated;