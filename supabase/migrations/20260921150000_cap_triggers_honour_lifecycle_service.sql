-- The entitlement cap triggers must not re-authorise the lifecycle service
-- (found by the first real pgTAP execution of the Coaching reschedule path).
--
-- validate_coaching_session_cap() and validate_mentoring_session_cap() fire on
-- INSERT and delegate to can_book_session() / can_book_mentoring_session().
-- Both of those begin with an ACTOR check:
--
--   IF p_coachee_id IS DISTINCT FROM auth.uid() AND NOT admin THEN RETURN false
--
-- which is correct for a learner booking their own session, and wrong for
-- every other legitimate writer. reschedule_coaching_session() deliberately
-- admits the session's Coach and an Admin, and 20260921100000 split
-- authorisation from validation so those actors could reach the validated
-- insert -- but the cap trigger then re-applied the learner-only test against
-- auth.uid() and refused the row. The Coach reschedule fixed in C3 therefore
-- still failed, one layer further down.
--
-- The fix is the escape hatch that already exists for exactly this situation:
-- app.session_transition, which guard_session_protected_fields() has always
-- honoured. When it is set, a canonical lifecycle function is performing the
-- write and has ALREADY validated enrollment eligibility, provider
-- eligibility, requirement availability and the slot, in the same transaction:
--
--   book_coaching_session_internal()   pool, requirement free, module enabled,
--                                      enrollment active, slot window
--   book_mentoring_session_internal()  the same for Mentoring
--
-- so re-running a partial copy of those rules from a trigger adds nothing
-- except a contradictory actor test. When the flag is absent -- an ad-hoc
-- INSERT straight into the table, which is the case the cap trigger exists to
-- catch -- every check still applies exactly as before.
--
-- This narrows the trigger's scope; it does not weaken the rule. The rule now
-- lives in one place instead of two that disagree.

CREATE OR REPLACE FUNCTION public.validate_coaching_session_cap()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF NEW.enrollment_id IS NULL THEN
    RAISE EXCEPTION 'Coaching booking requires an enrollment' USING ERRCODE = '42501';
  END IF;

  -- A canonical lifecycle function is writing this row and has already
  -- validated it. Direct table writes carry no flag and are still checked.
  IF current_setting('app.session_transition', true) = 'on' THEN
    RETURN NEW;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.enrollment_id::text, 0));
  IF TG_OP = 'INSERT'
     AND NOT public.can_book_session(NEW.coachee_id, NEW.coach_id, NEW.enrollment_id) THEN
    RAISE EXCEPTION 'Coaching entitlement has been exhausted or booking is not allowed'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.validate_mentoring_session_cap()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF NEW.enrollment_id IS NULL THEN
    RAISE EXCEPTION 'Mentoring booking requires an enrollment' USING ERRCODE = '42501';
  END IF;

  IF current_setting('app.session_transition', true) = 'on' THEN
    RETURN NEW;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.enrollment_id::text, 0));
  IF TG_OP = 'INSERT'
     AND NOT public.can_book_mentoring_session(NEW.mentee_id, NEW.mentor_id, NEW.enrollment_id) THEN
    RAISE EXCEPTION 'Mentoring entitlement has been exhausted or booking is not allowed'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.validate_coaching_session_cap() IS
  'Entitlement guard for ad-hoc INSERTs into sessions. Skipped when '
  'app.session_transition is set, because a canonical lifecycle function is '
  'then the writer and has already validated the row.';
COMMENT ON FUNCTION public.validate_mentoring_session_cap() IS
  'Entitlement guard for ad-hoc INSERTs into mentoring_sessions. Skipped when '
  'app.session_transition is set, for the same reason.';

DO $$
BEGIN
  IF pg_get_functiondef('public.validate_coaching_session_cap()'::regprocedure)
       !~ 'app\.session_transition' THEN
    RAISE EXCEPTION 'Cap triggers: the Coaching cap still re-authorises the lifecycle service';
  END IF;
  IF pg_get_functiondef('public.validate_mentoring_session_cap()'::regprocedure)
       !~ 'app\.session_transition' THEN
    RAISE EXCEPTION 'Cap triggers: the Mentoring cap still re-authorises the lifecycle service';
  END IF;
END $$;
