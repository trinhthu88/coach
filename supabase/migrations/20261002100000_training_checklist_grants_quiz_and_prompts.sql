-- The Training module's "Learning inside each week" checklist
-- (config.learning_components) is the one switch for a week's Quiz and Daily
-- Prompts.
--
-- Progress already reads it (canonical_learning_items counts a week's quiz
-- and prompts when the checklist names them), but the learner's own reads
-- were still gated on the separate, legacy `quiz` / `daily_prompt` modules
-- through has_programme_module(): the RLS on assignments and daily_prompts,
-- and get_todays_prompt(). A programme that ticked Quizzes and Daily Prompts
-- inside Training -- every programme since 20260930100000 -- therefore showed
-- "0/5 prompts" and a quiz row, while the learner could open neither.
--
-- Now: when a learner's programme has an enabled Training module, its
-- checklist decides `quiz` (component 'quizzes') and `daily_prompt`
-- (component 'daily_prompts'). The separate modules only still answer for a
-- programme without Training. Every other module is unchanged.

CREATE OR REPLACE FUNCTION public.has_programme_module(p_module programme_module_type)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.programme_enrollments pe
    JOIN public.programme_modules pm
      ON pm.programme_id = pe.programme_id
     AND pm.enabled = true
    LEFT JOIN public.programme_modules tr
      ON tr.programme_id = pe.programme_id
     AND tr.module = 'training'
     AND tr.enabled = true
    WHERE pe.user_id = auth.uid()
      AND pe.status = 'active'
      AND CASE
        WHEN p_module IN ('quiz', 'daily_prompt') AND tr.id IS NOT NULL THEN
          pm.id = tr.id
          AND coalesce(tr.config->'learning_components', '[]'::jsonb)
              ? CASE p_module WHEN 'quiz' THEN 'quizzes' ELSE 'daily_prompts' END
        ELSE pm.module = p_module
      END
  );
$function$;
