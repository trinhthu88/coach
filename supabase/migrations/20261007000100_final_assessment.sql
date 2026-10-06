-- ===========================================================================
-- Final Assessment module (Prompt A5, part 2 of 2)
--
-- PROGRAMME  programme_modules (module = 'final_assessment').config:
--              required          boolean
--              required_units    1 when required, else 0 (normalised here)
--              quiz_enabled      boolean; the quiz is an assignment that
--                                belongs to the final assessment
--              pass_mark_pct     0-100, the quiz pass mark (null: no mark)
--              accepted_mime     ['audio/mpeg'] -- fixed, MP3 only
--              max_file_mb       50             -- fixed
--              transcript        'none' | 'optional' | 'required'
--              instructions, instructions_vi
-- COHORT     sync_cohort_requirement_dates creates ONE 'Final assessment'
--            requirement per cohort through the session-module path
--            (required_units = 1, default due date = the module deadline,
--            itself the cohort end date until an Admin moves it).
-- QUIZ       assignments.final_assessment_programme_id (instead of a training
--            week); assignment_submissions.attempt_no (1 or 2).
-- CANONICAL  canonical_final_assessment_fulfilment -> the requirement
--            calendar -> canonical_module_progress (fulfilled once a final
--            result, Pass or Not pass, is released);
--            canonical_final_assessment_result -> the learner, Admin and
--            Sponsor wrappers (quiz score from assignment_submissions.score_pct,
--            above / below the pass mark decided here, final result = the
--            approved review's outcome; Resubmit opens attempt 2, max 2; Not
--            pass is final).
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Programme config: one requirement, MP3 only, 50 MB
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.normalise_final_assessment_config()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_required boolean := coalesce((NEW.config->>'required')::boolean, false);
  v_quiz boolean := coalesce((NEW.config->>'quiz_enabled')::boolean, false);
  v_transcript text := coalesce(NEW.config->>'transcript', 'optional');
  v_pass numeric;
BEGIN
  IF NEW.module <> 'final_assessment'::public.programme_module_type THEN
    RETURN NEW;
  END IF;
  IF v_transcript NOT IN ('none', 'optional', 'required') THEN
    RAISE EXCEPTION 'The transcript setting is none, optional or required' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(NEW.config->'pass_mark_pct') = 'number' THEN
    v_pass := (NEW.config->>'pass_mark_pct')::numeric;
    IF v_pass < 0 OR v_pass > 100 THEN
      RAISE EXCEPTION 'The pass mark is a percentage from 0 to 100' USING ERRCODE = '22023';
    END IF;
  END IF;
  NEW.config := NEW.config
    || jsonb_build_object(
         'required', v_required,
         'required_units', CASE WHEN v_required THEN 1 ELSE 0 END,
         'quiz_enabled', v_quiz,
         'pass_mark_pct', CASE WHEN v_quiz THEN to_jsonb(v_pass) ELSE 'null'::jsonb END,
         'accepted_mime', jsonb_build_array('audio/mpeg'),
         'max_file_mb', 50,
         'transcript', v_transcript);
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS programme_modules_final_assessment_config ON public.programme_modules;
CREATE TRIGGER programme_modules_final_assessment_config
  BEFORE INSERT OR UPDATE OF config, module ON public.programme_modules
  FOR EACH ROW EXECUTE FUNCTION public.normalise_final_assessment_config();

-- The one label every surface shows.
CREATE OR REPLACE FUNCTION public.cohort_requirement_label(
  p_module public.programme_module_type, p_ordinal integer, p_week_number integer DEFAULT NULL, p_week_title text DEFAULT NULL
) RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT CASE p_module
    WHEN 'coaching'::public.programme_module_type THEN 'Coaching Session ' || p_ordinal
    WHEN 'mentoring'::public.programme_module_type THEN 'Mentoring Session ' || p_ordinal
    WHEN 'peer_coaching'::public.programme_module_type THEN 'Peer Practice ' || p_ordinal
    WHEN 'triads'::public.programme_module_type THEN 'Triad ' || p_ordinal
    WHEN 'final_assessment'::public.programme_module_type THEN 'Final assessment'
    WHEN 'training'::public.programme_module_type THEN
      'Week ' || coalesce(p_week_number, p_ordinal) || coalesce(': ' || nullif(p_week_title, ''), '')
    ELSE initcap(replace(p_module::text, '_', ' ')) || ' ' || p_ordinal
  END;
