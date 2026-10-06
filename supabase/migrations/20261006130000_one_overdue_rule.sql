-- ===========================================================================
-- One overdue rule (findings S-1, P-9b, D-12, S-9, D-13, A-9, A-3, A-4, D-15)
--
-- Overdue has one definition, the requirement calendar's
-- (canonical_enrollment_requirement_calendar): a requirement is overdue when
-- its due date has PASSED (due_on < as_of) and it is still open. Every
-- rollup adds up those per-leader answers instead of re-deriving them.
--
--   1. sponsor_canonical_cohort_progress(_one): overdue_units is the SUM of the
--      leaders' overdue units; due adherence and schedule coverage divide the
--      leaders' own credited units (least(completed, due) /
--      least(completed + booked, due), per leader) by the due units. The
--      cohort-total formula greatest(0, due - completed) let a leader who was
--      ahead hide another's overdue unit. Two columns carry the credited sums
--      (adherence_credited_units, coverage_credited_units).
--   2. sponsor_canonical_organisation_progress sums those cohort columns (it
--      stays a rollup of cohort rows, never of leader rows).
--   3. canonical_triad_completion (its schedule and next due date) and
--      triad_requirement_learners_internal (Admin Triad view, Triad reminders)
--      read the calendar. They called a Triad overdue on its due date
--      (due_on <= as_of).
--   4. training_overdue_assignment_targets_internal(): who has an overdue
--      quiz / reflection, from each enrollment's calendar (overdue Training
--      week) and week fulfilment. send-programme-reminders read
--      training_weeks.unlock_date + assignments.due_offset_days instead.
--   5. daily_prompt_for_enrollment_internal() / daily_prompt_targets_internal():
--      today's prompt from the enrollment's own Training calendar (cohort
--      overrides included) in programme_time_zone(). send-daily-prompt and
--      get_todays_prompt read training_weeks.unlock_date, one date for every
--      cohort.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1 + 2. Rollups add up the leaders
-- ---------------------------------------------------------------------------
-- The return type gains two columns, so both functions are re-created.
DROP FUNCTION IF EXISTS public.sponsor_canonical_cohort_progress(uuid, date);
DROP FUNCTION IF EXISTS public.sponsor_canonical_cohort_progress_one(uuid, date);

