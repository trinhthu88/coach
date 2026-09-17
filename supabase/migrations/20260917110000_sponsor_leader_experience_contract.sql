-- Sponsor Leader Detail experience contract.
--
-- This is additive to the dedicated Leader Detail contract. It keeps the
-- existing progress, journey, and engagement functions unchanged while
-- exposing the two remaining sponsor-safe data shapes the page needs:
--   * activity grouped into the same schedule-derived programme weeks
--   * configured, visible learning content grouped by content type
--
-- No content, answers, reflection text, notes, comments, or identities other
-- than the already sponsor-safe learner scope are returned.

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
  WITH progress AS (
    SELECT *
    FROM public.sponsor_canonical_leader_progress(p_enrollment_id, p_as_of)
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
  learning_weeks AS (
    SELECT
      e.enrollment_id,
      tw.id AS training_week_id,
      tw.week_number,
      tw.is_visible,
      tw.skill_card_visible,
      coalesce(cwo.is_visible, true) AS override_visible,
      coalesce(
        cwo.unlock_date,
        CASE WHEN e.cohort_id IS NOT NULL
          THEN (e.programme_start_date + ((tw.week_number - 1) * interval '7 days'))::date
          ELSE NULL
        END,
        tw.unlock_date
      ) AS effective_unlock_date
    FROM eligible e
    JOIN public.training_weeks tw ON tw.programme_id = e.programme_id
    LEFT JOIN public.cohort_week_overrides cwo
      ON cwo.cohort_id = e.cohort_id
     AND cwo.training_week_id = tw.id
  ),
  learning_items AS (
    SELECT
      'skill_cards'::text AS item_type,
      lw.training_week_id AS item_id,
      lw.effective_unlock_date AS due_on,
      tp.completed_at IS NOT NULL AS completed
    FROM learning_weeks lw
    JOIN public.programme_modules pm
      ON pm.programme_id = (SELECT programme_id FROM eligible)
     AND pm.module = 'training'::public.programme_module_type
     AND pm.enabled = true
    LEFT JOIN public.training_progress tp
      ON tp.enrollment_id = lw.enrollment_id
     AND tp.training_week_id = lw.training_week_id
    WHERE lw.is_visible
      AND lw.skill_card_visible
      AND lw.override_visible

    UNION ALL

    SELECT
      'quizzes'::text,
      a.id,
      CASE WHEN lw.effective_unlock_date IS NULL THEN NULL
        ELSE lw.effective_unlock_date + coalesce(a.due_offset_days, 7)
      END,
      asub.submitted_at IS NOT NULL
    FROM learning_weeks lw
    JOIN public.programme_modules pm
      ON pm.programme_id = (SELECT programme_id FROM eligible)
     AND pm.module = 'quiz'::public.programme_module_type
     AND pm.enabled = true
    JOIN public.assignments a
      ON a.training_week_id = lw.training_week_id
     AND a.assignment_type = 'quiz'::public.assignment_type
     AND a.is_visible = true
    LEFT JOIN public.assignment_submissions asub
      ON asub.enrollment_id = lw.enrollment_id
     AND asub.assignment_id = a.id
    WHERE lw.is_visible
      AND lw.override_visible

    UNION ALL

    SELECT
      'reflections'::text,
      pr.id,
      CASE WHEN lw.effective_unlock_date IS NULL THEN NULL
        ELSE lw.effective_unlock_date + 6
      END,
      rs.submitted_at IS NOT NULL
    FROM learning_weeks lw
    JOIN public.programme_modules pm
      ON pm.programme_id = (SELECT programme_id FROM eligible)
     AND pm.module = 'training'::public.programme_module_type
     AND pm.enabled = true
    JOIN public.programme_reflections pr
      ON pr.programme_id = (SELECT programme_id FROM eligible)
     AND pr.appears_at_week = lw.week_number
     AND pr.is_visible = true
    LEFT JOIN public.reflection_submissions rs
      ON rs.enrollment_id = lw.enrollment_id
     AND rs.reflection_id = pr.id
    WHERE lw.is_visible
      AND lw.override_visible

    UNION ALL

    SELECT
      'daily_prompts'::text,
      dp.id,
      CASE WHEN lw.effective_unlock_date IS NULL THEN NULL
        ELSE lw.effective_unlock_date + (dp.day_offset - 1)
      END,
      dpr.responded_at IS NOT NULL
    FROM learning_weeks lw
    JOIN public.programme_modules pm
      ON pm.programme_id = (SELECT programme_id FROM eligible)
     AND pm.module = 'daily_prompt'::public.programme_module_type
     AND pm.enabled = true
    JOIN public.daily_prompts dp ON dp.training_week_id = lw.training_week_id
    LEFT JOIN public.daily_prompt_responses dpr
      ON dpr.enrollment_id = lw.enrollment_id
     AND dpr.daily_prompt_id = dp.id
    WHERE lw.is_visible
      AND lw.override_visible
  ),
  learning_keys AS (
    SELECT *
    FROM (VALUES
      ('skill_cards'::text, 'Skill Cards'::text),
      ('quizzes'::text, 'Quizzes'::text),
      ('reflections'::text, 'Reflections'::text),
      ('daily_prompts'::text, 'Daily Prompts'::text)
    ) AS keys(item_type, label)
  ),
  learning AS (
    SELECT
      k.item_type,
      k.label,
      count(li.item_id)::integer AS required_units,
      count(li.item_id) FILTER (WHERE li.due_on IS NOT NULL AND li.due_on <= p_as_of)::integer AS due_units,
      least(
        count(li.item_id),
        count(li.item_id) FILTER (WHERE li.completed)
      )::integer AS completed_units,
      max(li.due_on) AS last_due_on
    FROM learning_keys k
    LEFT JOIN learning_items li ON li.item_type = k.item_type
    GROUP BY k.item_type, k.label
  ),
  engagement AS (
    SELECT to_jsonb(es) AS value
    FROM public.sponsor_leader_engagement_summary(p_enrollment_id) es
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
      END AS utilisation_pct
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
      coalesce((SELECT to_jsonb(c) FROM coaching c), '{}'::jsonb),
      'engagement',
      coalesce((SELECT value FROM engagement), '{}'::jsonb)
    )
  END;
$$;

REVOKE ALL ON FUNCTION public.sponsor_canonical_leader_experience(uuid, date)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sponsor_canonical_leader_experience(uuid, date)
  TO authenticated;