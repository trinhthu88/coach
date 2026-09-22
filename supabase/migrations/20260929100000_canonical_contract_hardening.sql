-- ============================================================================
-- Canonical contract hardening
--
-- This migration keeps historical rows readable while making all new/current
-- projections obey the product contract:
--   * a Training unit is a week, fulfilled by Skill Card + Quiz + Reflection;
--   * Daily Prompts remain optional evidence;
--   * unavailable Training weeks cannot be completed early;
--   * learner Peer practice uses Admin-assigned enrollment dyads;
--   * new post-session actions require a goal and due date;
--   * Sponsor leader access is enrollment-organisation scoped.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Training week fulfilment: one canonical projection for every role
-- ---------------------------------------------------------------------------
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
  WITH enrollment AS (
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
          AND sub.submitted_at::date <= p_as_of
      )::integer AS completed,
      max(sub.submitted_at) FILTER (
        WHERE sub.submitted_at IS NOT NULL
          AND sub.submitted_at::date <= p_as_of
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
          AND rs.submitted_at::date <= p_as_of
      )::integer AS completed,
      max(rs.submitted_at) FILTER (
        WHERE rs.submitted_at IS NOT NULL
          AND rs.submitted_at::date <= p_as_of
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
          AND dpr.responded_at::date <= p_as_of
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
        AND tp.completed_at::date <= p_as_of
        AND s.available_on IS NOT NULL
        AND s.available_on <= p_as_of AS skill_card_completed,
      tp.completed_at AS skill_card_completed_at,
      (s.components ? 'quizzes') AND coalesce(q.total, 0) > 0 AS quiz_required,
      (s.components ? 'quizzes')
        AND coalesce(q.total, 0) > 0
        AND coalesce(q.completed, 0) >= q.total
        AND s.available_on IS NOT NULL
        AND s.available_on <= p_as_of AS quiz_completed,
      q.completed_at AS quiz_completed_at,
      (s.components ? 'reflections') AND coalesce(r.total, 0) > 0 AS reflection_required,
      (s.components ? 'reflections')
        AND coalesce(r.total, 0) > 0
        AND coalesce(r.completed, 0) >= r.total
        AND s.available_on IS NOT NULL
        AND s.available_on <= p_as_of AS reflection_completed,
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
  'Canonical Training week projection. Skill Card, Quiz and Reflection fulfil '
  'the parent week; Daily Prompts are optional child evidence and never gate it.';

-- The parent Training item projection now emits one row per required week, with
-- completion derived from the complete week projection rather than the
-- Skill-Card timestamp alone.
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

-- Item-level child evidence remains the same four-row source, but Skill Card
-- completion is read from the week projection and all child completions require
-- the week to have unlocked as of p_as_of.
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
  WITH weeks AS (
    SELECT * FROM public.canonical_training_week_fulfilment(p_enrollment_id, p_as_of)
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
      AND w.available_on <= p_as_of
      AND EXISTS (
        SELECT 1
        FROM public.daily_prompt_responses dpr
        WHERE dpr.enrollment_id = p_enrollment_id
          AND dpr.daily_prompt_id = dp.id
          AND dpr.responded_at::date <= p_as_of
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

-- Always expose the four configured child categories per week, including a
-- zero row. Sponsor and Learner both consume this same projection.
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
  WITH weeks AS (
    SELECT f.training_week_id
    FROM public.canonical_training_week_fulfilment(p_enrollment_id, p_as_of) f
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
      count(i.item_id) FILTER (WHERE i.due_on IS NOT NULL AND i.due_on <= p_as_of)::integer AS due_units,
      count(i.item_id) FILTER (
        WHERE i.due_on IS NOT NULL AND i.due_on <= p_as_of AND NOT i.completed
      )::integer AS overdue_units
    FROM weeks w
    CROSS JOIN keys k
    LEFT JOIN public.canonical_learning_items(p_enrollment_id, p_as_of) i
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

-- ---------------------------------------------------------------------------
-- 2. Journey state: unavailable future requirements stay upcoming
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
  WITH calendar AS (
    SELECT * FROM public.canonical_enrollment_requirement_calendar(p_enrollment_id, p_as_of)
  ), training_availability AS (
    SELECT f.training_week_id, f.available_on
    FROM public.canonical_training_week_fulfilment(p_enrollment_id, p_as_of) f
  ), dates AS (
    SELECT c.due_on,
      string_agg(DISTINCT tw.title, ' · ' ORDER BY tw.title)
        FILTER (WHERE tw.title IS NOT NULL) AS label,
      to_jsonb(array_agg(DISTINCT c.module::text ORDER BY c.module::text)) AS module_scope
    FROM calendar c
    LEFT JOIN public.training_weeks tw ON tw.id = c.training_week_id
    WHERE c.due_on IS NOT NULL
    GROUP BY c.due_on
  ), checkpoints AS (
    SELECT d.due_on, d.label, d.module_scope,
      count(*) FILTER (WHERE c.due_on <= d.due_on)::integer AS required_units,
      count(*) FILTER (WHERE c.due_on <= d.due_on AND c.completed_on IS NOT NULL AND c.completed_on <= least(d.due_on, p_as_of))::integer AS completed_units,
      bool_or(
        c.due_on > p_as_of
        AND (
          (c.module = 'training'::public.programme_module_type
           AND coalesce(ta.available_on, c.due_on) > p_as_of)
          OR c.module <> 'training'::public.programme_module_type
        )
      ) AS has_unavailable_future
    FROM dates d
    CROSS JOIN calendar c
    LEFT JOIN training_availability ta ON ta.training_week_id = c.training_week_id
    GROUP BY d.due_on, d.label, d.module_scope
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'checkpoint_number', row_number,
    'due_on', due_on,
    'label', label,
    'module_scope', module_scope,
    'required_units', required_units,
    'completed_units', completed_units,
    'state', CASE
      WHEN has_unavailable_future THEN 'upcoming'
      WHEN required_units > 0 AND completed_units >= required_units THEN 'completed'
      WHEN p_as_of < due_on THEN 'upcoming'
      WHEN p_as_of = due_on THEN 'current'
      ELSE 'overdue'
    END
  ) ORDER BY due_on), '[]'::jsonb)
  FROM (
    SELECT row_number() OVER (ORDER BY due_on)::integer AS row_number, c.*
    FROM checkpoints c
  ) numbered;
$function$;

-- The Sponsor cohort journey must use the same per-enrollment calendars and
-- the same availability-aware checkpoint state.
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
  ), calendar AS (
    SELECT c.*
    FROM eligible e
    CROSS JOIN LATERAL public.canonical_enrollment_requirement_calendar(e.id, p_as_of) c
  ), training_availability AS (
    SELECT e.id AS enrollment_id, f.training_week_id, f.available_on
    FROM eligible e
    CROSS JOIN LATERAL public.canonical_training_week_fulfilment(e.id, p_as_of) f
  ), dates AS (
    SELECT c.due_on,
      string_agg(DISTINCT tw.title, ' · ' ORDER BY tw.title)
        FILTER (WHERE tw.title IS NOT NULL) AS label,
      to_jsonb(array_agg(DISTINCT c.module::text ORDER BY c.module::text)) AS module_scope
    FROM calendar c
    LEFT JOIN public.training_weeks tw ON tw.id = c.training_week_id
    WHERE c.due_on IS NOT NULL
    GROUP BY c.due_on
  ), leader_checkpoints AS (
    SELECT d.due_on, e.id AS enrollment_id,
      count(c.*) FILTER (WHERE c.due_on <= d.due_on)::integer AS required_units,
      count(c.*) FILTER (WHERE c.due_on <= d.due_on AND c.completed_on IS NOT NULL AND c.completed_on <= least(d.due_on, p_as_of))::integer AS completed_units,
      bool_or(
        c.due_on > p_as_of
        AND (
          (c.module = 'training'::public.programme_module_type
           AND coalesce(ta.available_on, c.due_on) > p_as_of)
          OR c.module <> 'training'::public.programme_module_type
        )
      ) AS has_unavailable_future
    FROM dates d
    CROSS JOIN eligible e
    LEFT JOIN calendar c ON c.enrollment_id = e.id
    LEFT JOIN training_availability ta
      ON ta.enrollment_id = e.id
     AND ta.training_week_id = c.training_week_id
    GROUP BY d.due_on, e.id
  ), totals AS (
    SELECT d.due_on, d.label, d.module_scope,
      sum(l.required_units)::integer AS required_units,
      sum(l.completed_units)::integer AS completed_units,
      count(*)::integer AS total_leaders,
      count(*) FILTER (
        WHERE l.required_units > 0
          AND l.completed_units >= l.required_units
          AND NOT l.has_unavailable_future
      )::integer AS completed_leaders,
      bool_or(l.has_unavailable_future) AS has_unavailable_future
    FROM dates d
    JOIN leader_checkpoints l ON l.due_on = d.due_on
    GROUP BY d.due_on, d.label, d.module_scope
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'checkpoint_number', row_number,
    'due_on', due_on,
    'label', label,
    'module_scope', module_scope,
    'required_units', required_units,
    'completed_units', completed_units,
    'completed_leaders', completed_leaders,
    'total_leaders', total_leaders,
    'state', CASE
      WHEN has_unavailable_future THEN 'upcoming'
      WHEN required_units > 0 AND completed_units >= required_units THEN 'completed'
      WHEN p_as_of < due_on THEN 'upcoming'
      WHEN p_as_of = due_on THEN 'current'
      ELSE 'overdue'
    END
  ) ORDER BY due_on), '[]'::jsonb)
  FROM (
    SELECT row_number() OVER (ORDER BY due_on)::integer AS row_number, t.*
    FROM totals t
  ) numbered;
