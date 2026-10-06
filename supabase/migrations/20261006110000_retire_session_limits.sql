-- ===========================================================================
-- Retire the session limits (follow-up to 20261005130000_one_quantity_authority,
-- findings L-1, D-1, P-5)
--
-- 20261005130000 made the cohort's requirements (programme_modules.config
-- required_units) the only answer to "how many sessions", and took
-- receive_limit / give_limit / programmes.coachee_session_limit out of booking
-- eligibility. Three leftovers still answered the question differently:
--
--   1. enforce_coach_as_coachee_limit(), an AFTER trigger on sessions and
--      peer_sessions, raised on every insert or status change once completed
--      sessions reached config.receive_limit (Coaching) / monthly_limit
--      (Peer). With receive_limit = required_units the Coach could not
--      complete the learner's last required session; a cancellation after the
--      limit failed too. Dropped. The Peer practice entitlement stays, owned
--      by assert_peer_session_bookable_internal() at booking (live and
--      completed sessions, 20261006100000).
--   2. get_coachee_session_usage_for_enrollment() served receive_limit to the
--      learner dashboard and the Coach "My journey" page, which showed raw
--      completed rows over it. Dropped; those pages render
--      learner_canonical_progress.
--   3. check_mentoring_given_usage() / get_mentoring_given_usage() /
--      get_mentoring_given_limit() marked a Mentor "at capacity" by give_limit,
--      which booking no longer consults. Dropped.
--   4. validate_programme_module_config() refused a Coaching or Mentoring
--      required_units above a stored give_limit / receive_limit, so an Admin
--      could not raise the requirement of a programme that still carried an
--      old limit (the editor no longer shows one). Coaching and Mentoring
--      limits are no longer validated; Peer and Triad checks are unchanged.
--
-- programmes.coachee_session_limit / mentoring_received_limit and the
-- receive_limit / give_limit config keys stay in storage as history; nothing
-- reads them for a current answer.
-- ===========================================================================

DROP TRIGGER IF EXISTS trg_enforce_coach_as_coachee_limit_sessions ON public.sessions;
DROP TRIGGER IF EXISTS trg_enforce_coach_as_coachee_limit_peer ON public.peer_sessions;
DROP FUNCTION IF EXISTS public.enforce_coach_as_coachee_limit();

DROP FUNCTION IF EXISTS public.get_coachee_session_usage_for_enrollment(uuid);

DROP FUNCTION IF EXISTS public.check_mentoring_given_usage(uuid);
DROP FUNCTION IF EXISTS public.get_mentoring_given_usage(uuid);
DROP FUNCTION IF EXISTS public.get_mentoring_given_limit(uuid);

CREATE OR REPLACE FUNCTION public.validate_programme_module_config()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  required_units integer;
  required_flag boolean;
  give_limit integer;
  receive_limit integer;
  legacy_limit integer;
  triad_limit integer;
BEGIN
  required_units := COALESCE(public.programme_config_integer(NEW.config, 'required_units'), 0);
  required_flag := COALESCE((NEW.config->>'required')::boolean, false);

  IF required_flag AND required_units = 0 THEN
    RAISE EXCEPTION 'Required modules must have at least one required unit' USING ERRCODE = '22023';
  END IF;

  -- Coaching and Mentoring: required_units is the whole answer; a stored
  -- give_limit / receive_limit is history and constrains nothing.
  IF NEW.module = 'peer_coaching'::public.programme_module_type THEN
    give_limit := public.programme_config_integer(NEW.config, 'give_limit');
    receive_limit := public.programme_config_integer(NEW.config, 'receive_limit');
    legacy_limit := public.programme_config_integer(NEW.config, 'monthly_limit');
    IF give_limit IS NULL THEN give_limit := legacy_limit; END IF;
    IF receive_limit IS NULL THEN receive_limit := legacy_limit; END IF;
    IF COALESCE((NEW.config->>'give')::boolean, false)
       AND give_limit IS NOT NULL AND required_units > give_limit THEN
      RAISE EXCEPTION 'Required target cannot exceed the maximum peer sessions given' USING ERRCODE = '22023';
    END IF;
    IF COALESCE((NEW.config->>'receive')::boolean, false)
       AND receive_limit IS NOT NULL AND required_units > receive_limit THEN
      RAISE EXCEPTION 'Required target cannot exceed the maximum peer sessions received' USING ERRCODE = '22023';
    END IF;
  ELSIF NEW.module = 'triads'::public.programme_module_type THEN
    triad_limit := public.programme_config_integer(NEW.config, 'max_triads');
    IF triad_limit IS NOT NULL AND required_units > triad_limit THEN
      RAISE EXCEPTION 'Required target cannot exceed the maximum triad sessions per participant' USING ERRCODE = '22023';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

COMMENT ON COLUMN public.programmes.coachee_session_limit IS
  'HISTORICAL. Never a current requirement or cap since 20261005130000: read programme_modules.config required_units.';
COMMENT ON COLUMN public.programmes.mentoring_received_limit IS
  'HISTORICAL. Never a current requirement or cap since 20261005130000: read programme_modules.config required_units.';

-- ---------------------------------------------------------------------------
-- Final-state guard: no trigger or function on the session tables counts
-- sessions against a configured limit.
-- ---------------------------------------------------------------------------
DO $verify$
DECLARE bad text;
BEGIN
  SELECT string_agg(DISTINCT p.proname, ', ') INTO bad
  FROM pg_trigger t
  JOIN pg_proc p ON p.oid = t.tgfoid
  WHERE NOT t.tgisinternal
    AND t.tgrelid IN ('public.sessions'::regclass, 'public.mentoring_sessions'::regclass,
                      'public.coachee_peer_sessions'::regclass)
    AND p.prosrc ~ '(receive_limit|give_limit|monthly_limit|coachee_session_limit|mentoring_received_limit)';
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'A session trigger still enforces a configured limit: %', bad;
  END IF;
END
$verify$;
