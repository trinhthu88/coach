-- Keep the programme start as a neutral baseline for Evenly schedules.
-- The final milestone remains on the configured enrollment end date, while
-- earlier milestones are strictly after the start date whenever the schedule
-- has at least one day to distribute.

DO $migration$
DECLARE
  current_definition text;
  updated_definition text;
BEGIN
  SELECT pg_get_functiondef(
    'public.generate_enrollment_schedule(uuid)'::regprocedure
  )
  INTO current_definition;

  updated_definition := replace(
    current_definition,
    E'due := e.start_date + ((e.end_date - e.start_date) * n / unit_count);',
    E'due := e.start_date + CASE\n'
      || E'  WHEN n = unit_count THEN e.end_date - e.start_date\n'
      || E'  WHEN e.end_date > e.start_date THEN greatest(\n'
      || E'    1,\n'
      || E'    ((e.end_date - e.start_date) * n / unit_count)\n'
      || E'  )\n'
      || E'  ELSE 0\n'
      || E'END;'
  );

  IF updated_definition = current_definition THEN
    RAISE EXCEPTION 'Expected Evenly schedule expression was not found';
  END IF;

  EXECUTE updated_definition;
END
$migration$;