$function$;

-- ---------------------------------------------------------------------------
-- 3. New post-session action integrity
-- ---------------------------------------------------------------------------
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

  IF NOT EXISTS (
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
  item jsonb;
  action_id uuid;
  saved_ids uuid[] := '{}';
  learner uuid;
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

  SELECT user_id INTO learner
  FROM public.programme_enrollments
  WHERE id = p_enrollment_id;

  FOR item IN SELECT value FROM jsonb_array_elements(p_actions) LOOP
    IF jsonb_typeof(item) <> 'object' THEN
      RAISE EXCEPTION 'Action must be an object' USING ERRCODE = 'P0001';
    END IF;
    IF jsonb_typeof(item->'title') <> 'string'
       OR nullif(btrim(item->>'title'), '') IS NULL
       OR length(item->>'title') > 500 THEN
      RAISE EXCEPTION 'Action title is invalid' USING ERRCODE = 'P0001';
    END IF;
    BEGIN
      action_id := coalesce(nullif(item->>'id', '')::uuid, gen_random_uuid());
      action_goal := nullif(item->>'goal_id', '')::uuid;
      action_milestone := nullif(item->>'milestone_id', '')::uuid;
      action_due := nullif(item->>'due_date', '')::date;
    EXCEPTION WHEN invalid_text_representation OR datetime_field_overflow THEN
      RAISE EXCEPTION 'Action UUID or date is invalid' USING ERRCODE = 'P0001';
    END;
    SELECT * INTO existing_action
    FROM public.enrollment_actions
    WHERE id = action_id;
    IF existing_action.id IS NULL
       OR existing_action.goal_id IS NOT NULL
       OR existing_action.due_date IS NOT NULL THEN
      IF action_goal IS NULL OR action_due IS NULL THEN
        RAISE EXCEPTION 'New post-session actions require a goal and due date' USING ERRCODE = '23514';
      END IF;
    END IF;
    action_status := coalesce(nullif(item->>'status', ''), 'open');
    action_description := nullif(item->>'description', '');

    IF action_id = ANY(saved_ids) THEN
      RAISE EXCEPTION 'Duplicate action ID' USING ERRCODE = 'P0001';
    END IF;

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
    IF NOT FOUND THEN
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

-- ---------------------------------------------------------------------------
-- 4. Fixed learner Peer dyads
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.peer_dyads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cohort_id uuid NOT NULL REFERENCES public.cohorts(id) ON DELETE RESTRICT,
  programme_id uuid NOT NULL REFERENCES public.programmes(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'closed')),
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.peer_dyad_members (
  dyad_id uuid NOT NULL REFERENCES public.peer_dyads(id) ON DELETE CASCADE,
  enrollment_id uuid NOT NULL REFERENCES public.programme_enrollments(id) ON DELETE RESTRICT,
  joined_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'ended')),
  PRIMARY KEY (dyad_id, enrollment_id)
);

