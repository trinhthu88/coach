-- Triad cutover readiness report (READ-ONLY).
--
-- Run against the target database BEFORE deploying deployment 1
-- (20260918185800 .. 20260918195000; legacy Triad columns still present):
--   psql "$TARGET_DB_URL" -v ON_ERROR_STOP=1 -f scripts/triad-cutover-readiness.sql
-- (or section by section through the Management API read-only endpoint).
--
-- It mirrors 20260918185900_triad_legacy_data_cleanup (section 2, same
-- classification reused by sections 3 and 5) and the cutover's validation
-- (section 3). The deployment is ready only when
-- section 2 has no REAL/UNKNOWN row without a reviewed decision and every
-- section 3 list is empty. Nothing is written. Functions are inlined: the
-- read-only role cannot execute application functions.

BEGIN TRANSACTION READ ONLY;

\echo '== 1. Inventory'
SELECT (SELECT count(*) FROM public.triad_groups) AS groups,
  (SELECT count(*) FROM public.triad_sessions) AS sessions,
  (SELECT count(*) FROM public.triad_sessions WHERE status = 'completed') AS completed_sessions,
  (SELECT count(*) FROM public.triad_alternative_proposals) AS proposals,
  (SELECT count(*) FROM public.triad_reflections) AS reflections,
  (SELECT count(*) FROM public.goal_checkins WHERE source_activity_type = 'triad') AS triad_goal_checkins,
  (SELECT count(*) FROM public.session_activity_attributions WHERE source_activity_type = 'triad') AS triad_evidence,
  (SELECT count(*) FROM public.triad_rounds) AS legacy_rounds,
  (SELECT count(*) FROM public.programme_triad_rounds) AS legacy_programme_rounds;

\echo '== 2. Conflicting legacy Triad records (cleanup 20260918185900): DEMO/SEED are removed; REAL/UNKNOWN block without a reviewed decision'
WITH facts AS (
  SELECT g.id AS triad_group_id,
    g.id::text ~ '^[0-9a-f]{8}-0000-0000-0000-[0-9a-f]{12}$' AS seed_group_id,
    o.name = 'Clariva Demo Organization' AS demo_organization,
    (SELECT bool_and(u.email ILIKE '%@demo.clariva.club')
     FROM (VALUES (g.member_1_id), (g.member_2_id), (g.member_3_id)) m(user_id) JOIN auth.users u ON u.id = m.user_id) AS all_members_demo_accounts,
    EXISTS (SELECT 1 FROM public.triad_sessions s JOIN public.goal_checkins gc ON gc.source_activity_type = 'triad' AND gc.source_activity_id = s.id
            WHERE s.triad_group_id = g.id) AS has_goal_checkins,
    o.name AS organization, c.name AS cohort
  FROM public.triad_groups g
  LEFT JOIN public.cohorts c ON c.id = g.cohort_id
  LEFT JOIN public.organizations o ON o.id = c.organization_id
), conflicts AS (
  SELECT g.id AS triad_group_id, NULL::uuid AS triad_session_id, 'group_outside_cohort'::text AS conflict
  FROM public.triad_groups g
  WHERE g.cohort_id IS NULL OR g.enrollment_1_id IS NULL OR g.enrollment_2_id IS NULL
     OR EXISTS (
       SELECT 1 FROM (VALUES (g.member_1_id, g.enrollment_1_id), (g.member_2_id, g.enrollment_2_id), (g.member_3_id, g.enrollment_3_id)) slot(user_id, enrollment_id)
       LEFT JOIN public.programme_enrollments e ON e.id = slot.enrollment_id
       WHERE (slot.user_id IS NULL) <> (slot.enrollment_id IS NULL)
          OR (slot.enrollment_id IS NOT NULL AND (e.id IS NULL OR e.user_id <> slot.user_id
               OR e.cohort_id IS DISTINCT FROM g.cohort_id OR e.programme_id IS DISTINCT FROM g.programme_id)))
  UNION ALL
  SELECT g.id, NULL, 'no_programme_triad_requirement'
  FROM public.triad_groups g
  WHERE NOT EXISTS (
    SELECT 1 FROM public.programme_modules pm
    WHERE pm.programme_id = g.programme_id AND pm.module = 'triads' AND pm.enabled
      AND coalesce((pm.config->>'required')::boolean, false)
      AND coalesce(nullif(pm.config->>'required_units', '')::integer, 0) > 0)
  UNION ALL
  SELECT DISTINCT s.triad_group_id, NULL::uuid, 'reflection_on_open_session'
  FROM public.triad_reflections r JOIN public.triad_sessions s ON s.id = r.triad_session_id WHERE s.status <> 'completed'
  UNION ALL
  SELECT DISTINCT s.triad_group_id, NULL::uuid, 'future_reflection'
  FROM public.triad_reflections r JOIN public.triad_sessions s ON s.id = r.triad_session_id WHERE r.submitted_at > now()
  UNION ALL
  SELECT s.triad_group_id, s.id, 'duplicate_completed_session'
  FROM public.triad_sessions s
  WHERE s.status = 'completed'
    AND EXISTS (SELECT 1 FROM public.triad_sessions o
                WHERE o.triad_group_id = s.triad_group_id AND o.status = 'completed' AND o.id < s.id
                  AND coalesce(o.proposed_start_time, o.start_time) IS NOT DISTINCT FROM coalesce(s.proposed_start_time, s.start_time))
    AND NOT EXISTS (SELECT 1 FROM public.triad_reflections r WHERE r.triad_session_id = s.id)
    AND NOT EXISTS (SELECT 1 FROM public.goal_checkins gc WHERE gc.source_activity_type = 'triad' AND gc.source_activity_id = s.id)
)
SELECT c.triad_group_id, c.triad_session_id, string_agg(DISTINCT c.conflict, ', ') AS conflicts,
  CASE WHEN f.has_goal_checkins THEN 'REAL/UNKNOWN'
       WHEN f.seed_group_id OR coalesce(f.demo_organization, false) OR coalesce(f.all_members_demo_accounts, false) THEN 'DEMO/SEED'
       ELSE 'REAL/UNKNOWN' END AS classification,
  jsonb_strip_nulls(jsonb_build_object('seed_group_id', f.seed_group_id, 'demo_organization', f.demo_organization,
    'all_members_demo_accounts', f.all_members_demo_accounts, 'organization', f.organization, 'cohort', f.cohort)) AS evidence,
  (to_regclass('public.triad_cutover_review_decisions') IS NOT NULL) AS decision_ledger_exists
