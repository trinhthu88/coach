-- ===========================================================================
-- Requirement availability, programme-end freeze and current-fulfilment journey
-- ===========================================================================
--
-- Product rules (confirmed 2026-09-23):
--
--   AVAILABILITY -- the earliest date a requirement can be fulfilled
--     Training                 available_on = the week's effective availability
--                              date. No early-completion window: evidence
--                              recorded before available_on never counts.
--     Coaching / Mentoring /   available_on = due_on - 14 days
--     Peer / Triads            (canonical_session_requirement_available_on). A
--                              session completed before that date does not
--                              fulfil the programme requirement. Booking rules
--                              are unchanged.
--
--   PROGRAMME END FREEZE
--     effective_as_of = least(as_of, programme end)
--     (canonical_enrollment_effective_as_of; programme end = the enrollment's
--     end date, else its cohort's -- the same date canonical_enrollment_progress
--     reports). Activity after the programme end stays historical activity and
--     never improves the frozen programme completion.
--
--   FULFILMENT -- counts_for_programme
--     available_on <= completed_on <= effective_as_of
--     Training week complete = Skill Card AND Quiz (when configured) AND
--     Reflection (when configured), each dated within that window. Daily
--     Prompts are displayed and tracked but never gate a week.
--
--   STATE (per requirement; canonical_enrollment_requirement_status)
--     available_on > effective_as_of                       upcoming
--     completed_on <= due_on                               completed
--     completed_on >  due_on                               completed_late
--     due_on < effective_as_of                             overdue
--     otherwise                                            current
--
--   JOURNEY -- current fulfilment over the SAME counted records as module
--   progress. A checkpoint's completed_units counts requirements due by that
--   date that count for the programme as of effective_as_of, so an
--   unavailable Training week can raise a checkpoint's denominator but never
--   its numerator, and the final checkpoint equals the canonical totals.
--
-- Depends on 20260929100000_canonical_contract_hardening
-- (canonical_training_week_fulfilment and friends are redefined here).
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Training child learning types are always explicit
-- ---------------------------------------------------------------------------
-- A Training module without learning_components used to fall back to Skill
-- Cards + Reflections only, so Quizzes and Daily Prompts vanished from the
-- breakdown. The Admin editor now saves all four by default (what
-- 20260922182103 set on the existing programmes). An explicit Admin selection
-- is never overwritten.
UPDATE public.programme_modules
   SET config = jsonb_set(coalesce(config, '{}'::jsonb), '{learning_components}',
     '["skill_cards", "quizzes", "reflections", "daily_prompts"]'::jsonb, true)
 WHERE module = 'training'::public.programme_module_type
   AND jsonb_typeof(config->'learning_components') IS DISTINCT FROM 'array';

ALTER TABLE public.programme_modules
  DROP CONSTRAINT IF EXISTS programme_modules_training_learning_components;
ALTER TABLE public.programme_modules
  ADD CONSTRAINT programme_modules_training_learning_components
  CHECK (module <> 'training'::public.programme_module_type
         OR jsonb_typeof(config->'learning_components') = 'array');

-- ---------------------------------------------------------------------------
-- 2. The two dates every rule below reads
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.canonical_enrollment_effective_as_of(
  p_enrollment_id uuid,
  p_as_of date DEFAULT CURRENT_DATE
)
RETURNS date
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  -- Programme completion freezes at the programme end: the enrollment's own
  -- end date, else its cohort's (canonical_enrollment_progress.enrollment_end_date).
  SELECT CASE
    WHEN coalesce(e.end_date, c.end_date) IS NULL THEN p_as_of
    ELSE least(p_as_of, coalesce(e.end_date, c.end_date))
  END
  FROM public.programme_enrollments e
  LEFT JOIN public.cohorts c ON c.id = e.cohort_id
  WHERE e.id = p_enrollment_id;
$function$;

REVOKE ALL ON FUNCTION public.canonical_enrollment_effective_as_of(uuid, date) FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION public.canonical_enrollment_effective_as_of(uuid, date) IS
  'THE programme-end freeze: least(as_of, the enrollment end date, else its cohort end date). Every canonical '
  'progress projection evaluates fulfilment as of this date. Internal.';

CREATE OR REPLACE FUNCTION public.canonical_session_requirement_available_on(p_due_on date)
RETURNS date
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $function$
  -- Coaching, Mentoring, Peer and Triad requirements become eligible for
  -- completion 14 calendar days before their deadline.
  SELECT p_due_on - 14;
$function$;

REVOKE ALL ON FUNCTION public.canonical_session_requirement_available_on(date) FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION public.canonical_session_requirement_available_on(date) IS
  'THE session-requirement availability rule: due_on - 14 days. A session completed before it does not fulfil the '
  'programme requirement. Internal.';

