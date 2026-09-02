-- Phase 2 (daily prompts & nudges), part 2: per-user open/response tracking
-- for daily_prompts, driving the dashboard DailyPromptCard and (later,
-- Module 6) open-rate / response-rate / confidence-trend reporting.
CREATE TABLE public.daily_prompt_responses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  daily_prompt_id UUID NOT NULL REFERENCES public.daily_prompts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  opened_at TIMESTAMPTZ,
  response_text TEXT,
  confidence_score SMALLINT CHECK (confidence_score BETWEEN 1 AND 10),
  responded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (daily_prompt_id, user_id)
);

ALTER TABLE public.daily_prompt_responses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Prompt responses: user manage own" ON public.daily_prompt_responses
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Prompt responses: admin view all" ON public.daily_prompt_responses
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE INDEX idx_prompt_responses_user ON public.daily_prompt_responses(user_id);
