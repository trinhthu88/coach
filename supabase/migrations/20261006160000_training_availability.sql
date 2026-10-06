-- ===========================================================================
-- Training availability and enrollment dates (L-10, L-11, D-10, D-11, D-9, L-7, L-9)
--
--   1. One predicate for "this enrollment is in its programme now":
--      enrollment_is_ongoing() = stored status active and today (programme
--      time zone) within the enrollment's dates (else its cohort's).
--   2. One owner of "when does a Training week open for this enrollment":
--      canonical_training_week_available_on() (cohort override, else the
--      cohort's week pacing, else the week's own date, else its due date --
--      never after the cohort end). canonical_training_week_fulfilment and
--      get_enrollment_training_weeks read it.
--   3. Content RLS (training_weeks, assignments, daily_prompts,
--      programme_reflections), get_quiz_questions and the evidence writes
--      (training_progress, assignment_submissions, daily_prompt_responses) all
--      ask learner_training_week_open() / training_week_open_for_enrollment_internal():
--      an ongoing enrollment of the caller for which the week has opened. The
--      policies compared tw.unlock_date with the server's CURRENT_DATE, ignored
--      cohort pacing and overrides, and any evidence row could be written for
--      any week at any time.
--   4. at_risk is an EFFECTIVE status (canonical_enrollment_progress: the
--      programme ended incomplete), never a stored one: stored at_risk rows
--      become active and a CHECK refuses new ones.
--   5. A cohort's end date change carries to its enrollments that still end on
--      the cohort's old date; an enrollment with its own end date (an Admin
--      override) keeps it.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Ongoing
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enrollment_is_ongoing(p_enrollment_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT coalesce((
    SELECT e.status = 'active'::public.enrollment_status
       AND public.programme_today() >= coalesce(e.start_date, c.start_date, '-infinity'::date)
       AND public.programme_today() <= coalesce(e.end_date, c.end_date, 'infinity'::date)
    FROM public.programme_enrollments e
    LEFT JOIN public.cohorts c ON c.id = e.cohort_id
    WHERE e.id = p_enrollment_id), false);
$function$;
REVOKE ALL ON FUNCTION public.enrollment_is_ongoing(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.enrollment_is_ongoing(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. When a week opens
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.canonical_training_week_available_on(p_enrollment_id uuid, p_training_week_id uuid)
 RETURNS date
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  -- Opens at its pacing date; with no pacing date at all, at its due date;
  -- never after the cohort end.
  SELECT least(
    c.end_date,
    coalesce(
      cwo.unlock_date,
      (c.start_date + ((tw.week_number - 1) * interval '7 days'))::date,
      tw.unlock_date,
      d.due_on
    ))
  FROM public.programme_enrollments e
  JOIN public.cohorts c ON c.id = e.cohort_id
  JOIN public.training_weeks tw ON tw.id = p_training_week_id AND tw.programme_id = e.programme_id
  LEFT JOIN public.cohort_week_overrides cwo ON cwo.cohort_id = e.cohort_id AND cwo.training_week_id = tw.id
  LEFT JOIN public.cohort_requirement_dates d
    ON d.cohort_id = e.cohort_id AND d.programme_id = e.programme_id
   AND d.module = 'training'::public.programme_module_type AND d.training_week_id = tw.id
  WHERE e.id = p_enrollment_id;
$function$;
REVOKE ALL ON FUNCTION public.canonical_training_week_available_on(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.canonical_training_week_available_on(uuid, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.canonical_training_week_fulfilment(p_enrollment_id uuid, p_as_of date DEFAULT programme_today())
 RETURNS TABLE(training_week_id uuid, week_number integer, due_on date, available_on date, unlock_on date, skill_card_required boolean, skill_card_completed boolean, skill_card_completed_at timestamp with time zone, quiz_required boolean, quiz_completed boolean, quiz_completed_at timestamp with time zone, reflection_required boolean, reflection_completed boolean, reflection_completed_at timestamp with time zone, daily_prompts_required integer, daily_prompts_completed integer, week_complete boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH eff AS (
    SELECT coalesce(public.canonical_enrollment_effective_as_of(p_enrollment_id, p_as_of), p_as_of) AS as_of
  ), enrollment AS (
    SELECT e.id, e.programme_id, e.cohort_id, c.start_date, c.end_date
    FROM public.programme_enrollments e
    JOIN public.cohorts c ON c.id = e.cohort_id
    WHERE e.id = p_enrollment_id
  ), configured AS (
    SELECT e.*,
      pm.config,
      CASE
        WHEN jsonb_typeof(pm.config->'learning_components') = 'array'
          THEN pm.config->'learning_components'
        ELSE jsonb_build_array('skill_cards', 'reflections')
          || CASE WHEN EXISTS (
            SELECT 1 FROM public.programme_modules q
            WHERE q.programme_id = e.programme_id
              AND q.module = 'quiz'::public.programme_module_type
              AND q.enabled
              AND coalesce((q.config->>'required')::boolean, false)
          ) THEN jsonb_build_array('quizzes') ELSE '[]'::jsonb END
          || CASE WHEN EXISTS (
            SELECT 1 FROM public.programme_modules d
            WHERE d.programme_id = e.programme_id
              AND d.module = 'daily_prompt'::public.programme_module_type
              AND d.enabled
              AND coalesce((d.config->>'required')::boolean, false)
          ) THEN jsonb_build_array('daily_prompts') ELSE '[]'::jsonb END
      END AS components
    FROM enrollment e
    JOIN public.programme_modules pm
      ON pm.programme_id = e.programme_id
     AND pm.module = 'training'::public.programme_module_type
     AND pm.enabled
     AND coalesce((pm.config->>'required')::boolean, false)
  ), selected AS (
    SELECT DISTINCT
      c.id AS enrollment_id,
      c.programme_id,
      c.cohort_id,
      tw.id AS training_week_id,
      tw.week_number,
      tw.is_visible,
      tw.skill_card_visible,
      coalesce(cwo.is_visible, true) AS override_visible,
      -- 20261001110000: the week's stored requirement date, never a computed
      -- stand-in. A week without a stored row is not a requirement (below).
      d.due_on AS due_on,
      -- Opens at its pacing date; with no pacing date at all, at its due date
      -- (previously the cohort END date, i.e. after it was due).
      -- One owner of "when does this week open" (20261006160000).
      public.canonical_training_week_available_on(c.id, tw.id) AS available_on,
      coalesce(cwo.unlock_date,
        (c.start_date + ((tw.week_number - 1) * interval '7 days'))::date,
        tw.unlock_date) AS unlock_on,
      c.components
    FROM configured c
    JOIN public.training_weeks tw ON tw.programme_id = c.programme_id
    LEFT JOIN LATERAL jsonb_array_elements_text(
      CASE
        WHEN jsonb_typeof(c.config->'distribution_settings'->'training_week_ids') = 'array'
          THEN c.config->'distribution_settings'->'training_week_ids'
        ELSE '[]'::jsonb
      END
    ) selected_week(week_id) ON true
    LEFT JOIN public.cohort_week_overrides cwo
      ON cwo.cohort_id = c.cohort_id
     AND cwo.training_week_id = tw.id
    JOIN public.cohort_requirement_dates d
      ON d.cohort_id = c.cohort_id
     AND d.programme_id = c.programme_id
     AND d.module = 'training'::public.programme_module_type
     AND d.training_week_id = tw.id
    WHERE jsonb_typeof(c.config->'distribution_settings'->'training_week_ids') IS DISTINCT FROM 'array'
       OR tw.id::text = selected_week.week_id
  ), quiz AS (
    SELECT
      s.training_week_id,
      count(a.id)::integer AS total,
      count(a.id) FILTER (
        WHERE sub.submitted_at IS NOT NULL
          AND (sub.submitted_at AT TIME ZONE public.programme_time_zone())::date <= (SELECT eff.as_of FROM eff)
          AND (sub.submitted_at AT TIME ZONE public.programme_time_zone())::date >= s.available_on
      )::integer AS completed,
      max(sub.submitted_at) FILTER (
        WHERE sub.submitted_at IS NOT NULL
          AND (sub.submitted_at AT TIME ZONE public.programme_time_zone())::date <= (SELECT eff.as_of FROM eff)
          AND (sub.submitted_at AT TIME ZONE public.programme_time_zone())::date >= s.available_on
      ) AS completed_at
    FROM selected s
    LEFT JOIN public.assignments a
      ON a.training_week_id = s.training_week_id
     AND a.assignment_type = 'quiz'::public.assignment_type
     AND a.is_visible
    LEFT JOIN public.assignment_submissions sub
      ON sub.assignment_id = a.id
     AND sub.enrollment_id = p_enrollment_id
    GROUP BY s.training_week_id
  ), reflection AS (
    SELECT
      s.training_week_id,
      count(pr.id)::integer AS total,
      count(pr.id) FILTER (
        WHERE rs.submitted_at IS NOT NULL
          AND (rs.submitted_at AT TIME ZONE public.programme_time_zone())::date <= (SELECT eff.as_of FROM eff)
          AND (rs.submitted_at AT TIME ZONE public.programme_time_zone())::date >= s.available_on
      )::integer AS completed,
      max(rs.submitted_at) FILTER (
        WHERE rs.submitted_at IS NOT NULL
          AND (rs.submitted_at AT TIME ZONE public.programme_time_zone())::date <= (SELECT eff.as_of FROM eff)
          AND (rs.submitted_at AT TIME ZONE public.programme_time_zone())::date >= s.available_on
      ) AS completed_at
    FROM selected s
    LEFT JOIN public.programme_reflections pr
      ON pr.programme_id = s.programme_id
     AND pr.appears_at_week = s.week_number
     AND pr.is_visible
    LEFT JOIN public.reflection_submissions rs
      ON rs.reflection_id = pr.id
     AND rs.enrollment_id = p_enrollment_id
    GROUP BY s.training_week_id
  ), prompts AS (
    SELECT
      s.training_week_id,
      count(dp.id)::integer AS total,
      count(dp.id) FILTER (
        WHERE dpr.responded_at IS NOT NULL
          AND (dpr.responded_at AT TIME ZONE public.programme_time_zone())::date <= (SELECT eff.as_of FROM eff)
          AND (dpr.responded_at AT TIME ZONE public.programme_time_zone())::date >= s.available_on
      )::integer AS completed
    FROM selected s
    LEFT JOIN public.daily_prompts dp
      ON dp.training_week_id = s.training_week_id
     AND dp.is_visible
    LEFT JOIN public.daily_prompt_responses dpr
      ON dpr.daily_prompt_id = dp.id
     AND dpr.enrollment_id = p_enrollment_id
    GROUP BY s.training_week_id
  ), values AS (
    SELECT
      s.training_week_id,
      s.week_number,
      s.due_on,
      s.available_on,
      s.unlock_on,
      (s.is_visible AND s.skill_card_visible AND s.override_visible) AS skill_card_required,
      tp.completed_at IS NOT NULL
        AND (tp.completed_at AT TIME ZONE public.programme_time_zone())::date <= (SELECT eff.as_of FROM eff)
        AND (tp.completed_at AT TIME ZONE public.programme_time_zone())::date >= s.available_on
        AND s.available_on IS NOT NULL
        AND s.available_on <= (SELECT eff.as_of FROM eff) AS skill_card_completed,
      CASE WHEN (tp.completed_at AT TIME ZONE public.programme_time_zone())::date BETWEEN s.available_on AND (SELECT eff.as_of FROM eff)
        THEN tp.completed_at END AS skill_card_completed_at,
      (s.components ? 'quizzes') AND coalesce(q.total, 0) > 0 AS quiz_required,
      (s.components ? 'quizzes')
        AND coalesce(q.total, 0) > 0
        AND coalesce(q.completed, 0) >= q.total
        AND s.available_on IS NOT NULL
        AND s.available_on <= (SELECT eff.as_of FROM eff) AS quiz_completed,
      q.completed_at AS quiz_completed_at,
      (s.components ? 'reflections') AND coalesce(r.total, 0) > 0 AS reflection_required,
      (s.components ? 'reflections')
        AND coalesce(r.total, 0) > 0
        AND coalesce(r.completed, 0) >= r.total
        AND s.available_on IS NOT NULL
        AND s.available_on <= (SELECT eff.as_of FROM eff) AS reflection_completed,
      r.completed_at AS reflection_completed_at,
      CASE WHEN s.components ? 'daily_prompts' THEN coalesce(p.total, 0) ELSE 0 END AS daily_prompts_required,
      CASE WHEN s.components ? 'daily_prompts' THEN coalesce(p.completed, 0) ELSE 0 END AS daily_prompts_completed
    FROM selected s
    LEFT JOIN public.training_progress tp
      ON tp.enrollment_id = p_enrollment_id
     AND tp.training_week_id = s.training_week_id
    LEFT JOIN quiz q ON q.training_week_id = s.training_week_id
    LEFT JOIN reflection r ON r.training_week_id = s.training_week_id
    LEFT JOIN prompts p ON p.training_week_id = s.training_week_id
    WHERE s.is_visible AND s.skill_card_visible AND s.override_visible
  )
  SELECT v.training_week_id,
    v.week_number,
    v.due_on,
    v.available_on,
    v.unlock_on,
    v.skill_card_required,
    v.skill_card_completed,
    v.skill_card_completed_at,
    v.quiz_required,
    v.quiz_completed,
    v.quiz_completed_at,
    v.reflection_required,
    v.reflection_completed,
    v.reflection_completed_at,
    v.daily_prompts_required,
    v.daily_prompts_completed,
    (
      v.skill_card_required AND v.skill_card_completed
      AND (NOT v.quiz_required OR v.quiz_completed)
      AND (NOT v.reflection_required OR v.reflection_completed)
    ) AS week_complete
  FROM values v
  ORDER BY v.week_number, v.training_week_id;
$function$;

-- ---------------------------------------------------------------------------
-- 3. Open to whom
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.training_week_open_for_enrollment_internal(p_enrollment_id uuid, p_training_week_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT coalesce((
    SELECT tw.is_visible
       AND coalesce(cwo.is_visible, true)
       AND public.enrollment_is_ongoing(e.id)
       AND public.canonical_training_week_available_on(e.id, tw.id) <= public.programme_today()
    FROM public.programme_enrollments e
    JOIN public.training_weeks tw ON tw.id = p_training_week_id AND tw.programme_id = e.programme_id
    LEFT JOIN public.cohort_week_overrides cwo ON cwo.cohort_id = e.cohort_id AND cwo.training_week_id = tw.id
    WHERE e.id = p_enrollment_id), false);
$function$;
REVOKE ALL ON FUNCTION public.training_week_open_for_enrollment_internal(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.training_week_open_for_enrollment_internal(uuid, uuid) TO service_role;

-- The caller has an ongoing enrollment for which the week has opened.
CREATE OR REPLACE FUNCTION public.learner_training_week_open(p_training_week_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.programme_enrollments e
    JOIN public.training_weeks tw ON tw.id = p_training_week_id AND tw.programme_id = e.programme_id
    WHERE e.user_id = auth.uid()
      AND public.training_week_open_for_enrollment_internal(e.id, tw.id));
$function$;
REVOKE ALL ON FUNCTION public.learner_training_week_open(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.learner_training_week_open(uuid) TO authenticated, service_role;

-- Evidence: the caller's own enrollment, and the week is open to it.
CREATE OR REPLACE FUNCTION public.learner_training_evidence_allowed(
  p_enrollment_id uuid, p_training_week_id uuid DEFAULT NULL, p_assignment_id uuid DEFAULT NULL,
  p_daily_prompt_id uuid DEFAULT NULL)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT EXISTS (SELECT 1 FROM public.programme_enrollments e WHERE e.id = p_enrollment_id AND e.user_id = auth.uid())
     AND public.training_week_open_for_enrollment_internal(p_enrollment_id, coalesce(
           p_training_week_id,
           (SELECT a.training_week_id FROM public.assignments a WHERE a.id = p_assignment_id),
           (SELECT dp.training_week_id FROM public.daily_prompts dp WHERE dp.id = p_daily_prompt_id)));
$function$;
REVOKE ALL ON FUNCTION public.learner_training_evidence_allowed(uuid, uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.learner_training_evidence_allowed(uuid, uuid, uuid, uuid) TO authenticated, service_role;

-- Content
DROP POLICY IF EXISTS "Training weeks: enrolled users view" ON public.training_weeks;
CREATE POLICY "Training weeks: enrolled users view" ON public.training_weeks FOR SELECT TO authenticated
  USING (has_programme_module('training'::programme_module_type) AND public.learner_training_week_open(id));

DROP POLICY IF EXISTS "Assignments: enrolled users view" ON public.assignments;
CREATE POLICY "Assignments: enrolled users view" ON public.assignments FOR SELECT TO authenticated
  USING (is_visible AND has_programme_module('quiz'::programme_module_type)
         AND public.learner_training_week_open(training_week_id));

DROP POLICY IF EXISTS "Daily prompts: enrolled users view" ON public.daily_prompts;
CREATE POLICY "Daily prompts: enrolled users view" ON public.daily_prompts FOR SELECT TO authenticated
  USING (has_programme_module('daily_prompt'::programme_module_type)
         AND public.learner_training_week_open(training_week_id));

DROP POLICY IF EXISTS "Reflections: participant read" ON public.programme_reflections;
CREATE POLICY "Reflections: participant read" ON public.programme_reflections FOR SELECT TO authenticated
  USING (is_visible AND EXISTS (
    SELECT 1 FROM public.training_weeks tw
    WHERE tw.programme_id = programme_reflections.programme_id
      AND tw.week_number = programme_reflections.appears_at_week
      AND public.learner_training_week_open(tw.id)));

CREATE OR REPLACE FUNCTION public.get_quiz_questions(p_assignment_id uuid)
 RETURNS TABLE(id uuid, question_text text, question_text_vi text, options jsonb, explanation text, explanation_vi text, sort_order integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH access AS (
    SELECT EXISTS (
      SELECT 1 FROM public.assignments a
      WHERE a.id = p_assignment_id
        AND a.is_visible = true
        AND public.learner_training_week_open(a.training_week_id)
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
$function$;

CREATE OR REPLACE FUNCTION public.get_enrollment_training_weeks(p_enrollment_id uuid)
 RETURNS TABLE(id uuid, week_number integer, title text, title_vi text, subtitle text, subtitle_vi text, unlock_date date, effective_unlock_date date, locked boolean, skill_card_visible boolean, viewed_at timestamp with time zone, completed_at timestamp with time zone, requirement_id uuid, requirement_due_on date, requirement_state text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH enrollment AS (
    SELECT pe.id, pe.programme_id, pe.cohort_id, pe.start_date
    FROM public.programme_enrollments pe
    WHERE pe.id = p_enrollment_id AND pe.user_id = auth.uid()
  ), training AS (
    SELECT e.*, pm.config
    FROM enrollment e
    JOIN public.programme_modules pm
      ON pm.programme_id = e.programme_id
     AND pm.module = 'training'::public.programme_module_type
     AND pm.enabled
  ), weeks AS (
    SELECT t.id AS enrollment_id, t.cohort_id, t.start_date, tw.*
    FROM training t
    JOIN public.training_weeks tw ON tw.programme_id = t.programme_id
    WHERE jsonb_typeof(t.config->'distribution_settings'->'training_week_ids') IS DISTINCT FROM 'array'
       OR (t.config->'distribution_settings'->'training_week_ids') ? tw.id::text
  ), calendar AS (
    SELECT c.training_week_id, c.requirement_id, c.due_on, c.state
    FROM public.canonical_enrollment_requirement_status(p_enrollment_id, public.programme_today()) c
    WHERE c.module = 'training'::public.programme_module_type
  ), fulfilment AS (
    SELECT * FROM public.canonical_training_week_fulfilment(p_enrollment_id, public.programme_today())
  )
  SELECT w.id, w.week_number, w.title, w.title_vi, w.subtitle, w.subtitle_vi, w.unlock_date,
    public.canonical_training_week_available_on(p_enrollment_id, w.id),
    -- Locked = not open to this enrollment today: the same predicate as the
    -- content and evidence policies (20261006160000).
    NOT public.training_week_open_for_enrollment_internal(p_enrollment_id, w.id),
    w.skill_card_visible,
    tp.viewed_at,
    CASE WHEN f.week_complete THEN greatest(
      f.skill_card_completed_at, f.quiz_completed_at, f.reflection_completed_at
    ) END,
    cal.requirement_id, cal.due_on,
    CASE
      WHEN cal.training_week_id IS NULL THEN 'not_required'
      ELSE cal.state
    END
  FROM weeks w
  LEFT JOIN public.cohort_week_overrides cwo
    ON cwo.cohort_id = w.cohort_id AND cwo.training_week_id = w.id
  LEFT JOIN public.training_progress tp
    ON tp.training_week_id = w.id AND tp.enrollment_id = w.enrollment_id
  LEFT JOIN calendar cal ON cal.training_week_id = w.id
  LEFT JOIN fulfilment f ON f.training_week_id = w.id
  WHERE w.is_visible = true AND coalesce(cwo.is_visible, true)
  ORDER BY w.week_number;
$function$;

-- Evidence: read and delete your own; write only into an open week of your
-- own ongoing enrollment.
DROP POLICY IF EXISTS "Training progress: user manage own" ON public.training_progress;
CREATE POLICY "Training progress: user read own" ON public.training_progress FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Training progress: user delete own" ON public.training_progress FOR DELETE TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Training progress: user write open week" ON public.training_progress FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND public.learner_training_evidence_allowed(enrollment_id, p_training_week_id => training_week_id));
CREATE POLICY "Training progress: user update open week" ON public.training_progress FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid() AND public.learner_training_evidence_allowed(enrollment_id, p_training_week_id => training_week_id));

DROP POLICY IF EXISTS "Submissions: user manage own" ON public.assignment_submissions;
CREATE POLICY "Submissions: user read own" ON public.assignment_submissions FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Submissions: user delete own" ON public.assignment_submissions FOR DELETE TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Submissions: user write open week" ON public.assignment_submissions FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND public.learner_training_evidence_allowed(enrollment_id, p_assignment_id => assignment_id));
CREATE POLICY "Submissions: user update open week" ON public.assignment_submissions FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid() AND public.learner_training_evidence_allowed(enrollment_id, p_assignment_id => assignment_id));

DROP POLICY IF EXISTS "Prompt responses: user manage own" ON public.daily_prompt_responses;
CREATE POLICY "Prompt responses: user read own" ON public.daily_prompt_responses FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Prompt responses: user delete own" ON public.daily_prompt_responses FOR DELETE TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Prompt responses: user write open week" ON public.daily_prompt_responses FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND public.learner_training_evidence_allowed(enrollment_id, p_daily_prompt_id => daily_prompt_id));
CREATE POLICY "Prompt responses: user update open week" ON public.daily_prompt_responses FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid() AND public.learner_training_evidence_allowed(enrollment_id, p_daily_prompt_id => daily_prompt_id));

-- ---------------------------------------------------------------------------
-- 4. at_risk is never stored
-- ---------------------------------------------------------------------------
UPDATE public.programme_enrollments SET status = 'active' WHERE status = 'at_risk';
ALTER TABLE public.programme_enrollments DROP CONSTRAINT IF EXISTS programme_enrollments_status_not_at_risk;
ALTER TABLE public.programme_enrollments ADD CONSTRAINT programme_enrollments_status_not_at_risk
  CHECK (status <> 'at_risk'::public.enrollment_status);

-- ---------------------------------------------------------------------------
-- 5. Enrollment end follows its cohort's end
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_enrollment_end_from_cohort()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  -- An enrollment still ending on the cohort's old date follows the cohort;
  -- one with its own end date (an Admin override) keeps it.
  UPDATE public.programme_enrollments e
     SET end_date = NEW.end_date
   WHERE e.cohort_id = NEW.id
     AND e.end_date IS NOT DISTINCT FROM OLD.end_date;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.sync_enrollment_end_from_cohort() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS cohorts_sync_enrollment_end ON public.cohorts;
CREATE TRIGGER cohorts_sync_enrollment_end
  AFTER UPDATE OF end_date ON public.cohorts
  FOR EACH ROW WHEN (NEW.end_date IS DISTINCT FROM OLD.end_date)
  EXECUTE FUNCTION public.sync_enrollment_end_from_cohort();

-- ---------------------------------------------------------------------------
-- Final-state guard: no policy dates by the server either (20261006150000
-- guarded functions only).
-- ---------------------------------------------------------------------------
DO $verify$
DECLARE bad text;
BEGIN
  SELECT string_agg(tablename || '.' || policyname, ', ') INTO bad
  FROM pg_policies
  WHERE schemaname = 'public'
    AND (coalesce(qual, '') || coalesce(with_check, '')) ~* '(current_date|unlock_date)';
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'Policies still date content by the server or the raw unlock date: %', bad;
  END IF;
END
$verify$;
