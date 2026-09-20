-- One cohort-module completion deadline replaces the programme distribution modes.
--
-- Until now a programme module carried a scheduling POLICY
-- (config.distribution_mode: evenly_distributed / monthly_frequency /
-- training_linked / custom / flexible) and the cohort schedule generator
-- re-implemented all five. That produced two problems:
--
--   1. 'flexible' materialised ONE cohort_requirement_dates row no matter how
--      many units the programme required. Since completion became
--      requirement-attributed (Coaching, Mentoring, Peer, Triads), such a
--      cohort could never record more than one completed unit.
--   2. Every consumer had to know which policy produced its dates, which is
--      exactly the "if flexible -> count sessions, else count requirements"
--      branch the source-of-truth contract forbids.
--
-- The model becomes, for every module that has canonical requirements:
--
--   PROGRAMME   module exists + required_units = N        (WHAT and HOW MANY)
--   COHORT      completion_deadline for that module       (BY WHEN)
--   SYSTEM      exactly N canonical requirement rows      (materialised)
--   ACTIVITY    fulfils one canonical requirement         (WHAT HAPPENED)
--
-- All N rows of a cohort-module carry the same due_on: the deadline. Requirement
-- IDENTITY is preserved -- R1..RN stay separately attributable, which is what
-- next_*_requirement(), the enrollment-first unique indexes and historical
-- attribution depend on. Sequence comes from `ordinal`, never from the dates.
--
-- Progress semantics fall out of the existing p_as_of convention in
-- canonical_module_progress unchanged (due_units counts requirements whose
-- due_on <= p_as_of):
--
--   before the deadline   required = N, completed = fulfilled, due = 0, overdue = 0
--   on/after the deadline required = N, completed = fulfilled, due = N,
--                         overdue = N - completed
--
-- Training / Learning is deliberately NOT in this table (the CHECK excludes it).
-- Its dates come from training_weeks.unlock_date + cohort_week_overrides via
-- canonical_training_learning_items -- already a cohort-owned source, and
-- already free of any distribution_mode branch. config.distribution_settings
-- keeps training_week_ids as Training's CONTENT SCOPE (which weeks the module
-- covers); that is not a scheduling policy and nothing branches on it.
--
-- NOTE ON INTERIM PACING. A cohort previously scheduled 'evenly_distributed'
-- had interim dates (unit 1 due in month 1, unit 2 in month 2, ...). Under one
-- deadline per module nothing is due until the deadline, so in-flight cohorts
-- will show FEWER overdue units than before. That is the intended simplification,
-- not a defect. The superseded per-unit dates are preserved in
-- cohort_requirement_dates.legacy_due_on and reported by
-- cohort_requirement_legacy_spread(); nothing is silently destroyed.

-- ---------------------------------------------------------------------------
-- 1. The cohort-module deadline: the single authority for WHEN
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.cohort_module_deadlines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cohort_id uuid NOT NULL REFERENCES public.cohorts(id) ON DELETE CASCADE,
  programme_id uuid NOT NULL REFERENCES public.programmes(id) ON DELETE CASCADE,
  module public.programme_module_type NOT NULL
    CHECK (module <> 'training'::public.programme_module_type),
  completion_deadline date NOT NULL,
  -- How this deadline was decided. 'cohort_end' is the default the system
  -- applies when a module becomes required and nobody has chosen a date;
  -- 'legacy_schedule' is the migrated last date of the old per-unit schedule.
  source text NOT NULL DEFAULT 'admin'
    CHECK (source IN ('cohort_end', 'legacy_schedule', 'admin')),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cohort_id, programme_id, module)
);

COMMENT ON TABLE public.cohort_module_deadlines IS
  'Canonical cohort-module completion deadline: the cohort answers BY WHEN. '
  'Every cohort_requirement_dates row of that cohort-module projects this date; '
  'it is never edited unit by unit. Deadlines are module-specific -- one cohort '
  'may finish Coaching in December and Peer in November.';

CREATE INDEX IF NOT EXISTS cohort_module_deadlines_cohort_idx
  ON public.cohort_module_deadlines (cohort_id, programme_id, module);

ALTER TABLE public.cohort_module_deadlines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Cohort module deadlines: admin manage" ON public.cohort_module_deadlines;
CREATE POLICY "Cohort module deadlines: admin manage"
  ON public.cohort_module_deadlines
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

REVOKE ALL ON public.cohort_module_deadlines FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cohort_module_deadlines TO authenticated;

DROP TRIGGER IF EXISTS trg_cohort_module_deadlines_updated ON public.cohort_module_deadlines;
CREATE TRIGGER trg_cohort_module_deadlines_updated
  BEFORE UPDATE ON public.cohort_module_deadlines
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. Preserve the legacy per-unit dates before anything is rewritten
-- ---------------------------------------------------------------------------
ALTER TABLE public.cohort_requirement_dates
  ADD COLUMN IF NOT EXISTS legacy_due_on date;

