-- Triad cutover readiness report (READ-ONLY).
--
-- Run against the target database BEFORE deploying
-- 20260918190000_triad_canonical_cutover (legacy Triad columns still present):
--   psql "$TARGET_DB_URL" -v ON_ERROR_STOP=1 -f scripts/triad-cutover-readiness.sql
--
-- It mirrors the cutover's validation (section 1) and its group -> cohort
-- Triad requirement linking rule (section 6b), so every row reported here is
-- a row the cutover would stop on. Nothing is written.
--
-- Remediation for AMBIGUOUS / NO_MATCHING_UNIT groups: a reviewed row per
-- group in public.triad_cutover_group_decisions ('link' to a cohort Triad
-- requirement date of the group's own cohort, or 'historical_unlinked'),
-- shipped in a migration between 20260918185900 and 20260918190000.
-- The evidence columns (session dates vs unit due dates) support the review;
-- they are never applied automatically.

BEGIN TRANSACTION READ ONLY;

\echo '== 1. Inventory'
SELECT (SELECT count(*) FROM public.triad_rounds) AS triad_rounds,
  (SELECT count(*) FROM public.programme_triad_rounds) AS programme_triad_rounds,
  (SELECT count(*) FROM public.triad_groups) AS groups,
  (SELECT count(*) FROM public.triad_sessions) AS sessions,
  (SELECT count(*) FROM public.triad_sessions WHERE status = 'completed') AS completed_sessions,
  (SELECT count(*) FROM public.triad_alternative_proposals) AS proposals,
  (SELECT count(*) FROM public.triad_reflections) AS reflections,
  (SELECT count(*) FROM public.session_activity_attributions WHERE source_activity_type = 'triad') AS triad_attributions;

\echo '== 2. Group -> cohort Triad requirement link (cutover section 6b)'
WITH link AS (
  SELECT g.id AS triad_group_id, g.cohort_id, g.programme_id, g.is_active,
    coalesce(tr.round_number, g.round_number) AS round_number,
    (SELECT count(*) FROM public.cohort_requirement_dates d
     WHERE d.cohort_id = g.cohort_id AND d.programme_id = g.programme_id AND d.module = 'triads') AS cohort_triad_rows,
    CASE
      WHEN coalesce(tr.round_number, g.round_number) IS NOT NULL THEN (
        SELECT d.id FROM public.cohort_requirement_dates d
        WHERE d.cohort_id = g.cohort_id AND d.programme_id = g.programme_id
          AND d.module = 'triads' AND d.ordinal = coalesce(tr.round_number, g.round_number))
      ELSE (
        SELECT CASE WHEN count(*) = 1 THEN (array_agg(d.id))[1] END
        FROM public.cohort_requirement_dates d
        WHERE d.cohort_id = g.cohort_id AND d.programme_id = g.programme_id AND d.module = 'triads')
    END AS derived_requirement_id
  FROM public.triad_groups g
  LEFT JOIN public.triad_rounds tr ON tr.id = g.triad_round_id
)
SELECT l.triad_group_id, l.cohort_id, l.programme_id, l.is_active, l.round_number, l.cohort_triad_rows,
  CASE
    WHEN l.cohort_id IS NULL THEN 'NO_COHORT'
    WHEN l.derived_requirement_id IS NOT NULL THEN 'LINKED'
    WHEN l.round_number IS NOT NULL THEN 'NO_MATCHING_UNIT'
    ELSE 'AMBIGUOUS'
  END AS status,
  (SELECT jsonb_agg(jsonb_build_object('session', s.id, 'status', s.status,
            'time', coalesce(s.proposed_start_time, s.start_time)) ORDER BY s.created_at)
   FROM public.triad_sessions s WHERE s.triad_group_id = l.triad_group_id) AS evidence_sessions,
  (SELECT jsonb_agg(jsonb_build_object('unit', d.ordinal, 'units', d.units, 'due_on', d.due_on, 'id', d.id) ORDER BY d.ordinal)
   FROM public.cohort_requirement_dates d
   WHERE d.cohort_id = l.cohort_id AND d.programme_id = l.programme_id AND d.module = 'triads') AS cohort_units
FROM link l
ORDER BY (l.derived_requirement_id IS NOT NULL), l.cohort_id, l.triad_group_id;

\echo '== 3. Blocking data inconsistencies (cutover section 1) — every list must be empty (or carry the stated decision)'
SELECT 'group slots inconsistent with their learners (identity; never waivable)' AS check, g.id AS record_id
FROM public.triad_groups g
WHERE g.enrollment_1_id IS NULL OR g.enrollment_2_id IS NULL
   OR EXISTS (
     SELECT 1
     FROM (VALUES (g.member_1_id, g.enrollment_1_id), (g.member_2_id, g.enrollment_2_id), (g.member_3_id, g.enrollment_3_id)) slot(user_id, enrollment_id)
     LEFT JOIN public.programme_enrollments e ON e.id = slot.enrollment_id
     WHERE (slot.user_id IS NULL) <> (slot.enrollment_id IS NULL)
        OR (slot.enrollment_id IS NOT NULL AND (e.id IS NULL OR e.user_id <> slot.user_id)))
UNION ALL
SELECT 'group members outside the group''s cohort / programme (blocks unless a reviewed historical_unlinked decision is recorded)', g.id
FROM public.triad_groups g
WHERE g.cohort_id IS NULL
   OR EXISTS (
     SELECT 1
     FROM (VALUES (g.enrollment_1_id), (g.enrollment_2_id), (g.enrollment_3_id)) slot(enrollment_id)
     JOIN public.programme_enrollments e ON e.id = slot.enrollment_id
     WHERE e.programme_id <> g.programme_id OR e.cohort_id IS DISTINCT FROM g.cohort_id)
UNION ALL
SELECT 'session participants differ from group membership', s.id
FROM public.triad_sessions s
JOIN public.triad_groups g ON g.id = s.triad_group_id
WHERE ARRAY(SELECT x FROM unnest(ARRAY[s.coach_enrollment_id, s.coachee_enrollment_id, s.observer_enrollment_id]) x WHERE x IS NOT NULL ORDER BY x)
   IS DISTINCT FROM
      ARRAY(SELECT x FROM unnest(ARRAY[g.enrollment_1_id, g.enrollment_2_id, g.enrollment_3_id]) x WHERE x IS NOT NULL ORDER BY x)
UNION ALL
SELECT 'session has two different start times', s.id
FROM public.triad_sessions s
WHERE s.start_time IS NOT NULL AND s.proposed_start_time IS NOT NULL AND s.start_time <> s.proposed_start_time
UNION ALL
SELECT 'reflection authored outside the session group', r.id
FROM public.triad_reflections r
JOIN public.triad_sessions s ON s.id = r.triad_session_id
JOIN public.triad_groups g ON g.id = s.triad_group_id
WHERE r.enrollment_id IS NOT NULL
  AND r.enrollment_id NOT IN (g.enrollment_1_id, g.enrollment_2_id)
  AND r.enrollment_id IS DISTINCT FROM g.enrollment_3_id
UNION ALL
SELECT 'reflection without enrollment and without retirement ledger', r.id
FROM public.triad_reflections r
WHERE r.enrollment_id IS NULL
  -- Inlined is_historical_ownership_retired: the read-only role can't execute it.
  AND NOT EXISTS (SELECT 1 FROM public.enrollment_ownership_retirements x
                  WHERE x.domain = 'triad_reflections' AND x.record_id = r.id)
UNION ALL
SELECT 'enrollment in two active groups that derive the same unit', x.enrollment_id
FROM (
  SELECT slot.enrollment_id, g.cohort_id, coalesce(tr.round_number, g.round_number) AS round_number
  FROM public.triad_groups g
  LEFT JOIN public.triad_rounds tr ON tr.id = g.triad_round_id
  CROSS JOIN LATERAL (VALUES (g.enrollment_1_id), (g.enrollment_2_id), (g.enrollment_3_id)) slot(enrollment_id)
  WHERE g.is_active AND slot.enrollment_id IS NOT NULL AND coalesce(tr.round_number, g.round_number) IS NOT NULL
) x
GROUP BY x.enrollment_id, x.cohort_id, x.round_number
HAVING count(*) > 1;

\echo '== 4. Informational: multi-unit Triad requirement rows the cutover splits into single-unit rows (same dates)'
SELECT d.cohort_id, d.programme_id, d.ordinal, d.units, d.due_on
FROM public.cohort_requirement_dates d
WHERE d.module = 'triads' AND d.units > 1
ORDER BY d.cohort_id, d.ordinal;

\echo '== 5. Informational: Triad evidence whose date differs from the session''s effective time (corrected by the cutover)'
SELECT a.enrollment_id, a.source_activity_id AS session_id, a.occurred_on,
  coalesce(s.proposed_start_time, s.start_time)::date AS effective_date
FROM public.session_activity_attributions a
JOIN public.triad_sessions s ON s.id = a.source_activity_id
WHERE a.source_activity_type = 'triad'
  AND a.occurred_on IS DISTINCT FROM coalesce(s.proposed_start_time, s.start_time)::date;

-- The legacy trg_auto_confirm_triad (BEFORE UPDATE) set status back to
-- 'confirmed' on every update of a session whose members had all accepted —
-- including the learner's own "Mark complete" update. A completion a learner
-- made that way was never stored. The cutover keeps every stored status as-is
-- (it never infers a completion); this list is the evidence for a reviewed
-- remediation decision (a follow-up migration that marks named sessions
-- completed), not something applied automatically.
\echo '== 6. Review: past confirmed sessions (a "Mark complete" the legacy auto-confirm trigger may have reverted)'
SELECT s.id AS session_id, s.triad_group_id, g.cohort_id,
  coalesce(s.proposed_start_time, s.start_time) AS effective_time,
  s.created_at, s.updated_at,
  -- trg_triad_sessions_updated stamps every UPDATE, so a reverted "Mark
  -- complete" leaves updated_at after both the insert and the start time.
  -- Rows inserted after their start (seeds, imports) and never updated are
  -- not candidates.
  s.updated_at > greatest(s.created_at, coalesce(s.proposed_start_time, s.start_time)) AS updated_after_start,
  (SELECT count(*) FROM public.triad_reflections r WHERE r.triad_session_id = s.id) AS reflections,
  (SELECT count(*) FROM public.goal_checkins gc WHERE gc.source_activity_type = 'triad' AND gc.source_activity_id = s.id) AS goal_checkins
FROM public.triad_sessions s
JOIN public.triad_groups g ON g.id = s.triad_group_id
WHERE s.status = 'confirmed'
  AND coalesce(s.proposed_start_time, s.start_time) < now()
ORDER BY coalesce(s.proposed_start_time, s.start_time);

\echo '== 7. Informational: evidence the cutover backfills for legacy sessions that had none (reported, accepted)'
WITH predicted AS (
  SELECT s.id AS session_id, slot.e AS enrollment_id, coalesce(s.proposed_start_time, s.start_time)::date AS on_date
  FROM public.triad_sessions s JOIN public.triad_groups g ON g.id = s.triad_group_id
  CROSS JOIN LATERAL (VALUES (g.enrollment_1_id), (g.enrollment_2_id), (g.enrollment_3_id)) slot(e)
  WHERE slot.e IS NOT NULL AND coalesce(s.proposed_start_time, s.start_time) IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM public.enrollment_ownership_retirements x WHERE x.domain = 'triad' AND x.record_id = s.id)
)
SELECT p.session_id, p.enrollment_id, p.on_date,
  CASE WHEN EXISTS (SELECT 1 FROM public.session_activity_attributions a
                    WHERE a.source_activity_type = 'triad' AND a.source_activity_id = p.session_id)
       THEN 'BLOCKING: session had partial evidence' ELSE 'backfill (session had none)' END AS kind