FROM conflicts c JOIN facts f ON f.triad_group_id = c.triad_group_id
GROUP BY c.triad_group_id, c.triad_session_id, f.has_goal_checkins, f.seed_group_id, f.demo_organization, f.all_members_demo_accounts, f.organization, f.cohort
ORDER BY 4 DESC, 1, 2;

\echo '== 2b. Evidence for every conflicting group: members, sessions, reflections, goal check-ins, legacy round'
SELECT g.id AS triad_group_id, g.name, g.assigned_by, g.created_at, c.name AS cohort, o.name AS organization,
  (SELECT jsonb_agg(jsonb_build_object('enrollment', e.id, 'enrollment_cohort', e.cohort_id, 'enrollment_programme', e.programme_id,
            'status', e.status, 'email_domain', split_part(u.email, '@', 2)) ORDER BY x.n)
   FROM (VALUES (1, g.enrollment_1_id), (2, g.enrollment_2_id), (3, g.enrollment_3_id)) x(n, e)
   JOIN public.programme_enrollments e ON e.id = x.e LEFT JOIN auth.users u ON u.id = e.user_id) AS members,
  (SELECT jsonb_agg(jsonb_build_object('session', s.id, 'status', s.status, 'time', coalesce(s.proposed_start_time, s.start_time),
            'created', s.created_at, 'updated', s.updated_at,
            'reflections', (SELECT count(*) FROM public.triad_reflections r WHERE r.triad_session_id = s.id),
            'goal_checkins', (SELECT count(*) FROM public.goal_checkins gc WHERE gc.source_activity_type = 'triad' AND gc.source_activity_id = s.id))
          ORDER BY coalesce(s.proposed_start_time, s.start_time))
   FROM public.triad_sessions s WHERE s.triad_group_id = g.id) AS sessions,
  (SELECT jsonb_build_object('round', tr.round_number, 'deadline', tr.completion_deadline) FROM public.triad_rounds tr WHERE tr.id = g.triad_round_id) AS legacy_round
