-- One programme unit = one cohort requirement = one ordinal = one deadline.
--
-- 20260922100000 made the cohort schedule CONVERGE on the programme:
-- sync_cohort_requirement_dates() adds missing units, drops unreferenced
-- surplus, and projects the module deadline onto every row. That is the right
-- writer, but convergence is not an invariant. Three gaps remain:
--
--   Q1  programme_required_units() answers
--         GREATEST(config.required_units, count(cohort_requirement_dates))
--       so a surplus cohort row RAISES the programme quantity for Mentoring
--       eligibility while canonical progress keeps reading the programme.
--       Two numbers for "how many?", disagreeing in exactly the state the
--       schedule issue reporter calls 'surplus_dates'.
--
--   Q2  units is CHECK (units > 0). The writer only ever emits 1, but a
--       direct write can still express a four-unit requirement as one weighted
--       row -- which canonical fulfilment cannot attribute, because it joins
--       activity to a requirement ROW, not to a unit count.
--
--   Q3  nothing rejects a drifted state. Cardinality is cross-row, so no CHECK
--       can hold it; the reporter surfaces drift to an Admin who happens to
--       look, and booking proceeds regardless.
--
-- After this migration the chain is enforced rather than reconciled:
--
--   programme_modules.config.required_units = N   THE quantity, no second source
--   exactly N cohort_requirement_dates rows       units = 1, ordinals 1..N
--   one deadline per requirement                  projected from the module deadline
--
-- ENFORCEMENT BOUNDARY (section 19). Cardinality cannot be a CHECK, and a
-- row-level trigger would reject a valid multi-row regeneration halfway
-- through its own statement. Both guards are therefore DEFERRABLE INITIALLY
-- DEFERRED constraint triggers: they run once, at COMMIT, against the FINAL
-- state, so sync_cohort_requirement_dates() can delete and insert freely
-- inside its transaction and is judged only on what it leaves behind.
--
--   cohort_requirement_dates  -> the (cohort, programme, module) it touched
--   programme_modules         -> every cohort of that programme
--
-- The second is what makes a quantity CHANGE safe: raising 3 -> 4 re-syncs and
-- commits, while lowering 4 -> 3 when requirement 4 carries a session, a group
-- or a participation is refused, because sync cannot drop a referenced row and
-- the surplus it leaves is a violation.
--
-- PENDING vs VIOLATION. A cohort with no completion deadline cannot have
-- requirements materialised, and section 4 forbids inventing a date. That
-- state is therefore PENDING, not a violation: it is allowed to persist and be
-- fixed by an Admin, and it blocks operational use (section 9) rather than
-- blocking the write. Everything else -- wrong count, weighted row, ordinal
-- gap, duplicate, out-of-scope module -- is a violation and is refused.

-- ---------------------------------------------------------------------------
-- 1. Section 16: remediate weighted rows before they become illegal
-- ---------------------------------------------------------------------------
--
-- A weighted group is expanded deterministically, preserving chronology: each
-- row contributes `units` one-unit rows carrying its own due date, in ordinal
-- order, renumbered 1..N.
--
--   June 30 units=2, July 31 units=2  ->  1 Jun30, 2 Jun30, 3 Jul31, 4 Jul31
--
-- No timing information is lost and no date is invented. Expansion replaces
-- rows, so requirement IDENTITY changes -- which is safe only while nothing
-- points at those rows. A weighted group carrying activity has no unambiguous
-- mapping from "unit 3 of a 4-unit row" to a session, so it is reported and
-- the migration stops rather than guessing.

DO $weighted$
DECLARE
  blocked text;
BEGIN
  SELECT string_agg(format('cohort %s / %s (ordinal %s, units %s)',
                           d.cohort_id, d.module, d.ordinal, d.units), '; ')
    INTO blocked
  FROM public.cohort_requirement_dates d
  WHERE d.units > 1
    AND EXISTS (
      SELECT 1 FROM public.cohort_requirement_dates x
      WHERE x.cohort_id = d.cohort_id AND x.programme_id = d.programme_id
        AND x.module = d.module
        AND public.cohort_requirement_is_referenced(x.id));

  IF blocked IS NOT NULL THEN
    RAISE EXCEPTION 'Weighted requirement rows carry activity and cannot be expanded automatically: %', blocked
      USING HINT = 'Map each existing session/group to a specific unit by hand, then re-run.';
  END IF;
