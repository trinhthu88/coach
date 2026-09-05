-- ============================================================
-- REFLECTION MODULE — replaces assignment_type='reflection'
-- Admin-configurable questions per programme, with confidence score.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.programme_reflections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  programme_id UUID NOT NULL REFERENCES public.programmes(id) ON DELETE CASCADE,
  reflection_number INT NOT NULL,
  title TEXT NOT NULL,
  title_vi TEXT,
  instructions TEXT,
  instructions_vi TEXT,
  appears_at_week INT NOT NULL,
  is_visible BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (programme_id, reflection_number)
);

CREATE TABLE IF NOT EXISTS public.reflection_questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reflection_id UUID NOT NULL REFERENCES public.programme_reflections(id) ON DELETE CASCADE,
  question_text TEXT NOT NULL,
  question_text_vi TEXT,
  question_type TEXT NOT NULL CHECK (question_type IN ('open_text', 'scale_1_10')),
  is_required BOOLEAN NOT NULL DEFAULT true,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.reflection_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reflection_id UUID NOT NULL REFERENCES public.programme_reflections(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  confidence_score SMALLINT NOT NULL CHECK (confidence_score BETWEEN 1 AND 10),
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (reflection_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.reflection_answers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id UUID NOT NULL REFERENCES public.reflection_submissions(id) ON DELETE CASCADE,
  question_id UUID NOT NULL REFERENCES public.reflection_questions(id) ON DELETE CASCADE,
  answer_text TEXT,
  answer_value INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (submission_id, question_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_programme_reflections_programme ON public.programme_reflections(programme_id);
CREATE INDEX IF NOT EXISTS idx_reflection_questions_reflection ON public.reflection_questions(reflection_id);
CREATE INDEX IF NOT EXISTS idx_reflection_submissions_reflection ON public.reflection_submissions(reflection_id);
CREATE INDEX IF NOT EXISTS idx_reflection_submissions_user ON public.reflection_submissions(user_id);
CREATE INDEX IF NOT EXISTS idx_reflection_answers_submission ON public.reflection_answers(submission_id);

CREATE TRIGGER trg_programme_reflections_updated BEFORE UPDATE ON public.programme_reflections
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS
ALTER TABLE public.programme_reflections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reflection_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reflection_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reflection_answers ENABLE ROW LEVEL SECURITY;

-- programme_reflections
CREATE POLICY "Reflections: admin full" ON public.programme_reflections
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Reflections: participant read" ON public.programme_reflections
  FOR SELECT TO authenticated
  USING (
    is_visible = true
    AND EXISTS (
      SELECT 1 FROM public.programme_enrollments pe
      WHERE pe.user_id = auth.uid()
        AND pe.programme_id = programme_reflections.programme_id
        AND pe.status = 'active'
    )
    AND EXISTS (
      SELECT 1 FROM public.training_weeks tw
      WHERE tw.programme_id = programme_reflections.programme_id
        AND tw.week_number = programme_reflections.appears_at_week
        AND tw.is_visible = true
        AND (tw.unlock_date IS NULL OR tw.unlock_date <= CURRENT_DATE)
    )
  );

-- reflection_questions
CREATE POLICY "Reflection questions: admin full" ON public.reflection_questions
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Reflection questions: participant read" ON public.reflection_questions
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.programme_reflections pr
      JOIN public.programme_enrollments pe ON pe.programme_id = pr.programme_id
      WHERE pr.id = reflection_questions.reflection_id
        AND pe.user_id = auth.uid()
        AND pe.status = 'active'
        AND pr.is_visible = true
    )
  );

-- reflection_submissions
CREATE POLICY "Reflection submissions: user own" ON public.reflection_submissions
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Reflection submissions: admin read" ON public.reflection_submissions
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

-- reflection_answers
CREATE POLICY "Reflection answers: user own" ON public.reflection_answers
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.reflection_submissions rs
      WHERE rs.id = reflection_answers.submission_id
        AND rs.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.reflection_submissions rs
      WHERE rs.id = reflection_answers.submission_id
        AND rs.user_id = auth.uid()
    )
  );

CREATE POLICY "Reflection answers: admin read" ON public.reflection_answers
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));
