-- Deployment 2 archive reconstruction check (READ-ONLY).
--
-- Run against an isolated database after the candidate has completed. It
-- proves that every retired field can be reconstructed from the surviving
-- canonical row plus its archive payload. Round rows are checked as
-- standalone JSONB snapshots because their source tables no longer exist.

\set ON_ERROR_STOP on
BEGIN TRANSACTION READ ONLY;

DO $$
DECLARE n bigint;
BEGIN
  SELECT count(*) INTO n
  FROM public.triad_cutover_archive a
  WHERE a.migration_id = '20260919190000_triad_retire_legacy'
    AND (
      a.object_name = 'triad_groups.legacy'
      AND NOT (a.payload ?& ARRAY[
      'member_1_id', 'member_2_id', 'member_3_id',
      'enrollment_1_id', 'enrollment_2_id', 'enrollment_3_id',
      'programme_id', 'round_number', 'triad_round_id', 'name'
      ])
    )
    OR (
      a.migration_id = '20260919190000_triad_retire_legacy'
      AND a.object_name = 'triad_sessions.legacy'
      AND NOT (a.payload ?& ARRAY[
      'coach_enrollment_id', 'coachee_enrollment_id', 'observer_enrollment_id',
      'member_1_response', 'member_2_response', 'member_3_response',
      'proposed_start_time', 'proposed_end_time', 'start_time', 'proposed_by'
      ])
    )
    OR (
      a.migration_id = '20260919190000_triad_retire_legacy'
      AND a.object_name = 'triad_alternative_proposals.legacy'
      AND NOT (a.payload ?& ARRAY[
      'proposed_by', 'member_1_response', 'member_2_response', 'member_3_response'
      ])
    )
    OR (
      a.migration_id = '20260919190000_triad_retire_legacy'
      AND a.object_name = 'triad_reflections.legacy'
      AND NOT (a.payload ?& ARRAY[
      'participant_id', 'learned_as_coach', 'will_use_as_coach',
      'learned_as_coachee', 'will_use_as_coachee',
      'learned_as_observer', 'will_use_as_observer'
      ])
    )
    );
  IF n > 0 THEN
    RAISE EXCEPTION 'Archive reconstruction: % payloads miss retired fields', n;
  END IF;

  -- Groups remain live; compare the archived context needed to reconstruct
  -- the retired relationship against the canonical row.
  SELECT count(*) INTO n
  FROM public.triad_cutover_archive a
  JOIN public.triad_groups g ON g.id = a.record_id
  WHERE a.migration_id = '20260919190000_triad_retire_legacy'
    AND a.object_name = 'triad_groups.legacy'
    AND (a.payload->>'cohort_id')::uuid IS DISTINCT FROM g.cohort_id;
  IF n > 0 THEN
    RAISE EXCEPTION 'Archive reconstruction: % group cohort values differ', n;
  END IF;

  SELECT count(*) INTO n
  FROM public.triad_cutover_archive a
  JOIN public.triad_sessions s ON s.id = a.record_id
  WHERE a.migration_id = '20260919190000_triad_retire_legacy'
    AND a.object_name = 'triad_sessions.legacy'
    AND (a.payload->>'triad_group_id')::uuid IS DISTINCT FROM s.triad_group_id;
  IF n > 0 THEN
    RAISE EXCEPTION 'Archive reconstruction: % session group relationships differ', n;
  END IF;

  SELECT count(*) INTO n
  FROM public.triad_cutover_archive a
  JOIN public.triad_alternative_proposals p ON p.id = a.record_id
  WHERE a.migration_id = '20260919190000_triad_retire_legacy'
    AND a.object_name = 'triad_alternative_proposals.legacy'
    AND (a.payload->>'triad_session_id')::uuid IS DISTINCT FROM p.triad_session_id;
  IF n > 0 THEN
    RAISE EXCEPTION 'Archive reconstruction: % proposal session relationships differ', n;
  END IF;

  SELECT count(*) INTO n
  FROM public.triad_cutover_archive a
  JOIN public.triad_reflections r ON r.id = a.record_id
  WHERE a.migration_id = '20260919190000_triad_retire_legacy'
    AND a.object_name = 'triad_reflections.legacy'
    AND (
      (a.payload->>'triad_session_id')::uuid IS DISTINCT FROM r.triad_session_id
      OR (a.payload->>'enrollment_id')::uuid IS DISTINCT FROM r.enrollment_id
    );
  IF n > 0 THEN
    RAISE EXCEPTION 'Archive reconstruction: % reflection ownership rows differ', n;
  END IF;

  -- The round source tables are gone. Their archive rows must be standalone
  -- objects with an internally consistent UUID id.
  SELECT count(*) INTO n
  FROM public.triad_cutover_archive a
  WHERE a.object_name IN ('triad_rounds', 'programme_triad_rounds')
    AND (
      jsonb_typeof(a.payload) <> 'object'
      OR a.payload->>'id' IS NULL
      OR a.payload->>'id' <> a.record_id::text
    );
  IF n > 0 THEN
    RAISE EXCEPTION 'Archive reconstruction: % round snapshots are not standalone full-row objects', n;
  END IF;
END $$;

\echo 'Archive reconstruction checks passed'
ROLLBACK;