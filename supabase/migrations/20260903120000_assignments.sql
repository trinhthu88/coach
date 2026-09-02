-- Phase 2 (assignments & quizzes), part 1: one assignment (quiz or open-text
-- reflection) per training_week (Phase 1). quiz_questions and
-- assignment_submissions (next migrations) hang off each assignment.
CREATE TYPE public.assignment_type AS ENUM ('quiz', 'reflection');

CREATE TABLE public.assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  training_week_id UUID NOT NULL REFERENCES public.training_weeks(id) ON DELETE CASCADE,
  assignment_type public.assignment_type NOT NULL,
  title TEXT NOT NULL,
  title_vi TEXT,
  instructions TEXT,
  instructions_vi TEXT,
  is_visible BOOLEAN NOT NULL DEFAULT false,
  due_offset_days INT DEFAULT 7,        -- Days after the training week's unlock_date
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Assignments: admin manage" ON public.assignments
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Assignments: enrolled users view" ON public.assignments
  FOR SELECT TO authenticated
  USING (
    is_visible = true
    AND EXISTS (
      SELECT 1 FROM public.training_weeks tw
      JOIN public.programme_enrollments pe ON pe.programme_id = tw.programme_id
      WHERE tw.id = assignments.training_week_id
        AND pe.user_id = auth.uid()
        AND pe.status = 'active'
        AND (tw.unlock_date IS NULL OR tw.unlock_date <= CURRENT_DATE)
    )
    AND public.has_programme_module('quiz'::programme_module_type)
  );

CREATE TRIGGER trg_assignments_updated BEFORE UPDATE ON public.assignments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX idx_assignments_week ON public.assignments(training_week_id);
