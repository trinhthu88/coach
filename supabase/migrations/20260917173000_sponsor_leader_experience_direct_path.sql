-- The optional Leader Detail enrichment must not re-run the full progress
-- engine. Progress and checkpoints are already loaded through their canonical
-- contracts; this function only returns configured learning counts and the
-- next sponsor-safe booking for the already-authorized enrollment.

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
  WITH sponsor AS (
    SELECT sp.organization_id
    FROM public.sponsor_profiles sp
    WHERE sp.user_id = auth.uid()
      AND auth.uid() IS NOT NULL
  ),
  eligible AS (
    SELECT e.id AS enrollment_id, e.programme_id, e.cohort_id,
      c.organization_id, c.start_date AS programme_start_date
    FROM public.programme_enrollments e
    JOIN public.cohorts c ON c.id = e.cohort_id
    JOIN sponsor s ON s.organization_id = c.organization_id
    WHERE e.id = p_enrollment_id
      AND (
        SELECT count(*)
        FROM public.programme_enrollments same_cohort
        WHERE same_cohort.cohort_id = e.cohort_id
      ) >= public.sponsor_min_leaders_for_distribution()
  ),
  learning_weeks AS (
    SELECT e.enrollment_id, tw.id AS training_week_id, tw.week_number,
      tw.is_visible, tw.skill_card_visible,
      coalesce(cwo.is_visible, true) AS override_visible,
      coalesce(
        cwo.unlock_date,
        (e.programme_start_date + ((tw.week_number - 1) * interval '7 days'))::date,
        tw.unlock_date
      ) AS effective_unlock_date
    FROM eligible e
    JOIN public.training_weeks tw ON tw.programme_id = e.programme_id
    LEFT JOIN public.cohort_week_overrides cwo
      ON cwo.cohort_id = e.cohort_id
     AND cwo.training_week_id = tw.id
  ),
  learning_items AS (
    SELECT 'skill_cards'::text AS item_type, lw.training_week_id AS item_id,
      lw.effective_unlock_date AS due_on,
      tp.completed_at IS NOT NULL AS completed
    FROM learning_weeks lw
    LEFT JOIN public.training_progress tp
      ON tp.enrollment_id = lw.enrollment_id
     AND tp.training_week_id = lw.training_week_id
    WHERE lw.is_visible
      AND lw.skill_card_visible
      AND lw.override_visible
      AND EXISTS (
        SELECT 1 FROM public.programme_modules pm
        WHERE pm.programme_id = (SELECT programme_id FROM eligible)
          AND pm.module = 'training'::public.programme_module_type
          AND pm.enabled
      )

    UNION ALL

    SELECT 'quizzes'::text, a.id,
      CASE WHEN lw.effective_unlock_date IS NULL THEN NULL
        ELSE lw.effective_unlock_date + coalesce(a.due_offset_days, 7)
      END,
      asub.submitted_at IS NOT NULL
    FROM learning_weeks lw
    JOIN public.assignments a
      ON a.training_week_id = lw.training_week_id
     AND a.assignment_type = 'quiz'::public.assignment_type
     AND a.is_visible
    LEFT JOIN public.assignment_submissions asub
      ON asub.enrollment_id = lw.enrollment_id
     AND asub.assignment_id = a.id
    WHERE lw.is_visible
      AND lw.override_visible
      AND EXISTS (
        SELECT 1 FROM public.programme_modules pm
        WHERE pm.programme_id = (SELECT programme_id FROM eligible)
          AND pm.module = 'quiz'::public.programme_module_type
          AND pm.enabled
      )

    UNION ALL

    SELECT 'reflections'::text, pr.id,
      CASE WHEN lw.effective_unlock_date IS NULL THEN NULL
        ELSE lw.effective_unlock_date + 6
      END,
      rs.submitted_at IS NOT NULL
    FROM learning_weeks lw
    JOIN public.programme_reflections pr
      ON pr.programme_id = (SELECT programme_id FROM eligible)
     AND pr.appears_at_week = lw.week_number
     AND pr.is_visible
    LEFT JOIN public.reflection_submissions rs
      ON rs.enrollment_id = lw.enrollment_id
     AND rs.reflection_id = pr.id
    WHERE lw.is_visible
      AND lw.override_visible
      AND EXISTS (
        SELECT 1 FROM public.programme_modules pm
        WHERE pm.programme_id = (SELECT programme_id FROM eligible)
          AND pm.module = 'training'::public.programme_module_type
          AND pm.enabled
      )

    UNION ALL

    SELECT 'daily_prompts'::text, dp.id,
      CASE WHEN lw.effective_unlock_date IS NULL THEN NULL
        ELSE lw.effective_unlock_date + (dp.day_offset - 1)
      END,
      dpr.responded_at IS NOT NULL
    FROM learning_weeks lw
    JOIN public.daily_prompts dp ON dp.training_week_id = lw.training_week_id
    LEFT JOIN public.daily_prompt_responses dpr
      ON dpr.enrollment_id = lw.enrollment_id
     AND dpr.daily_prompt_id = dp.id
    WHERE lw.is_visible
      AND lw.override_visible
      AND EXISTS (
        SELECT 1 FROM public.programme_modules pm
        WHERE pm.programme_id = (SELECT programme_id FROM eligible)
          AND pm.module = 'daily_prompt'::public.programme_module_type
          AND pm.enabled
      )
  ),
  learning_keys AS (
    SELECT * FROM (VALUES
      ('skill_cards'::text, 'Skill Cards'::text),
      ('quizzes'::text, 'Quizzes'::text),
      ('reflections'::text, 'Reflections'::text),
      ('daily_prompts'::text, 'Daily Prompts'::text)
    ) AS keys(item_type, label)
  ),
  learning AS (
    SELECT k.item_type, k.label,
      count(li.item_id)::integer AS required_units,
      count(li.item_id) FILTER (
        WHERE li.due_on IS NOT NULL AND li.due_on <= p_as_of
      )::integer AS due_units,
      least(
        count(li.item_id),
        count(li.item_id) FILTER (WHERE li.completed)
      )::integer AS completed_units,
      max(li.due_on) AS last_due_on
    FROM learning_keys k
    LEFT JOIN learning_items li ON li.item_type = k.item_type
    GROUP BY k.item_type, k.label
  ),
  next_booking AS (
    SELECT min(s.start_time) AS next_session_at
    FROM public.sessions s
    JOIN eligible e ON e.enrollment_id = s.enrollment_id
    WHERE s.status IN ('pending_coach_approval', 'confirmed')
      AND s.start_time >= now()
  )
  SELECT CASE
    WHEN NOT EXISTS (SELECT 1 FROM eligible) THEN '{}'::jsonb
    ELSE jsonb_build_object(
      'weekly_participation', '[]'::jsonb,
      'learning_breakdown',
      coalesce((
        SELECT jsonb_agg(jsonb_build_object(
          'key', l.item_type,
          'label', l.label,
          'required_units', l.required_units,
          'due_units', l.due_units,
          'completed_units', l.completed_units,
          'progress_available', l.required_units > 0,
          'status', CASE
            WHEN l.required_units = 0 THEN 'unavailable'
            WHEN l.completed_units >= l.required_units THEN 'completed'
            WHEN l.due_units = 0 THEN 'upcoming'
            WHEN l.last_due_on IS NOT NULL AND p_as_of <= l.last_due_on THEN 'current'
            ELSE 'overdue'
          END
        ) ORDER BY l.item_type)
        FROM learning l
      ), '[]'::jsonb),
      'coaching_utilisation',
      jsonb_build_object(
        'required_units', NULL,
        'completed_units', NULL,
        'due_units', NULL,
        'booked_units', NULL,
        'utilisation_pct', NULL,
        'next_session_at', (SELECT next_session_at FROM next_booking)
      )
    )
  END;
$$;

REVOKE ALL ON FUNCTION public.sponsor_canonical_leader_experience(uuid, date)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sponsor_canonical_leader_experience(uuid, date)
  TO authenticated;