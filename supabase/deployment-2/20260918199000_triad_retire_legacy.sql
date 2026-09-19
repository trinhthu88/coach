-- ============================================================================
-- TRIAD LEGACY RETIREMENT — DEPLOYMENT 2 ONLY.
--
-- Lives in supabase/deployment-2/, NOT supabase/migrations/, so an ordinary
-- `supabase db push` of deployment 1 can never apply it. Deployment 1 ships
-- 20260918185900 .. 20260918195000 (cleanup, cutover, backfill,
-- in-migration equivalence proof, canonical completion, engagement signals)
-- while every legacy column stays in place (no longer read or written). This
-- file is moved into supabase/migrations/ and applied in a separate, later
-- deployment, only after deployment 1 has been verified on production and no
-- runtime consumer of a legacy shape remains.
--
-- Legacy shape ............................... canonical replacement
--   triad_rounds, programme_triad_rounds ..... none (programme = quantity,
--                                              cohort_requirement_dates = dates)
--   triad_groups.member_1/2/3_id,
--     enrollment_1/2/3_id .................... triad_group_members
--   triad_groups.programme_id / round_number /
--     triad_round_id / name .................. none (triad_groups.cohort_id
--                                              is the group's scope; programme
--                                              comes from the members'
--                                              enrollments)
--   triad_sessions.coach/coachee/observer_
--     enrollment_id .......................... triad_group_members
--   triad_sessions.member_1/2/3_response,
--     triad_alternative_proposals.member_N_
--     response ............................... *_responses tables
--   triad_sessions.proposed_start/end_time,
--     start_time, proposed_by ................ scheduled_start/end_time
--   triad_alternative_proposals.proposed_by .. proposed_by_enrollment_id
--   triad_reflections.participant_id ......... enrollment_id
--   triad_reflections.learned_as_* / will_use_
--     as_* ................................... triad_reflection_answers
-- ============================================================================

-- 1. Archive every legacy value (one row per record and object).
INSERT INTO public.triad_cutover_archive (object_name, record_id, payload, migration_id)
SELECT 'triad_groups.legacy', g.id,
  jsonb_build_object('cohort_id', g.cohort_id, 'programme_id', g.programme_id, 'name', g.name,
    'round_number', g.round_number, 'triad_round_id', g.triad_round_id,
    'member_1_id', g.member_1_id, 'member_2_id', g.member_2_id, 'member_3_id', g.member_3_id,
    'enrollment_1_id', g.enrollment_1_id, 'enrollment_2_id', g.enrollment_2_id, 'enrollment_3_id', g.enrollment_3_id),
  '20260918199000_triad_retire_legacy'
FROM public.triad_groups g
ON CONFLICT (object_name, record_id) DO NOTHING;

INSERT INTO public.triad_cutover_archive (object_name, record_id, payload, migration_id)
SELECT 'triad_sessions.legacy', s.id,
  jsonb_build_object('coach_enrollment_id', s.coach_enrollment_id, 'coachee_enrollment_id', s.coachee_enrollment_id,
    'observer_enrollment_id', s.observer_enrollment_id, 'member_1_response', s.member_1_response,
    'member_2_response', s.member_2_response, 'member_3_response', s.member_3_response,
    'proposed_start_time', s.proposed_start_time, 'proposed_end_time', s.proposed_end_time,
    'start_time', s.start_time, 'proposed_by', s.proposed_by),
  '20260918199000_triad_retire_legacy'
FROM public.triad_sessions s
ON CONFLICT (object_name, record_id) DO NOTHING;

INSERT INTO public.triad_cutover_archive (object_name, record_id, payload, migration_id)
SELECT 'triad_alternative_proposals.legacy', p.id,
  jsonb_build_object('proposed_by', p.proposed_by, 'member_1_response', p.member_1_response,
    'member_2_response', p.member_2_response, 'member_3_response', p.member_3_response),
  '20260918199000_triad_retire_legacy'
FROM public.triad_alternative_proposals p
ON CONFLICT (object_name, record_id) DO NOTHING;

INSERT INTO public.triad_cutover_archive (object_name, record_id, payload, migration_id)
SELECT 'triad_reflections.legacy', r.id,
  jsonb_build_object('participant_id', r.participant_id,
    'learned_as_coach', r.learned_as_coach, 'will_use_as_coach', r.will_use_as_coach,
    'learned_as_coachee', r.learned_as_coachee, 'will_use_as_coachee', r.will_use_as_coachee,
    'learned_as_observer', r.learned_as_observer, 'will_use_as_observer', r.will_use_as_observer),
  '20260918199000_triad_retire_legacy'
FROM public.triad_reflections r
ON CONFLICT (object_name, record_id) DO NOTHING;

-- Rounds were archived by the cutover; anything created since is archived too.
INSERT INTO public.triad_cutover_archive (object_name, record_id, payload, migration_id)
SELECT 'triad_rounds', tr.id, to_jsonb(tr), '20260918199000_triad_retire_legacy'
FROM public.triad_rounds tr
ON CONFLICT (object_name, record_id) DO NOTHING;
INSERT INTO public.triad_cutover_archive (object_name, record_id, payload, migration_id)
SELECT 'programme_triad_rounds', p.id, to_jsonb(p), '20260918199000_triad_retire_legacy'
FROM public.programme_triad_rounds p
ON CONFLICT (object_name, record_id) DO NOTHING;

