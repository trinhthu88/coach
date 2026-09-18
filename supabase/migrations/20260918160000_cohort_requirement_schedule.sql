-- Canonical cohort requirement schedule.
--
-- Before: the programme scheduling policy (programme_modules.config
-- distribution_mode / distribution_settings) was re-interpreted on every
-- read by sponsor_canonical_module_schedule(enrollment), using the cohort's
-- current start/end dates. Every Learner / Sponsor journey, progress and
-- overdue figure therefore depended on a live recalculation of the template.
--
-- After:
--   programme_modules.config      = WHAT is required + DEFAULT scheduling policy (template)
--   cohort_requirement_dates      = WHEN each required unit is due for this cohort (canonical)
--   sponsor_canonical_module_schedule reads the stored cohort dates; it no longer
--   interprets the policy. Training / Learning keeps its existing cohort-dated
--   source (training_weeks.unlock_date + cohort_week_overrides via
--   canonical_training_learning_items), unchanged.
--
-- The policy is applied only to PROPOSE dates (cohort_requirement_schedule_proposal)
-- and to fill requirement dates that do not exist yet. Existing cohort dates are
-- never rewritten by template edits, cohort date edits or enrollment changes;
-- only an explicit Admin save / "Regenerate schedule" changes them.
--
-- Backfill: dates are copied from the CURRENT live schedule output, and the
-- migration asserts that every enrollment's schedule is identical before and
-- after the switch, so no visible journey changes.

-- ---------------------------------------------------------------------------
-- 1. Storage
-- ---------------------------------------------------------------------------
CREATE TABLE public.cohort_requirement_dates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cohort_id uuid NOT NULL REFERENCES public.cohorts(id) ON DELETE CASCADE,
  -- The programme whose requirement this date schedules. Normally the
  -- cohort's programme; a cohort without a programme schedules each
  -- enrolled programme (the pre-existing behaviour used the enrollment's
  -- programme with the cohort's dates).
  programme_id uuid NOT NULL REFERENCES public.programmes(id) ON DELETE CASCADE,
  module public.programme_module_type NOT NULL
    CHECK (module <> 'training'::public.programme_module_type),
  ordinal integer NOT NULL CHECK (ordinal > 0),
  due_on date NOT NULL,
  units integer NOT NULL DEFAULT 1 CHECK (units > 0),
  training_week_id uuid REFERENCES public.training_weeks(id) ON DELETE SET NULL,
  -- Which programme policy produced the proposed date.
  generation_method text NOT NULL
    CHECK (generation_method IN ('evenly_distributed', 'monthly_frequency', 'training_linked', 'custom', 'flexible', 'manual')),
  -- How the row was created: migration backfill, automatic fill of a missing
  -- requirement, or an explicit Admin regeneration / save.
  materialized_via text NOT NULL
    CHECK (materialized_via IN ('backfill', 'auto_fill', 'admin_regenerate', 'admin_save')),
  -- The policy-generated date at materialization time; is_overridden is true
  -- when an Admin saved a different date.
  generated_due_on date,
  is_overridden boolean NOT NULL DEFAULT false,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cohort_id, programme_id, module, ordinal)
);

CREATE INDEX cohort_requirement_dates_cohort_idx
  ON public.cohort_requirement_dates (cohort_id, programme_id, module, due_on);

COMMENT ON TABLE public.cohort_requirement_dates IS
  'Canonical cohort requirement due dates (one row per scheduled requirement unit). Read by sponsor_canonical_module_schedule for every role. Policy only proposes; this table owns the dates.';

ALTER TABLE public.cohort_requirement_dates ENABLE ROW LEVEL SECURITY;

-- Admin reads/writes directly; every other role reads dates only through the
-- canonical SECURITY DEFINER projections (journey / progress functions).
CREATE POLICY "Cohort requirement dates: admin manage"
  ON public.cohort_requirement_dates
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

REVOKE ALL ON public.cohort_requirement_dates FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cohort_requirement_dates TO authenticated;

