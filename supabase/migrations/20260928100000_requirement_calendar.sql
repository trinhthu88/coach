-- ===========================================================================
-- N required units = N requirement instances, each independently dated.
-- One canonical enrollment requirement calendar that every role reads.
-- ===========================================================================
--
-- SUPERSEDES the "one completion deadline per cohort x module" decision
-- recorded in 20260926400000_deadline_contract_locked.sql.
--
-- Why: a programme that requires Coaching x 4 had four requirement rows in
-- cohort_requirement_dates, but sync step 5d overwrote every row's due_on with
-- the single module deadline. Admin could therefore configure only one date per
-- module, and Training was not materialised at all (its dates were computed on
-- the fly from training weeks). The Sponsor checkpoint journey stacked all four
-- Coaching units onto one date and interleaved Training week dates Admin could
-- not see ("Checkpoint 4 0/7"), which is the source-of-truth mismatch this
-- migration removes.
--
-- The model after this migration:
--
--   PROGRAMME  programme_modules.config.required_units = N      WHAT / HOW MANY
--              Training: config.distribution_settings.training_week_ids
--              (exactly one selected week per required unit) and
--              config.learning_components (which child learning types apply)
--   COHORT     cohort_requirement_dates: exactly one row per required unit,
--              ordinals 1..N, each with its OWN due_on.            WHEN
--              - session modules (Coaching, Mentoring, Peer, Triads): a new
--                row starts at the module's completion deadline
--                (cohort_module_deadlines, now the DEFAULT / bulk value);
--              - Training: one row per selected week (training_week_id), a new
--                row starts at the week's pacing date (cohort week override ->
--                cohort start + (week - 1) * 7 -> template unlock date).
--              An Admin date is kept (is_overridden = true) until the Admin
--              resets it; a non-overridden row follows its default.
--   ENROLLMENT programme_enrollments (programme, cohort, organisation) WHO
--   CALENDAR   canonical_enrollment_requirement_calendar(enrollment, as_of)
--              one row per requirement instance with due / completed / overdue.
--              canonical_module_progress, canonical_overdue_items and both
--              journeys aggregate THIS; nothing else counts requirements.
--
-- distribution_mode is not reintroduced: no policy spreads dates. A date is
-- either the default or the date an Admin typed.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. cohort_requirement_dates accepts Training requirement rows
-- ---------------------------------------------------------------------------
ALTER TABLE public.cohort_requirement_dates DROP CONSTRAINT IF EXISTS cohort_requirement_dates_module_check;
ALTER TABLE public.cohort_requirement_dates DROP CONSTRAINT IF EXISTS cohort_requirement_dates_generation_method_check;
ALTER TABLE public.cohort_requirement_dates DROP CONSTRAINT IF EXISTS cohort_requirement_dates_materialized_via_check;
ALTER TABLE public.cohort_requirement_dates
  ADD CONSTRAINT cohort_requirement_dates_generation_method_check
    CHECK (generation_method IN ('module_deadline', 'training_week', 'manual')),
  ADD CONSTRAINT cohort_requirement_dates_materialized_via_check
    CHECK (materialized_via IN ('backfill', 'deadline_sync', 'training_sync', 'admin_save')),
  -- A Training requirement IS a selected training week.
  ADD CONSTRAINT cohort_requirement_dates_training_week_required
    CHECK (module <> 'training'::public.programme_module_type OR training_week_id IS NOT NULL);

-- Each selected week maps to exactly one Training requirement of the cohort.
CREATE UNIQUE INDEX IF NOT EXISTS ux_cohort_requirement_dates_training_week
  ON public.cohort_requirement_dates (cohort_id, programme_id, training_week_id)
  WHERE module = 'training'::public.programme_module_type;

COMMENT ON COLUMN public.cohort_requirement_dates.due_on IS
  'The requirement instance''s own due date. Defaults to the module completion deadline (session modules) or the '
  'week pacing date (Training); an Admin date (is_overridden) is kept until reset.';
COMMENT ON COLUMN public.cohort_requirement_dates.is_overridden IS
  'true = an Admin set this requirement''s date; sync leaves it alone. false = the row follows its default.';

-- ---------------------------------------------------------------------------
-- 2. Human-readable requirement labels (one definition, every surface)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cohort_requirement_label(
  p_module public.programme_module_type, p_ordinal integer, p_week_number integer DEFAULT NULL, p_week_title text DEFAULT NULL
) RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT CASE p_module
    WHEN 'coaching'::public.programme_module_type THEN 'Coaching Session ' || p_ordinal
    WHEN 'mentoring'::public.programme_module_type THEN 'Mentoring Session ' || p_ordinal
    WHEN 'peer_coaching'::public.programme_module_type THEN 'Peer Practice ' || p_ordinal
    WHEN 'triads'::public.programme_module_type THEN 'Triad ' || p_ordinal
    WHEN 'training'::public.programme_module_type THEN
      'Week ' || coalesce(p_week_number, p_ordinal) || coalesce(': ' || nullif(p_week_title, ''), '')
    ELSE initcap(replace(p_module::text, '_', ' ')) || ' ' || p_ordinal
  END;
$$;

