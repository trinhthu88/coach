-- ===========================================================================
-- Assessment review pipeline (Prompt A1; Assessment review spec, 6 Oct)
--
-- One pipeline for Triad submissions and the Final Assessment:
--   learner submits -> Admin assigns an assessor from the cohort pool ->
--   the assessor reviews -> Admin approves (releases + notifies) or returns
--   with a reason -> only approved, released feedback reaches the learner.
--
-- Six tables, each owning one fact. The app holds NO privilege on any of
-- them: every change is one SECURITY DEFINER function per step, every read a
-- role function (rules 1, 4, 7). Status and every timestamp are written only
-- by these functions, from the server clock (rule 8).
--
-- A Triad review is evidence, never completion: nothing here is read by the
-- Triad completion functions. The Final Assessment module value is added by
-- the Final Assessment migration; these functions compare the requirement's
-- module as text so they serve it as soon as it exists.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
CREATE TABLE public.cohort_assessors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cohort_id uuid NOT NULL REFERENCES public.cohorts(id) ON DELETE RESTRICT,
  coach_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  is_active boolean NOT NULL DEFAULT true,
  assigned_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cohort_id, coach_id)
);

CREATE TABLE public.assessment_submissions (
  id uuid PRIMARY KEY,
  enrollment_id uuid NOT NULL REFERENCES public.programme_enrollments(id) ON DELETE RESTRICT,
  kind text NOT NULL CHECK (kind IN ('triad', 'final_assessment')),
  cohort_requirement_id uuid NOT NULL REFERENCES public.cohort_requirement_dates(id) ON DELETE RESTRICT,
  triad_reflection_id uuid REFERENCES public.triad_reflections(id) ON DELETE RESTRICT,
  quiz_submission_id uuid REFERENCES public.assignment_submissions(id) ON DELETE RESTRICT,
  attempt_no integer NOT NULL DEFAULT 1 CHECK (attempt_no BETWEEN 1 AND 2),
  transcript_text text,
  transcript_source text NOT NULL DEFAULT 'none' CHECK (transcript_source IN ('none', 'pasted', 'uploaded', 'auto')),
  status text NOT NULL CHECK (status IN ('awaiting_assignment', 'with_assessor', 'awaiting_validation', 'returned', 'released')),
  submitted_at timestamptz NOT NULL,
  released_at timestamptz,
  viewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (enrollment_id, cohort_requirement_id, attempt_no),
  CHECK (kind <> 'triad' OR (triad_reflection_id IS NOT NULL AND attempt_no = 1))
);
CREATE INDEX assessment_submissions_status_idx ON public.assessment_submissions (status);

CREATE TABLE public.assessment_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id uuid NOT NULL REFERENCES public.assessment_submissions(id) ON DELETE RESTRICT,
  assessor_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  assigned_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  due_on date NOT NULL,
  ended_at timestamptz
);
-- One open assignment per submission.
CREATE UNIQUE INDEX assessment_assignments_one_open ON public.assessment_assignments (submission_id) WHERE ended_at IS NULL;
CREATE INDEX assessment_assignments_assessor_idx ON public.assessment_assignments (assessor_id) WHERE ended_at IS NULL;

CREATE TABLE public.assessment_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id uuid NOT NULL REFERENCES public.assessment_submissions(id) ON DELETE RESTRICT,
  assessor_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  version integer NOT NULL CHECK (version >= 1),
  feedback_text text,
  outcome text CHECK (outcome IN ('pass', 'not_pass', 'resubmit')),
  submitted_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (submission_id, version)
);

CREATE TABLE public.assessment_validations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id uuid NOT NULL UNIQUE REFERENCES public.assessment_reviews(id) ON DELETE RESTRICT,
  admin_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  decision text NOT NULL CHECK (decision IN ('approved', 'returned')),
  reason text,
  decided_at timestamptz NOT NULL DEFAULT now(),
  CHECK (decision <> 'returned' OR length(btrim(coalesce(reason, ''))) > 0)
);

