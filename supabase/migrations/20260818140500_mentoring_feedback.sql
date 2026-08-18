-- Mentor's post-session feedback form: the same 8 ICF competency categories
-- peer_session_competency_feedback rates numerically (20260430154641_*.sql),
-- but as free text per the task's explicit requirement (a form, not a
-- rating). Fixed typed columns rather than a jsonb blob, matching every
-- other feedback-shaped table in this schema — see plan discussion.
--
-- mentor_id/mentee_id are denormalized from mentoring_sessions (same as
-- peer_session_competency_feedback denormalizes peer_coach_id/
-- peer_coachee_id) so RLS policies don't need a join on every check.

CREATE TABLE IF NOT EXISTS public.mentoring_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mentoring_session_id UUID NOT NULL UNIQUE REFERENCES public.mentoring_sessions(id) ON DELETE CASCADE,
  mentor_id UUID NOT NULL,
  mentee_id UUID NOT NULL,
  ethical_practice TEXT,
  coaching_mindset TEXT,
  maintains_agreements TEXT,
  trust_safety TEXT,
  maintains_presence TEXT,
  listens_actively TEXT,
  evokes_awareness TEXT,
  facilitates_growth TEXT,
  overall_notes TEXT,
  submitted_by UUID NOT NULL,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.mentoring_feedback ENABLE ROW LEVEL SECURITY;

CREATE POLICY "MentoringFeedback: mentor insert own"
  ON public.mentoring_feedback FOR INSERT TO authenticated
  WITH CHECK (
    submitted_by = auth.uid()
    AND mentor_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.mentoring_sessions ms
      WHERE ms.id = mentoring_session_id AND ms.mentor_id = auth.uid()
    )
  );

CREATE POLICY "MentoringFeedback: mentor update own"
  ON public.mentoring_feedback FOR UPDATE TO authenticated
  USING (mentor_id = auth.uid());

CREATE POLICY "MentoringFeedback: mentee view own"
  ON public.mentoring_feedback FOR SELECT TO authenticated
  USING (mentee_id = auth.uid());

CREATE POLICY "MentoringFeedback: admin manage"
  ON public.mentoring_feedback FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER mentoring_feedback_updated_at
  BEFORE UPDATE ON public.mentoring_feedback
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Second half of the hard gate (belt-and-suspenders alongside the
-- mentoring_sessions completion trigger): feedback cannot be submitted
-- before the mentee's prep file exists either.
CREATE OR REPLACE FUNCTION public.enforce_mentoring_feedback_requires_prep_file()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.mentoring_sessions ms
    WHERE ms.id = NEW.mentoring_session_id AND ms.prep_file_path IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Cannot submit mentoring feedback: preparation file has not been submitted for this session';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_mentoring_feedback_prep_gate
  BEFORE INSERT ON public.mentoring_feedback
  FOR EACH ROW EXECUTE FUNCTION public.enforce_mentoring_feedback_requires_prep_file();

-- Stamps the parent session so the frontend save hook stays a single insert
-- and alertScan.ts can check a column instead of an existence join.
CREATE OR REPLACE FUNCTION public.set_mentoring_feedback_submitted_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.mentoring_sessions SET feedback_submitted_at = now() WHERE id = NEW.mentoring_session_id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_mentoring_feedback_stamp_session
  AFTER INSERT ON public.mentoring_feedback
  FOR EACH ROW EXECUTE FUNCTION public.set_mentoring_feedback_submitted_at();
