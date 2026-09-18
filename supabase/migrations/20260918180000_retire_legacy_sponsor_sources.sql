-- Final source-of-truth cleanup: retire legacy Sponsor sources.
--
-- After 20260918160000 (stored cohort dates) and 20260918170000 (one
-- completion / journey / schedule-state construction) this migration removes
-- every remaining parallel engine and makes the hosted function inventory
-- equal the repository's:
--
--   1. ONE experience construction (weekly participation, learning
--      breakdown, coaching utilisation incl. next session) behind the
--      Learner and Sponsor wrappers. The Sponsor copy returned an empty
--      weekly participation and NULL coaching utilisation (a real bug).
--   2. Requirement timing for Training weeks: cohort override → cohort
--      calendar → programme template date (the programme date is template
--      data and never outranks the cohort).
--   3. Retired (dropped) engines: the legacy Sponsor summaries, their
--      production-only helpers, the leader next-booking / experience copies,
--      the Admin weighted-progress compatibility RPC and the dead
--      progress_pct maintenance functions.
--   4. Internal primitives lose client EXECUTE.
--   5. sponsor_min_leaders_for_distribution has one signature everywhere.
--   6. Final-state guard.

-- ---------------------------------------------------------------------------
-- 1. One experience construction
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.canonical_enrollment_experience_base(p_enrollment_id uuid, p_as_of date DEFAULT CURRENT_DATE)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $exp$
  WITH progress AS (
    SELECT *
    FROM public.canonical_enrollment_progress(p_enrollment_id, p_as_of)
  ),
  eligible AS (
    SELECT
      p.enrollment_id,
      p.programme_id,
      p.cohort_id,
      p.programme_start_date
    FROM progress p
  ),
  schedule AS (
    SELECT
      e.enrollment_id,
      s.module,
      s.due_on,
      s.milestone_units,
      coalesce(tw.week_number, greatest(
        1,
        floor((s.due_on - e.programme_start_date)::numeric / 7)::integer + 1
      )) AS week_number
    FROM eligible e
    CROSS JOIN LATERAL public.sponsor_canonical_module_schedule(e.enrollment_id) s
    LEFT JOIN public.training_weeks tw ON tw.id = s.training_week_id
    WHERE s.due_on IS NOT NULL
  ),
  schedule_weeks AS (
    SELECT
      week_number,
      min(due_on) - 6 AS week_start,
      max(due_on) AS week_end,
      sum(milestone_units)::integer AS required_units
    FROM schedule
    GROUP BY week_number
  ),
  activity AS (
    SELECT
      e.enrollment_id,
      a.occurred_on,
      a.status,
      greatest(
        1,
        floor((a.occurred_on - e.programme_start_date)::numeric / 7)::integer + 1
      ) AS week_number
    FROM eligible e
    CROSS JOIN LATERAL public.sponsor_canonical_activity(e.enrollment_id) a
    WHERE a.occurred_on <= p_as_of
  ),
  weekly AS (
    SELECT
      sw.week_number,
      sw.week_start,
      sw.week_end,
      sw.required_units,
      least(
        sw.required_units,
        coalesce(sum(1) FILTER (WHERE a.status = 'completed'), 0)
      )::integer AS completed_units,
      coalesce(sum(1) FILTER (WHERE a.status = 'completed'), 0)::integer AS activity_units
    FROM schedule_weeks sw
    LEFT JOIN activity a ON a.week_number = sw.week_number
    GROUP BY sw.week_number, sw.week_start, sw.week_end, sw.required_units
  ),
  learning_weeks AS (
    SELECT
      e.enrollment_id,
      tw.id AS training_week_id,
      tw.week_number,
      tw.is_visible,
      tw.skill_card_visible,
      coalesce(cwo.is_visible, true) AS override_visible,
      coalesce(
        cwo.unlock_date,
        CASE WHEN e.cohort_id IS NOT NULL
          THEN (e.programme_start_date + ((tw.week_number - 1) * interval '7 days'))::date
          ELSE NULL
        END,
        tw.unlock_date
      ) AS effective_unlock_date
    FROM eligible e
    JOIN public.training_weeks tw ON tw.programme_id = e.programme_id
    LEFT JOIN public.cohort_week_overrides cwo
      ON cwo.cohort_id = e.cohort_id
     AND cwo.training_week_id = tw.id
  ),
  learning_items AS (
    SELECT
      'skill_cards'::text AS item_type,
      lw.training_week_id AS item_id,
      lw.effective_unlock_date AS due_on,
      tp.completed_at IS NOT NULL AS completed
    FROM learning_weeks lw
    JOIN public.programme_modules pm
      ON pm.programme_id = (SELECT programme_id FROM eligible)
     AND pm.module = 'training'::public.programme_module_type
     AND pm.enabled = true
    LEFT JOIN public.training_progress tp
      ON tp.enrollment_id = lw.enrollment_id
     AND tp.training_week_id = lw.training_week_id
    WHERE lw.is_visible
      AND lw.skill_card_visible
      AND lw.override_visible

    UNION ALL

    SELECT
      'quizzes'::text,
      a.id,
      CASE WHEN lw.effective_unlock_date IS NULL THEN NULL
        ELSE lw.effective_unlock_date + coalesce(a.due_offset_days, 7)
      END,
      asub.submitted_at IS NOT NULL
    FROM learning_weeks lw
    JOIN public.programme_modules pm
      ON pm.programme_id = (SELECT programme_id FROM eligible)
     AND pm.module = 'quiz'::public.programme_module_type
     AND pm.enabled = true
    JOIN public.assignments a
      ON a.training_week_id = lw.training_week_id
     AND a.assignment_type = 'quiz'::public.assignment_type
     AND a.is_visible = true
    LEFT JOIN public.assignment_submissions asub
      ON asub.enrollment_id = lw.enrollment_id
     AND asub.assignment_id = a.id
    WHERE lw.is_visible
      AND lw.override_visible

    UNION ALL

    SELECT
      'reflections'::text,
      pr.id,
      CASE WHEN lw.effective_unlock_date IS NULL THEN NULL
        ELSE lw.effective_unlock_date + 6
      END,
      rs.submitted_at IS NOT NULL
    FROM learning_weeks lw
    JOIN public.programme_modules pm
      ON pm.programme_id = (SELECT programme_id FROM eligible)
     AND pm.module = 'training'::public.programme_module_type
     AND pm.enabled = true
    JOIN public.programme_reflections pr
      ON pr.programme_id = (SELECT programme_id FROM eligible)
     AND pr.appears_at_week = lw.week_number
     AND pr.is_visible = true
    LEFT JOIN public.reflection_submissions rs
      ON rs.enrollment_id = lw.enrollment_id
     AND rs.reflection_id = pr.id
    WHERE lw.is_visible
      AND lw.override_visible

    UNION ALL

    SELECT
      'daily_prompts'::text,
      dp.id,
      CASE WHEN lw.effective_unlock_date IS NULL THEN NULL
        ELSE lw.effective_unlock_date + (dp.day_offset - 1)
      END,
      dpr.responded_at IS NOT NULL
    FROM learning_weeks lw
    JOIN public.programme_modules pm
      ON pm.programme_id = (SELECT programme_id FROM eligible)
     AND pm.module = 'daily_prompt'::public.programme_module_type
     AND pm.enabled = true
    JOIN public.daily_prompts dp ON dp.training_week_id = lw.training_week_id
    LEFT JOIN public.daily_prompt_responses dpr
      ON dpr.enrollment_id = lw.enrollment_id
     AND dpr.daily_prompt_id = dp.id
    WHERE lw.is_visible
      AND lw.override_visible
  ),
  learning_keys AS (
    SELECT *
    FROM (VALUES
      ('skill_cards'::text, 'Skill Cards'::text),
      ('quizzes'::text, 'Quizzes'::text),
      ('reflections'::text, 'Reflections'::text),
      ('daily_prompts'::text, 'Daily Prompts'::text)
    ) AS keys(item_type, label)
  ),
  learning AS (
    SELECT
      k.item_type,
      k.label,
      count(li.item_id)::integer AS required_units,
      count(li.item_id) FILTER (WHERE li.due_on IS NOT NULL AND li.due_on <= p_as_of)::integer AS due_units,
      least(
        count(li.item_id),
        count(li.item_id) FILTER (WHERE li.completed)
      )::integer AS completed_units,
      max(li.due_on) AS last_due_on
    FROM learning_keys k
    LEFT JOIN learning_items li ON li.item_type = k.item_type
    GROUP BY k.item_type, k.label
  ),
  coaching AS (
    SELECT
      p.coaching_required_units AS required_units,
      p.coaching_completed_units AS completed_units,
      p.coaching_due_units AS due_units,
      p.coaching_booked_units AS booked_units,
      CASE
        WHEN p.coaching_required_units IS NULL OR p.coaching_required_units = 0 THEN NULL
        ELSE round(
          least(p.coaching_completed_units, p.coaching_required_units) * 100.0
          / p.coaching_required_units, 1
        )
      END AS utilisation_pct,
      (
        SELECT min(s.start_time)
        FROM public.sessions s
        WHERE s.enrollment_id = p.enrollment_id
          AND s.status IN ('pending_coach_approval', 'confirmed')
          AND s.start_time >= now()
      ) AS next_session_at
    FROM progress p
  )
  SELECT CASE
    WHEN NOT EXISTS (SELECT 1 FROM progress) THEN '{}'::jsonb
    ELSE jsonb_build_object(
      'weekly_participation',
      coalesce((
        SELECT jsonb_agg(jsonb_build_object(
          'week_number', w.week_number,
          'week_start', w.week_start,
          'week_end', w.week_end,
          'required_units', w.required_units,
          'due_units', CASE WHEN p_as_of >= w.week_end THEN w.required_units ELSE 0 END,
          'completed_units', w.completed_units,
          'activity_units', w.activity_units,
          'state', CASE
            WHEN p_as_of < w.week_start THEN 'upcoming'
            WHEN w.required_units > 0 AND w.completed_units >= w.required_units THEN 'completed'
            WHEN p_as_of <= w.week_end THEN 'current'
            ELSE 'overdue'
          END,
          'is_current', p_as_of >= w.week_start AND p_as_of <= w.week_end
        ) ORDER BY w.week_number)
        FROM weekly w
      ), '[]'::jsonb),
      'learning_breakdown',
      coalesce((
        SELECT jsonb_agg(jsonb_build_object(
          'key', l.item_type,
          'label', l.label,
          'required_units', l.required_units,
          'due_units', l.due_units,
          'completed_units', l.completed_units,
          'progress_available', l.required_units > 0,
          'status', CASE
            WHEN l.required_units = 0 THEN 'unavailable'
            WHEN l.completed_units >= l.required_units THEN 'completed'
            WHEN l.due_units = 0 THEN 'upcoming'
            WHEN l.last_due_on IS NOT NULL AND p_as_of <= l.last_due_on THEN 'current'
            ELSE 'overdue'
          END
        ) ORDER BY l.item_type)
        FROM learning l
      ), '[]'::jsonb),
      'coaching_utilisation',
      coalesce((SELECT to_jsonb(c) FROM coaching c), '{}'::jsonb)
    )
  END;
