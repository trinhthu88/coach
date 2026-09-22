-- ===========================================================================
-- Make the legacy Training child-evidence configuration explicit.
-- ===========================================================================
--
-- Before learning_components was exposed in Admin, Training modules were
-- stored with a null value. The canonical child-item projection intentionally
-- treats that legacy shape conservatively: Quiz and Daily Prompt evidence is
-- only applicable when the corresponding standalone module is required.
--
-- The existing programmes already contain visible Quiz and Daily Prompt
-- content in their selected Training weeks. Opt those legacy Training
-- configurations into the four supported child evidence types explicitly.
-- This changes only the breakdown projection; Training's selected-week
-- requirement and overall denominator remain unchanged.
--
-- Do not overwrite an explicit Admin selection. Hidden weeks and hidden child
-- content remain excluded by canonical_learning_items().
-- ===========================================================================

UPDATE public.programme_modules pm
SET config = jsonb_set(
  coalesce(pm.config, '{}'::jsonb),
  '{learning_components}',
  '["skill_cards", "quizzes", "reflections", "daily_prompts"]'::jsonb,
  true
)
WHERE pm.module = 'training'::public.programme_module_type
  AND pm.enabled
  AND coalesce((pm.config->>'required')::boolean, false)
  AND jsonb_typeof(pm.config->'learning_components') IS DISTINCT FROM 'array'
  AND EXISTS (
    SELECT 1
    FROM public.training_weeks tw
    JOIN public.assignments a
      ON a.training_week_id = tw.id
     AND a.assignment_type = 'quiz'::public.assignment_type
     AND a.is_visible
    WHERE tw.programme_id = pm.programme_id
      AND tw.is_visible
      AND (pm.config->'distribution_settings'->'training_week_ids') ? tw.id::text
  )
  AND EXISTS (
    SELECT 1
    FROM public.training_weeks tw
    JOIN public.daily_prompts dp
      ON dp.training_week_id = tw.id
     AND dp.is_visible
    WHERE tw.programme_id = pm.programme_id
      AND tw.is_visible
      AND (pm.config->'distribution_settings'->'training_week_ids') ? tw.id::text
  );