-- The pair uniqueness is enforced by the validation trigger below; PostgreSQL
-- cannot express a two-row active-membership cardinality with a normal index.
CREATE INDEX IF NOT EXISTS peer_dyad_members_active_idx
  ON public.peer_dyad_members(dyad_id, status, ended_at);

ALTER TABLE public.peer_dyads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.peer_dyad_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Peer dyads: admin manage" ON public.peer_dyads;
CREATE POLICY "Peer dyads: admin manage" ON public.peer_dyads
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "Peer dyad members: admin manage" ON public.peer_dyad_members;
CREATE POLICY "Peer dyad members: admin manage" ON public.peer_dyad_members
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE OR REPLACE FUNCTION public.validate_peer_dyad()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  d public.peer_dyads;
  active_count integer;
  other record;
  member_count integer;
BEGIN
  SELECT * INTO d FROM public.peer_dyads WHERE id = new.dyad_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Peer dyad does not exist' USING ERRCODE = '23503';
  END IF;
  SELECT count(*) INTO member_count
  FROM public.peer_dyad_members
  WHERE dyad_id = new.dyad_id
    AND status = 'active'
    AND ended_at IS NULL
    AND NOT (TG_OP = 'UPDATE' AND enrollment_id = old.enrollment_id);
  IF member_count >= 2 THEN
    RAISE EXCEPTION 'A Peer dyad may have exactly two active enrollment members' USING ERRCODE = '23514';
  END IF;
  SELECT count(*) INTO active_count
  FROM public.programme_enrollments e
  WHERE e.id = new.enrollment_id
    AND e.cohort_id = d.cohort_id
    AND e.programme_id = d.programme_id
    AND e.status IN ('active'::public.enrollment_status, 'at_risk'::public.enrollment_status);
  IF active_count <> 1 THEN
    RAISE EXCEPTION 'Peer dyad member must be an active enrollment in the dyad cohort and programme'
      USING ERRCODE = '42501';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.peer_dyad_members m
    WHERE m.dyad_id = new.dyad_id
      AND m.enrollment_id = new.enrollment_id
      AND m.status = 'active'
      AND NOT (TG_OP = 'UPDATE' AND m.enrollment_id = old.enrollment_id)
  ) THEN
    RAISE EXCEPTION 'An enrollment may appear only once in an active Peer dyad'
      USING ERRCODE = '23505';
  END IF;
  RETURN new;