CREATE TABLE public.assessment_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id uuid NOT NULL REFERENCES public.assessment_submissions(id) ON DELETE RESTRICT,
  review_id uuid REFERENCES public.assessment_reviews(id) ON DELETE RESTRICT,
  uploaded_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  uploaded_by_role text NOT NULL CHECK (uploaded_by_role IN ('learner', 'assessor')),
  file_kind text NOT NULL CHECK (file_kind IN ('recording', 'transcript', 'feedback_pdf')),
  storage_path text NOT NULL UNIQUE,
  mime text NOT NULL,
  size_bytes bigint NOT NULL CHECK (size_bytes > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((uploaded_by_role = 'assessor') = (review_id IS NOT NULL))
);

-- Rule 1: the app holds no privilege on the six tables; RLS on, no policies.
DO $lock$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['cohort_assessors', 'assessment_submissions', 'assessment_files',
                           'assessment_assignments', 'assessment_reviews', 'assessment_validations'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
  END LOOP;
END
$lock$;

-- ---------------------------------------------------------------------------
-- Storage: one private bucket. Type and size are refused by the bucket itself
-- (rule 10) and checked again by the submit / review functions.
-- ---------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('assessment-files', 'assessment-files', false, 52428800,
        ARRAY['audio/mpeg', 'application/pdf', 'text/plain',
              'application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
ON CONFLICT (id) DO UPDATE
  SET public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- Paths: {enrollment_id}/{submission_id}/{file}.
CREATE OR REPLACE FUNCTION public.assessment_object_writable(p_name text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  parts text[] := storage.foldername(p_name);
  v_enrollment uuid;
  v_submission uuid;
  v_sub public.assessment_submissions;
BEGIN
  IF auth.uid() IS NULL OR coalesce(array_length(parts, 1), 0) < 2 THEN RETURN false; END IF;
  BEGIN
    v_enrollment := parts[1]::uuid;
    v_submission := parts[2]::uuid;
  EXCEPTION WHEN invalid_text_representation THEN RETURN false;
  END;
  SELECT * INTO v_sub FROM public.assessment_submissions WHERE id = v_submission;
  IF NOT FOUND THEN
    -- The learner's own upload before submitting: their ongoing enrollment.
    RETURN EXISTS (SELECT 1 FROM public.programme_enrollments e
                   WHERE e.id = v_enrollment AND e.user_id = auth.uid())
       AND public.enrollment_is_ongoing(v_enrollment);
  END IF;
  -- After submit the learner's content is locked; only the active assessor
  -- adds the feedback PDF while the review is theirs to write.
  RETURN v_sub.enrollment_id = v_enrollment
     AND v_sub.status IN ('with_assessor', 'returned')
     AND EXISTS (SELECT 1 FROM public.assessment_assignments a
                 WHERE a.submission_id = v_sub.id AND a.ended_at IS NULL AND a.assessor_id = auth.uid());
END;
$function$;

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
  -- A coach (rule 4): everything while they are the active assessor; their own
  -- review files afterwards.
  RETURN EXISTS (SELECT 1 FROM public.assessment_assignments a
                 WHERE a.submission_id = v_sub.id AND a.ended_at IS NULL AND a.assessor_id = auth.uid())
      OR (v_file.review_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM public.assessment_reviews r WHERE r.id = v_file.review_id AND r.assessor_id = auth.uid()));
END;
$function$;
-- Whether an object is registered with a submission / review (then locked).
-- A definer function: the app holds no privilege on assessment_files.
CREATE OR REPLACE FUNCTION public.assessment_object_registered(p_name text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT EXISTS (SELECT 1 FROM public.assessment_files f WHERE f.storage_path = p_name);
$function$;
REVOKE ALL ON FUNCTION public.assessment_object_registered(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assessment_object_registered(text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.assessment_object_writable(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.assessment_object_readable(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assessment_object_writable(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.assessment_object_readable(text) TO authenticated, service_role;

DROP POLICY IF EXISTS "Assessment files: write own path" ON storage.objects;
DROP POLICY IF EXISTS "Assessment files: read" ON storage.objects;
DROP POLICY IF EXISTS "Assessment files: replace before registration" ON storage.objects;
DROP POLICY IF EXISTS "Assessment files: delete before registration" ON storage.objects;
CREATE POLICY "Assessment files: write own path" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'assessment-files' AND public.assessment_object_writable(name));
CREATE POLICY "Assessment files: read" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'assessment-files' AND public.assessment_object_readable(name));
-- A file registered with a submission or review is locked.
CREATE POLICY "Assessment files: replace before registration" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'assessment-files' AND owner_id = auth.uid()::text
         AND NOT public.assessment_object_registered(name))
  WITH CHECK (bucket_id = 'assessment-files' AND public.assessment_object_writable(name));
CREATE POLICY "Assessment files: delete before registration" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'assessment-files' AND owner_id = auth.uid()::text
         AND NOT public.assessment_object_registered(name));

-- ---------------------------------------------------------------------------
-- Shared checks
-- ---------------------------------------------------------------------------
-- Registers uploaded objects as files of a submission / review, checking each
-- object exists under the submission's path, was uploaded by the caller, and
-- has an accepted type and size (rule 10, the second check).
CREATE OR REPLACE FUNCTION public.assessment_register_files_internal(
  p_submission_id uuid, p_review_id uuid, p_role text, p_files jsonb)
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
BEGIN
  SELECT * INTO v_sub FROM public.assessment_submissions WHERE id = p_submission_id;
  FOR f IN SELECT * FROM jsonb_array_elements(coalesce(p_files, '[]'::jsonb)) LOOP
    v_kind := f->>'file_kind';
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
    INSERT INTO public.assessment_files (submission_id, review_id, uploaded_by, uploaded_by_role, file_kind, storage_path, mime, size_bytes)
    VALUES (p_submission_id, p_review_id, auth.uid(), p_role, v_kind, v_obj.name, v_mime, v_size);
  END LOOP;
END;
$function$;
REVOKE ALL ON FUNCTION public.assessment_register_files_internal(uuid, uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assessment_register_files_internal(uuid, uuid, text, jsonb) TO service_role;

-- The learner's own programme coach (decision 6): any Coach with a live or
-- completed Coaching session in the enrollment, or its engagement coach.
CREATE OR REPLACE FUNCTION public.assessment_is_learners_coach_internal(p_enrollment_id uuid, p_coach_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.sessions s
    WHERE s.enrollment_id = p_enrollment_id AND s.coach_id = p_coach_id
      AND s.status IN ('pending_coach_approval', 'confirmed', 'completed'))
  OR EXISTS (
    SELECT 1 FROM public.programme_enrollments e
    JOIN public.cohorts c ON c.id = e.cohort_id AND c.kind = 'engagement'
    JOIN public.cohort_coach_assignments a ON a.cohort_id = c.id AND a.coach_id = p_coach_id
    WHERE e.id = p_enrollment_id);
$function$;
REVOKE ALL ON FUNCTION public.assessment_is_learners_coach_internal(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assessment_is_learners_coach_internal(uuid, uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- Assessor pool (Admin)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_set_cohort_assessor(p_cohort_id uuid, p_coach_id uuid, p_active boolean DEFAULT true)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_id uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Only an Admin manages the assessor pool' USING ERRCODE = '42501';
  END IF;
  IF p_active AND NOT public.has_role(p_coach_id, 'coach'::public.app_role) THEN
    RAISE EXCEPTION 'An assessor must be a Coach' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.cohort_assessors (cohort_id, coach_id, is_active, assigned_by)
  VALUES (p_cohort_id, p_coach_id, p_active, auth.uid())
  ON CONFLICT (cohort_id, coach_id) DO UPDATE
    SET is_active = excluded.is_active, assigned_by = excluded.assigned_by, updated_at = now()
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_cohort_assessors(p_cohort_id uuid)
 RETURNS TABLE(coach_id uuid, full_name text, email text, is_active boolean, assigned_at timestamptz)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Only an Admin reads the assessor pool' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT a.coach_id, p.full_name, p.email, a.is_active, a.assigned_at
  FROM public.cohort_assessors a JOIN public.profiles p ON p.id = a.coach_id
  WHERE a.cohort_id = p_cohort_id
  ORDER BY p.full_name;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 1. learner_submit_assessment (rule 2)
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
BEGIN
  SELECT * INTO v_enr FROM public.programme_enrollments WHERE id = p_enrollment_id;
  IF NOT FOUND OR v_enr.user_id IS DISTINCT FROM auth.uid() OR auth.uid() IS NULL THEN
    RAISE EXCEPTION 'You can submit only for your own enrollment' USING ERRCODE = '42501';
  END IF;
  IF NOT public.enrollment_is_ongoing(p_enrollment_id) THEN
    RAISE EXCEPTION 'This enrollment is not ongoing' USING ERRCODE = '42501';
  END IF;
  IF p_kind NOT IN ('triad', 'final_assessment') THEN
    RAISE EXCEPTION 'Unknown submission kind %', p_kind USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_req FROM public.cohort_requirement_dates
  WHERE id = p_cohort_requirement_id AND cohort_id = v_enr.cohort_id AND programme_id = v_enr.programme_id;
  IF NOT FOUND OR v_req.module::text <> (CASE p_kind WHEN 'triad' THEN 'triads' ELSE 'final_assessment' END) THEN
    RAISE EXCEPTION 'That requirement is not in your cohort' USING ERRCODE = '42501';
  END IF;
  IF p_transcript_source NOT IN ('none', 'pasted', 'uploaded', 'auto') THEN
    RAISE EXCEPTION 'Unknown transcript source' USING ERRCODE = '22023';
  END IF;

  IF p_kind = 'triad' THEN
    IF p_triad_reflection_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.triad_reflections r WHERE r.id = p_triad_reflection_id AND r.enrollment_id = p_enrollment_id) THEN
      RAISE EXCEPTION 'A Triad submission links your own Triad reflection' USING ERRCODE = '22023';
    END IF;
  ELSE
    IF p_quiz_submission_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.assignment_submissions q WHERE q.id = p_quiz_submission_id AND q.enrollment_id = p_enrollment_id) THEN
      RAISE EXCEPTION 'The quiz answers are not yours' USING ERRCODE = '42501';
    END IF;
  END IF;

  -- Once per attempt. A second attempt only after a released "Resubmit" on
  -- the Final Assessment (decision 5); Not pass is final; Triads: once.
  SELECT s.id, s.attempt_no, s.status,
         (SELECT r.outcome FROM public.assessment_reviews r
          JOIN public.assessment_validations v ON v.review_id = r.id AND v.decision = 'approved'
          WHERE r.submission_id = s.id ORDER BY r.version DESC LIMIT 1) AS outcome
    INTO v_prev
  FROM public.assessment_submissions s
  WHERE s.enrollment_id = p_enrollment_id AND s.cohort_requirement_id = p_cohort_requirement_id
  ORDER BY s.attempt_no DESC LIMIT 1;
  IF FOUND THEN
    IF p_kind = 'final_assessment' AND v_prev.status = 'released' AND v_prev.outcome = 'resubmit' AND v_prev.attempt_no < 2 THEN
      v_attempt := v_prev.attempt_no + 1;
    ELSE
      RAISE EXCEPTION 'This requirement has already been submitted' USING ERRCODE = '23505';
    END IF;
  END IF;

  INSERT INTO public.assessment_submissions (id, enrollment_id, kind, cohort_requirement_id, triad_reflection_id,
    quiz_submission_id, attempt_no, transcript_text, transcript_source, status, submitted_at)
  VALUES (p_submission_id, p_enrollment_id, p_kind, p_cohort_requirement_id, p_triad_reflection_id,
    p_quiz_submission_id, v_attempt, nullif(btrim(p_transcript_text), ''), p_transcript_source,
    'awaiting_assignment', now());
  PERFORM public.assessment_register_files_internal(p_submission_id, NULL, 'learner', p_files);
  RETURN p_submission_id;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 2. admin_assign_assessor (rule 3) -- one or many, assign or reassign
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_assign_assessor(p_submission_ids uuid[], p_assessor_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_sub record;
  n integer := 0;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Only an Admin assigns an assessor' USING ERRCODE = '42501';
  END IF;
  FOR v_sub IN
    SELECT s.*, e.cohort_id FROM public.assessment_submissions s
    JOIN public.programme_enrollments e ON e.id = s.enrollment_id
    WHERE s.id = ANY (p_submission_ids)
    ORDER BY s.id
    FOR UPDATE OF s
  LOOP
    IF NOT EXISTS (SELECT 1 FROM public.cohort_assessors a
                   WHERE a.cohort_id = v_sub.cohort_id AND a.coach_id = p_assessor_id AND a.is_active) THEN
      RAISE EXCEPTION 'The assessor is not in this cohort''s assessor pool' USING ERRCODE = '42501';
    END IF;
    IF public.assessment_is_learners_coach_internal(v_sub.enrollment_id, p_assessor_id) THEN
      RAISE EXCEPTION 'An assessor cannot be the learner''s own programme coach' USING ERRCODE = '42501';
    END IF;
    IF v_sub.status NOT IN ('awaiting_assignment', 'with_assessor', 'returned') THEN
      RAISE EXCEPTION 'A submission % can no longer be (re)assigned', v_sub.status USING ERRCODE = '23514';
    END IF;
    UPDATE public.assessment_assignments SET ended_at = now()
    WHERE submission_id = v_sub.id AND ended_at IS NULL;
    -- Turnaround: 7 days after assignment (decision 7), in programme days.
    INSERT INTO public.assessment_assignments (submission_id, assessor_id, assigned_by, due_on)
    VALUES (v_sub.id, p_assessor_id, auth.uid(), public.programme_today() + 7);
    UPDATE public.assessment_submissions SET status = 'with_assessor' WHERE id = v_sub.id;
    n := n + 1;
  END LOOP;
  IF n <> coalesce(array_length(p_submission_ids, 1), 0) THEN
    RAISE EXCEPTION 'Some submissions do not exist' USING ERRCODE = '23503';
  END IF;
  RETURN n;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 3. coach_submit_review (rule 5)
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
  IF v_sub.kind = 'final_assessment' AND p_outcome NOT IN ('pass', 'not_pass', 'resubmit') THEN
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
-- 4. admin_validate_review (rule 6) -- approve releases and notifies in the
--    same transaction; return needs a reason
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_validate_review(p_review_id uuid, p_decision text, p_reason text DEFAULT NULL)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_review public.assessment_reviews;
  v_sub public.assessment_submissions;
  v_user uuid;
  v_label text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Only an Admin validates a review' USING ERRCODE = '42501';
  END IF;
  IF p_decision NOT IN ('approved', 'returned') THEN
    RAISE EXCEPTION 'The decision is approved or returned' USING ERRCODE = '22023';
  END IF;
  IF p_decision = 'returned' AND nullif(btrim(p_reason), '') IS NULL THEN
    RAISE EXCEPTION 'Returning a review needs a reason' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_review FROM public.assessment_reviews WHERE id = p_review_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Review not found' USING ERRCODE = '23503'; END IF;
  SELECT * INTO v_sub FROM public.assessment_submissions WHERE id = v_review.submission_id FOR UPDATE;
  IF v_sub.status <> 'awaiting_validation'
     OR v_review.version <> (SELECT max(version) FROM public.assessment_reviews WHERE submission_id = v_sub.id)
     OR EXISTS (SELECT 1 FROM public.assessment_validations WHERE review_id = p_review_id) THEN
    RAISE EXCEPTION 'Only the latest review awaiting validation can be decided' USING ERRCODE = '23514';
  END IF;

  INSERT INTO public.assessment_validations (review_id, admin_id, decision, reason)
  VALUES (p_review_id, auth.uid(), p_decision, nullif(btrim(p_reason), ''));

  IF p_decision = 'returned' THEN
    UPDATE public.assessment_submissions SET status = 'returned' WHERE id = v_sub.id;
    RETURN 'returned';
  END IF;

  UPDATE public.assessment_submissions SET status = 'released', released_at = now() WHERE id = v_sub.id;
  SELECT e.user_id INTO v_user FROM public.programme_enrollments e WHERE e.id = v_sub.enrollment_id;
  SELECT CASE WHEN v_sub.kind = 'triad' THEN 'Triad ' || d.ordinal ELSE 'Final Assessment' END INTO v_label
  FROM public.cohort_requirement_dates d WHERE d.id = v_sub.cohort_requirement_id;
  INSERT INTO public.notifications (user_id, notification_type, title, title_vi, body, body_vi, link)
  VALUES (v_user, 'assessment_feedback_released',
    CASE WHEN v_sub.kind = 'triad' THEN format('Your feedback for %s is ready', v_label) ELSE 'Your Final Assessment result is ready' END,
    CASE WHEN v_sub.kind = 'triad' THEN format('Nhận xét cho %s đã sẵn sàng', v_label) ELSE 'Kết quả Final Assessment của bạn đã sẵn sàng' END,
    'Open it to read your assessor''s feedback.',
    'Mở để xem nhận xét của người đánh giá.',
    '/coachee/journey#feedback');
  RETURN 'approved';
END;
$function$;

-- ---------------------------------------------------------------------------
-- 5. learner_mark_feedback_viewed
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.learner_mark_feedback_viewed(p_submission_id uuid)
 RETURNS timestamptz
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_viewed timestamptz;
BEGIN
  UPDATE public.assessment_submissions s
     SET viewed_at = coalesce(s.viewed_at, now())
   WHERE s.id = p_submission_id AND s.status = 'released'
     AND EXISTS (SELECT 1 FROM public.programme_enrollments e WHERE e.id = s.enrollment_id AND e.user_id = auth.uid())
  RETURNING s.viewed_at INTO v_viewed;
  IF v_viewed IS NULL THEN
    RAISE EXCEPTION 'No released feedback of yours with that id' USING ERRCODE = '42501';
  END IF;
  RETURN v_viewed;
END;
$function$;

-- ---------------------------------------------------------------------------
-- Released feedback: one construction behind the learner's and Admin's views
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.canonical_assessment_feedback_internal(p_enrollment_id uuid)
 RETURNS TABLE(submission_id uuid, kind text, requirement_id uuid, requirement_ordinal integer,
               attempt_no integer, submitted_at timestamptz, released_at timestamptz, viewed_at timestamptz,
               assessor_name text, review_id uuid, feedback_text text, outcome text,
               feedback_files jsonb, quiz_correct integer, quiz_total integer, quiz_score_pct numeric)
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
    q.correct_count, q.total_count, q.score_pct
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
  WHERE s.enrollment_id = p_enrollment_id AND s.status = 'released'
  ORDER BY s.released_at DESC;
$function$;
REVOKE ALL ON FUNCTION public.canonical_assessment_feedback_internal(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.canonical_assessment_feedback_internal(uuid) TO service_role;

-- 6. learner_assessment_feedback
CREATE OR REPLACE FUNCTION public.learner_assessment_feedback(p_enrollment_id uuid)
 RETURNS TABLE(submission_id uuid, kind text, requirement_id uuid, requirement_ordinal integer,
               attempt_no integer, submitted_at timestamptz, released_at timestamptz, viewed_at timestamptz,
               assessor_name text, review_id uuid, feedback_text text, outcome text,
               feedback_files jsonb, quiz_correct integer, quiz_total integer, quiz_score_pct numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT f.* FROM public.programme_enrollments e
  CROSS JOIN LATERAL public.canonical_assessment_feedback_internal(e.id) f
  WHERE e.id = p_enrollment_id AND e.user_id = auth.uid() AND auth.uid() IS NOT NULL;
$function$;

-- The learner's submission status (Submitted · Under review · Feedback ready)
-- without any review content, so the Triad / Final pages can show where it is.
CREATE OR REPLACE FUNCTION public.learner_assessment_status(p_enrollment_id uuid)
 RETURNS TABLE(submission_id uuid, kind text, requirement_id uuid, requirement_ordinal integer,
               attempt_no integer, submitted_at timestamptz, learner_status text, can_resubmit boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT s.id, s.kind, s.cohort_requirement_id, d.ordinal, s.attempt_no, s.submitted_at,
    CASE s.status WHEN 'released' THEN 'feedback_ready'
                  WHEN 'awaiting_assignment' THEN 'submitted'
                  ELSE 'under_review' END,
    s.kind = 'final_assessment' AND s.status = 'released' AND s.attempt_no < 2
      AND (SELECT r.outcome FROM public.assessment_reviews r
           JOIN public.assessment_validations v ON v.review_id = r.id AND v.decision = 'approved'
           WHERE r.submission_id = s.id ORDER BY r.version DESC LIMIT 1) = 'resubmit'
      AND NOT EXISTS (SELECT 1 FROM public.assessment_submissions s2
                      WHERE s2.enrollment_id = s.enrollment_id AND s2.cohort_requirement_id = s.cohort_requirement_id
                        AND s2.attempt_no > s.attempt_no)
  FROM public.assessment_submissions s
  JOIN public.programme_enrollments e ON e.id = s.enrollment_id
  JOIN public.cohort_requirement_dates d ON d.id = s.cohort_requirement_id
  WHERE s.enrollment_id = p_enrollment_id AND e.user_id = auth.uid() AND auth.uid() IS NOT NULL
  ORDER BY s.submitted_at DESC;
$function$;

-- ---------------------------------------------------------------------------
-- 7. coach_assessment_inbox (rule 4)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.coach_assessment_inbox()
 RETURNS TABLE(submission_id uuid, inbox_tab text, kind text, cohort_id uuid, cohort_name text,
               learner_name text, requirement_ordinal integer, attempt_no integer, status text,
               submitted_at timestamptz, assigned_at timestamptz, due_on date, is_overdue boolean,
               triad_reflection_id uuid, transcript_text text, quiz_correct integer, quiz_total integer,
               quiz_score_pct numeric, learner_files jsonb, return_reason text,
               my_latest_review_version integer, my_latest_feedback_text text, my_latest_outcome text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH mine AS (
    -- Active assignments: full content.
    SELECT s.*, a.assigned_at, a.due_on, true AS active
    FROM public.assessment_submissions s
    JOIN public.assessment_assignments a ON a.submission_id = s.id AND a.ended_at IS NULL AND a.assessor_id = auth.uid()
    UNION ALL
    -- Released submissions whose approved review is mine: history (no
    -- learner content once the assignment has ended).
    SELECT s.*, NULL::timestamptz, NULL::date, false
    FROM public.assessment_submissions s
    WHERE s.status = 'released'
      AND NOT EXISTS (SELECT 1 FROM public.assessment_assignments a
                      WHERE a.submission_id = s.id AND a.ended_at IS NULL AND a.assessor_id = auth.uid())
      AND EXISTS (SELECT 1 FROM public.assessment_reviews r
                  JOIN public.assessment_validations v ON v.review_id = r.id AND v.decision = 'approved'
                  WHERE r.submission_id = s.id AND r.assessor_id = auth.uid())
  )
  SELECT m.id,
    CASE m.status WHEN 'with_assessor' THEN 'to_assess' WHEN 'returned' THEN 'returned'
                  WHEN 'awaiting_validation' THEN 'awaiting_validation' ELSE 'released' END,
    m.kind, c.id, c.name, lp.full_name, d.ordinal, m.attempt_no, m.status, m.submitted_at,
    m.assigned_at, m.due_on,
    m.active AND m.status IN ('with_assessor', 'returned') AND m.due_on < public.programme_today(),
    CASE WHEN m.active THEN m.triad_reflection_id END,
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
    mr.version, mr.feedback_text, mr.outcome
  FROM mine m
  JOIN public.programme_enrollments e ON e.id = m.enrollment_id
  JOIN public.cohorts c ON c.id = e.cohort_id
  JOIN public.profiles lp ON lp.id = e.user_id
  JOIN public.cohort_requirement_dates d ON d.id = m.cohort_requirement_id
  LEFT JOIN public.assignment_submissions q ON q.id = m.quiz_submission_id
  LEFT JOIN LATERAL (
    SELECT r.version, r.feedback_text, r.outcome FROM public.assessment_reviews r
    WHERE r.submission_id = m.id AND r.assessor_id = auth.uid() ORDER BY r.version DESC LIMIT 1
  ) mr ON true
  WHERE auth.uid() IS NOT NULL
  ORDER BY m.due_on NULLS LAST, m.submitted_at;
$function$;

-- ---------------------------------------------------------------------------
-- 8. admin_assessment_queue
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_assessment_queue(
  p_programme_id uuid DEFAULT NULL, p_cohort_id uuid DEFAULT NULL, p_kind text DEFAULT NULL, p_status text DEFAULT NULL)
 RETURNS TABLE(submission_id uuid, enrollment_id uuid, learner_name text, programme_id uuid, programme_name text,
               cohort_id uuid, cohort_name text, kind text, requirement_ordinal integer, attempt_no integer,
               status text, submitted_at timestamptz, assessor_id uuid, assessor_name text, assigned_at timestamptz,
               due_on date, review_overdue boolean, review_id uuid, review_version integer, review_text text,
               review_outcome text, review_submitted_at timestamptz, review_files jsonb, last_decision text,
               last_reason text, released_at timestamptz, viewed_at timestamptz)
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
    v.decision, v.reason, s.released_at, s.viewed_at
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

-- ---------------------------------------------------------------------------
-- Sponsor: status and result only (rule 11; decision 11)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sponsor_final_assessment_status(p_enrollment_id uuid)
 RETURNS TABLE(status text, result text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  -- The latest Final Assessment attempt of a visible leader: Not submitted ·
  -- Under review · Completed, and Pass / Not pass once released. Resubmit
  -- shows as Under review. No content, ever; nothing for Triads.
  WITH visible AS (
    SELECT v.enrollment_id FROM public.sponsor_visible_enrollments() v WHERE v.enrollment_id = p_enrollment_id
  ), latest AS (
    SELECT s.* FROM public.assessment_submissions s JOIN visible ON visible.enrollment_id = s.enrollment_id
    WHERE s.kind = 'final_assessment'
    ORDER BY s.attempt_no DESC LIMIT 1
  ), outcome AS (
    SELECT r.outcome FROM latest l
    JOIN public.assessment_reviews r ON r.submission_id = l.id
    JOIN public.assessment_validations v ON v.review_id = r.id AND v.decision = 'approved'
    ORDER BY r.version DESC LIMIT 1
  )
  SELECT
    CASE WHEN NOT EXISTS (SELECT 1 FROM latest) THEN 'not_submitted'
         WHEN (SELECT status FROM latest) = 'released' AND (SELECT outcome FROM outcome) IN ('pass', 'not_pass') THEN 'completed'
         ELSE 'under_review' END,
    CASE WHEN (SELECT status FROM latest) = 'released' AND (SELECT outcome FROM outcome) IN ('pass', 'not_pass')
         THEN (SELECT outcome FROM outcome) END
  WHERE EXISTS (SELECT 1 FROM visible);
$function$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
DO $grant$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'admin_set_cohort_assessor(uuid, uuid, boolean)', 'admin_cohort_assessors(uuid)',
    'learner_submit_assessment(uuid, uuid, uuid, text, uuid, uuid, text, text, jsonb)',
    'admin_assign_assessor(uuid[], uuid)', 'coach_submit_review(uuid, text, text, jsonb)',
    'admin_validate_review(uuid, text, text)', 'learner_mark_feedback_viewed(uuid)',
    'learner_assessment_feedback(uuid)', 'learner_assessment_status(uuid)', 'coach_assessment_inbox()',
    'admin_assessment_queue(uuid, uuid, text, text)', 'sponsor_final_assessment_status(uuid)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated, service_role', f);
  END LOOP;
END
$grant$;