END
$weighted$;

WITH weighted AS (
  SELECT DISTINCT d.cohort_id, d.programme_id, d.module
  FROM public.cohort_requirement_dates d
  WHERE d.units > 1
), expanded AS (
  SELECT d.cohort_id, d.programme_id, d.module, d.due_on, d.training_week_id,
    d.generation_method, d.legacy_due_on,
    row_number() OVER (PARTITION BY d.cohort_id, d.programme_id, d.module
                       ORDER BY d.ordinal, d.id, g.i) AS ordinal
  FROM public.cohort_requirement_dates d
  JOIN weighted w
    ON w.cohort_id = d.cohort_id AND w.programme_id = d.programme_id AND w.module = d.module
  CROSS JOIN LATERAL generate_series(1, d.units) AS g(i)
), cleared AS (
  DELETE FROM public.cohort_requirement_dates d
  USING weighted w
  WHERE d.cohort_id = w.cohort_id AND d.programme_id = w.programme_id AND d.module = w.module
  RETURNING 1
)
INSERT INTO public.cohort_requirement_dates (
  cohort_id, programme_id, module, ordinal, due_on, units, training_week_id,
  generation_method, materialized_via, generated_due_on, legacy_due_on
)
SELECT e.cohort_id, e.programme_id, e.module, e.ordinal, e.due_on, 1, e.training_week_id,
  e.generation_method, 'backfill', e.due_on, coalesce(e.legacy_due_on, e.due_on)
FROM expanded e;

-- ---------------------------------------------------------------------------
-- 2. Section 1: a requirement row IS one unit
-- ---------------------------------------------------------------------------
--
-- Applies to every module the table holds. Training is already excluded by the
-- table's own module CHECK, and Peer uses the same one-row-per-requirement
-- attribution as Coaching, Mentoring and Triads, so there is no module for
-- which a weighted row would mean anything.

ALTER TABLE public.cohort_requirement_dates
  DROP CONSTRAINT IF EXISTS cohort_requirement_dates_units_check;

ALTER TABLE public.cohort_requirement_dates
  DROP CONSTRAINT IF EXISTS cohort_requirement_dates_one_unit_per_row;

ALTER TABLE public.cohort_requirement_dates
  ADD CONSTRAINT cohort_requirement_dates_one_unit_per_row CHECK (units = 1);

COMMENT ON COLUMN public.cohort_requirement_dates.units IS
  'Always 1. A requirement ROW is a requirement UNIT: canonical fulfilment '
  'attributes activity to a row, so a weighted row could never be fulfilled '
  'unit by unit. Quantity is the number of rows, and the programme owns it.';

-- ---------------------------------------------------------------------------
-- 3. Section 2: the programme is the only quantity authority
-- ---------------------------------------------------------------------------
--
-- The cohort row count is removed as a floor. It was introduced by
-- 20260921170000 for "a cohort scheduled ad hoc without a programme template",
-- but GREATEST also let a SURPLUS cohort raise the number, which is the cohort
-- deciding quantity -- the one thing it must never do.
--
-- The `required` flag is now read too, matching cohort_required_module_units()
-- and sponsor_canonical_module_schedule() exactly. Before this, an enabled but
-- not-required module with a stale required_units answered a number that
-- canonical progress scored as 0.

CREATE OR REPLACE FUNCTION public.programme_required_units(
  p_enrollment_id uuid,
  p_module public.programme_module_type
)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT CASE
    WHEN coalesce((public.enrollment_module_config(p_enrollment_id, p_module)->>'required')::boolean, false)
    THEN coalesce(public.programme_config_integer(
           public.enrollment_module_config(p_enrollment_id, p_module), 'required_units'), 0)
    ELSE 0
  END;
$$;

COMMENT ON FUNCTION public.programme_required_units(uuid, public.programme_module_type) IS
  'THE quantity authority: programme_modules.config.required_units of a module '
  'the programme marks required. Never the cohort row count, never a '
  'per-person entitlement. Identical to the number canonical progress scores '
  'against, by construction.';

