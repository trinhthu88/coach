-- ===========================================================================
-- Final Assessment: automatic transcription, cap, cost log and saved draft
-- (Prompt A7 follow-up)
--
-- transcribe-assessment-recording (edge function, OpenAI Whisper) now goes
-- through the database for every call:
--   1. learner_claim_final_assessment_transcription (as the learner): the
--      attempt is open and takes a transcript, the learner consented to the
--      external service, and fewer than 3 automatic transcriptions were used
--      on this attempt. Writes a 'pending' log row.
--   2. final_assessment_transcription_finish_internal (service role): records
--      the outcome, the audio minutes Whisper reports, and the draft text.
-- The cap is per attempt (attempt 2 after a Resubmit starts again at 3).
-- A failed call gives its use back; a 'pending' call holds one for 15
-- minutes (longer than any edge function can run).
--
-- The draft lives on the log row (the submission row does not exist until
-- submit): learner_final_assessment_transcription returns the latest draft of
-- the open attempt so a reload does not lose it. On submit the page stores it
-- in assessment_submissions.transcript_text with transcript_source = 'auto'.
--
-- admin_final_assessment_transcriptions lists the calls (attempt, learner,
-- audio minutes, time) so Admin can see the cost.
-- ===========================================================================

CREATE TABLE public.final_assessment_transcriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  enrollment_id uuid NOT NULL REFERENCES public.programme_enrollments(id) ON DELETE RESTRICT,
  attempt_no integer NOT NULL CHECK (attempt_no BETWEEN 1 AND 2),
  learner_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  storage_path text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'succeeded', 'failed')),
  audio_seconds numeric CHECK (audio_seconds IS NULL OR audio_seconds >= 0),
  draft_text text,
  consented_at timestamptz NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
CREATE INDEX final_assessment_transcriptions_attempt_idx
  ON public.final_assessment_transcriptions (enrollment_id, attempt_no, started_at DESC);
CREATE INDEX final_assessment_transcriptions_started_idx
  ON public.final_assessment_transcriptions (started_at DESC);
-- Read and written only through the functions below.
ALTER TABLE public.final_assessment_transcriptions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.final_assessment_transcriptions FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.final_assessment_transcriptions TO service_role;

CREATE OR REPLACE FUNCTION public.final_assessment_transcription_cap()
 RETURNS integer LANGUAGE sql IMMUTABLE AS $$ SELECT 3 $$;

-- Uses that count against the cap: succeeded, or still running.
CREATE OR REPLACE FUNCTION public.final_assessment_transcriptions_used_internal(p_enrollment_id uuid, p_attempt_no integer)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT count(*)::integer FROM public.final_assessment_transcriptions t
  WHERE t.enrollment_id = p_enrollment_id AND t.attempt_no = p_attempt_no
    AND (t.status = 'succeeded' OR (t.status = 'pending' AND t.started_at > now() - interval '15 minutes'));
$function$;

-- ---------------------------------------------------------------------------
-- 1. Claim (as the learner, called by the edge function with their JWT)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.learner_claim_final_assessment_transcription(
  p_enrollment_id uuid, p_storage_path text, p_consent boolean)
 RETURNS TABLE(transcription_id uuid, attempt_no integer, remaining integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_res record;
  v_mode text;
  v_used integer;
  v_id uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.programme_enrollments e WHERE e.id = p_enrollment_id AND e.user_id = auth.uid()) THEN
    RAISE EXCEPTION 'not_open' USING ERRCODE = '42501';
  END IF;
  IF p_consent IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'consent_required' USING ERRCODE = '22023';
  END IF;
  -- The learner's own upload for this enrollment: {enrollment}/{submission}/recording.mp3
  IF p_storage_path IS NULL OR p_storage_path !~ ('^' || p_enrollment_id::text || '/[0-9a-f-]{36}/[^/]+\.mp3$') THEN
    RAISE EXCEPTION 'invalid_request' USING ERRCODE = '22023';
  END IF;

  SELECT r.state, r.attempt_no INTO v_res FROM public.canonical_final_assessment_result(p_enrollment_id) r;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_open' USING ERRCODE = '22023';
  END IF;
  v_mode := coalesce(public.final_assessment_config_internal(p_enrollment_id)->>'transcript', 'optional');
  IF v_res.state NOT IN ('not_submitted', 'resubmit_requested') OR v_mode = 'none'
     OR NOT public.enrollment_is_ongoing(p_enrollment_id) THEN
    RAISE EXCEPTION 'not_open' USING ERRCODE = '22023';
  END IF;

  -- One claim at a time per attempt, so two clicks cannot both take the last use.
  PERFORM pg_advisory_xact_lock(hashtextextended('fa-transcription:' || p_enrollment_id::text || ':' || v_res.attempt_no, 0));
  v_used := public.final_assessment_transcriptions_used_internal(p_enrollment_id, v_res.attempt_no);
  IF v_used >= public.final_assessment_transcription_cap() THEN
    RAISE EXCEPTION 'limit_reached' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.final_assessment_transcriptions (enrollment_id, attempt_no, learner_id, storage_path, consented_at)
  VALUES (p_enrollment_id, v_res.attempt_no, auth.uid(), p_storage_path, now())
  RETURNING id INTO v_id;

  RETURN QUERY SELECT v_id, v_res.attempt_no, public.final_assessment_transcription_cap() - v_used - 1;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 2. Finish (service role only: the audio minutes are the cost record)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.final_assessment_transcription_finish_internal(
  p_transcription_id uuid, p_succeeded boolean, p_draft_text text DEFAULT NULL, p_audio_seconds numeric DEFAULT NULL)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  UPDATE public.final_assessment_transcriptions
  SET status = CASE WHEN p_succeeded THEN 'succeeded' ELSE 'failed' END,
      draft_text = CASE WHEN p_succeeded THEN nullif(btrim(p_draft_text), '') END,
      audio_seconds = p_audio_seconds,
      finished_at = now()
  WHERE id = p_transcription_id AND status = 'pending';