COMMENT ON COLUMN public.cohort_requirement_dates.legacy_due_on IS
  'The per-unit due date this requirement carried under the distribution-mode '
  'schedule, captured once on 2026-09-22. NULL for every requirement created '
  'after the cutover. Read only by cohort_requirement_legacy_spread().';

UPDATE public.cohort_requirement_dates SET legacy_due_on = due_on WHERE legacy_due_on IS NULL;

-- ---------------------------------------------------------------------------
-- 3. Backfill the deadlines
-- ---------------------------------------------------------------------------
-- A cohort-module that already has a schedule keeps its LAST date as the
-- completion deadline: that is the date by which the module had to be finished,
-- so no cohort becomes retroactively more overdue than it already was.
INSERT INTO public.cohort_module_deadlines (cohort_id, programme_id, module, completion_deadline, source)
SELECT d.cohort_id, d.programme_id, d.module, max(d.due_on), 'legacy_schedule'
FROM public.cohort_requirement_dates d
GROUP BY d.cohort_id, d.programme_id, d.module
ON CONFLICT (cohort_id, programme_id, module) DO NOTHING;

-- A required module with no schedule at all defaults to the cohort end date.
-- A cohort with no end date gets NOTHING: a deadline is never fabricated, and
-- cohort_requirement_schedule_issues reports the gap.
INSERT INTO public.cohort_module_deadlines (cohort_id, programme_id, module, completion_deadline, source)
SELECT c.id, sp.programme_id, pm.module, c.end_date, 'cohort_end'
FROM public.cohorts c
CROSS JOIN LATERAL public.cohort_scheduled_programmes(c.id) sp
JOIN public.programme_modules pm
  ON pm.programme_id = sp.programme_id
 AND pm.enabled
 AND pm.module <> 'training'::public.programme_module_type
 AND coalesce((pm.config->>'required')::boolean, false)
 AND coalesce(public.programme_config_integer(pm.config, 'required_units'), 0) > 0
WHERE c.end_date IS NOT NULL
ON CONFLICT (cohort_id, programme_id, module) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 4. Normalise the existing requirement rows onto the one-unit-per-row model
-- ---------------------------------------------------------------------------
-- A 'custom' milestone could carry several units in one row. Each required unit
-- now needs its own identity, so such a row is expanded. The ORIGINAL row keeps
-- its id -- sessions, mentoring sessions, peer participants and triad groups
-- already point at it.
ALTER TABLE public.cohort_requirement_dates DROP CONSTRAINT IF EXISTS cohort_requirement_dates_triad_single_unit;

-- Move every ordinal out of the way so the expansion cannot collide with the
-- (cohort, programme, module, ordinal) unique key.
UPDATE public.cohort_requirement_dates SET ordinal = ordinal + 1000000;

INSERT INTO public.cohort_requirement_dates (
  cohort_id, programme_id, module, ordinal, due_on, units, training_week_id,
  generation_method, materialized_via, generated_due_on, is_overridden, legacy_due_on
)
SELECT d.cohort_id, d.programme_id, d.module, d.ordinal + extra.i, d.due_on, 1, d.training_week_id,
  d.generation_method, d.materialized_via, d.generated_due_on, d.is_overridden, d.legacy_due_on
FROM public.cohort_requirement_dates d
CROSS JOIN LATERAL generate_series(1, d.units - 1) AS extra(i)
WHERE d.units > 1;

UPDATE public.cohort_requirement_dates SET units = 1 WHERE units <> 1;

-- Renumber 1..N per cohort-module, preserving the historical order (the legacy
-- date first, then the old ordinal) so unit numbers already shown to learners
-- keep their meaning.
WITH renumbered AS (
  SELECT d.id,
    row_number() OVER (
      PARTITION BY d.cohort_id, d.programme_id, d.module
      ORDER BY d.legacy_due_on, d.ordinal, d.id
    )::integer AS new_ordinal
  FROM public.cohort_requirement_dates d
)
UPDATE public.cohort_requirement_dates d
SET ordinal = r.new_ordinal
FROM renumbered r
WHERE d.id = r.id;

ALTER TABLE public.cohort_requirement_dates
  ADD CONSTRAINT cohort_requirement_dates_single_unit CHECK (units = 1);

COMMENT ON COLUMN public.cohort_requirement_dates.units IS
  'Always 1: one row is one required unit. Retained so existing readers that '
  'sum units keep working.';

-- The old generation_method / materialized_via values are retired below, once
-- every row has been moved onto the deadline.
ALTER TABLE public.cohort_requirement_dates DROP CONSTRAINT IF EXISTS cohort_requirement_dates_generation_method_check;
ALTER TABLE public.cohort_requirement_dates DROP CONSTRAINT IF EXISTS cohort_requirement_dates_materialized_via_check;

-- Point every existing row at its cohort-module deadline.
UPDATE public.cohort_requirement_dates d
SET due_on = dl.completion_deadline,
    generated_due_on = dl.completion_deadline,
    is_overridden = false,
    generation_method = 'module_deadline',
    materialized_via = 'backfill'
FROM public.cohort_module_deadlines dl
WHERE dl.cohort_id = d.cohort_id
  AND dl.programme_id = d.programme_id
  AND dl.module = d.module;