$exp$;

REVOKE ALL ON FUNCTION public.canonical_enrollment_experience_base(uuid, date) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.canonical_enrollment_experience(p_enrollment_id uuid, p_as_of date DEFAULT CURRENT_DATE)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  -- THE enrollment experience: weekly participation + coaching utilisation
  -- (canonical_enrollment_experience_base) with the canonical learning
  -- breakdown. Internal; Learner and Sponsor read it through wrappers.
  SELECT CASE
    WHEN base.payload = '{}'::jsonb THEN base.payload
    ELSE jsonb_set(
      base.payload,
      '{learning_breakdown}',
      public.canonical_learning_breakdown(p_enrollment_id, p_as_of),
      true
    )
  END
  FROM (SELECT public.canonical_enrollment_experience_base(p_enrollment_id, p_as_of) AS payload) base;
$$;

REVOKE ALL ON FUNCTION public.canonical_enrollment_experience(uuid, date) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.learner_canonical_experience(p_enrollment_id uuid, p_as_of date DEFAULT CURRENT_DATE)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN EXISTS (
      SELECT 1 FROM public.programme_enrollments e
      WHERE e.id = p_enrollment_id AND e.user_id = auth.uid() AND auth.uid() IS NOT NULL
    )
    THEN public.canonical_enrollment_experience(p_enrollment_id, p_as_of)
    ELSE '{}'::jsonb
  END;
