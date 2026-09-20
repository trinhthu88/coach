-- ============================================================================
-- TRIAD LEGACY DATA CLEANUP (ships BEFORE 20260918190000_triad_canonical_cutover).
--
-- The cutover moves Triads to the final model: a group belongs to a COHORT,
-- membership is enrollment-based, and completion is the count of distinct
-- completed sessions (capped at the programme requirement) compared with the
-- cohort's cumulative due dates. Legacy Triad rows that contradict that model
-- are classified here, before anything is converted:
--
--   DEMO/SEED    deterministic seed identifiers, a demo organisation, or a
--                group whose every member is a demo account. Conflicting
--                DEMO/SEED rows are archived (triad_cutover_archive) and
--                removed. Nothing about the architecture bends to keep them.
--   REAL/UNKNOWN anything else. Never removed automatically: the migration
--                stops and lists them. A reviewed decision
--                (triad_cutover_review_decisions, shipped in a migration
--                between 20260918185800 and this one) or a data correction resolves them.
--
-- Conflicts (group level):
--   group_outside_cohort ............ no cohort, an empty/inconsistent slot,
--                                      or a member enrolled outside the
--                                      group's cohort / programme
--   no_programme_triad_requirement .. the group's programme requires no
--                                      Triads (it is configured later; groups
--                                      are never kept alive by changing it)
--   reflection_on_open_session ...... a reflection on a session that is not
--                                      completed
--   future_reflection ............... a reflection submitted in the future
-- Conflicts (session level):
--   duplicate_completed_session ..... a second completed session of the same
--                                      group at the same effective time with
--                                      no reflection / goal history of its
--                                      own: an accidental copy of ONE session
--                                      (the lowest id is the legitimate row)
--
-- Nothing is deleted that carries goal check-ins: goal data is never removed
-- as a side effect of Triad cleanup (such rows are REAL/UNKNOWN).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Classification (read-only; reproduced by scripts/triad-cutover-readiness.sql).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.triad_is_seed_identifier(p_id uuid)
RETURNS boolean
LANGUAGE sql IMMUTABLE
AS $$ SELECT p_id::text ~ '^[0-9a-f]{8}-0000-0000-0000-[0-9a-f]{12}$' $$;
REVOKE ALL ON FUNCTION public.triad_is_seed_identifier(uuid) FROM PUBLIC, anon, authenticated;

CREATE TEMP TABLE _triad_group_facts ON COMMIT DROP AS
SELECT g.id AS triad_group_id, g.cohort_id, g.programme_id,
  c.organization_id, o.name AS organization_name,
  ARRAY(SELECT x FROM unnest(ARRAY[g.enrollment_1_id, g.enrollment_2_id, g.enrollment_3_id]) x WHERE x IS NOT NULL) AS enrollment_ids,
  -- evidence for DEMO/SEED
  public.triad_is_seed_identifier(g.id) AS seed_group_id,
  o.name = 'Clariva Demo Organization' AS demo_organization,
  (SELECT bool_and(u.email ILIKE '%@demo.clariva.club')
   FROM (VALUES (g.member_1_id), (g.member_2_id), (g.member_3_id)) m(user_id)
   JOIN auth.users u ON u.id = m.user_id) AS all_members_demo_accounts,
  -- history that is never removed silently
  EXISTS (SELECT 1 FROM public.triad_sessions s JOIN public.goal_checkins gc
            ON gc.source_activity_type = 'triad' AND gc.source_activity_id = s.id
          WHERE s.triad_group_id = g.id) AS has_goal_checkins
FROM public.triad_groups g
LEFT JOIN public.cohorts c ON c.id = g.cohort_id
LEFT JOIN public.organizations o ON o.id = c.organization_id;

