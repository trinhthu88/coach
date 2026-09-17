-- Sponsor calendar truth remediation.
--
-- Sponsor progress and journey dates belong to the Cohort calendar. Programme
-- configuration still defines which modules and training weeks apply, while
-- cohort_week_overrides may adjust a selected training week for one Cohort.
-- Programme-level training-week unlock dates and enrollment dates must not move
-- Sponsor checkpoints for a learner who joins the Cohort later.

DO $migration$
DECLARE
  current_definition text;
  updated_definition text;
BEGIN
  SELECT pg_get_functiondef(
    'public.sponsor_canonical_module_schedule(uuid)'::regprocedure
  )
  INTO current_definition;

  updated_definition := regexp_replace(
    current_definition,
    $$coalesce\(\s*cwo\.unlock_date,\s*coalesce\(tw\.unlock_date,\s*\(cm\.cohort_start_date \+ \(\(tw\.week_number - 1\) \* interval '7 days'\)\)::date\)\s*\)$$,
    $$coalesce(cwo.unlock_date, (cm.cohort_start_date + ((tw.week_number - 1) * interval '7 days'))::date)$$,
    1
  );

  IF updated_definition = current_definition THEN
    RAISE EXCEPTION
      'Expected Sponsor canonical training-linked calendar expression was not found';
  END IF;

  EXECUTE updated_definition;
END
$migration$;

DO $migration$
DECLARE
  current_definition text;
  updated_definition text;
BEGIN
  SELECT pg_get_functiondef(
    'public.sponsor_canonical_leader_experience(uuid,date)'::regprocedure
  )
  INTO current_definition;

  updated_definition := regexp_replace(
    current_definition,
    $$coalesce\(\s*cwo\.unlock_date,\s*CASE WHEN e\.cohort_id IS NOT NULL\s*THEN \(e\.programme_start_date \+ \(\(tw\.week_number - 1\) \* interval '7 days'\)\)::date\s*ELSE NULL\s*END,\s*tw\.unlock_date\s*\)$$,
    $$coalesce(cwo.unlock_date, (e.programme_start_date + ((tw.week_number - 1) * interval '7 days'))::date)$$,
    1
  );

  IF updated_definition = current_definition THEN
    RAISE EXCEPTION
      'Expected Leader Experience learning-week calendar expression was not found';
  END IF;

  EXECUTE updated_definition;
END
$migration$;