-- P2-10: purge retired keys from the programme module authoring config.
--
-- distribution_mode (and the older per-module 'weeks') were retired when
-- quantity moved to programme_modules.config.required_units and dates to
-- cohort_module_deadlines. Older programmes may still carry the keys in
-- programme_modules.config, which is why the Admin editor used to name them
-- only to delete them on save. They are removed from the stored configs here,
-- so no client code needs to know they ever existed.
--
-- get_enrollment_programme_modules() keeps its read-side "- 'distribution_mode'":
-- enrollment_module_config() can return a HISTORICAL enrollment snapshot,
-- which is archive data and is not rewritten.
UPDATE public.programme_modules
   SET config = config - 'distribution_mode' - 'weeks'
 WHERE config ? 'distribution_mode' OR config ? 'weeks';
