-- Keep a real zero required-unit aggregate visible as zero.  Cohort summaries
-- use zero for an eligible cohort with no required units; the organization
-- summary must not turn that same value into NULL.
DO $migration$
DECLARE
  current_definition text;
  updated_definition text;
BEGIN
  SELECT pg_get_functiondef(
    'public.sponsor_organisation_summary_legacy()'::regprocedure
  )
  INTO current_definition;

  updated_definition := replace(
    current_definition,
    'CASE WHEN NOT v.is_visible OR v.required_units=0 THEN NULL ELSE v.required_units END',
    'CASE WHEN NOT v.is_visible THEN NULL ELSE v.required_units END'
  );

  IF updated_definition = current_definition THEN
    RAISE EXCEPTION
      'sponsor_organisation_summary_legacy required-unit expression was not found';
  END IF;

  EXECUTE updated_definition;
END
$migration$;