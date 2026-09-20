-- Coaching cutover: production impact report (READ-ONLY, PRE-DEPLOYMENT).
--
-- Run this against production BEFORE deploying the Coaching/Mentoring
-- migrations. It needs none of the new schema: it works entirely from columns
-- that exist today, and projects what canonical progress WILL report.
--
--   psql "$PROD_DB_URL" -v ON_ERROR_STOP=1 -f scripts/coaching-cutover-impact.sql
--
-- Nothing is written. No narrative is selected: enrollments are identified by
-- id and by counts only, never by what anybody wrote.
--
-- What changes, and why the numbers move
-- --------------------------------------
-- Today   Coaching completion counts completed sessions attributed to the
--         enrollment, capped at the programme requirement.
--
-- After   Completion counts cohort Coaching REQUIREMENTS fulfilled by a
--         completed session attributed to them (20260920130000 +
--         20260921130000), and 20260921180000 attributes existing sessions
--         deterministically: the Nth completed/live session of an enrollment,
--         in chronological order, fulfils the Nth Coaching requirement of its
--         cohort.
--
-- Two consequences follow, and this report separates them:
--
--   * a session becomes countable even when its post-session write-up is
--     incomplete (evidence no longer gates completion) -- progress goes UP;
--   * an enrollment cannot complete more units than its cohort has SCHEDULED,
--     so where a cohort schedules fewer Coaching requirements than the
--     programme requires, progress goes DOWN. That mismatch is real and is
--     surfaced by cohort_requirement_schedule_issues; fix the cohort schedule
--     to restore those units. The sessions are retained as raw activity either
--     way.
--
-- Section 3 is the one to act on before deploying.

BEGIN TRANSACTION READ ONLY;

\echo '== 1. Per-enrollment projection: today vs after the cutover'
WITH req AS (
  SELECT e.id AS enrollment_id,
    coalesce(nullif(pm.config->>'required_units', '')::int, 0) AS required_units,
    (SELECT count(*)::int FROM public.cohort_requirement_dates d
      WHERE d.cohort_id = e.cohort_id AND d.programme_id = e.programme_id
        AND d.module = 'coaching'::public.programme_module_type) AS scheduled_requirements,
    (SELECT count(*)::int FROM public.sessions s
      WHERE s.enrollment_id = e.id AND s.status = 'completed'
        AND (s.start_time AT TIME ZONE 'UTC')::date <= current_date) AS completed_sessions
  FROM public.programme_enrollments e
  LEFT JOIN public.programme_modules pm
    ON pm.programme_id = e.programme_id
   AND pm.module = 'coaching'::public.programme_module_type
), projected AS (
  SELECT r.*,
    least(r.completed_sessions, r.required_units) AS today_completed_units,
    least(r.completed_sessions, r.scheduled_requirements) AS after_completed_units
  FROM req r
)
SELECT p.enrollment_id, p.required_units, p.scheduled_requirements,
  p.completed_sessions, p.today_completed_units, p.after_completed_units,
  p.after_completed_units - p.today_completed_units AS delta,
  CASE
    WHEN p.after_completed_units > p.today_completed_units
      THEN 'gain: evidence no longer gates a held session'
    WHEN p.scheduled_requirements < p.required_units
      THEN 'LOSS: cohort schedules fewer Coaching requirements than the programme requires'
    ELSE 'LOSS: unexplained -- investigate before deploying'
  END AS reason
FROM projected p
WHERE p.after_completed_units <> p.today_completed_units
ORDER BY (p.after_completed_units - p.today_completed_units), p.enrollment_id;

\echo '== 2. Totals'
WITH req AS (
  SELECT e.id AS enrollment_id,
    coalesce(nullif(pm.config->>'required_units', '')::int, 0) AS required_units,
    (SELECT count(*)::int FROM public.cohort_requirement_dates d
      WHERE d.cohort_id = e.cohort_id AND d.programme_id = e.programme_id
        AND d.module = 'coaching'::public.programme_module_type) AS scheduled_requirements,
    (SELECT count(*)::int FROM public.sessions s
      WHERE s.enrollment_id = e.id AND s.status = 'completed'
        AND (s.start_time AT TIME ZONE 'UTC')::date <= current_date) AS completed_sessions
  FROM public.programme_enrollments e
  LEFT JOIN public.programme_modules pm
    ON pm.programme_id = e.programme_id
   AND pm.module = 'coaching'::public.programme_module_type
), projected AS (
  SELECT r.*, least(r.completed_sessions, r.required_units) AS today_u,
    least(r.completed_sessions, r.scheduled_requirements) AS after_u
  FROM req r
)
SELECT count(*) FILTER (WHERE after_u > today_u) AS enrollments_gaining,
  count(*) FILTER (WHERE after_u < today_u) AS enrollments_losing,
  coalesce(sum(today_u), 0) AS total_units_today,
  coalesce(sum(after_u), 0) AS total_units_after
FROM projected;

\echo '== 3. BLOCKER CHECK: cohorts scheduling fewer Coaching requirements than required'
\echo '   Fix these cohort schedules before deploying, or those learners lose units.'
SELECT c.id AS cohort_id, c.name AS cohort_name,
  coalesce(nullif(pm.config->>'required_units', '')::int, 0) AS programme_requires,
  count(d.id)::int AS cohort_schedules,
  (SELECT count(*)::int FROM public.programme_enrollments e
    WHERE e.cohort_id = c.id AND e.programme_id = pm.programme_id) AS affected_enrollments
FROM public.cohorts c
JOIN public.programme_modules pm
  ON pm.programme_id = c.programme_id
 AND pm.module = 'coaching'::public.programme_module_type
 AND pm.enabled
LEFT JOIN public.cohort_requirement_dates d
  ON d.cohort_id = c.id AND d.programme_id = pm.programme_id
 AND d.module = 'coaching'::public.programme_module_type
GROUP BY c.id, c.name, pm.config, pm.programme_id
HAVING count(d.id) < coalesce(nullif(pm.config->>'required_units', '')::int, 0)
ORDER BY affected_enrollments DESC, c.name;

\echo '== 4. Sessions that will remain raw activity (attributable to no requirement)'
WITH ranked AS (
  SELECT s.id, s.enrollment_id,
    row_number() OVER (PARTITION BY s.enrollment_id ORDER BY s.start_time, s.id) AS rn
  FROM public.sessions s
  WHERE s.enrollment_id IS NOT NULL
    AND s.status IN ('pending_coach_approval', 'confirmed', 'completed')
)
SELECT count(*) AS sessions_left_unattributed,
  count(DISTINCT r.enrollment_id) AS affected_enrollments
FROM ranked r
JOIN public.programme_enrollments e ON e.id = r.enrollment_id
WHERE r.rn > (
  SELECT count(*) FROM public.cohort_requirement_dates d
  WHERE d.cohort_id = e.cohort_id AND d.programme_id = e.programme_id
    AND d.module = 'coaching'::public.programme_module_type);

ROLLBACK;
