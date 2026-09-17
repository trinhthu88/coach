-- Sponsor Leader Detail canonical contract (Phase 9/10).
--
-- Dedicated, enrollment-scoped backend contract for
-- /sponsor/cohorts/:cohortId/leaders/:enrollmentId. Replaces the anti-
-- pattern of loading the whole cohort roster and finding one row client-
-- side: every function here takes p_enrollment_id directly and returns at
-- most one leader's worth of data (zero rows if the enrollment doesn't
-- belong to the caller's organisation, or its cohort is below the sponsor
-- visibility threshold — the same "suppressed cohorts expose no detail
-- rows" contract already enforced elsewhere).
--
-- These reuse the exact same canonical primitives as the cohort/
-- organisation rollups (sponsor_canonical_module_schedule,
-- sponsor_canonical_activity, get_sponsor_programme_progress) rather than
-- recomputing progress with new formulas — current Admin programme_modules
-- configuration is still the sole denominator source, real
-- session_activity_attributions rows are still the sole numerator source.
--
-- sponsor_canonical_leader_progress duplicates the grouping/status shape
-- of sponsor_canonical_enrollment_progress rather than extending that
-- function's signature: sponsor_canonical_cohort_progress calls
-- sponsor_canonical_enrollment_progress(p_cohort_id, p_as_of) internally,
-- so changing its argument list would need DROP FUNCTION, which fails
-- (or cascades into dropping its dependents) while anything still
-- references the old signature. Both functions call down to the same
-- get_sponsor_programme_progress/sponsor_canonical_activity primitives,
-- so this is the same model at a different grain, not a parallel one.
--
-- None of these ever select coach_id, coach_notes, coach_private_notes,
-- coachee_notes, coachee_rating_comment, goal/action title or description,
-- or reflection content — only sponsor-safe counts, dates and aggregates.

