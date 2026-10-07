-- ===========================================================================
-- Assessment polish (Prompt 15, Part C)
--
--  13. The release email is the server's: send-assessment-feedback-email runs
--      on a schedule, leases released submissions whose email has not gone
--      (assessment_release_emails_due_internal), and stamps release_emailed_at
--      only after Resend accepted it (assessment_mark_release_emailed_internal).
--      The Admin queue shows when it has not been sent.
--  14. learner_assessment_feedback carries the Final Assessment pass mark and
--      whether the quiz is above it; a released, unviewed item is "New
--      feedback" in the learner's Needs attention.
--  15. assessment_files.duration_seconds: a recording's signed URL lasts its
--      length plus a margin.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 13. The release email
-- ---------------------------------------------------------------------------
ALTER TABLE public.assessment_submissions ADD COLUMN IF NOT EXISTS release_email_attempted_at timestamptz;
COMMENT ON COLUMN public.assessment_submissions.release_email_attempted_at IS
  'When the scheduled sender last took this release (a 15-minute lease, so two runs never send twice); release_emailed_at is stamped only after Resend accepted the email (20261007001200).';

-- Claim-then-send stamped release_emailed_at before Resend answered: a failed
-- send was never retried. Retired.
DROP FUNCTION IF EXISTS public.assessment_claim_release_email_internal(uuid);

