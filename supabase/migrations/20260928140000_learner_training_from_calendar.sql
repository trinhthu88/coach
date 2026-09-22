-- ===========================================================================
-- Learner Training page reads the programme and the requirement calendar.
-- ===========================================================================
--
-- ROOT CAUSE. get_enrollment_training_weeks() (the learner Training page and
-- the dashboard training card) returned weeks only when an
-- enrollment_module_snapshots row existed for Training. Snapshots are
-- HISTORICAL (docs/architecture/source-of-truth.md: never read by a
-- current-state surface): an enrollment created before the programme gained
-- its Training module -- every demo enrollment -- had no snapshot, so the
-- Training page said "No training weeks are available yet" while the
-- canonical engine, the Dashboard and the Sponsor all counted Training 8/8.
--
-- After this migration:
--   * the page shows the weeks the PROGRAMME selects for Training (enabled
--     module, config.distribution_settings.training_week_ids; hidden weeks and
--     cohort-hidden weeks excluded), for the learner's own enrollment;
--   * each week carries its canonical Training requirement (id, due date and
--     state) from canonical_enrollment_requirement_calendar -- the same row
--     the Dashboard, checkpoints and Sponsor count;
--   * child learning evidence per week comes from canonical_learning_items,
--     the item-level source canonical_learning_breakdown now aggregates (one
--     definition of "applicable child item" for every role).
-- Content unlocking (locked / effective_unlock_date) is unchanged: it is a
-- content-availability rule, not a requirement date.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Item-level child learning evidence (the breakdown's single source)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.canonical_learning_items(p_enrollment_id uuid, p_as_of date DEFAULT CURRENT_DATE)
RETURNS TABLE (training_week_id uuid, item_type text, item_id uuid, due_on date, completed boolean)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  WITH enrollment AS (
    SELECT e.id AS enrollment_id, e.programme_id, e.cohort_id, c.start_date AS programme_start_date
    FROM public.programme_enrollments e
    JOIN public.cohorts c ON c.id = e.cohort_id
    WHERE e.id = p_enrollment_id
  ), training AS (
    SELECT e.*, pm.config,
      CASE WHEN jsonb_typeof(pm.config->'learning_components') = 'array'
        THEN pm.config->'learning_components' END AS components
    FROM enrollment e
    JOIN public.programme_modules pm
      ON pm.programme_id = e.programme_id
     AND pm.module = 'training'::public.programme_module_type
     AND pm.enabled
     AND coalesce((pm.config->>'required')::boolean, false)
  ), applicable AS (
    SELECT
      CASE WHEN t.components IS NOT NULL THEN t.components ? 'quizzes'
        ELSE EXISTS (SELECT 1 FROM public.programme_modules q
                     WHERE q.programme_id = t.programme_id AND q.module = 'quiz'::public.programme_module_type
                       AND q.enabled AND coalesce((q.config->>'required')::boolean, false)) END AS quizzes,
      CASE WHEN t.components IS NOT NULL THEN t.components ? 'reflections' ELSE true END AS reflections,
      CASE WHEN t.components IS NOT NULL THEN t.components ? 'daily_prompts'
        ELSE EXISTS (SELECT 1 FROM public.programme_modules q
                     WHERE q.programme_id = t.programme_id AND q.module = 'daily_prompt'::public.programme_module_type
                       AND q.enabled AND coalesce((q.config->>'required')::boolean, false)) END AS daily_prompts
    FROM training t
  ), weeks AS (
    SELECT t.enrollment_id, t.programme_id, t.cohort_id, tw.id AS training_week_id, tw.week_number,
      coalesce(d.due_on,
        coalesce(cwo.unlock_date, (t.programme_start_date + ((tw.week_number - 1) * interval '7 days'))::date, tw.unlock_date)
      ) AS anchor_on
    FROM training t
    CROSS JOIN LATERAL jsonb_array_elements_text(
      CASE WHEN jsonb_typeof(t.config->'distribution_settings'->'training_week_ids') = 'array'
        THEN t.config->'distribution_settings'->'training_week_ids' ELSE '[]'::jsonb END
    ) s(week_id)
    JOIN public.training_weeks tw ON tw.id::text = s.week_id AND tw.programme_id = t.programme_id
    LEFT JOIN public.cohort_week_overrides cwo ON cwo.cohort_id = t.cohort_id AND cwo.training_week_id = tw.id
    LEFT JOIN public.cohort_requirement_dates d
      ON d.cohort_id = t.cohort_id AND d.programme_id = t.programme_id
     AND d.module = 'training'::public.programme_module_type AND d.training_week_id = tw.id
    WHERE tw.is_visible AND coalesce(cwo.is_visible, true)
  )
  SELECT i.training_week_id, 'skill_cards'::text, i.item_id, i.due_on, i.completed_units > 0
  FROM public.canonical_training_learning_items(p_enrollment_id, p_as_of) i

  UNION ALL
  SELECT w.training_week_id, 'quizzes'::text, a.id, w.anchor_on + coalesce(a.due_offset_days, 7), asub.submitted_at IS NOT NULL
  FROM weeks w
  CROSS JOIN applicable ap
  JOIN public.assignments a
    ON a.training_week_id = w.training_week_id AND a.assignment_type = 'quiz'::public.assignment_type AND a.is_visible
  LEFT JOIN public.assignment_submissions asub
    ON asub.enrollment_id = p_enrollment_id AND asub.assignment_id = a.id AND asub.submitted_at::date <= p_as_of
  WHERE ap.quizzes

  UNION ALL
  SELECT w.training_week_id, 'reflections'::text, pr.id, w.anchor_on + 6, rs.submitted_at IS NOT NULL
  FROM weeks w
  CROSS JOIN applicable ap
  JOIN public.programme_reflections pr
    ON pr.programme_id = w.programme_id AND pr.appears_at_week = w.week_number AND pr.is_visible
  LEFT JOIN public.reflection_submissions rs
    ON rs.enrollment_id = p_enrollment_id AND rs.reflection_id = pr.id AND rs.submitted_at::date <= p_as_of
  WHERE ap.reflections

  UNION ALL
  SELECT w.training_week_id, 'daily_prompts'::text, dp.id, w.anchor_on + (coalesce(dp.day_offset, 1) - 1), dpr.responded_at IS NOT NULL
  FROM weeks w
  CROSS JOIN applicable ap
  JOIN public.daily_prompts dp ON dp.training_week_id = w.training_week_id AND dp.is_visible
  LEFT JOIN public.daily_prompt_responses dpr
    ON dpr.enrollment_id = p_enrollment_id AND dpr.daily_prompt_id = dp.id AND dpr.responded_at::date <= p_as_of
  WHERE ap.daily_prompts;
$function$;
REVOKE ALL ON FUNCTION public.canonical_learning_items(uuid, date) FROM PUBLIC, anon, authenticated;

-- The breakdown is now purely an aggregate of the items above (output unchanged).
CREATE OR REPLACE FUNCTION public.canonical_learning_breakdown(p_enrollment_id uuid, p_as_of date DEFAULT CURRENT_DATE)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  WITH keys AS (
    SELECT * FROM (VALUES
      ('skill_cards'::text, 'Skill Cards'::text, 1),
      ('quizzes'::text, 'Quizzes'::text, 2),
      ('reflections'::text, 'Reflections'::text, 3),
      ('daily_prompts'::text, 'Daily Prompts'::text, 4)
    ) AS x(item_type, label, ord)
  ), grouped AS (
    SELECT k.item_type, k.label, k.ord,
      count(i.item_id)::integer AS required_units,
      count(i.item_id) FILTER (WHERE i.due_on IS NOT NULL AND i.due_on <= p_as_of)::integer AS due_units,
      count(i.item_id) FILTER (WHERE i.completed AND i.due_on IS NOT NULL AND i.due_on <= p_as_of)::integer AS completed_due_units,
      count(i.item_id) FILTER (WHERE i.completed)::integer AS completed_units
    FROM keys k
    LEFT JOIN public.canonical_learning_items(p_enrollment_id, p_as_of) i ON i.item_type = k.item_type
    GROUP BY k.item_type, k.label, k.ord
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'key', g.item_type,
    'label', g.label,
    'required_units', g.required_units,
    'due_units', g.due_units,
    'completed_units', least(g.completed_units, g.required_units),
    'overdue_units', greatest(0, g.due_units - least(g.completed_due_units, g.due_units)),
    'progress_available', g.required_units > 0,
    'status', CASE
      WHEN g.required_units = 0 THEN 'unavailable'
      WHEN g.completed_units >= g.required_units THEN 'completed'
      WHEN g.due_units = 0 THEN 'upcoming'
      WHEN g.completed_due_units >= g.due_units THEN 'current'
      ELSE 'overdue'
    END
  ) ORDER BY g.ord), '[]'::jsonb)
  FROM grouped g;