-- ---------------------------------------------------------------------------
-- 3. Training requirement scope of a cohort: one entry per selected week
-- ---------------------------------------------------------------------------
-- The programme selects the weeks (content scope); the ordinal is the week's
-- position in week order; default_due_on is the week's pacing date, exactly
-- the date canonical_training_learning_items used before this migration.
CREATE OR REPLACE FUNCTION public.cohort_training_requirement_weeks(p_cohort_id uuid)
RETURNS TABLE (
  programme_id uuid, training_week_id uuid, week_number integer, week_title text,
  ordinal integer, default_due_on date
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH cohort AS (
    SELECT c.id, c.start_date, c.end_date FROM public.cohorts c WHERE c.id = p_cohort_id
  ), configured AS (
    SELECT sp.programme_id, pm.config
    FROM public.cohort_scheduled_programmes(p_cohort_id) sp
    JOIN public.programme_modules pm
      ON pm.programme_id = sp.programme_id
     AND pm.module = 'training'::public.programme_module_type
     AND pm.enabled
     AND coalesce((pm.config->>'required')::boolean, false)
  ), selected AS (
    SELECT DISTINCT cf.programme_id, tw.id AS training_week_id, tw.week_number, tw.title, tw.unlock_date
    FROM configured cf
    CROSS JOIN LATERAL jsonb_array_elements_text(
      CASE WHEN jsonb_typeof(cf.config->'distribution_settings'->'training_week_ids') = 'array'
        THEN cf.config->'distribution_settings'->'training_week_ids' ELSE '[]'::jsonb END
    ) s(week_id)
    JOIN public.training_weeks tw ON tw.id::text = s.week_id AND tw.programme_id = cf.programme_id
  )
  SELECT s.programme_id, s.training_week_id, s.week_number, s.title,
    row_number() OVER (PARTITION BY s.programme_id ORDER BY s.week_number, s.training_week_id)::integer,
    least(
      co.end_date,
      coalesce(cwo.unlock_date, (co.start_date + ((s.week_number - 1) * interval '7 days'))::date, s.unlock_date)
    )
  FROM selected s
  CROSS JOIN cohort co
  LEFT JOIN public.cohort_week_overrides cwo
    ON cwo.cohort_id = co.id AND cwo.training_week_id = s.training_week_id;
$$;

-- ---------------------------------------------------------------------------
-- 4. sync_cohort_requirement_dates: defaults fill, Admin dates survive
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_cohort_requirement_dates(p_cohort_id uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
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

  -- 5a. A session module that has just become required gets the cohort end
  --     date as its default deadline. No end date means no default: a date is
  --     never invented, and the module is reported as unscheduled instead.
  IF v_end IS NOT NULL THEN
    INSERT INTO public.cohort_module_deadlines (cohort_id, programme_id, module, completion_deadline, source)
    SELECT p_cohort_id, r.programme_id, r.module, v_end, 'cohort_end'
    FROM public.cohort_required_module_units(p_cohort_id) r
    ON CONFLICT (cohort_id, programme_id, module) DO NOTHING;
  END IF;

  -- 5b. Add the missing session units. New ordinals continue after the highest
  --     existing one, so a unit number a learner has already seen never moves.
  --     A new unit starts at the module deadline (its default).
  WITH scope AS (
    SELECT r.programme_id, r.module, r.required_units, dl.completion_deadline
    FROM public.cohort_required_module_units(p_cohort_id) r
    JOIN public.cohort_module_deadlines dl
      ON dl.cohort_id = p_cohort_id AND dl.programme_id = r.programme_id AND dl.module = r.module
  ), have AS (
    SELECT d.programme_id, d.module, count(*)::integer AS n, max(d.ordinal)::integer AS mx
    FROM public.cohort_requirement_dates d
    WHERE d.cohort_id = p_cohort_id AND d.module <> 'training'::public.programme_module_type
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

  -- 5c. Remove surplus session units -- the programme now requires fewer, or
  --     the module is no longer required at all. Only units nothing points at:
  --     a requirement that carries history survives and is reported as surplus.
  WITH ranked AS (
    SELECT d.id, d.programme_id, d.module,
      row_number() OVER (PARTITION BY d.programme_id, d.module ORDER BY d.ordinal, d.id) AS rank
    FROM public.cohort_requirement_dates d
    WHERE d.cohort_id = p_cohort_id AND d.module <> 'training'::public.programme_module_type
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

  -- 5d. A session unit that no Admin has dated follows the module deadline.
  --     An Admin-dated unit (is_overridden) keeps its own date.
  UPDATE public.cohort_requirement_dates d
  SET due_on = dl.completion_deadline,
      generated_due_on = dl.completion_deadline,
      generation_method = 'module_deadline'
  FROM public.cohort_module_deadlines dl
  WHERE d.cohort_id = p_cohort_id
    AND NOT d.is_overridden
    AND dl.cohort_id = d.cohort_id
    AND dl.programme_id = d.programme_id
    AND dl.module = d.module
    AND (d.due_on IS DISTINCT FROM dl.completion_deadline
         OR d.generation_method IS DISTINCT FROM 'module_deadline');
  GET DIAGNOSTICS n = ROW_COUNT;
  v_changed := v_changed + n;

  -- 6. Training: exactly one requirement per selected week.
  CREATE TEMP TABLE IF NOT EXISTS pg_temp.crd_training_scope (
    programme_id uuid, training_week_id uuid, ordinal integer, default_due_on date
  ) ON COMMIT DROP;
  TRUNCATE pg_temp.crd_training_scope;
  INSERT INTO pg_temp.crd_training_scope
  SELECT w.programme_id, w.training_week_id, w.ordinal, w.default_due_on
  FROM public.cohort_training_requirement_weeks(p_cohort_id) w;

  -- 6a. A week that is no longer selected is no longer a requirement.
  --     (Training requirements are never referenced by sessions.)
  DELETE FROM public.cohort_requirement_dates d
  WHERE d.cohort_id = p_cohort_id
    AND d.module = 'training'::public.programme_module_type
    AND NOT EXISTS (
      SELECT 1 FROM pg_temp.crd_training_scope s
      WHERE s.programme_id = d.programme_id AND s.training_week_id = d.training_week_id);
  GET DIAGNOSTICS n = ROW_COUNT;
  v_changed := v_changed + n;

  -- 6b. Keep the ordinal equal to the week's position (two passes so the
  --     unique ordinal key never collides mid-update), and move every
  --     non-overridden week to its pacing date.
  UPDATE public.cohort_requirement_dates d
  SET ordinal = d.ordinal + 100000
  FROM pg_temp.crd_training_scope s
  WHERE d.cohort_id = p_cohort_id
    AND d.module = 'training'::public.programme_module_type
    AND s.programme_id = d.programme_id AND s.training_week_id = d.training_week_id
    AND d.ordinal <> s.ordinal;

  UPDATE public.cohort_requirement_dates d
  SET ordinal = s.ordinal,
      due_on = CASE WHEN d.is_overridden OR s.default_due_on IS NULL THEN d.due_on ELSE s.default_due_on END,
      generated_due_on = coalesce(s.default_due_on, d.generated_due_on),
      generation_method = CASE WHEN d.is_overridden THEN d.generation_method ELSE 'training_week' END
  FROM pg_temp.crd_training_scope s
  WHERE d.cohort_id = p_cohort_id
    AND d.module = 'training'::public.programme_module_type
    AND s.programme_id = d.programme_id AND s.training_week_id = d.training_week_id
    AND (d.ordinal <> s.ordinal
         OR (NOT d.is_overridden AND s.default_due_on IS NOT NULL AND d.due_on IS DISTINCT FROM s.default_due_on)
         OR d.generated_due_on IS DISTINCT FROM coalesce(s.default_due_on, d.generated_due_on));
  GET DIAGNOSTICS n = ROW_COUNT;
  v_changed := v_changed + n;

  -- 6c. Materialise every selected week that has a date. A week with no pacing
  --     date at all (no override, no cohort start, no template date) is left
  --     pending -- a date is never invented.
  INSERT INTO public.cohort_requirement_dates (
    cohort_id, programme_id, module, ordinal, due_on, units, training_week_id,
    generation_method, materialized_via, generated_due_on
  )
  SELECT p_cohort_id, s.programme_id, 'training'::public.programme_module_type, s.ordinal,
    s.default_due_on, 1, s.training_week_id, 'training_week', 'training_sync', s.default_due_on
  FROM pg_temp.crd_training_scope s
  WHERE s.default_due_on IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.cohort_requirement_dates d
      WHERE d.cohort_id = p_cohort_id AND d.programme_id = s.programme_id
        AND d.module = 'training'::public.programme_module_type
        AND d.training_week_id = s.training_week_id);
  GET DIAGNOSTICS n = ROW_COUNT;
  v_changed := v_changed + n;

  PERFORM set_config('app.crd_sync', 'off', true);
  RETURN v_changed;
END;
$function$;

COMMENT ON FUNCTION public.sync_cohort_requirement_dates(uuid) IS
  'Materialises exactly N cohort_requirement_dates (units = 1, ordinals 1..N) per required session module and one per '
  'selected Training week. A new row starts at its default (module completion deadline / week pacing date); a '
  'non-overridden row follows its default; an Admin-dated row (is_overridden) keeps its own date. Supersedes the '
  'one-deadline-per-module contract of 20260926400000 (see 20260928100000).';

COMMENT ON TABLE public.cohort_module_deadlines IS
  'The DEFAULT completion deadline of a session module in a cohort: new requirement rows start at it and every '
  'requirement an Admin has not dated individually follows it. It never replaces the per-requirement due dates in '
  'cohort_requirement_dates (20260928100000).';

-- ---------------------------------------------------------------------------
-- 5. Keep Training requirements in step with their sources
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_training_requirements_from_week_override()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.sync_cohort_requirement_dates(coalesce(NEW.cohort_id, OLD.cohort_id));
  IF TG_OP = 'UPDATE' AND NEW.cohort_id IS DISTINCT FROM OLD.cohort_id THEN
    PERFORM public.sync_cohort_requirement_dates(OLD.cohort_id);
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_cohort_week_overrides_sync_requirements ON public.cohort_week_overrides;
CREATE TRIGGER trg_cohort_week_overrides_sync_requirements
  AFTER INSERT OR UPDATE OR DELETE ON public.cohort_week_overrides
  FOR EACH ROW EXECUTE FUNCTION public.trg_training_requirements_from_week_override();

CREATE OR REPLACE FUNCTION public.trg_training_requirements_from_week()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE c record;
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- The week is going: its Training requirements go with it (the FK would
    -- otherwise null the week out of a Training row, which is not allowed).
    DELETE FROM public.cohort_requirement_dates d
    WHERE d.module = 'training'::public.programme_module_type AND d.training_week_id = OLD.id;
    RETURN OLD;
  END IF;
  FOR c IN
    SELECT co.id FROM public.cohorts co
    WHERE co.programme_id IN (NEW.programme_id, CASE WHEN TG_OP = 'UPDATE' THEN OLD.programme_id END)
    UNION
    SELECT e.cohort_id FROM public.programme_enrollments e
    WHERE e.cohort_id IS NOT NULL
      AND e.programme_id IN (NEW.programme_id, CASE WHEN TG_OP = 'UPDATE' THEN OLD.programme_id END)
  LOOP
    PERFORM public.sync_cohort_requirement_dates(c.id);
  END LOOP;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_training_weeks_sync_requirements ON public.training_weeks;
CREATE TRIGGER trg_training_weeks_sync_requirements
  AFTER INSERT OR UPDATE OF programme_id, week_number, unlock_date ON public.training_weeks
  FOR EACH ROW EXECUTE FUNCTION public.trg_training_requirements_from_week();
DROP TRIGGER IF EXISTS trg_training_weeks_drop_requirements ON public.training_weeks;
CREATE TRIGGER trg_training_weeks_drop_requirements
  BEFORE DELETE ON public.training_weeks
  FOR EACH ROW EXECUTE FUNCTION public.trg_training_requirements_from_week();

-- ---------------------------------------------------------------------------
-- 6. Integrity: Training is part of the quantity invariant
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cohort_module_schedule_violation(
  p_cohort_id uuid, p_programme_id uuid, p_module public.programme_module_type
) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  WITH training_scope AS (
    SELECT w.training_week_id, w.ordinal, w.default_due_on
    FROM public.cohort_training_requirement_weeks(p_cohort_id) w
    WHERE p_module = 'training'::public.programme_module_type AND w.programme_id = p_programme_id
  ), required AS (
    SELECT r.required_units
    FROM public.cohort_required_module_units(p_cohort_id) r
    WHERE p_module <> 'training'::public.programme_module_type
      AND r.programme_id = p_programme_id AND r.module = p_module
    UNION ALL
    SELECT count(*)::integer FROM training_scope
    WHERE p_module = 'training'::public.programme_module_type
    HAVING count(*) > 0
  ), rows AS (
    SELECT count(*)::integer AS n,
      count(*) FILTER (WHERE d.units <> 1)::integer AS weighted,
      count(DISTINCT d.ordinal)::integer AS distinct_ordinals,
      coalesce(max(d.ordinal), 0)::integer AS max_ordinal,
      count(*) FILTER (
        WHERE p_module = 'training'::public.programme_module_type
          AND NOT EXISTS (SELECT 1 FROM training_scope s WHERE s.training_week_id = d.training_week_id)
      )::integer AS unselected_weeks
    FROM public.cohort_requirement_dates d
    WHERE d.cohort_id = p_cohort_id AND d.programme_id = p_programme_id AND d.module = p_module
  ), deadline AS (
    SELECT 1 AS present FROM public.cohort_module_deadlines dl
    WHERE p_module <> 'training'::public.programme_module_type
      AND dl.cohort_id = p_cohort_id AND dl.programme_id = p_programme_id AND dl.module = p_module
    UNION ALL
    -- Training has no module deadline; it is pending only while a selected
    -- week has no pacing date at all.
    SELECT 1 WHERE p_module = 'training'::public.programme_module_type
      AND NOT EXISTS (SELECT 1 FROM training_scope s WHERE s.default_due_on IS NULL)
  )
  SELECT CASE
    WHEN NOT EXISTS (SELECT 1 FROM required) AND (SELECT n FROM rows) > 0
      THEN 'out_of_scope'
    WHEN NOT EXISTS (SELECT 1 FROM required)
      THEN NULL
    WHEN (SELECT weighted FROM rows) > 0
      THEN 'weighted_rows'
    WHEN (SELECT unselected_weeks FROM rows) > 0
      THEN 'unselected_week'
    WHEN NOT EXISTS (SELECT 1 FROM deadline) AND (SELECT n FROM rows) < (SELECT required_units FROM required)
      THEN 'missing_deadline'
    WHEN (SELECT n FROM rows) < (SELECT required_units FROM required)
      THEN 'missing_requirements'
    WHEN (SELECT n FROM rows) > (SELECT required_units FROM required)
      THEN 'surplus_requirements'
    WHEN (SELECT distinct_ordinals FROM rows) <> (SELECT n FROM rows)
      THEN 'duplicate_ordinals'
    WHEN (SELECT max_ordinal FROM rows) <> (SELECT n FROM rows)
      THEN 'ordinal_gap'
    ELSE NULL
  END;
$function$;

CREATE OR REPLACE FUNCTION public.cohort_schedule_violations()
RETURNS TABLE (cohort_id uuid, programme_id uuid, module public.programme_module_type,
  required_units integer, row_count integer, violation text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  WITH in_scope AS (
    SELECT c.id AS cohort_id, r.programme_id, r.module, r.required_units
    FROM public.cohorts c
    CROSS JOIN LATERAL public.cohort_required_module_units(c.id) r
    UNION ALL
    SELECT c.id, w.programme_id, 'training'::public.programme_module_type, count(*)::integer
    FROM public.cohorts c
    CROSS JOIN LATERAL public.cohort_training_requirement_weeks(c.id) w
    GROUP BY c.id, w.programme_id
  ), pairs AS (
    SELECT * FROM in_scope
    UNION ALL
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
$function$;

-- ---------------------------------------------------------------------------
-- 7. Backfill: materialise Training for every cohort. Existing session rows
--    already carry their module deadline (the previous 5d projection), so they
--    become non-overridden rows that keep following it -- no date changes.
-- ---------------------------------------------------------------------------
DO $backfill$
DECLARE c record; n integer := 0;
BEGIN
  FOR c IN SELECT id FROM public.cohorts LOOP
    n := n + public.sync_cohort_requirement_dates(c.id);
  END LOOP;
  RAISE NOTICE 'requirement calendar backfill: % requirement rows written', n;
END
$backfill$;

-- ---------------------------------------------------------------------------
-- 8. Training items read their date from the cohort requirement
-- ---------------------------------------------------------------------------
-- The pacing formula now lives only in cohort_training_requirement_weeks (the
-- default); the date a learner, sponsor or admin sees is the requirement's
-- due_on, so an Admin edit of "Week 4" moves Week 4 everywhere. A selected,
-- visible week with no requirement row yet counts as required but not due.
CREATE OR REPLACE FUNCTION public.canonical_training_learning_items(p_enrollment_id uuid, p_as_of date DEFAULT CURRENT_DATE)
RETURNS TABLE(item_type text, item_id uuid, training_week_id uuid, due_on date,
  required_units integer, completed_units integer, completed_on date)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  WITH enrollment AS (
    SELECT e.id, e.programme_id, e.cohort_id
    FROM public.programme_enrollments e
    JOIN public.cohorts c ON c.id = e.cohort_id
    WHERE e.id = p_enrollment_id
  ), configured AS (
    SELECT e.*, coalesce(pm.config->'distribution_settings', '{}'::jsonb) AS settings
    FROM enrollment e
    JOIN public.programme_modules pm
      ON pm.programme_id = e.programme_id
     AND pm.module = 'training'::public.programme_module_type
     AND pm.enabled
     AND coalesce((pm.config->>'required')::boolean, false)
  ), selected_weeks AS (
    SELECT DISTINCT c.id AS enrollment_id, tw.id AS training_week_id,
      tw.is_visible, tw.skill_card_visible,
      coalesce(cwo.is_visible, true) AS override_visible,
      d.due_on
    FROM configured c
    CROSS JOIN LATERAL jsonb_array_elements_text(
      CASE WHEN jsonb_typeof(c.settings->'training_week_ids') = 'array'
        THEN c.settings->'training_week_ids' ELSE '[]'::jsonb END
    ) selected(week_id)
    JOIN public.training_weeks tw
      ON tw.id::text = selected.week_id AND tw.programme_id = c.programme_id
    LEFT JOIN public.cohort_week_overrides cwo
      ON cwo.cohort_id = c.cohort_id AND cwo.training_week_id = tw.id
    LEFT JOIN public.cohort_requirement_dates d
      ON d.cohort_id = c.cohort_id AND d.programme_id = c.programme_id
     AND d.module = 'training'::public.programme_module_type AND d.training_week_id = tw.id
  )
  SELECT 'skill_cards'::text, sw.training_week_id, sw.training_week_id, sw.due_on, 1,
    CASE WHEN tp.completed_at IS NOT NULL AND tp.completed_at::date <= p_as_of THEN 1 ELSE 0 END::integer,
    tp.completed_at::date
  FROM selected_weeks sw
  LEFT JOIN public.training_progress tp
    ON tp.enrollment_id = sw.enrollment_id AND tp.training_week_id = sw.training_week_id
  WHERE sw.is_visible AND sw.skill_card_visible AND sw.override_visible;
$function$;

-- ---------------------------------------------------------------------------
-- 9. THE canonical enrollment requirement calendar
-- ---------------------------------------------------------------------------
-- One row per applicable requirement instance of the enrollment:
--   session modules: ordinals 1..N from the programme, dated by the cohort row
--                    (a missing row is still a requirement, with no due date);
--   Training:        every selected, visible week, dated by its cohort row.
-- is_due_as_of  = due_on IS NOT NULL AND due_on <= p_as_of
-- is_completed  = fulfilled on or before p_as_of (session lifecycle per
--                 requirement / training_progress per week)
-- is_overdue    = is_due_as_of AND NOT is_completed
-- Carries no narrative, note, reflection or rating: safe for every role.
CREATE OR REPLACE FUNCTION public.canonical_enrollment_requirement_calendar(
  p_enrollment_id uuid, p_as_of date DEFAULT CURRENT_DATE
) RETURNS TABLE (
  enrollment_id uuid, programme_id uuid, cohort_id uuid, organization_id uuid,
  module public.programme_module_type, requirement_id uuid, requirement_index integer,
  requirement_label text, training_week_id uuid, due_on date, is_required boolean,
  is_due_as_of boolean, is_completed boolean, completed_on date, is_overdue boolean,
  completion_source text
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  WITH enrollment AS (
    SELECT e.id, e.programme_id, e.cohort_id, e.organization_id
    FROM public.programme_enrollments e
    JOIN public.cohorts c ON c.id = e.cohort_id
    WHERE e.id = p_enrollment_id
  ), session_units AS (
    SELECT pm.module, g.i AS ordinal
    FROM enrollment e
    JOIN public.programme_modules pm
      ON pm.programme_id = e.programme_id
     AND pm.enabled
     AND pm.module <> 'training'::public.programme_module_type
     AND coalesce((pm.config->>'required')::boolean, false)
    CROSS JOIN LATERAL generate_series(1, coalesce(public.programme_config_integer(pm.config, 'required_units'), 0)) g(i)
  ), fulfilment AS (
    SELECT f.requirement_id, f.fulfilled_on, 'coaching_session'::text AS source
    FROM public.canonical_coaching_requirement_fulfilment(p_enrollment_id) f
    UNION ALL
    SELECT f.requirement_id, f.fulfilled_on, 'mentoring_session'
    FROM public.canonical_mentoring_requirement_fulfilment(p_enrollment_id) f
    UNION ALL
    SELECT f.requirement_id, f.fulfilled_on, 'peer_session'
    FROM public.canonical_peer_requirement_fulfilment(p_enrollment_id) f
    UNION ALL
    SELECT f.cohort_requirement_date_id, f.fulfilled_on, 'triad_session'
    FROM public.canonical_triad_requirement_fulfilment(p_enrollment_id) f
  ), rows AS (
    SELECT u.module, d.id AS requirement_id, u.ordinal AS requirement_index,
      public.cohort_requirement_label(u.module, u.ordinal) AS requirement_label,
      NULL::uuid AS training_week_id, d.due_on,
      CASE WHEN f.fulfilled_on <= p_as_of THEN f.fulfilled_on END AS completed_on,
      CASE WHEN f.fulfilled_on <= p_as_of THEN f.source END AS completion_source
    FROM session_units u
    CROSS JOIN enrollment e
    LEFT JOIN public.cohort_requirement_dates d
      ON d.cohort_id = e.cohort_id AND d.programme_id = e.programme_id
     AND d.module = u.module AND d.ordinal = u.ordinal
    LEFT JOIN fulfilment f ON f.requirement_id = d.id

    UNION ALL
    SELECT 'training'::public.programme_module_type, d.id,
      coalesce(d.ordinal, row_number() OVER (ORDER BY tw.week_number)::integer),
      public.cohort_requirement_label('training', coalesce(d.ordinal, tw.week_number), tw.week_number, tw.title),
      i.training_week_id, i.due_on,
      CASE WHEN i.completed_units > 0 THEN i.completed_on END,
      CASE WHEN i.completed_units > 0 THEN 'training_week' END
    FROM public.canonical_training_learning_items(p_enrollment_id, p_as_of) i
    CROSS JOIN enrollment e
    JOIN public.training_weeks tw ON tw.id = i.training_week_id
    LEFT JOIN public.cohort_requirement_dates d
      ON d.cohort_id = e.cohort_id AND d.programme_id = e.programme_id
     AND d.module = 'training'::public.programme_module_type AND d.training_week_id = i.training_week_id
  )
  SELECT e.id, e.programme_id, e.cohort_id, e.organization_id,
    r.module, r.requirement_id, r.requirement_index, r.requirement_label, r.training_week_id,
    r.due_on,
    true,
    r.due_on IS NOT NULL AND r.due_on <= p_as_of,
    r.completed_on IS NOT NULL,
    r.completed_on,
    r.due_on IS NOT NULL AND r.due_on <= p_as_of AND r.completed_on IS NULL,
    r.completion_source
  FROM rows r
  CROSS JOIN enrollment e
  ORDER BY r.module, r.requirement_index;
$function$;

REVOKE ALL ON FUNCTION public.canonical_enrollment_requirement_calendar(uuid, date) FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION public.canonical_enrollment_requirement_calendar(uuid, date) IS
  'THE canonical requirement calendar: one row per applicable requirement instance of an enrollment with its due date '
  'and due / completed / overdue state as of p_as_of. canonical_module_progress, canonical_overdue_items, '
  'canonical_enrollment_journey and get_sponsor_programme_journey aggregate it. Internal; read through the role wrappers.';

-- ---------------------------------------------------------------------------
-- 10. Module progress aggregates the calendar
-- ---------------------------------------------------------------------------
-- required / completed / due / overdue are counts over the calendar, so they
-- equal the calendar by construction. Only the operational extras (raw
-- completed activity, booked-but-not-held) still read the activity spine.
CREATE OR REPLACE FUNCTION public.canonical_module_progress(p_enrollment_id uuid, p_as_of date DEFAULT CURRENT_DATE)
RETURNS TABLE(module public.programme_module_type, required_units integer, completed_activity_units integer,
  completed_units integer, due_units integer, booked_units integer, overdue_units integer, pace_status text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  WITH calendar AS (
    SELECT * FROM public.canonical_enrollment_requirement_calendar(p_enrollment_id, p_as_of)
  ), modules AS (
    SELECT c.module,
      count(*)::integer AS required_units,
      count(*) FILTER (WHERE c.is_completed)::integer AS completed_units,
      count(*) FILTER (WHERE c.is_due_as_of)::integer AS due_units,
      count(*) FILTER (WHERE c.is_due_as_of AND c.is_completed)::integer AS completed_due_units,
      count(*) FILTER (WHERE c.is_overdue)::integer AS overdue_units
    FROM calendar c
    GROUP BY c.module
  ), activity AS (
    SELECT a.module,
      count(a.occurred_on) FILTER (WHERE a.status = 'completed' AND a.occurred_on <= p_as_of)::integer AS completed_activity_units,
      count(a.occurred_on) FILTER (
        WHERE a.status IN ('pending_coach_approval', 'confirmed') AND a.occurred_on >= p_as_of
      )::integer AS raw_booked_units
    FROM public.sponsor_canonical_activity(p_enrollment_id) a
    GROUP BY a.module
  ), values AS (
    SELECT m.module, m.required_units, m.completed_units, m.due_units, m.completed_due_units, m.overdue_units,
      CASE WHEN m.module = 'training' THEN m.completed_units
        ELSE greatest(coalesce(a.completed_activity_units, 0), m.completed_units) END::integer AS completed_activity_units,
      CASE WHEN m.module = 'training' THEN 0
        ELSE least(coalesce(a.raw_booked_units, 0), greatest(m.required_units - m.completed_units, 0))
      END::integer AS booked_units
    FROM modules m
    LEFT JOIN activity a ON a.module = m.module
  )
  SELECT v.module, v.required_units, v.completed_activity_units,
    least(v.completed_units, v.required_units)::integer,
    v.due_units, v.booked_units, v.overdue_units,
    CASE
      WHEN v.required_units = 0 OR v.completed_units >= v.required_units THEN 'completed'
      WHEN v.due_units = 0 THEN 'not_yet_due'
      WHEN v.completed_due_units >= v.due_units THEN
        CASE WHEN v.completed_units > v.due_units THEN 'ahead' ELSE 'on_track' END
      WHEN v.completed_due_units + v.booked_units >= v.due_units THEN 'scheduled'
      ELSE 'behind'
    END
  FROM values v
  ORDER BY v.module;
$function$;

-- ---------------------------------------------------------------------------
-- 11. Overdue list: the calendar's overdue rows
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.canonical_overdue_items(p_enrollment_id uuid, p_as_of date DEFAULT CURRENT_DATE)
RETURNS TABLE(module public.programme_module_type, overdue_units integer, due_units integer, oldest_due_on date)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT c.module,
    count(*) FILTER (WHERE c.is_overdue)::integer,
    count(*) FILTER (WHERE c.is_due_as_of)::integer,
    min(c.due_on) FILTER (WHERE c.is_overdue)
  FROM public.canonical_enrollment_requirement_calendar(p_enrollment_id, p_as_of) c
  GROUP BY c.module
  HAVING count(*) FILTER (WHERE c.is_overdue) > 0
  ORDER BY 4 NULLS LAST, 1;
$function$;
REVOKE ALL ON FUNCTION public.canonical_overdue_items(uuid, date) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 12. Checkpoints: cumulative calendar counts at each distinct due date
-- ---------------------------------------------------------------------------
-- For checkpoint date D:
--   required_units  = requirements due on or before D
--   completed_units = those requirements fulfilled on or before D (and as-of)
-- Checkpoint dates are exactly the requirement dates Admin configures.
CREATE OR REPLACE FUNCTION public.canonical_enrollment_journey(p_enrollment_id uuid, p_as_of date)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  WITH calendar AS (
    SELECT * FROM public.canonical_enrollment_requirement_calendar(p_enrollment_id, p_as_of)
  ), dates AS (
    SELECT c.due_on,
      string_agg(DISTINCT tw.title, ' · ' ORDER BY tw.title) FILTER (WHERE tw.title IS NOT NULL) AS label,
      to_jsonb(array_agg(DISTINCT c.module::text ORDER BY c.module::text)) AS module_scope
    FROM calendar c
    LEFT JOIN public.training_weeks tw ON tw.id = c.training_week_id
    WHERE c.due_on IS NOT NULL
    GROUP BY c.due_on
  ), checkpoints AS (
    SELECT d.due_on, d.label, d.module_scope,
      count(*) FILTER (WHERE c.due_on <= d.due_on)::integer AS required_units,
      count(*) FILTER (
        WHERE c.due_on <= d.due_on AND c.completed_on IS NOT NULL AND c.completed_on <= least(d.due_on, p_as_of)
      )::integer AS completed_units
    FROM dates d
    CROSS JOIN calendar c
    GROUP BY d.due_on, d.label, d.module_scope
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'checkpoint_number', n.checkpoint_number,
    'due_on', n.due_on,
    'label', n.label,
    'module_scope', n.module_scope,
    'required_units', n.required_units,
    'completed_units', n.completed_units,
    'state', CASE
      WHEN n.required_units > 0 AND n.completed_units >= n.required_units THEN 'completed'
      WHEN p_as_of < n.due_on THEN 'upcoming'
      WHEN p_as_of = n.due_on THEN 'current'
      ELSE 'overdue'
    END
  ) ORDER BY n.due_on), '[]'::jsonb)
  FROM (SELECT row_number() OVER (ORDER BY cp.due_on)::integer AS checkpoint_number, cp.* FROM checkpoints cp) n;
$function$;

CREATE OR REPLACE FUNCTION public.get_sponsor_programme_journey(p_cohort_id uuid, p_as_of date DEFAULT CURRENT_DATE)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  WITH eligible AS (
    -- The sponsor's visible enrollments in this cohort; other organisations'
    -- learners in the same cohort are not part of this sponsor's journey.
    SELECT v.enrollment_id AS id
    FROM public.sponsor_visible_enrollments() v
    WHERE v.cohort_id = p_cohort_id
  ), calendar AS (
    SELECT c.*
    FROM eligible e
    CROSS JOIN LATERAL public.canonical_enrollment_requirement_calendar(e.id, p_as_of) c
  ), dates AS (
    SELECT c.due_on,
      string_agg(DISTINCT tw.title, ' · ' ORDER BY tw.title) FILTER (WHERE tw.title IS NOT NULL) AS label,
      to_jsonb(array_agg(DISTINCT c.module::text ORDER BY c.module::text)) AS module_scope
    FROM calendar c
    LEFT JOIN public.training_weeks tw ON tw.id = c.training_week_id
    WHERE c.due_on IS NOT NULL
    GROUP BY c.due_on
  ), leader_checkpoints AS (
    SELECT d.due_on, e.id AS enrollment_id,
      count(c.*) FILTER (WHERE c.due_on <= d.due_on)::integer AS required_units,
      count(c.*) FILTER (
        WHERE c.due_on <= d.due_on AND c.completed_on IS NOT NULL AND c.completed_on <= least(d.due_on, p_as_of)
      )::integer AS completed_units
    FROM dates d
    CROSS JOIN eligible e
    LEFT JOIN calendar c ON c.enrollment_id = e.id
    GROUP BY d.due_on, e.id
  ), totals AS (
    SELECT d.due_on, d.label, d.module_scope,
      sum(l.required_units)::integer AS required_units,
      sum(l.completed_units)::integer AS completed_units,
      count(*)::integer AS total_leaders,
      count(*) FILTER (WHERE l.required_units > 0 AND l.completed_units >= l.required_units)::integer AS completed_leaders
    FROM dates d
    JOIN leader_checkpoints l ON l.due_on = d.due_on
    GROUP BY d.due_on, d.label, d.module_scope
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'checkpoint_number', n.checkpoint_number,
    'due_on', n.due_on,
    'label', n.label,
    'module_scope', n.module_scope,
    'required_units', n.required_units,
    'completed_units', n.completed_units,
    'completed_leaders', n.completed_leaders,
    'total_leaders', n.total_leaders,
    'state', CASE
      WHEN n.required_units > 0 AND n.completed_units >= n.required_units THEN 'completed'
      WHEN p_as_of < n.due_on THEN 'upcoming'
      WHEN p_as_of = n.due_on THEN 'current'
      ELSE 'overdue'
    END
  ) ORDER BY n.due_on), '[]'::jsonb)
  FROM (SELECT row_number() OVER (ORDER BY t.due_on)::integer AS checkpoint_number, t.* FROM totals t) n;
$function$;

-- ---------------------------------------------------------------------------
-- 13. Training / Learning child breakdown
-- ---------------------------------------------------------------------------
-- Child learning items are EVIDENCE inside the Training requirement, never
-- extra programme units: Training stays "completed weeks / selected weeks".
-- Which child types apply is programme configuration:
--   programme_modules(training).config.learning_components
--     = subset of ["skill_cards","quizzes","reflections","daily_prompts"]
-- When the key is absent the previous rule applies (quizzes need a required
-- 'quiz' module, daily prompts a required 'daily_prompt' module). Only
-- selected, visible weeks and visible items count; each child is dated from
-- its week's Training requirement date. Counts only -- never any answer text.
CREATE OR REPLACE FUNCTION public.canonical_learning_breakdown(p_enrollment_id uuid, p_as_of date DEFAULT CURRENT_DATE)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  WITH enrollment AS (
    SELECT e.id AS enrollment_id, e.programme_id, e.cohort_id, c.start_date AS programme_start_date
    FROM public.programme_enrollments e
    JOIN public.cohorts c ON c.id = e.cohort_id
    WHERE e.id = p_enrollment_id
  ), training AS (
    SELECT e.*, pm.config,
      CASE WHEN jsonb_typeof(pm.config->'learning_components') = 'array'
        THEN pm.config->'learning_components' END AS components
    FROM enrollment e
    JOIN public.programme_modules pm
      ON pm.programme_id = e.programme_id
     AND pm.module = 'training'::public.programme_module_type
     AND pm.enabled
     AND coalesce((pm.config->>'required')::boolean, false)
  ), applicable AS (
    SELECT
      CASE WHEN t.components IS NOT NULL THEN t.components ? 'quizzes'
        ELSE EXISTS (SELECT 1 FROM public.programme_modules q
                     WHERE q.programme_id = t.programme_id AND q.module = 'quiz'::public.programme_module_type
                       AND q.enabled AND coalesce((q.config->>'required')::boolean, false)) END AS quizzes,
      CASE WHEN t.components IS NOT NULL THEN t.components ? 'reflections' ELSE true END AS reflections,
      CASE WHEN t.components IS NOT NULL THEN t.components ? 'daily_prompts'
        ELSE EXISTS (SELECT 1 FROM public.programme_modules q
                     WHERE q.programme_id = t.programme_id AND q.module = 'daily_prompt'::public.programme_module_type
                       AND q.enabled AND coalesce((q.config->>'required')::boolean, false)) END AS daily_prompts
    FROM training t
  ), weeks AS (
    SELECT t.enrollment_id, t.programme_id, t.cohort_id, tw.id AS training_week_id, tw.week_number,
      coalesce(d.due_on,
        coalesce(cwo.unlock_date, (t.programme_start_date + ((tw.week_number - 1) * interval '7 days'))::date, tw.unlock_date)
      ) AS anchor_on
    FROM training t
    CROSS JOIN LATERAL jsonb_array_elements_text(
      CASE WHEN jsonb_typeof(t.config->'distribution_settings'->'training_week_ids') = 'array'
        THEN t.config->'distribution_settings'->'training_week_ids' ELSE '[]'::jsonb END
    ) s(week_id)
    JOIN public.training_weeks tw ON tw.id::text = s.week_id AND tw.programme_id = t.programme_id
    LEFT JOIN public.cohort_week_overrides cwo ON cwo.cohort_id = t.cohort_id AND cwo.training_week_id = tw.id
    LEFT JOIN public.cohort_requirement_dates d
      ON d.cohort_id = t.cohort_id AND d.programme_id = t.programme_id
     AND d.module = 'training'::public.programme_module_type AND d.training_week_id = tw.id
    WHERE tw.is_visible AND coalesce(cwo.is_visible, true)
  ), items AS (
    SELECT i.item_type, i.item_id, i.due_on, i.completed_units > 0 AS completed
    FROM public.canonical_training_learning_items(p_enrollment_id, p_as_of) i

    UNION ALL
    SELECT 'quizzes'::text, a.id, w.anchor_on + coalesce(a.due_offset_days, 7), asub.submitted_at IS NOT NULL
    FROM weeks w
    CROSS JOIN applicable ap
    JOIN public.assignments a
      ON a.training_week_id = w.training_week_id
     AND a.assignment_type = 'quiz'::public.assignment_type
     AND a.is_visible
    LEFT JOIN public.assignment_submissions asub
      ON asub.enrollment_id = p_enrollment_id AND asub.assignment_id = a.id AND asub.submitted_at::date <= p_as_of
    WHERE ap.quizzes

    UNION ALL
    SELECT 'reflections'::text, pr.id, w.anchor_on + 6, rs.submitted_at IS NOT NULL
    FROM weeks w
    CROSS JOIN applicable ap
    JOIN public.programme_reflections pr
      ON pr.programme_id = w.programme_id AND pr.appears_at_week = w.week_number AND pr.is_visible
    LEFT JOIN public.reflection_submissions rs
      ON rs.enrollment_id = p_enrollment_id AND rs.reflection_id = pr.id AND rs.submitted_at::date <= p_as_of
    WHERE ap.reflections

    UNION ALL
    SELECT 'daily_prompts'::text, dp.id, w.anchor_on + (coalesce(dp.day_offset, 1) - 1), dpr.responded_at IS NOT NULL
    FROM weeks w
    CROSS JOIN applicable ap
    JOIN public.daily_prompts dp ON dp.training_week_id = w.training_week_id AND dp.is_visible
    LEFT JOIN public.daily_prompt_responses dpr
      ON dpr.enrollment_id = p_enrollment_id AND dpr.daily_prompt_id = dp.id AND dpr.responded_at::date <= p_as_of
    WHERE ap.daily_prompts
  ), keys AS (
    SELECT * FROM (VALUES
      ('skill_cards'::text, 'Skill Cards'::text),
      ('quizzes'::text, 'Quizzes'::text),
      ('reflections'::text, 'Reflections'::text),
      ('daily_prompts'::text, 'Daily Prompts'::text)
    ) AS x(item_type, label)
  ), grouped AS (
    SELECT k.item_type, k.label,
      count(i.item_id)::integer AS required_units,
      count(i.item_id) FILTER (WHERE i.due_on IS NOT NULL AND i.due_on <= p_as_of)::integer AS due_units,
      count(i.item_id) FILTER (WHERE i.completed AND i.due_on IS NOT NULL AND i.due_on <= p_as_of)::integer AS completed_due_units,
      count(i.item_id) FILTER (WHERE i.completed)::integer AS completed_units,
      max(i.due_on) AS last_due_on
    FROM keys k
    LEFT JOIN items i ON i.item_type = k.item_type
    GROUP BY k.item_type, k.label
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'key', g.item_type,
    'label', g.label,
    'required_units', g.required_units,
    'due_units', g.due_units,
    'completed_units', least(g.completed_units, g.required_units),
    'overdue_units', greatest(0, g.due_units - least(g.completed_due_units, g.due_units)),
    'progress_available', g.required_units > 0,
    'status', CASE
      WHEN g.required_units = 0 THEN 'unavailable'
      WHEN g.completed_units >= g.required_units THEN 'completed'
      WHEN g.due_units = 0 THEN 'upcoming'
      WHEN g.completed_due_units >= g.due_units THEN 'current'
      ELSE 'overdue'
    END
  ) ORDER BY k_order.ord), '[]'::jsonb)
  FROM grouped g
  JOIN (VALUES ('skill_cards', 1), ('quizzes', 2), ('reflections', 3), ('daily_prompts', 4)) AS k_order(item_type, ord)
    ON k_order.item_type = g.item_type;
