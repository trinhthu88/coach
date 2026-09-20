-- Sponsor reporting compares two authoritative inputs:
--   1. current Admin programme_modules/training schedule configuration
--   2. activity already attributed to the enrolled leader
--
-- Enrollment snapshots remain available to learner/coaching progress APIs, but
-- sponsor denominators and expected units must not silently inherit stale
-- snapshot configuration.
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
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH enrollment AS (
    SELECT e.id, e.programme_id, e.cohort_id, e.start_date, e.end_date
    FROM public.programme_enrollments e
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
      e.programme_id, e.cohort_id, e.start_date, e.end_date
    FROM enrollment e
    JOIN public.programme_modules pm
      ON pm.programme_id = e.programme_id
     AND pm.enabled
  ), schedule AS (
    SELECT cm.module, cm.required_units, cm.end_date AS due_on, cm.required_units AS milestone_units
    FROM configured_modules cm
    WHERE cm.required_units > 0 AND cm.distribution_mode = 'flexible'

    UNION ALL

    SELECT cm.module, cm.required_units,
      cm.start_date + ((cm.end_date - cm.start_date) * sequence_no / cm.required_units),
      1
    FROM configured_modules cm
    CROSS JOIN LATERAL generate_series(1, cm.required_units) AS units(sequence_no)
    WHERE cm.required_units > 0 AND cm.distribution_mode = 'evenly_distributed'

    UNION ALL

    SELECT cm.module, cm.required_units,
      least(
        cm.end_date,
        (cm.start_date + ((units.sequence_no - 1)
          * coalesce(public.programme_config_integer(cm.distribution_settings, 'interval_months'), 1)
          * interval '1 month'))::date
      ),
      1
    FROM configured_modules cm
    CROSS JOIN LATERAL generate_series(1, cm.required_units) AS units(sequence_no)
    WHERE cm.required_units > 0 AND cm.distribution_mode = 'monthly_frequency'

    UNION ALL

    SELECT cm.module, cm.required_units,
      custom_dates.due_on,
      coalesce(public.programme_config_integer(custom.entry, 'required_units'), 1)
    FROM configured_modules cm
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(cm.distribution_settings->'milestones') = 'array'
        THEN cm.distribution_settings->'milestones' ELSE '[]'::jsonb END
    ) AS custom(entry)
    CROSS JOIN LATERAL (
      SELECT (custom.entry->>'due_on')::date AS due_on
    ) AS custom_dates
    WHERE cm.required_units > 0 AND cm.distribution_mode = 'custom'

    UNION ALL

    SELECT cm.module, cm.required_units,
      least(
        cm.end_date,
        coalesce(
          cwo.unlock_date,
          (cm.start_date + ((tw.week_number - 1) * interval '7 days'))::date
        )
      ),
      1
    FROM configured_modules cm
    JOIN public.training_weeks tw
      ON tw.programme_id = cm.programme_id
     AND tw.id::text IN (
       SELECT jsonb_array_elements_text(
         CASE WHEN jsonb_typeof(cm.distribution_settings->'training_week_ids') = 'array'
           THEN cm.distribution_settings->'training_week_ids' ELSE '[]'::jsonb END
       )
     )
    LEFT JOIN public.cohort_week_overrides cwo
      ON cwo.cohort_id = cm.cohort_id
     AND cwo.training_week_id = tw.id
    WHERE cm.required_units > 0 AND cm.distribution_mode = 'training_linked'
  ), scheduled AS (
    SELECT cm.module, cm.required_units,
      coalesce(sum(s.milestone_units) FILTER (WHERE s.due_on <= p_as_of), 0)::integer AS due_units
    FROM configured_modules cm
    LEFT JOIN schedule s ON s.module = cm.module
    GROUP BY cm.module, cm.required_units
  ), activity AS (
    SELECT a.module, a.occurred_on, coalesce(s.status::text, 'completed') AS status
    FROM public.session_activity_attributions a
    LEFT JOIN public.sessions s
      ON a.source_activity_type = 'coaching' AND s.id = a.source_activity_id
    WHERE a.enrollment_id = p_enrollment_id AND a.source_activity_type = 'coaching'

    UNION ALL

    SELECT a.module, a.occurred_on, coalesce(s.status::text, 'completed')
    FROM public.session_activity_attributions a
    LEFT JOIN public.peer_sessions s
      ON a.source_activity_type = 'peer_coaching' AND s.id = a.source_activity_id
    WHERE a.enrollment_id = p_enrollment_id AND a.source_activity_type = 'peer_coaching'

    UNION ALL

    SELECT a.module, a.occurred_on, coalesce(s.status::text, 'completed')
    FROM public.session_activity_attributions a
    LEFT JOIN public.coachee_peer_sessions s
      ON a.source_activity_type = 'peer_coaching' AND s.id = a.source_activity_id
    WHERE a.enrollment_id = p_enrollment_id AND a.source_activity_type = 'peer_coaching'

    UNION ALL

    SELECT a.module, a.occurred_on, coalesce(s.status::text, 'completed')
    FROM public.session_activity_attributions a
    LEFT JOIN public.mentoring_sessions s
      ON a.source_activity_type = 'mentoring' AND s.id = a.source_activity_id
    WHERE a.enrollment_id = p_enrollment_id AND a.source_activity_type = 'mentoring'

    UNION ALL

    SELECT a.module, a.occurred_on, coalesce(s.status::text, 'completed')
    FROM public.session_activity_attributions a
    LEFT JOIN public.triad_sessions s
      ON a.source_activity_type = 'triad' AND s.id = a.source_activity_id
    WHERE a.enrollment_id = p_enrollment_id AND a.source_activity_type = 'triad'

    UNION ALL

    SELECT a.module, a.occurred_on, 'completed'
    FROM public.session_activity_attributions a
    WHERE a.enrollment_id = p_enrollment_id
      AND a.source_activity_type IN ('training', 'quiz', 'daily_prompt')
  ), counts AS (
    SELECT s.module,
      count(a.*) FILTER (
        WHERE a.status = 'completed' AND a.occurred_on <= p_as_of
      )::integer AS completed_activity_units,
      count(a.*) FILTER (
        WHERE a.status IN ('pending_coach_approval', 'confirmed')
          AND a.occurred_on >= p_as_of
      )::integer AS raw_booked_units
    FROM scheduled s
    LEFT JOIN activity a ON a.module = s.module
    GROUP BY s.module
  ), module_values AS (
    SELECT s.module, s.required_units,
      coalesce(c.completed_activity_units, 0)::integer AS completed_activity_units,
      -- completed_units is entitlement-relative and must never exceed
      -- required_units: a leader who does more sessions than required is
      -- real over-utilisation, not a bigger denominator, and showing e.g.
      -- "40/4" as if 4 were still the ceiling is exactly the incoherent
      -- numerator-vs-denominator bug this table exists to prevent.
      -- completed_activity_units above stays the true uncapped count.
      least(coalesce(c.completed_activity_units, 0), s.required_units)::integer AS completed_units,
      s.due_units,
      least(
        coalesce(c.raw_booked_units, 0),
        greatest(s.required_units - coalesce(c.completed_activity_units, 0), 0)
      )::integer AS booked_units
    FROM scheduled s
    LEFT JOIN counts c ON c.module = s.module
  )
  SELECT v.module, v.required_units, v.completed_activity_units, v.completed_units,
    v.due_units, v.booked_units,
    CASE
      WHEN v.required_units = 0 OR v.completed_units >= v.required_units THEN 'completed'
      WHEN v.due_units = 0 THEN 'not_yet_due'
      WHEN v.completed_units >= v.due_units THEN
        CASE WHEN v.completed_units > v.due_units THEN 'ahead' ELSE 'on_track' END
      WHEN v.completed_units + v.booked_units >= v.due_units THEN 'scheduled'
      ELSE 'behind'
    END
  FROM module_values v;
