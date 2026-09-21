-- P0-2: freeze the deadline contract.
--
-- ARCHITECTURE DECISION (locked): One completion_deadline per cohort×module.
-- All N requirement ordinals under that module share this deadline.
-- If per-ordinal deadlines are ever needed, this is where to change.
--
-- "Where" = sync_cohort_requirement_dates() (20260922100000), step 5d:
--   UPDATE cohort_requirement_dates SET due_on = cohort_module_deadlines.completion_deadline
-- which projects the ONE cohort×module deadline onto every ordinal, and
-- admin_set_cohort_module_deadlines(), which accepts exactly one
-- completion_deadline per (programme, module) of a cohort. Each
-- cohort_requirement_dates row still carries its own due_on column, but it is
-- a projection of the module deadline, never an independent date.
--
-- Scope: the session modules (Coaching, Mentoring, Peer Coaching, Triads).
-- Training is not materialised here (cohort_required_module_units excludes
-- it); it is paced week by week from training weeks / cohort_week_overrides.
--
-- This migration changes no behaviour: it records the decision on the
-- objects themselves so it is visible in the schema, not only in docs.

COMMENT ON TABLE public.cohort_module_deadlines IS
  'ARCHITECTURE DECISION (locked): one completion_deadline per cohort x module. All N requirement ordinals of that '
  'module (cohort_requirement_dates) share it. Training is paced separately (training weeks). If per-ordinal '
  'deadlines are ever needed, change sync_cohort_requirement_dates() step 5d.';

COMMENT ON FUNCTION public.sync_cohort_requirement_dates(uuid) IS
  'Materialises exactly N cohort_requirement_dates (units = 1, ordinals 1..N) per required session module and '
  'projects the cohort x module completion_deadline onto every ordinal (step 5d). ARCHITECTURE DECISION (locked): '
  'one completion_deadline per cohort x module; all N ordinals share it. If per-ordinal deadlines are ever needed, '
  'this is where to change.';

COMMENT ON FUNCTION public.admin_set_cohort_module_deadlines(uuid, jsonb) IS
  'Admin writer of the ONE completion_deadline per cohort x module (a module may not appear twice). Every requirement '
  'ordinal of that module takes this date via sync_cohort_requirement_dates(). Locked contract: no per-ordinal deadlines.';