FROM predicted p
WHERE NOT EXISTS (SELECT 1 FROM public.session_activity_attributions a
                  WHERE a.source_activity_type = 'triad' AND a.source_activity_id = p.session_id AND a.enrollment_id = p.enrollment_id)
ORDER BY 1, 2;

-- 20260918194000_triad_requirement_fulfilment: a completed session fulfils
-- only its group's cohort Triad requirement. Groups are linked as in section
-- 2 (a group the cutover can't link yet is shown as 'pending decision').
\echo '== 8. Informational: Triad completion today (session count) vs after requirement fulfilment'
WITH link AS (
  SELECT g.id AS triad_group_id,
    CASE
      WHEN coalesce(tr.round_number, g.round_number) IS NOT NULL THEN (
        SELECT d.id FROM public.cohort_requirement_dates d
        WHERE d.cohort_id = g.cohort_id AND d.programme_id = g.programme_id
          AND d.module = 'triads' AND d.ordinal = coalesce(tr.round_number, g.round_number))
      ELSE (
        SELECT CASE WHEN count(*) = 1 THEN (array_agg(d.id))[1] END
        FROM public.cohort_requirement_dates d
        WHERE d.cohort_id = g.cohort_id AND d.programme_id = g.programme_id AND d.module = 'triads')
    END AS requirement_id
  FROM public.triad_groups g LEFT JOIN public.triad_rounds tr ON tr.id = g.triad_round_id
), required AS (
  SELECT e.id AS enrollment_id,
    CASE WHEN coalesce((pm.config->>'required')::boolean, false)
      THEN coalesce((pm.config->>'required_units')::integer, 0) ELSE 0 END AS required_units
  FROM public.programme_enrollments e
  JOIN public.programme_modules pm ON pm.programme_id = e.programme_id AND pm.module = 'triads' AND pm.enabled
), evidence AS (
  SELECT a.enrollment_id, a.source_activity_id AS session_id, a.occurred_on, s.status, l.requirement_id
  FROM public.session_activity_attributions a
  JOIN public.triad_sessions s ON s.id = a.source_activity_id
  LEFT JOIN link l ON l.triad_group_id = s.triad_group_id
  WHERE a.source_activity_type = 'triad'
)
SELECT r.enrollment_id, r.required_units,
  least(count(*) FILTER (WHERE ev.status = 'completed' AND ev.occurred_on <= current_date), r.required_units) AS completed_now,
  least(count(DISTINCT ev.requirement_id) FILTER (WHERE ev.status = 'completed' AND ev.occurred_on <= current_date), r.required_units) AS completed_after,
  count(*) FILTER (WHERE ev.status = 'completed' AND ev.requirement_id IS NULL) AS completed_in_unlinked_groups
FROM required r
JOIN evidence ev ON ev.enrollment_id = r.enrollment_id
WHERE r.required_units > 0
GROUP BY r.enrollment_id, r.required_units
ORDER BY (least(count(*) FILTER (WHERE ev.status = 'completed' AND ev.occurred_on <= current_date), r.required_units)
          <> least(count(DISTINCT ev.requirement_id) FILTER (WHERE ev.status = 'completed' AND ev.occurred_on <= current_date), r.required_units)) DESC,
  r.enrollment_id;

ROLLBACK;