$$;

CREATE OR REPLACE FUNCTION public.sponsor_canonical_leader_experience(p_enrollment_id uuid, p_as_of date DEFAULT CURRENT_DATE)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  -- Sponsor: own organisation's cohort, minimum-cohort-size rule unchanged.
  SELECT CASE
    WHEN EXISTS (
      SELECT 1
      FROM public.programme_enrollments e
      JOIN public.cohorts c ON c.id = e.cohort_id
      JOIN public.sponsor_profiles sp
        ON sp.organization_id = c.organization_id
       AND sp.user_id = auth.uid()
      WHERE e.id = p_enrollment_id
        AND auth.uid() IS NOT NULL
        AND (
          SELECT count(*) FROM public.programme_enrollments same_cohort
          WHERE same_cohort.cohort_id = e.cohort_id
        ) >= public.sponsor_min_leaders_for_distribution()
    )
    THEN public.canonical_enrollment_experience(p_enrollment_id, p_as_of)
    ELSE '{}'::jsonb
  END;
$$;

-- ---------------------------------------------------------------------------
-- 2. Training requirement timing: cohort owns the date
-- ---------------------------------------------------------------------------
DO $training$
DECLARE
  def text;
  patched text;
BEGIN
  def := pg_get_functiondef('public.canonical_training_learning_items(uuid,date)'::regprocedure);
  patched := regexp_replace(def,
    'coalesce\(\s*cwo\.unlock_date,\s*tw\.unlock_date,\s*(\(c\.cohort_start_date \+ \(\(tw\.week_number - 1\) \* interval ''7 days''\)\)::date)\s*\)',
    'coalesce(cwo.unlock_date, \1, tw.unlock_date)');
  IF patched = def THEN
    RAISE EXCEPTION 'canonical_training_learning_items date precedence not found';
  END IF;
  EXECUTE patched;

  def := pg_get_functiondef('public.canonical_learning_breakdown(uuid,date)'::regprocedure);
  patched := regexp_replace(def,
    'coalesce\(\s*cwo\.unlock_date,\s*tw\.unlock_date,\s*(\(p\.programme_start_date \+ \(\(tw\.week_number - 1\) \* interval ''7 days''\)\)::date)\s*\)',
    'coalesce(cwo.unlock_date, \1, tw.unlock_date)');
  IF patched = def THEN
    RAISE EXCEPTION 'canonical_learning_breakdown date precedence not found';
  END IF;
  EXECUTE patched;

  -- Proposal layer (new / regenerated cohort dates only; stored dates untouched).
  def := pg_get_functiondef('public.cohort_requirement_proposal_internal(uuid,uuid,date,date)'::regprocedure);
  patched := regexp_replace(def,
    'coalesce\(\s*cwo\.unlock_date,\s*coalesce\(tw\.unlock_date,\s*(\(p_start \+ \(\(tw\.week_number - 1\) \* interval ''7 days''\)\)::date)\)\s*\)',
    'coalesce(cwo.unlock_date, \1, tw.unlock_date)');
  IF patched = def THEN
    RAISE EXCEPTION 'cohort_requirement_proposal_internal date precedence not found';
  END IF;
  EXECUTE patched;