$$;

-- Build the sponsor-safe cohort journey from the same current Admin schedule
-- and attributed activity sources. No notes, messages, reflections, or goal
-- wording are selected here.
CREATE OR REPLACE FUNCTION public.get_sponsor_programme_journey(
  p_cohort_id uuid,
  p_as_of date DEFAULT current_date
)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH eligible AS (
    SELECT e.id, e.programme_id, e.cohort_id, e.start_date, e.end_date
    FROM public.programme_enrollments e
    JOIN public.cohorts c ON c.id = e.cohort_id
    WHERE e.cohort_id = p_cohort_id
      AND EXISTS (
        SELECT 1
        FROM public.sponsor_profiles sp
        WHERE sp.user_id = auth.uid()
          AND sp.organization_id = c.organization_id
      )
  ), configured_modules AS (
    SELECT e.id AS enrollment_id, e.programme_id, e.cohort_id,
      e.start_date, e.end_date, pm.module,
      CASE
        WHEN coalesce((pm.config->>'required')::boolean, false)
          THEN coalesce(public.programme_config_integer(pm.config, 'required_units'), 0)
        ELSE 0
      END AS required_units,
      coalesce(nullif(pm.config->>'distribution_mode', ''), 'flexible') AS distribution_mode,
      coalesce(pm.config->'distribution_settings', '{}'::jsonb) AS distribution_settings
    FROM eligible e
    JOIN public.programme_modules pm
      ON pm.programme_id = e.programme_id
     AND pm.enabled
  ), schedule AS (
    SELECT cm.enrollment_id, cm.module, cm.required_units,
      cm.end_date AS due_on, cm.required_units AS milestone_units,
      NULL::text AS checkpoint_label
    FROM configured_modules cm
    WHERE cm.required_units > 0 AND cm.distribution_mode = 'flexible'

    UNION ALL

    SELECT cm.enrollment_id, cm.module, cm.required_units,
      cm.start_date + ((cm.end_date - cm.start_date) * units.sequence_no / cm.required_units),
      1, NULL::text
    FROM configured_modules cm
    CROSS JOIN LATERAL generate_series(1, cm.required_units) AS units(sequence_no)
    WHERE cm.required_units > 0 AND cm.distribution_mode = 'evenly_distributed'

    UNION ALL

    SELECT cm.enrollment_id, cm.module, cm.required_units,
      least(
        cm.end_date,
        (cm.start_date + ((units.sequence_no - 1)
          * coalesce(public.programme_config_integer(cm.distribution_settings, 'interval_months'), 1)
          * interval '1 month'))::date
      ),
      1, NULL::text
    FROM configured_modules cm
    CROSS JOIN LATERAL generate_series(1, cm.required_units) AS units(sequence_no)
    WHERE cm.required_units > 0 AND cm.distribution_mode = 'monthly_frequency'

    UNION ALL

    SELECT cm.enrollment_id, cm.module, cm.required_units,
      NULLIF(custom.entry->>'due_on', '')::date,
      coalesce(public.programme_config_integer(custom.entry, 'required_units'), 1),
      'Checkpoint'
    FROM configured_modules cm
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(cm.distribution_settings->'milestones') = 'array'
        THEN cm.distribution_settings->'milestones' ELSE '[]'::jsonb END
    ) AS custom(entry)
    WHERE cm.required_units > 0 AND cm.distribution_mode = 'custom'

    UNION ALL

    SELECT cm.enrollment_id, cm.module, cm.required_units,
      least(
        cm.end_date,
        coalesce(
          cwo.unlock_date,
          (cm.start_date + ((tw.week_number - 1) * interval '7 days'))::date
        )
      ),
      1, tw.title
    FROM configured_modules cm
    JOIN public.training_weeks tw
      ON tw.programme_id = cm.programme_id
     AND tw.id::text IN (
       SELECT jsonb_array_elements_text(
         CASE WHEN jsonb_typeof(cm.distribution_settings->'training_week_ids') = 'array'
           THEN cm.distribution_settings->'training_week_ids' ELSE '[]'::jsonb END
       )
     )
    LEFT JOIN public.cohort_week_overrides cwo
      ON cwo.cohort_id = cm.cohort_id
     AND cwo.training_week_id = tw.id
    WHERE cm.required_units > 0 AND cm.distribution_mode = 'training_linked'
  ), activity AS (
    SELECT a.enrollment_id, a.module, a.occurred_on,
      coalesce(s.status::text, 'completed') AS status
    FROM public.session_activity_attributions a
    LEFT JOIN public.sessions s
      ON a.source_activity_type = 'coaching' AND s.id = a.source_activity_id
    WHERE a.source_activity_type = 'coaching'

    UNION ALL

    SELECT a.enrollment_id, a.module, a.occurred_on,
      coalesce(s.status::text, 'completed')
    FROM public.session_activity_attributions a
    LEFT JOIN public.peer_sessions s
      ON a.source_activity_type = 'peer_coaching' AND s.id = a.source_activity_id
    WHERE a.source_activity_type = 'peer_coaching'

    UNION ALL

    SELECT a.enrollment_id, a.module, a.occurred_on,
      coalesce(s.status::text, 'completed')
    FROM public.session_activity_attributions a
    LEFT JOIN public.coachee_peer_sessions s
      ON a.source_activity_type = 'peer_coaching' AND s.id = a.source_activity_id
    WHERE a.source_activity_type = 'peer_coaching'

    UNION ALL

    SELECT a.enrollment_id, a.module, a.occurred_on,
      coalesce(s.status::text, 'completed')
    FROM public.session_activity_attributions a
    LEFT JOIN public.mentoring_sessions s
      ON a.source_activity_type = 'mentoring' AND s.id = a.source_activity_id
    WHERE a.source_activity_type = 'mentoring'

    UNION ALL

    SELECT a.enrollment_id, a.module, a.occurred_on,
      coalesce(s.status::text, 'completed')
    FROM public.session_activity_attributions a
    LEFT JOIN public.triad_sessions s
      ON a.source_activity_type = 'triad' AND s.id = a.source_activity_id
    WHERE a.source_activity_type = 'triad'

    UNION ALL

    SELECT a.enrollment_id, a.module, a.occurred_on, 'completed'
    FROM public.session_activity_attributions a
    WHERE a.source_activity_type IN ('training', 'quiz', 'daily_prompt')
  ), checkpoint_dates AS (
    SELECT due_on, max(checkpoint_label) AS checkpoint_label
    FROM schedule
    WHERE due_on IS NOT NULL
    GROUP BY due_on
  ), leader_checkpoints AS (
    SELECT d.due_on, e.id AS enrollment_id,
      coalesce((
        SELECT sum(s.milestone_units)::integer
        FROM schedule s
        WHERE s.enrollment_id = e.id AND s.due_on <= d.due_on
      ), 0)::integer AS required_units,
      coalesce((
        SELECT count(*)::integer
        FROM activity a
        WHERE a.enrollment_id = e.id
          AND a.status = 'completed'
          AND a.occurred_on <= p_as_of
          AND a.occurred_on <= d.due_on
          AND EXISTS (
            SELECT 1
            FROM schedule scheduled_module
            WHERE scheduled_module.enrollment_id = e.id
              AND scheduled_module.module = a.module
              AND scheduled_module.due_on <= d.due_on
          )
      ), 0)::integer AS completed_units
    FROM checkpoint_dates d
    CROSS JOIN eligible e
  ), totals AS (
    SELECT d.due_on, d.checkpoint_label,
      sum(l.required_units)::integer AS required_units,
      -- Capped per leader before summing: a leader who did more sessions
      -- than this checkpoint requires is over-utilisation, not extra
      -- entitlement, and must not inflate the checkpoint's numerator past
      -- its own denominator.
      sum(least(l.completed_units, l.required_units))::integer AS completed_units,
      count(*)::integer AS total_leaders,
      count(*) FILTER (
        WHERE l.required_units > 0 AND l.completed_units >= l.required_units
      )::integer AS completed_leaders
    FROM checkpoint_dates d
    JOIN leader_checkpoints l ON l.due_on = d.due_on
    GROUP BY d.due_on, d.checkpoint_label
  ), numbered AS (
    SELECT row_number() OVER (ORDER BY due_on)::integer AS checkpoint_number, *
    FROM totals
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'checkpoint_number', checkpoint_number,
    'due_on', due_on,
    'label', coalesce(checkpoint_label, 'Programme checkpoint'),
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

REVOKE ALL ON FUNCTION public.get_sponsor_programme_progress(uuid, date)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_sponsor_programme_journey(uuid, date)
  FROM PUBLIC, anon, authenticated;