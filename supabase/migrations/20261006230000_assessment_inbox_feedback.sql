-- ===========================================================================
-- Assessment inbox and feedback release (Prompt A4)
--
-- 1. coach_assessment_inbox also returns the submission's enrollment (the
--    feedback PDF is uploaded under {enrollment}/{submission}/, which the
--    storage policy checks) and, for an active assignment only, the learner's
--    Triad reflection answers. The assessor reads them here, never from
--    triad_reflections, which stays under the Triad unlock rules.
-- 2. The release notification links to the learner's own journey page: a
--    Coach-learner's is /coach/my-journey (the app resolves coach before
--    coachee), everyone else's /coachee/journey; both at #feedback-results.
-- 3. The release email (Resend, send-assessment-feedback-email) is sent at
--    most once per release: the edge function claims it through
--    assessment_claim_release_email_internal, which stamps
--    release_emailed_at from the server clock (rule 8).
-- ===========================================================================

ALTER TABLE public.assessment_submissions ADD COLUMN IF NOT EXISTS release_emailed_at timestamptz;

-- ---------------------------------------------------------------------------
-- 1. coach_assessment_inbox (rule 4) -- the return type changes, so drop first
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.coach_assessment_inbox();
CREATE FUNCTION public.coach_assessment_inbox()
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

-- ---------------------------------------------------------------------------
-- 2. admin_validate_review (rule 6): unchanged except the notification link
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.assessment_feedback_link_internal(p_user_id uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT CASE WHEN public.has_role(p_user_id, 'coach'::public.app_role)
              THEN '/coach/my-journey#feedback-results'
              ELSE '/coachee/journey#feedback-results' END;
$function$;
REVOKE ALL ON FUNCTION public.assessment_feedback_link_internal(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assessment_feedback_link_internal(uuid) TO service_role;

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
    public.assessment_feedback_link_internal(v_user));
  RETURN 'approved';
END;
$function$;
REVOKE ALL ON FUNCTION public.admin_validate_review(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_validate_review(uuid, text, text) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. The release email, at most once per release (service role only)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.assessment_claim_release_email_internal(p_submission_id uuid)
 RETURNS TABLE(email text, full_name text, preferred_language text, kind text, requirement_ordinal integer, link text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_sub public.assessment_submissions;
BEGIN
  UPDATE public.assessment_submissions s SET release_emailed_at = now()
   WHERE s.id = p_submission_id AND s.status = 'released' AND s.release_emailed_at IS NULL
  RETURNING s.* INTO v_sub;
  IF NOT FOUND THEN RETURN; END IF;  -- not released, or already emailed
  RETURN QUERY
  SELECT p.email, p.full_name, p.preferred_language, v_sub.kind, d.ordinal,
         public.assessment_feedback_link_internal(e.user_id)
  FROM public.programme_enrollments e
  JOIN public.profiles p ON p.id = e.user_id
  JOIN public.cohort_requirement_dates d ON d.id = v_sub.cohort_requirement_id
  WHERE e.id = v_sub.enrollment_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.assessment_claim_release_email_internal(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assessment_claim_release_email_internal(uuid) TO service_role;