END
$training$;

-- ---------------------------------------------------------------------------
-- 3. Retired engines (dropped). Canonical replacements:
--    sponsor_enrollment_summaries        -> sponsor_canonical_enrollment_progress / _enrollment_metadata
--    sponsor_cohort_summaries(+_legacy)  -> sponsor_canonical_cohort_progress
--    sponsor_organisation_summary(+_legacy) -> sponsor_canonical_organisation_progress
--    sponsor_metric_rows(+_legacy), sponsor_satisfaction_summary,
--    sponsor_satisfaction_events, sponsor_normalize_satisfaction
--                                        -> canonical_enrollment_engagement (satisfaction) via metadata
--    sponsor_leader_engagement_summary   -> sponsor_canonical_enrollment_metadata
--    sponsor_leader_cadence_items, sponsor_cohort_cadence_items
--                                        -> canonical_enrollment_journey (checkpoints)
--    sponsor_enrollment_next_session, sponsor_canonical_leader_next_booking
--                                        -> canonical_enrollment_experience (coaching_utilisation.next_session_at)
--    sponsor_leader_programme_history    -> sponsor_canonical_leader_progress
--    sponsor_canonical_leader_experience_base / _legacy, learner_canonical_experience_legacy
--                                        -> canonical_enrollment_experience
--    get_admin_enrollment_progress       -> admin_canonical_enrollment_progress
--    compute_leader_progress, refresh_all_progress_pct,
--    trg_update_progress_from_session/_training -> none (progress_pct is deprecated)
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.sponsor_satisfaction_summary(uuid);
DROP FUNCTION IF EXISTS public.sponsor_metric_rows(uuid, date);
DROP FUNCTION IF EXISTS public.sponsor_metric_rows_legacy(uuid, date);
DROP FUNCTION IF EXISTS public.sponsor_satisfaction_events();
DROP FUNCTION IF EXISTS public.sponsor_normalize_satisfaction(numeric, numeric);
DROP FUNCTION IF EXISTS public.sponsor_cohort_summaries(uuid);
DROP FUNCTION IF EXISTS public.sponsor_cohort_summaries_legacy(uuid);
DROP FUNCTION IF EXISTS public.sponsor_enrollment_summaries(uuid);
DROP FUNCTION IF EXISTS public.sponsor_organisation_summary();
DROP FUNCTION IF EXISTS public.sponsor_organisation_summary_legacy();
DROP FUNCTION IF EXISTS public.sponsor_leader_engagement_summary(uuid);
DROP FUNCTION IF EXISTS public.sponsor_leader_cadence_items(uuid, date);
DROP FUNCTION IF EXISTS public.sponsor_cohort_cadence_items(uuid, date);
DROP FUNCTION IF EXISTS public.sponsor_enrollment_next_session(uuid);
DROP FUNCTION IF EXISTS public.sponsor_canonical_leader_next_booking(uuid);
DROP FUNCTION IF EXISTS public.sponsor_leader_programme_history(uuid);
DROP FUNCTION IF EXISTS public.sponsor_canonical_leader_experience_base(uuid, date);
DROP FUNCTION IF EXISTS public.sponsor_canonical_leader_experience_legacy(uuid, date);
DROP FUNCTION IF EXISTS public.learner_canonical_experience_legacy(uuid, date);
DROP FUNCTION IF EXISTS public.get_admin_enrollment_progress(uuid[], date);
DROP FUNCTION IF EXISTS public.refresh_all_progress_pct();
DROP FUNCTION IF EXISTS public.trg_update_progress_from_session();
DROP FUNCTION IF EXISTS public.trg_update_progress_from_training();
DROP FUNCTION IF EXISTS public.compute_leader_progress(uuid, uuid);

