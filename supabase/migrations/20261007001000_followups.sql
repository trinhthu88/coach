-- ===========================================================================
-- Follow-ups from Prompts 11-14 (Prompt 15, Part A)
--
--   1. book_peer_session requires p_slot_id: coach-pool practice is booked
--      into one of the peer Coach's Peer slots (the booking page always sends
--      one; a NULL slot was a booking with no availability behind it).
--   2. "Submissions: user delete own" leaves the Final Assessment quiz out, as
--      the read policy does (trg_prevent_quiz_resubmission already refuses
--      deleting any quiz row).
--   3. assessment_assignments.assignment_source ('admin' | 'auto_resubmit');
--      the automatic attempt-2 assignment has assigned_by NULL instead of
--      borrowing attempt 1's Admin.
--   4. No TRUNCATE on any public table for anon / authenticated (TRUNCATE
--      skips RLS), now or for tables created later.
--   (5. A late cancel inside 24 h keeps freeing the unit for Coaching and
--      Mentoring -- no SQL change; the mentee Cancel button is app code.)
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Coach-pool practice needs a slot
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.book_peer_session(p_peer_coach_id uuid, p_enrollment_id uuid, p_topic text, p_start_time timestamp with time zone, p_duration_minutes integer, p_slot_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  booked_id uuid;
  v_slot public.coach_availability;
  v_slot_start timestamptz;
  v_slot_end timestamptz;
BEGIN
  IF auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.programme_enrollments e
    WHERE e.id = p_enrollment_id AND e.user_id = auth.uid()
  ) THEN
    PERFORM public.assert_enrollment_goal_gate(p_enrollment_id);
  END IF;
  IF p_start_time IS NULL OR p_start_time < now() THEN
    RAISE EXCEPTION 'A session cannot be booked in the past' USING ERRCODE='22023';
  END IF;
  IF NOT public.can_book_peer_session(p_peer_coach_id,p_enrollment_id) THEN
    RAISE EXCEPTION 'Peer booking is not allowed for this enrollment' USING ERRCODE='42501';
  END IF;
  -- After the eligibility checks, so a refusal for the enrollment keeps its own
  -- error; then the slot, which coach-pool practice always has.
  IF p_slot_id IS NULL THEN
    RAISE EXCEPTION 'Choose one of the Coach''s Peer slots' USING ERRCODE = '22023';
  END IF;
  IF p_slot_id IS NOT NULL THEN
    SELECT * INTO v_slot FROM public.coach_availability WHERE id = p_slot_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Availability slot % does not exist', p_slot_id USING ERRCODE = '23503';
    END IF;
    IF v_slot.coach_id IS DISTINCT FROM p_peer_coach_id THEN
      RAISE EXCEPTION 'Availability slot belongs to a different Coach' USING ERRCODE = '42501';
    END IF;
    IF v_slot.slot_type <> 'peer'::public.availability_slot_type THEN
      RAISE EXCEPTION 'Availability slot is not a Peer slot (type=%)', v_slot.slot_type USING ERRCODE = '23514';
    END IF;
    IF v_slot.is_booked THEN
      RAISE EXCEPTION 'Availability slot is no longer available' USING ERRCODE = '23505';
    END IF;
    v_slot_start := (v_slot.slot_date + v_slot.start_time) AT TIME ZONE public.availability_slot_time_zone(v_slot.coach_id);
    v_slot_end   := (v_slot.slot_date + v_slot.end_time) AT TIME ZONE public.availability_slot_time_zone(v_slot.coach_id);
    IF p_duration_minutes IS NULL OR p_duration_minutes <= 0
       OR p_start_time < v_slot_start OR p_start_time + make_interval(mins => p_duration_minutes) > v_slot_end THEN
      RAISE EXCEPTION 'Requested time % for % minutes falls outside the availability slot (% to %)',
        p_start_time, p_duration_minutes, v_slot_start, v_slot_end USING ERRCODE = '23514';
    END IF;
  END IF;
  INSERT INTO public.peer_sessions
    (peer_coach_id,peer_coachee_id,enrollment_id,topic,start_time,duration_minutes,status,slot_id)
  VALUES
    (p_peer_coach_id,auth.uid(),p_enrollment_id,p_topic,p_start_time,
     p_duration_minutes,'pending_coach_approval'::public.session_status,p_slot_id)
  RETURNING id INTO booked_id;
  RETURN booked_id;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 2. The learner's delete policy matches the read policy
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Submissions: user delete own" ON public.assignment_submissions;
CREATE POLICY "Submissions: user delete own" ON public.assignment_submissions FOR DELETE TO authenticated
  USING (user_id = auth.uid() AND NOT public.assignment_is_final_assessment_quiz(assignment_id));