-- ---------------------------------------------------------------------------
-- 4. Section 3: what a valid schedule is
-- ---------------------------------------------------------------------------
--
-- One reader, used by the write-time guards, the operational guard and the
-- diagnostics, so "valid" cannot mean three different things.
--
-- Returns NULL when the (cohort, programme, module) is valid, otherwise a
-- stable machine-readable token. 'missing_deadline' is the PENDING state; the
-- rest are violations.

CREATE OR REPLACE FUNCTION public.cohort_module_schedule_violation(
  p_cohort_id uuid,
  p_programme_id uuid,
  p_module public.programme_module_type
)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  WITH required AS (
    SELECT r.required_units
    FROM public.cohort_required_module_units(p_cohort_id) r
    WHERE r.programme_id = p_programme_id AND r.module = p_module
  ), rows AS (
    SELECT count(*)::integer AS n,
      count(*) FILTER (WHERE d.units <> 1)::integer AS weighted,
      count(DISTINCT d.ordinal)::integer AS distinct_ordinals,
      coalesce(max(d.ordinal), 0)::integer AS max_ordinal
    FROM public.cohort_requirement_dates d
    WHERE d.cohort_id = p_cohort_id AND d.programme_id = p_programme_id AND d.module = p_module
  ), deadline AS (
    SELECT 1 AS present FROM public.cohort_module_deadlines dl
    WHERE dl.cohort_id = p_cohort_id AND dl.programme_id = p_programme_id AND dl.module = p_module
  )
  SELECT CASE
    -- The module is not (or no longer) a required programme module, yet rows
    -- survive. sync_cohort_requirement_dates() removes these unless activity
    -- points at them, so reaching here means activity does.
    WHEN NOT EXISTS (SELECT 1 FROM required) AND (SELECT n FROM rows) > 0
      THEN 'out_of_scope'
    WHEN NOT EXISTS (SELECT 1 FROM required)
      THEN NULL
    WHEN (SELECT weighted FROM rows) > 0
      THEN 'weighted_rows'
    -- No deadline: no requirement can be materialised and no date may be
    -- invented (section 4). Pending, not a violation.
    WHEN NOT EXISTS (SELECT 1 FROM deadline) AND (SELECT n FROM rows) < (SELECT required_units FROM required)
      THEN 'missing_deadline'
    WHEN (SELECT n FROM rows) < (SELECT required_units FROM required)
      THEN 'missing_requirements'
    WHEN (SELECT n FROM rows) > (SELECT required_units FROM required)
      THEN 'surplus_requirements'
    -- n = required_units from here, so contiguous 1..N is exactly
    -- "N distinct ordinals whose maximum is N".
    WHEN (SELECT distinct_ordinals FROM rows) <> (SELECT n FROM rows)
      THEN 'duplicate_ordinals'
    WHEN (SELECT max_ordinal FROM rows) <> (SELECT n FROM rows)
      THEN 'ordinal_gap'
    ELSE NULL
  END;
$$;