CREATE OR REPLACE FUNCTION public.sponsor_canonical_cohort_progress_one(p_cohort_id uuid, p_as_of date DEFAULT CURRENT_DATE)
 RETURNS TABLE(cohort_id uuid, cohort_label text, programme_label text, programme_start_date date, programme_end_date date, enrollment_count integer, suppressed boolean, required_units integer, completed_units integer, due_units integer, booked_units integer, overdue_units integer, full_completion_pct numeric, due_adherence_pct numeric, schedule_coverage_pct numeric, pace_status text, active_count integer, at_risk_count integer, paused_count integer, completed_count integer, not_yet_due_count integer, ahead_count integer, on_track_count integer, scheduled_count integer, behind_count integer, completed_pace_count integer, on_track_pct numeric, coaching_required_units integer, coaching_completed_units integer, coaching_due_units integer, coaching_booked_units integer, coaching_completed_leaders integer, training_required_units integer, training_completed_units integer, training_due_units integer, training_booked_units integer, training_completed_leaders integer, peer_required_units integer, peer_completed_units integer, peer_due_units integer, peer_booked_units integer, peer_completed_leaders integer, mentoring_required_units integer, mentoring_completed_units integer, mentoring_due_units integer, mentoring_booked_units integer, mentoring_completed_leaders integer, triad_required_units integer, triad_completed_units integer, triad_due_units integer, triad_booked_units integer, triad_completed_leaders integer, programme_journey jsonb, progress_source_complete boolean, satisfaction_avg numeric, satisfaction_rated_count integer, adherence_credited_units integer, coverage_credited_units integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH visible AS (
    -- The sponsor's visible enrollments in this cohort (enrollment
    -- organisation). No row at all when the sponsor has none here.
    SELECT v.enrollment_id
    FROM public.sponsor_visible_enrollments() v
    WHERE v.cohort_id = p_cohort_id
  ), cohort_row AS (
    SELECT c.id, c.name, p.name AS programme_label, c.start_date, c.end_date,
      (SELECT count(*) FROM visible)::integer AS enrollment_count
    FROM public.cohorts c
    JOIN public.programmes p ON p.id = c.programme_id
    WHERE c.id = p_cohort_id
      AND EXISTS (SELECT 1 FROM visible)
  ), rows AS (
    SELECT r.*
    FROM public.sponsor_canonical_enrollment_progress(p_cohort_id, p_as_of) r
  ), satisfaction AS (
    -- Rating-weighted mean of the canonical per-enrollment satisfaction
    -- (canonical_enrollment_engagement), visible enrollments only.
    SELECT
      sum(g.satisfaction_avg * g.satisfaction_rated_count)
        FILTER (WHERE g.satisfaction_avg IS NOT NULL AND g.satisfaction_rated_count > 0) AS weighted_sum,
      coalesce(sum(g.satisfaction_rated_count)
        FILTER (WHERE g.satisfaction_avg IS NOT NULL AND g.satisfaction_rated_count > 0), 0)::integer AS rated_count
    FROM visible v
    CROSS JOIN LATERAL public.canonical_enrollment_engagement(v.enrollment_id) g
  ), grouped AS (
    SELECT c.id, c.name, c.programme_label, c.start_date, c.end_date,
      c.enrollment_count,
      coalesce(sum(r.required_units), 0)::integer AS required_units,
      coalesce(sum(r.completed_units), 0)::integer AS completed_units,
      coalesce(sum(r.due_units), 0)::integer AS due_units,
      coalesce(sum(r.booked_units), 0)::integer AS booked_units,
      -- One overdue rule (20261006130000): the cohort's overdue units and its
      -- credited units are sums of the LEADERS' own, so a leader who is ahead
      -- never offsets another leader's overdue unit.
      coalesce(sum(r.overdue_units), 0)::integer AS overdue_units,
      coalesce(sum(least(r.completed_units, r.due_units)), 0)::integer AS adherence_credited_units,
      coalesce(sum(least(r.completed_units + r.booked_units, r.due_units)), 0)::integer AS coverage_credited_units,
      count(r.enrollment_id) FILTER (WHERE r.effective_enrollment_status = 'active')::integer AS active_count,
      count(r.enrollment_id) FILTER (WHERE r.effective_enrollment_status = 'at_risk')::integer AS at_risk_count,
      count(r.enrollment_id) FILTER (WHERE r.effective_enrollment_status = 'paused')::integer AS paused_count,
      count(r.enrollment_id) FILTER (WHERE r.effective_enrollment_status = 'completed')::integer AS completed_count,
      count(r.enrollment_id) FILTER (WHERE r.pace_status = 'not_yet_due')::integer AS not_yet_due_count,
      count(r.enrollment_id) FILTER (WHERE r.pace_status = 'ahead')::integer AS ahead_count,
      count(r.enrollment_id) FILTER (WHERE r.pace_status = 'on_track')::integer AS on_track_count,
      count(r.enrollment_id) FILTER (WHERE r.pace_status = 'scheduled')::integer AS scheduled_count,
      count(r.enrollment_id) FILTER (WHERE r.pace_status = 'behind')::integer AS behind_count,
      count(r.enrollment_id) FILTER (WHERE r.pace_status = 'completed')::integer AS completed_pace_count,
      coalesce(sum(r.coaching_required_units), 0)::integer AS coaching_required_units,
      coalesce(sum(r.coaching_completed_units), 0)::integer AS coaching_completed_units,
      coalesce(sum(r.coaching_due_units), 0)::integer AS coaching_due_units,
      coalesce(sum(r.coaching_booked_units), 0)::integer AS coaching_booked_units,
      count(r.enrollment_id) FILTER (WHERE r.coaching_required_units > 0 AND r.coaching_completed_units >= r.coaching_required_units)::integer AS coaching_completed_leaders,
      coalesce(sum(r.training_required_units), 0)::integer AS training_required_units,
      coalesce(sum(r.training_completed_units), 0)::integer AS training_completed_units,
      coalesce(sum(r.training_due_units), 0)::integer AS training_due_units,
      coalesce(sum(r.training_booked_units), 0)::integer AS training_booked_units,
      count(r.enrollment_id) FILTER (WHERE r.training_required_units > 0 AND r.training_completed_units >= r.training_required_units)::integer AS training_completed_leaders,
      coalesce(sum(r.peer_required_units), 0)::integer AS peer_required_units,
      coalesce(sum(r.peer_completed_units), 0)::integer AS peer_completed_units,
      coalesce(sum(r.peer_due_units), 0)::integer AS peer_due_units,
      coalesce(sum(r.peer_booked_units), 0)::integer AS peer_booked_units,
      count(r.enrollment_id) FILTER (WHERE r.peer_required_units > 0 AND r.peer_completed_units >= r.peer_required_units)::integer AS peer_completed_leaders,
      coalesce(sum(r.mentoring_required_units), 0)::integer AS mentoring_required_units,
      coalesce(sum(r.mentoring_completed_units), 0)::integer AS mentoring_completed_units,
      coalesce(sum(r.mentoring_due_units), 0)::integer AS mentoring_due_units,
      coalesce(sum(r.mentoring_booked_units), 0)::integer AS mentoring_booked_units,
      count(r.enrollment_id) FILTER (WHERE r.mentoring_required_units > 0 AND r.mentoring_completed_units >= r.mentoring_required_units)::integer AS mentoring_completed_leaders,
      coalesce(sum(r.triad_required_units), 0)::integer AS triad_required_units,
      coalesce(sum(r.triad_completed_units), 0)::integer AS triad_completed_units,
      coalesce(sum(r.triad_due_units), 0)::integer AS triad_due_units,
      coalesce(sum(r.triad_booked_units), 0)::integer AS triad_booked_units,
      count(r.enrollment_id) FILTER (WHERE r.triad_required_units > 0 AND r.triad_completed_units >= r.triad_required_units)::integer AS triad_completed_leaders,
      count(r.enrollment_id)::integer AS source_row_count
    FROM cohort_row c
    LEFT JOIN rows r ON r.cohort_id = c.id
    GROUP BY c.id, c.name, c.programme_label, c.start_date, c.end_date, c.enrollment_count
  ), calculated AS (
    SELECT g.*,
      CASE
        WHEN g.behind_count > 0 THEN 'behind'
        WHEN g.scheduled_count > 0 THEN 'scheduled'
        WHEN g.on_track_count > 0 THEN 'on_track'
        WHEN g.ahead_count > 0 THEN 'ahead'
        WHEN g.completed_pace_count = g.enrollment_count AND g.enrollment_count > 0 THEN 'completed'
        ELSE 'not_yet_due'
      END AS calculated_pace_status
    FROM grouped g
  )
  SELECT c.id, c.name, c.programme_label, c.start_date, c.end_date,
    c.enrollment_count,
    false,  -- see header: named data and exact rollups of it are not size-gated
    c.required_units,
    c.completed_units,
    c.due_units,
    c.booked_units,
    c.overdue_units,
    CASE WHEN c.required_units = 0 THEN NULL ELSE round(least(c.completed_units, c.required_units) * 100.0 / c.required_units, 1) END,
    CASE WHEN c.due_units = 0 THEN NULL ELSE round(c.adherence_credited_units * 100.0 / c.due_units, 1) END,
    CASE WHEN c.due_units = 0 THEN NULL ELSE round(c.coverage_credited_units * 100.0 / c.due_units, 1) END,
    c.calculated_pace_status,
    c.active_count,
    c.at_risk_count,
    c.paused_count,
    c.completed_count,
    c.not_yet_due_count,
    c.ahead_count,
    c.on_track_count,
    c.scheduled_count,
    c.behind_count,
    c.completed_pace_count,
    CASE WHEN c.enrollment_count = 0 THEN NULL ELSE round(c.on_track_count * 100.0 / c.enrollment_count, 1) END,
    c.coaching_required_units,
    c.coaching_completed_units,
    c.coaching_due_units,
    c.coaching_booked_units,
    c.coaching_completed_leaders,
    c.training_required_units,
    c.training_completed_units,
    c.training_due_units,
    c.training_booked_units,
    c.training_completed_leaders,
    c.peer_required_units,
    c.peer_completed_units,
    c.peer_due_units,
    c.peer_booked_units,
    c.peer_completed_leaders,
    c.mentoring_required_units,
    c.mentoring_completed_units,
    c.mentoring_due_units,
    c.mentoring_booked_units,
    c.mentoring_completed_leaders,
    c.triad_required_units,
    c.triad_completed_units,
    c.triad_due_units,
    c.triad_booked_units,
    c.triad_completed_leaders,
    public.sponsor_canonical_programme_journey(c.id, p_as_of),
    c.source_row_count = c.enrollment_count,
    CASE WHEN s.rated_count = 0 THEN NULL ELSE round(s.weighted_sum / s.rated_count, 2) END,
    s.rated_count,
    c.adherence_credited_units,
    c.coverage_credited_units
  FROM calculated c
  CROSS JOIN satisfaction s
  ORDER BY c.name;
