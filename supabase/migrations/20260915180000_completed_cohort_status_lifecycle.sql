-- Completed-cohort enrollment status lifecycle.
--
-- Cohort lifecycle (has the cohort ended?) and learner fulfilment (did this
-- leader finish their requirements?) are distinct facts. Once a cohort has
-- ended, an enrollment whose stored status was never transitioned off its
-- day-to-day value must not keep rendering as if the programme were still
-- running. sponsor_enrollment_summaries() and sponsor_organisation_summary()
-- already recompute an "effective" status for this case, but only when the
-- raw stored status is 'active'. Real enrollments (and the Cohort C seed
-- fixture) commonly sit at 'at_risk' day-to-day, so a leader who goes on to
-- finish every requirement before the cohort ends still shows as 'at_risk'
-- forever, and a leader who never finishes is stuck the same way instead of
-- being recognised as not having completed. Broaden the override to also
-- apply to 'at_risk': the cohort ending should reclassify either raw state
-- into 'completed' (all requirements met) or 'at_risk' (they were not).
-- 'paused' and already-'completed' are deliberate states and stay untouched.
DO $migration$
DECLARE
  current_definition text;
  updated_definition text;
BEGIN
  SELECT pg_get_functiondef('public.sponsor_enrollment_summaries(uuid)'::regprocedure)
  INTO current_definition;

  updated_definition := replace(
    current_definition,
    E'WHEN e.status = ''active'' AND e.programme_end_date < current_date',
    E'WHEN e.status IN (''active'', ''at_risk'') AND e.programme_end_date < current_date'
  );

  IF updated_definition = current_definition THEN
    RAISE EXCEPTION 'sponsor_enrollment_summaries effective-status expression was not found';
  END IF;

  EXECUTE updated_definition;

  SELECT pg_get_functiondef('public.sponsor_organisation_summary()'::regprocedure)
  INTO current_definition;

  updated_definition := replace(
    current_definition,
    E'WHEN e.status = ''active'' AND e.cohort_end_date < current_date',
    E'WHEN e.status IN (''active'', ''at_risk'') AND e.cohort_end_date < current_date'
  );

  IF updated_definition = current_definition THEN
    RAISE EXCEPTION 'sponsor_organisation_summary effective-status expression was not found';
  END IF;

  EXECUTE updated_definition;
END
$migration$;