CREATE OR REPLACE FUNCTION public.sponsor_canonical_leader_progress(
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
  WITH sponsor AS (
    SELECT sp.organization_id
    FROM public.sponsor_profiles sp
    WHERE sp.user_id = auth.uid()
      AND auth.uid() IS NOT NULL
  ), eligible AS (
    SELECT e.id, e.programme_id, e.cohort_id, e.user_id, e.start_date,
      e.end_date, e.status, c.organization_id, c.name AS cohort_label,
      c.start_date AS programme_start_date, c.end_date AS programme_end_date,
      p.name AS programme_label, pr.full_name AS learner_display_name
    FROM public.programme_enrollments e
    JOIN public.cohorts c ON c.id = e.cohort_id
    JOIN public.programmes p ON p.id = e.programme_id
    JOIN public.profiles pr ON pr.id = e.user_id
    JOIN sponsor s ON s.organization_id = c.organization_id
    WHERE e.id = p_enrollment_id
      AND (
        SELECT count(*)
        FROM public.programme_enrollments same_cohort
        JOIN public.cohorts same_cohort_record
          ON same_cohort_record.id = same_cohort.cohort_id
        WHERE same_cohort.cohort_id = e.cohort_id
          AND same_cohort_record.organization_id = c.organization_id
      ) >= public.sponsor_min_leaders_for_distribution()
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

-- 2. Individual Leader Journey. Same schedule/activity/checkpoint
--    construction as get_sponsor_programme_journey (the Cohort Journey),
--    forked at the point that function's own leader_checkpoints CTE
--    already computes one row per (checkpoint, enrollment) before
--    aggregating across every leader in the cohort — here that
--    aggregation step is simply never applied, because `eligible` is
--    exactly one enrollment. Same four checkpoint states as the Cohort
--    Journey (upcoming / current / completed / overdue), so "current" is
--    this leader's own "YOU ARE HERE" checkpoint.
CREATE OR REPLACE FUNCTION public.sponsor_canonical_leader_journey(
  p_enrollment_id uuid,
  p_as_of date DEFAULT current_date
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH sponsor AS (
    SELECT sp.organization_id
    FROM public.sponsor_profiles sp
    WHERE sp.user_id = auth.uid()
      AND auth.uid() IS NOT NULL
  ), eligible AS (
    SELECT e.id, e.cohort_id
    FROM public.programme_enrollments e
    JOIN public.cohorts c ON c.id = e.cohort_id
    JOIN sponsor s ON s.organization_id = c.organization_id
    WHERE e.id = p_enrollment_id
      AND (
        SELECT count(*)
        FROM public.programme_enrollments same_cohort
        WHERE same_cohort.cohort_id = e.cohort_id
      ) >= public.sponsor_min_leaders_for_distribution()
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

-- 3. Goals / actions / satisfaction / coaching-utilisation aggregate for
--    one enrollment — the exact same formulas already proven in
--    sponsor_enrollment_summaries and sponsor_organisation_summary's
--    goals/actions/satisfaction CTEs, re-scoped from "every leader in a
--    cohort" to "this one enrollment". Never selects goal/action title or
--    description, or coachee_rating_comment — counts and averages only.
--    "Participation trend" for an individual leader is the checkpoint
--    series from sponsor_canonical_leader_journey above, not a separate
--    invented weekly/monthly cadence metric.
CREATE OR REPLACE FUNCTION public.sponsor_leader_engagement_summary(
  p_enrollment_id uuid
)
RETURNS TABLE (
  goal_count integer,
  goal_setup boolean,
  goal_progress_pct numeric,
  open_action_count integer,
  completed_action_count integer,
  total_action_count integer,
  action_completion_pct numeric,
  satisfaction_avg numeric,
  satisfaction_rated_count integer,
  last_coaching_activity_on date
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH sponsor AS (
    SELECT sp.organization_id
    FROM public.sponsor_profiles sp
    WHERE sp.user_id = auth.uid()
      AND auth.uid() IS NOT NULL
  ), eligible AS (
    SELECT e.id
    FROM public.programme_enrollments e
    JOIN public.cohorts c ON c.id = e.cohort_id
    JOIN sponsor s ON s.organization_id = c.organization_id
    WHERE e.id = p_enrollment_id
      AND (
        SELECT count(*)
        FROM public.programme_enrollments same_cohort
        WHERE same_cohort.cohort_id = e.cohort_id
      ) >= public.sponsor_min_leaders_for_distribution()
  ), goals AS (
    SELECT e.id AS enrollment_id,
      count(g.id)::integer AS goal_count,
      (count(g.id) FILTER (WHERE gr.id IS NOT NULL) > 0) AS goal_setup,
      round(avg(CASE WHEN gr.target_rating IS NULL OR gr.start_rating IS NULL
        OR gr.target_rating = gr.start_rating THEN NULL
        ELSE least(100, greatest(0, (gr.current_rating - gr.start_rating) * 100.0 /
          (gr.target_rating - gr.start_rating))) END), 1) AS goal_progress_pct
    FROM eligible e
    LEFT JOIN public.coachee_goals g ON g.enrollment_id = e.id
    LEFT JOIN public.coachee_goal_ratings gr
      ON gr.goal_id = g.id AND gr.enrollment_id = e.id
    GROUP BY e.id
  ), actions AS (
    SELECT e.id AS enrollment_id,
      count(a.id) FILTER (WHERE a.status IN ('open', 'in_progress'))::integer AS open_action_count,
      count(a.id) FILTER (WHERE a.status = 'completed')::integer AS completed_action_count,
      count(a.id)::integer AS total_action_count
    FROM eligible e
    LEFT JOIN public.enrollment_actions a ON a.enrollment_id = e.id
    GROUP BY e.id
  ), satisfaction AS (
    SELECT e.id AS enrollment_id,
      count(sess.id)::integer AS rated_count,
      round(avg(sess.coachee_rating), 2) AS avg_rating
    FROM eligible e
    LEFT JOIN public.sessions sess ON sess.enrollment_id = e.id
      AND sess.status = 'completed' AND sess.coachee_rating IS NOT NULL
    GROUP BY e.id
  ), coaching_activity AS (
    SELECT e.id AS enrollment_id,
      max(a.occurred_on) FILTER (WHERE a.status = 'completed') AS last_coaching_activity_on
    FROM eligible e
    CROSS JOIN LATERAL public.sponsor_canonical_activity(e.id) a
    WHERE a.module = 'coaching'
    GROUP BY e.id
  )
  SELECT
    coalesce(g.goal_count, 0), coalesce(g.goal_setup, false), g.goal_progress_pct,
    coalesce(a.open_action_count, 0), coalesce(a.completed_action_count, 0),
    coalesce(a.total_action_count, 0),
    CASE WHEN coalesce(a.total_action_count, 0) = 0 THEN NULL
      ELSE round(a.completed_action_count * 100.0 / a.total_action_count, 1) END,
    sat.avg_rating, coalesce(sat.rated_count, 0),
    ca.last_coaching_activity_on
  FROM eligible e
  LEFT JOIN goals g ON g.enrollment_id = e.id
  LEFT JOIN actions a ON a.enrollment_id = e.id
  LEFT JOIN satisfaction sat ON sat.enrollment_id = e.id
  LEFT JOIN coaching_activity ca ON ca.enrollment_id = e.id;
$$;

REVOKE ALL ON FUNCTION public.sponsor_canonical_leader_progress(uuid, date)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sponsor_canonical_leader_journey(uuid, date)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sponsor_leader_engagement_summary(uuid)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.sponsor_canonical_leader_progress(uuid, date)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.sponsor_canonical_leader_journey(uuid, date)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.sponsor_leader_engagement_summary(uuid)
  TO authenticated;
