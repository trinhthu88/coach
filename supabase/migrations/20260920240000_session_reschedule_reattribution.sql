-- Re-attribute a session's cadence milestone when it is rescheduled.
--
-- attribute_new_activity_trigger() fires AFTER INSERT only, and the helper it
-- calls ends in
--
--   ON CONFLICT (source_activity_type, source_activity_id, enrollment_id) DO NOTHING
--
-- so moving a session's start_time leaves session_activity_attributions
-- holding the ORIGINAL occurred_on and milestone_id. A session rescheduled
-- from checkpoint 1 to checkpoint 3 still reports against checkpoint 1: the
-- learner's own history shows the new date while canonical progress counts the
-- old one, and Sponsor and Learner views disagree.
--
-- Section 6 asks to reuse the canonical re-attribution pattern established for
-- Coaching. There is none -- `sessions` carries the identical AFTER INSERT
-- trigger and the identical defect. So the pattern is created here and
-- attached to BOTH mentoring_sessions and sessions: fixing only Mentoring
-- would leave a known, identical data-correctness bug live for Coaching.
--
-- Re-attribution deletes the stale row and lets the existing helper decide the
-- new milestone, so the milestone rules stay in exactly one place.

CREATE OR REPLACE FUNCTION public.reattribute_activity_on_reschedule()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_module text;
BEGIN
  IF NEW.enrollment_id IS NULL THEN
    RETURN NEW;
  END IF;

  v_module := CASE TG_TABLE_NAME
    WHEN 'sessions' THEN 'coaching'
    WHEN 'mentoring_sessions' THEN 'mentoring'
    WHEN 'peer_sessions' THEN 'peer_coaching'
    WHEN 'coachee_peer_sessions' THEN 'peer_coaching'
  END;
  IF v_module IS NULL THEN
    RETURN NEW;
  END IF;

  -- Clear the stale attribution so the helper's ON CONFLICT DO NOTHING no
  -- longer suppresses the rewrite, then let it re-derive occurred_on and the
  -- milestone from the new date.
  DELETE FROM public.session_activity_attributions a
  WHERE a.enrollment_id = NEW.enrollment_id
    AND a.source_activity_type = v_module
    AND a.source_activity_id = NEW.id;

  PERFORM public.attribute_activity_to_cadence_milestone(
    NEW.enrollment_id, v_module, NEW.id, NEW.start_time::date);

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.reattribute_activity_on_reschedule() IS
  'Rewrites session_activity_attributions when a session start_time moves, so '
  'occurred_on and milestone_id follow the reschedule instead of pinning the '
  'original date.';

-- Only when the date actually moves, and only while the session is still a
-- live or completed one: a cancelled session should keep whatever attribution
-- history it had rather than acquiring a fresh milestone.
CREATE TRIGGER mentoring_sessions_reattribute_on_reschedule
  AFTER UPDATE OF start_time ON public.mentoring_sessions
  FOR EACH ROW
  WHEN (
    OLD.start_time IS DISTINCT FROM NEW.start_time
    AND NEW.status IN ('pending_coach_approval', 'confirmed', 'completed')
  )
  EXECUTE FUNCTION public.reattribute_activity_on_reschedule();

CREATE TRIGGER sessions_reattribute_on_reschedule
  AFTER UPDATE OF start_time ON public.sessions
  FOR EACH ROW
  WHEN (
    OLD.start_time IS DISTINCT FROM NEW.start_time
    AND NEW.status IN ('pending_coach_approval', 'confirmed', 'completed')
  )
  EXECUTE FUNCTION public.reattribute_activity_on_reschedule();