CREATE TEMP TABLE _triad_conflicts ON COMMIT DROP AS
-- group_outside_cohort
SELECT g.id AS triad_group_id, NULL::uuid AS triad_session_id, 'group_outside_cohort'::text AS conflict
FROM public.triad_groups g
WHERE g.cohort_id IS NULL
   OR g.enrollment_1_id IS NULL OR g.enrollment_2_id IS NULL
   OR EXISTS (
     SELECT 1
     FROM (VALUES (g.member_1_id, g.enrollment_1_id), (g.member_2_id, g.enrollment_2_id), (g.member_3_id, g.enrollment_3_id)) slot(user_id, enrollment_id)
     LEFT JOIN public.programme_enrollments e ON e.id = slot.enrollment_id
     WHERE (slot.user_id IS NULL) <> (slot.enrollment_id IS NULL)
        OR (slot.enrollment_id IS NOT NULL AND (
              e.id IS NULL OR e.user_id <> slot.user_id
              OR e.cohort_id IS DISTINCT FROM g.cohort_id
              OR e.programme_id IS DISTINCT FROM g.programme_id)))
UNION ALL
-- no_programme_triad_requirement
SELECT g.id, NULL, 'no_programme_triad_requirement'
FROM public.triad_groups g
WHERE NOT EXISTS (
  SELECT 1 FROM public.programme_modules pm
  WHERE pm.programme_id = g.programme_id AND pm.module = 'triads' AND pm.enabled
    AND coalesce((pm.config->>'required')::boolean, false)
    AND coalesce(public.programme_config_integer(pm.config, 'required_units'), 0) > 0)
UNION ALL
-- reflection_on_open_session / future_reflection
SELECT DISTINCT s.triad_group_id, NULL::uuid, 'reflection_on_open_session'
FROM public.triad_reflections r JOIN public.triad_sessions s ON s.id = r.triad_session_id
WHERE s.status <> 'completed'
UNION ALL
SELECT DISTINCT s.triad_group_id, NULL::uuid, 'future_reflection'
FROM public.triad_reflections r JOIN public.triad_sessions s ON s.id = r.triad_session_id
WHERE r.submitted_at > now()
UNION ALL
-- duplicate_completed_session (the copies, never the first row)
SELECT s.triad_group_id, s.id, 'duplicate_completed_session'
FROM public.triad_sessions s
WHERE s.status = 'completed'
  AND EXISTS (
    SELECT 1 FROM public.triad_sessions o
    WHERE o.triad_group_id = s.triad_group_id AND o.status = 'completed' AND o.id < s.id
      AND coalesce(o.proposed_start_time, o.start_time) IS NOT DISTINCT FROM coalesce(s.proposed_start_time, s.start_time))
  AND NOT EXISTS (SELECT 1 FROM public.triad_reflections r WHERE r.triad_session_id = s.id)
  AND NOT EXISTS (SELECT 1 FROM public.goal_checkins gc WHERE gc.source_activity_type = 'triad' AND gc.source_activity_id = s.id);

CREATE TEMP TABLE _triad_cleanup ON COMMIT DROP AS
SELECT c.triad_group_id, c.triad_session_id, string_agg(DISTINCT c.conflict, ', ') AS conflicts,
  CASE
    WHEN f.has_goal_checkins THEN 'REAL/UNKNOWN'
    WHEN f.seed_group_id OR coalesce(f.demo_organization, false) OR coalesce(f.all_members_demo_accounts, false) THEN 'DEMO/SEED'
    ELSE 'REAL/UNKNOWN'
  END AS classification,
  EXISTS (SELECT 1 FROM public.triad_cutover_review_decisions d WHERE d.triad_group_id = c.triad_group_id AND d.decision = 'delete') AS reviewed_delete
FROM _triad_conflicts c
JOIN _triad_group_facts f ON f.triad_group_id = c.triad_group_id
GROUP BY c.triad_group_id, c.triad_session_id, f.has_goal_checkins, f.seed_group_id, f.demo_organization, f.all_members_demo_accounts;

DO $$
DECLARE unresolved text;
BEGIN
  SELECT string_agg(format('group %s%s [%s]', x.triad_group_id,
           coalesce(' session ' || x.triad_session_id, ''), x.conflicts), '; ') INTO unresolved
  FROM _triad_cleanup x
  WHERE x.classification = 'REAL/UNKNOWN' AND NOT x.reviewed_delete;
  IF unresolved IS NOT NULL THEN
    RAISE EXCEPTION 'Triad cleanup: REAL/UNKNOWN Triad records conflict with the canonical model: %', unresolved
      USING HINT = 'Correct the data, or record a reviewed decision in triad_cutover_review_decisions (migration between 20260918185800 and 20260918185900). See scripts/triad-cutover-readiness.sql.';
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 2. Remove (archived first): whole groups for group-level conflicts,
--    duplicate session rows for session-level ones.
-- ----------------------------------------------------------------------------
CREATE TEMP TABLE _triad_remove_sessions ON COMMIT DROP AS
SELECT DISTINCT ON (s.id) s.id AS triad_session_id, x.classification, x.conflicts
FROM _triad_cleanup x
JOIN public.triad_sessions s
  ON (x.triad_session_id IS NULL AND s.triad_group_id = x.triad_group_id)
  OR s.id = x.triad_session_id;