CREATE TRIGGER trg_cohort_requirement_dates_updated
  BEFORE UPDATE ON public.cohort_requirement_dates
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. Policy → proposed dates (the single implementation of the scheduling
--    policy; the same expressions the live schedule used until now)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cohort_requirement_proposal_internal(
  p_programme_id uuid,
  p_cohort_id uuid,
  p_start date,
  p_end date
)
RETURNS TABLE (
  module public.programme_module_type,
  ordinal integer,
  due_on date,
  units integer,
  training_week_id uuid,
  generation_method text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH configured_modules AS (
    SELECT pm.module,
      CASE
        WHEN coalesce((pm.config->>'required')::boolean, false)
        THEN coalesce(public.programme_config_integer(pm.config, 'required_units'), 0)
        ELSE 0
      END AS required_units,
      coalesce(nullif(pm.config->>'distribution_mode', ''), 'flexible') AS distribution_mode,
      coalesce(pm.config->'distribution_settings', '{}'::jsonb) AS distribution_settings
    FROM public.programme_modules pm
    WHERE pm.programme_id = p_programme_id
      AND pm.enabled
      AND pm.module <> 'training'::public.programme_module_type
  ), items AS (
    SELECT cm.module, p_end AS due_on, cm.required_units AS units,
      NULL::uuid AS training_week_id, cm.distribution_mode, 1::bigint AS sort_key
    FROM configured_modules cm
    WHERE cm.required_units > 0 AND cm.distribution_mode = 'flexible'

    UNION ALL
    SELECT cm.module,
      p_start + CASE
        WHEN units.sequence_no = cm.required_units THEN p_end - p_start
        WHEN p_end > p_start
        THEN greatest(1, ((p_end - p_start) * units.sequence_no / cm.required_units))
        ELSE 0
      END,
      1, NULL::uuid, cm.distribution_mode, units.sequence_no::bigint
    FROM configured_modules cm
    CROSS JOIN LATERAL generate_series(1, cm.required_units) AS units(sequence_no)
    WHERE cm.required_units > 0 AND cm.distribution_mode = 'evenly_distributed'

    UNION ALL
    SELECT cm.module,
      least(
        p_end,
        (p_start + ((units.sequence_no - 1)
          * coalesce(public.programme_config_integer(cm.distribution_settings, 'interval_months'), 1)
          * interval '1 month'))::date
      ),
      1, NULL::uuid, cm.distribution_mode, units.sequence_no::bigint
    FROM configured_modules cm
    CROSS JOIN LATERAL generate_series(1, cm.required_units) AS units(sequence_no)
    WHERE cm.required_units > 0 AND cm.distribution_mode = 'monthly_frequency'

    UNION ALL
    SELECT cm.module,
      NULLIF(custom.entry->>'due_on', '')::date,
      coalesce(public.programme_config_integer(custom.entry, 'required_units'), 1),
      NULL::uuid, cm.distribution_mode, custom.entry_order
    FROM configured_modules cm
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(cm.distribution_settings->'milestones') = 'array'
        THEN cm.distribution_settings->'milestones' ELSE '[]'::jsonb END
    ) WITH ORDINALITY AS custom(entry, entry_order)
    WHERE cm.required_units > 0 AND cm.distribution_mode = 'custom'

    UNION ALL
    SELECT cm.module,
      least(
        p_end,
        coalesce(
          cwo.unlock_date,
          coalesce(tw.unlock_date,
            (p_start + ((tw.week_number - 1) * interval '7 days'))::date)
        )
      ),
      1, tw.id, cm.distribution_mode, selected.selection_order
    FROM configured_modules cm
    CROSS JOIN LATERAL jsonb_array_elements_text(
      CASE WHEN jsonb_typeof(cm.distribution_settings->'training_week_ids') = 'array'
        THEN cm.distribution_settings->'training_week_ids' ELSE '[]'::jsonb END
    ) WITH ORDINALITY AS selected(week_id, selection_order)
    JOIN public.training_weeks tw
      ON tw.programme_id = p_programme_id
     AND tw.id::text = selected.week_id
    LEFT JOIN public.cohort_week_overrides cwo
      ON cwo.cohort_id = p_cohort_id
     AND cwo.training_week_id = tw.id
    WHERE cm.required_units > 0
      AND cm.distribution_mode = 'training_linked'
      AND selected.selection_order <= cm.required_units
  )
  SELECT i.module,
    row_number() OVER (PARTITION BY i.module ORDER BY i.due_on, i.sort_key)::integer,
    i.due_on, i.units, i.training_week_id, i.distribution_mode
  FROM items i
  WHERE p_start IS NOT NULL
    AND p_end IS NOT NULL
    AND i.due_on IS NOT NULL;
