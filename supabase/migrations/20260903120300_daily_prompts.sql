-- Phase 2 (daily prompts & nudges), part 1: the seven prompt texts (one per
-- day_number) admin authors per training_week. daily_prompt_responses (next
-- migration) tracks per-user open/response state against these.
CREATE TABLE public.daily_prompts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  training_week_id UUID NOT NULL REFERENCES public.training_weeks(id) ON DELETE CASCADE,
  day_number INT NOT NULL CHECK (day_number BETWEEN 1 AND 7),
  prompt_text TEXT NOT NULL,
  prompt_text_vi TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (training_week_id, day_number)
);

ALTER TABLE public.daily_prompts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Daily prompts: admin manage" ON public.daily_prompts
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Daily prompts: enrolled users view" ON public.daily_prompts
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.training_weeks tw
      JOIN public.programme_enrollments pe ON pe.programme_id = tw.programme_id
      WHERE tw.id = daily_prompts.training_week_id
        AND pe.user_id = auth.uid()
        AND pe.status = 'active'
    )
    AND public.has_programme_module('daily_prompt'::programme_module_type)
  );

CREATE INDEX idx_daily_prompts_week ON public.daily_prompts(training_week_id);