-- ---------------------------------------------------------------------------
-- 3. Who (or what) assigned an assessor
-- ---------------------------------------------------------------------------
ALTER TABLE public.assessment_assignments
  ADD COLUMN IF NOT EXISTS assignment_source text NOT NULL DEFAULT 'admin';
ALTER TABLE public.assessment_assignments ALTER COLUMN assigned_by DROP NOT NULL;
ALTER TABLE public.assessment_assignments DROP CONSTRAINT IF EXISTS assessment_assignments_source_check;
ALTER TABLE public.assessment_assignments ADD CONSTRAINT assessment_assignments_source_check
  CHECK (assignment_source IN ('admin', 'auto_resubmit')
         AND (assignment_source = 'admin') = (assigned_by IS NOT NULL));
COMMENT ON COLUMN public.assessment_assignments.assignment_source IS
  'admin: assigned by assigned_by (admin_assign_assessor); auto_resubmit: attempt 2 back to attempt 1''s assessor, assigned_by NULL (learner_submit_assessment, 20261007001000).';

CREATE OR REPLACE FUNCTION public.learner_submit_assessment(p_submission_id uuid, p_enrollment_id uuid, p_cohort_requirement_id uuid, p_kind text, p_triad_reflection_id uuid DEFAULT NULL::uuid, p_quiz_submission_id uuid DEFAULT NULL::uuid, p_transcript_text text DEFAULT NULL::text, p_transcript_source text DEFAULT 'none'::text, p_files jsonb DEFAULT '[]'::jsonb)
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

  -- Attempt 2: back to the assessor whose Resubmit was approved, while they
  -- are still in the cohort's pool (and still not the learner's own coach).
  -- Nobody assigns it: assigned_by stays NULL, assignment_source says why.
  -- Otherwise it waits for Admin.
  IF v_attempt > 1 THEN
    SELECT r.assessor_id INTO v_assessor
    FROM public.assessment_reviews r
    JOIN public.assessment_validations v ON v.review_id = r.id AND v.decision = 'approved'
    WHERE r.submission_id = v_prev.id ORDER BY r.version DESC LIMIT 1;
    IF v_assessor IS NOT NULL
       AND EXISTS (SELECT 1 FROM public.cohort_assessors ca
                   WHERE ca.cohort_id = v_enr.cohort_id AND ca.coach_id = v_assessor AND ca.is_active)
       AND NOT public.assessment_is_learners_coach_internal(p_enrollment_id, v_assessor) THEN
      -- Turnaround: 7 days after assignment (decision 7), in programme days.
      INSERT INTO public.assessment_assignments (submission_id, assessor_id, assigned_by, due_on, assignment_source)
      VALUES (p_submission_id, v_assessor, NULL, public.programme_today() + 7, 'auto_resubmit');
      UPDATE public.assessment_submissions SET status = 'with_assessor' WHERE id = p_submission_id;
    END IF;
  END IF;
  RETURN p_submission_id;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 4. TRUNCATE: never for the client roles
-- ---------------------------------------------------------------------------
DO $truncate$
DECLARE t record;
BEGIN
  FOR t IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') LOOP
    EXECUTE format('REVOKE TRUNCATE ON public.%I FROM anon, authenticated', t.relname);
  END LOOP;
END
$truncate$;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE TRUNCATE ON TABLES FROM anon, authenticated;