$$;

REVOKE ALL ON FUNCTION public.cohort_requirement_proposal_internal(uuid, uuid, date, date) FROM PUBLIC, anon, authenticated;

-- Admin-facing proposal (cohort create dialog / "Regenerate schedule" review).
-- Pure: never writes.
CREATE OR REPLACE FUNCTION public.cohort_requirement_schedule_proposal(
  p_programme_id uuid,
  p_start date,
  p_end date,
  p_cohort_id uuid DEFAULT NULL
)
RETURNS TABLE (
  programme_id uuid,
  module public.programme_module_type,
  ordinal integer,
  due_on date,
  units integer,
  training_week_id uuid,
  generation_method text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Only admins can preview cohort requirement schedules' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT p_programme_id, p.module, p.ordinal, p.due_on, p.units, p.training_week_id, p.generation_method
  FROM public.cohort_requirement_proposal_internal(p_programme_id, p_cohort_id, p_start, p_end) p
  ORDER BY p.module, p.ordinal;
END;
$$;

REVOKE ALL ON FUNCTION public.cohort_requirement_schedule_proposal(uuid, date, date, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cohort_requirement_schedule_proposal(uuid, date, date, uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. Materialize MISSING requirement dates only (never rewrites)
-- ---------------------------------------------------------------------------
-- The programmes a cohort schedules: its own programme, plus any programme
-- its enrollments belong to (cohorts without a programme).
CREATE OR REPLACE FUNCTION public.cohort_scheduled_programmes(p_cohort_id uuid)
RETURNS TABLE (programme_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT c.programme_id FROM public.cohorts c WHERE c.id = p_cohort_id AND c.programme_id IS NOT NULL
  UNION
  SELECT e.programme_id FROM public.programme_enrollments e
  WHERE e.cohort_id = p_cohort_id AND e.programme_id IS NOT NULL;
$$;

REVOKE ALL ON FUNCTION public.cohort_scheduled_programmes(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.materialize_missing_cohort_requirement_dates(p_cohort_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  c public.cohorts;
  inserted integer;
BEGIN
  SELECT * INTO c FROM public.cohorts WHERE id = p_cohort_id;
  IF NOT FOUND OR c.start_date IS NULL OR c.end_date IS NULL THEN
    RETURN 0;
  END IF;

  -- A (cohort, programme, module) that already has ANY dates is left alone:
  -- template edits, cohort date edits and enrollment changes never rewrite an
  -- existing schedule. Only modules with no dates at all are filled.
  INSERT INTO public.cohort_requirement_dates (
    cohort_id, programme_id, module, ordinal, due_on, units, training_week_id,
    generation_method, materialized_via, generated_due_on
  )
  SELECT p_cohort_id, sp.programme_id, p.module, p.ordinal, p.due_on, p.units, p.training_week_id,
    p.generation_method, 'auto_fill', p.due_on
  FROM public.cohort_scheduled_programmes(p_cohort_id) sp
  CROSS JOIN LATERAL public.cohort_requirement_proposal_internal(sp.programme_id, p_cohort_id, c.start_date, c.end_date) p
  WHERE NOT EXISTS (
    SELECT 1 FROM public.cohort_requirement_dates existing
    WHERE existing.cohort_id = p_cohort_id
      AND existing.programme_id = sp.programme_id
      AND existing.module = p.module
  )
  ON CONFLICT (cohort_id, programme_id, module, ordinal) DO NOTHING;

  GET DIAGNOSTICS inserted = ROW_COUNT;
  RETURN inserted;
END;
$$;

REVOKE ALL ON FUNCTION public.materialize_missing_cohort_requirement_dates(uuid) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Admin: save individual dates / explicit regeneration / validation
-- ---------------------------------------------------------------------------
-- p_items: [{ "programme_id", "module", "ordinal", "due_on" }, ...]
--   Default: updates only the listed (programme, module, ordinal) dates.
--   p_regenerate = true: explicit "Regenerate schedule" — replaces every
--   date of the listed (programme, module) pairs with the listed rows.
CREATE OR REPLACE FUNCTION public.admin_save_cohort_requirement_dates(
  p_cohort_id uuid,
  p_items jsonb,
  p_regenerate boolean DEFAULT false
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  c public.cohorts;
  item record;
  proposal record;
  saved integer := 0;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Only admins can edit cohort requirement dates' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO c FROM public.cohorts WHERE id = p_cohort_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cohort not found' USING ERRCODE = 'P0002';
  END IF;
  IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Requirement dates must be a JSON array' USING ERRCODE = '22023';
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS pg_temp.crd_items (
    programme_id uuid, module public.programme_module_type, ordinal integer, due_on date
  ) ON COMMIT DROP;
  TRUNCATE pg_temp.crd_items;

  INSERT INTO pg_temp.crd_items
  SELECT (x->>'programme_id')::uuid,
    (x->>'module')::public.programme_module_type,
    (x->>'ordinal')::integer,
    (x->>'due_on')::date
  FROM jsonb_array_elements(p_items) x;

  IF EXISTS (SELECT 1 FROM pg_temp.crd_items i
             WHERE i.programme_id IS NULL OR i.module IS NULL OR i.ordinal IS NULL OR i.ordinal < 1) THEN
    RAISE EXCEPTION 'Each requirement date needs a programme, module and unit number' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_temp.crd_items i WHERE i.due_on IS NULL) THEN
    RAISE EXCEPTION 'Every requirement needs a due date' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_temp.crd_items i GROUP BY i.programme_id, i.module, i.ordinal HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'Duplicate requirement unit numbers' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_temp.crd_items i
    WHERE i.programme_id NOT IN (SELECT sp.programme_id FROM public.cohort_scheduled_programmes(p_cohort_id) sp)
  ) THEN
    RAISE EXCEPTION 'Requirement dates must belong to the cohort''s programme' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_temp.crd_items i
    WHERE i.module = 'training'::public.programme_module_type
       OR NOT EXISTS (
         SELECT 1 FROM public.programme_modules pm
         WHERE pm.programme_id = i.programme_id
           AND pm.module = i.module
           AND pm.enabled
           AND coalesce((pm.config->>'required')::boolean, false)
           AND coalesce(public.programme_config_integer(pm.config, 'required_units'), 0) > 0
       )
  ) THEN
    RAISE EXCEPTION 'Requirement dates must match the programme''s required modules' USING ERRCODE = '22023';
  END IF;
  IF c.start_date IS NOT NULL AND c.end_date IS NOT NULL AND EXISTS (
    SELECT 1 FROM pg_temp.crd_items i WHERE i.due_on < c.start_date OR i.due_on > c.end_date
  ) THEN
    RAISE EXCEPTION 'Requirement dates must fall within the cohort dates (% – %)', c.start_date, c.end_date
      USING ERRCODE = '22023';
  END IF;

  IF p_regenerate THEN
    DELETE FROM public.cohort_requirement_dates d
    USING (SELECT DISTINCT i.programme_id, i.module FROM pg_temp.crd_items i) pairs
    WHERE d.cohort_id = p_cohort_id
      AND d.programme_id = pairs.programme_id
      AND d.module = pairs.module;

    INSERT INTO public.cohort_requirement_dates (
      cohort_id, programme_id, module, ordinal, due_on, units, training_week_id,
      generation_method, materialized_via, generated_due_on, is_overridden, updated_by
    )
    SELECT p_cohort_id, i.programme_id, i.module, i.ordinal, i.due_on,
      coalesce(p.units, 1), p.training_week_id,
      coalesce(p.generation_method, 'manual'), 'admin_regenerate', p.due_on,
      p.due_on IS DISTINCT FROM i.due_on, auth.uid()
    FROM pg_temp.crd_items i
    LEFT JOIN LATERAL (
      SELECT pr.* FROM public.cohort_requirement_proposal_internal(i.programme_id, p_cohort_id, c.start_date, c.end_date) pr
      WHERE pr.module = i.module AND pr.ordinal = i.ordinal
    ) p ON true;
    GET DIAGNOSTICS saved = ROW_COUNT;
    RETURN saved;
  END IF;

  FOR item IN SELECT * FROM pg_temp.crd_items LOOP
    UPDATE public.cohort_requirement_dates d
    SET due_on = item.due_on,
      is_overridden = d.generated_due_on IS DISTINCT FROM item.due_on,
      updated_by = auth.uid()
    WHERE d.cohort_id = p_cohort_id
      AND d.programme_id = item.programme_id
      AND d.module = item.module
      AND d.ordinal = item.ordinal;

    IF NOT FOUND THEN
      -- A unit that has no date yet (e.g. required units increased): add it,
      -- recording the policy date it would have had.
      SELECT pr.* INTO proposal
      FROM public.cohort_requirement_proposal_internal(item.programme_id, p_cohort_id, c.start_date, c.end_date) pr
      WHERE pr.module = item.module AND pr.ordinal = item.ordinal;

      INSERT INTO public.cohort_requirement_dates (
        cohort_id, programme_id, module, ordinal, due_on, units, training_week_id,
        generation_method, materialized_via, generated_due_on, is_overridden, updated_by
      ) VALUES (
        p_cohort_id, item.programme_id, item.module, item.ordinal, item.due_on,
        coalesce(proposal.units, 1), proposal.training_week_id,
        coalesce(proposal.generation_method, 'manual'), 'admin_save', proposal.due_on,
        proposal.due_on IS DISTINCT FROM item.due_on, auth.uid()
      );
    END IF;
    saved := saved + 1;
  END LOOP;
  RETURN saved;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_save_cohort_requirement_dates(uuid, jsonb, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_save_cohort_requirement_dates(uuid, jsonb, boolean) TO authenticated;

-- Schedule health for the Admin cohort view: missing / surplus dates, dates
-- outside the cohort, modules no longer in programme scope.
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
    SELECT sp.programme_id, pm.module,
      coalesce(public.programme_config_integer(pm.config, 'required_units'), 0) AS required_units
    FROM public.cohort_scheduled_programmes(p_cohort_id) sp
    JOIN public.programme_modules pm
      ON pm.programme_id = sp.programme_id
     AND pm.enabled
     AND pm.module <> 'training'::public.programme_module_type
     AND coalesce((pm.config->>'required')::boolean, false)
    WHERE coalesce(public.programme_config_integer(pm.config, 'required_units'), 0) > 0
  ), scheduled AS (
    SELECT d.programme_id, d.module, sum(d.units)::integer AS units,
      bool_or(d.due_on < co.start_date OR d.due_on > co.end_date) AS outside
    FROM public.cohort_requirement_dates d
    CROSS JOIN cohort co
    WHERE d.cohort_id = p_cohort_id
    GROUP BY d.programme_id, d.module
  )
  SELECT s.programme_id, s.module, 'missing_dates', s.required_units, coalesce(sc.units, 0)
  FROM scope s LEFT JOIN scheduled sc ON sc.programme_id = s.programme_id AND sc.module = s.module
  WHERE coalesce(sc.units, 0) < s.required_units
  UNION ALL
  SELECT s.programme_id, s.module, 'surplus_dates', s.required_units, sc.units
  FROM scope s JOIN scheduled sc ON sc.programme_id = s.programme_id AND sc.module = s.module
  WHERE sc.units > s.required_units
  UNION ALL
  SELECT sc.programme_id, sc.module, 'outside_cohort', s.required_units, sc.units
  FROM scheduled sc LEFT JOIN scope s ON s.programme_id = sc.programme_id AND s.module = sc.module
  WHERE sc.outside
  UNION ALL
  SELECT sc.programme_id, sc.module, 'out_of_scope', NULL::integer, sc.units
  FROM scheduled sc
  WHERE NOT EXISTS (SELECT 1 FROM scope s WHERE s.programme_id = sc.programme_id AND s.module = sc.module);
END;
$$;

REVOKE ALL ON FUNCTION public.cohort_requirement_schedule_issues(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cohort_requirement_schedule_issues(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 5. Backfill from the CURRENT live schedule, then switch the canonical
--    schedule to read the stored dates, and prove nothing visible changed.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE crd_schedule_before ON COMMIT DROP AS
SELECT e.id AS enrollment_id, s.module, s.required_units, s.due_on, s.milestone_units, s.training_week_id
FROM public.programme_enrollments e
CROSS JOIN LATERAL public.sponsor_canonical_module_schedule(e.id) s;

-- One representative enrollment per (cohort, programme) supplies the exact
-- dates the live schedule currently shows for that pair.
INSERT INTO public.cohort_requirement_dates (
  cohort_id, programme_id, module, ordinal, due_on, units, training_week_id,
  generation_method, materialized_via, generated_due_on
)
SELECT rep.cohort_id, rep.programme_id, s.module,
  row_number() OVER (PARTITION BY rep.cohort_id, rep.programme_id, s.module ORDER BY s.due_on, s.training_week_id)::integer,
  s.due_on, s.milestone_units, s.training_week_id,
  coalesce(nullif(pm.config->>'distribution_mode', ''), 'flexible'),
  'backfill', s.due_on
FROM (
  SELECT DISTINCT ON (e.cohort_id, e.programme_id) e.id, e.cohort_id, e.programme_id
  FROM public.programme_enrollments e
  WHERE e.cohort_id IS NOT NULL AND e.programme_id IS NOT NULL
  ORDER BY e.cohort_id, e.programme_id, e.id
) rep
JOIN crd_schedule_before s ON s.enrollment_id = rep.id
JOIN public.programme_modules pm ON pm.programme_id = rep.programme_id AND pm.module = s.module AND pm.enabled
WHERE s.module <> 'training'::public.programme_module_type
  AND s.due_on IS NOT NULL
  AND s.milestone_units > 0;

-- Cohorts (or cohort programmes) with no enrollment yet: materialize the
-- same policy dates directly.
SELECT public.materialize_missing_cohort_requirement_dates(c.id) FROM public.cohorts c;

CREATE OR REPLACE FUNCTION public.sponsor_canonical_module_schedule(
  p_enrollment_id uuid
)
RETURNS TABLE (
  module public.programme_module_type,
  required_units integer,
  due_on date,
  milestone_units integer,
  training_week_id uuid
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  -- Requirement SCOPE comes from the programme; requirement DATES come from
  -- the cohort's canonical schedule (cohort_requirement_dates). No policy is
  -- interpreted here.
  WITH enrollment AS (
    SELECT e.programme_id, e.cohort_id
    FROM public.programme_enrollments e
    JOIN public.cohorts c ON c.id = e.cohort_id
    WHERE e.id = p_enrollment_id
  ), configured_modules AS (
    SELECT pm.module,
      CASE
        WHEN coalesce((pm.config->>'required')::boolean, false)
        THEN coalesce(public.programme_config_integer(pm.config, 'required_units'), 0)
        ELSE 0
      END AS required_units,
      e.programme_id, e.cohort_id
    FROM enrollment e
    JOIN public.programme_modules pm
      ON pm.programme_id = e.programme_id
     AND pm.enabled
     AND pm.module <> 'training'::public.programme_module_type
  )
  SELECT cm.module, cm.required_units, NULL::date, 0, NULL::uuid
  FROM configured_modules cm
  WHERE cm.required_units > 0

  UNION ALL
  SELECT cm.module, cm.required_units, d.due_on, d.units, d.training_week_id
  FROM configured_modules cm
  JOIN public.cohort_requirement_dates d
    ON d.cohort_id = cm.cohort_id
   AND d.programme_id = cm.programme_id
   AND d.module = cm.module
  WHERE cm.required_units > 0

  UNION ALL
  SELECT 'training'::public.programme_module_type,
    sum(i.required_units) OVER ()::integer,
    i.due_on,
    i.required_units,
    i.training_week_id
  FROM public.canonical_training_learning_items(p_enrollment_id, current_date) i;
$$;

REVOKE ALL ON FUNCTION public.sponsor_canonical_module_schedule(uuid) FROM PUBLIC, anon, authenticated;

DO $verify$
DECLARE
  differences integer;
BEGIN
  WITH after AS (
    SELECT e.id AS enrollment_id, s.module, s.required_units, s.due_on, s.milestone_units, s.training_week_id
    FROM public.programme_enrollments e
    CROSS JOIN LATERAL public.sponsor_canonical_module_schedule(e.id) s
  ), before_rows AS (
    SELECT * FROM crd_schedule_before WHERE due_on IS NOT NULL OR milestone_units = 0
  ), a AS (
    (SELECT * FROM before_rows EXCEPT ALL SELECT * FROM after)
    UNION ALL
    (SELECT * FROM after EXCEPT ALL SELECT * FROM before_rows)
  )
  SELECT count(*) INTO differences FROM a;

  IF differences > 0 THEN
    RAISE EXCEPTION 'Cohort requirement backfill would change % canonical schedule rows', differences;
  END IF;
END
$verify$;

-- ---------------------------------------------------------------------------
-- 6. Fill-missing triggers (never rewrite existing dates)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_cohort_requirement_fill_from_cohort()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.materialize_missing_cohort_requirement_dates(NEW.id);
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_cohorts_fill_requirement_dates
  AFTER INSERT OR UPDATE OF programme_id, start_date, end_date ON public.cohorts
  FOR EACH ROW EXECUTE FUNCTION public.trg_cohort_requirement_fill_from_cohort();

CREATE OR REPLACE FUNCTION public.trg_cohort_requirement_fill_from_enrollment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.cohort_id IS NOT NULL THEN
    PERFORM public.materialize_missing_cohort_requirement_dates(NEW.cohort_id);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_enrollments_fill_requirement_dates
  AFTER INSERT OR UPDATE OF cohort_id, programme_id ON public.programme_enrollments
  FOR EACH ROW EXECUTE FUNCTION public.trg_cohort_requirement_fill_from_enrollment();

CREATE OR REPLACE FUNCTION public.trg_cohort_requirement_fill_from_programme_module()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Only modules that have no dates yet in a cohort are filled; edits to a
  -- module that is already scheduled never touch that cohort's dates.
  PERFORM public.materialize_missing_cohort_requirement_dates(c.id)
  FROM public.cohorts c
  WHERE c.programme_id = NEW.programme_id
     OR EXISTS (SELECT 1 FROM public.programme_enrollments e
                WHERE e.cohort_id = c.id AND e.programme_id = NEW.programme_id);
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_programme_modules_fill_requirement_dates
  AFTER INSERT OR UPDATE OF config, enabled ON public.programme_modules
  FOR EACH ROW EXECUTE FUNCTION public.trg_cohort_requirement_fill_from_programme_module();

REVOKE ALL ON FUNCTION public.trg_cohort_requirement_fill_from_cohort() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_cohort_requirement_fill_from_enrollment() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_cohort_requirement_fill_from_programme_module() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7. ONE journey construction for Learner and Sponsor Leader Detail, and no
--    generated module-list checkpoint title.
-- ---------------------------------------------------------------------------
-- The checkpoint is the date milestone; modules live only in module_scope.
-- `label` now carries only authoritative source content (Training week
-- titles) and is NULL otherwise.
CREATE OR REPLACE FUNCTION public.canonical_enrollment_journey(
  p_enrollment_id uuid,
  p_as_of date
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH eligible AS (
    SELECT e.id, e.cohort_id
    FROM public.programme_enrollments e
    WHERE e.id = p_enrollment_id
  ), schedule AS (
    SELECT e.id AS enrollment_id, s.module, s.required_units,
      s.due_on, s.milestone_units, s.training_week_id
    FROM eligible e
    CROSS JOIN LATERAL public.sponsor_canonical_module_schedule(e.id) s
    WHERE s.due_on IS NOT NULL
  ), activity AS (
    SELECT e.id AS enrollment_id, a.module, a.occurred_on, a.status
    FROM eligible e
    CROSS JOIN LATERAL public.sponsor_canonical_activity(e.id) a
  ), dates AS (
    SELECT s.due_on,
      string_agg(DISTINCT tw.title, ' · ' ORDER BY tw.title)
        FILTER (WHERE tw.title IS NOT NULL) AS training_label,
      to_jsonb(array_agg(DISTINCT s.module::text ORDER BY s.module::text)) AS module_scope
    FROM schedule s
    LEFT JOIN public.training_weeks tw ON tw.id = s.training_week_id
    GROUP BY s.due_on
  ), scoped_modules AS (
    SELECT d.due_on, e.id AS enrollment_id, s.module,
      least(max(s.required_units), sum(s.milestone_units))::integer AS required_units
    FROM dates d
    CROSS JOIN eligible e
    JOIN schedule s
      ON s.enrollment_id = e.id
     AND s.due_on <= d.due_on
    GROUP BY d.due_on, e.id, s.module
  ), leader_module_checkpoints AS (
    SELECT sm.due_on, sm.enrollment_id, sm.module, sm.required_units,
      count(a.occurred_on) FILTER (
        WHERE a.status = 'completed'
          AND a.occurred_on <= least(p_as_of, sm.due_on)
      )::integer AS completed_units
    FROM scoped_modules sm
    LEFT JOIN activity a
      ON a.enrollment_id = sm.enrollment_id
     AND a.module = sm.module
    GROUP BY sm.due_on, sm.enrollment_id, sm.module, sm.required_units
  ), leader_checkpoints AS (
    SELECT d.due_on, e.id AS enrollment_id,
      coalesce(sum(l.required_units), 0)::integer AS required_units,
      coalesce(sum(least(l.completed_units, l.required_units)), 0)::integer AS completed_units
    FROM dates d
    CROSS JOIN eligible e
    LEFT JOIN leader_module_checkpoints l
      ON l.due_on = d.due_on
     AND l.enrollment_id = e.id
    GROUP BY d.due_on, e.id
  ), numbered AS (
    SELECT row_number() OVER (ORDER BY d.due_on)::integer AS checkpoint_number,
      d.due_on, d.training_label AS label, d.module_scope,
      lc.required_units, lc.completed_units
    FROM dates d
    JOIN leader_checkpoints lc ON lc.due_on = d.due_on
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'checkpoint_number', checkpoint_number,
    'due_on', due_on,
    'label', label,
    'module_scope', module_scope,
    'required_units', required_units,
    'completed_units', completed_units,
    'state', CASE
      WHEN p_as_of < due_on THEN 'upcoming'
      WHEN p_as_of = due_on THEN 'current'
      WHEN required_units > 0 AND completed_units >= required_units THEN 'completed'
      ELSE 'overdue'
    END
  ) ORDER BY due_on), '[]'::jsonb)
  FROM numbered;
$$;

REVOKE ALL ON FUNCTION public.canonical_enrollment_journey(uuid, date) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.learner_canonical_journey(
  p_enrollment_id uuid,
  p_as_of date DEFAULT current_date
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  -- Learner self-view: own enrollment only. Same construction as Sponsor.
  SELECT CASE
    WHEN EXISTS (
      SELECT 1 FROM public.programme_enrollments e
      WHERE e.id = p_enrollment_id
        AND e.user_id = auth.uid()
        AND auth.uid() IS NOT NULL
        AND e.cohort_id IS NOT NULL
    )
    THEN public.canonical_enrollment_journey(p_enrollment_id, p_as_of)
    ELSE '[]'::jsonb
  END;
$$;

CREATE OR REPLACE FUNCTION public.sponsor_canonical_leader_journey(
  p_enrollment_id uuid,
  p_as_of date DEFAULT current_date
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  -- Sponsor: own organisation's cohort, minimum-cohort-size rule unchanged.
  -- Same construction as the learner self-view.
  SELECT CASE
    WHEN EXISTS (
      SELECT 1
      FROM public.programme_enrollments e
      JOIN public.cohorts c ON c.id = e.cohort_id
      JOIN public.sponsor_profiles sp
        ON sp.organization_id = c.organization_id
       AND sp.user_id = auth.uid()
      WHERE e.id = p_enrollment_id
        AND auth.uid() IS NOT NULL
        AND (
          SELECT count(*)
          FROM public.programme_enrollments same_cohort
          WHERE same_cohort.cohort_id = e.cohort_id
        ) >= public.sponsor_min_leaders_for_distribution()
    )
    THEN public.canonical_enrollment_journey(p_enrollment_id, p_as_of)
    ELSE '[]'::jsonb
  END;
$$;

-- Cohort-level Sponsor journey: same rule — no generated module-list title.
DO $label$
DECLARE
  current_definition text;
  updated_definition text;
BEGIN
  SELECT pg_get_functiondef('public.get_sponsor_programme_journey(uuid, date)'::regprocedure)
  INTO current_definition;
  updated_definition := replace(
    current_definition,
    'coalesce(d.training_label, d.module_label) AS label',
    'd.training_label AS label'
  );
  IF updated_definition = current_definition THEN
    RAISE EXCEPTION 'Expected cohort journey label expression was not found';
  END IF;
  EXECUTE updated_definition;
END
$label$;
