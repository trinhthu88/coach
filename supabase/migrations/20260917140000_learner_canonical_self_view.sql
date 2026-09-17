-- Learner (coachee) self-view canonical contract.
--
-- The learner dashboard previously sourced overall/module progress from
-- get_enrollment_progress(), which reads required_units/due dates from the
-- enrollment_module_snapshots table (a per-enrollment snapshot taken at
-- schedule time) and its own activity aggregation. Sponsor's canonical
-- progress was re-based on live Admin programme_modules configuration
-- (sponsor_canonical_module_schedule) and real attributed activity
-- (sponsor_canonical_activity) — see sponsor_canonical_admin_activity_spine
-- and sponsor_final_canonical_contract. Those two sources can disagree
-- (snapshots go stale after an Admin config edit; activity aggregation
-- differs for training, which the sponsor engine collapses to one
-- completed unit per training week). Since the Learner Dashboard and the
-- Sponsor Leader Detail describe the exact same enrollment, that is a
-- shared-domain bug, not two legitimately different views.
--
-- These functions are the learner-authorized mirror of the Sponsor Leader
-- Detail contract (sponsor_canonical_leader_progress /
-- sponsor_canonical_leader_journey / sponsor_canonical_leader_experience):
-- same shape, same calculation, calling down into the exact same
-- get_sponsor_programme_progress / sponsor_canonical_module_schedule /
-- sponsor_canonical_activity primitives those already use. The only
-- difference is authorization — a learner may read their own enrollment
-- without the sponsor organisation membership and cohort-size (k-anonymity)
-- checks, which exist purely to keep a sponsor from re-identifying one
-- learner inside a small cohort and are meaningless applied to a learner
-- viewing their own record.
--
-- Sponsor screens, sponsor_canonical_leader_*, and their underlying
-- primitives are unchanged by this migration.

