-- ===========================================================================
-- Assessor history after release (rule 4)
--
-- admin_validate_review releases a submission without ending its assignment
-- (the Admin queue keeps showing who assessed it), so the assessor still
-- matched "active assignment" after release and coach_assessment_inbox and
-- assessment_object_readable kept giving them the learner's content
-- (assessment_inbox_feedback_test 5). Active now means an open assignment on
-- a submission that is not released; after release the assessor keeps the
-- history and their own review files only.
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.coach_assessment_inbox()
 RETURNS TABLE(submission_id uuid, enrollment_id uuid, inbox_tab text, kind text, cohort_id uuid, cohort_name text,
               learner_name text, requirement_ordinal integer, attempt_no integer, status text,
               submitted_at timestamptz, assigned_at timestamptz, due_on date, is_overdue boolean,
               triad_reflection_id uuid, reflection jsonb, transcript_text text, quiz_correct integer, quiz_total integer,
               quiz_score_pct numeric, learner_files jsonb, return_reason text,
               my_latest_review_version integer, my_latest_feedback_text text, my_latest_outcome text,
               released_at timestamptz)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH mine AS (
    -- Active assignments, until release: full content.
    SELECT s.*, a.assigned_at, a.due_on, true AS active
    FROM public.assessment_submissions s
    JOIN public.assessment_assignments a ON a.submission_id = s.id AND a.ended_at IS NULL AND a.assessor_id = auth.uid()
    WHERE s.status <> 'released'
    UNION ALL
    -- Released submissions whose approved review is mine: history (no
    -- learner content once the assignment has ended).
    SELECT s.*, NULL::timestamptz, NULL::date, false
    FROM public.assessment_submissions s
    WHERE s.status = 'released'
      AND EXISTS (SELECT 1 FROM public.assessment_reviews r
                  JOIN public.assessment_validations v ON v.review_id = r.id AND v.decision = 'approved'
                  WHERE r.submission_id = s.id AND r.assessor_id = auth.uid())
  )
  SELECT m.id, m.enrollment_id,
    CASE m.status WHEN 'with_assessor' THEN 'to_assess' WHEN 'returned' THEN 'returned'
                  WHEN 'awaiting_validation' THEN 'awaiting_validation' ELSE 'released' END,
    m.kind, c.id, c.name, lp.full_name, d.ordinal, m.attempt_no, m.status, m.submitted_at,
    m.assigned_at, m.due_on,
    m.active AND m.status IN ('with_assessor', 'returned') AND m.due_on < public.programme_today(),
    CASE WHEN m.active THEN m.triad_reflection_id END,
    -- The written answers (triad_reflection_answers, by stable question id),
    -- in the shape learner_triad_session_reflections uses; the satisfaction
    -- rating is not assessed.
    CASE WHEN m.active AND tr.id IS NOT NULL THEN jsonb_build_object(
      'submitted_at', tr.submitted_at,
      'answers', coalesce((
        SELECT jsonb_agg(jsonb_build_object('question_id', q2.id, 'question_key', q2.question_key, 'section', q2.section,
                                            'question', q2.label, 'question_vi', q2.label_vi, 'answer', a2.answer_text)
                         ORDER BY array_position(ARRAY['coach', 'coachee', 'observer', 'general'], q2.section), q2.display_order)
        FROM public.triad_reflection_answers a2
        JOIN public.triad_reflection_questions q2 ON q2.id = a2.question_id
        WHERE a2.triad_reflection_id = tr.id), '[]'::jsonb)) END,
    CASE WHEN m.active THEN m.transcript_text END,
    CASE WHEN m.active THEN q.correct_count END,
    CASE WHEN m.active THEN q.total_count END,
    CASE WHEN m.active THEN q.score_pct END,
    CASE WHEN m.active THEN coalesce((
      SELECT jsonb_agg(jsonb_build_object('storage_path', f.storage_path, 'file_kind', f.file_kind, 'mime', f.mime, 'size_bytes', f.size_bytes))
      FROM public.assessment_files f WHERE f.submission_id = m.id AND f.review_id IS NULL), '[]'::jsonb) END,
    -- Admin's reason, shown to the assessor whose review was returned.
    CASE WHEN m.status = 'returned' THEN (
      SELECT v.reason FROM public.assessment_reviews r JOIN public.assessment_validations v ON v.review_id = r.id
      WHERE r.submission_id = m.id AND v.decision = 'returned' ORDER BY r.version DESC LIMIT 1) END,
    mr.version, mr.feedback_text, mr.outcome,
    m.released_at
  FROM mine m
  JOIN public.programme_enrollments e ON e.id = m.enrollment_id
  JOIN public.cohorts c ON c.id = e.cohort_id
  JOIN public.profiles lp ON lp.id = e.user_id
  JOIN public.cohort_requirement_dates d ON d.id = m.cohort_requirement_id
  LEFT JOIN public.triad_reflections tr ON tr.id = m.triad_reflection_id
  LEFT JOIN public.assignment_submissions q ON q.id = m.quiz_submission_id
  LEFT JOIN LATERAL (
    SELECT r.version, r.feedback_text, r.outcome FROM public.assessment_reviews r
    WHERE r.submission_id = m.id AND r.assessor_id = auth.uid() ORDER BY r.version DESC LIMIT 1
  ) mr ON true
  WHERE auth.uid() IS NOT NULL
  ORDER BY m.due_on NULLS LAST, m.submitted_at;