$$;

-- ---------------------------------------------------------------------------
-- 2. A quiz can belong to the final assessment; submissions carry an attempt
-- ---------------------------------------------------------------------------
ALTER TABLE public.assignments ALTER COLUMN training_week_id DROP NOT NULL;
ALTER TABLE public.assignments
  ADD COLUMN IF NOT EXISTS final_assessment_programme_id uuid REFERENCES public.programmes(id) ON DELETE CASCADE;
ALTER TABLE public.assignments DROP CONSTRAINT IF EXISTS assignments_one_owner;
ALTER TABLE public.assignments ADD CONSTRAINT assignments_one_owner
  CHECK (num_nonnulls(training_week_id, final_assessment_programme_id) = 1);
ALTER TABLE public.assignments DROP CONSTRAINT IF EXISTS assignments_final_assessment_is_quiz;
ALTER TABLE public.assignments ADD CONSTRAINT assignments_final_assessment_is_quiz
  CHECK (final_assessment_programme_id IS NULL OR assignment_type = 'quiz'::public.assignment_type);
-- One final quiz per programme.
CREATE UNIQUE INDEX IF NOT EXISTS ux_assignments_final_assessment
  ON public.assignments (final_assessment_programme_id) WHERE final_assessment_programme_id IS NOT NULL;
COMMENT ON COLUMN public.assignments.final_assessment_programme_id IS
  'Set instead of training_week_id for the quiz of a programme''s Final Assessment (20261007000100).';

ALTER TABLE public.assignment_submissions
  ADD COLUMN IF NOT EXISTS attempt_no integer NOT NULL DEFAULT 1;
ALTER TABLE public.assignment_submissions DROP CONSTRAINT IF EXISTS assignment_submissions_attempt_no_check;
ALTER TABLE public.assignment_submissions ADD CONSTRAINT assignment_submissions_attempt_no_check
  CHECK (attempt_no BETWEEN 1 AND 2);
DROP INDEX IF EXISTS public.assignment_submissions_enrollment_assignment_key;
CREATE UNIQUE INDEX assignment_submissions_enrollment_assignment_key
  ON public.assignment_submissions (enrollment_id, assignment_id, attempt_no);
