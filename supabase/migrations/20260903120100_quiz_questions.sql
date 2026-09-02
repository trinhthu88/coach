-- Phase 2 (assignments & quizzes), part 2: multiple-choice questions for a
-- 'quiz'-type assignment. `options` holds the choices inline (no separate
-- table) since they're always edited/read together with the question:
-- [{id: "a", text: "...", text_vi: "...", is_correct: true/false}, ...]
CREATE TABLE public.quiz_questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id UUID NOT NULL REFERENCES public.assignments(id) ON DELETE CASCADE,
  question_text TEXT NOT NULL,
  question_text_vi TEXT,
  options JSONB NOT NULL DEFAULT '[]',
  explanation TEXT,                    -- Shown after answering
  explanation_vi TEXT,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.quiz_questions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Quiz questions: admin manage" ON public.quiz_questions
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Quiz questions: enrolled users view" ON public.quiz_questions
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.assignments a
      JOIN public.training_weeks tw ON tw.id = a.training_week_id
      JOIN public.programme_enrollments pe ON pe.programme_id = tw.programme_id
      WHERE a.id = quiz_questions.assignment_id
        AND a.is_visible = true
        AND pe.user_id = auth.uid()
        AND pe.status = 'active'
    )
  );

CREATE INDEX idx_quiz_questions_assignment ON public.quiz_questions(assignment_id);
