-- Phase 1 (training material delivery), part 2: interactive callouts
-- rendered inside a training_week's skill card (accordions, prompts,
-- key-concept blocks, video links, tips).

CREATE TABLE public.skill_card_elements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  training_week_id UUID NOT NULL REFERENCES public.training_weeks(id) ON DELETE CASCADE,
  element_type TEXT NOT NULL CHECK (element_type IN (
    'expandable_example',
    'try_this_prompt',
    'key_concept',
    'video_link',
    'tip'
  )),
  title TEXT NOT NULL,
  title_vi TEXT,
  content TEXT NOT NULL,
  content_vi TEXT,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.skill_card_elements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Skill card elements: admin manage" ON public.skill_card_elements
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- Users can view elements if they can view the parent training_week. Mirrors
-- training_weeks' own "enrolled users view" policy exactly (including the
-- has_programme_module check) rather than relying on this EXISTS to inherit
-- it — a fresh subquery here does not go through training_weeks' RLS.
CREATE POLICY "Skill card elements: enrolled users view" ON public.skill_card_elements
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.training_weeks tw
      JOIN public.programme_enrollments pe ON pe.programme_id = tw.programme_id
      WHERE tw.id = skill_card_elements.training_week_id
        AND tw.is_visible = true
        AND (tw.unlock_date IS NULL OR tw.unlock_date <= CURRENT_DATE)
        AND pe.user_id = auth.uid()
        AND pe.status = 'active'
    )
    AND public.has_programme_module('training'::programme_module_type)
  );

CREATE INDEX idx_skill_card_elements_week ON public.skill_card_elements(training_week_id);