-- ---------------------------------------------------------------------------
-- 4. Internal primitives: no client EXECUTE
-- ---------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.get_sponsor_programme_progress(uuid, date) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_sponsor_programme_journey(uuid, date) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.attribute_activity_to_cadence_milestone(uuid, text, uuid, date) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.canonical_module_progress(uuid, date) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.canonical_training_learning_items(uuid, date) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.canonical_learning_breakdown(uuid, date) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.canonical_enrollment_engagement(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.canonical_goal_progress(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sponsor_canonical_activity(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sponsor_canonical_module_schedule(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sponsor_canonical_cohort_progress_one(uuid, date) FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.get_sponsor_programme_progress(uuid, date) IS 'INTERNAL — projection of canonical_module_progress; not client-callable.';
COMMENT ON FUNCTION public.get_sponsor_programme_journey(uuid, date) IS 'INTERNAL — cohort journey aggregate over the canonical schedule; clients use sponsor_canonical_programme_journey.';

-- ---------------------------------------------------------------------------
-- 5. One threshold signature (production had an uncommitted (uuid) variant)
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.sponsor_min_leaders_for_distribution(uuid);
CREATE OR REPLACE FUNCTION public.sponsor_min_leaders_for_distribution()
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT 5
$$;
REVOKE ALL ON FUNCTION public.sponsor_min_leaders_for_distribution() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sponsor_min_leaders_for_distribution() TO authenticated;

-- ---------------------------------------------------------------------------
-- 6. Final-state guard
-- ---------------------------------------------------------------------------
DO $guard$
DECLARE
  leftover text;
BEGIN
  SELECT string_agg(p.proname, ', ') INTO leftover
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN (
      'sponsor_enrollment_summaries', 'sponsor_cohort_summaries', 'sponsor_organisation_summary',
      'sponsor_cohort_summaries_legacy', 'sponsor_organisation_summary_legacy', 'sponsor_metric_rows',
      'sponsor_metric_rows_legacy', 'sponsor_satisfaction_summary', 'sponsor_satisfaction_events',
      'sponsor_normalize_satisfaction', 'sponsor_leader_engagement_summary', 'sponsor_leader_cadence_items',
      'sponsor_cohort_cadence_items', 'sponsor_enrollment_next_session', 'sponsor_canonical_leader_next_booking',
      'sponsor_leader_programme_history', 'sponsor_canonical_leader_experience_base',
      'sponsor_canonical_leader_experience_legacy', 'learner_canonical_experience_legacy',
      'get_admin_enrollment_progress', 'compute_leader_progress', 'refresh_all_progress_pct',
      'trg_update_progress_from_session', 'trg_update_progress_from_training');
  IF leftover IS NOT NULL THEN
    RAISE EXCEPTION 'Retired engines still present: %', leftover;
  END IF;
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'sponsor_min_leaders_for_distribution') <> 1 THEN
    RAISE EXCEPTION 'sponsor_min_leaders_for_distribution must have exactly one signature';
  END IF;
  IF pg_get_functiondef('public.learner_canonical_experience(uuid,date)'::regprocedure) !~ 'canonical_enrollment_experience'
     OR pg_get_functiondef('public.sponsor_canonical_leader_experience(uuid,date)'::regprocedure) !~ 'canonical_enrollment_experience' THEN
    RAISE EXCEPTION 'Learner / Sponsor experience must share canonical_enrollment_experience';
  END IF;
  IF pg_get_functiondef('public.sponsor_canonical_module_schedule(uuid)'::regprocedure) !~ 'cohort_requirement_dates' THEN
    RAISE EXCEPTION 'canonical schedule must read cohort_requirement_dates';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosrc ~ '(^|[^_a-z])progress_pct'
      AND p.prosrc !~ 'goal_progress_pct|gp\.progress_pct|\.progress_pct\s+AS|progress_pct numeric'
      AND p.proname NOT IN ('canonical_goal_progress', 'canonical_enrollment_engagement', 'learner_canonical_goal_progress')
  ) THEN
    RAISE EXCEPTION 'a function still reads the deprecated programme_enrollments.progress_pct';
  END IF;
END
$guard$;