$function$;
REVOKE ALL ON FUNCTION public.coach_assessment_inbox() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.coach_assessment_inbox() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.assessment_object_readable(p_name text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  parts text[] := storage.foldername(p_name);
  v_file public.assessment_files;
  v_sub public.assessment_submissions;
  v_enrollment uuid;
BEGIN
  IF auth.uid() IS NULL OR coalesce(array_length(parts, 1), 0) < 2 THEN RETURN false; END IF;
  IF public.has_role(auth.uid(), 'admin'::public.app_role) THEN RETURN true; END IF;
  BEGIN
    v_enrollment := parts[1]::uuid;
  EXCEPTION WHEN invalid_text_representation THEN RETURN false;
  END;
  SELECT * INTO v_file FROM public.assessment_files WHERE storage_path = p_name;
  IF NOT FOUND THEN
    -- Not yet submitted: only its uploader (the learner) reads it back.
    RETURN EXISTS (SELECT 1 FROM public.programme_enrollments e WHERE e.id = v_enrollment AND e.user_id = auth.uid());
  END IF;
  SELECT * INTO v_sub FROM public.assessment_submissions WHERE id = v_file.submission_id;
  -- The learner: their own uploads; an assessor PDF only on the released,
  -- approved version (rule 7).
  IF EXISTS (SELECT 1 FROM public.programme_enrollments e WHERE e.id = v_sub.enrollment_id AND e.user_id = auth.uid()) THEN
    RETURN v_file.review_id IS NULL
        OR (v_sub.status = 'released' AND EXISTS (
              SELECT 1 FROM public.assessment_validations v
              WHERE v.review_id = v_file.review_id AND v.decision = 'approved'));
  END IF;
  -- A coach (rule 4): everything while they are the active assessor and the
  -- result is not released; their own review files afterwards.
  RETURN (v_sub.status <> 'released' AND EXISTS (SELECT 1 FROM public.assessment_assignments a
                 WHERE a.submission_id = v_sub.id AND a.ended_at IS NULL AND a.assessor_id = auth.uid()))
      OR (v_file.review_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM public.assessment_reviews r WHERE r.id = v_file.review_id AND r.assessor_id = auth.uid()));
END;
$function$;
REVOKE ALL ON FUNCTION public.assessment_object_readable(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assessment_object_readable(text) TO authenticated, service_role;
