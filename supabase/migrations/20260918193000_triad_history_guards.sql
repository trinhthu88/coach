-- ============================================================================
-- TRIAD HISTORY GUARDS (follow-up to 20260918190000_triad_canonical_cutover).
--
-- 1. A completed Triad session is programme evidence, and its reflections are
--    learner-authored content. Every child row (reflections -> answers,
--    responses, alternatives) cascades from triad_sessions, and the Admin
--    "manage" policy allows DELETE, so one API call could erase a completed
--    session with its reflections and evidence. Group deletion was already
--    refused for such history (triad_guard_group); the session now is too,
--    for every writer.
--
-- 2. triad_validate_group_member ran its "same learner twice" and "membership
--    is final" checks against the row being re-inserted, so an idempotent
--    INSERT ... ON CONFLICT (triad_group_id, enrollment_id) DO NOTHING of an
--    existing membership raised instead of doing nothing. Re-inserting an
--    existing (group, enrollment) row now defers to the unique constraint: it
--    either does nothing (ON CONFLICT) or fails as a duplicate. No new
--    membership can pass without the full validation.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.triad_guard_session_delete()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF OLD.status = 'completed'
     OR EXISTS (SELECT 1 FROM public.triad_reflections r WHERE r.triad_session_id = OLD.id) THEN
    RAISE EXCEPTION 'A completed Triad session or one with reflections is history and cannot be deleted' USING ERRCODE = '42501';
  END IF;
  RETURN OLD;
END $$;

CREATE TRIGGER triad_sessions_guard_delete
  BEFORE DELETE ON public.triad_sessions
  FOR EACH ROW EXECUTE FUNCTION public.triad_guard_session_delete();

CREATE OR REPLACE FUNCTION public.triad_validate_group_member()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  g public.triad_groups;
  req public.cohort_requirement_dates;
  e public.programme_enrollments;
BEGIN
  -- An existing (group, enrollment) row: the unique constraint decides
  -- (ON CONFLICT DO NOTHING, or a duplicate-key error). Nothing new is added.
  IF TG_OP = 'INSERT' AND EXISTS (
    SELECT 1 FROM public.triad_group_members x
    WHERE x.triad_group_id = NEW.triad_group_id AND x.enrollment_id = NEW.enrollment_id
  ) THEN
    RETURN NEW;
  END IF;

  SELECT * INTO g FROM public.triad_groups WHERE id = NEW.triad_group_id;
  SELECT * INTO e FROM public.programme_enrollments WHERE id = NEW.enrollment_id;
  IF g.cohort_requirement_date_id IS NULL THEN
    RAISE EXCEPTION 'Historical Triad groups without a requirement cannot change membership' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO req FROM public.cohort_requirement_dates WHERE id = g.cohort_requirement_date_id;
  IF e.cohort_id IS DISTINCT FROM req.cohort_id OR e.programme_id IS DISTINCT FROM req.programme_id THEN
    RAISE EXCEPTION 'Triad members must be enrolled in the requirement''s cohort and programme' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.triad_group_members o
    JOIN public.programme_enrollments oe ON oe.id = o.enrollment_id
    WHERE o.triad_group_id = NEW.triad_group_id AND o.id <> NEW.id AND oe.user_id = e.user_id
  ) THEN
    RAISE EXCEPTION 'A learner can appear only once in a Triad group' USING ERRCODE = '23505';
  END IF;
  IF g.is_active AND EXISTS (
    SELECT 1 FROM public.triad_group_members o
    JOIN public.triad_groups og ON og.id = o.triad_group_id
    WHERE o.enrollment_id = NEW.enrollment_id AND og.id <> g.id AND og.is_active
      AND og.cohort_requirement_date_id = g.cohort_requirement_date_id
  ) THEN
    RAISE EXCEPTION 'This learner is already in a Triad group for this requirement' USING ERRCODE = '23505';
  END IF;
  IF EXISTS (SELECT 1 FROM public.triad_sessions s WHERE s.triad_group_id = g.id AND s.status = 'completed') THEN
    RAISE EXCEPTION 'Membership of a Triad group with a completed session is final' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.triad_guard_session_delete(), public.triad_validate_group_member()
  FROM PUBLIC, anon, authenticated;

-- Final state: both guards are live.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'triad_sessions_guard_delete'
                 AND tgrelid = 'public.triad_sessions'::regclass AND tgenabled <> 'D') THEN
    RAISE EXCEPTION 'Triad history guards: the session delete guard is missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'triad_group_members_validate'
                 AND tgrelid = 'public.triad_group_members'::regclass AND tgenabled <> 'D') THEN
    RAISE EXCEPTION 'Triad history guards: the membership validation trigger is missing';
  END IF;
END $$;