FROM public.triad_groups g
LEFT JOIN public.cohorts c ON c.id = g.cohort_id
LEFT JOIN public.organizations o ON o.id = c.organization_id
WHERE g.cohort_id IS NULL
   OR g.id::text ~ '^[0-9a-f]{8}-0000-0000-0000-[0-9a-f]{12}$'
   OR EXISTS (SELECT 1 FROM public.triad_sessions s JOIN public.triad_reflections r ON r.triad_session_id = s.id
              WHERE s.triad_group_id = g.id AND (s.status <> 'completed' OR r.submitted_at > now()))
   OR EXISTS (SELECT 1 FROM (VALUES (g.enrollment_1_id), (g.enrollment_2_id), (g.enrollment_3_id)) x(e)
              JOIN public.programme_enrollments e ON e.id = x.e
              WHERE e.cohort_id IS DISTINCT FROM g.cohort_id OR e.programme_id IS DISTINCT FROM g.programme_id)
   OR EXISTS (SELECT 1 FROM public.triad_sessions s WHERE s.triad_group_id = g.id AND s.status = 'completed'
              GROUP BY coalesce(s.proposed_start_time, s.start_time) HAVING count(*) > 1)
ORDER BY g.created_at;

\echo '== 3. Blocking after cleanup (cutover section 1) — every list must be empty (groups removed by section 2 excluded)'
WITH facts AS (
  SELECT g.id AS triad_group_id,
    g.id::text ~ '^[0-9a-f]{8}-0000-0000-0000-[0-9a-f]{12}$' AS seed_group_id,
    o.name = 'Clariva Demo Organization' AS demo_organization,
    (SELECT bool_and(u.email ILIKE '%@demo.clariva.club')
     FROM (VALUES (g.member_1_id), (g.member_2_id), (g.member_3_id)) m(user_id) JOIN auth.users u ON u.id = m.user_id) AS all_members_demo_accounts,
    EXISTS (SELECT 1 FROM public.triad_sessions s JOIN public.goal_checkins gc ON gc.source_activity_type = 'triad' AND gc.source_activity_id = s.id
            WHERE s.triad_group_id = g.id) AS has_goal_checkins,
    o.name AS organization, c.name AS cohort
  FROM public.triad_groups g
  LEFT JOIN public.cohorts c ON c.id = g.cohort_id
  LEFT JOIN public.organizations o ON o.id = c.organization_id
), conflicts AS (
  SELECT g.id AS triad_group_id, NULL::uuid AS triad_session_id, 'group_outside_cohort'::text AS conflict
  FROM public.triad_groups g
  WHERE g.cohort_id IS NULL OR g.enrollment_1_id IS NULL OR g.enrollment_2_id IS NULL
     OR EXISTS (
       SELECT 1 FROM (VALUES (g.member_1_id, g.enrollment_1_id), (g.member_2_id, g.enrollment_2_id), (g.member_3_id, g.enrollment_3_id)) slot(user_id, enrollment_id)
       LEFT JOIN public.programme_enrollments e ON e.id = slot.enrollment_id
       WHERE (slot.user_id IS NULL) <> (slot.enrollment_id IS NULL)
          OR (slot.enrollment_id IS NOT NULL AND (e.id IS NULL OR e.user_id <> slot.user_id
               OR e.cohort_id IS DISTINCT FROM g.cohort_id OR e.programme_id IS DISTINCT FROM g.programme_id)))
  UNION ALL
  SELECT g.id, NULL, 'no_programme_triad_requirement'
  FROM public.triad_groups g
  WHERE NOT EXISTS (
    SELECT 1 FROM public.programme_modules pm
    WHERE pm.programme_id = g.programme_id AND pm.module = 'triads' AND pm.enabled
      AND coalesce((pm.config->>'required')::boolean, false)
      AND coalesce(nullif(pm.config->>'required_units', '')::integer, 0) > 0)
  UNION ALL
  SELECT DISTINCT s.triad_group_id, NULL::uuid, 'reflection_on_open_session'
  FROM public.triad_reflections r JOIN public.triad_sessions s ON s.id = r.triad_session_id WHERE s.status <> 'completed'
  UNION ALL
  SELECT DISTINCT s.triad_group_id, NULL::uuid, 'future_reflection'
  FROM public.triad_reflections r JOIN public.triad_sessions s ON s.id = r.triad_session_id WHERE r.submitted_at > now()
  UNION ALL
  SELECT s.triad_group_id, s.id, 'duplicate_completed_session'
  FROM public.triad_sessions s
  WHERE s.status = 'completed'
    AND EXISTS (SELECT 1 FROM public.triad_sessions o
                WHERE o.triad_group_id = s.triad_group_id AND o.status = 'completed' AND o.id < s.id
                  AND coalesce(o.proposed_start_time, o.start_time) IS NOT DISTINCT FROM coalesce(s.proposed_start_time, s.start_time))
    AND NOT EXISTS (SELECT 1 FROM public.triad_reflections r WHERE r.triad_session_id = s.id)
    AND NOT EXISTS (SELECT 1 FROM public.goal_checkins gc WHERE gc.source_activity_type = 'triad' AND gc.source_activity_id = s.id)
), classified AS (
  SELECT c.triad_group_id, c.triad_session_id,
    CASE WHEN f.has_goal_checkins THEN 'REAL/UNKNOWN'
         WHEN f.seed_group_id OR coalesce(f.demo_organization, false) OR coalesce(f.all_members_demo_accounts, false) THEN 'DEMO/SEED'
         ELSE 'REAL/UNKNOWN' END AS classification
  FROM conflicts c JOIN facts f ON f.triad_group_id = c.triad_group_id
), removed_groups AS (
  SELECT DISTINCT triad_group_id AS id FROM classified WHERE triad_session_id IS NULL AND classification = 'DEMO/SEED'
), removed_sessions AS (
  SELECT s.id FROM public.triad_sessions s WHERE s.triad_group_id IN (SELECT id FROM removed_groups)
  UNION SELECT triad_session_id FROM classified WHERE triad_session_id IS NOT NULL AND classification = 'DEMO/SEED'
)
SELECT 'session participants differ from group membership' AS check, s.id AS record_id
FROM public.triad_sessions s JOIN public.triad_groups g ON g.id = s.triad_group_id
WHERE s.triad_group_id NOT IN (SELECT id FROM removed_groups)
  AND ARRAY(SELECT x FROM unnest(ARRAY[s.coach_enrollment_id, s.coachee_enrollment_id, s.observer_enrollment_id]) x WHERE x IS NOT NULL ORDER BY x)
      IS DISTINCT FROM ARRAY(SELECT x FROM unnest(ARRAY[g.enrollment_1_id, g.enrollment_2_id, g.enrollment_3_id]) x WHERE x IS NOT NULL ORDER BY x)
