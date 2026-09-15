-- Peer coaching activity is recorded in one of two tables (peer_sessions,
-- for a coach-given peer session, or coachee_peer_sessions, for
-- coachee-to-coachee peer practice) under the single shared attribution
-- label source_activity_type = 'peer_coaching'. get_sponsor_programme_progress
-- and get_sponsor_programme_journey (20260915155000_sponsor_programme_progress_source.sql)
-- UNION ALL a branch per table, but both branches filter only on
-- a.source_activity_type = 'peer_coaching' and LEFT JOIN their own table —
-- so every peer_coaching attribution row is matched by *both* branches
-- (once with a real row from whichever table actually owns it, once with
-- an all-NULL row from the other), and is counted twice. get_enrollment_progress
-- already had and fixed this exact bug by switching to a plain INNER JOIN
-- keyed only on s.id = a.source_activity_id; it was never carried over when
-- these two sponsor-specific functions were written. Applying the same fix
-- here makes peer coaching completed/entitled/due units, and every derived
-- leaders-completed count, match the underlying leader activity instead of
-- double-counting it.
DO $migration$
DECLARE
  fn_oid regprocedure;
  current_definition text;
  updated_definition text;
BEGIN
  FOREACH fn_oid IN ARRAY ARRAY[
    'public.get_sponsor_programme_progress(uuid, date)'::regprocedure,
    'public.get_sponsor_programme_journey(uuid, date)'::regprocedure
  ]
  LOOP
    SELECT pg_get_functiondef(fn_oid) INTO current_definition;

    updated_definition := replace(
      current_definition,
      E'LEFT JOIN public.peer_sessions s\n      ON a.source_activity_type = ''peer_coaching'' AND s.id = a.source_activity_id',
      E'JOIN public.peer_sessions s\n      ON s.id = a.source_activity_id'
    );
    updated_definition := replace(
      updated_definition,
      E'LEFT JOIN public.coachee_peer_sessions s\n      ON a.source_activity_type = ''peer_coaching'' AND s.id = a.source_activity_id',
      E'JOIN public.coachee_peer_sessions s\n      ON s.id = a.source_activity_id'
    );

    IF updated_definition = current_definition THEN
      RAISE EXCEPTION 'Expected peer-coaching join expressions were not found in %', fn_oid;
    END IF;

    EXECUTE updated_definition;
  END LOOP;
END
$migration$;
