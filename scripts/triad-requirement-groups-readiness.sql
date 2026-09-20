-- Read-only readiness report for 20260919120000_triad_requirement_groups
-- (EVERY REQUIRED TRIAD HAS ITS OWN GROUP ASSIGNMENT). Run against the
-- production database AFTER deployment 1 and BEFORE applying the migration:
--   psql "$DB" -X -v ON_ERROR_STOP=1 -f scripts/triad-requirement-groups-readiness.sql
-- or through the Management API read-only endpoint. Nothing is written.
--
-- The migration maps each existing group to the member's next unfulfilled
-- Triad at the time the group was formed: unit = 1 + the number of the
-- member's EARLIER groups (same cohort) that have a completed session. All
-- members must agree, the members must share one programme, and the unit must
-- exist in the cohort's Triad schedule. Section 1 previews that mapping;
-- section 2 must be empty or the migration stops.

\echo '== 1. Mapping preview: every group -> the cohort Triad requirement it will belong to'
WITH member_units AS (
  SELECT g.id AS triad_group_id, g.cohort_id, e.programme_id, m.enrollment_id,
    1 + (SELECT count(*) FROM public.triad_group_members m2
         JOIN public.triad_groups g2 ON g2.id = m2.triad_group_id
         WHERE m2.enrollment_id = m.enrollment_id AND g2.id <> g.id AND g2.cohort_id = g.cohort_id
           AND (g2.created_at, g2.id) < (g.created_at, g.id)
           AND EXISTS (SELECT 1 FROM public.triad_sessions s WHERE s.triad_group_id = g2.id AND s.status = 'completed')) AS unit
  FROM public.triad_groups g
  JOIN public.triad_group_members m ON m.triad_group_id = g.id
  JOIN public.programme_enrollments e ON e.id = m.enrollment_id
), mapped AS (
  SELECT mu.triad_group_id, min(mu.cohort_id::text)::uuid AS cohort_id,
    count(DISTINCT mu.programme_id) AS programmes, min(mu.programme_id::text)::uuid AS programme_id,
    min(mu.unit) AS min_unit, max(mu.unit) AS max_unit, count(*) AS members
  FROM member_units mu GROUP BY mu.triad_group_id
)
SELECT c.name AS cohort, m.triad_group_id, g.is_active, m.members, m.max_unit AS unit, d.id AS cohort_requirement_date_id, d.due_on,
  (SELECT string_agg(s.status || '@' || coalesce(s.scheduled_start_time::date::text, '-'), ', ' ORDER BY s.scheduled_start_time)
   FROM public.triad_sessions s WHERE s.triad_group_id = m.triad_group_id) AS sessions,
  CASE WHEN d.id IS NULL THEN 'NO REQUIREMENT ROW' WHEN m.min_unit <> m.max_unit THEN 'MEMBERS DISAGREE'
       WHEN m.programmes <> 1 THEN 'SEVERAL PROGRAMMES' ELSE 'ok' END AS verdict
FROM mapped m
JOIN public.triad_groups g ON g.id = m.triad_group_id
JOIN public.cohorts c ON c.id = m.cohort_id
LEFT JOIN public.cohort_requirement_dates d
  ON d.cohort_id = m.cohort_id AND d.programme_id = m.programme_id AND d.module = 'triads' AND d.ordinal = m.max_unit
ORDER BY c.name, unit, g.created_at;

\echo '== 2. BLOCKING: groups without members (cannot be mapped) — must be empty'
SELECT g.id, g.cohort_id, g.created_at FROM public.triad_groups g
WHERE NOT EXISTS (SELECT 1 FROM public.triad_group_members m WHERE m.triad_group_id = g.id);

\echo '== 3. Informational: groups with more than one completed session (the extra sessions become raw activity only)'
SELECT g.id AS triad_group_id, c.name AS cohort, count(*) AS completed_sessions
FROM public.triad_groups g JOIN public.cohorts c ON c.id = g.cohort_id
JOIN public.triad_sessions s ON s.triad_group_id = g.id AND s.status = 'completed'
GROUP BY g.id, c.name HAVING count(*) > 1;

\echo '== 4. Informational: cohorts whose programme requires Triads but lacks a requirement date for a unit'
SELECT c.name AS cohort, cp.programme_id, u.ordinal AS missing_unit
FROM (SELECT DISTINCT e.cohort_id, e.programme_id FROM public.programme_enrollments e WHERE e.cohort_id IS NOT NULL) cp
JOIN public.cohorts c ON c.id = cp.cohort_id
JOIN public.programme_modules pm ON pm.programme_id = cp.programme_id AND pm.module = 'triads' AND pm.enabled
  AND coalesce((pm.config->>'required')::boolean, false)
CROSS JOIN LATERAL generate_series(1, coalesce((pm.config->>'required_units')::integer, 0)) AS u(ordinal)
WHERE NOT EXISTS (SELECT 1 FROM public.cohort_requirement_dates d
                  WHERE d.cohort_id = cp.cohort_id AND d.programme_id = cp.programme_id AND d.module = 'triads' AND d.ordinal = u.ordinal)
ORDER BY 1, 3;

\echo '== 5. Demo (Clariva Demo Organization): Triad 1 groups holding a second session (moved to its own Triad 2 group by the migration)'
-- The demo reset tooling (incl. demo_resource_registry) exists only on hosted
-- production. A to_regclass() guard inside the query does NOT help: the missing
-- relation is resolved at parse time and would abort the script under
-- ON_ERROR_STOP=1 before section 6. Gate it at the psql level instead.
SELECT to_regclass('public.demo_resource_registry') IS NOT NULL AS has_demo_registry \gset
\if :has_demo_registry
SELECT s.id, s.triad_group_id, s.status, s.scheduled_start_time
FROM public.triad_sessions s
WHERE s.triad_group_id IN (SELECT resource_id FROM public.demo_resource_registry WHERE resource_type = 'triad_group')
  AND EXISTS (SELECT 1 FROM public.triad_sessions x WHERE x.triad_group_id = s.triad_group_id
              AND (x.scheduled_start_time, x.id) < (s.scheduled_start_time, s.id))
ORDER BY s.triad_group_id, s.scheduled_start_time;
\else
\echo '   (skipped: demo_resource_registry not present in this environment)'
\endif

\echo '== 6. Migration ledger: 20260919120000 must not be applied yet'
SELECT version, name FROM supabase_migrations.schema_migrations WHERE version >= '20260919120000';
