-- ===========================================================================
-- Triad submissions (Prompt A2; Assessment review spec, decisions 1, 2, 13)
--
--   1. programme_modules (triads) config.assessed_units: the Triad numbers
--      Admin marks as assessed in the Programme Builder.
--   2. Submitting the existing Triad reflection for an assessed Triad creates
--      the assessment_submission for that enrollment and requirement, linked
--      by triad_reflection_id -- no recording, no copy of the answers -- in
--      the same transaction (learner_triad_submit_reflection).
--   3. learner_triad_session_assessed(): whether the reflection form shows
--      the privacy notice that an assessor will read it.
-- A Triad review is evidence, not completion: canonical_triad_completion and
-- the Triad requirement fulfilment read none of this.
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.triad_requirement_is_assessed(p_cohort_requirement_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT coalesce((
    SELECT jsonb_typeof(pm.config->'assessed_units') = 'array'
       AND (pm.config->'assessed_units') @> to_jsonb(d.ordinal)
    FROM public.cohort_requirement_dates d
    JOIN public.programme_modules pm ON pm.programme_id = d.programme_id
     AND pm.module = 'triads'::public.programme_module_type AND pm.enabled
    WHERE d.id = p_cohort_requirement_id AND d.module = 'triads'::public.programme_module_type), false);
$function$;
-- Internal: read by the definer functions below, never by the app (the
-- Triad contract keeps triad_* helpers off the client).
REVOKE ALL ON FUNCTION public.triad_requirement_is_assessed(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.triad_requirement_is_assessed(uuid) TO service_role;

-- The submission of an assessed Triad, created from the learner's own
-- reflection (rule 2: own enrollment, a requirement of their cohort, once).
CREATE OR REPLACE FUNCTION public.assessment_create_triad_submission_internal(
  p_enrollment_id uuid, p_session_id uuid, p_reflection_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_requirement uuid; v_id uuid;
BEGIN
  SELECT g.cohort_requirement_date_id INTO v_requirement
  FROM public.triad_sessions s JOIN public.triad_groups g ON g.id = s.triad_group_id
  JOIN public.cohort_requirement_dates d ON d.id = g.cohort_requirement_date_id
  JOIN public.programme_enrollments e ON e.id = p_enrollment_id
   AND e.cohort_id = d.cohort_id AND e.programme_id = d.programme_id
  WHERE s.id = p_session_id;
  IF v_requirement IS NULL OR NOT public.triad_requirement_is_assessed(v_requirement) THEN
    RETURN NULL;
  END IF;
  INSERT INTO public.assessment_submissions (id, enrollment_id, kind, cohort_requirement_id, triad_reflection_id,
    attempt_no, status, submitted_at)
  VALUES (gen_random_uuid(), p_enrollment_id, 'triad', v_requirement, p_reflection_id, 1, 'awaiting_assignment', now())
  ON CONFLICT (enrollment_id, cohort_requirement_id, attempt_no) DO NOTHING
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.assessment_create_triad_submission_internal(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assessment_create_triad_submission_internal(uuid, uuid, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.learner_triad_submit_reflection(p_session_id uuid, p_satisfaction_rating smallint DEFAULT NULL::smallint, p_answers jsonb DEFAULT '[]'::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE me uuid := public.triad_caller_member_enrollment(p_session_id); reflection uuid;
BEGIN
  IF p_satisfaction_rating IS NOT NULL AND p_satisfaction_rating NOT BETWEEN 1 AND 5 THEN
    RAISE EXCEPTION 'Satisfaction must be between 1 and 5' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(coalesce(p_answers, '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'Answers must be a JSON array' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(coalesce(p_answers, '[]'::jsonb)) a
    WHERE (a->>'question_id') IS NULL
       OR (a->>'question_id') NOT IN (SELECT q.id::text FROM public.triad_reflection_questions_for_session(p_session_id) q)
  ) THEN
    RAISE EXCEPTION 'Every answer must reference a question of this Triad reflection' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.triad_reflections WHERE triad_session_id = p_session_id AND enrollment_id = me) THEN
    RAISE EXCEPTION 'You have already reflected on this Triad session' USING ERRCODE = '23505';
  END IF;
  INSERT INTO public.triad_reflections (triad_session_id, enrollment_id, satisfaction_rating)
  VALUES (p_session_id, me, p_satisfaction_rating)
  RETURNING id INTO reflection;
  INSERT INTO public.triad_reflection_answers (triad_reflection_id, question_id, answer_text)
  SELECT reflection, (a->>'question_id')::uuid, a->>'answer_text'
  FROM jsonb_array_elements(coalesce(p_answers, '[]'::jsonb)) a
  WHERE nullif(btrim(a->>'answer_text'), '') IS NOT NULL;
  -- An assessed Triad (Programme Builder: assessed_units): the reflection IS
  -- the submission (decision 1). Linked by id, nothing copied; evidence only,
  -- Triad completion is untouched (20261006220000).
  PERFORM public.assessment_create_triad_submission_internal(me, p_session_id, reflection);
  RETURN reflection;
END $function$;

CREATE OR REPLACE FUNCTION public.learner_triad_session_assessed(p_session_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT public.triad_caller_member_enrollment(p_session_id) IS NOT NULL
     AND public.triad_requirement_is_assessed((
       SELECT g.cohort_requirement_date_id FROM public.triad_sessions s
       JOIN public.triad_groups g ON g.id = s.triad_group_id WHERE s.id = p_session_id));
$function$;
REVOKE ALL ON FUNCTION public.learner_triad_session_assessed(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.learner_triad_session_assessed(uuid) TO authenticated, service_role;