CREATE OR REPLACE FUNCTION public.learner_canonical_progress(
  p_enrollment_id uuid,
  p_as_of date DEFAULT current_date
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
AS $$
  WITH eligible AS (
    SELECT e.id, e.programme_id, e.cohort_id, e.user_id, e.start_date,
      e.end_date, e.status, c.name AS cohort_label,
      c.start_date AS programme_start_date, c.end_date AS programme_end_date,
      p.name AS programme_label, pr.full_name AS learner_display_name
    FROM public.programme_enrollments e
    JOIN public.cohorts c ON c.id = e.cohort_id
    JOIN public.programmes p ON p.id = e.programme_id
    JOIN public.profiles pr ON pr.id = e.user_id
    WHERE e.id = p_enrollment_id
      AND e.user_id = auth.uid()
      AND auth.uid() IS NOT NULL
  ), module_rows AS (
    SELECT e.*, g.module,
      g.required_units AS module_required_units,
      g.completed_units AS module_completed_units,
      g.due_units AS module_due_units,
      g.booked_units AS module_booked_units,
      g.pace_status AS module_pace_status
    FROM eligible e
    LEFT JOIN LATERAL public.get_sponsor_programme_progress(e.id, p_as_of) g ON true
  ), grouped AS (
    SELECT e.id, e.learner_display_name, e.programme_label, e.cohort_id,
      e.cohort_label, e.programme_id, e.start_date, e.end_date,
      e.programme_start_date, e.programme_end_date, e.status,
      count(m.module)::integer AS module_count,
      coalesce(sum(m.module_required_units), 0)::integer AS required_units,
      coalesce(sum(m.module_completed_units), 0)::integer AS completed_units,
      coalesce(sum(m.module_due_units), 0)::integer AS due_units,
      coalesce(sum(m.module_booked_units), 0)::integer AS booked_units,
      coalesce(max(m.module_required_units) FILTER (WHERE m.module = 'coaching'), 0)::integer AS coaching_required_units,
      coalesce(max(m.module_completed_units) FILTER (WHERE m.module = 'coaching'), 0)::integer AS coaching_completed_units,
      coalesce(max(m.module_due_units) FILTER (WHERE m.module = 'coaching'), 0)::integer AS coaching_due_units,
      coalesce(max(m.module_booked_units) FILTER (WHERE m.module = 'coaching'), 0)::integer AS coaching_booked_units,
      coalesce(max(m.module_required_units) FILTER (WHERE m.module = 'training'), 0)::integer AS training_required_units,
      coalesce(max(m.module_completed_units) FILTER (WHERE m.module = 'training'), 0)::integer AS training_completed_units,
      coalesce(max(m.module_due_units) FILTER (WHERE m.module = 'training'), 0)::integer AS training_due_units,
      coalesce(max(m.module_booked_units) FILTER (WHERE m.module = 'training'), 0)::integer AS training_booked_units,
      coalesce(max(m.module_required_units) FILTER (WHERE m.module = 'peer_coaching'), 0)::integer AS peer_required_units,
      coalesce(max(m.module_completed_units) FILTER (WHERE m.module = 'peer_coaching'), 0)::integer AS peer_completed_units,
      coalesce(max(m.module_due_units) FILTER (WHERE m.module = 'peer_coaching'), 0)::integer AS peer_due_units,
      coalesce(max(m.module_booked_units) FILTER (WHERE m.module = 'peer_coaching'), 0)::integer AS peer_booked_units,
      coalesce(max(m.module_required_units) FILTER (WHERE m.module = 'mentoring'), 0)::integer AS mentoring_required_units,
      coalesce(max(m.module_completed_units) FILTER (WHERE m.module = 'mentoring'), 0)::integer AS mentoring_completed_units,
      coalesce(max(m.module_due_units) FILTER (WHERE m.module = 'mentoring'), 0)::integer AS mentoring_due_units,
      coalesce(max(m.module_booked_units) FILTER (WHERE m.module = 'mentoring'), 0)::integer AS mentoring_booked_units,
      coalesce(max(m.module_required_units) FILTER (WHERE m.module = 'triads'), 0)::integer AS triad_required_units,
      coalesce(max(m.module_completed_units) FILTER (WHERE m.module = 'triads'), 0)::integer AS triad_completed_units,
      coalesce(max(m.module_due_units) FILTER (WHERE m.module = 'triads'), 0)::integer AS triad_due_units,
      coalesce(max(m.module_booked_units) FILTER (WHERE m.module = 'triads'), 0)::integer AS triad_booked_units,
      count(m.module) FILTER (WHERE m.module_pace_status = 'behind')::integer AS behind_count,
      count(m.module) FILTER (WHERE m.module_pace_status = 'scheduled')::integer AS scheduled_count,
      count(m.module) FILTER (WHERE m.module_pace_status = 'on_track')::integer AS on_track_count,
      count(m.module) FILTER (WHERE m.module_pace_status = 'ahead')::integer AS ahead_count,
      coalesce(bool_and(m.module_pace_status = 'completed')
        FILTER (WHERE m.module IS NOT NULL), false) AS all_completed
    FROM eligible e
    LEFT JOIN module_rows m ON m.id = e.id
    GROUP BY e.id, e.learner_display_name, e.programme_label, e.cohort_id,
      e.cohort_label, e.programme_id, e.start_date, e.end_date,
      e.programme_start_date, e.programme_end_date, e.status
  ), calculated AS (
    SELECT g.*,
      CASE
        WHEN g.module_count = 0 THEN 'not_yet_due'
        WHEN g.behind_count > 0 THEN 'behind'
        WHEN g.scheduled_count > 0 THEN 'scheduled'
        WHEN g.on_track_count > 0 THEN 'on_track'
        WHEN g.ahead_count > 0 THEN 'ahead'
        WHEN g.all_completed THEN 'completed'
        ELSE 'not_yet_due'
      END AS calculated_pace_status
    FROM grouped g
  )
  SELECT c.id, c.learner_display_name, c.programme_label, c.cohort_id,
    c.cohort_label, c.programme_id, c.start_date, c.end_date,
    c.programme_start_date, c.programme_end_date,
    CASE
      WHEN c.status IN ('active', 'at_risk')
        AND c.programme_end_date < p_as_of
      THEN CASE WHEN c.all_completed THEN 'completed'::public.enrollment_status
                ELSE 'at_risk'::public.enrollment_status END
      ELSE c.status
    END,
    c.status,
    CASE
      WHEN c.status IN ('active', 'at_risk')
        AND c.programme_end_date < p_as_of
      THEN CASE WHEN c.all_completed THEN 'completed'::public.enrollment_status
                ELSE 'at_risk'::public.enrollment_status END
      ELSE c.status
    END,
    c.required_units, c.completed_units, c.due_units, c.booked_units,
    greatest(0, c.due_units - c.completed_units),
    CASE WHEN c.required_units = 0 THEN NULL
      ELSE round(least(c.completed_units, c.required_units) * 100.0 / c.required_units, 1)
    END,
    CASE WHEN c.due_units = 0 THEN NULL
      ELSE round(least(c.completed_units, c.due_units) * 100.0 / c.due_units, 1)
    END,
    c.calculated_pace_status, c.module_count > 0,
    c.coaching_required_units, c.coaching_completed_units, c.coaching_due_units, c.coaching_booked_units,
    c.training_required_units, c.training_completed_units, c.training_due_units, c.training_booked_units,
    c.peer_required_units, c.peer_completed_units, c.peer_due_units, c.peer_booked_units,
    c.mentoring_required_units, c.mentoring_completed_units, c.mentoring_due_units, c.mentoring_booked_units,
    c.triad_required_units, c.triad_completed_units, c.triad_due_units, c.triad_booked_units
  FROM calculated c;
$$;

-- Individual learner journey. Same schedule/activity/checkpoint
-- construction as sponsor_canonical_leader_journey, self-authorized instead
-- of sponsor-authorized, and without the cohort-size distribution
-- threshold (that threshold protects a learner's privacy from a sponsor,
-- not from the learner themselves).
CREATE OR REPLACE FUNCTION public.learner_canonical_journey(
  p_enrollment_id uuid,
  p_as_of date DEFAULT current_date
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH eligible AS (
    SELECT e.id, e.cohort_id
    FROM public.programme_enrollments e
    WHERE e.id = p_enrollment_id
      AND e.user_id = auth.uid()
      AND auth.uid() IS NOT NULL
  ), schedule AS (
    SELECT e.id AS enrollment_id, s.module, s.required_units,
      s.due_on, s.milestone_units, s.training_week_id
    FROM eligible e
    CROSS JOIN LATERAL public.sponsor_canonical_module_schedule(e.id) s
    WHERE s.due_on IS NOT NULL
  ), activity AS (
    SELECT e.id AS enrollment_id, a.module, a.occurred_on, a.status
    FROM eligible e
    CROSS JOIN LATERAL public.sponsor_canonical_activity(e.id) a
  ), dates AS (
    SELECT s.due_on,
      string_agg(DISTINCT tw.title, ' · ' ORDER BY tw.title)
        FILTER (WHERE tw.title IS NOT NULL) AS training_label,
      string_agg(DISTINCT s.module::text, ' · ' ORDER BY s.module::text) AS module_label,
      to_jsonb(array_agg(DISTINCT s.module::text ORDER BY s.module::text)) AS module_scope
    FROM schedule s
    LEFT JOIN public.training_weeks tw ON tw.id = s.training_week_id
    GROUP BY s.due_on
  ), scoped_modules AS (
    SELECT d.due_on, e.id AS enrollment_id, s.module,
      least(max(s.required_units), sum(s.milestone_units))::integer AS required_units
    FROM dates d
    CROSS JOIN eligible e
    JOIN schedule s
      ON s.enrollment_id = e.id
     AND s.due_on <= d.due_on
    GROUP BY d.due_on, e.id, s.module
  ), leader_module_checkpoints AS (
    SELECT sm.due_on, sm.enrollment_id, sm.module, sm.required_units,
      count(a.occurred_on) FILTER (
        WHERE a.status = 'completed'
          AND a.occurred_on <= least(p_as_of, sm.due_on)
      )::integer AS completed_units
    FROM scoped_modules sm
    LEFT JOIN activity a
      ON a.enrollment_id = sm.enrollment_id
     AND a.module = sm.module
    GROUP BY sm.due_on, sm.enrollment_id, sm.module, sm.required_units
  ), leader_checkpoints AS (
    SELECT d.due_on, e.id AS enrollment_id,
      coalesce(sum(l.required_units), 0)::integer AS required_units,
      coalesce(sum(least(l.completed_units, l.required_units)), 0)::integer AS completed_units
    FROM dates d
    CROSS JOIN eligible e
    LEFT JOIN leader_module_checkpoints l
      ON l.due_on = d.due_on
     AND l.enrollment_id = e.id
    GROUP BY d.due_on, e.id
  ), numbered AS (
    SELECT row_number() OVER (ORDER BY d.due_on)::integer AS checkpoint_number,
      d.due_on, coalesce(d.training_label, d.module_label) AS label, d.module_scope,
      lc.required_units, lc.completed_units
    FROM dates d
    JOIN leader_checkpoints lc ON lc.due_on = d.due_on
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'checkpoint_number', checkpoint_number,
    'due_on', due_on,
    'label', label,
    'module_scope', module_scope,
    'required_units', required_units,
    'completed_units', completed_units,
    'state', CASE
      WHEN p_as_of < due_on THEN 'upcoming'
      WHEN p_as_of = due_on THEN 'current'
      WHEN required_units > 0 AND completed_units >= required_units THEN 'completed'
      ELSE 'overdue'
    END
  ) ORDER BY due_on), '[]'::jsonb)
  FROM numbered;