-- Any row whose cohort-module has no deadline (cohort without an end date)
-- cannot be normalised; it keeps its legacy date and is reported as an issue.
UPDATE public.cohort_requirement_dates d
SET generation_method = 'manual', materialized_via = 'backfill'
WHERE NOT EXISTS (
  SELECT 1 FROM public.cohort_module_deadlines dl
  WHERE dl.cohort_id = d.cohort_id AND dl.programme_id = d.programme_id AND dl.module = d.module
);

ALTER TABLE public.cohort_requirement_dates
  ADD CONSTRAINT cohort_requirement_dates_generation_method_check
  CHECK (generation_method IN ('module_deadline', 'manual'));
ALTER TABLE public.cohort_requirement_dates
  ADD CONSTRAINT cohort_requirement_dates_materialized_via_check
  CHECK (materialized_via IN ('backfill', 'deadline_sync', 'admin_save'));

COMMENT ON TABLE public.cohort_requirement_dates IS
  'Canonical cohort requirements: exactly one row per required unit, all due on '
  'the cohort-module completion deadline (cohort_module_deadlines). Requirement '
  'identity (ordinal) carries the sequence; the dates do not. Materialised by '
  'sync_cohort_requirement_dates -- never hand-built.';

-- ---------------------------------------------------------------------------
-- 5. The generator: exactly required_units rows, all on the deadline
-- ---------------------------------------------------------------------------
-- A requirement that any activity already points at is HISTORY and is never
-- deleted, even if the programme later requires fewer units.
CREATE OR REPLACE FUNCTION public.cohort_requirement_is_referenced(p_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (SELECT 1 FROM public.sessions s WHERE s.cohort_requirement_id = p_id)
      OR EXISTS (SELECT 1 FROM public.mentoring_sessions m WHERE m.cohort_requirement_id = p_id)
      OR EXISTS (SELECT 1 FROM public.peer_session_participants pp WHERE pp.cohort_requirement_id = p_id)
      OR EXISTS (SELECT 1 FROM public.triad_groups g WHERE g.cohort_requirement_date_id = p_id);
$$;

REVOKE ALL ON FUNCTION public.cohort_requirement_is_referenced(uuid) FROM PUBLIC, anon, authenticated;

-- The modules a cohort must schedule, with how many units each needs.
CREATE OR REPLACE FUNCTION public.cohort_required_module_units(p_cohort_id uuid)
RETURNS TABLE (programme_id uuid, module public.programme_module_type, required_units integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT sp.programme_id, pm.module,
    coalesce(public.programme_config_integer(pm.config, 'required_units'), 0)::integer
  FROM public.cohort_scheduled_programmes(p_cohort_id) sp
  JOIN public.programme_modules pm
    ON pm.programme_id = sp.programme_id
   AND pm.enabled
   AND pm.module <> 'training'::public.programme_module_type
   AND coalesce((pm.config->>'required')::boolean, false)
  WHERE coalesce(public.programme_config_integer(pm.config, 'required_units'), 0) > 0;
$$;

REVOKE ALL ON FUNCTION public.cohort_required_module_units(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_cohort_requirement_dates(p_cohort_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_end date;
  v_changed integer := 0;
  n integer;
BEGIN
  -- Re-entry guard: this function writes cohort_module_deadlines, whose own
  -- trigger calls it back. Transaction-local, and cleared before returning so
  -- that syncing several cohorts in one statement still works.
  IF coalesce(current_setting('app.crd_sync', true), '') = 'on' THEN
    RETURN 0;
  END IF;
  PERFORM set_config('app.crd_sync', 'on', true);

  SELECT c.end_date INTO v_end FROM public.cohorts c WHERE c.id = p_cohort_id;

  -- 5a. A module that has just become required gets the cohort end date as its
  --     default deadline. No end date means no default: a deadline is never
  --     invented, and the module is reported as unscheduled instead.
  IF v_end IS NOT NULL THEN
    INSERT INTO public.cohort_module_deadlines (cohort_id, programme_id, module, completion_deadline, source)
    SELECT p_cohort_id, r.programme_id, r.module, v_end, 'cohort_end'
    FROM public.cohort_required_module_units(p_cohort_id) r
    ON CONFLICT (cohort_id, programme_id, module) DO NOTHING;
  END IF;

  -- 5b. Add the missing units. New ordinals continue after the highest existing
  --     one, so a unit number a learner has already seen never moves.
  WITH scope AS (
    SELECT r.programme_id, r.module, r.required_units, dl.completion_deadline
    FROM public.cohort_required_module_units(p_cohort_id) r
    JOIN public.cohort_module_deadlines dl
      ON dl.cohort_id = p_cohort_id AND dl.programme_id = r.programme_id AND dl.module = r.module
  ), have AS (
    SELECT d.programme_id, d.module, count(*)::integer AS n, max(d.ordinal)::integer AS mx
    FROM public.cohort_requirement_dates d
    WHERE d.cohort_id = p_cohort_id
    GROUP BY d.programme_id, d.module
  )
  INSERT INTO public.cohort_requirement_dates (
    cohort_id, programme_id, module, ordinal, due_on, units,
    generation_method, materialized_via, generated_due_on
  )
  SELECT p_cohort_id, s.programme_id, s.module,
    coalesce(h.mx, 0) + g.i, s.completion_deadline, 1,
    'module_deadline', 'deadline_sync', s.completion_deadline
  FROM scope s
  LEFT JOIN have h ON h.programme_id = s.programme_id AND h.module = s.module
  CROSS JOIN LATERAL generate_series(1, s.required_units - coalesce(h.n, 0)) AS g(i)
  WHERE s.required_units > coalesce(h.n, 0)
  ON CONFLICT (cohort_id, programme_id, module, ordinal) DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  v_changed := v_changed + n;

  -- 5c. Remove surplus units -- the programme now requires fewer, or the module
  --     is no longer required at all. Only units nothing points at: a
  --     requirement that carries history survives and is reported as surplus.
  WITH ranked AS (
    SELECT d.id, d.programme_id, d.module,
      row_number() OVER (PARTITION BY d.programme_id, d.module ORDER BY d.ordinal, d.id) AS rank
    FROM public.cohort_requirement_dates d
    WHERE d.cohort_id = p_cohort_id
  ), scope AS (
    SELECT r.programme_id, r.module, r.required_units
    FROM public.cohort_required_module_units(p_cohort_id) r
  )
  DELETE FROM public.cohort_requirement_dates x
  USING ranked r
  LEFT JOIN scope s ON s.programme_id = r.programme_id AND s.module = r.module
  WHERE x.id = r.id
    AND r.rank > coalesce(s.required_units, 0)
    AND NOT public.cohort_requirement_is_referenced(x.id);
  GET DIAGNOSTICS n = ROW_COUNT;
  v_changed := v_changed + n;

  -- 5d. Every remaining unit projects the deadline.
  UPDATE public.cohort_requirement_dates d
  SET due_on = dl.completion_deadline,
      generated_due_on = dl.completion_deadline,
      is_overridden = false,
      generation_method = 'module_deadline'
  FROM public.cohort_module_deadlines dl
  WHERE d.cohort_id = p_cohort_id
    AND dl.cohort_id = d.cohort_id
    AND dl.programme_id = d.programme_id
    AND dl.module = d.module
    AND (d.due_on IS DISTINCT FROM dl.completion_deadline
         OR d.generation_method IS DISTINCT FROM 'module_deadline');
  GET DIAGNOSTICS n = ROW_COUNT;
  v_changed := v_changed + n;

  PERFORM set_config('app.crd_sync', 'off', true);
  RETURN v_changed;
END;
$$;

COMMENT ON FUNCTION public.sync_cohort_requirement_dates(uuid) IS
  'Materialises a cohort''s canonical requirements: exactly required_units rows '
  'per module, every one due on the cohort-module completion deadline. Adds '
  'missing units, drops surplus units nothing points at, and never deletes a '
  'requirement that already carries activity.';

REVOKE ALL ON FUNCTION public.sync_cohort_requirement_dates(uuid) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. Triggers: the schedule follows the deadline, required_units and scope
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_cohort_requirement_fill_from_cohort()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- A cohort end-date change moves only the deadlines the system itself set;
  -- a deadline an Admin chose is theirs and is left alone.
  IF TG_OP = 'UPDATE' AND NEW.end_date IS DISTINCT FROM OLD.end_date AND NEW.end_date IS NOT NULL THEN
    UPDATE public.cohort_module_deadlines
    SET completion_deadline = NEW.end_date
    WHERE cohort_id = NEW.id AND source = 'cohort_end' AND completion_deadline IS DISTINCT FROM NEW.end_date;
  END IF;
  PERFORM public.sync_cohort_requirement_dates(NEW.id);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_cohort_requirement_fill_from_enrollment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.cohort_id IS NOT NULL THEN
    PERFORM public.sync_cohort_requirement_dates(NEW.cohort_id);
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_cohort_requirement_fill_from_programme_module()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- required_units is the programme's answer to HOW MANY, so a change to it
  -- has to reach every cohort running that programme.
  PERFORM public.sync_cohort_requirement_dates(c.id)
  FROM public.cohorts c
  WHERE c.programme_id = NEW.programme_id
     OR EXISTS (SELECT 1 FROM public.programme_enrollments e
                WHERE e.cohort_id = c.id AND e.programme_id = NEW.programme_id);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_cohort_requirement_fill_from_deadline()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.sync_cohort_requirement_dates(NEW.cohort_id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cohort_module_deadlines_sync ON public.cohort_module_deadlines;
CREATE TRIGGER trg_cohort_module_deadlines_sync
  AFTER INSERT OR UPDATE OF completion_deadline ON public.cohort_module_deadlines
  FOR EACH ROW EXECUTE FUNCTION public.trg_cohort_requirement_fill_from_deadline();

REVOKE ALL ON FUNCTION public.trg_cohort_requirement_fill_from_deadline() FROM PUBLIC, anon, authenticated;

-- The distribution-mode generator and the per-unit Admin editor are gone.
DROP FUNCTION IF EXISTS public.materialize_missing_cohort_requirement_dates(uuid);
DROP FUNCTION IF EXISTS public.admin_save_cohort_requirement_dates(uuid, jsonb, boolean);
DROP FUNCTION IF EXISTS public.cohort_requirement_schedule_proposal(uuid, date, date, uuid);
DROP FUNCTION IF EXISTS public.cohort_requirement_proposal_internal(uuid, uuid, date, date);

-- ---------------------------------------------------------------------------
-- 7. Admin: read and set cohort-module deadlines
-- ---------------------------------------------------------------------------
-- An Admin sets ONE date per cohort-module. The N requirement rows are the
-- system's business, never something an Admin types in one at a time.
CREATE OR REPLACE FUNCTION public.admin_cohort_module_deadlines(p_cohort_id uuid)
RETURNS TABLE (
  programme_id uuid,
  programme_name text,
  module public.programme_module_type,
  required_units integer,
  scheduled_units integer,
  completion_deadline date,
  source text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Only admins can review cohort requirement deadlines' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  WITH scope AS (
    SELECT r.programme_id, r.module, r.required_units
    FROM public.cohort_required_module_units(p_cohort_id) r
  ), scheduled AS (
    SELECT d.programme_id, d.module, count(*)::integer AS units
    FROM public.cohort_requirement_dates d
    WHERE d.cohort_id = p_cohort_id
    GROUP BY d.programme_id, d.module
  )
  SELECT coalesce(s.programme_id, sc.programme_id),
    p.name,
    coalesce(s.module, sc.module),
    coalesce(s.required_units, 0),
    coalesce(sc.units, 0),
    dl.completion_deadline,
    dl.source
  FROM scope s
  FULL JOIN scheduled sc ON sc.programme_id = s.programme_id AND sc.module = s.module
  LEFT JOIN public.cohort_module_deadlines dl
    ON dl.cohort_id = p_cohort_id
   AND dl.programme_id = coalesce(s.programme_id, sc.programme_id)
   AND dl.module = coalesce(s.module, sc.module)
  LEFT JOIN public.programmes p ON p.id = coalesce(s.programme_id, sc.programme_id)
  ORDER BY p.name, coalesce(s.module, sc.module);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_cohort_module_deadlines(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_cohort_module_deadlines(uuid) TO authenticated;

-- A cohort that does not exist yet: what the Admin dialog offers before saving.
CREATE OR REPLACE FUNCTION public.cohort_module_deadline_proposal(
  p_programme_id uuid,
  p_end date
)
RETURNS TABLE (
  programme_id uuid,
  module public.programme_module_type,
  required_units integer,
  completion_deadline date
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Only admins can preview cohort requirement deadlines' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT p_programme_id, pm.module,
    coalesce(public.programme_config_integer(pm.config, 'required_units'), 0)::integer,
    p_end
  FROM public.programme_modules pm
  WHERE pm.programme_id = p_programme_id
    AND pm.enabled
    AND pm.module <> 'training'::public.programme_module_type
    AND coalesce((pm.config->>'required')::boolean, false)
    AND coalesce(public.programme_config_integer(pm.config, 'required_units'), 0) > 0
  ORDER BY pm.module;
END;
$$;

REVOKE ALL ON FUNCTION public.cohort_module_deadline_proposal(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cohort_module_deadline_proposal(uuid, date) TO authenticated;

-- p_items: [{ "programme_id", "module", "completion_deadline" }, ...]
CREATE OR REPLACE FUNCTION public.admin_set_cohort_module_deadlines(
  p_cohort_id uuid,
  p_items jsonb
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
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
  RETURN saved;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_cohort_module_deadlines(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_cohort_module_deadlines(uuid, jsonb) TO authenticated;

-- ---------------------------------------------------------------------------
-- 8. Diagnostics
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cohort_requirement_schedule_issues(p_cohort_id uuid)
RETURNS TABLE (
  programme_id uuid,
  module public.programme_module_type,
  issue text,
  required_units integer,
  scheduled_units integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Only admins can review cohort requirement schedules' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  WITH cohort AS (
    SELECT c.id, c.start_date, c.end_date FROM public.cohorts c WHERE c.id = p_cohort_id
  ), scope AS (
    SELECT r.programme_id, r.module, r.required_units
    FROM public.cohort_required_module_units(p_cohort_id) r
  ), scheduled AS (
    SELECT d.programme_id, d.module, count(*)::integer AS units
    FROM public.cohort_requirement_dates d
    WHERE d.cohort_id = p_cohort_id
    GROUP BY d.programme_id, d.module
  ), deadlines AS (
    SELECT dl.programme_id, dl.module, dl.completion_deadline
    FROM public.cohort_module_deadlines dl
    WHERE dl.cohort_id = p_cohort_id
  )
  -- A required module with no deadline: the cohort has no end date and nobody
  -- has chosen one, so no requirement can be materialised.
  SELECT s.programme_id, s.module, 'missing_deadline', s.required_units, coalesce(sc.units, 0)
  FROM scope s
  LEFT JOIN scheduled sc ON sc.programme_id = s.programme_id AND sc.module = s.module
  WHERE NOT EXISTS (SELECT 1 FROM deadlines d WHERE d.programme_id = s.programme_id AND d.module = s.module)
  UNION ALL
  SELECT s.programme_id, s.module, 'missing_dates', s.required_units, coalesce(sc.units, 0)
  FROM scope s LEFT JOIN scheduled sc ON sc.programme_id = s.programme_id AND sc.module = s.module
  WHERE coalesce(sc.units, 0) < s.required_units
  UNION ALL
  -- Surplus units survive only when activity already points at them.
  SELECT s.programme_id, s.module, 'surplus_dates', s.required_units, sc.units
  FROM scope s JOIN scheduled sc ON sc.programme_id = s.programme_id AND sc.module = s.module
  WHERE sc.units > s.required_units
  UNION ALL
  SELECT d.programme_id, d.module, 'outside_cohort', s.required_units, coalesce(sc.units, 0)
  FROM deadlines d
  CROSS JOIN cohort co
  LEFT JOIN scope s ON s.programme_id = d.programme_id AND s.module = d.module
  LEFT JOIN scheduled sc ON sc.programme_id = d.programme_id AND sc.module = d.module
  WHERE co.start_date IS NOT NULL AND co.end_date IS NOT NULL
    AND (d.completion_deadline < co.start_date OR d.completion_deadline > co.end_date)
  UNION ALL
  SELECT sc.programme_id, sc.module, 'out_of_scope', NULL::integer, sc.units
  FROM scheduled sc
  WHERE NOT EXISTS (SELECT 1 FROM scope s WHERE s.programme_id = sc.programme_id AND s.module = sc.module);
END;
$$;

REVOKE ALL ON FUNCTION public.cohort_requirement_schedule_issues(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cohort_requirement_schedule_issues(uuid) TO authenticated;

-- Which cohort-modules used to have several different per-unit dates. Nothing
-- was destroyed: the old dates are in legacy_due_on. This is what an Admin
-- reviews to decide whether one deadline is right for that cohort.
CREATE OR REPLACE FUNCTION public.cohort_requirement_legacy_spread()
RETURNS TABLE (
  cohort_id uuid,
  cohort_name text,
  programme_id uuid,
  module public.programme_module_type,
  units integer,
  legacy_first_due date,
  legacy_last_due date,
  completion_deadline date
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Only admins can review legacy requirement schedules' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT d.cohort_id, c.name, d.programme_id, d.module, count(*)::integer,
    min(d.legacy_due_on), max(d.legacy_due_on), max(dl.completion_deadline)
  FROM public.cohort_requirement_dates d
  JOIN public.cohorts c ON c.id = d.cohort_id
  LEFT JOIN public.cohort_module_deadlines dl
    ON dl.cohort_id = d.cohort_id AND dl.programme_id = d.programme_id AND dl.module = d.module
  WHERE d.legacy_due_on IS NOT NULL
  GROUP BY d.cohort_id, c.name, d.programme_id, d.module
  HAVING min(d.legacy_due_on) IS DISTINCT FROM max(d.legacy_due_on)
  ORDER BY c.name, d.module;
END;
$$;

REVOKE ALL ON FUNCTION public.cohort_requirement_legacy_spread() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cohort_requirement_legacy_spread() TO authenticated;

-- ---------------------------------------------------------------------------
-- 9. Materialise every cohort onto the new model, then prove the invariants
-- ---------------------------------------------------------------------------
SELECT public.sync_cohort_requirement_dates(c.id) FROM public.cohorts c;

DO $verify$
DECLARE
  bad text;
  n bigint;
BEGIN
  -- Every required module with a deadline has at least its required units.
  SELECT string_agg(format('%s/%s: %s of %s', x.cohort_id, x.module, x.have, x.required_units), '; ')
  INTO bad
  FROM (
    SELECT c.id AS cohort_id, r.module, r.required_units,
      (SELECT count(*) FROM public.cohort_requirement_dates d
       WHERE d.cohort_id = c.id AND d.programme_id = r.programme_id AND d.module = r.module) AS have
    FROM public.cohorts c
    CROSS JOIN LATERAL public.cohort_required_module_units(c.id) r
    JOIN public.cohort_module_deadlines dl
      ON dl.cohort_id = c.id AND dl.programme_id = r.programme_id AND dl.module = r.module
  ) x
  WHERE x.have < x.required_units;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'Requirement materialisation short of required_units: %', bad;
  END IF;

  -- Every requirement projects its cohort-module deadline.
  SELECT count(*) INTO n
  FROM public.cohort_requirement_dates d
  JOIN public.cohort_module_deadlines dl
    ON dl.cohort_id = d.cohort_id AND dl.programme_id = d.programme_id AND dl.module = d.module
  WHERE d.due_on IS DISTINCT FROM dl.completion_deadline;
  IF n > 0 THEN
    RAISE EXCEPTION '% requirement rows do not carry their cohort-module deadline', n;
  END IF;

  -- One row, one unit.
  SELECT count(*) INTO n FROM public.cohort_requirement_dates WHERE units <> 1;
  IF n > 0 THEN
    RAISE EXCEPTION '% requirement rows still carry more than one unit', n;
  END IF;

  -- No requirement-scheduling function interprets a distribution mode any more.
  -- Comments are stripped first: several bodies legitimately explain that the
  -- concept is gone, and that prose must not trip the check.
  SELECT string_agg(p.proname, ', ') INTO bad
  FROM pg_proc p
  JOIN pg_namespace ns ON ns.oid = p.pronamespace AND ns.nspname = 'public'
  WHERE p.prokind = 'f'
    AND regexp_replace(pg_get_functiondef(p.oid), '--[^\n]*', '', 'g') ~ 'distribution_mode'
    AND p.proname NOT IN ('generate_enrollment_schedule', 'get_enrollment_programme_modules');
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'Requirement scheduling still reads distribution_mode in: %', bad;
  END IF;

  -- The deadline table is the only place a cohort answers BY WHEN.
  SELECT count(*) INTO n FROM public.cohort_module_deadlines;
  RAISE NOTICE 'cohort_module_deadlines: % cohort-module deadlines', n;
  SELECT count(*) INTO n FROM public.cohort_requirement_dates;
  RAISE NOTICE 'cohort_requirement_dates: % canonical requirements', n;
END
$verify$;

-- ---------------------------------------------------------------------------
-- 10. The last distribution-mode branch: the enrollment snapshot engine
-- ---------------------------------------------------------------------------
-- generate_enrollment_schedule re-implemented all five policies a SECOND time,
-- to fill enrollment_module_snapshots / enrollment_module_milestones. Nothing
-- canonical reads those milestones any more (get_enrollment_progress is already
-- closed to clients), but the snapshot is still written on every enrollment, so
-- the branch was live.
--
-- The snapshot survives -- it is the record of what the programme promised this
-- enrollment -- and its milestones become a PROJECTION of the canonical cohort
-- schedule instead of a second opinion about it. The validation of the module
-- config is unchanged, minus the mode.
CREATE OR REPLACE FUNCTION public.generate_enrollment_schedule(p_enrollment_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  e public.programme_enrollments;
  m record;
  snapshot_id uuid;
  unit_count integer;
  settings jsonb;
  required_flag boolean;
  weight_value numeric;
  written integer;
BEGIN
  SELECT * INTO e FROM public.programme_enrollments WHERE id = p_enrollment_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Enrollment not found' USING ERRCODE = 'P0001';
  END IF;
  IF e.cohort_id IS NULL OR e.end_date IS NULL THEN
    RAISE EXCEPTION 'Enrollment requires cohort and end date before schedule generation' USING ERRCODE = 'P0001';
  END IF;

  -- Serialize concurrent generation and treat the first complete transaction
  -- as the immutable enrollment snapshot. A failed first generation rolls back
  -- atomically, so it cannot leave a partial snapshot behind. A historical
  -- partial snapshot is not safe to silently accept (or rebuild), since doing
  -- so could change identities already observed by progress APIs.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_enrollment_id::text, 0));
  IF EXISTS (SELECT 1 FROM public.enrollment_module_snapshots WHERE enrollment_id = p_enrollment_id) THEN
    IF NOT (
      NOT EXISTS (
        SELECT 1
        FROM public.programme_modules pm
        WHERE pm.programme_id = e.programme_id
          AND pm.enabled
          AND NOT EXISTS (
            SELECT 1
            FROM public.enrollment_module_snapshots s
            WHERE s.enrollment_id = p_enrollment_id
              AND s.programme_module_id = pm.id
              AND s.starts_on = e.start_date
              AND s.ends_on = e.end_date
              AND coalesce((
                SELECT sum(mm.required_units)
                FROM public.enrollment_module_milestones mm
                WHERE mm.enrollment_module_snapshot_id = s.id
              ), 0) = s.required_units
          )
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.enrollment_module_snapshots s
        WHERE s.enrollment_id = p_enrollment_id
          AND NOT EXISTS (
            SELECT 1 FROM public.programme_modules pm
            WHERE pm.id = s.programme_module_id
              AND pm.programme_id = e.programme_id
              AND pm.enabled
          )
      )
    ) THEN
      RAISE EXCEPTION 'Existing enrollment schedule snapshot is incomplete' USING ERRCODE = 'P0001';
    END IF;
    RETURN;
  END IF;

  FOR m IN
    SELECT * FROM public.programme_modules
    WHERE programme_id = e.programme_id AND enabled
    ORDER BY module
  LOOP
    settings := coalesce(m.config->'distribution_settings', '{}'::jsonb);
    IF jsonb_typeof(settings) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'Module distribution_settings must be a JSON object' USING ERRCODE = 'P0001';
    END IF;

    BEGIN
      unit_count := coalesce((m.config->>'required_units')::integer, 0);
      required_flag := coalesce((m.config->>'required')::boolean, false);
      weight_value := nullif(m.config->>'weight', '')::numeric;
    EXCEPTION
      WHEN invalid_text_representation OR numeric_value_out_of_range THEN
        RAISE EXCEPTION 'Module required_units, required, and weight must use valid values' USING ERRCODE = 'P0001';
    END;

    IF unit_count < 0 THEN
      RAISE EXCEPTION 'Module required_units must be nonnegative' USING ERRCODE = 'P0001';
    END IF;
    IF required_flag AND unit_count = 0 THEN
      RAISE EXCEPTION 'Required modules must have at least one required unit' USING ERRCODE = 'P0001';
    END IF;
    IF weight_value IS NOT NULL AND weight_value < 0 THEN
      RAISE EXCEPTION 'Module weight must be nonnegative' USING ERRCODE = 'P0001';
    END IF;

    INSERT INTO public.enrollment_module_snapshots (
      enrollment_id, programme_module_id, module, required, required_units,
      distribution_settings, weight, starts_on, ends_on
    )
    VALUES (
      p_enrollment_id, m.id, m.module, required_flag, unit_count,
      settings, weight_value, e.start_date, e.end_date
    )
    RETURNING id INTO snapshot_id;

    IF unit_count = 0 THEN
      CONTINUE;
    END IF;

    -- One milestone per canonical requirement, on the cohort-module deadline;
    -- Training keeps its week-driven dates. No policy is interpreted here.
    INSERT INTO public.enrollment_module_milestones (
      enrollment_module_snapshot_id, sequence, due_on, training_week_id, required_units
    )
    SELECT snapshot_id,
      row_number() OVER (ORDER BY s.due_on, s.training_week_id NULLS FIRST)::integer,
      s.due_on, s.training_week_id, s.milestone_units
    FROM public.sponsor_canonical_module_schedule(p_enrollment_id) s
    WHERE s.module = m.module AND s.due_on IS NOT NULL AND s.milestone_units > 0;
    GET DIAGNOSTICS written = ROW_COUNT;

    -- A cohort with no deadline for this module materialises no requirement.
    -- The snapshot still has to add up, so it records the whole module against
    -- the enrollment's own end date -- an enrollment fallback, never a cohort
    -- deadline anybody else can see.
    IF written = 0 THEN
      INSERT INTO public.enrollment_module_milestones (
        enrollment_module_snapshot_id, sequence, due_on, required_units
      ) VALUES (snapshot_id, 1, e.end_date, unit_count);
    END IF;
  END LOOP;
END;
$function$;

COMMENT ON COLUMN public.enrollment_module_snapshots.distribution_mode IS
  'HISTORICAL as of 2026-09-22. Scheduling policies were replaced by one cohort-'
  'module completion deadline; nothing reads this column. Kept so existing rows '
  'remain readable.';

ALTER TABLE public.enrollment_module_snapshots ALTER COLUMN distribution_mode DROP NOT NULL;
ALTER TABLE public.enrollment_module_snapshots ALTER COLUMN distribution_mode DROP DEFAULT;

DO $$
DECLARE c text;
BEGIN
  SELECT con.conname INTO c FROM pg_constraint con
  WHERE con.conrelid = 'public.enrollment_module_snapshots'::regclass
    AND con.contype = 'c'
    AND pg_get_constraintdef(con.oid) LIKE '%distribution_mode%';
  IF c IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.enrollment_module_snapshots DROP CONSTRAINT %I', c);
  END IF;
END $$;

-- The learner-facing module config stops carrying a scheduling policy.
CREATE OR REPLACE FUNCTION public.get_enrollment_programme_modules(p_enrollment_id uuid)
RETURNS TABLE (module public.programme_module_type, enabled boolean, config jsonb)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT ms.module, true,
    coalesce(public.enrollment_module_config(p_enrollment_id, ms.module), '{}'::jsonb)
      - 'distribution_mode'
  FROM public.enrollment_module_snapshots ms
  JOIN public.programme_enrollments e ON e.id = ms.enrollment_id
  WHERE ms.enrollment_id = p_enrollment_id
    AND (e.user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'::public.app_role));
$$;

REVOKE ALL ON FUNCTION public.get_enrollment_programme_modules(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_enrollment_programme_modules(uuid) TO authenticated;

DO $$
DECLARE bad text;
BEGIN
  SELECT string_agg(p.proname, ', ') INTO bad
  FROM pg_proc p
  JOIN pg_namespace ns ON ns.oid = p.pronamespace AND ns.nspname = 'public'
  WHERE p.prokind = 'f'
    -- Comments are stripped, and so is the one legitimate remaining mention:
    -- get_enrollment_programme_modules DELETES the key from the config it
    -- returns, which is the opposite of reading it.
    AND replace(
          regexp_replace(pg_get_functiondef(p.oid), '--[^\n]*', '', 'g'),
          '- ''distribution_mode''', '') ~ 'distribution_mode';
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'distribution_mode still decides something in: %', bad;
  END IF;
END $$;