$function$;

-- ---------------------------------------------------------------------------
-- 3. The learner page: drafts left and the saved draft of the open attempt
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.learner_final_assessment_transcription(p_enrollment_id uuid)
 RETURNS TABLE(attempt_no integer, cap integer, remaining integer, draft_text text, draft_storage_path text,
               draft_at timestamptz)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT r.attempt_no, public.final_assessment_transcription_cap(),
    greatest(public.final_assessment_transcription_cap()
             - public.final_assessment_transcriptions_used_internal(e.id, r.attempt_no), 0),
    d.draft_text, d.storage_path, d.finished_at
  FROM public.programme_enrollments e
  CROSS JOIN LATERAL public.canonical_final_assessment_result(e.id) r
  LEFT JOIN LATERAL (
    SELECT t.draft_text, t.storage_path, t.finished_at FROM public.final_assessment_transcriptions t
    WHERE t.enrollment_id = e.id AND t.attempt_no = r.attempt_no AND t.status = 'succeeded' AND t.draft_text IS NOT NULL
    ORDER BY t.finished_at DESC LIMIT 1
  ) d ON true
  WHERE e.id = p_enrollment_id AND e.user_id = auth.uid() AND auth.uid() IS NOT NULL
    AND r.state IN ('not_submitted', 'resubmit_requested');
$function$;

-- ---------------------------------------------------------------------------
-- 4. Admin: every call, for the cost (p_enrollment_id NULL = all learners)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_final_assessment_transcriptions(
  p_enrollment_id uuid DEFAULT NULL, p_since timestamptz DEFAULT NULL)
 RETURNS TABLE(transcription_id uuid, enrollment_id uuid, attempt_no integer, learner_id uuid, learner_name text,
               status text, audio_minutes numeric, started_at timestamptz, finished_at timestamptz)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Only an Admin reads this' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT t.id, t.enrollment_id, t.attempt_no, t.learner_id, p.full_name, t.status,
    round(t.audio_seconds / 60.0, 2), t.started_at, t.finished_at
  FROM public.final_assessment_transcriptions t
  LEFT JOIN public.profiles p ON p.id = t.learner_id
  WHERE (p_enrollment_id IS NULL OR t.enrollment_id = p_enrollment_id)
    AND (p_since IS NULL OR t.started_at >= p_since)
  ORDER BY t.started_at DESC;
END;
$function$;

REVOKE ALL ON FUNCTION public.final_assessment_transcription_cap() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.final_assessment_transcription_cap() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.final_assessment_transcriptions_used_internal(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.final_assessment_transcriptions_used_internal(uuid, integer) TO service_role;
REVOKE ALL ON FUNCTION public.final_assessment_transcription_finish_internal(uuid, boolean, text, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.final_assessment_transcription_finish_internal(uuid, boolean, text, numeric) TO service_role;
DO $grant$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'learner_claim_final_assessment_transcription(uuid, text, boolean)',
    'learner_final_assessment_transcription(uuid)',
    'admin_final_assessment_transcriptions(uuid, timestamptz)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated, service_role', f);
  END LOOP;
END
$grant$;
