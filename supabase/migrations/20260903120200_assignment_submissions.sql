-- Phase 2 (assignments & quizzes), part 3: one submission per (assignment,
-- user) — the UNIQUE constraint is what actually prevents re-submission, not
-- application code. Quiz submissions are auto-scored server-side by the
-- trigger below so a client can't fabricate its own score_pct.
CREATE TABLE public.assignment_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id UUID NOT NULL REFERENCES public.assignments(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- For quiz type: {question_id: selected_option_id, ...}
  answers JSONB NOT NULL DEFAULT '{}',
  -- For reflection type: open text
  reflection_text TEXT,
  -- Auto-calculated for quiz type (percentage 0-100)
  score_pct NUMERIC,
  correct_count INT,
  total_count INT,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (assignment_id, user_id)
);

ALTER TABLE public.assignment_submissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Submissions: user manage own" ON public.assignment_submissions
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Submissions: admin view all" ON public.assignment_submissions
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

-- No direct RLS policy for sponsors — aggregated submission data (Module 6)
-- is exposed through SECURITY DEFINER functions only, same pattern as the
-- other sponsor_* functions.

CREATE INDEX idx_submissions_user ON public.assignment_submissions(user_id);
CREATE INDEX idx_submissions_assignment ON public.assignment_submissions(assignment_id);

CREATE OR REPLACE FUNCTION public.score_quiz_submission()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _assignment_type public.assignment_type;
  _correct INT := 0;
  _total INT := 0;
  _q RECORD;
BEGIN
  SELECT assignment_type INTO _assignment_type
  FROM public.assignments WHERE id = NEW.assignment_id;

  IF _assignment_type = 'quiz' THEN
    FOR _q IN
      SELECT id, options FROM public.quiz_questions
      WHERE assignment_id = NEW.assignment_id
    LOOP
      _total := _total + 1;
      IF EXISTS (
        SELECT 1 FROM jsonb_array_elements(_q.options) opt
        WHERE (opt->>'is_correct')::boolean = true
          AND opt->>'id' = NEW.answers->>(_q.id::text)
      ) THEN
        _correct := _correct + 1;
      END IF;
    END LOOP;

    NEW.correct_count := _correct;
    NEW.total_count := _total;
    NEW.score_pct := CASE WHEN _total > 0 THEN ROUND((_correct::numeric / _total) * 100, 1) ELSE 0 END;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_score_quiz_submission
  BEFORE INSERT ON public.assignment_submissions
  FOR EACH ROW EXECUTE FUNCTION public.score_quiz_submission();