-- Before dropping, prove the archive holds every legacy answer and author.
DO $$
DECLARE n bigint;
BEGIN
  SELECT count(*) INTO n FROM public.triad_reflections r
  WHERE NOT EXISTS (SELECT 1 FROM public.triad_cutover_archive a
                    WHERE a.object_name = 'triad_reflections.legacy' AND a.record_id = r.id
                      AND a.payload->>'participant_id' IS NOT DISTINCT FROM r.participant_id::text
                      AND a.payload->>'learned_as_coach' IS NOT DISTINCT FROM r.learned_as_coach
                      AND a.payload->>'will_use_as_observer' IS NOT DISTINCT FROM r.will_use_as_observer);
  IF n > 0 THEN RAISE EXCEPTION 'Triad retirement: % reflections not archived', n; END IF;
END $$;

-- 2. Drop the legacy shapes.
ALTER TABLE public.triad_groups
  DROP COLUMN member_1_id,
  DROP COLUMN member_2_id,
  DROP COLUMN member_3_id,
  DROP COLUMN enrollment_1_id,
  DROP COLUMN enrollment_2_id,
  DROP COLUMN enrollment_3_id,
  DROP COLUMN programme_id,
  DROP COLUMN round_number,
  DROP COLUMN triad_round_id,
  DROP COLUMN name;

ALTER TABLE public.triad_sessions
  DROP COLUMN coach_enrollment_id,
  DROP COLUMN coachee_enrollment_id,
  DROP COLUMN observer_enrollment_id,
  DROP COLUMN member_1_response,
  DROP COLUMN member_2_response,
  DROP COLUMN member_3_response,
  DROP COLUMN proposed_start_time,
  DROP COLUMN proposed_end_time,
  DROP COLUMN start_time,
  DROP COLUMN proposed_by;

ALTER TABLE public.triad_alternative_proposals
  DROP COLUMN proposed_by,
  DROP COLUMN member_1_response,
  DROP COLUMN member_2_response,
  DROP COLUMN member_3_response;

ALTER TABLE public.triad_reflections
  DROP COLUMN participant_id,
  DROP COLUMN learned_as_coach,
  DROP COLUMN will_use_as_coach,
  DROP COLUMN learned_as_coachee,
  DROP COLUMN will_use_as_coachee,
  DROP COLUMN learned_as_observer,
  DROP COLUMN will_use_as_observer;

DROP TABLE public.triad_rounds;
DROP TABLE public.programme_triad_rounds;

-- 3. Unused legacy helpers.
DROP FUNCTION IF EXISTS public.triad_is_seed_identifier(uuid);

-- 4. Final-state guard: the retired Triad shapes are gone and no live
--    function, view or policy refers to them.
DO $$
DECLARE offenders text;
BEGIN
  IF to_regclass('public.triad_rounds') IS NOT NULL OR to_regclass('public.programme_triad_rounds') IS NOT NULL THEN
    RAISE EXCEPTION 'Triad retirement: legacy round tables still exist';
  END IF;
  SELECT string_agg(table_name || '.' || column_name, ', ') INTO offenders
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name IN ('triad_groups', 'triad_sessions', 'triad_alternative_proposals', 'triad_reflections')
    AND column_name ~ '^(member_[123]_(id|response)|enrollment_[123]_id|(coach|coachee|observer)_enrollment_id|participant_id|(learned|will_use)_as_.*|proposed_(start|end)_time_legacy|start_time|round_number|triad_round_id|programme_id|name|proposed_by)$';
  IF offenders IS NOT NULL THEN
    RAISE EXCEPTION 'Triad retirement: legacy columns remain: %', offenders;
  END IF;
  SELECT string_agg(p.proname, ', ') INTO offenders
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.prokind = 'f'
    AND pg_get_functiondef(p.oid) ~ '(coach|coachee|observer)_enrollment_id|member_[123]_(id|response)|enrollment_[123]_id|triad_rounds|triad_round_id|cohort_requirement_date_id|completion_deadline|[a-z]\.(learned|will_use)_as_';
  IF offenders IS NOT NULL THEN
    RAISE EXCEPTION 'Triad retirement: functions still refer to retired Triad fields: %', offenders;
  END IF;
  -- Internal Triad constructions stay internal.
  SELECT string_agg(p.proname, ', ') INTO offenders
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.prokind = 'f'
    AND (p.proname LIKE 'triad\_%' OR p.proname = 'canonical_triad_group_members')
    AND p.proname NOT IN ('triad_reflections_visible_to_group')
    AND has_function_privilege('authenticated', p.oid, 'EXECUTE');
  IF offenders IS NOT NULL THEN
    RAISE EXCEPTION 'Triad retirement: internal Triad functions are client-callable: %', offenders;
  END IF;
END $$;
