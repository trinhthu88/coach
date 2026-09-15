-- Final enrollment-scoped enforcement.
--
-- This migration is intentionally gated by the post-retirement readiness
-- report. Retired legacy rows remain in place for auditability, so their
-- nullable ownership columns use a validated exception tied to the immutable
-- retirement ledger. All new writes are already rejected by the ownership
-- triggers; these constraints close the remaining database-level gap.

DO $$
DECLARE
  unresolved_count integer;
BEGIN
  WITH unresolved AS (
    SELECT table_name AS domain, record_id
    FROM public.enrollment_scope_backfill_audit
    UNION ALL
    SELECT 'actions/' || a.source_activity_type, a.source_activity_id
    FROM public.enrollment_action_backfill_audit a
    WHERE NOT public.is_historical_ownership_retired(
      'actions/' || a.source_activity_type,
      a.source_activity_id
    )
    UNION ALL
    SELECT 'schedule', enrollment_id
    FROM public.enrollment_schedule_backfill_audit
  )
  SELECT count(*)::integer INTO unresolved_count FROM unresolved;

  IF unresolved_count <> 0 THEN
    RAISE EXCEPTION
      'Cannot apply final enrollment enforcement with % unresolved records',
      unresolved_count
      USING ERRCODE = 'P0001';
  END IF;
END $$;

-- These tables have no retained null-ownership rows.
ALTER TABLE public.coachee_peer_sessions
  ALTER COLUMN enrollment_id SET NOT NULL;
ALTER TABLE public.mentoring_sessions
  ALTER COLUMN enrollment_id SET NOT NULL;
ALTER TABLE public.training_progress
  ALTER COLUMN enrollment_id SET NOT NULL;
ALTER TABLE public.assignment_submissions
  ALTER COLUMN enrollment_id SET NOT NULL;
ALTER TABLE public.daily_prompt_responses
  ALTER COLUMN enrollment_id SET NOT NULL;
ALTER TABLE public.reflection_submissions
  ALTER COLUMN enrollment_id SET NOT NULL;
ALTER TABLE public.coachee_goal_ratings
  ALTER COLUMN enrollment_id SET NOT NULL;
ALTER TABLE public.triad_groups
  ALTER COLUMN enrollment_1_id SET NOT NULL,
  ALTER COLUMN enrollment_2_id SET NOT NULL;
ALTER TABLE public.triad_sessions
  ALTER COLUMN coach_enrollment_id SET NOT NULL,
  ALTER COLUMN coachee_enrollment_id SET NOT NULL;

-- Retired rows are retained in the original tables, but only the exact rows
-- recorded in the retirement ledger may remain without ownership.
ALTER TABLE public.sessions
  DROP CONSTRAINT IF EXISTS sessions_enrollment_required;
ALTER TABLE public.sessions
  ADD CONSTRAINT sessions_enrollment_required
  CHECK (
    enrollment_id IS NOT NULL
    OR public.is_historical_ownership_retired('sessions', id)
  ) NOT VALID;
ALTER TABLE public.sessions
  VALIDATE CONSTRAINT sessions_enrollment_required;

ALTER TABLE public.peer_sessions
  DROP CONSTRAINT IF EXISTS peer_sessions_enrollment_required;
ALTER TABLE public.peer_sessions
  ADD CONSTRAINT peer_sessions_enrollment_required
  CHECK (
    enrollment_id IS NOT NULL
    OR public.is_historical_ownership_retired('peer_sessions', id)
  ) NOT VALID;
ALTER TABLE public.peer_sessions
  VALIDATE CONSTRAINT peer_sessions_enrollment_required;

ALTER TABLE public.coachee_goals
  DROP CONSTRAINT IF EXISTS coachee_goals_enrollment_required;
ALTER TABLE public.coachee_goals
  ADD CONSTRAINT coachee_goals_enrollment_required
  CHECK (
    enrollment_id IS NOT NULL
    OR public.is_historical_ownership_retired('coachee_goals', id)
  ) NOT VALID;
ALTER TABLE public.coachee_goals
  VALIDATE CONSTRAINT coachee_goals_enrollment_required;

ALTER TABLE public.coachee_milestones
  DROP CONSTRAINT IF EXISTS coachee_milestones_enrollment_required;
ALTER TABLE public.coachee_milestones
  ADD CONSTRAINT coachee_milestones_enrollment_required
  CHECK (
    enrollment_id IS NOT NULL
    OR public.is_historical_ownership_retired('coachee_milestones', id)
  ) NOT VALID;
ALTER TABLE public.coachee_milestones
  VALIDATE CONSTRAINT coachee_milestones_enrollment_required;

ALTER TABLE public.triad_reflections
  DROP CONSTRAINT IF EXISTS triad_reflections_enrollment_required;
ALTER TABLE public.triad_reflections
  ADD CONSTRAINT triad_reflections_enrollment_required
  CHECK (
    enrollment_id IS NOT NULL
    OR public.is_historical_ownership_retired('triad_reflections', id)
  ) NOT VALID;
ALTER TABLE public.triad_reflections
  VALIDATE CONSTRAINT triad_reflections_enrollment_required;

COMMENT ON COLUMN public.sessions.enrollment_id IS
  'Required for all non-retired activity; retained historical exceptions are ledgered in enrollment_ownership_retirements.';
COMMENT ON COLUMN public.coachee_goals.enrollment_id IS
  'Required for all non-retired goals; retained historical exceptions are ledgered in enrollment_ownership_retirements.';