$function$;

-- ---------------------------------------------------------------------------
-- 2. Learner: child evidence per week (counts only, own enrollment only)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.learner_training_week_items(p_enrollment_id uuid, p_as_of date DEFAULT CURRENT_DATE)
RETURNS TABLE (training_week_id uuid, item_type text, required_units integer, completed_units integer,
  due_units integer, overdue_units integer)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT i.training_week_id, i.item_type,
    count(*)::integer,
    count(*) FILTER (WHERE i.completed)::integer,
    count(*) FILTER (WHERE i.due_on <= p_as_of)::integer,
    count(*) FILTER (WHERE i.due_on <= p_as_of AND NOT i.completed)::integer
  FROM public.canonical_learning_items(p_enrollment_id, p_as_of) i
  WHERE EXISTS (SELECT 1 FROM public.programme_enrollments e WHERE e.id = p_enrollment_id AND e.user_id = auth.uid())
  GROUP BY i.training_week_id, i.item_type;
$$;
REVOKE ALL ON FUNCTION public.learner_training_week_items(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.learner_training_week_items(uuid, date) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. The learner's weeks: programme-selected, with their canonical requirement
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.get_enrollment_training_weeks(uuid);
CREATE FUNCTION public.get_enrollment_training_weeks(p_enrollment_id uuid)
RETURNS TABLE (
  id uuid, week_number integer, title text, title_vi text, subtitle text, subtitle_vi text,
  unlock_date date, effective_unlock_date date, locked boolean, skill_card_visible boolean,
  viewed_at timestamptz, completed_at timestamptz,
  requirement_id uuid, requirement_due_on date, requirement_state text
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $function$
  WITH enrollment AS (
    SELECT pe.id, pe.programme_id, pe.cohort_id, pe.start_date
    FROM public.programme_enrollments pe
    WHERE pe.id = p_enrollment_id AND pe.user_id = auth.uid()
  ), training AS (
    SELECT e.*, pm.config
    FROM enrollment e
    JOIN public.programme_modules pm
      ON pm.programme_id = e.programme_id AND pm.module = 'training'::public.programme_module_type AND pm.enabled
  ), weeks AS (
    -- The weeks the programme selects; a programme without a selection
    -- (legacy configuration) offers all of its weeks as content.
    SELECT t.id AS enrollment_id, t.cohort_id, t.start_date, tw.*
    FROM training t
    JOIN public.training_weeks tw ON tw.programme_id = t.programme_id
    WHERE jsonb_typeof(t.config->'distribution_settings'->'training_week_ids') IS DISTINCT FROM 'array'
       OR (t.config->'distribution_settings'->'training_week_ids') ? tw.id::text
  ), calendar AS (
    SELECT c.training_week_id, c.requirement_id, c.due_on, c.is_completed, c.is_overdue, c.is_due_as_of
    FROM public.canonical_enrollment_requirement_calendar(p_enrollment_id, CURRENT_DATE) c
    WHERE c.module = 'training'::public.programme_module_type
  )
  SELECT w.id, w.week_number, w.title, w.title_vi, w.subtitle, w.subtitle_vi, w.unlock_date,
    COALESCE(cwo.unlock_date,
      CASE WHEN w.cohort_id IS NOT NULL THEN (w.start_date + ((w.week_number - 1) * INTERVAL '7 days'))::date END,
      w.unlock_date),
    COALESCE(cwo.unlock_date,
      CASE WHEN w.cohort_id IS NOT NULL THEN (w.start_date + ((w.week_number - 1) * INTERVAL '7 days'))::date END,
      w.unlock_date) > CURRENT_DATE,
    w.skill_card_visible, tp.viewed_at, tp.completed_at,
    cal.requirement_id, cal.due_on,
    CASE
      WHEN cal.training_week_id IS NULL THEN 'not_required'
      WHEN cal.is_completed THEN 'completed'
      WHEN cal.is_overdue THEN 'overdue'
      ELSE 'upcoming'
    END
  FROM weeks w
  LEFT JOIN public.cohort_week_overrides cwo ON cwo.cohort_id = w.cohort_id AND cwo.training_week_id = w.id
  LEFT JOIN public.training_progress tp ON tp.training_week_id = w.id AND tp.enrollment_id = w.enrollment_id
  LEFT JOIN calendar cal ON cal.training_week_id = w.id
  WHERE w.is_visible = true
    AND coalesce(cwo.is_visible, true)
  ORDER BY w.week_number;
$function$;
REVOKE EXECUTE ON FUNCTION public.get_enrollment_training_weeks(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_enrollment_training_weeks(uuid) TO authenticated;