UNION ALL
SELECT 'session has two different start times', s.id FROM public.triad_sessions s
WHERE s.start_time IS NOT NULL AND s.proposed_start_time IS NOT NULL AND s.start_time <> s.proposed_start_time
UNION ALL
SELECT 'completed session without a time', s.id FROM public.triad_sessions s
WHERE s.status = 'completed' AND coalesce(s.proposed_start_time, s.start_time) IS NULL
UNION ALL
SELECT 'reflection without enrollment and without retirement ledger', r.id FROM public.triad_reflections r
JOIN public.triad_sessions s ON s.id = r.triad_session_id
WHERE r.enrollment_id IS NULL AND s.triad_group_id NOT IN (SELECT id FROM removed_groups)
  AND NOT EXISTS (SELECT 1 FROM public.enrollment_ownership_retirements x WHERE x.domain = 'triad_reflections' AND x.record_id = r.id)
UNION ALL
SELECT 'group with more than one open session', s.triad_group_id FROM public.triad_sessions s
WHERE s.status IN ('proposed', 'confirmed') AND s.triad_group_id NOT IN (SELECT id FROM removed_groups)
GROUP BY s.triad_group_id HAVING count(*) > 1;

\echo '== 4. Informational: enrollments in several active legacy groups (the cutover keeps the newest active, closes the older)'
SELECT slot.e AS enrollment_id, array_agg(g.id ORDER BY g.created_at) AS active_groups
FROM public.triad_groups g CROSS JOIN LATERAL (VALUES (g.enrollment_1_id), (g.enrollment_2_id), (g.enrollment_3_id)) slot(e)
WHERE g.is_active AND slot.e IS NOT NULL
GROUP BY slot.e HAVING count(*) > 1;