-- A Training assignment is answered once; only a Final Assessment quiz has a second attempt.
CREATE OR REPLACE FUNCTION public.guard_assignment_attempt()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NEW.attempt_no > 1 AND NOT EXISTS (
    SELECT 1 FROM public.assignments a WHERE a.id = NEW.assignment_id AND a.final_assessment_programme_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Only a Final Assessment quiz has a second attempt' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;
DROP TRIGGER IF EXISTS assignment_submissions_attempt_guard ON public.assignment_submissions;
CREATE TRIGGER assignment_submissions_attempt_guard
  BEFORE INSERT OR UPDATE OF attempt_no ON public.assignment_submissions
  FOR EACH ROW EXECUTE FUNCTION public.guard_assignment_attempt();

-- The Final Assessment quiz is not Training activity: no cadence attribution.
CREATE OR REPLACE FUNCTION public.attribute_new_activity_trigger()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_TABLE_NAME='sessions' THEN
    IF NEW.enrollment_id IS NOT NULL THEN
      PERFORM public.attribute_activity_to_cadence_milestone(
        NEW.enrollment_id,'coaching',NEW.id,(NEW.start_time AT TIME ZONE public.programme_time_zone())::date
      );
    END IF;
  ELSIF TG_TABLE_NAME IN ('peer_sessions','coachee_peer_sessions') THEN
    IF NEW.enrollment_id IS NOT NULL THEN
      PERFORM public.attribute_activity_to_cadence_milestone(
        NEW.enrollment_id,'peer_coaching',NEW.id,(NEW.start_time AT TIME ZONE public.programme_time_zone())::date
      );
    END IF;
  ELSIF TG_TABLE_NAME='mentoring_sessions' THEN
    IF NEW.enrollment_id IS NOT NULL THEN
      PERFORM public.attribute_activity_to_cadence_milestone(
        NEW.enrollment_id,'mentoring',NEW.id,(NEW.start_time AT TIME ZONE public.programme_time_zone())::date
      );
    END IF;
  ELSIF TG_TABLE_NAME='training_progress' THEN
    IF NEW.enrollment_id IS NOT NULL AND NEW.completed_at IS NOT NULL THEN
      PERFORM public.attribute_activity_to_cadence_milestone(
        NEW.enrollment_id,'training',NEW.id,(NEW.completed_at AT TIME ZONE public.programme_time_zone())::date
      );
    END IF;
  ELSIF TG_TABLE_NAME='assignment_submissions' THEN
    IF NEW.enrollment_id IS NOT NULL
       AND NEW.submitted_at IS NOT NULL
       AND EXISTS (
         SELECT 1
         FROM public.assignments a
         WHERE a.id = NEW.assignment_id
           AND a.assignment_type = 'quiz'
           AND a.training_week_id IS NOT NULL
       )
    THEN
      PERFORM public.attribute_activity_to_cadence_milestone(
        NEW.enrollment_id,
        'quiz',
        NEW.id,
        (NEW.submitted_at AT TIME ZONE public.programme_time_zone())::date
      );
    END IF;
  ELSIF TG_TABLE_NAME='daily_prompt_responses' THEN
    IF NEW.enrollment_id IS NOT NULL AND NEW.responded_at IS NOT NULL THEN
      PERFORM public.attribute_activity_to_cadence_milestone(
        NEW.enrollment_id,'daily_prompt',NEW.id,(NEW.responded_at AT TIME ZONE public.programme_time_zone())::date
      );
    END IF;
  END IF;
  RETURN NEW;
END $function$;

-- ---------------------------------------------------------------------------
-- 3. Canonical: fulfilment and result
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.final_assessment_config_internal(p_enrollment_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT pm.config
  FROM public.programme_enrollments e
  JOIN public.programme_modules pm
    ON pm.programme_id = e.programme_id AND pm.module = 'final_assessment'::public.programme_module_type AND pm.enabled
  WHERE e.id = p_enrollment_id;
$function$;

-- One row per final-assessment requirement of the enrollment's cohort (there
-- is one), describing its latest attempt.
CREATE OR REPLACE FUNCTION public.canonical_final_assessment_result(p_enrollment_id uuid)
 RETURNS TABLE(enrollment_id uuid, requirement_id uuid, due_on date, attempt_no integer, submission_id uuid,
               submission_status text, state text, submitted_at timestamptz, released_at timestamptz,
               quiz_enabled boolean, quiz_assignment_id uuid, quiz_submission_id uuid,
               quiz_correct integer, quiz_total integer, quiz_score_pct numeric, pass_mark_pct numeric,
               quiz_passed boolean, outcome text, final_result text, can_resubmit boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH e AS (
    SELECT pe.id, pe.programme_id, pe.cohort_id, public.final_assessment_config_internal(pe.id) AS config
    FROM public.programme_enrollments pe WHERE pe.id = p_enrollment_id
  ), req AS (
    SELECT d.id, d.due_on FROM e
    JOIN public.cohort_requirement_dates d
      ON d.cohort_id = e.cohort_id AND d.programme_id = e.programme_id
     AND d.module = 'final_assessment'::public.programme_module_type
    WHERE coalesce((e.config->>'required')::boolean, false)
  ), quiz AS (
    SELECT a.id FROM e JOIN public.assignments a ON a.final_assessment_programme_id = e.programme_id
    WHERE coalesce((e.config->>'quiz_enabled')::boolean, false)
  ), latest AS (
    SELECT s.* FROM public.assessment_submissions s JOIN req ON req.id = s.cohort_requirement_id
    WHERE s.enrollment_id = p_enrollment_id
    ORDER BY s.attempt_no DESC LIMIT 1
  ), approved AS (
    SELECT r.outcome FROM latest l
    JOIN public.assessment_reviews r ON r.submission_id = l.id
    JOIN public.assessment_validations v ON v.review_id = r.id AND v.decision = 'approved'
    ORDER BY r.version DESC LIMIT 1
  ), base AS (
    SELECT req.id AS requirement_id, req.due_on,
      l.id AS submission_id, l.status, l.attempt_no AS sub_attempt, l.submitted_at, l.released_at,
      (SELECT outcome FROM approved) AS approved_outcome,
      coalesce((SELECT (config->>'quiz_enabled')::boolean FROM e), false) AS quiz_enabled,
      (SELECT id FROM quiz) AS quiz_assignment_id,
      (SELECT (config->>'pass_mark_pct')::numeric FROM e) AS pass_mark_pct
    FROM req LEFT JOIN latest l ON true
  ), staged AS (
    SELECT b.*,
      -- Resubmit opens attempt 2; Not pass is final; max 2 attempts.
      (b.status = 'released' AND b.approved_outcome = 'resubmit' AND b.sub_attempt < 2) AS reopened
    FROM base b
  )
  SELECT p_enrollment_id, s.requirement_id, s.due_on,
    CASE WHEN s.submission_id IS NULL THEN 1 WHEN s.reopened THEN s.sub_attempt + 1 ELSE s.sub_attempt END,
    CASE WHEN s.reopened THEN NULL ELSE s.submission_id END,
    CASE WHEN s.reopened THEN NULL ELSE s.status END,
    CASE
      WHEN s.submission_id IS NULL THEN 'not_submitted'
      WHEN s.reopened THEN 'resubmit_requested'
      WHEN s.status = 'awaiting_assignment' THEN 'submitted'
      WHEN s.status = 'released' THEN 'completed'
      ELSE 'under_review'
    END,
    CASE WHEN s.reopened THEN NULL ELSE s.submitted_at END,
    s.released_at,
    s.quiz_enabled, s.quiz_assignment_id,
    qa.id, qa.correct_count, qa.total_count, qa.score_pct, s.pass_mark_pct,
    -- Above / below the pass mark is decided here, from the stored score.
    CASE WHEN qa.score_pct IS NULL OR s.pass_mark_pct IS NULL THEN NULL ELSE qa.score_pct >= s.pass_mark_pct END,
    CASE WHEN s.status = 'released' THEN s.approved_outcome END,
    CASE WHEN s.status = 'released' AND s.approved_outcome IN ('pass', 'not_pass') THEN s.approved_outcome END,
    coalesce(s.reopened, false)
  FROM staged s
  LEFT JOIN LATERAL (
    -- The quiz answers of the attempt shown: the released attempt's, or the
    -- open attempt's once taken.
    SELECT q.* FROM public.assignment_submissions q
    WHERE q.enrollment_id = p_enrollment_id AND q.assignment_id = s.quiz_assignment_id
      AND q.attempt_no = CASE WHEN s.submission_id IS NULL THEN 1 WHEN s.reopened THEN s.sub_attempt + 1 ELSE s.sub_attempt END
  ) qa ON true;
$function$;

-- Fulfilled when a final result (Pass or Not pass) is released.
CREATE OR REPLACE FUNCTION public.canonical_final_assessment_fulfilment(p_enrollment_id uuid)
 RETURNS TABLE(requirement_id uuid, fulfilled_on date, final_result text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT r.requirement_id, (r.released_at AT TIME ZONE public.programme_time_zone())::date, r.final_result
  FROM public.canonical_final_assessment_result(p_enrollment_id) r
  WHERE r.state = 'completed' AND r.final_result IS NOT NULL;
$function$;

REVOKE ALL ON FUNCTION public.final_assessment_config_internal(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.canonical_final_assessment_result(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.canonical_final_assessment_fulfilment(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.final_assessment_config_internal(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.canonical_final_assessment_result(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.canonical_final_assessment_fulfilment(uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 4. The requirement calendar counts it (and with it canonical_module_progress,
--    canonical_overdue_items and both journeys). Unlike a session, the final
--    assessment is open from the enrollment start, not from due - 14.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.canonical_enrollment_requirement_calendar(p_enrollment_id uuid, p_as_of date DEFAULT public.programme_today())
 RETURNS TABLE(enrollment_id uuid, programme_id uuid, cohort_id uuid, organization_id uuid, module programme_module_type, requirement_id uuid, requirement_index integer, requirement_label text, training_week_id uuid, due_on date, is_required boolean, is_due_as_of boolean, is_completed boolean, completed_on date, is_overdue boolean, completion_source text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH eff AS (
    SELECT coalesce(public.canonical_enrollment_effective_as_of(p_enrollment_id, p_as_of), p_as_of) AS as_of
  ), enrollment AS (
    SELECT e.id, e.programme_id, e.cohort_id, e.organization_id
    FROM public.programme_enrollments e
    JOIN public.cohorts c ON c.id = e.cohort_id
    WHERE e.id = p_enrollment_id
  ), session_units AS (
    SELECT pm.module, g.i AS ordinal
    FROM enrollment e
    JOIN public.programme_modules pm
      ON pm.programme_id = e.programme_id
     AND pm.enabled
     AND pm.module <> 'training'::public.programme_module_type
     AND coalesce((pm.config->>'required')::boolean, false)
    CROSS JOIN LATERAL generate_series(1, coalesce(public.programme_config_integer(pm.config, 'required_units'), 0)) g(i)
  ), fulfilment AS (
    SELECT f.requirement_id, f.fulfilled_on, 'coaching_session'::text AS source
    FROM public.canonical_coaching_requirement_fulfilment(p_enrollment_id) f
    UNION ALL
    SELECT f.requirement_id, f.fulfilled_on, 'mentoring_session'
    FROM public.canonical_mentoring_requirement_fulfilment(p_enrollment_id) f
    UNION ALL
    SELECT f.requirement_id, f.fulfilled_on, 'peer_session'
    FROM public.canonical_peer_requirement_fulfilment(p_enrollment_id) f
    UNION ALL
    SELECT f.cohort_requirement_date_id, f.fulfilled_on, 'triad_session'
    FROM public.canonical_triad_requirement_fulfilment(p_enrollment_id) f
    UNION ALL
    SELECT f.requirement_id, f.fulfilled_on, 'final_assessment_result'
    FROM public.canonical_final_assessment_fulfilment(p_enrollment_id) f
  ), rows AS (
    SELECT u.module, d.id AS requirement_id, u.ordinal AS requirement_index,
      public.cohort_requirement_label(u.module, u.ordinal) AS requirement_label,
      NULL::uuid AS training_week_id, d.due_on,
      -- A session counts only within [due_on - 14, effective as-of]; the
      -- final assessment counts whenever its result was released, up to as-of.
      CASE
        WHEN u.module = 'final_assessment'::public.programme_module_type
          THEN CASE WHEN f.fulfilled_on <= (SELECT eff.as_of FROM eff) THEN f.fulfilled_on END
        WHEN f.fulfilled_on BETWEEN public.canonical_session_requirement_available_on(d.due_on) AND (SELECT eff.as_of FROM eff)
          THEN f.fulfilled_on
      END AS completed_on,
      CASE
        WHEN u.module = 'final_assessment'::public.programme_module_type
          THEN CASE WHEN f.fulfilled_on <= (SELECT eff.as_of FROM eff) THEN f.source END
        WHEN f.fulfilled_on BETWEEN public.canonical_session_requirement_available_on(d.due_on) AND (SELECT eff.as_of FROM eff)
          THEN f.source
      END AS completion_source
    FROM session_units u
    CROSS JOIN enrollment e
    -- 20261001110000: only a requirement with its own stored date exists. A
    -- programme unit the cohort has not materialised is a schedule gap
    -- (requirement_integrity_issues), not a requirement nobody can complete.
    JOIN public.cohort_requirement_dates d
      ON d.cohort_id = e.cohort_id AND d.programme_id = e.programme_id
     AND d.module = u.module AND d.ordinal = u.ordinal
    LEFT JOIN fulfilment f ON f.requirement_id = d.id

    UNION ALL
    SELECT 'training'::public.programme_module_type, d.id,
      coalesce(d.ordinal, row_number() OVER (ORDER BY tw.week_number)::integer),
      public.cohort_requirement_label('training', coalesce(d.ordinal, tw.week_number), tw.week_number, tw.title),
      i.training_week_id, i.due_on,
      CASE WHEN i.completed_units > 0 THEN i.completed_on END,
      CASE WHEN i.completed_units > 0 THEN 'training_week' END
    FROM public.canonical_training_learning_items(p_enrollment_id, (SELECT eff.as_of FROM eff)) i
    CROSS JOIN enrollment e
    JOIN public.training_weeks tw ON tw.id = i.training_week_id
    JOIN public.cohort_requirement_dates d
      ON d.cohort_id = e.cohort_id AND d.programme_id = e.programme_id
     AND d.module = 'training'::public.programme_module_type AND d.training_week_id = i.training_week_id
  )
  SELECT e.id, e.programme_id, e.cohort_id, e.organization_id,
    r.module, r.requirement_id, r.requirement_index, r.requirement_label, r.training_week_id,
    r.due_on,
    true,
    r.due_on IS NOT NULL AND r.due_on <= (SELECT eff.as_of FROM eff),
    r.completed_on IS NOT NULL,
    r.completed_on,
    -- Overdue = the due date has PASSED and the requirement is still open.
    r.due_on IS NOT NULL AND r.due_on < (SELECT eff.as_of FROM eff) AND r.completed_on IS NULL,
    r.completion_source
  FROM rows r
  CROSS JOIN enrollment e
  ORDER BY r.module, r.requirement_index;
$function$;

CREATE OR REPLACE FUNCTION public.canonical_enrollment_requirement_status(p_enrollment_id uuid, p_as_of date DEFAULT public.programme_today())
 RETURNS TABLE(enrollment_id uuid, module programme_module_type, requirement_id uuid, requirement_index integer, requirement_label text, training_week_id uuid, available_on date, due_on date, completed_on date, effective_as_of date, state text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH eff AS (
    SELECT coalesce(public.canonical_enrollment_effective_as_of(p_enrollment_id, p_as_of), p_as_of) AS as_of
  ), availability AS (
    SELECT f.training_week_id, f.available_on
    FROM public.canonical_training_week_fulfilment(p_enrollment_id, p_as_of) f
  ), enrollment AS (
    SELECT e.start_date FROM public.programme_enrollments e WHERE e.id = p_enrollment_id
  ), rows AS (
    SELECT c.enrollment_id, c.module, c.requirement_id, c.requirement_index, c.requirement_label,
      c.training_week_id, c.due_on, c.completed_on,
      CASE
        WHEN c.module = 'training'::public.programme_module_type THEN a.available_on
        -- Open from the start of the enrollment.
        WHEN c.module = 'final_assessment'::public.programme_module_type
          THEN least(coalesce((SELECT start_date FROM enrollment), c.due_on), c.due_on)
        ELSE public.canonical_session_requirement_available_on(c.due_on)
      END AS available_on
    FROM public.canonical_enrollment_requirement_calendar(p_enrollment_id, p_as_of) c
    LEFT JOIN availability a ON a.training_week_id = c.training_week_id
  )
  SELECT r.enrollment_id, r.module, r.requirement_id, r.requirement_index, r.requirement_label,
    r.training_week_id, r.available_on, r.due_on, r.completed_on, eff.as_of,
    CASE
      WHEN r.available_on IS NULL OR r.available_on > eff.as_of THEN 'upcoming'
      WHEN r.completed_on IS NOT NULL AND r.completed_on <= r.due_on THEN 'completed'
      WHEN r.completed_on IS NOT NULL THEN 'completed_late'
      WHEN r.due_on < eff.as_of THEN 'overdue'
      ELSE 'current'
    END
  FROM rows r
  CROSS JOIN eff
  ORDER BY r.due_on, r.module, r.requirement_index;
$function$;

-- ---------------------------------------------------------------------------
-- 5. Submitting: the attempt's quiz, one MP3, the transcript the programme asks for
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

  IF p_kind = 'triad' THEN
    IF p_triad_reflection_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.triad_reflections r WHERE r.id = p_triad_reflection_id AND r.enrollment_id = p_enrollment_id) THEN
      RAISE EXCEPTION 'A Triad submission links your own Triad reflection' USING ERRCODE = '22023';
    END IF;
  ELSE
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
  END IF;

  INSERT INTO public.assessment_submissions (id, enrollment_id, kind, cohort_requirement_id, triad_reflection_id,
    quiz_submission_id, attempt_no, transcript_text, transcript_source, status, submitted_at)
  VALUES (p_submission_id, p_enrollment_id, p_kind, p_cohort_requirement_id, p_triad_reflection_id,
    p_quiz_submission_id, v_attempt, nullif(btrim(p_transcript_text), ''),
    CASE WHEN nullif(btrim(p_transcript_text), '') IS NULL AND p_transcript_source = 'pasted' THEN 'none' ELSE p_transcript_source END,
    'awaiting_assignment', now());
  PERFORM public.assessment_register_files_internal(p_submission_id, NULL, 'learner', p_files);
  RETURN p_submission_id;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 6. The learner's Final Assessment page
-- ---------------------------------------------------------------------------
-- State, config and, only once released, the quiz score and result (A6).
CREATE OR REPLACE FUNCTION public.learner_final_assessment(p_enrollment_id uuid)
 RETURNS TABLE(requirement_id uuid, due_on date, instructions text, instructions_vi text, transcript_mode text,
               max_file_mb integer, quiz_enabled boolean, quiz_question_count integer, attempt_no integer,
               state text, quiz_taken boolean, quiz_submission_id uuid, submission_id uuid, submitted_at timestamptz,
               released_at timestamptz, quiz_correct integer, quiz_total integer, quiz_score_pct numeric,
               pass_mark_pct numeric, quiz_passed boolean, final_result text, can_resubmit boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT r.requirement_id, r.due_on, c.config->>'instructions', c.config->>'instructions_vi',
    coalesce(c.config->>'transcript', 'optional'), coalesce((c.config->>'max_file_mb')::integer, 50),
    r.quiz_enabled AND r.quiz_assignment_id IS NOT NULL,
    (SELECT count(*)::integer FROM public.quiz_questions q WHERE q.assignment_id = r.quiz_assignment_id),
    r.attempt_no, r.state,
    r.quiz_submission_id IS NOT NULL, r.quiz_submission_id,
    r.submission_id, r.submitted_at,
    CASE WHEN r.state IN ('completed', 'resubmit_requested') THEN r.released_at END,
    -- The quiz result is shown only after release (A6).
    CASE WHEN r.state = 'completed' THEN r.quiz_correct END,
    CASE WHEN r.state = 'completed' THEN r.quiz_total END,
    CASE WHEN r.state = 'completed' THEN r.quiz_score_pct END,
    CASE WHEN r.state = 'completed' THEN r.pass_mark_pct END,
    CASE WHEN r.state = 'completed' THEN r.quiz_passed END,
    r.final_result, r.can_resubmit
  FROM public.programme_enrollments e
  CROSS JOIN LATERAL public.canonical_final_assessment_result(e.id) r
  CROSS JOIN LATERAL (SELECT public.final_assessment_config_internal(e.id) AS config) c
  WHERE e.id = p_enrollment_id AND e.user_id = auth.uid() AND auth.uid() IS NOT NULL;
$function$;

-- The questions, never the answer key (the score stays hidden until release).
CREATE OR REPLACE FUNCTION public.learner_final_assessment_quiz(p_enrollment_id uuid)
 RETURNS TABLE(question_id uuid, question_text text, question_text_vi text, options jsonb, sort_order integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT q.id, q.question_text, q.question_text_vi,
    (SELECT jsonb_agg(opt - 'is_correct' ORDER BY ord) FROM jsonb_array_elements(q.options) WITH ORDINALITY t(opt, ord)),
    q.sort_order
  FROM public.programme_enrollments e
  CROSS JOIN LATERAL public.canonical_final_assessment_result(e.id) r
  JOIN public.quiz_questions q ON q.assignment_id = r.quiz_assignment_id
  WHERE e.id = p_enrollment_id AND e.user_id = auth.uid() AND auth.uid() IS NOT NULL AND r.quiz_enabled
  ORDER BY q.sort_order, q.id;
$function$;

CREATE OR REPLACE FUNCTION public.learner_submit_final_assessment_quiz(p_enrollment_id uuid, p_answers jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_enr public.programme_enrollments;
  v_res record;
  v_id uuid;
BEGIN
  SELECT * INTO v_enr FROM public.programme_enrollments WHERE id = p_enrollment_id;
  IF NOT FOUND OR auth.uid() IS NULL OR v_enr.user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'You can answer only for your own enrollment' USING ERRCODE = '42501';
  END IF;
  IF NOT public.enrollment_is_ongoing(p_enrollment_id) THEN
    RAISE EXCEPTION 'This enrollment is not ongoing' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_res FROM public.canonical_final_assessment_result(p_enrollment_id) LIMIT 1;
  IF NOT FOUND OR NOT v_res.quiz_enabled OR v_res.quiz_assignment_id IS NULL THEN
    RAISE EXCEPTION 'This Final Assessment has no quiz' USING ERRCODE = '22023';
  END IF;
  IF v_res.state NOT IN ('not_submitted', 'resubmit_requested') THEN
    RAISE EXCEPTION 'This attempt has already been submitted' USING ERRCODE = '23505';
  END IF;
  IF v_res.quiz_submission_id IS NOT NULL THEN
    RAISE EXCEPTION 'You have already taken the quiz for this attempt' USING ERRCODE = '23505';
  END IF;
  IF jsonb_typeof(p_answers) <> 'object' OR EXISTS (
    SELECT 1 FROM public.quiz_questions q
    WHERE q.assignment_id = v_res.quiz_assignment_id AND NOT (p_answers ? q.id::text)) THEN
    RAISE EXCEPTION 'Answer every question' USING ERRCODE = '22023';
  END IF;
  -- Scored by trg_score_quiz_submission; timestamped by the server.
  INSERT INTO public.assignment_submissions (assignment_id, user_id, enrollment_id, answers, attempt_no)
  VALUES (v_res.quiz_assignment_id, auth.uid(), p_enrollment_id, p_answers, v_res.attempt_no)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 7. Admin and Sponsor read the same construction
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_final_assessment_result(p_enrollment_id uuid)
 RETURNS TABLE(requirement_id uuid, due_on date, attempt_no integer, submission_id uuid, submission_status text,
               state text, submitted_at timestamptz, released_at timestamptz, quiz_correct integer, quiz_total integer,
               quiz_score_pct numeric, pass_mark_pct numeric, quiz_passed boolean, outcome text, final_result text,
               can_resubmit boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Only an Admin reads this' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT r.requirement_id, r.due_on, r.attempt_no, r.submission_id, r.submission_status, r.state, r.submitted_at,
    r.released_at, r.quiz_correct, r.quiz_total, r.quiz_score_pct, r.pass_mark_pct, r.quiz_passed, r.outcome,
    r.final_result, r.can_resubmit
  FROM public.canonical_final_assessment_result(p_enrollment_id) r;
END;
$function$;

-- Status and Pass / Not pass only; Resubmit shows as Under review (rule 11).
CREATE OR REPLACE FUNCTION public.sponsor_final_assessment_status(p_enrollment_id uuid)
 RETURNS TABLE(status text, result text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  -- A visible leader always gets a row: 'not_submitted' when nothing (or no
  -- Final Assessment) is there yet, as before this migration.
  SELECT
    CASE coalesce(r.state, 'not_submitted')
      WHEN 'not_submitted' THEN 'not_submitted'
      WHEN 'completed' THEN CASE WHEN r.final_result IS NOT NULL THEN 'completed' ELSE 'under_review' END
      ELSE 'under_review'
    END,
    r.final_result
  FROM public.sponsor_visible_enrollments() v
  LEFT JOIN LATERAL public.canonical_final_assessment_result(v.enrollment_id) r ON true
  WHERE v.enrollment_id = p_enrollment_id
  LIMIT 1;
$function$;

DO $grant$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'learner_submit_assessment(uuid, uuid, uuid, text, uuid, uuid, text, text, jsonb)',
    'learner_final_assessment(uuid)', 'learner_final_assessment_quiz(uuid)',
    'learner_submit_final_assessment_quiz(uuid, jsonb)', 'admin_final_assessment_result(uuid)',
    'sponsor_final_assessment_status(uuid)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated, service_role', f);
  END LOOP;
END
$grant$;