-- ---------------------------------------------------------------------------
-- 3. Training week fulfilment
-- ---------------------------------------------------------------------------
-- Unchanged from 20260929100000 except: (a) every piece of evidence counts only
-- when dated within [available_on, effective as-of] -- evidence recorded before
-- the week opened never completes it, and a week that is not yet available
-- therefore contributes nothing; (b) p_as_of is frozen at the programme end.
CREATE OR REPLACE FUNCTION public.canonical_training_week_fulfilment(
  p_enrollment_id uuid,
  p_as_of date DEFAULT CURRENT_DATE
)
RETURNS TABLE (
  training_week_id uuid,
  week_number integer,
  due_on date,
  available_on date,
  unlock_on date,
  skill_card_required boolean,
  skill_card_completed boolean,
  skill_card_completed_at timestamptz,
  quiz_required boolean,
  quiz_completed boolean,
  quiz_completed_at timestamptz,
  reflection_required boolean,
  reflection_completed boolean,
  reflection_completed_at timestamptz,
  daily_prompts_required integer,
  daily_prompts_completed integer,
  week_complete boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
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
      least(
        c.end_date,
        coalesce(
          d.due_on,
          cwo.unlock_date,
          (c.start_date + ((tw.week_number - 1) * interval '7 days'))::date,
          tw.unlock_date
        )
      ) AS due_on,
      least(
        c.end_date,
        coalesce(
          cwo.unlock_date,
          (c.start_date + ((tw.week_number - 1) * interval '7 days'))::date,
          tw.unlock_date
        )
      ) AS available_on,
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
    LEFT JOIN public.cohort_requirement_dates d
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
          AND sub.submitted_at::date <= (SELECT eff.as_of FROM eff)
          AND sub.submitted_at::date >= s.available_on
      )::integer AS completed,
      max(sub.submitted_at) FILTER (
        WHERE sub.submitted_at IS NOT NULL
          AND sub.submitted_at::date <= (SELECT eff.as_of FROM eff)
          AND sub.submitted_at::date >= s.available_on
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
          AND rs.submitted_at::date <= (SELECT eff.as_of FROM eff)
          AND rs.submitted_at::date >= s.available_on
      )::integer AS completed,
      max(rs.submitted_at) FILTER (
        WHERE rs.submitted_at IS NOT NULL
          AND rs.submitted_at::date <= (SELECT eff.as_of FROM eff)
          AND rs.submitted_at::date >= s.available_on
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
          AND dpr.responded_at::date <= (SELECT eff.as_of FROM eff)
          AND dpr.responded_at::date >= s.available_on
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
        AND tp.completed_at::date <= (SELECT eff.as_of FROM eff)
        AND tp.completed_at::date >= s.available_on
        AND s.available_on IS NOT NULL
        AND s.available_on <= (SELECT eff.as_of FROM eff) AS skill_card_completed,
      CASE WHEN tp.completed_at::date BETWEEN s.available_on AND (SELECT eff.as_of FROM eff)
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

REVOKE ALL ON FUNCTION public.canonical_training_week_fulfilment(uuid, date) FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION public.canonical_training_week_fulfilment(uuid, date) IS
  'Canonical Training week projection. Skill Card, Quiz and Reflection -- each dated within [available_on, '
  'effective as-of] -- fulfil the parent week; Daily Prompts are optional child evidence and never gate it.';

-- ---------------------------------------------------------------------------
-- 4. Parent Training items (unchanged from 20260929100000)
-- ---------------------------------------------------------------------------
-- Restated so this migration carries the whole Training chain it depends on:
-- the completion date is the latest of the three counted evidence dates, which
-- section 3 now guarantees are on or after the week's availability date.
CREATE OR REPLACE FUNCTION public.canonical_training_learning_items(
  p_enrollment_id uuid,
  p_as_of date DEFAULT CURRENT_DATE
)
RETURNS TABLE (
  item_type text,
  item_id uuid,
  training_week_id uuid,
  due_on date,
  required_units integer,
  completed_units integer,
  completed_on date
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT
    'skill_cards'::text,
    f.training_week_id,
    f.training_week_id,
    f.due_on,
    1,
    CASE WHEN f.week_complete THEN 1 ELSE 0 END,
    CASE WHEN f.week_complete THEN
      greatest(
        f.skill_card_completed_at,
        f.quiz_completed_at,
        f.reflection_completed_at
      )::date
    END
  FROM public.canonical_training_week_fulfilment(p_enrollment_id, p_as_of) f;
$function$;

REVOKE ALL ON FUNCTION public.canonical_training_learning_items(uuid, date) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Child learning evidence
-- ---------------------------------------------------------------------------
-- Unchanged from 20260929100000 except that a Daily Prompt response counts only
-- within [available_on, effective as-of], like every other Training evidence.
CREATE OR REPLACE FUNCTION public.canonical_learning_items(
  p_enrollment_id uuid,
  p_as_of date DEFAULT CURRENT_DATE
)
RETURNS TABLE (
  training_week_id uuid,
  item_type text,
  item_id uuid,
  due_on date,
  completed boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  WITH eff AS (
    SELECT coalesce(public.canonical_enrollment_effective_as_of(p_enrollment_id, p_as_of), p_as_of) AS as_of
  ), weeks AS (
    SELECT * FROM public.canonical_training_week_fulfilment(p_enrollment_id, (SELECT eff.as_of FROM eff))
  ), enrollment AS (
    SELECT e.id, e.programme_id
    FROM public.programme_enrollments e
    WHERE e.id = p_enrollment_id
  ), config AS (
    SELECT CASE
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
    LIMIT 1
  )
  SELECT w.training_week_id, 'skill_cards'::text, w.training_week_id, w.due_on,
    w.skill_card_completed
  FROM weeks w
  CROSS JOIN config c
  WHERE c.components ? 'skill_cards'

  UNION ALL
  SELECT w.training_week_id, 'quizzes'::text, a.id,
    w.available_on + coalesce(a.due_offset_days, 7),
    w.quiz_completed
  FROM weeks w
  CROSS JOIN config c
  JOIN public.assignments a
    ON a.training_week_id = w.training_week_id
   AND a.assignment_type = 'quiz'::public.assignment_type
   AND a.is_visible
  WHERE c.components ? 'quizzes'

  UNION ALL
  SELECT w.training_week_id, 'reflections'::text, pr.id,
    w.available_on + 6,
    w.reflection_completed
  FROM weeks w
  CROSS JOIN config c
  JOIN enrollment e ON true
  JOIN public.programme_reflections pr
    ON pr.programme_id = e.programme_id
   AND pr.appears_at_week = w.week_number
   AND pr.is_visible
  WHERE c.components ? 'reflections'

  UNION ALL
  SELECT w.training_week_id, 'daily_prompts'::text, dp.id,
    w.available_on + (coalesce(dp.day_offset, 1) - 1),
    (
      w.available_on IS NOT NULL
      AND w.available_on <= (SELECT eff.as_of FROM eff)
      AND EXISTS (
        SELECT 1
        FROM public.daily_prompt_responses dpr
        WHERE dpr.enrollment_id = p_enrollment_id
          AND dpr.daily_prompt_id = dp.id
          AND dpr.responded_at::date <= (SELECT eff.as_of FROM eff)
          AND dpr.responded_at::date >= w.available_on
      )
    )
  FROM weeks w
  CROSS JOIN config c
  JOIN public.daily_prompts dp
    ON dp.training_week_id = w.training_week_id
   AND dp.is_visible
  WHERE c.components ? 'daily_prompts';
$function$;

REVOKE ALL ON FUNCTION public.canonical_learning_items(uuid, date) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. Triad fulfilment
-- ---------------------------------------------------------------------------
-- A Triad requirement may hold several completed sessions of its group. It is
-- fulfilled by the FIRST one on or after its availability date (due_on - 14);
-- an earlier session is raw activity only. Otherwise unchanged from
-- 20260919120000.
CREATE OR REPLACE FUNCTION public.canonical_triad_requirement_fulfilment(p_enrollment_id uuid)
RETURNS TABLE (cohort_requirement_date_id uuid, unit_number integer, due_on date,
  fulfilled_on date, booked_on date, proposed_on date)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT d.id, d.ordinal, d.due_on,
    min(ev.occurred_on) FILTER (
      WHERE ev.status = 'completed'
        AND ev.occurred_on >= public.canonical_session_requirement_available_on(d.due_on)),
    min(ev.occurred_on) FILTER (WHERE ev.status = 'confirmed'),
    min(ev.occurred_on) FILTER (WHERE ev.status = 'proposed')
  FROM public.programme_enrollments e
  JOIN public.cohort_requirement_dates d
    ON d.cohort_id = e.cohort_id AND d.programme_id = e.programme_id
   AND d.module = 'triads'::public.programme_module_type
  LEFT JOIN LATERAL (
    -- Evidence of THIS enrollment on sessions of groups for THIS requirement.
    SELECT a.occurred_on, s.status
    FROM public.triad_groups g
    JOIN public.triad_group_members m ON m.triad_group_id = g.id AND m.enrollment_id = e.id
    JOIN public.triad_sessions s ON s.triad_group_id = g.id
    JOIN public.session_activity_attributions a
      ON a.source_activity_type = 'triad' AND a.source_activity_id = s.id AND a.enrollment_id = e.id
    WHERE g.cohort_requirement_date_id = d.id
  ) ev ON true
  WHERE e.id = p_enrollment_id
  GROUP BY d.id, d.ordinal, d.due_on;
$$;
COMMENT ON FUNCTION public.canonical_triad_requirement_fulfilment(uuid) IS
  'THE Triad completion rule: the first completed session of the requirement''s group on or after its availability '
  'date (due_on - 14) fulfils it, once. Internal.';

-- ---------------------------------------------------------------------------
-- 7. The requirement calendar
-- ---------------------------------------------------------------------------
-- Unchanged from 20260928100000 except: session requirements count only when
-- fulfilled within [due_on - 14, effective as-of]; Training reads section 3 at
-- the effective as-of; is_overdue means the due date has passed. Module
-- progress, enrollment progress, the sponsor cohort sums and the journeys all
-- aggregate these rows, so they cannot disagree.
CREATE OR REPLACE FUNCTION public.canonical_enrollment_requirement_calendar(
  p_enrollment_id uuid, p_as_of date DEFAULT CURRENT_DATE
) RETURNS TABLE (
  enrollment_id uuid, programme_id uuid, cohort_id uuid, organization_id uuid,
  module public.programme_module_type, requirement_id uuid, requirement_index integer,
  requirement_label text, training_week_id uuid, due_on date, is_required boolean,
  is_due_as_of boolean, is_completed boolean, completed_on date, is_overdue boolean,
  completion_source text
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
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
  ), rows AS (
    SELECT u.module, d.id AS requirement_id, u.ordinal AS requirement_index,
      public.cohort_requirement_label(u.module, u.ordinal) AS requirement_label,
      NULL::uuid AS training_week_id, d.due_on,
      -- Counts only within [due_on - 14, effective as-of].
      CASE WHEN f.fulfilled_on BETWEEN public.canonical_session_requirement_available_on(d.due_on) AND (SELECT eff.as_of FROM eff)
        THEN f.fulfilled_on END AS completed_on,
      CASE WHEN f.fulfilled_on BETWEEN public.canonical_session_requirement_available_on(d.due_on) AND (SELECT eff.as_of FROM eff)
        THEN f.source END AS completion_source
    FROM session_units u
    CROSS JOIN enrollment e
    LEFT JOIN public.cohort_requirement_dates d
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
    LEFT JOIN public.cohort_requirement_dates d
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

REVOKE ALL ON FUNCTION public.canonical_enrollment_requirement_calendar(uuid, date) FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION public.canonical_enrollment_requirement_calendar(uuid, date) IS
  'THE canonical requirement calendar: one row per applicable requirement instance of an enrollment with its due date '
  'and due / completed / overdue state as of the effective as-of (least(as_of, programme end)). A requirement is '
  'completed only when fulfilled within [available_on, effective as-of]. canonical_module_progress, '
  'canonical_overdue_items and canonical_enrollment_requirement_status aggregate it. Internal.';

-- ---------------------------------------------------------------------------
-- 8. Requirement status: availability, fulfilment and state, per requirement
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.canonical_enrollment_requirement_status(
  p_enrollment_id uuid,
  p_as_of date DEFAULT CURRENT_DATE
)
RETURNS TABLE (
  enrollment_id uuid,
  module public.programme_module_type,
  requirement_id uuid,
  requirement_index integer,
  requirement_label text,
  training_week_id uuid,
  available_on date,
  due_on date,
  completed_on date,
  effective_as_of date,
  state text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  WITH eff AS (
    SELECT coalesce(public.canonical_enrollment_effective_as_of(p_enrollment_id, p_as_of), p_as_of) AS as_of
  ), availability AS (
    SELECT f.training_week_id, f.available_on
    FROM public.canonical_training_week_fulfilment(p_enrollment_id, p_as_of) f
  ), rows AS (
    SELECT c.enrollment_id, c.module, c.requirement_id, c.requirement_index, c.requirement_label,
      c.training_week_id, c.due_on, c.completed_on,
      CASE WHEN c.module = 'training'::public.programme_module_type
        THEN a.available_on
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

REVOKE ALL ON FUNCTION public.canonical_enrollment_requirement_status(uuid, date) FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION public.canonical_enrollment_requirement_status(uuid, date) IS
  'One row per requirement of an enrollment: available_on (Training: week availability; sessions: due_on - 14), '
  'due_on, the counted completed_on and the canonical state (upcoming / completed / completed_late / overdue / '
  'current) as of the effective as-of. Built on the calendar, so it counts exactly what module progress counts. Internal.';

-- ---------------------------------------------------------------------------
-- 9. Checkpoints of one enrollment (shared by both journeys)
-- ---------------------------------------------------------------------------
-- One checkpoint per distinct requirement date D:
--   required_units  = requirements due on or before D
--   completed_units = those that COUNT for the programme (the calendar's
--                     completed rows -- the same rows module progress counts)
--   state           = completed | completed_late when every one counts (late
--                     when a requirement due ON D was fulfilled after D);
--                     otherwise, from the open requirements due by D:
--                     overdue  when D has passed and an open one is available,
--                     upcoming when an open one is not yet available,
--                     current  otherwise.
CREATE OR REPLACE FUNCTION public.canonical_enrollment_checkpoints(
  p_enrollment_id uuid,
  p_as_of date DEFAULT CURRENT_DATE
)
RETURNS TABLE (
  due_on date,
  label text,
  module_scope jsonb,
  required_units integer,
  completed_units integer,
  state text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  WITH requirements AS (
    SELECT * FROM public.canonical_enrollment_requirement_status(p_enrollment_id, p_as_of)
    WHERE due_on IS NOT NULL
  ), dates AS (
    SELECT r.due_on,
      string_agg(DISTINCT tw.title, ' · ' ORDER BY tw.title)
        FILTER (WHERE tw.title IS NOT NULL) AS label,
      to_jsonb(array_agg(DISTINCT r.module::text ORDER BY r.module::text)) AS module_scope
    FROM requirements r
    LEFT JOIN public.training_weeks tw ON tw.id = r.training_week_id
    GROUP BY r.due_on
  ), checkpoints AS (
    SELECT d.due_on, d.label, d.module_scope,
      count(*) FILTER (WHERE r.due_on <= d.due_on)::integer AS required_units,
      count(*) FILTER (WHERE r.due_on <= d.due_on AND r.completed_on IS NOT NULL)::integer AS completed_units,
      coalesce(bool_or(r.state = 'completed_late') FILTER (WHERE r.due_on = d.due_on), false) AS has_late,
      coalesce(bool_or(r.state <> 'upcoming')
        FILTER (WHERE r.due_on <= d.due_on AND r.completed_on IS NULL), false) AS has_available_open,
      coalesce(bool_or(r.state = 'upcoming')
        FILTER (WHERE r.due_on <= d.due_on AND r.completed_on IS NULL), false) AS has_unavailable_open,
      max(r.effective_as_of) AS effective_as_of
    FROM dates d
    CROSS JOIN requirements r
    GROUP BY d.due_on, d.label, d.module_scope
  )
  SELECT c.due_on, c.label, c.module_scope, c.required_units, c.completed_units,
    CASE
      WHEN c.required_units > 0 AND c.completed_units >= c.required_units
        THEN CASE WHEN c.has_late THEN 'completed_late' ELSE 'completed' END
      WHEN c.due_on < c.effective_as_of AND c.has_available_open THEN 'overdue'
      WHEN c.has_unavailable_open THEN 'upcoming'
      ELSE 'current'
    END
  FROM checkpoints c
  ORDER BY c.due_on;
$function$;

REVOKE ALL ON FUNCTION public.canonical_enrollment_checkpoints(uuid, date) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 10. Learner / Admin / Sponsor-leader journey
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.canonical_enrollment_journey(
  p_enrollment_id uuid,
  p_as_of date
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'checkpoint_number', n,
    'due_on', c.due_on,
    'label', c.label,
    'module_scope', c.module_scope,
    'required_units', c.required_units,
    'completed_units', c.completed_units,
    'state', c.state
  ) ORDER BY c.due_on), '[]'::jsonb)
  FROM (
    SELECT row_number() OVER (ORDER BY k.due_on)::integer AS n, k.*
    FROM public.canonical_enrollment_checkpoints(p_enrollment_id, p_as_of) k
  ) c;
$function$;

REVOKE ALL ON FUNCTION public.canonical_enrollment_journey(uuid, date) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 11. Sponsor cohort journey: sums of the same per-enrollment checkpoints
-- ---------------------------------------------------------------------------
-- Every visible enrollment contributes its own canonical checkpoint rows at
-- each cohort date (a date that is not one of its own checkpoints takes its
-- latest earlier cumulative values). The cohort state is completed /
-- completed_late when every leader's is; otherwise overdue if any leader is
-- overdue, else upcoming if any is upcoming, else current.
CREATE OR REPLACE FUNCTION public.get_sponsor_programme_journey(
  p_cohort_id uuid,
  p_as_of date DEFAULT CURRENT_DATE
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  WITH eligible AS (
    SELECT v.enrollment_id AS id
    FROM public.sponsor_visible_enrollments() v
    WHERE v.cohort_id = p_cohort_id
  ), requirements AS (
    SELECT r.*
    FROM eligible e
    CROSS JOIN LATERAL public.canonical_enrollment_requirement_status(e.id, p_as_of) r
    WHERE r.due_on IS NOT NULL
  ), dates AS (
    SELECT r.due_on,
      string_agg(DISTINCT tw.title, ' · ' ORDER BY tw.title)
        FILTER (WHERE tw.title IS NOT NULL) AS label,
      to_jsonb(array_agg(DISTINCT r.module::text ORDER BY r.module::text)) AS module_scope
    FROM requirements r
    LEFT JOIN public.training_weeks tw ON tw.id = r.training_week_id
    GROUP BY r.due_on
  ), leader_checkpoints AS (
    SELECT d.due_on, e.id AS enrollment_id,
      count(r.*) FILTER (WHERE r.due_on <= d.due_on)::integer AS required_units,
      count(r.*) FILTER (WHERE r.due_on <= d.due_on AND r.completed_on IS NOT NULL)::integer AS completed_units,
      coalesce(bool_or(r.state = 'completed_late') FILTER (WHERE r.due_on = d.due_on), false) AS has_late,
      coalesce(bool_or(r.state <> 'upcoming')
        FILTER (WHERE r.due_on <= d.due_on AND r.completed_on IS NULL), false) AS has_available_open,
      coalesce(bool_or(r.state = 'upcoming')
        FILTER (WHERE r.due_on <= d.due_on AND r.completed_on IS NULL), false) AS has_unavailable_open,
      max(r.effective_as_of) AS effective_as_of
    FROM dates d
    CROSS JOIN eligible e
    LEFT JOIN requirements r ON r.enrollment_id = e.id
    GROUP BY d.due_on, e.id
  ), leader_states AS (
    SELECT l.*,
      CASE
        WHEN l.required_units > 0 AND l.completed_units >= l.required_units
          THEN CASE WHEN l.has_late THEN 'completed_late' ELSE 'completed' END
        WHEN l.due_on < l.effective_as_of AND l.has_available_open THEN 'overdue'
        WHEN l.has_unavailable_open THEN 'upcoming'
        ELSE 'current'
      END AS state
    FROM leader_checkpoints l
  ), totals AS (
    SELECT d.due_on, d.label, d.module_scope,
      sum(l.required_units)::integer AS required_units,
      sum(l.completed_units)::integer AS completed_units,
      count(*)::integer AS total_leaders,
      count(*) FILTER (WHERE l.state IN ('completed', 'completed_late'))::integer AS completed_leaders,
      bool_and(l.state IN ('completed', 'completed_late')) AS all_complete,
      bool_or(l.state = 'completed_late') AS any_late,
      bool_or(l.state = 'overdue') AS any_overdue,
      bool_or(l.state = 'upcoming') AS any_upcoming
    FROM dates d
    JOIN leader_states l ON l.due_on = d.due_on
    GROUP BY d.due_on, d.label, d.module_scope
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'checkpoint_number', n,
    'due_on', due_on,
    'label', label,
    'module_scope', module_scope,
    'required_units', required_units,
    'completed_units', completed_units,
    'completed_leaders', completed_leaders,
    'total_leaders', total_leaders,
    'state', CASE
      WHEN all_complete THEN CASE WHEN any_late THEN 'completed_late' ELSE 'completed' END
      WHEN any_overdue THEN 'overdue'
      WHEN any_upcoming THEN 'upcoming'
      ELSE 'current'
    END
  ) ORDER BY due_on), '[]'::jsonb)
  FROM (
    SELECT row_number() OVER (ORDER BY due_on)::integer AS n, t.*
    FROM totals t
  ) numbered;
$function$;

REVOKE ALL ON FUNCTION public.get_sponsor_programme_journey(uuid, date) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 12. Learner Training weeks
-- ---------------------------------------------------------------------------
-- Unchanged from 20260929100000 except that each week's requirement_state is
-- the canonical requirement state (upcoming / current / completed /
-- completed_late / overdue, or not_required).
CREATE OR REPLACE FUNCTION public.get_enrollment_training_weeks(p_enrollment_id uuid)
RETURNS TABLE (
  id uuid, week_number integer, title text, title_vi text, subtitle text, subtitle_vi text,
  unlock_date date, effective_unlock_date date, locked boolean, skill_card_visible boolean,
  viewed_at timestamptz, completed_at timestamptz,
  requirement_id uuid, requirement_due_on date, requirement_state text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
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
    FROM public.canonical_enrollment_requirement_status(p_enrollment_id, CURRENT_DATE) c
    WHERE c.module = 'training'::public.programme_module_type
  ), fulfilment AS (
    SELECT * FROM public.canonical_training_week_fulfilment(p_enrollment_id, CURRENT_DATE)
  )
  SELECT w.id, w.week_number, w.title, w.title_vi, w.subtitle, w.subtitle_vi, w.unlock_date,
    f.available_on,
    coalesce(f.available_on, cwo.unlock_date,
      CASE WHEN w.cohort_id IS NOT NULL
        THEN (w.start_date + ((w.week_number - 1) * interval '7 days'))::date
      END,
      w.unlock_date) > CURRENT_DATE,
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

REVOKE EXECUTE ON FUNCTION public.get_enrollment_training_weeks(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_enrollment_training_weeks(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 13. Child learning evidence counts
-- ---------------------------------------------------------------------------
-- Unchanged from 20260929100000 / 20260928140000 except: frozen at the
-- programme end, and an item due today is due, not overdue.
CREATE OR REPLACE FUNCTION public.learner_training_week_items(
  p_enrollment_id uuid,
  p_as_of date DEFAULT CURRENT_DATE
)
RETURNS TABLE (
  training_week_id uuid,
  item_type text,
  required_units integer,
  completed_units integer,
  due_units integer,
  overdue_units integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  WITH eff AS (
    SELECT coalesce(public.canonical_enrollment_effective_as_of(p_enrollment_id, p_as_of), p_as_of) AS as_of
  ), weeks AS (
    SELECT f.training_week_id
    FROM public.canonical_training_week_fulfilment(p_enrollment_id, (SELECT eff.as_of FROM eff)) f
    JOIN public.programme_enrollments e ON e.id = p_enrollment_id
    WHERE e.user_id = auth.uid()
  ), keys AS (
    SELECT * FROM (VALUES
      ('skill_cards'::text),
      ('quizzes'::text),
      ('reflections'::text),
      ('daily_prompts'::text)
    ) AS x(item_type)
  ), grouped AS (
    SELECT w.training_week_id, k.item_type,
      count(i.item_id)::integer AS required_units,
      count(i.item_id) FILTER (WHERE i.completed)::integer AS completed_units,
      count(i.item_id) FILTER (WHERE i.due_on IS NOT NULL AND i.due_on <= (SELECT eff.as_of FROM eff))::integer AS due_units,
      count(i.item_id) FILTER (
        WHERE i.due_on IS NOT NULL AND i.due_on < (SELECT eff.as_of FROM eff) AND NOT i.completed
      )::integer AS overdue_units
    FROM weeks w
    CROSS JOIN keys k
    LEFT JOIN public.canonical_learning_items(p_enrollment_id, (SELECT eff.as_of FROM eff)) i
      ON i.training_week_id = w.training_week_id
     AND i.item_type = k.item_type
    GROUP BY w.training_week_id, k.item_type
  )
  SELECT * FROM grouped
  ORDER BY training_week_id,
    CASE item_type
      WHEN 'skill_cards' THEN 1
      WHEN 'quizzes' THEN 2
      WHEN 'reflections' THEN 3
      ELSE 4
    END;
$function$;

REVOKE ALL ON FUNCTION public.learner_training_week_items(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.learner_training_week_items(uuid, date) TO authenticated;

CREATE OR REPLACE FUNCTION public.canonical_learning_breakdown(p_enrollment_id uuid, p_as_of date DEFAULT CURRENT_DATE)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  WITH eff AS (
    SELECT coalesce(public.canonical_enrollment_effective_as_of(p_enrollment_id, p_as_of), p_as_of) AS as_of
  ), keys AS (
    SELECT * FROM (VALUES
      ('skill_cards'::text, 'Skill Cards'::text, 1),
      ('quizzes'::text, 'Quizzes'::text, 2),
      ('reflections'::text, 'Reflections'::text, 3),
      ('daily_prompts'::text, 'Daily Prompts'::text, 4)
    ) AS x(item_type, label, ord)
  ), grouped AS (
    SELECT k.item_type, k.label, k.ord,
      count(i.item_id)::integer AS required_units,
      count(i.item_id) FILTER (WHERE i.due_on IS NOT NULL AND i.due_on <= (SELECT eff.as_of FROM eff))::integer AS due_units,
      count(i.item_id) FILTER (WHERE i.completed AND i.due_on IS NOT NULL AND i.due_on <= (SELECT eff.as_of FROM eff))::integer AS completed_due_units,
      count(i.item_id) FILTER (WHERE i.completed)::integer AS completed_units,
      count(i.item_id) FILTER (WHERE NOT i.completed AND i.due_on IS NOT NULL AND i.due_on < (SELECT eff.as_of FROM eff))::integer AS overdue_units
    FROM keys k
    LEFT JOIN public.canonical_learning_items(p_enrollment_id, (SELECT eff.as_of FROM eff)) i ON i.item_type = k.item_type
    GROUP BY k.item_type, k.label, k.ord
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'key', g.item_type,
    'label', g.label,
    'required_units', g.required_units,
    'due_units', g.due_units,
    'completed_units', least(g.completed_units, g.required_units),
    'overdue_units', g.overdue_units,
    'progress_available', g.required_units > 0,
    'status', CASE
      WHEN g.required_units = 0 THEN 'unavailable'
      WHEN g.completed_units >= g.required_units THEN 'completed'
      WHEN g.due_units = 0 THEN 'upcoming'
      WHEN g.overdue_units > 0 THEN 'overdue'
      ELSE 'current'
    END
  ) ORDER BY g.ord), '[]'::jsonb)
  FROM grouped g;
$function$;

REVOKE ALL ON FUNCTION public.canonical_learning_breakdown(uuid, date) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 14. Diagnostic: activity the engine refuses programme credit for
-- ---------------------------------------------------------------------------
-- Admin-readable. Lists completed activity dated before its requirement's
-- availability date or after the programme end. Such activity stays in the
-- session / evidence tables as history; it simply earns no programme credit.
CREATE OR REPLACE FUNCTION public.admin_ineligible_programme_activity()
RETURNS TABLE (
  enrollment_id uuid,
  module public.programme_module_type,
  requirement_id uuid,
  requirement_index integer,
  training_week_id uuid,
  available_on date,
  due_on date,
  programme_end_date date,
  activity_on date,
  reason text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Only an admin can read the ineligible-activity diagnostic' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH enrollments AS (
    SELECT e.id, coalesce(e.end_date, c.end_date) AS end_on
    FROM public.programme_enrollments e
    LEFT JOIN public.cohorts c ON c.id = e.cohort_id
  ), sessions AS (
    SELECT en.id AS enrollment_id, 'coaching'::public.programme_module_type AS module,
      f.requirement_id, f.ordinal, NULL::uuid AS training_week_id, f.due_on, f.fulfilled_on, en.end_on
    FROM enrollments en CROSS JOIN LATERAL public.canonical_coaching_requirement_fulfilment(en.id) f
    WHERE f.fulfilled_on IS NOT NULL
    UNION ALL
    SELECT en.id, 'mentoring', f.requirement_id, f.ordinal, NULL, f.due_on, f.fulfilled_on, en.end_on
    FROM enrollments en CROSS JOIN LATERAL public.canonical_mentoring_requirement_fulfilment(en.id) f
    WHERE f.fulfilled_on IS NOT NULL
    UNION ALL
    SELECT en.id, 'peer_coaching', f.requirement_id, f.ordinal, NULL, f.due_on, f.fulfilled_on, en.end_on
    FROM enrollments en CROSS JOIN LATERAL public.canonical_peer_requirement_fulfilment(en.id) f
    WHERE f.fulfilled_on IS NOT NULL
    UNION ALL
    -- Triads: every completed session of the requirement's group (raw evidence).
    SELECT en.id, 'triads', d.id, d.ordinal, NULL, d.due_on, a.occurred_on, en.end_on
    FROM enrollments en
    JOIN public.triad_group_members m ON m.enrollment_id = en.id
    JOIN public.triad_groups g ON g.id = m.triad_group_id
    JOIN public.cohort_requirement_dates d ON d.id = g.cohort_requirement_date_id
    JOIN public.triad_sessions s ON s.triad_group_id = g.id AND s.status = 'completed'
    JOIN public.session_activity_attributions a
      ON a.source_activity_type = 'triad' AND a.source_activity_id = s.id AND a.enrollment_id = en.id
  ), training AS (
    -- Every piece of mandatory Training evidence, against its week's window.
    SELECT en.id AS enrollment_id, f.training_week_id, f.week_number, f.available_on, f.due_on, en.end_on,
      x.activity_on
    FROM enrollments en
    CROSS JOIN LATERAL public.canonical_training_week_fulfilment(en.id, current_date) f
    CROSS JOIN LATERAL (
      SELECT tp.completed_at::date AS activity_on
      FROM public.training_progress tp
      WHERE tp.enrollment_id = en.id AND tp.training_week_id = f.training_week_id AND tp.completed_at IS NOT NULL
      UNION ALL
      SELECT sub.submitted_at::date
      FROM public.assignments a
      JOIN public.assignment_submissions sub ON sub.assignment_id = a.id AND sub.enrollment_id = en.id
      WHERE a.training_week_id = f.training_week_id AND a.assignment_type = 'quiz' AND a.is_visible
        AND sub.submitted_at IS NOT NULL
      UNION ALL
      SELECT rs.submitted_at::date
      FROM public.programme_enrollments pe
      JOIN public.programme_reflections pr ON pr.programme_id = pe.programme_id AND pr.appears_at_week = f.week_number AND pr.is_visible
      JOIN public.reflection_submissions rs ON rs.reflection_id = pr.id AND rs.enrollment_id = en.id
      WHERE pe.id = en.id AND rs.submitted_at IS NOT NULL
    ) x
  )
  SELECT s.enrollment_id, s.module, s.requirement_id, s.ordinal, s.training_week_id,
    public.canonical_session_requirement_available_on(s.due_on), s.due_on, s.end_on, s.fulfilled_on,
    CASE WHEN s.fulfilled_on < public.canonical_session_requirement_available_on(s.due_on)
      THEN 'completed_before_available' ELSE 'completed_after_programme_end' END
  FROM sessions s
  WHERE s.fulfilled_on < public.canonical_session_requirement_available_on(s.due_on)
     OR (s.end_on IS NOT NULL AND s.fulfilled_on > s.end_on)
  UNION ALL
  SELECT t.enrollment_id, 'training'::public.programme_module_type, NULL::uuid, t.week_number, t.training_week_id,
    t.available_on, t.due_on, t.end_on, t.activity_on,
    CASE WHEN t.available_on IS NULL OR t.activity_on < t.available_on
      THEN 'completed_before_available' ELSE 'completed_after_programme_end' END
  FROM training t
  WHERE t.available_on IS NULL OR t.activity_on < t.available_on
     OR (t.end_on IS NOT NULL AND t.activity_on > t.end_on)
  ORDER BY 1, 2, 4, 9;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_ineligible_programme_activity() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_ineligible_programme_activity() TO authenticated;
COMMENT ON FUNCTION public.admin_ineligible_programme_activity() IS
  'Admin diagnostic: completed activity dated before its requirement''s availability date (Training week availability; '
  'sessions due_on - 14) or after the programme end. The canonical engine gives it no programme credit.';

-- ---------------------------------------------------------------------------
-- 15. Follow-up actions: two defects in 20260929100000
-- ---------------------------------------------------------------------------
-- (a) The goal-ownership check ran for historical rows that legitimately have
--     no goal, so an existing action (e.g. the one production row, created
--     before the rule) could never be updated or marked complete. New actions
--     still require a goal and due date (the check above it); a goal, when
--     present, must still belong to the action's enrollment.
-- (b) enrollment_activity_participants returned the Triad member's ENROLLMENT
--     id as learner_id, which validate_enrollment_action compares with the
--     action owner's USER id, so no Triad action could ever be saved. It now
--     returns the member's user id, like every other branch.
-- (c) 20260929100000 also dropped two things from earlier definitions:
--     enrollment_activity_participants lost the PROVIDING side of a Peer
--     session (20260925500000), so the provider could never record an action
--     on their own enrollment; and save_enrollment_activity_actions lost its
--     input validation and per-source lock (20260910172000), so an unknown
--     field was silently accepted and the rest of the set deleted. Both are
--     restored below, on top of the goal / due-date rule.
-- (d) Every NEW action is a post-session follow-up: it must name its source
--     activity (type + id), a goal of the same enrollment and a due date.
--     Historical rows keep whatever they had; nothing is fabricated for them
--     (admin_action_integrity_issues reports them).
CREATE OR REPLACE FUNCTION public.validate_enrollment_action()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  milestone public.coachee_milestones;
BEGIN
  IF TG_OP = 'UPDATE' AND (
    new.enrollment_id IS DISTINCT FROM old.enrollment_id
    OR new.owner_user_id IS DISTINCT FROM old.owner_user_id
    OR new.source_activity_type IS DISTINCT FROM old.source_activity_type
    OR new.source_activity_id IS DISTINCT FROM old.source_activity_id
  ) THEN
    RAISE EXCEPTION 'Action enrollment, owner and source cannot be changed' USING ERRCODE = '42501';
  END IF;

  PERFORM public.assert_enrollment_scope(new.enrollment_id, new.owner_user_id);

  -- Historical rows remain editable without invented metadata. Every insert,
  -- and every update of a row that already has metadata, must be complete.
  IF TG_OP = 'INSERT'
     OR old.goal_id IS NOT NULL
     OR old.due_date IS NOT NULL
     OR new.goal_id IS NOT NULL
     OR new.due_date IS NOT NULL THEN
    IF new.goal_id IS NULL OR new.due_date IS NULL THEN
      RAISE EXCEPTION 'New post-session actions require a goal and due date' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF TG_OP = 'INSERT' AND (new.source_activity_type IS NULL OR new.source_activity_id IS NULL) THEN
    RAISE EXCEPTION 'New post-session actions require their source activity' USING ERRCODE = '23514';
  END IF;

  IF new.goal_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.coachee_goals g
    WHERE g.id = new.goal_id AND g.enrollment_id = new.enrollment_id
  ) THEN
    RAISE EXCEPTION 'Action goal must belong to the action enrollment' USING ERRCODE = '42501';
  END IF;

  IF new.milestone_id IS NOT NULL THEN
    SELECT * INTO milestone
    FROM public.coachee_milestones
    WHERE id = new.milestone_id AND enrollment_id = new.enrollment_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Action milestone must belong to the action enrollment' USING ERRCODE = '42501';
    END IF;
    IF milestone.goal_id IS DISTINCT FROM new.goal_id THEN
      RAISE EXCEPTION 'Action milestone must belong to the action goal' USING ERRCODE = '42501';
    END IF;
  END IF;

  IF (new.source_activity_type IS NULL) <> (new.source_activity_id IS NULL) THEN
    RAISE EXCEPTION 'Action source activity type and ID must be provided together' USING ERRCODE = 'P0001';
  END IF;
  IF new.source_activity_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.enrollment_activity_participants(
      new.enrollment_id, new.source_activity_type, new.source_activity_id
    ) a
    WHERE a.learner_id = new.owner_user_id
  ) THEN
    RAISE EXCEPTION 'Action source must belong to the action enrollment' USING ERRCODE = '42501';
  END IF;
  IF nullif(btrim(new.title), '') IS NULL THEN
    RAISE EXCEPTION 'Action title is required' USING ERRCODE = 'P0001';
  END IF;
  RETURN new;
END
$function$;

CREATE OR REPLACE FUNCTION public.enrollment_activity_participants(
  p_enrollment_id uuid,
  p_source_activity_type text,
  p_source_activity_id uuid
)
RETURNS TABLE(learner_id uuid, provider_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT s.coachee_id, s.coach_id
  FROM public.sessions s
  WHERE p_source_activity_type = 'coaching' AND s.id = p_source_activity_id
    AND s.enrollment_id = p_enrollment_id
  UNION ALL
  SELECT s.peer_coachee_id, s.peer_coach_id
  FROM public.peer_sessions s
  WHERE p_source_activity_type = 'peer_coaching' AND s.id = p_source_activity_id
    AND s.enrollment_id = p_enrollment_id
  UNION ALL
  SELECT s.peer_receiver_id, s.peer_provider_id
  FROM public.coachee_peer_sessions s
  WHERE p_source_activity_type = 'coachee_peer_coaching' AND s.id = p_source_activity_id
    AND s.enrollment_id = p_enrollment_id
  UNION ALL
  SELECT s.mentee_id, s.mentor_id
  FROM public.mentoring_sessions s
  WHERE p_source_activity_type = 'mentoring' AND s.id = p_source_activity_id
    AND s.enrollment_id = p_enrollment_id
  UNION ALL
  -- The PROVIDING side of a Peer session, on the provider's own enrollment
  -- (peer_session_participants records whose participation a session half
  -- is). learner = the provider, counterpart = the receiver.
  SELECT s.peer_coach_id, s.peer_coachee_id
  FROM public.peer_sessions s
  JOIN public.peer_session_participants p
    ON p.session_kind = 'peer' AND p.peer_session_id = s.id
   AND p.participant_role = 'provider' AND p.enrollment_id = p_enrollment_id
   AND p.user_id = s.peer_coach_id
  WHERE p_source_activity_type = 'peer_coaching' AND s.id = p_source_activity_id
  UNION ALL
  SELECT s.peer_provider_id, s.peer_receiver_id
  FROM public.coachee_peer_sessions s
  JOIN public.peer_session_participants p
    ON p.session_kind = 'coachee_peer' AND p.peer_session_id = s.id
   AND p.participant_role = 'provider' AND p.enrollment_id = p_enrollment_id
   AND p.user_id = s.peer_provider_id
  WHERE p_source_activity_type = 'coachee_peer_coaching' AND s.id = p_source_activity_id
  UNION ALL
  SELECT pe.user_id, NULL::uuid
  FROM public.triad_sessions s
  JOIN public.triad_group_members m ON m.triad_group_id = s.triad_group_id
  JOIN public.programme_enrollments pe ON pe.id = m.enrollment_id
  WHERE p_source_activity_type = 'triad' AND s.id = p_source_activity_id
    AND m.enrollment_id = p_enrollment_id
$function$;

REVOKE ALL ON FUNCTION public.enrollment_activity_participants(uuid, text, uuid) FROM PUBLIC, anon, authenticated;

-- The one writer of new actions. Input validation and the per-source lock of
-- 20260910172000, plus the goal / due-date rule of 20260929100000.
CREATE OR REPLACE FUNCTION public.save_enrollment_activity_actions(
  p_enrollment_id uuid,
  p_source_activity_type text,
  p_source_activity_id uuid,
  p_actions jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  uuid_pattern constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  item jsonb;
  action_id uuid;
  saved_ids uuid[] := '{}';
  learner uuid;
  affected integer;
  action_goal uuid;
  action_milestone uuid;
  action_due date;
  action_status text;
  action_description text;
  existing_action public.enrollment_actions;
BEGIN
  IF NOT public.can_manage_enrollment_activity(
    p_enrollment_id, p_source_activity_type, p_source_activity_id
  ) THEN
    RAISE EXCEPTION 'Not authorized to manage this activity' USING ERRCODE = '42501';
  END IF;
  IF p_actions IS NULL OR jsonb_typeof(p_actions) <> 'array' THEN
    RAISE EXCEPTION 'Actions must be an array' USING ERRCODE = 'P0001';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(
    p_enrollment_id::text || ':' || p_source_activity_type || ':' || p_source_activity_id::text, 0));

  SELECT user_id INTO learner
  FROM public.programme_enrollments
  WHERE id = p_enrollment_id;

  FOR item IN SELECT value FROM jsonb_array_elements(p_actions) LOOP
    IF jsonb_typeof(item) <> 'object' THEN
      RAISE EXCEPTION 'Action must be an object' USING ERRCODE = 'P0001';
    END IF;
    IF EXISTS (SELECT 1 FROM jsonb_object_keys(item) k
               WHERE k NOT IN ('id', 'title', 'description', 'status', 'due_date', 'goal_id', 'milestone_id')) THEN
      RAISE EXCEPTION 'Unknown action field' USING ERRCODE = 'P0001';
    END IF;
    IF jsonb_typeof(item->'title') IS DISTINCT FROM 'string'
       OR nullif(btrim(item->>'title'), '') IS NULL
       OR length(item->>'title') > 500 THEN
      RAISE EXCEPTION 'Action title is invalid' USING ERRCODE = 'P0001';
    END IF;
    IF item ? 'description' AND jsonb_typeof(item->'description') <> 'null'
       AND (jsonb_typeof(item->'description') <> 'string' OR length(item->>'description') > 2000) THEN
      RAISE EXCEPTION 'Action description is invalid' USING ERRCODE = 'P0001';
    END IF;
    IF item ? 'status' AND jsonb_typeof(item->'status') <> 'null'
       AND (jsonb_typeof(item->'status') <> 'string'
            OR item->>'status' NOT IN ('open', 'in_progress', 'completed', 'cancelled')) THEN
      RAISE EXCEPTION 'Action status is invalid' USING ERRCODE = 'P0001';
    END IF;
    IF item ? 'id' AND jsonb_typeof(item->'id') <> 'null'
       AND (jsonb_typeof(item->'id') <> 'string' OR item->>'id' !~* uuid_pattern) THEN
      RAISE EXCEPTION 'Action ID is invalid' USING ERRCODE = 'P0001';
    END IF;
    IF item ? 'goal_id' AND jsonb_typeof(item->'goal_id') <> 'null'
       AND (jsonb_typeof(item->'goal_id') <> 'string' OR item->>'goal_id' !~* uuid_pattern) THEN
      RAISE EXCEPTION 'Action goal ID is invalid' USING ERRCODE = 'P0001';
    END IF;
    IF item ? 'milestone_id' AND jsonb_typeof(item->'milestone_id') <> 'null'
       AND (jsonb_typeof(item->'milestone_id') <> 'string' OR item->>'milestone_id' !~* uuid_pattern) THEN
      RAISE EXCEPTION 'Action milestone ID is invalid' USING ERRCODE = 'P0001';
    END IF;
    BEGIN
      action_id := coalesce(nullif(item->>'id', '')::uuid, gen_random_uuid());
      action_goal := nullif(item->>'goal_id', '')::uuid;
      action_milestone := nullif(item->>'milestone_id', '')::uuid;
      action_due := nullif(item->>'due_date', '')::date;
    EXCEPTION WHEN invalid_text_representation OR datetime_field_overflow THEN
      RAISE EXCEPTION 'Action UUID or date is invalid' USING ERRCODE = 'P0001';
    END;
    IF action_id = ANY(saved_ids) THEN
      RAISE EXCEPTION 'Duplicate action ID' USING ERRCODE = 'P0001';
    END IF;

    existing_action := NULL;
    SELECT * INTO existing_action FROM public.enrollment_actions WHERE id = action_id;
    IF existing_action.id IS NOT NULL AND (
         existing_action.enrollment_id IS DISTINCT FROM p_enrollment_id
      OR existing_action.source_activity_type IS DISTINCT FROM p_source_activity_type
      OR existing_action.source_activity_id IS DISTINCT FROM p_source_activity_id) THEN
      RAISE EXCEPTION 'Action ID belongs to another source or enrollment' USING ERRCODE = '42501';
    END IF;
    -- New actions, and existing ones that already carry metadata, need both.
    -- A historical row without them stays editable (validate_enrollment_action).
    IF existing_action.id IS NULL
       OR existing_action.goal_id IS NOT NULL
       OR existing_action.due_date IS NOT NULL THEN
      IF action_goal IS NULL OR action_due IS NULL THEN
        RAISE EXCEPTION 'New post-session actions require a goal and due date' USING ERRCODE = '23514';
      END IF;
    END IF;
    action_status := coalesce(nullif(item->>'status', ''), 'open');
    action_description := nullif(item->>'description', '');

    INSERT INTO public.enrollment_actions(
      id, enrollment_id, owner_user_id, source_activity_type, source_activity_id,
      title, description, status, due_date, goal_id, milestone_id, completed_at
    )
    VALUES (
      action_id, p_enrollment_id, learner, p_source_activity_type, p_source_activity_id,
      btrim(item->>'title'), action_description, action_status, action_due,
      action_goal, action_milestone,
      CASE WHEN action_status = 'completed' THEN now() END
    )
    ON CONFLICT (id) DO UPDATE SET
      title = excluded.title,
      description = excluded.description,
      status = excluded.status,
      due_date = excluded.due_date,
      goal_id = excluded.goal_id,
      milestone_id = excluded.milestone_id,
      completed_at = CASE
        WHEN excluded.status = 'completed'
          THEN coalesce(enrollment_actions.completed_at, excluded.completed_at)
        ELSE NULL
      END
    WHERE enrollment_actions.enrollment_id = p_enrollment_id
      AND enrollment_actions.source_activity_type = p_source_activity_type
      AND enrollment_actions.source_activity_id = p_source_activity_id;
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected = 0 THEN
      RAISE EXCEPTION 'Action ID belongs to another source or enrollment' USING ERRCODE = '42501';
    END IF;
    saved_ids := array_append(saved_ids, action_id);
  END LOOP;

  DELETE FROM public.enrollment_actions
  WHERE enrollment_id = p_enrollment_id
    AND source_activity_type = p_source_activity_type
    AND source_activity_id = p_source_activity_id
    AND NOT (id = ANY(saved_ids));
END
$function$;

REVOKE ALL ON FUNCTION public.save_enrollment_activity_actions(uuid, text, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_enrollment_activity_actions(uuid, text, uuid, jsonb) TO authenticated;

-- Diagnostic: actions that do not meet the post-session contract. Historical
-- rows are reported, never repaired with invented goals or dates.
CREATE OR REPLACE FUNCTION public.admin_action_integrity_issues()
RETURNS TABLE (
  action_id uuid,
  enrollment_id uuid,
  source_activity_type text,
  source_activity_id uuid,
  issue text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role)
     AND coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role'
     AND current_user NOT IN ('postgres', 'supabase_admin') THEN
    RAISE EXCEPTION 'Only Admin may read action diagnostics' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT a.id, a.enrollment_id, a.source_activity_type, a.source_activity_id, x.issue
  FROM public.enrollment_actions a
  CROSS JOIN LATERAL (
    SELECT 'missing_goal'::text AS issue WHERE a.goal_id IS NULL
    UNION ALL SELECT 'missing_due_date' WHERE a.due_date IS NULL
    UNION ALL SELECT 'missing_source' WHERE a.source_activity_id IS NULL OR a.source_activity_type IS NULL
    UNION ALL SELECT 'goal_other_enrollment'
      WHERE a.goal_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.coachee_goals g WHERE g.id = a.goal_id AND g.enrollment_id = a.enrollment_id)
    UNION ALL SELECT 'source_other_enrollment'
      WHERE a.source_activity_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.enrollment_activity_participants(a.enrollment_id, a.source_activity_type, a.source_activity_id) p
        WHERE p.learner_id = a.owner_user_id)
  ) x
  ORDER BY a.created_at, a.id, x.issue;
END
$function$;

REVOKE ALL ON FUNCTION public.admin_action_integrity_issues() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_action_integrity_issues() TO authenticated;