END
$function$;

DROP TRIGGER IF EXISTS peer_dyad_members_validate ON public.peer_dyad_members;
CREATE TRIGGER peer_dyad_members_validate
  BEFORE INSERT OR UPDATE ON public.peer_dyad_members
  FOR EACH ROW EXECUTE FUNCTION public.validate_peer_dyad();

CREATE OR REPLACE FUNCTION public.admin_create_peer_dyad(
  p_cohort_id uuid,
  p_programme_id uuid,
  p_left_enrollment_id uuid,
  p_right_enrollment_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  dyad_id uuid;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Only Admin may create a Peer dyad' USING ERRCODE = '42501';
  END IF;
  IF p_left_enrollment_id = p_right_enrollment_id THEN
    RAISE EXCEPTION 'A Peer dyad needs exactly two different enrollments' USING ERRCODE = '23514';
  END IF;
  INSERT INTO public.peer_dyads(cohort_id, programme_id, created_by)
  VALUES (p_cohort_id, p_programme_id, auth.uid())
  RETURNING id INTO dyad_id;
  INSERT INTO public.peer_dyad_members(dyad_id, enrollment_id)
  VALUES (dyad_id, p_left_enrollment_id), (dyad_id, p_right_enrollment_id);
  RETURN dyad_id;
END
$function$;

REVOKE ALL ON FUNCTION public.admin_create_peer_dyad(uuid, uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_create_peer_dyad(uuid, uuid, uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.peer_dyad_partner_enrollment(
  p_enrollment_id uuid,
  p_partner_user_id uuid
)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT m2.enrollment_id
  FROM public.peer_dyad_members m1
  JOIN public.peer_dyad_members m2 ON m2.dyad_id = m1.dyad_id
  JOIN public.peer_dyads d ON d.id = m1.dyad_id AND d.status = 'active'
  JOIN public.programme_enrollments e2 ON e2.id = m2.enrollment_id
  WHERE m1.enrollment_id = p_enrollment_id
    AND m1.status = 'active' AND m1.ended_at IS NULL
    AND m2.status = 'active' AND m2.ended_at IS NULL
    AND e2.user_id = p_partner_user_id
    AND m2.enrollment_id <> p_enrollment_id
  LIMIT 1;
$function$;

CREATE OR REPLACE FUNCTION public.peer_partner_enrollment(
  p_enrollment_id uuid,
  p_partner_user_id uuid
)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT public.peer_dyad_partner_enrollment(p_enrollment_id, p_partner_user_id);
$function$;

CREATE OR REPLACE FUNCTION public.eligible_peer_partners(p_enrollment_id uuid)
RETURNS TABLE (
  user_id uuid,
  enrollment_id uuid,
  display_name text,
  cohort_id uuid,
  cohort_name text,
  programme_id uuid,
  programme_name text,
  is_own_cohort boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT e2.user_id, e2.id, coalesce(p.full_name, '')::text,
    e2.cohort_id, c.name, e2.programme_id, pg.name,
    e2.cohort_id = e1.cohort_id
  FROM public.programme_enrollments e1
  JOIN public.peer_dyad_members m1
    ON m1.enrollment_id = e1.id AND m1.status = 'active' AND m1.ended_at IS NULL
  JOIN public.peer_dyads d
    ON d.id = m1.dyad_id AND d.status = 'active'
  JOIN public.peer_dyad_members m2
    ON m2.dyad_id = d.id AND m2.enrollment_id <> e1.id
    AND m2.status = 'active' AND m2.ended_at IS NULL
  JOIN public.programme_enrollments e2 ON e2.id = m2.enrollment_id
  JOIN public.cohorts c ON c.id = e2.cohort_id
  LEFT JOIN public.programmes pg ON pg.id = e2.programme_id
  JOIN public.profiles p ON p.id = e2.user_id
  WHERE e1.id = p_enrollment_id
    AND (e1.user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'::public.app_role))
    AND e1.status IN ('active'::public.enrollment_status, 'at_risk'::public.enrollment_status)
    AND e2.status IN ('active'::public.enrollment_status, 'at_risk'::public.enrollment_status)
    AND p.status IN ('active'::public.user_status, 'reach_limit'::public.user_status);
$function$;

-- The row-level write gate now uses the assigned dyad, not the dynamic cohort
-- permission graph. Historical sessions remain untouched.
CREATE OR REPLACE FUNCTION public.validate_coachee_peer_session_partner()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE owner_id uuid;
BEGIN
  IF new.peer_provider_id = new.peer_receiver_id THEN
    RAISE EXCEPTION 'A Peer session needs two different people' USING ERRCODE = '23514';
  END IF;
  SELECT e.user_id INTO owner_id
  FROM public.programme_enrollments e
  WHERE e.id = new.enrollment_id;
  IF owner_id IS DISTINCT FROM new.peer_receiver_id THEN
    RAISE EXCEPTION 'Peer session enrollment does not belong to the receiver' USING ERRCODE = '42501';
  END IF;
  IF public.peer_dyad_partner_enrollment(new.enrollment_id, new.peer_provider_id) IS NULL THEN
    RAISE EXCEPTION 'Peer partner is not assigned to the receiver''s active dyad'
      USING ERRCODE = '42501';
  END IF;
  RETURN new;
END
$function$;

CREATE OR REPLACE FUNCTION public.can_book_coachee_peer_session(
  p_provider_id uuid,
  p_enrollment_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.programme_enrollments e
      WHERE e.id = p_enrollment_id
        AND e.user_id = auth.uid()
        AND e.status IN ('active'::public.enrollment_status, 'at_risk'::public.enrollment_status)
    )
    AND public.peer_dyad_partner_enrollment(p_enrollment_id, p_provider_id) IS NOT NULL;
$function$;

-- ---------------------------------------------------------------------------
-- 5. Sponsor visibility: retire cohort-organisation leader RPCs
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.sponsor_leader_engagement_summary(uuid);

-- Keep the legacy RPC name available for clients that have not switched to
-- the canonical enrollment reader. It is only a compatibility wrapper; the
-- shared visibility set and progress source remain authoritative.
CREATE OR REPLACE FUNCTION public.sponsor_canonical_leader_progress(
  p_enrollment_id uuid,
  p_as_of date DEFAULT CURRENT_DATE
)
RETURNS TABLE (
  enrollment_id uuid,
  learner_display_name text,
  programme_label text,
  cohort_id uuid,
  cohort_label text,
  programme_id uuid,
  enrollment_start_date date,
  enrollment_end_date date,
  programme_start_date date,
  programme_end_date date,
  enrollment_status public.enrollment_status,
  stored_enrollment_status public.enrollment_status,
  effective_enrollment_status public.enrollment_status,
  required_units integer,
  completed_units integer,
  due_units integer,
  booked_units integer,
  overdue_units integer,
  full_completion_pct numeric,
  due_adherence_pct numeric,
  pace_status text,
  progress_available boolean,
  coaching_required_units integer,
  coaching_completed_units integer,
  coaching_due_units integer,
  coaching_booked_units integer,
  training_required_units integer,
  training_completed_units integer,
  training_due_units integer,
  training_booked_units integer,
  peer_required_units integer,
  peer_completed_units integer,
  peer_due_units integer,
  peer_booked_units integer,
  mentoring_required_units integer,
  mentoring_completed_units integer,
  mentoring_due_units integer,
  mentoring_booked_units integer,
  triad_required_units integer,
  triad_completed_units integer,
  triad_due_units integer,
  triad_booked_units integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT p.*
  FROM public.sponsor_canonical_enrollment_progress(NULL, p_as_of) p
  WHERE p.enrollment_id = p_enrollment_id
    AND EXISTS (
      SELECT 1
      FROM public.sponsor_visible_enrollments() v
      WHERE v.enrollment_id = p.enrollment_id
    );
$function$;

REVOKE ALL ON FUNCTION public.sponsor_canonical_leader_progress(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sponsor_canonical_leader_progress(uuid, date) TO authenticated;

CREATE OR REPLACE FUNCTION public.sponsor_canonical_leader_experience(
  p_enrollment_id uuid,
  p_as_of date DEFAULT CURRENT_DATE
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT CASE
    WHEN public.sponsor_can_view_enrollment(p_enrollment_id)
      THEN public.canonical_enrollment_experience(p_enrollment_id, p_as_of)
    ELSE '{}'::jsonb
  END;
$function$;

REVOKE ALL ON FUNCTION public.sponsor_canonical_leader_experience(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sponsor_canonical_leader_experience(uuid, date) TO authenticated;

-- Triad participants are enrollment-owned too. They have no provider half,
-- but they can create their own post-session actions.
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
  SELECT m.enrollment_id, NULL::uuid
  FROM public.triad_sessions s
  JOIN public.triad_group_members m ON m.triad_group_id = s.triad_group_id
  WHERE p_source_activity_type = 'triad' AND s.id = p_source_activity_id
    AND m.enrollment_id = p_enrollment_id
$function$;

REVOKE ALL ON FUNCTION public.enrollment_activity_participants(uuid, text, uuid) FROM PUBLIC, anon, authenticated;

-- Keep the learner week list aligned with the same week fulfilment projection.
-- The old training_progress timestamp is still retained as historical evidence,
-- but it no longer marks the parent week complete by itself.
DROP FUNCTION IF EXISTS public.get_enrollment_training_weeks(uuid);
CREATE FUNCTION public.get_enrollment_training_weeks(p_enrollment_id uuid)
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
    SELECT c.training_week_id, c.requirement_id, c.due_on, c.is_completed, c.is_overdue
    FROM public.canonical_enrollment_requirement_calendar(p_enrollment_id, CURRENT_DATE) c
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
      WHEN cal.is_completed THEN 'completed'
      WHEN cal.is_overdue THEN 'overdue'
      ELSE 'upcoming'
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