$function$;

-- ---------------------------------------------------------------------------
-- 14. Admin: read and edit one date per requirement
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_cohort_requirement_schedule(p_cohort_id uuid)
RETURNS TABLE (
  requirement_id uuid, programme_id uuid, programme_name text, module public.programme_module_type,
  requirement_index integer, requirement_label text, training_week_id uuid, week_number integer,
  due_on date, default_due_on date, is_overridden boolean, has_activity boolean
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Only admins can review cohort requirement dates' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT d.id, d.programme_id, p.name, d.module, d.ordinal,
    public.cohort_requirement_label(d.module, d.ordinal, tw.week_number, tw.title),
    d.training_week_id, tw.week_number, d.due_on,
    CASE WHEN d.module = 'training'::public.programme_module_type THEN w.default_due_on
      ELSE dl.completion_deadline END,
    d.is_overridden,
    public.cohort_requirement_is_referenced(d.id)
  FROM public.cohort_requirement_dates d
  JOIN public.programmes p ON p.id = d.programme_id
  LEFT JOIN public.training_weeks tw ON tw.id = d.training_week_id
  LEFT JOIN public.cohort_module_deadlines dl
    ON dl.cohort_id = d.cohort_id AND dl.programme_id = d.programme_id AND dl.module = d.module
  LEFT JOIN public.cohort_training_requirement_weeks(p_cohort_id) w
    ON w.programme_id = d.programme_id AND w.training_week_id = d.training_week_id
  WHERE d.cohort_id = p_cohort_id
  ORDER BY p.name,
    array_position(ARRAY['training','coaching','mentoring','peer_coaching','triads']::text[], d.module::text),
    d.module, d.ordinal;
END;
$$;

-- p_items: [{"requirement_id": uuid, "due_on": "YYYY-MM-DD" | null}]
--   a date  -> that requirement keeps this date (is_overridden)
--   null    -> the requirement returns to its default and follows it again
CREATE OR REPLACE FUNCTION public.admin_set_cohort_requirement_dates(p_cohort_id uuid, p_items jsonb)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  c public.cohorts;
  saved integer := 0;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Only admins can set cohort requirement dates' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO c FROM public.cohorts WHERE id = p_cohort_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cohort not found' USING ERRCODE = 'P0002';
  END IF;
  IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Requirement dates must be a JSON array' USING ERRCODE = '22023';
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS pg_temp.crd_items (requirement_id uuid, due_on date) ON COMMIT DROP;
  TRUNCATE pg_temp.crd_items;
  INSERT INTO pg_temp.crd_items
  SELECT (x->>'requirement_id')::uuid, NULLIF(x->>'due_on', '')::date
  FROM jsonb_array_elements(p_items) x;

  IF EXISTS (SELECT 1 FROM pg_temp.crd_items i WHERE i.requirement_id IS NULL) THEN
    RAISE EXCEPTION 'Every item needs a requirement_id' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_temp.crd_items i GROUP BY i.requirement_id HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'A requirement can appear only once' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_temp.crd_items i
    WHERE NOT EXISTS (SELECT 1 FROM public.cohort_requirement_dates d
                      WHERE d.id = i.requirement_id AND d.cohort_id = p_cohort_id)
  ) THEN
    RAISE EXCEPTION 'Every requirement must belong to this cohort' USING ERRCODE = '22023';
  END IF;
  IF c.start_date IS NOT NULL AND c.end_date IS NOT NULL AND EXISTS (
    SELECT 1 FROM pg_temp.crd_items i
    WHERE i.due_on IS NOT NULL AND (i.due_on < c.start_date OR i.due_on > c.end_date)
  ) THEN
    RAISE EXCEPTION 'Requirement dates must fall within the cohort dates (% - %)', c.start_date, c.end_date
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.cohort_requirement_dates d
  SET due_on = coalesce(i.due_on, d.due_on),
      is_overridden = i.due_on IS NOT NULL,
      generation_method = CASE WHEN i.due_on IS NOT NULL THEN 'manual'
        WHEN d.module = 'training'::public.programme_module_type THEN 'training_week'
        ELSE 'module_deadline' END,
      materialized_via = CASE WHEN i.due_on IS NOT NULL THEN 'admin_save' ELSE d.materialized_via END,
      updated_by = auth.uid()
  FROM pg_temp.crd_items i
  WHERE d.id = i.requirement_id;
  GET DIAGNOSTICS saved = ROW_COUNT;

  -- Reset rows pick their default back up.
  PERFORM public.sync_cohort_requirement_dates(p_cohort_id);
  PERFORM public.admin_assert_cohort_schedule(p_cohort_id);
  RETURN saved;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_cohort_requirement_schedule(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_set_cohort_requirement_dates(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_cohort_requirement_schedule(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_cohort_requirement_dates(uuid, jsonb) TO authenticated;

COMMENT ON FUNCTION public.admin_set_cohort_module_deadlines(uuid, jsonb) IS
  'Admin writer of the DEFAULT completion deadline per cohort x session module. Requirements that no Admin has dated '
  'individually follow it; per-requirement dates are set with admin_set_cohort_requirement_dates (20260928100000).';

-- ---------------------------------------------------------------------------
-- 15. Role wrappers over the calendar (same rows; role decides visibility)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_enrollment_requirement_calendar(p_enrollment_id uuid, p_as_of date DEFAULT CURRENT_DATE)
RETURNS TABLE (
  enrollment_id uuid, programme_id uuid, cohort_id uuid, organization_id uuid,
  module public.programme_module_type, requirement_id uuid, requirement_index integer,
  requirement_label text, training_week_id uuid, due_on date, is_required boolean,
  is_due_as_of boolean, is_completed boolean, completed_on date, is_overdue boolean, completion_source text
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT c.* FROM public.canonical_enrollment_requirement_calendar(p_enrollment_id, p_as_of) c
  WHERE public.has_role(auth.uid(), 'admin'::public.app_role);
$$;

CREATE OR REPLACE FUNCTION public.learner_requirement_calendar(p_enrollment_id uuid, p_as_of date DEFAULT CURRENT_DATE)
RETURNS TABLE (
  enrollment_id uuid, programme_id uuid, cohort_id uuid, organization_id uuid,
  module public.programme_module_type, requirement_id uuid, requirement_index integer,
  requirement_label text, training_week_id uuid, due_on date, is_required boolean,
  is_due_as_of boolean, is_completed boolean, completed_on date, is_overdue boolean, completion_source text
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT c.* FROM public.canonical_enrollment_requirement_calendar(p_enrollment_id, p_as_of) c
  WHERE EXISTS (SELECT 1 FROM public.programme_enrollments e WHERE e.id = p_enrollment_id AND e.user_id = auth.uid());
$$;

CREATE OR REPLACE FUNCTION public.sponsor_leader_requirement_calendar(p_enrollment_id uuid, p_as_of date DEFAULT CURRENT_DATE)
RETURNS TABLE (
  enrollment_id uuid, programme_id uuid, cohort_id uuid, organization_id uuid,
  module public.programme_module_type, requirement_id uuid, requirement_index integer,
  requirement_label text, training_week_id uuid, due_on date, is_required boolean,
  is_due_as_of boolean, is_completed boolean, completed_on date, is_overdue boolean, completion_source text
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT c.* FROM public.canonical_enrollment_requirement_calendar(p_enrollment_id, p_as_of) c
  WHERE public.sponsor_can_view_enrollment(p_enrollment_id);
$$;

REVOKE ALL ON FUNCTION public.admin_enrollment_requirement_calendar(uuid, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.learner_requirement_calendar(uuid, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.sponsor_leader_requirement_calendar(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_enrollment_requirement_calendar(uuid, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.learner_requirement_calendar(uuid, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sponsor_leader_requirement_calendar(uuid, date) TO authenticated;

REVOKE ALL ON FUNCTION public.cohort_training_requirement_weeks(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_training_requirements_from_week_override() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_training_requirements_from_week() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 16. Final-state guard
-- ---------------------------------------------------------------------------
DO $verify$
DECLARE bad text;
BEGIN
  SELECT string_agg(format('%s/%s: %s', v.cohort_id, v.module, v.violation), '; ') INTO bad
  FROM public.cohort_schedule_violations() v
  WHERE v.violation NOT IN ('missing_deadline');
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'requirement calendar: schedule violations after backfill: %', bad;
  END IF;

  -- Every selected week of every cohort maps to exactly one Training requirement
  -- (or is pending because it has no date at all).
  SELECT string_agg(format('%s/%s', c.id, w.training_week_id), '; ') INTO bad
  FROM public.cohorts c
  CROSS JOIN LATERAL public.cohort_training_requirement_weeks(c.id) w
  WHERE w.default_due_on IS NOT NULL
    AND (SELECT count(*) FROM public.cohort_requirement_dates d
         WHERE d.cohort_id = c.id AND d.programme_id = w.programme_id
           AND d.module = 'training' AND d.training_week_id = w.training_week_id) <> 1;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'requirement calendar: selected weeks without exactly one requirement: %', bad;
  END IF;
END
$verify$;
