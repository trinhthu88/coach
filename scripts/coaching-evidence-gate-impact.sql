-- Coaching evidence-gate removal: migration impact report (READ-ONLY).
--
-- 20260921130000 stopped after-session evidence from gating programme
-- completion. A Coaching requirement is now fulfilled by a COMPLETED session
-- attributed to it; before, all four learner evidence items had to exist too.
--
-- Every learner whose sessions were held but not fully written up therefore
-- sees their Coaching progress INCREASE on deployment. That is the corrected
-- rule, not a defect -- but it is user-visible, so it must be known in advance.
--
-- Run BEFORE deploying, against the target:
--   psql "$TARGET_DB_URL" -v ON_ERROR_STOP=1 -f scripts/coaching-evidence-gate-impact.sql
--
-- Nothing is written. No narrative content is selected: the report names
-- enrollments and counts, never what anybody wrote.

BEGIN TRANSACTION READ ONLY;

\echo '== 1. Per-enrollment impact: old (evidence-gated) vs new (lifecycle) completed units'
WITH held AS (
  -- Every Coaching requirement whose session is completed. This is the NEW
  -- fulfilment rule.
  SELECT s.enrollment_id, s.cohort_requirement_id, s.id AS session_id
  FROM public.sessions s
  WHERE s.status = 'completed'
    AND s.cohort_requirement_id IS NOT NULL
), evidenced AS (
  -- The subset that ALSO satisfied all four evidence items, i.e. what the old
  -- rule counted. Reproduced here rather than called, because the gated
  -- function no longer exists after the migration.
  SELECT h.*,
    EXISTS (SELECT 1 FROM public.session_learning_reflections r
             WHERE r.enrollment_id = h.enrollment_id
               AND r.source_activity_type = 'coaching' AND r.source_activity_id = h.session_id) AS has_reflection,
    EXISTS (SELECT 1 FROM public.goal_checkins c
             WHERE c.enrollment_id = h.enrollment_id
               AND c.source_activity_type = 'coaching' AND c.source_activity_id = h.session_id) AS has_checkin,
    EXISTS (SELECT 1 FROM public.enrollment_actions a
             WHERE a.enrollment_id = h.enrollment_id
               AND a.source_activity_type = 'coaching' AND a.source_activity_id = h.session_id) AS has_action,
    EXISTS (SELECT 1 FROM public.sessions x
             WHERE x.id = h.session_id AND x.coachee_rating IS NOT NULL) AS has_rating,
    EXISTS (SELECT 1 FROM public.coachee_goals g
             WHERE g.enrollment_id = h.enrollment_id AND g.status = 'active') AS checkin_applicable
  FROM held h
), scored AS (
  SELECT e.enrollment_id,
    count(*)::int AS held_requirements,
    count(*) FILTER (
      WHERE e.has_reflection AND e.has_action AND e.has_rating
        AND (NOT e.checkin_applicable OR e.has_checkin))::int AS fully_evidenced
  FROM evidenced e
  GROUP BY e.enrollment_id
), capped AS (
  SELECT s.enrollment_id,
    coalesce(nullif(pm.config->>'required_units', '')::int, 0) AS required_units,
    least(s.fully_evidenced, coalesce(nullif(pm.config->>'required_units', '')::int, 0)) AS old_completed_units,
    least(s.held_requirements, coalesce(nullif(pm.config->>'required_units', '')::int, 0)) AS new_completed_units,
    s.held_requirements, s.fully_evidenced
  FROM scored s
  JOIN public.programme_enrollments pe ON pe.id = s.enrollment_id
  LEFT JOIN public.programme_modules pm
    ON pm.programme_id = pe.programme_id AND pm.module = 'coaching'::public.programme_module_type
)
SELECT c.enrollment_id,
  c.required_units,
  c.old_completed_units,
  c.new_completed_units,
  c.new_completed_units - c.old_completed_units AS delta,
  c.held_requirements,
  c.fully_evidenced,
  'held sessions previously withheld for missing evidence' AS reason
FROM capped c
WHERE c.new_completed_units > c.old_completed_units
ORDER BY delta DESC, c.enrollment_id;

\echo '== 2. Totals'
WITH held AS (
  SELECT s.enrollment_id, s.cohort_requirement_id, s.id AS session_id
  FROM public.sessions s
  WHERE s.status = 'completed' AND s.cohort_requirement_id IS NOT NULL
), evidenced AS (
  SELECT h.enrollment_id,
    (EXISTS (SELECT 1 FROM public.session_learning_reflections r
              WHERE r.enrollment_id = h.enrollment_id
                AND r.source_activity_type = 'coaching' AND r.source_activity_id = h.session_id)
     AND EXISTS (SELECT 1 FROM public.enrollment_actions a
              WHERE a.enrollment_id = h.enrollment_id
                AND a.source_activity_type = 'coaching' AND a.source_activity_id = h.session_id)
     AND EXISTS (SELECT 1 FROM public.sessions x
              WHERE x.id = h.session_id AND x.coachee_rating IS NOT NULL)) AS fully
  FROM held h
)
SELECT count(DISTINCT enrollment_id) AS enrollments_with_held_coaching,
  count(*) AS held_requirements_total,
  count(*) FILTER (WHERE fully) AS previously_counted,
  count(*) FILTER (WHERE NOT fully) AS newly_counted
FROM evidenced;

\echo '== 3. Unattributable Coaching sessions (counted by neither rule; raw activity only)'
SELECT count(*) AS sessions_without_requirement,
  count(DISTINCT enrollment_id) AS affected_enrollments
FROM public.sessions
WHERE cohort_requirement_id IS NULL
  AND status = 'completed';

ROLLBACK;
