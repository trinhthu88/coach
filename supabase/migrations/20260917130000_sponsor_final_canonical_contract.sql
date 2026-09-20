-- Sponsor finalization: canonical metadata and training-week completion.
--
-- The existing canonical progress family remains the source for Admin-defined
-- requirements and Cohort-defined dates. This migration adds the missing
-- sponsor-safe enrollment metadata shape so Sponsor screens no longer merge
-- legacy reporting rows into canonical progress.
--
-- Training is a week-level unit: Skill Card completion, any visible assignment
-- submission (including future assignment types), a programme reflection, or
-- a daily-prompt response can complete the selected week, but multiple records
-- for that week produce one Training activity unit.

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
  WITH selected_training_weeks AS (
    SELECT e.id AS enrollment_id, tw.id AS training_week_id
    FROM public.programme_enrollments e
    JOIN public.programme_modules pm
      ON pm.programme_id = e.programme_id
     AND pm.module = 'training'::public.programme_module_type
     AND pm.enabled
    CROSS JOIN LATERAL jsonb_array_elements_text(
      CASE
        WHEN jsonb_typeof(pm.config->'distribution_settings'->'training_week_ids') = 'array'
        THEN pm.config->'distribution_settings'->'training_week_ids'
        ELSE '[]'::jsonb
      END
    ) selected(week_id)
    JOIN public.training_weeks tw
      ON tw.id::text = selected.week_id
     AND tw.programme_id = e.programme_id
     AND tw.is_visible
    WHERE e.id = p_enrollment_id
  ), learning_completions AS (
    SELECT tp.enrollment_id, tp.training_week_id, tp.completed_at::date AS completed_on
    FROM public.training_progress tp
    JOIN selected_training_weeks stw
      ON stw.enrollment_id = tp.enrollment_id
     AND stw.training_week_id = tp.training_week_id
    WHERE tp.completed_at IS NOT NULL

    UNION ALL

    SELECT asub.enrollment_id, a.training_week_id, asub.submitted_at::date
    FROM public.assignment_submissions asub
    JOIN public.assignments a ON a.id = asub.assignment_id
    JOIN selected_training_weeks stw
      ON stw.enrollment_id = asub.enrollment_id
     AND stw.training_week_id = a.training_week_id
    WHERE a.is_visible
      AND asub.submitted_at IS NOT NULL

    UNION ALL

    SELECT rs.enrollment_id, tw.id, rs.submitted_at::date
    FROM public.reflection_submissions rs
    JOIN public.programme_reflections pr
      ON pr.id = rs.reflection_id
     AND pr.is_visible
    JOIN public.training_weeks tw
      ON tw.programme_id = pr.programme_id
     AND tw.week_number = pr.appears_at_week
     AND tw.is_visible
    JOIN selected_training_weeks stw
      ON stw.enrollment_id = rs.enrollment_id
     AND stw.training_week_id = tw.id
    WHERE rs.submitted_at IS NOT NULL

    UNION ALL

    SELECT dpr.enrollment_id, dp.training_week_id, dpr.responded_at::date
    FROM public.daily_prompt_responses dpr
    JOIN public.daily_prompts dp ON dp.id = dpr.daily_prompt_id
    JOIN selected_training_weeks stw
      ON stw.enrollment_id = dpr.enrollment_id
     AND stw.training_week_id = dp.training_week_id
    WHERE dpr.responded_at IS NOT NULL
  ), training_week_activity AS (
    SELECT enrollment_id, min(completed_on) AS occurred_on
    FROM learning_completions
    GROUP BY enrollment_id, training_week_id
  )
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
      SELECT 1
      FROM public.peer_sessions existing_peer
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

  SELECT 'training'::public.programme_module_type, twa.occurred_on, 'completed'
  FROM training_week_activity twa;
$$;

CREATE OR REPLACE FUNCTION public.sponsor_canonical_enrollment_metadata(
  p_cohort_id uuid DEFAULT NULL,
  p_enrollment_id uuid DEFAULT NULL,
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
  triad_booked_units integer,
  goal_count integer,
  goal_setup boolean,
  goal_progress_pct numeric,
  open_action_count integer,
  completed_action_count integer,
  total_action_count integer,
  action_completion_pct numeric,
  satisfaction_avg numeric,
  satisfaction_rated_count integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH base AS (
    SELECT p.*
    FROM public.sponsor_canonical_enrollment_progress(p_cohort_id, p_as_of) p
    WHERE p_enrollment_id IS NULL OR p.enrollment_id = p_enrollment_id
  ), goals AS (
    SELECT b.enrollment_id,
      count(DISTINCT g.id)::integer AS goal_count,
      bool_or(gr.id IS NOT NULL) AS goal_setup,
      round(avg(
        CASE
          WHEN gr.target_rating IS NULL
            OR gr.start_rating IS NULL
            OR gr.target_rating = gr.start_rating
          THEN NULL
          ELSE least(100, greatest(0,
            (gr.current_rating - gr.start_rating) * 100.0
              / (gr.target_rating - gr.start_rating)
          ))
        END
      ), 1) AS goal_progress_pct
    FROM base b
    LEFT JOIN public.coachee_goals g
      ON g.enrollment_id = b.enrollment_id
    LEFT JOIN public.coachee_goal_ratings gr
      ON gr.goal_id = g.id
     AND gr.enrollment_id = b.enrollment_id
    GROUP BY b.enrollment_id
  ), actions AS (
    SELECT b.enrollment_id,
      count(a.id) FILTER (WHERE a.status IN ('open', 'in_progress'))::integer AS open_action_count,
      count(a.id) FILTER (WHERE a.status = 'completed')::integer AS completed_action_count,
      count(a.id)::integer AS total_action_count
    FROM base b
    LEFT JOIN public.enrollment_actions a
      ON a.enrollment_id = b.enrollment_id
    GROUP BY b.enrollment_id
  ), satisfaction AS (
    SELECT b.enrollment_id,
      round(avg(s.coachee_rating), 2) AS satisfaction_avg,
      count(s.id)::integer AS satisfaction_rated_count
    FROM base b
    LEFT JOIN public.sessions s
      ON s.enrollment_id = b.enrollment_id
     AND s.status = 'completed'
     AND s.coachee_rating IS NOT NULL
    GROUP BY b.enrollment_id
  )
  SELECT b.*,
    coalesce(g.goal_count, 0),
    coalesce(g.goal_setup, false),
    g.goal_progress_pct,
    coalesce(a.open_action_count, 0),
    coalesce(a.completed_action_count, 0),
    coalesce(a.total_action_count, 0),
    CASE
      WHEN coalesce(a.total_action_count, 0) = 0 THEN NULL
      ELSE round(a.completed_action_count * 100.0 / a.total_action_count, 1)
    END,
    s.satisfaction_avg,
    coalesce(s.satisfaction_rated_count, 0)
  FROM base b
  LEFT JOIN goals g ON g.enrollment_id = b.enrollment_id
  LEFT JOIN actions a ON a.enrollment_id = b.enrollment_id
  LEFT JOIN satisfaction s ON s.enrollment_id = b.enrollment_id
  ORDER BY b.cohort_label, b.learner_display_name, b.enrollment_id;
$$;

REVOKE ALL ON FUNCTION public.sponsor_canonical_enrollment_metadata(uuid, uuid, date)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sponsor_canonical_enrollment_metadata(uuid, uuid, date)
  TO authenticated;