$$;

-- Weekly participation + learning breakdown for the learner's own
-- enrollment. Same construction as sponsor_canonical_leader_experience's
-- weekly_participation/learning_breakdown/coaching_utilisation (built on
-- the same schedule/activity primitives); goals/actions/satisfaction are
-- deliberately omitted here because the learner already reads those
-- directly off coachee_goals/coachee_goal_ratings/enrollment_actions/
-- sessions under their own RLS (see useJourneyGoals/useJourneySessions) —
-- duplicating that aggregate would be a second formula for the same facts.
CREATE OR REPLACE FUNCTION public.learner_canonical_experience(
  p_enrollment_id uuid,
  p_as_of date DEFAULT current_date
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH progress AS (
    SELECT *
    FROM public.learner_canonical_progress(p_enrollment_id, p_as_of)
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
      END AS utilisation_pct
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
$$;

-- Per-module progress (one row per enabled module: required/completed/due/
-- booked/pace, plus this module's own completion and due-adherence
-- percentages). This is the same shape the learner dashboard's module
-- stat cards already render (previously fed by get_enrollment_progress),
-- sourced instead from get_sponsor_programme_progress — the exact engine
-- Sponsor uses — so a module tile on the Learner Dashboard and the same
-- module's numbers on Sponsor Leader Detail can never disagree.
CREATE OR REPLACE FUNCTION public.learner_canonical_module_progress(
  p_enrollment_id uuid,
  p_as_of date DEFAULT current_date
)
RETURNS TABLE (
  module public.programme_module_type,
  required_units integer,
  completed_units integer,
  due_units integer,
  booked_units integer,
  pace_status text,
  full_completion_pct numeric,
  due_adherence_pct numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH eligible AS (
    SELECT e.id
    FROM public.programme_enrollments e
    WHERE e.id = p_enrollment_id
      AND e.user_id = auth.uid()
      AND auth.uid() IS NOT NULL
  )
  SELECT g.module, g.required_units, g.completed_units, g.due_units, g.booked_units,
    g.pace_status,
    CASE WHEN g.required_units = 0 THEN NULL
      ELSE round(least(g.completed_units, g.required_units) * 100.0 / g.required_units, 1)
    END,
    CASE WHEN g.due_units = 0 THEN NULL
      ELSE round(least(g.completed_units, g.due_units) * 100.0 / g.due_units, 1)
    END
  FROM eligible e
  CROSS JOIN LATERAL public.get_sponsor_programme_progress(e.id, p_as_of) g
  ORDER BY g.module;
$$;

REVOKE ALL ON FUNCTION public.learner_canonical_progress(uuid, date)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.learner_canonical_journey(uuid, date)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.learner_canonical_experience(uuid, date)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.learner_canonical_module_progress(uuid, date)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.learner_canonical_progress(uuid, date)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.learner_canonical_journey(uuid, date)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.learner_canonical_experience(uuid, date)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.learner_canonical_module_progress(uuid, date)
  TO authenticated;