-- Releases whose email is due, leased for 15 minutes, with their recipient.
CREATE OR REPLACE FUNCTION public.assessment_release_emails_due_internal(p_limit integer DEFAULT 50)
 RETURNS TABLE(submission_id uuid, email text, full_name text, preferred_language text, kind text,
               requirement_ordinal integer, link text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  RETURN QUERY
  WITH due AS (
    SELECT s.id FROM public.assessment_submissions s
    WHERE s.status = 'released' AND s.release_emailed_at IS NULL
      AND (s.release_email_attempted_at IS NULL OR s.release_email_attempted_at < now() - interval '15 minutes')
    ORDER BY s.released_at
    LIMIT greatest(coalesce(p_limit, 50), 0)
    FOR UPDATE SKIP LOCKED
  ), leased AS (
    UPDATE public.assessment_submissions s SET release_email_attempted_at = now()
    FROM due WHERE s.id = due.id
    RETURNING s.id, s.enrollment_id, s.kind, s.cohort_requirement_id
  )
  SELECT l.id, p.email, p.full_name, p.preferred_language, l.kind, d.ordinal,
         public.assessment_feedback_link_internal(e.user_id)
  FROM leased l
  JOIN public.programme_enrollments e ON e.id = l.enrollment_id
  JOIN public.profiles p ON p.id = e.user_id
  JOIN public.cohort_requirement_dates d ON d.id = l.cohort_requirement_id;
END;
$function$;

-- After Resend accepted it: stamped once, from the server clock.
CREATE OR REPLACE FUNCTION public.assessment_mark_release_emailed_internal(p_submission_id uuid)
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH done AS (
    UPDATE public.assessment_submissions SET release_emailed_at = now()
    WHERE id = p_submission_id AND status = 'released' AND release_emailed_at IS NULL
    RETURNING 1
  )
  SELECT EXISTS (SELECT 1 FROM done);
$function$;
REVOKE ALL ON FUNCTION public.assessment_release_emails_due_internal(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.assessment_mark_release_emailed_internal(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assessment_release_emails_due_internal(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.assessment_mark_release_emailed_internal(uuid) TO service_role;

-- The Admin queue says whether the release email has gone.
DROP FUNCTION IF EXISTS public.admin_assessment_queue(uuid, uuid, text, text);
CREATE OR REPLACE FUNCTION public.admin_assessment_queue(p_programme_id uuid DEFAULT NULL::uuid, p_cohort_id uuid DEFAULT NULL::uuid, p_kind text DEFAULT NULL::text, p_status text DEFAULT NULL::text)
 RETURNS TABLE(submission_id uuid, enrollment_id uuid, learner_name text, programme_id uuid, programme_name text, cohort_id uuid, cohort_name text, kind text, requirement_ordinal integer, attempt_no integer, status text, submitted_at timestamp with time zone, assessor_id uuid, assessor_name text, assigned_at timestamp with time zone, due_on date, review_overdue boolean, review_id uuid, review_version integer, review_text text, review_outcome text, review_submitted_at timestamp with time zone, review_files jsonb, last_decision text, last_reason text, released_at timestamp with time zone, viewed_at timestamp with time zone, release_emailed_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Only an Admin reads the assessment queue' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT s.id, s.enrollment_id, lp.full_name, e.programme_id, pr.name, e.cohort_id, c.name, s.kind, d.ordinal,
    s.attempt_no, s.status, s.submitted_at, a.assessor_id, ap.full_name, a.assigned_at, a.due_on,
    a.due_on IS NOT NULL AND s.status IN ('with_assessor', 'returned') AND a.due_on < public.programme_today(),
    r.id, r.version, r.feedback_text, r.outcome, r.submitted_at,
    coalesce((SELECT jsonb_agg(jsonb_build_object('storage_path', f.storage_path, 'mime', f.mime, 'size_bytes', f.size_bytes))
              FROM public.assessment_files f WHERE f.review_id = r.id), '[]'::jsonb),
    v.decision, v.reason, s.released_at, s.viewed_at, s.release_emailed_at
  FROM public.assessment_submissions s
  JOIN public.programme_enrollments e ON e.id = s.enrollment_id
  JOIN public.profiles lp ON lp.id = e.user_id
  JOIN public.programmes pr ON pr.id = e.programme_id
  JOIN public.cohorts c ON c.id = e.cohort_id
  JOIN public.cohort_requirement_dates d ON d.id = s.cohort_requirement_id
  LEFT JOIN public.assessment_assignments a ON a.submission_id = s.id AND a.ended_at IS NULL
  LEFT JOIN public.profiles ap ON ap.id = a.assessor_id
  LEFT JOIN LATERAL (SELECT r2.* FROM public.assessment_reviews r2 WHERE r2.submission_id = s.id
                     ORDER BY r2.version DESC LIMIT 1) r ON true
  LEFT JOIN public.assessment_validations v ON v.review_id = r.id
  WHERE (p_programme_id IS NULL OR e.programme_id = p_programme_id)
    AND (p_cohort_id IS NULL OR e.cohort_id = p_cohort_id)
    AND (p_kind IS NULL OR s.kind = p_kind)
    AND (p_status IS NULL OR s.status = p_status)
  ORDER BY s.submitted_at;
END;
$function$;
REVOKE ALL ON FUNCTION public.admin_assessment_queue(uuid, uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_assessment_queue(uuid, uuid, text, text) TO authenticated, service_role;

-- 14. Released feedback says whether the quiz score is above or below the
-- pass mark. The mark is the enrollment's final-assessment config, and the
-- comparison is made here, as canonical_final_assessment_result makes it.
-- Triad feedback and a final assessment without a quiz carry NULL for both.
DROP FUNCTION IF EXISTS public.learner_assessment_feedback(uuid);
DROP FUNCTION IF EXISTS public.canonical_assessment_feedback_internal(uuid);
CREATE FUNCTION public.canonical_assessment_feedback_internal(p_enrollment_id uuid)
 RETURNS TABLE(submission_id uuid, kind text, requirement_id uuid, requirement_ordinal integer, attempt_no integer,
               submitted_at timestamptz, released_at timestamptz, viewed_at timestamptz, assessor_name text,
               review_id uuid, feedback_text text, outcome text, feedback_files jsonb,
               quiz_correct integer, quiz_total integer, quiz_score_pct numeric,
               pass_mark_pct numeric, quiz_passed boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  -- Only released submissions, and of them only the APPROVED version. Return
  -- reasons and unapproved versions never appear (rule 7).
  SELECT s.id, s.kind, s.cohort_requirement_id, d.ordinal, s.attempt_no, s.submitted_at, s.released_at, s.viewed_at,
    ap.full_name, r.id, r.feedback_text, r.outcome,
    coalesce((SELECT jsonb_agg(jsonb_build_object('storage_path', f.storage_path, 'mime', f.mime, 'size_bytes', f.size_bytes)
                               ORDER BY f.created_at)
              FROM public.assessment_files f WHERE f.review_id = r.id), '[]'::jsonb),
    q.correct_count, q.total_count, q.score_pct,
    pm.pass_mark_pct,
    CASE WHEN q.score_pct IS NULL OR pm.pass_mark_pct IS NULL THEN NULL ELSE q.score_pct >= pm.pass_mark_pct END
  FROM public.assessment_submissions s
  JOIN public.cohort_requirement_dates d ON d.id = s.cohort_requirement_id
  JOIN LATERAL (
    SELECT r2.* FROM public.assessment_reviews r2
    JOIN public.assessment_validations v ON v.review_id = r2.id AND v.decision = 'approved'
    WHERE r2.submission_id = s.id
    ORDER BY r2.version DESC LIMIT 1
  ) r ON true
  JOIN public.profiles ap ON ap.id = r.assessor_id
  -- The quiz score is the database's own (assignment_submissions.score_pct,
  -- scored by trigger; rule 9) and is released with the feedback (decision 10).
  LEFT JOIN public.assignment_submissions q ON q.id = s.quiz_submission_id
  LEFT JOIN LATERAL (
    SELECT CASE WHEN s.kind = 'final_assessment' AND q.id IS NOT NULL
                THEN (public.final_assessment_config_internal(s.enrollment_id)->>'pass_mark_pct')::numeric END AS pass_mark_pct
  ) pm ON true
  WHERE s.enrollment_id = p_enrollment_id AND s.status = 'released'
  ORDER BY s.released_at DESC;
$function$;
REVOKE ALL ON FUNCTION public.canonical_assessment_feedback_internal(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.canonical_assessment_feedback_internal(uuid) TO service_role;

CREATE FUNCTION public.learner_assessment_feedback(p_enrollment_id uuid)
 RETURNS TABLE(submission_id uuid, kind text, requirement_id uuid, requirement_ordinal integer, attempt_no integer,
               submitted_at timestamptz, released_at timestamptz, viewed_at timestamptz, assessor_name text,
               review_id uuid, feedback_text text, outcome text, feedback_files jsonb,
               quiz_correct integer, quiz_total integer, quiz_score_pct numeric,
               pass_mark_pct numeric, quiz_passed boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT f.* FROM public.programme_enrollments e
  CROSS JOIN LATERAL public.canonical_assessment_feedback_internal(e.id) f
  WHERE e.id = p_enrollment_id AND e.user_id = auth.uid() AND auth.uid() IS NOT NULL;
$function$;
REVOKE ALL ON FUNCTION public.learner_assessment_feedback(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.learner_assessment_feedback(uuid) TO authenticated, service_role;

-- 15. A recording's signed URL lasts the recording's length plus a margin
-- (src/lib/assessments.ts recordingUrlSeconds), so the length is stored with
-- the file. Feedback PDFs over 10 MB were already refused before upload
-- (checkFeedbackPdf) and here at registration.
ALTER TABLE public.assessment_files ADD COLUMN IF NOT EXISTS duration_seconds integer;
ALTER TABLE public.assessment_files DROP CONSTRAINT IF EXISTS assessment_files_duration_check;
ALTER TABLE public.assessment_files ADD CONSTRAINT assessment_files_duration_check
  CHECK (duration_seconds IS NULL OR (file_kind = 'recording' AND duration_seconds BETWEEN 1 AND 86400));

CREATE OR REPLACE FUNCTION public.assessment_register_files_internal(p_submission_id uuid, p_review_id uuid, p_role text, p_files jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  f jsonb;
  v_sub public.assessment_submissions;
  v_obj storage.objects;
  v_kind text;
  v_mime text;
  v_size bigint;
  v_duration integer;
BEGIN
  SELECT * INTO v_sub FROM public.assessment_submissions WHERE id = p_submission_id;
  FOR f IN SELECT * FROM jsonb_array_elements(coalesce(p_files, '[]'::jsonb)) LOOP
    v_kind := f->>'file_kind';
    -- The recording's length, measured by the learner's browser, sizes the
    -- signed URL the assessor plays it through. Optional; other files have none.
    v_duration := NULL;
    IF p_role = 'learner' AND v_kind = 'recording' AND f ? 'duration_seconds' AND jsonb_typeof(f->'duration_seconds') = 'number' THEN
      v_duration := round((f->>'duration_seconds')::numeric)::integer;
      IF v_duration < 1 OR v_duration > 86400 THEN
        RAISE EXCEPTION 'The recording length must be between 1 second and 24 hours' USING ERRCODE = '22023';
      END IF;
    END IF;
    SELECT * INTO v_obj FROM storage.objects o
    WHERE o.bucket_id = 'assessment-files' AND o.name = f->>'storage_path';
    IF NOT FOUND OR (storage.foldername(v_obj.name))[1] <> v_sub.enrollment_id::text
       OR (storage.foldername(v_obj.name))[2] <> v_sub.id::text THEN
      RAISE EXCEPTION 'File % is not an upload for this submission', f->>'storage_path' USING ERRCODE = '22023';
    END IF;
    IF v_obj.owner_id IS DISTINCT FROM auth.uid()::text THEN
      RAISE EXCEPTION 'File % was not uploaded by you', v_obj.name USING ERRCODE = '42501';
    END IF;
    v_mime := v_obj.metadata->>'mimetype';
    v_size := (v_obj.metadata->>'size')::bigint;
    IF p_role = 'learner' AND v_kind = 'recording' THEN
      IF v_mime IS DISTINCT FROM 'audio/mpeg' THEN
        RAISE EXCEPTION 'The recording must be an MP3 file (audio/mpeg); video is not accepted' USING ERRCODE = '22023';
      END IF;
      IF v_size IS NULL OR v_size > 52428800 THEN
        RAISE EXCEPTION 'The recording must be 50 MB or smaller' USING ERRCODE = '22023';
      END IF;
    ELSIF p_role = 'learner' AND v_kind = 'transcript' THEN
      IF v_mime NOT IN ('text/plain', 'application/pdf',
                        'application/vnd.openxmlformats-officedocument.wordprocessingml.document') THEN
        RAISE EXCEPTION 'A transcript must be a .txt, .docx or .pdf file' USING ERRCODE = '22023';
      END IF;
      IF v_size IS NULL OR v_size > 52428800 THEN
        RAISE EXCEPTION 'The transcript must be 50 MB or smaller' USING ERRCODE = '22023';
      END IF;
    ELSIF p_role = 'assessor' AND v_kind = 'feedback_pdf' THEN
      IF v_mime IS DISTINCT FROM 'application/pdf' THEN
        RAISE EXCEPTION 'Feedback must be a PDF file' USING ERRCODE = '22023';
      END IF;
      IF v_size IS NULL OR v_size > 10485760 THEN
        RAISE EXCEPTION 'The feedback PDF must be 10 MB or smaller' USING ERRCODE = '22023';
      END IF;
    ELSE
      RAISE EXCEPTION 'Unknown file kind % for %', v_kind, p_role USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.assessment_files (submission_id, review_id, uploaded_by, uploaded_by_role, file_kind, storage_path, mime, size_bytes, duration_seconds)
    VALUES (p_submission_id, p_review_id, auth.uid(), p_role, v_kind, v_obj.name, v_mime, v_size, v_duration);
  END LOOP;
END;
$function$;
REVOKE ALL ON FUNCTION public.assessment_register_files_internal(uuid, uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assessment_register_files_internal(uuid, uuid, text, jsonb) TO service_role;

-- The assessor's inbox carries the length with the learner's files.
CREATE OR REPLACE FUNCTION public.coach_assessment_inbox()
 RETURNS TABLE(submission_id uuid, enrollment_id uuid, inbox_tab text, kind text, cohort_id uuid, cohort_name text, learner_name text, requirement_ordinal integer, attempt_no integer, status text, submitted_at timestamp with time zone, assigned_at timestamp with time zone, due_on date, is_overdue boolean, triad_reflection_id uuid, reflection jsonb, transcript_text text, quiz_correct integer, quiz_total integer, quiz_score_pct numeric, learner_files jsonb, return_reason text, my_latest_review_version integer, my_latest_feedback_text text, my_latest_outcome text, released_at timestamp with time zone)
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
      SELECT jsonb_agg(jsonb_build_object('storage_path', f.storage_path, 'file_kind', f.file_kind, 'mime', f.mime, 'size_bytes', f.size_bytes,
                                'duration_seconds', f.duration_seconds))
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