CREATE TEMP TABLE _triad_remove_groups ON COMMIT DROP AS
SELECT DISTINCT x.triad_group_id, x.classification, x.conflicts
FROM _triad_cleanup x WHERE x.triad_session_id IS NULL;

INSERT INTO public.triad_cutover_archive (object_name, record_id, payload, migration_id)
SELECT 'cleanup.triad_groups', g.id,
  to_jsonb(g) || jsonb_build_object('classification', r.classification, 'conflicts', r.conflicts),
  '20260918185900_triad_legacy_data_cleanup'
FROM public.triad_groups g JOIN _triad_remove_groups r ON r.triad_group_id = g.id;

INSERT INTO public.triad_cutover_archive (object_name, record_id, payload, migration_id)
SELECT 'cleanup.triad_sessions', s.id,
  to_jsonb(s) || jsonb_build_object('classification', r.classification, 'conflicts', r.conflicts),
  '20260918185900_triad_legacy_data_cleanup'
FROM public.triad_sessions s JOIN _triad_remove_sessions r ON r.triad_session_id = s.id;

INSERT INTO public.triad_cutover_archive (object_name, record_id, payload, migration_id)
SELECT 'cleanup.triad_reflections', t.id, to_jsonb(t), '20260918185900_triad_legacy_data_cleanup'
FROM public.triad_reflections t JOIN _triad_remove_sessions r ON r.triad_session_id = t.triad_session_id;

INSERT INTO public.triad_cutover_archive (object_name, record_id, payload, migration_id)
SELECT 'cleanup.triad_alternative_proposals', p.id, to_jsonb(p), '20260918185900_triad_legacy_data_cleanup'
FROM public.triad_alternative_proposals p JOIN _triad_remove_sessions r ON r.triad_session_id = p.triad_session_id;

INSERT INTO public.triad_cutover_archive (object_name, record_id, payload, migration_id)
SELECT 'cleanup.session_activity_attributions', a.id, to_jsonb(a), '20260918185900_triad_legacy_data_cleanup'
FROM public.session_activity_attributions a JOIN _triad_remove_sessions r ON r.triad_session_id = a.source_activity_id
WHERE a.source_activity_type = 'triad';

DELETE FROM public.session_activity_attributions a USING _triad_remove_sessions r
WHERE a.source_activity_type = 'triad' AND a.source_activity_id = r.triad_session_id;
DELETE FROM public.triad_reflections t USING _triad_remove_sessions r WHERE t.triad_session_id = r.triad_session_id;
DELETE FROM public.triad_alternative_proposals p USING _triad_remove_sessions r WHERE p.triad_session_id = r.triad_session_id;
DELETE FROM public.triad_sessions s USING _triad_remove_sessions r WHERE s.id = r.triad_session_id;
DELETE FROM public.triad_groups g USING _triad_remove_groups r WHERE g.id = r.triad_group_id;

DO $$
DECLARE n_groups integer; n_sessions integer;
BEGIN
  SELECT count(*) INTO n_groups FROM _triad_remove_groups;
  SELECT count(*) INTO n_sessions FROM _triad_remove_sessions;
  IF n_groups + n_sessions > 0 THEN
    RAISE NOTICE 'Triad cleanup: removed % group(s) and % session(s) (archived in triad_cutover_archive): %', n_groups, n_sessions,
      (SELECT string_agg(format('%s %s [%s]', coalesce(x.triad_session_id::text, x.triad_group_id::text), x.classification, x.conflicts), '; ')
       FROM _triad_cleanup x);
  END IF;
END $$;
