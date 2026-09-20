-- Keep each journey point chronological without changing the canonical
-- activity source or the Admin-configured checkpoint structure.

DO $migration$
DECLARE
  current_definition text;
  updated_definition text;
BEGIN
  SELECT pg_get_functiondef(
    'public.sponsor_canonical_programme_journey(uuid, date)'::regprocedure
  )
  INTO current_definition;

  updated_definition := replace(
    current_definition,
    E'AND a.occurred_on <= p_as_of',
    E'AND a.occurred_on <= LEAST(p_as_of, sm.due_on)'
  );

  IF updated_definition = current_definition THEN
    RAISE EXCEPTION 'Expected journey checkpoint date predicate was not found';
  END IF;

  EXECUTE updated_definition;
END
$migration$;