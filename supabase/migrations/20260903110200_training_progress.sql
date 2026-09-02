-- Phase 1 (training material delivery), part 3: per-user view/completion
-- tracking for training_weeks, driving the "This week's skill card"
-- dashboard widget and the training list's completion badges.

CREATE TABLE public.training_progress (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  training_week_id UUID NOT NULL REFERENCES public.training_weeks(id) ON DELETE CASCADE,
  viewed_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  pdf_downloaded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, training_week_id)
);

ALTER TABLE public.training_progress ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Training progress: user manage own" ON public.training_progress
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Training progress: admin view all" ON public.training_progress
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE INDEX idx_training_progress_user ON public.training_progress(user_id);