\echo '== 5. Informational: Triad completion per enrollment — today vs after deployment 1 (same rule; only removed duplicate / demo evidence differs)'
WITH facts AS (
  SELECT g.id AS triad_group_id,
    g.id::text ~ '^[0-9a-f]{8}-0000-0000-0000-[0-9a-f]{12}$' AS seed_group_id,
    o.name = 'Clariva Demo Organization' AS demo_organization,
    (SELECT bool_and(u.email ILIKE '%@demo.clariva.club')
     FROM (VALUES (g.member_1_id), (g.member_2_id), (g.member_3_id)) m(user_id) JOIN auth.users u ON u.id = m.user_id) AS all_members_demo_accounts,
    EXISTS (SELECT 1 FROM public.triad_sessions s JOIN public.goal_checkins gc ON gc.source_activity_type = 'triad' AND gc.source_activity_id = s.id
            WHERE s.triad_group_id = g.id) AS has_goal_checkins,
    o.name AS organization, c.name AS cohort
  FROM public.triad_groups g
  LEFT JOIN public.cohorts c ON c.id = g.cohort_id
  LEFT JOIN public.organizations o ON o.id = c.organization_id
), conflicts AS (
  SELECT g.id AS triad_group_id, NULL::uuid AS triad_session_id, 'group_outside_cohort'::text AS conflict
  FROM public.triad_groups g
  WHERE g.cohort_id IS NULL OR g.enrollment_1_id IS NULL OR g.enrollment_2_id IS NULL
     OR EXISTS (
       SELECT 1 FROM (VALUES (g.member_1_id, g.enrollment_1_id), (g.member_2_id, g.enrollment_2_id), (g.member_3_id, g.enrollment_3_id)) slot(user_id, enrollment_id)
       LEFT JOIN public.programme_enrollments e ON e.id = slot.enrollment_id
       WHERE (slot.user_id IS NULL) <> (slot.enrollment_id IS NULL)
          OR (slot.enrollment_id IS NOT NULL AND (e.id IS NULL OR e.user_id <> slot.user_id
               OR e.cohort_id IS DISTINCT FROM g.cohort_id OR e.programme_id IS DISTINCT FROM g.programme_id)))
  UNION ALL
  SELECT g.id, NULL, 'no_programme_triad_requirement'
  FROM public.triad_groups g
  WHERE NOT EXISTS (
    SELECT 1 FROM public.programme_modules pm
    WHERE pm.programme_id = g.programme_id AND pm.module = 'triads' AND pm.enabled
      AND coalesce((pm.config->>'required')::boolean, false)
      AND coalesce(nullif(pm.config->>'required_units', '')::integer, 0) > 0)
  UNION ALL
  SELECT DISTINCT s.triad_group_id, NULL::uuid, 'reflection_on_open_session'
  FROM public.triad_reflections r JOIN public.triad_sessions s ON s.id = r.triad_session_id WHERE s.status <> 'completed'
  UNION ALL
  SELECT DISTINCT s.triad_group_id, NULL::uuid, 'future_reflection'
  FROM public.triad_reflections r JOIN public.triad_sessions s ON s.id = r.triad_session_id WHERE r.submitted_at > now()
  UNION ALL
  SELECT s.triad_group_id, s.id, 'duplicate_completed_session'
  FROM public.triad_sessions s
  WHERE s.status = 'completed'
    AND EXISTS (SELECT 1 FROM public.triad_sessions o
                WHERE o.triad_group_id = s.triad_group_id AND o.status = 'completed' AND o.id < s.id
                  AND coalesce(o.proposed_start_time, o.start_time) IS NOT DISTINCT FROM coalesce(s.proposed_start_time, s.start_time))
    AND NOT EXISTS (SELECT 1 FROM public.triad_reflections r WHERE r.triad_session_id = s.id)
    AND NOT EXISTS (SELECT 1 FROM public.goal_checkins gc WHERE gc.source_activity_type = 'triad' AND gc.source_activity_id = s.id)
), classified AS (
  SELECT c.triad_group_id, c.triad_session_id,
    CASE WHEN f.has_goal_checkins THEN 'REAL/UNKNOWN'
         WHEN f.seed_group_id OR coalesce(f.demo_organization, false) OR coalesce(f.all_members_demo_accounts, false) THEN 'DEMO/SEED'
         ELSE 'REAL/UNKNOWN' END AS classification
  FROM conflicts c JOIN facts f ON f.triad_group_id = c.triad_group_id
), removed_groups AS (
  SELECT DISTINCT triad_group_id AS id FROM classified WHERE triad_session_id IS NULL AND classification = 'DEMO/SEED'
), removed_sessions AS (
  SELECT s.id FROM public.triad_sessions s WHERE s.triad_group_id IN (SELECT id FROM removed_groups)
  UNION SELECT triad_session_id FROM classified WHERE triad_session_id IS NOT NULL AND classification = 'DEMO/SEED'
), required AS (
  SELECT e.id AS enrollment_id,
    CASE WHEN coalesce((pm.config->>'required')::boolean, false) THEN coalesce(nullif(pm.config->>'required_units', '')::integer, 0) ELSE 0 END AS required_units,
    (SELECT count(*) FROM public.cohort_requirement_dates d
     WHERE d.cohort_id = e.cohort_id AND d.programme_id = e.programme_id AND d.module = 'triads' AND d.due_on <= current_date)::integer AS due_units
  FROM public.programme_enrollments e
  JOIN public.programme_modules pm ON pm.programme_id = e.programme_id AND pm.module = 'triads' AND pm.enabled
), evidence AS (
  SELECT a.enrollment_id, a.source_activity_id, a.occurred_on, s.status, a.source_activity_id IN (SELECT id FROM removed_sessions) AS removed
  FROM public.session_activity_attributions a JOIN public.triad_sessions s ON s.id = a.source_activity_id
  WHERE a.source_activity_type = 'triad'
), counts AS (
  SELECT r.enrollment_id, r.required_units, r.due_units,
    count(*) FILTER (WHERE ev.status = 'completed' AND ev.occurred_on <= current_date)::integer AS raw_now,
    count(*) FILTER (WHERE ev.status = 'completed' AND ev.occurred_on <= current_date AND NOT ev.removed)::integer AS raw_after
  FROM required r JOIN evidence ev ON ev.enrollment_id = r.enrollment_id
  WHERE r.required_units > 0
  GROUP BY r.enrollment_id, r.required_units, r.due_units
)
SELECT enrollment_id, required_units, due_units,
  least(raw_now, required_units) AS completed_now, greatest(due_units - least(raw_now, due_units), 0) AS overdue_now,
  least(raw_after, required_units) AS completed_after, greatest(due_units - least(raw_after, due_units), 0) AS overdue_after
