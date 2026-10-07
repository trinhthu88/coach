-- ===========================================================================
-- Assessment fixes (Prompt 11: B1-B4; decisions 4, 5, 6, 10)
--
--   1. canonical_final_assessment_fulfilment: the Final Assessment is
--      fulfilled on the Vietnam date of the latest attempt's submitted_at,
--      whatever the review state (decision 4). The result -- Pass, Not pass,
--      Resubmit -- stays in canonical_final_assessment_result.
--   2. coach_submit_review: a Final Assessment review whose outcome is NULL
--      is refused (B1: `NULL NOT IN (...)` is NULL, so it slipped through).
--   3. assessment_object_readable: an object not registered in
--      assessment_files is readable only by its uploader
--      (storage.objects.owner_id), not by whoever owns the enrollment path
--      (B2: the learner could read the assessor's unsubmitted PDF).
--   4. "Submissions: user read own" leaves out Final Assessment quiz rows:
--      their score is released with the feedback, never read from the table
--      (B3; decision 10).
--   5. learner_submit_assessment(kind = 'triad') is refused: a Triad
--      submission is created only by learner_triad_submit_reflection
--      (B4; decision 5).
--   6. Attempt 2 after Resubmit is assigned automatically to attempt 1's
--      assessor while they are still in the cohort's pool.
--   7. assessment_is_learners_coach_internal also refuses the learner
--      themself and any cohort_coach_assignments coach of the cohort, of
--      any cohort kind (decision 6).
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Fulfilment = the latest attempt's submission
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.canonical_final_assessment_fulfilment(p_enrollment_id uuid)
 RETURNS TABLE(requirement_id uuid, fulfilled_on date, final_result text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  -- Submitted is fulfilled, on time when submitted by the due date, however
  -- long the review takes. A Resubmit keeps attempt 1's date until attempt 2
  -- is submitted. final_result is carried for the reader; it never decides.
  SELECT r.requirement_id, (s.submitted_at AT TIME ZONE public.programme_time_zone())::date, r.final_result
  FROM public.canonical_final_assessment_result(p_enrollment_id) r
  JOIN LATERAL (
    SELECT s2.submitted_at FROM public.assessment_submissions s2
    WHERE s2.enrollment_id = p_enrollment_id AND s2.cohort_requirement_id = r.requirement_id
    ORDER BY s2.attempt_no DESC LIMIT 1
  ) s ON true;
$function$;
REVOKE ALL ON FUNCTION public.canonical_final_assessment_fulfilment(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.canonical_final_assessment_fulfilment(uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 2. coach_submit_review: a Final Assessment review always carries a result
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.coach_submit_review(
  p_submission_id uuid, p_feedback_text text DEFAULT NULL, p_outcome text DEFAULT NULL,
  p_files jsonb DEFAULT '[]'::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_sub public.assessment_submissions;
  v_review uuid;
  v_version integer;
BEGIN
  SELECT * INTO v_sub FROM public.assessment_submissions WHERE id = p_submission_id FOR UPDATE;
  IF NOT FOUND OR auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.assessment_assignments a
    WHERE a.submission_id = p_submission_id AND a.ended_at IS NULL AND a.assessor_id = auth.uid()) THEN
    RAISE EXCEPTION 'Only the active assessor submits a review' USING ERRCODE = '42501';
  END IF;
  IF v_sub.status NOT IN ('with_assessor', 'returned') THEN
    RAISE EXCEPTION 'This submission is not waiting for your review (%)', v_sub.status USING ERRCODE = '23514';
  END IF;
  -- Decision 3: the Final Assessment carries a result; a Triad review does not.
  IF v_sub.kind = 'final_assessment' AND (p_outcome IS NULL OR p_outcome NOT IN ('pass', 'not_pass', 'resubmit')) THEN
    RAISE EXCEPTION 'A Final Assessment review needs a result: Pass, Not pass or Resubmit' USING ERRCODE = '22023';
  END IF;
  IF v_sub.kind = 'final_assessment' AND p_outcome = 'resubmit' AND v_sub.attempt_no >= 2 THEN
    RAISE EXCEPTION 'This is the last attempt: the result is Pass or Not pass' USING ERRCODE = '22023';
  END IF;
  IF v_sub.kind = 'triad' AND p_outcome IS NOT NULL THEN
    RAISE EXCEPTION 'A Triad review gives feedback only, no result' USING ERRCODE = '22023';
  END IF;
  IF nullif(btrim(p_feedback_text), '') IS NULL AND jsonb_array_length(coalesce(p_files, '[]'::jsonb)) = 0 THEN
    RAISE EXCEPTION 'Write feedback or attach a PDF' USING ERRCODE = '22023';
  END IF;
  SELECT coalesce(max(version), 0) + 1 INTO v_version FROM public.assessment_reviews WHERE submission_id = p_submission_id;
  INSERT INTO public.assessment_reviews (submission_id, assessor_id, version, feedback_text, outcome)
  VALUES (p_submission_id, auth.uid(), v_version, nullif(btrim(p_feedback_text), ''), p_outcome)
  RETURNING id INTO v_review;
  PERFORM public.assessment_register_files_internal(p_submission_id, v_review, 'assessor', p_files);
  UPDATE public.assessment_submissions SET status = 'awaiting_validation' WHERE id = p_submission_id;
  RETURN v_review;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 3. An unregistered object: its uploader only
-- ---------------------------------------------------------------------------
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
BEGIN
  IF auth.uid() IS NULL OR coalesce(array_length(parts, 1), 0) < 2 THEN RETURN false; END IF;
  IF public.has_role(auth.uid(), 'admin'::public.app_role) THEN RETURN true; END IF;
  SELECT * INTO v_file FROM public.assessment_files WHERE storage_path = p_name;
  IF NOT FOUND THEN
    -- Not yet submitted: only its uploader reads it back -- the learner their
    -- draft upload, the assessor their draft PDF; never the path's learner.
    RETURN EXISTS (SELECT 1 FROM storage.objects o
                   WHERE o.bucket_id = 'assessment-files' AND o.name = p_name AND o.owner_id = auth.uid()::text);
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

-- ---------------------------------------------------------------------------
-- 4. The Final Assessment quiz is read through the Final Assessment only
-- ---------------------------------------------------------------------------
-- A definer helper: the policy must not depend on whether the learner can
-- read the assignment row itself.
CREATE OR REPLACE FUNCTION public.assignment_is_final_assessment_quiz(p_assignment_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT EXISTS (SELECT 1 FROM public.assignments a
                 WHERE a.id = p_assignment_id AND a.final_assessment_programme_id IS NOT NULL);
$function$;
REVOKE ALL ON FUNCTION public.assignment_is_final_assessment_quiz(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assignment_is_final_assessment_quiz(uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS "Submissions: user read own" ON public.assignment_submissions;
CREATE POLICY "Submissions: user read own" ON public.assignment_submissions FOR SELECT TO authenticated
  USING (user_id = auth.uid() AND NOT public.assignment_is_final_assessment_quiz(assignment_id));

-- ---------------------------------------------------------------------------
-- 7. The learner's own coach, or the learner
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.assessment_is_learners_coach_internal(p_enrollment_id uuid, p_coach_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  -- The learner themself; any Coach with a live or completed Coaching session
  -- in the enrollment; any Coach ever assigned to the cohort's coaching
  -- (cohort_coach_assignments, any cohort kind, active or not).
  SELECT EXISTS (
    SELECT 1 FROM public.programme_enrollments e
    WHERE e.id = p_enrollment_id AND e.user_id = p_coach_id)
  OR EXISTS (
    SELECT 1 FROM public.sessions s
    WHERE s.enrollment_id = p_enrollment_id AND s.coach_id = p_coach_id
      AND s.status IN ('pending_coach_approval', 'confirmed', 'completed'))
  OR EXISTS (
    SELECT 1 FROM public.programme_enrollments e
    JOIN public.cohort_coach_assignments a ON a.cohort_id = e.cohort_id AND a.coach_id = p_coach_id
    WHERE e.id = p_enrollment_id);
$function$;
REVOKE ALL ON FUNCTION public.assessment_is_learners_coach_internal(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assessment_is_learners_coach_internal(uuid, uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 5 + 6. learner_submit_assessment: the Final Assessment only; attempt 2
--        goes back to attempt 1's assessor
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.learner_submit_assessment(
  p_submission_id uuid, p_enrollment_id uuid, p_cohort_requirement_id uuid, p_kind text,
  p_triad_reflection_id uuid DEFAULT NULL, p_quiz_submission_id uuid DEFAULT NULL,
  p_transcript_text text DEFAULT NULL, p_transcript_source text DEFAULT 'none',
  p_files jsonb DEFAULT '[]'::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_enr public.programme_enrollments;
  v_req public.cohort_requirement_dates;
  v_attempt integer := 1;
  v_prev record;
  v_config jsonb;
  v_quiz uuid;
  v_recordings integer;
  v_transcript_files integer;
  v_assessor uuid;
  v_assigned_by uuid;
BEGIN
  SELECT * INTO v_enr FROM public.programme_enrollments WHERE id = p_enrollment_id;
  IF NOT FOUND OR v_enr.user_id IS DISTINCT FROM auth.uid() OR auth.uid() IS NULL THEN
    RAISE EXCEPTION 'You can submit only for your own enrollment' USING ERRCODE = '42501';
  END IF;
  IF NOT public.enrollment_is_ongoing(p_enrollment_id) THEN
    RAISE EXCEPTION 'This enrollment is not ongoing' USING ERRCODE = '42501';
  END IF;
  -- Decision 5: the Triad reflection IS the submission, created by
  -- learner_triad_submit_reflection in the same transaction; never here.
  IF p_kind = 'triad' THEN
    RAISE EXCEPTION 'A Triad is submitted with its reflection, not here' USING ERRCODE = '22023';
  END IF;
  IF p_kind IS DISTINCT FROM 'final_assessment' THEN
    RAISE EXCEPTION 'Unknown submission kind %', p_kind USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_req FROM public.cohort_requirement_dates
  WHERE id = p_cohort_requirement_id AND cohort_id = v_enr.cohort_id AND programme_id = v_enr.programme_id;
  IF NOT FOUND OR v_req.module::text <> 'final_assessment' THEN
    RAISE EXCEPTION 'That requirement is not in your cohort' USING ERRCODE = '42501';
  END IF;
  IF p_transcript_source NOT IN ('none', 'pasted', 'uploaded', 'auto') THEN
    RAISE EXCEPTION 'Unknown transcript source' USING ERRCODE = '22023';
  END IF;
  IF p_triad_reflection_id IS NOT NULL THEN
    RAISE EXCEPTION 'A Final Assessment links no Triad reflection' USING ERRCODE = '22023';
  END IF;

  -- Once per attempt. A second attempt only after a released "Resubmit"
  -- (decision 5); Not pass is final.
  SELECT s.id, s.attempt_no, s.status,
         (SELECT r.outcome FROM public.assessment_reviews r
          JOIN public.assessment_validations v ON v.review_id = r.id AND v.decision = 'approved'
          WHERE r.submission_id = s.id ORDER BY r.version DESC LIMIT 1) AS outcome
    INTO v_prev
  FROM public.assessment_submissions s
  WHERE s.enrollment_id = p_enrollment_id AND s.cohort_requirement_id = p_cohort_requirement_id
  ORDER BY s.attempt_no DESC LIMIT 1;
  IF FOUND THEN
    IF v_prev.status = 'released' AND v_prev.outcome = 'resubmit' AND v_prev.attempt_no < 2 THEN
      v_attempt := v_prev.attempt_no + 1;
    ELSE
      RAISE EXCEPTION 'This requirement has already been submitted' USING ERRCODE = '23505';
    END IF;
  END IF;

  v_config := public.final_assessment_config_internal(p_enrollment_id);
  IF v_config IS NULL OR NOT coalesce((v_config->>'required')::boolean, false) THEN
    RAISE EXCEPTION 'This programme has no Final Assessment' USING ERRCODE = '42501';
  END IF;
  -- The quiz, when the programme has one: this attempt's own answers.
  SELECT a.id INTO v_quiz FROM public.assignments a WHERE a.final_assessment_programme_id = v_enr.programme_id;
  IF coalesce((v_config->>'quiz_enabled')::boolean, false) AND v_quiz IS NOT NULL THEN
    IF p_quiz_submission_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.assignment_submissions q
      WHERE q.id = p_quiz_submission_id AND q.enrollment_id = p_enrollment_id
        AND q.assignment_id = v_quiz AND q.attempt_no = v_attempt) THEN
      RAISE EXCEPTION 'Take the quiz for this attempt before submitting' USING ERRCODE = '22023';
    END IF;
  ELSIF p_quiz_submission_id IS NOT NULL THEN
    RAISE EXCEPTION 'This Final Assessment has no quiz' USING ERRCODE = '22023';
  END IF;
  -- Exactly one recording (type and size are checked when it is registered).
  SELECT count(*) FILTER (WHERE f->>'file_kind' = 'recording'), count(*) FILTER (WHERE f->>'file_kind' = 'transcript')
    INTO v_recordings, v_transcript_files
  FROM jsonb_array_elements(coalesce(p_files, '[]'::jsonb)) f;
  IF v_recordings <> 1 THEN
    RAISE EXCEPTION 'Upload one MP3 recording' USING ERRCODE = '22023';
  END IF;
  IF v_config->>'transcript' = 'required'
     AND nullif(btrim(p_transcript_text), '') IS NULL AND v_transcript_files = 0 THEN
    RAISE EXCEPTION 'This Final Assessment needs a transcript' USING ERRCODE = '22023';
  END IF;
  IF v_config->>'transcript' = 'none'
     AND (nullif(btrim(p_transcript_text), '') IS NOT NULL OR v_transcript_files > 0) THEN
    RAISE EXCEPTION 'This Final Assessment takes no transcript' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.assessment_submissions (id, enrollment_id, kind, cohort_requirement_id,
    quiz_submission_id, attempt_no, transcript_text, transcript_source, status, submitted_at)
  VALUES (p_submission_id, p_enrollment_id, 'final_assessment', p_cohort_requirement_id,
    p_quiz_submission_id, v_attempt, nullif(btrim(p_transcript_text), ''),
    CASE WHEN nullif(btrim(p_transcript_text), '') IS NULL AND p_transcript_source = 'pasted' THEN 'none' ELSE p_transcript_source END,
    'awaiting_assignment', now());
  PERFORM public.assessment_register_files_internal(p_submission_id, NULL, 'learner', p_files);

  -- Attempt 2: back to the assessor whose Resubmit was approved, on the
  -- Admin who assigned them, while they are still in the cohort's pool (and
  -- still not the learner's own coach). Otherwise it waits for Admin.
  IF v_attempt > 1 THEN
    SELECT r.assessor_id INTO v_assessor
    FROM public.assessment_reviews r
    JOIN public.assessment_validations v ON v.review_id = r.id AND v.decision = 'approved'
    WHERE r.submission_id = v_prev.id ORDER BY r.version DESC LIMIT 1;
    SELECT a.assigned_by INTO v_assigned_by
    FROM public.assessment_assignments a
    WHERE a.submission_id = v_prev.id AND a.assessor_id = v_assessor
    ORDER BY a.assigned_at DESC, a.ended_at DESC NULLS FIRST LIMIT 1;
    IF v_assessor IS NOT NULL AND v_assigned_by IS NOT NULL
       AND EXISTS (SELECT 1 FROM public.cohort_assessors ca
                   WHERE ca.cohort_id = v_enr.cohort_id AND ca.coach_id = v_assessor AND ca.is_active)
       AND NOT public.assessment_is_learners_coach_internal(p_enrollment_id, v_assessor) THEN
      -- Turnaround: 7 days after assignment (decision 7), in programme days.
      INSERT INTO public.assessment_assignments (submission_id, assessor_id, assigned_by, due_on)
      VALUES (p_submission_id, v_assessor, v_assigned_by, public.programme_today() + 7);
      UPDATE public.assessment_submissions SET status = 'with_assessor' WHERE id = p_submission_id;
    END IF;
  END IF;
  RETURN p_submission_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.learner_submit_assessment(uuid, uuid, uuid, text, uuid, uuid, text, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.learner_submit_assessment(uuid, uuid, uuid, text, uuid, uuid, text, text, jsonb) TO authenticated, service_role;