$function$;

REVOKE ALL ON FUNCTION public.sponsor_canonical_cohort_progress_one(uuid, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sponsor_canonical_cohort_progress_one(uuid, date) TO service_role;

CREATE OR REPLACE FUNCTION public.sponsor_canonical_cohort_progress(p_cohort_id uuid DEFAULT NULL::uuid, p_as_of date DEFAULT CURRENT_DATE)
 RETURNS TABLE(cohort_id uuid, cohort_label text, programme_label text, programme_start_date date, programme_end_date date, enrollment_count integer, suppressed boolean, required_units integer, completed_units integer, due_units integer, booked_units integer, overdue_units integer, full_completion_pct numeric, due_adherence_pct numeric, schedule_coverage_pct numeric, pace_status text, active_count integer, at_risk_count integer, paused_count integer, completed_count integer, not_yet_due_count integer, ahead_count integer, on_track_count integer, scheduled_count integer, behind_count integer, completed_pace_count integer, on_track_pct numeric, coaching_required_units integer, coaching_completed_units integer, coaching_due_units integer, coaching_booked_units integer, coaching_completed_leaders integer, training_required_units integer, training_completed_units integer, training_due_units integer, training_booked_units integer, training_completed_leaders integer, peer_required_units integer, peer_completed_units integer, peer_due_units integer, peer_booked_units integer, peer_completed_leaders integer, mentoring_required_units integer, mentoring_completed_units integer, mentoring_due_units integer, mentoring_booked_units integer, mentoring_completed_leaders integer, triad_required_units integer, triad_completed_units integer, triad_due_units integer, triad_booked_units integer, triad_completed_leaders integer, programme_journey jsonb, progress_source_complete boolean, satisfaction_avg numeric, satisfaction_rated_count integer, adherence_credited_units integer, coverage_credited_units integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  -- A cohort is listed for a sponsor iff it contains at least one of the
  -- sponsor's visible enrollments; each cohort row is computed one cohort at
  -- a time (bounded per-cohort path, 20260917150000).
  SELECT progress.*
  FROM (
    SELECT DISTINCT v.cohort_id
    FROM public.sponsor_visible_enrollments() v
    WHERE v.cohort_id IS NOT NULL
      AND (p_cohort_id IS NULL OR v.cohort_id = p_cohort_id)
  ) visible_cohort
  CROSS JOIN LATERAL public.sponsor_canonical_cohort_progress_one(visible_cohort.cohort_id, p_as_of) progress
  ORDER BY progress.cohort_label, progress.cohort_id;
$function$;

REVOKE ALL ON FUNCTION public.sponsor_canonical_cohort_progress(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sponsor_canonical_cohort_progress(uuid, date) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.sponsor_canonical_organisation_progress(p_as_of date DEFAULT CURRENT_DATE)
 RETURNS TABLE(cohort_count integer, enrollment_count integer, required_units integer, completed_units integer, due_units integer, booked_units integer, overdue_units integer, full_completion_pct numeric, due_adherence_pct numeric, schedule_coverage_pct numeric, coaching_required_units integer, coaching_completed_units integer, coaching_due_units integer, coaching_booked_units integer, training_required_units integer, training_completed_units integer, training_due_units integer, training_booked_units integer, peer_required_units integer, peer_completed_units integer, peer_due_units integer, peer_booked_units integer, mentoring_required_units integer, mentoring_completed_units integer, mentoring_due_units integer, mentoring_booked_units integer, triad_required_units integer, triad_completed_units integer, triad_due_units integer, triad_booked_units integer, suppressed_cohort_count integer, progress_source_complete boolean, active_count integer, at_risk_count integer, paused_count integer, completed_count integer, on_track_count integer, behind_count integer, satisfaction_avg numeric, satisfaction_rated_count integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  -- The organisation rollup is the sum of the sponsor's visible cohort rows,
  -- which are themselves rollups of the sponsor's visible enrollments only.
  WITH cohort_rows AS (
    SELECT *
    FROM public.sponsor_canonical_cohort_progress(NULL, p_as_of)
  ), totals AS (
    SELECT
      count(*)::integer AS cohort_count,
      coalesce(sum(c.enrollment_count), 0)::integer AS enrollment_count,
      sum(c.required_units)::integer AS required_units,
      sum(c.completed_units)::integer AS completed_units,
      sum(c.due_units)::integer AS due_units,
      sum(c.booked_units)::integer AS booked_units,
      -- Sums of the cohort rows, which are sums of their leaders (20261006130000).
      sum(c.overdue_units)::integer AS overdue_units,
      sum(c.adherence_credited_units)::integer AS adherence_credited_units,
      sum(c.coverage_credited_units)::integer AS coverage_credited_units,
      sum(c.coaching_required_units)::integer AS coaching_required_units,
      sum(c.coaching_completed_units)::integer AS coaching_completed_units,
      sum(c.coaching_due_units)::integer AS coaching_due_units,
      sum(c.coaching_booked_units)::integer AS coaching_booked_units,
      sum(c.training_required_units)::integer AS training_required_units,
      sum(c.training_completed_units)::integer AS training_completed_units,
      sum(c.training_due_units)::integer AS training_due_units,
      sum(c.training_booked_units)::integer AS training_booked_units,
      sum(c.peer_required_units)::integer AS peer_required_units,
      sum(c.peer_completed_units)::integer AS peer_completed_units,
      sum(c.peer_due_units)::integer AS peer_due_units,
      sum(c.peer_booked_units)::integer AS peer_booked_units,
      sum(c.mentoring_required_units)::integer AS mentoring_required_units,
      sum(c.mentoring_completed_units)::integer AS mentoring_completed_units,
      sum(c.mentoring_due_units)::integer AS mentoring_due_units,
      sum(c.mentoring_booked_units)::integer AS mentoring_booked_units,
      sum(c.triad_required_units)::integer AS triad_required_units,
      sum(c.triad_completed_units)::integer AS triad_completed_units,
      sum(c.triad_due_units)::integer AS triad_due_units,
      sum(c.triad_booked_units)::integer AS triad_booked_units,
      count(*) FILTER (WHERE c.suppressed)::integer AS suppressed_cohort_count,
      coalesce(bool_and(c.progress_source_complete), false) AS progress_source_complete,
      coalesce(sum(c.active_count), 0)::integer AS active_count,
      coalesce(sum(c.at_risk_count), 0)::integer AS at_risk_count,
      coalesce(sum(c.paused_count), 0)::integer AS paused_count,
      coalesce(sum(c.completed_count), 0)::integer AS completed_count,
      coalesce(sum(c.on_track_count), 0)::integer AS on_track_count,
      coalesce(sum(c.behind_count), 0)::integer AS behind_count
    FROM cohort_rows c
  ), satisfaction AS (
    -- Same rating-weighted rule as the cohort rows, over the same visible
    -- enrollments (those in a cohort), computed from the unrounded source.
    SELECT
      sum(g.satisfaction_avg * g.satisfaction_rated_count)
        FILTER (WHERE g.satisfaction_avg IS NOT NULL AND g.satisfaction_rated_count > 0) AS weighted_sum,
      coalesce(sum(g.satisfaction_rated_count)
        FILTER (WHERE g.satisfaction_avg IS NOT NULL AND g.satisfaction_rated_count > 0), 0)::integer AS rated_count
    FROM public.sponsor_visible_enrollments() v
    CROSS JOIN LATERAL public.canonical_enrollment_engagement(v.enrollment_id) g
    WHERE v.cohort_id IS NOT NULL
  )
  SELECT t.cohort_count, t.enrollment_count,
    t.required_units, t.completed_units, t.due_units, t.booked_units,
    t.overdue_units,
    CASE WHEN t.required_units = 0 THEN NULL ELSE round(least(t.completed_units, t.required_units) * 100.0 / t.required_units, 1) END,
    CASE WHEN t.due_units = 0 THEN NULL ELSE round(t.adherence_credited_units * 100.0 / t.due_units, 1) END,
    CASE WHEN t.due_units = 0 THEN NULL ELSE round(t.coverage_credited_units * 100.0 / t.due_units, 1) END,
    t.coaching_required_units, t.coaching_completed_units, t.coaching_due_units, t.coaching_booked_units,
    t.training_required_units, t.training_completed_units, t.training_due_units, t.training_booked_units,
    t.peer_required_units, t.peer_completed_units, t.peer_due_units, t.peer_booked_units,
    t.mentoring_required_units, t.mentoring_completed_units, t.mentoring_due_units, t.mentoring_booked_units,
    t.triad_required_units, t.triad_completed_units, t.triad_due_units, t.triad_booked_units,
    t.suppressed_cohort_count, t.progress_source_complete,
    t.active_count, t.at_risk_count, t.paused_count, t.completed_count,
    t.on_track_count, t.behind_count,
    CASE WHEN s.rated_count = 0 THEN NULL ELSE round(s.weighted_sum / s.rated_count, 2) END,
    s.rated_count
  FROM totals t
  CROSS JOIN satisfaction s;
$function$;

-- ---------------------------------------------------------------------------
-- 3. Triad state from the requirement calendar
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.canonical_triad_completion(p_enrollment_id uuid, p_as_of date DEFAULT CURRENT_DATE)
 RETURNS TABLE(enrollment_id uuid, programme_id uuid, cohort_id uuid, required_units integer, raw_completed_sessions integer, completed_by_as_of integer, completed_units integer, due_units integer, overdue_units integer, booked_units integer, pace_status text, next_due_on date, schedule jsonb)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH e AS (
    SELECT pe.id, pe.programme_id, pe.cohort_id FROM public.programme_enrollments pe WHERE pe.id = p_enrollment_id
  ), progress AS (
    SELECT p.* FROM public.canonical_module_progress(p_enrollment_id, p_as_of) p
    WHERE p.module = 'triads'::public.programme_module_type
  ), raw AS (
    SELECT count(DISTINCT s.id)::integer AS sessions
    FROM public.session_activity_attributions a
    JOIN public.triad_sessions s ON s.id = a.source_activity_id AND s.status = 'completed'
    WHERE a.enrollment_id = p_enrollment_id AND a.source_activity_type = 'triad' AND a.occurred_on <= p_as_of
  ), fulfil AS (
    SELECT f.*,
      (SELECT g.id FROM public.triad_groups g JOIN public.triad_group_members m ON m.triad_group_id = g.id
       WHERE g.cohort_requirement_date_id = f.cohort_requirement_date_id AND m.enrollment_id = p_enrollment_id
       ORDER BY g.is_active DESC, g.created_at DESC LIMIT 1) AS triad_group_id
    FROM public.canonical_triad_requirement_fulfilment(p_enrollment_id) f
  ), cal AS (
    -- Per-requirement state is the requirement calendar's (20261006130000):
    -- due = due_on <= as_of, overdue = due_on < as_of and still open.
    SELECT c.* FROM public.canonical_enrollment_requirement_calendar(p_enrollment_id, p_as_of) c
    WHERE c.module = 'triads'::public.programme_module_type
  )
  SELECT e.id, e.programme_id, e.cohort_id,
    coalesce(p.required_units, 0),
    r.sessions,
    coalesce(p.completed_activity_units, 0),
    coalesce(p.completed_units, 0),
    coalesce(p.due_units, 0),
    coalesce(p.overdue_units, 0),
    coalesce(p.booked_units, 0),
    coalesce(p.pace_status, 'not_required'),
    (SELECT min(c.due_on) FROM cal c WHERE NOT c.is_completed),
    coalesce((SELECT jsonb_agg(jsonb_build_object(
        'milestone', f.unit_number,
        'cohort_requirement_date_id', f.cohort_requirement_date_id,
        'due_on', f.due_on,
        'training_week_id', (SELECT d.training_week_id FROM public.cohort_requirement_dates d WHERE d.id = f.cohort_requirement_date_id),
        'is_due', coalesce(c.is_due_as_of, false),
        'fulfilled', coalesce(c.is_completed, false),
        -- this requirement is fulfilled (by its own group's session), never cumulative
        'satisfied', coalesce(c.is_completed, false),
        'fulfilled_on', c.completed_on,
        'overdue', coalesce(c.is_overdue, false),
        'triad_group_id', f.triad_group_id)
      ORDER BY f.unit_number)
      FROM fulfil f LEFT JOIN cal c ON c.requirement_id = f.cohort_requirement_date_id
      WHERE f.unit_number <= coalesce(p.required_units, 0)), '[]'::jsonb)
  FROM e
  CROSS JOIN raw r
  LEFT JOIN progress p ON true;
$function$;

CREATE OR REPLACE FUNCTION public.triad_requirement_learners_internal(p_cohort_requirement_date_id uuid, p_as_of date DEFAULT CURRENT_DATE)
 RETURNS TABLE(cohort_requirement_date_id uuid, unit_number integer, due_on date, enrollment_id uuid, user_id uuid, full_name text, spoken_languages text[], enrollment_status enrollment_status, is_eligible boolean, triad_group_id uuid, open_session_status text, fulfilled boolean, fulfilled_on date, overdue boolean, prior_partner_enrollment_ids uuid[], prior_partner_names text[])
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH req AS (
    SELECT d.* FROM public.cohort_requirement_dates d
    WHERE d.id = p_cohort_requirement_date_id AND d.module = 'triads'::public.programme_module_type
  ), assigned AS (
    SELECT DISTINCT ON (m.enrollment_id) m.enrollment_id, g.id AS triad_group_id
    FROM req JOIN public.triad_groups g ON g.cohort_requirement_date_id = req.id AND g.is_active
    JOIN public.triad_group_members m ON m.triad_group_id = g.id
    ORDER BY m.enrollment_id, g.created_at DESC
  ), pop AS (
    SELECT e.* FROM req JOIN public.programme_enrollments e ON e.cohort_id = req.cohort_id AND e.programme_id = req.programme_id
    WHERE e.status IN ('active', 'at_risk', 'paused') OR e.id IN (SELECT enrollment_id FROM assigned)
  )
  SELECT req.id, req.ordinal, req.due_on, e.id, e.user_id, pr.full_name, coalesce(pr.spoken_languages, ARRAY[]::text[]),
    e.status, e.status IN ('active', 'at_risk', 'paused'),
    a.triad_group_id,
    (SELECT s.status FROM public.triad_sessions s WHERE s.triad_group_id = a.triad_group_id AND s.status IN ('proposed', 'confirmed') LIMIT 1),
    -- Per-requirement state is the requirement calendar's (20261006130000).
    coalesce(f.is_completed, false),
    f.completed_on,
    coalesce(f.is_overdue, false),
    coalesce(pp.ids, ARRAY[]::uuid[]), coalesce(pp.names, ARRAY[]::text[])
  FROM req
  CROSS JOIN pop e
  JOIN public.profiles pr ON pr.id = e.user_id
  LEFT JOIN assigned a ON a.enrollment_id = e.id
  LEFT JOIN LATERAL (
    SELECT x.is_completed, x.completed_on, x.is_overdue
    FROM public.canonical_enrollment_requirement_calendar(e.id, p_as_of) x
    WHERE x.requirement_id = req.id
  ) f ON true
  LEFT JOIN LATERAL (
    SELECT array_agg(DISTINCT om.enrollment_id) AS ids, array_agg(DISTINCT opr.full_name) AS names
    FROM public.triad_group_members mm
    JOIN public.triad_groups og ON og.id = mm.triad_group_id AND og.cohort_id = req.cohort_id
      AND og.cohort_requirement_date_id <> req.id
    JOIN public.triad_group_members om ON om.triad_group_id = og.id AND om.enrollment_id <> e.id
    JOIN public.programme_enrollments oe ON oe.id = om.enrollment_id
    JOIN public.profiles opr ON opr.id = oe.user_id
    WHERE mm.enrollment_id = e.id
  ) pp ON true
  ORDER BY pr.full_name, e.id;
$function$;

-- ---------------------------------------------------------------------------
-- 4. Overdue quiz / reflection reminders
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.training_overdue_assignment_targets_internal(
  p_as_of date DEFAULT (now() AT TIME ZONE public.programme_time_zone())::date)
 RETURNS TABLE(user_id uuid, enrollment_id uuid, assignment_id uuid, training_week_id uuid, assignment_type text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH enrollments AS (
    SELECT e.id, e.user_id FROM public.programme_enrollments e
    WHERE e.status IN ('active'::public.enrollment_status, 'at_risk'::public.enrollment_status)
      AND e.cohort_id IS NOT NULL
  ), overdue_weeks AS (
    -- The Training requirement of the week is overdue (the calendar's rule).
    SELECT e.id AS enrollment_id, e.user_id, c.training_week_id
    FROM enrollments e
    CROSS JOIN LATERAL public.canonical_enrollment_requirement_calendar(e.id, p_as_of) c
    WHERE c.module = 'training'::public.programme_module_type AND c.is_overdue
  ), weeks AS (
    SELECT o.enrollment_id, o.user_id, w.*
    FROM (SELECT DISTINCT enrollment_id, user_id FROM overdue_weeks) o
    CROSS JOIN LATERAL public.canonical_training_week_fulfilment(o.enrollment_id, p_as_of) w
    WHERE EXISTS (SELECT 1 FROM overdue_weeks x
                  WHERE x.enrollment_id = o.enrollment_id AND x.training_week_id = w.training_week_id)
  )
  -- The part of the week still missing: its quiz and/or its reflection.
  SELECT w.user_id, w.enrollment_id, a.id, a.training_week_id, a.assignment_type::text
  FROM weeks w
  JOIN public.assignments a ON a.training_week_id = w.training_week_id AND a.is_visible
  WHERE (a.assignment_type = 'quiz' AND w.quiz_required AND NOT w.quiz_completed)
     OR (a.assignment_type = 'reflection' AND w.reflection_required AND NOT w.reflection_completed);
$function$;
REVOKE ALL ON FUNCTION public.training_overdue_assignment_targets_internal(date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.training_overdue_assignment_targets_internal(date) TO service_role;

-- ---------------------------------------------------------------------------
-- 5. Today's daily prompt, per enrollment
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.daily_prompt_for_enrollment_internal(p_enrollment_id uuid, p_as_of date)
 RETURNS TABLE(prompt_id uuid, prompt_text text, prompt_text_vi text, training_week_id uuid, week_number integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH week AS (
    -- The enrollment's current Training week: the latest visible week its
    -- own calendar has unlocked (cohort override, else computed, else the
    -- week's own date -- canonical_training_week_fulfilment).
    SELECT w.training_week_id, w.week_number, w.unlock_on
    FROM public.canonical_training_week_fulfilment(p_enrollment_id, p_as_of) w
    JOIN public.training_weeks tw ON tw.id = w.training_week_id AND tw.is_visible
    WHERE w.unlock_on IS NOT NULL AND w.unlock_on <= p_as_of
    ORDER BY w.week_number DESC
    LIMIT 1
  )
  SELECT dp.id, dp.prompt_text, dp.prompt_text_vi, week.training_week_id, week.week_number
  FROM week
  JOIN public.programme_enrollments e ON e.id = p_enrollment_id
  JOIN public.programme_modules pm ON pm.programme_id = e.programme_id
    AND pm.module = 'daily_prompt'::public.programme_module_type AND pm.enabled
  JOIN public.daily_prompts dp ON dp.training_week_id = week.training_week_id
    AND dp.is_visible
    -- day_offset NULL = any day of the week; a day-pinned prompt wins.
    AND (dp.day_offset IS NULL OR dp.day_offset = least(7, greatest(1, (p_as_of - week.unlock_on) + 1)))
  ORDER BY dp.day_offset NULLS LAST, dp.sort_order
  LIMIT 1;
$function$;
REVOKE ALL ON FUNCTION public.daily_prompt_for_enrollment_internal(uuid, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.daily_prompt_for_enrollment_internal(uuid, date) TO service_role;

CREATE OR REPLACE FUNCTION public.daily_prompt_targets_internal(
  p_as_of date DEFAULT (now() AT TIME ZONE public.programme_time_zone())::date)
 RETURNS TABLE(enrollment_id uuid, user_id uuid, prompt_id uuid, prompt_text text, prompt_text_vi text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT e.id, e.user_id, p.prompt_id, p.prompt_text, p.prompt_text_vi
  FROM public.programme_enrollments e
  CROSS JOIN LATERAL public.daily_prompt_for_enrollment_internal(e.id, p_as_of) p
  WHERE e.status IN ('active'::public.enrollment_status, 'at_risk'::public.enrollment_status,
                     'paused'::public.enrollment_status)
    -- Already sent: send-daily-prompt seeds one response row per enrollment
    -- (older rows carry only the user).
    AND NOT EXISTS (SELECT 1 FROM public.daily_prompt_responses r
                    WHERE r.daily_prompt_id = p.prompt_id
                      AND (r.enrollment_id = e.id OR (r.enrollment_id IS NULL AND r.user_id = e.user_id)));
$function$;
REVOKE ALL ON FUNCTION public.daily_prompt_targets_internal(date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.daily_prompt_targets_internal(date) TO service_role;

-- The in-app prompt is the same answer for the caller's active enrollment.
CREATE OR REPLACE FUNCTION public.get_todays_prompt()
 RETURNS TABLE(prompt_id uuid, prompt_text text, prompt_text_vi text, week_number integer, week_title text, week_title_vi text, already_responded boolean, response_text text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH todays AS (
    SELECT p.*
    FROM public.programme_enrollments e
    CROSS JOIN LATERAL public.daily_prompt_for_enrollment_internal(
      e.id, (now() AT TIME ZONE public.programme_time_zone())::date) p
    WHERE e.user_id = auth.uid() AND e.status = 'active'
    ORDER BY p.week_number DESC
    LIMIT 1
  )
  SELECT t.prompt_id, t.prompt_text, t.prompt_text_vi, tw.week_number, tw.title, tw.title_vi,
    (dpr.id IS NOT NULL AND dpr.responded_at IS NOT NULL), dpr.response_text
  FROM todays t
  JOIN public.training_weeks tw ON tw.id = t.training_week_id
  LEFT JOIN public.daily_prompt_responses dpr ON dpr.daily_prompt_id = t.prompt_id AND dpr.user_id = auth.uid();
$function$;