COMMENT ON FUNCTION public.cohort_module_schedule_violation(uuid, uuid, public.programme_module_type) IS
  'NULL when the cohort module holds exactly required_units one-unit '
  'requirements with ordinals 1..N. Otherwise a stable token. '
  '''missing_deadline'' is PENDING: allowed to persist, blocks operational use. '
  'Every other token is a violation and is refused at COMMIT.';

REVOKE ALL ON FUNCTION public.cohort_module_schedule_violation(uuid, uuid, public.programme_module_type)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cohort_module_schedule_violation(uuid, uuid, public.programme_module_type)
  TO authenticated;

-- Every violating (cohort, programme, module) in the database. The readiness
-- script and the write-time guards share it.
CREATE OR REPLACE FUNCTION public.cohort_schedule_violations()
RETURNS TABLE (
  cohort_id uuid,
  programme_id uuid,
  module public.programme_module_type,
  required_units integer,
  row_count integer,
  violation text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  WITH in_scope AS (
    SELECT c.id AS cohort_id, r.programme_id, r.module, r.required_units
    FROM public.cohorts c
    CROSS JOIN LATERAL public.cohort_required_module_units(c.id) r
  ), pairs AS (
    SELECT * FROM in_scope
    UNION ALL
    -- Rows whose module is no longer in scope have no entry above, and are the
    -- state an attempted quantity reduction leaves behind. Only those: a
    -- plain UNION would list every in-scope module a second time with a NULL
    -- required_units, and report each violation twice.
    SELECT DISTINCT d.cohort_id, d.programme_id, d.module, NULL::integer
    FROM public.cohort_requirement_dates d
    WHERE NOT EXISTS (
      SELECT 1 FROM in_scope s
      WHERE s.cohort_id = d.cohort_id AND s.programme_id = d.programme_id AND s.module = d.module)
  )
  SELECT p.cohort_id, p.programme_id, p.module, p.required_units,
    (SELECT count(*)::integer FROM public.cohort_requirement_dates d
      WHERE d.cohort_id = p.cohort_id AND d.programme_id = p.programme_id AND d.module = p.module),
    v.violation
  FROM pairs p
  CROSS JOIN LATERAL public.cohort_module_schedule_violation(p.cohort_id, p.programme_id, p.module) AS v(violation)
  WHERE v.violation IS NOT NULL;
$$;

REVOKE ALL ON FUNCTION public.cohort_schedule_violations() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cohort_schedule_violations() TO authenticated;

-- ---------------------------------------------------------------------------
-- 5. Section 19: the write-time guards
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.assert_cohort_module_schedule()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  r record := coalesce(NEW, OLD);
  v text;
BEGIN
  v := public.cohort_module_schedule_violation(r.cohort_id, r.programme_id, r.module);
  -- Pending is not a violation: an Admin still has to supply the deadline.
  IF v IS NULL OR v = 'missing_deadline' THEN
    RETURN NULL;
  END IF;
  RAISE EXCEPTION
    'Requirement schedule invalid (%) for cohort % / %: the programme requires exactly one requirement per unit',
    v, r.cohort_id, r.module
    USING ERRCODE = '23514',
      HINT = 'The programme owns the quantity; edit required_units, not the cohort rows.';
END;
$$;

DROP TRIGGER IF EXISTS cohort_requirement_dates_assert_schedule ON public.cohort_requirement_dates;
CREATE CONSTRAINT TRIGGER cohort_requirement_dates_assert_schedule
  AFTER INSERT OR UPDATE OR DELETE ON public.cohort_requirement_dates
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.assert_cohort_module_schedule();

-- A quantity change is a programme_modules write. Validating every cohort of
-- that programme at COMMIT is what turns "4 -> 3 while requirement 4 holds a
-- session" from silent surplus into a refused edit (section 6).
CREATE OR REPLACE FUNCTION public.assert_programme_module_schedules()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  r record := coalesce(NEW, OLD);
  bad text;
BEGIN
  SELECT string_agg(format('cohort %s: %s', v.cohort_id, v.violation), '; ')
    INTO bad
  FROM public.cohort_schedule_violations() v
  WHERE v.programme_id = r.programme_id AND v.module = r.module
    AND v.violation <> 'missing_deadline';

  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'Programme % quantity change leaves an invalid cohort schedule: %', r.module, bad
      USING ERRCODE = '23514',
        HINT = 'A requirement that already carries a session, group or participation cannot be removed. '
               'Retire the activity first, or keep the programme quantity.';
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS programme_modules_assert_schedules ON public.programme_modules;
CREATE CONSTRAINT TRIGGER programme_modules_assert_schedules
  AFTER INSERT OR UPDATE OR DELETE ON public.programme_modules
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.assert_programme_module_schedules();

-- ---------------------------------------------------------------------------
-- 6. Section 9: an invalid schedule is not operationally usable
-- ---------------------------------------------------------------------------
--
-- Booking against a cohort whose schedule does not match its programme would
-- produce activity with nothing correct to attribute it to. The caller gets a
-- named cause, not a generic refusal.

CREATE OR REPLACE FUNCTION public.enrollment_schedule_violation(
  p_enrollment_id uuid,
  p_module public.programme_module_type
)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT public.cohort_module_schedule_violation(e.cohort_id, e.programme_id, p_module)
  FROM public.programme_enrollments e
  WHERE e.id = p_enrollment_id AND e.cohort_id IS NOT NULL;
$$;

REVOKE ALL ON FUNCTION public.enrollment_schedule_violation(uuid, public.programme_module_type)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.enrollment_schedule_violation(uuid, public.programme_module_type)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.assert_enrollment_schedule_valid(
  p_enrollment_id uuid,
  p_module public.programme_module_type
)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v text := public.enrollment_schedule_violation(p_enrollment_id, p_module);
BEGIN
  IF v IS NOT NULL THEN
    RAISE EXCEPTION 'cohort_schedule_invalid: % requirement schedule is % for this cohort', p_module, v
      USING ERRCODE = '23514',
        HINT = 'Admin must align the cohort requirement schedule with the programme before booking.';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.assert_enrollment_schedule_valid(uuid, public.programme_module_type)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assert_enrollment_schedule_valid(uuid, public.programme_module_type)
  TO authenticated;

-- ---------------------------------------------------------------------------
-- 7. Section 11: Mentoring booking capacity is requirement occupancy
-- ---------------------------------------------------------------------------
--
-- can_book_mentoring_session_reason() counted every live-or-completed session
-- of the enrollment, including pre-cutover rows with no cohort_requirement_id
-- -- the rows mentoring_sessions_without_requirement() exists to report as
-- fulfilling nothing. Two such sessions could exhaust a two-requirement
-- programme while canonical progress still read 0 completed.
--
-- This is the same correction 20260921140000 made for Coaching (finding C11).
-- The schedule guard is applied here too, so the pre-check and the booking RPC
-- refuse for the same named reason.

CREATE OR REPLACE FUNCTION public.can_book_mentoring_session_reason(
  p_mentee_id uuid, p_mentor_id uuid, p_enrollment_id uuid
)
RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  e public.programme_enrollments;
  cfg jsonb;
  required_units integer;
  used_count integer;
  mentor_enrollment uuid;
  given_limit integer;
  given_used integer;
  schedule_violation text;
BEGIN
  IF p_mentee_id IS DISTINCT FROM auth.uid()
     AND NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RETURN 'forbidden';
  END IF;

  SELECT * INTO e FROM public.programme_enrollments
  WHERE id = p_enrollment_id AND user_id = p_mentee_id;
  IF NOT FOUND
     OR e.status NOT IN ('active'::public.enrollment_status, 'at_risk'::public.enrollment_status) THEN
    RETURN 'inactive';
  END IF;

  cfg := public.enrollment_module_config(p_enrollment_id, 'mentoring'::public.programme_module_type);
  IF cfg IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.programme_modules pm
    WHERE pm.programme_id = e.programme_id AND pm.module = 'mentoring' AND pm.enabled
  ) THEN
    RETURN 'module_access';
  END IF;

  IF e.cohort_id IS NULL THEN
    RETURN 'no_cohort';
  END IF;

  -- Section 9: never book into a cohort whose schedule does not match its
  -- programme -- the session would have no correct requirement to hold.
  schedule_violation := public.enrollment_schedule_violation(
    p_enrollment_id, 'mentoring'::public.programme_module_type);
  IF schedule_violation IS NOT NULL THEN
    RETURN 'cohort_schedule_invalid';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.cohort_mentoring_mentor_pool(e.cohort_id) p
    WHERE p.mentor_user_id = p_mentor_id
  ) THEN
    RETURN 'not_in_cohort_pool';
  END IF;

  required_units := public.programme_required_units(
    p_enrollment_id, 'mentoring'::public.programme_module_type);
  IF required_units = 0 THEN
    RETURN 'no_mentoring_requirement';
  END IF;

  -- Only a session that actually HOLDS a requirement consumes one. An
  -- unattributed historical session stays visible in history and fulfils
  -- nothing, so it must not spend the allowance either.
  SELECT count(*)::integer INTO used_count
  FROM public.mentoring_sessions s
  WHERE s.enrollment_id = p_enrollment_id
    AND s.cohort_requirement_id IS NOT NULL
    AND s.status IN ('pending_coach_approval', 'confirmed', 'completed');

  IF used_count >= required_units THEN
    RETURN 'received_limit_reached';
  END IF;

  SELECT id INTO mentor_enrollment FROM public.programme_enrollments
  WHERE user_id = p_mentor_id
    AND status IN ('active'::public.enrollment_status, 'at_risk'::public.enrollment_status)
  LIMIT 1;
  IF mentor_enrollment IS NOT NULL THEN
    given_limit := public.programme_config_integer(
      public.enrollment_module_config(mentor_enrollment, 'mentoring'::public.programme_module_type),
      'give_limit');
  END IF;
  IF mentor_enrollment IS NULL OR given_limit IS NULL THEN
    given_limit := public.get_mentoring_given_limit(p_mentor_id);
  END IF;
  SELECT count(*)::integer INTO given_used FROM public.mentoring_sessions
  WHERE mentor_id = p_mentor_id
    AND status IN ('pending_coach_approval', 'confirmed', 'completed');
  IF given_limit IS NOT NULL AND given_used >= given_limit THEN
    RETURN 'given_limit_reached';
  END IF;

  RETURN 'ok';
END;
$function$;

-- ---------------------------------------------------------------------------
-- 8. Section 9 (continued): Coaching eligibility reads the same authority
-- ---------------------------------------------------------------------------
--
-- can_book_session()'s programme branch counted cohort_requirement_dates rows
-- for its budget -- a third answer to "how many?". It now asks the programme,
-- through the same function Mentoring uses, and refuses outright on an invalid
-- schedule instead of silently falling through to the legacy allowlist path.

CREATE OR REPLACE FUNCTION public.can_book_session(
  p_coachee_id uuid,
  p_coach_id uuid,
  p_enrollment_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  e public.programme_enrollments;
  cfg jsonb;
  receive_limit integer;
  legacy_limit integer;
  used_count integer;
  required_units integer;
  is_programme_coaching boolean;
BEGIN
  IF p_coachee_id IS DISTINCT FROM auth.uid()
     AND NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RETURN false;
  END IF;

  SELECT * INTO e FROM public.programme_enrollments
  WHERE id = p_enrollment_id AND user_id = p_coachee_id;
  IF NOT FOUND
     OR e.status NOT IN ('active'::public.enrollment_status, 'at_risk'::public.enrollment_status) THEN
    RETURN false;
  END IF;

  cfg := public.enrollment_module_config(p_enrollment_id, 'coaching'::public.programme_module_type);
  IF cfg IS NULL OR (cfg->>'enabled') = 'false' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.programme_modules pm
      WHERE pm.programme_id = e.programme_id AND pm.module = 'coaching' AND pm.enabled
    ) THEN
      RETURN false;
    END IF;
  END IF;

  -- Programme Coaching is decided by the PROGRAMME, not by whether the cohort
  -- happens to hold rows. Before this, a cohort whose schedule had not been
  -- materialised read as "not programme coaching" and quietly took the legacy
  -- allowlist path, booking sessions that fulfil no requirement.
  required_units := public.programme_required_units(
    p_enrollment_id, 'coaching'::public.programme_module_type);
  is_programme_coaching := e.cohort_id IS NOT NULL AND required_units > 0;

  IF is_programme_coaching THEN
    IF public.enrollment_schedule_violation(
         p_enrollment_id, 'coaching'::public.programme_module_type) IS NOT NULL THEN
      RETURN false;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.cohort_coaching_coach_pool(e.cohort_id) p
      WHERE p.coach_id = p_coach_id
    ) THEN
      RETURN false;
    END IF;

    -- Only sessions that actually hold a requirement count against the budget.
    SELECT count(*)::integer INTO used_count
    FROM public.sessions s
    WHERE s.enrollment_id = p_enrollment_id
      AND s.cohort_requirement_id IS NOT NULL
      AND s.status IN ('pending_coach_approval', 'confirmed', 'completed');

    RETURN used_count < required_units;
  END IF;

  -- ---- Legacy path, unchanged: NOT programme Coaching (section 13). ----
  -- Reached only when the programme requires no Coaching units at all, so
  -- receive_limit and the raw session count cannot enter a programme
  -- calculation from here.
  IF public.has_role(p_coachee_id, 'coach'::public.app_role) THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.coach_as_coachee_allowlist a
      WHERE a.coach_user_id = p_coachee_id AND a.selectable_coach_id = p_coach_id
    ) THEN
      RETURN false;
    END IF;
  ELSE
    IF NOT EXISTS (
      SELECT 1 FROM public.coachee_coach_allowlist a
      WHERE a.coachee_id = p_coachee_id AND a.coach_id = p_coach_id AND a.removed_at IS NULL
    ) THEN
      RETURN false;
    END IF;
  END IF;

  receive_limit := public.programme_config_integer(cfg, 'receive_limit');
  SELECT coachee_session_limit INTO legacy_limit FROM public.programmes WHERE id = e.programme_id;
  receive_limit := COALESCE(receive_limit, legacy_limit);

  SELECT count(*)::integer INTO used_count FROM public.sessions
  WHERE enrollment_id = p_enrollment_id AND coachee_id = p_coachee_id
    AND status IN ('pending_coach_approval', 'confirmed', 'completed');

  RETURN receive_limit IS NULL OR used_count < receive_limit;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 9. Section 7: the Admin save validates the FINAL state
-- ---------------------------------------------------------------------------
--
-- The deferred trigger already refuses an invalid commit, but it fires after
-- the RPC returns success to PostgREST. Asserting inside the function turns
-- that into an error the Admin screen can attribute to the save it just made.

CREATE OR REPLACE FUNCTION public.admin_assert_cohort_schedule(p_cohort_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  bad text;
BEGIN
  SELECT string_agg(format('%s: %s', v.module, v.violation), '; ')
    INTO bad
  FROM public.cohort_schedule_violations() v
  WHERE v.cohort_id = p_cohort_id AND v.violation <> 'missing_deadline';
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'cohort_schedule_invalid: %', bad
      USING ERRCODE = '23514',
        HINT = 'Each required module needs exactly required_units one-unit requirements.';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_assert_cohort_schedule(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_assert_cohort_schedule(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_set_cohort_module_deadlines(p_cohort_id uuid, p_items jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  c public.cohorts;
  saved integer := 0;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Only admins can set cohort requirement deadlines' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO c FROM public.cohorts WHERE id = p_cohort_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cohort not found' USING ERRCODE = 'P0002';
  END IF;
  IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Requirement deadlines must be a JSON array' USING ERRCODE = '22023';
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS pg_temp.cmd_items (
    programme_id uuid, module public.programme_module_type, completion_deadline date
  ) ON COMMIT DROP;
  TRUNCATE pg_temp.cmd_items;

  INSERT INTO pg_temp.cmd_items
  SELECT (x->>'programme_id')::uuid,
    (x->>'module')::public.programme_module_type,
    NULLIF(x->>'completion_deadline', '')::date
  FROM jsonb_array_elements(p_items) x;

  IF EXISTS (SELECT 1 FROM pg_temp.cmd_items i
             WHERE i.programme_id IS NULL OR i.module IS NULL OR i.completion_deadline IS NULL) THEN
    RAISE EXCEPTION 'Every module needs a programme and a completion deadline' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_temp.cmd_items i GROUP BY i.programme_id, i.module HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'A module can have only one completion deadline' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_temp.cmd_items i
    WHERE NOT EXISTS (
      SELECT 1 FROM public.cohort_required_module_units(p_cohort_id) r
      WHERE r.programme_id = i.programme_id AND r.module = i.module
    )
  ) THEN
    RAISE EXCEPTION 'Deadlines must match the cohort''s required programme modules' USING ERRCODE = '22023';
  END IF;
  IF c.start_date IS NOT NULL AND c.end_date IS NOT NULL AND EXISTS (
    SELECT 1 FROM pg_temp.cmd_items i
    WHERE i.completion_deadline < c.start_date OR i.completion_deadline > c.end_date
  ) THEN
    RAISE EXCEPTION 'Completion deadlines must fall within the cohort dates (% - %)', c.start_date, c.end_date
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.cohort_module_deadlines (
    cohort_id, programme_id, module, completion_deadline, source, updated_by
  )
  SELECT p_cohort_id, i.programme_id, i.module, i.completion_deadline, 'admin', auth.uid()
  FROM pg_temp.cmd_items i
  ON CONFLICT (cohort_id, programme_id, module) DO UPDATE
    SET completion_deadline = EXCLUDED.completion_deadline,
        source = 'admin',
        updated_by = EXCLUDED.updated_by;
  GET DIAGNOSTICS saved = ROW_COUNT;

  -- The deadline trigger has already re-synced each affected module; this is
  -- the belt-and-braces pass for a cohort whose modules changed shape too.
  PERFORM public.sync_cohort_requirement_dates(p_cohort_id);
  -- Section 7: the save is judged on the state it leaves, not on the rows it
  -- was handed.
  PERFORM public.admin_assert_cohort_schedule(p_cohort_id);
  RETURN saved;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 10. Section 20: the schedule reporter describes a migration state
-- ---------------------------------------------------------------------------

COMMENT ON FUNCTION public.cohort_requirement_schedule_issues(uuid) IS
  'DIAGNOSTIC ONLY. A mismatch between programme required_units and the cohort '
  'requirement rows is an integrity violation or a migration state, never a '
  'supported operational state: the deferred constraint triggers refuse to '
  'commit one, and the booking RPCs refuse to operate against one. This '
  'function exists for readiness checks and corruption detection.';

-- ---------------------------------------------------------------------------
-- 11. Verification
-- ---------------------------------------------------------------------------

DO $verify$
DECLARE
  bad text;
  n integer;
BEGIN
  -- No weighted rows survive.
  SELECT count(*) INTO n FROM public.cohort_requirement_dates WHERE units <> 1;
  IF n > 0 THEN
    RAISE EXCEPTION 'Quantity invariant: % weighted requirement rows remain', n;
  END IF;

  -- Quantity has exactly one source.
  IF pg_get_functiondef('public.programme_required_units(uuid,public.programme_module_type)'::regprocedure)
       ~* 'GREATEST|cohort_requirement_dates' THEN
    RAISE EXCEPTION 'Quantity invariant: programme_required_units still reads the cohort';
  END IF;
  IF regexp_replace(
       pg_get_functiondef('public.can_book_session(uuid,uuid,uuid)'::regprocedure),
       '--[^\n]*', '', 'g') ~* 'count\(\*\)[^;]*cohort_requirement_dates' THEN
    RAISE EXCEPTION 'Quantity invariant: can_book_session still counts cohort requirement rows';
  END IF;

  -- Mentoring capacity is requirement occupancy.
  IF regexp_replace(
       pg_get_functiondef('public.can_book_mentoring_session_reason(uuid,uuid,uuid)'::regprocedure),
       '--[^\n]*', '', 'g') !~ 'cohort_requirement_id IS NOT NULL' THEN
    RAISE EXCEPTION 'Quantity invariant: Mentoring booking still counts unattributed sessions';
  END IF;

  -- Both deferred guards are attached and deferrable.
  SELECT string_agg(t.tgname, ', ') INTO bad
  FROM pg_trigger t
  WHERE t.tgname IN ('cohort_requirement_dates_assert_schedule', 'programme_modules_assert_schedules')
    AND NOT t.tgdeferrable;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'Quantity invariant: % is not deferrable and would reject valid regeneration', bad;
  END IF;
  SELECT count(*) INTO n FROM pg_trigger t
  WHERE t.tgname IN ('cohort_requirement_dates_assert_schedule', 'programme_modules_assert_schedules');
  IF n <> 2 THEN
    RAISE EXCEPTION 'Quantity invariant: expected 2 schedule guards, found %', n;
  END IF;

  -- Nothing in the database is currently in a refusable state.
  SELECT string_agg(format('%s/%s: %s', v.cohort_id, v.module, v.violation), '; ')
    INTO bad
  FROM public.cohort_schedule_violations() v
  WHERE v.violation <> 'missing_deadline';
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'Quantity invariant: existing cohort schedules violate it: %', bad
      USING HINT = 'Run scripts/programme-quantity-readiness.sql and resolve before deploying.';
  END IF;
END
$verify$;
