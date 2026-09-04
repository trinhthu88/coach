-- Quiz integrity fixes, found during a Phase 2 audit:
--
-- 1. quiz_questions' "enrolled users view" policy (20260903120100) grants
--    row-level SELECT on the whole row, including options[].is_correct and
--    explanation — so any enrolled participant could read the answer key
--    straight off the quiz_questions table (e.g. via the network tab)
--    before ever submitting, regardless of what the quiz-taking UI chooses
--    to render. RLS can't mask individual JSONB keys, so the fix is to
--    withdraw direct table access for participants and serve questions
--    through get_quiz_questions() instead, which only reveals is_correct /
--    explanation once the caller already has a submission for that quiz.
--
-- 2. assignment_submissions' "user manage own" policy (20260903120200) is
--    FOR ALL, so it also grants UPDATE and DELETE on a user's own rows.
--    Combined with the UNIQUE(assignment_id, user_id) constraint, that lets
--    a participant delete-and-reinsert (or directly UPDATE) their own quiz
--    submission to retake it or overwrite score_pct/correct_count/answers
--    outright via the client SDK — the score_quiz_submission trigger only
--    runs BEFORE INSERT, so an UPDATE bypasses auto-scoring entirely. This
--    breaks the "cannot retake" rule and the "client can't fabricate its
--    own score" guarantee the original migration's comment promised.
--    Reflections legitimately need UPDATE (ReflectionView lets a user edit
--    their reflection_text after submitting), so the fix is a trigger that
--    blocks UPDATE/DELETE only for quiz-type submissions, not a blanket
--    RLS change.

-- ---- Fix 1: withdraw direct participant SELECT on quiz_questions ----

DROP POLICY IF EXISTS "Quiz questions: enrolled users view" ON public.quiz_questions;

-- Returns a quiz's questions for the calling user: options stripped of
-- is_correct and explanation nulled out until they've already submitted
-- that assignment, matching what the quiz-taking UI shows either way but
-- now also true of the data actually sent over the wire.
CREATE OR REPLACE FUNCTION public.get_quiz_questions(p_assignment_id uuid)
RETURNS TABLE (
  id uuid,
  question_text text,
  question_text_vi text,
  options jsonb,
  explanation text,
  explanation_vi text,
  sort_order int
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH access AS (
    SELECT EXISTS (
      SELECT 1 FROM public.assignments a
      JOIN public.training_weeks tw ON tw.id = a.training_week_id
      JOIN public.programme_enrollments pe ON pe.programme_id = tw.programme_id
      WHERE a.id = p_assignment_id
        AND a.is_visible = true
        AND pe.user_id = auth.uid()
        AND pe.status = 'active'
    ) AS enrolled
  ),
  submitted AS (
    SELECT EXISTS (
      SELECT 1 FROM public.assignment_submissions s
      WHERE s.assignment_id = p_assignment_id AND s.user_id = auth.uid()
    ) AS done
  )
  SELECT
    q.id,
    q.question_text,
    q.question_text_vi,
    CASE WHEN submitted.done
      THEN q.options
      ELSE (SELECT jsonb_agg(opt - 'is_correct' ORDER BY ord) FROM jsonb_array_elements(q.options) WITH ORDINALITY AS t(opt, ord))
    END AS options,
    CASE WHEN submitted.done THEN q.explanation ELSE NULL END,
    CASE WHEN submitted.done THEN q.explanation_vi ELSE NULL END,
    q.sort_order
  FROM public.quiz_questions q, access, submitted
  WHERE q.assignment_id = p_assignment_id
    AND access.enrolled
  ORDER BY q.sort_order;
$$;

REVOKE EXECUTE ON FUNCTION public.get_quiz_questions(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_quiz_questions(uuid) TO authenticated;

-- ---- Fix 2: block modifying/deleting a quiz submission once scored ----

CREATE OR REPLACE FUNCTION public.prevent_quiz_resubmission()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _type public.assignment_type;
BEGIN
  SELECT assignment_type INTO _type FROM public.assignments WHERE id = OLD.assignment_id;
  IF _type = 'quiz' THEN
    RAISE EXCEPTION 'Quiz submissions cannot be changed or deleted once submitted';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_prevent_quiz_resubmission
  BEFORE UPDATE OR DELETE ON public.assignment_submissions
  FOR EACH ROW EXECUTE FUNCTION public.prevent_quiz_resubmission();