FROM counts
ORDER BY (raw_now <> raw_after) DESC, enrollment_id;

-- A "Mark complete" reverted by the legacy trg_auto_confirm_triad leaves
-- updated_at after both the insert and the start (trg_triad_sessions_updated
-- stamps every UPDATE). Rows inserted after their start and never updated
-- (seeds, imports) are not candidates.
\echo '== 6. Review: past confirmed sessions (possibly lost completions)'
SELECT s.id AS session_id, s.triad_group_id, g.cohort_id,
  coalesce(s.proposed_start_time, s.start_time) AS effective_time,
  s.created_at, s.updated_at,
  s.updated_at > greatest(s.created_at, coalesce(s.proposed_start_time, s.start_time)) AS updated_after_start,
  (SELECT count(*) FROM public.triad_reflections r WHERE r.triad_session_id = s.id) AS reflections,
  (SELECT count(*) FROM public.goal_checkins gc WHERE gc.source_activity_type = 'triad' AND gc.source_activity_id = s.id) AS goal_checkins
FROM public.triad_sessions s
JOIN public.triad_groups g ON g.id = s.triad_group_id
WHERE s.status = 'confirmed'
  AND coalesce(s.proposed_start_time, s.start_time) < now()
ORDER BY coalesce(s.proposed_start_time, s.start_time);

\echo '== 7. Informational: evidence the cutover adds for live sessions that had none'
SELECT s.id AS session_id, slot.e AS enrollment_id, coalesce(s.proposed_start_time, s.start_time)::date AS on_date, s.status
FROM public.triad_sessions s JOIN public.triad_groups g ON g.id = s.triad_group_id
CROSS JOIN LATERAL (VALUES (g.enrollment_1_id), (g.enrollment_2_id), (g.enrollment_3_id)) slot(e)
WHERE slot.e IS NOT NULL AND s.status <> 'cancelled' AND coalesce(s.proposed_start_time, s.start_time) IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.session_activity_attributions a
                  WHERE a.source_activity_type = 'triad' AND a.source_activity_id = s.id AND a.enrollment_id = slot.e)
ORDER BY 1, 2;

ROLLBACK;
