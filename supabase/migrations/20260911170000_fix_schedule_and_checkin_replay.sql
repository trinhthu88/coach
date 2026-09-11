-- Keep repeated check-ins as separate immutable events. PostgreSQL generated
-- this truncated constraint name; the earlier DROP used a different name.
ALTER TABLE public.goal_checkins DROP CONSTRAINT IF EXISTS goal_checkins_goal_id_source_activity_type_source_activity__key;

-- Compare milestone totals with their snapshot, never mutable module unit counts.
-- Enrollment schedule snapshots are immutable once created. Correct schedule
-- validation/deadlines for new enrollments and make historical progress use
-- the activity's real completion/occurrence date.

CREATE OR REPLACE FUNCTION public.generate_enrollment_schedule(p_enrollment_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  e public.programme_enrollments;
  m record;
  snapshot_id uuid;
  unit_count integer;
  n integer;
  due date;
  window_end date;
  entry jsonb;
  linked_week record;
  sequence_no integer;
  custom_total integer;
  selected_count integer;
  interval_months integer;
  mode text;
  settings jsonb;
  required_flag boolean;
  weight_value numeric;
BEGIN
  SELECT * INTO e
  FROM public.programme_enrollments
  WHERE id = p_enrollment_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Enrollment not found' USING ERRCODE = 'P0001';
  END IF;
  IF e.cohort_id IS NULL OR e.end_date IS NULL THEN
    RAISE EXCEPTION 'Enrollment requires cohort and end date before schedule generation' USING ERRCODE = 'P0001';
  END IF;

  -- Serialize concurrent generation and treat the first complete transaction
  -- as the immutable enrollment snapshot. A failed first generation rolls
  -- back atomically, so it cannot leave a partial snapshot behind.  A
  -- historical partial snapshot is not safe to silently accept (or rebuild),
  -- since doing so could change identities already observed by progress APIs.
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
    SELECT *
    FROM public.programme_modules
    WHERE programme_id = e.programme_id
      AND enabled
    ORDER BY module
  LOOP
    mode := coalesce(nullif(m.config->>'distribution_mode', ''), 'flexible');
    settings := coalesce(m.config->'distribution_settings', '{}'::jsonb);

    IF mode NOT IN ('evenly_distributed', 'monthly_frequency', 'training_linked', 'custom', 'flexible') THEN
      RAISE EXCEPTION 'Unsupported module distribution mode: %', mode USING ERRCODE = 'P0001';
    END IF;
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
      enrollment_id,
      programme_module_id,
      module,
      required,
      required_units,
      distribution_mode,
      distribution_settings,
      weight,
      starts_on,
      ends_on
    )
    VALUES (
      p_enrollment_id,
      m.id,
      m.module,
      required_flag,
      unit_count,
      mode,
      settings,
      weight_value,
      e.start_date,
      e.end_date
    )
    RETURNING id INTO snapshot_id;

    IF unit_count = 0 THEN
      CONTINUE;
    END IF;

    IF mode = 'custom' THEN
      IF jsonb_typeof(settings->'milestones') IS DISTINCT FROM 'array'
         OR jsonb_array_length(settings->'milestones') = 0 THEN
        RAISE EXCEPTION 'Custom module schedules require distribution_settings.milestones' USING ERRCODE = 'P0001';
      END IF;

      sequence_no := 0;
      custom_total := 0;
      FOR entry IN SELECT value FROM jsonb_array_elements(settings->'milestones')
      LOOP
        IF jsonb_typeof(entry) IS DISTINCT FROM 'object' THEN
          RAISE EXCEPTION 'Custom milestones must be JSON objects' USING ERRCODE = 'P0001';
        END IF;

        BEGIN
          due := (entry->>'due_on')::date;
          window_end := nullif(entry->>'window_end_on', '')::date;
          n := coalesce((entry->>'required_units')::integer, 1);
        EXCEPTION
          WHEN invalid_text_representation OR datetime_field_overflow OR numeric_value_out_of_range THEN
            RAISE EXCEPTION 'Custom milestone dates and required_units must use valid values' USING ERRCODE = 'P0001';
        END;

        IF due IS NULL OR due < e.start_date OR due > e.end_date THEN
          RAISE EXCEPTION 'Custom milestone dates must fall within the enrollment dates' USING ERRCODE = 'P0001';
        END IF;
        IF window_end IS NOT NULL AND (window_end < due OR window_end > e.end_date) THEN
          RAISE EXCEPTION 'Custom milestone window must end on or after its due date and within the enrollment dates' USING ERRCODE = 'P0001';
        END IF;
        IF n <= 0 THEN
          RAISE EXCEPTION 'Custom milestone required_units must be positive' USING ERRCODE = 'P0001';
        END IF;

        sequence_no := sequence_no + 1;
        custom_total := custom_total + n;
        INSERT INTO public.enrollment_module_milestones (
          enrollment_module_snapshot_id,
          sequence,
          due_on,
          window_end_on,
          required_units
        )
        VALUES (snapshot_id, sequence_no, due, window_end, n);
      END LOOP;

      IF custom_total <> unit_count THEN
        RAISE EXCEPTION 'Custom milestone required_units must total module required_units' USING ERRCODE = 'P0001';
      END IF;

    ELSIF mode = 'training_linked' THEN
      IF jsonb_typeof(settings->'training_week_ids') IS DISTINCT FROM 'array'
         OR jsonb_array_length(settings->'training_week_ids') <> unit_count THEN
        RAISE EXCEPTION 'Training-linked module schedules require exactly required_units selected training weeks' USING ERRCODE = 'P0001';
      END IF;

      SELECT count(*)::integer INTO selected_count
      FROM public.training_weeks tw
      WHERE tw.programme_id = e.programme_id
        AND tw.id::text IN (
          SELECT value
          FROM jsonb_array_elements_text(settings->'training_week_ids')
        );

      IF selected_count <> unit_count THEN
        RAISE EXCEPTION 'Training-linked selections must belong to the enrollment programme' USING ERRCODE = 'P0001';
      END IF;

      sequence_no := 0;
      FOR linked_week IN
        SELECT
          tw.id,
          coalesce(
            cwo.unlock_date,
            (e.start_date + ((tw.week_number - 1) * interval '7 days'))::date,
            tw.unlock_date
          ) AS due_on
        FROM public.training_weeks tw
        LEFT JOIN public.cohort_week_overrides cwo
          ON cwo.cohort_id = e.cohort_id
         AND cwo.training_week_id = tw.id
        WHERE tw.programme_id = e.programme_id
          AND tw.id::text IN (
            SELECT value
            FROM jsonb_array_elements_text(settings->'training_week_ids')
          )
        ORDER BY tw.week_number, tw.id
      LOOP
        IF linked_week.due_on < e.start_date OR linked_week.due_on > e.end_date THEN
          RAISE EXCEPTION 'Training-linked milestone dates must fall within the enrollment dates' USING ERRCODE = 'P0001';
        END IF;
        sequence_no := sequence_no + 1;
        INSERT INTO public.enrollment_module_milestones (
          enrollment_module_snapshot_id,
          sequence,
          due_on,
          training_week_id,
          required_units
        )
        VALUES (snapshot_id, sequence_no, linked_week.due_on, linked_week.id, 1);
      END LOOP;

    ELSIF mode = 'monthly_frequency' THEN
      BEGIN
        interval_months := coalesce((settings->>'interval_months')::integer, 1);
      EXCEPTION
        WHEN invalid_text_representation OR numeric_value_out_of_range THEN
          RAISE EXCEPTION 'Monthly module schedules require a positive interval_months' USING ERRCODE = 'P0001';
      END;
      IF interval_months <= 0 THEN
        RAISE EXCEPTION 'Monthly module schedules require a positive interval_months' USING ERRCODE = 'P0001';
      END IF;

      FOR n IN 1..unit_count LOOP
        due := least(
          e.end_date,
          (e.start_date + ((n - 1) * interval_months * interval '1 month'))::date
        );
        INSERT INTO public.enrollment_module_milestones (
          enrollment_module_snapshot_id, sequence, due_on, required_units
        )
        VALUES (snapshot_id, n, due, 1);
      END LOOP;

    ELSIF mode = 'evenly_distributed' THEN
      FOR n IN 1..unit_count LOOP
        due := e.start_date + ((e.end_date - e.start_date) * n / unit_count);
        INSERT INTO public.enrollment_module_milestones (
          enrollment_module_snapshot_id, sequence, due_on, required_units
        )
        VALUES (snapshot_id, n, due, 1);
      END LOOP;

    ELSE
      INSERT INTO public.enrollment_module_milestones (
        enrollment_module_snapshot_id, sequence, due_on, required_units
      )
      VALUES (snapshot_id, 1, e.end_date, unit_count);
    END IF;
  END LOOP;
END;
$$;


CREATE OR REPLACE FUNCTION public.backfill_enrollment_schedule_snapshots(
  p_limit integer DEFAULT NULL
)
RETURNS TABLE (
  processed integer,
  succeeded integer,
  unresolved integer,
  skipped integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  e record;
  complete boolean;
  n_processed integer := 0;
  n_succeeded integer := 0;
  n_unresolved integer := 0;
  n_skipped integer := 0;
  failure_reason text;
BEGIN
  IF auth.uid() IS NULL
     OR NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Only an administrator can backfill enrollment schedules'
      USING ERRCODE = '42501';
  END IF;
  IF p_limit IS NOT NULL AND p_limit < 0 THEN
    RAISE EXCEPTION 'Backfill limit must be nonnegative' USING ERRCODE = '22023';
  END IF;

  FOR e IN
    SELECT pe.id, pe.programme_id, pe.cohort_id, pe.start_date, pe.end_date
    FROM public.programme_enrollments pe
    ORDER BY pe.id
    LIMIT coalesce(p_limit, 2147483647)
  LOOP
    n_processed := n_processed + 1;
    -- The lock is per enrollment, rather than a batch lock, so a bad
    -- configuration cannot block unrelated historical enrollments.
    PERFORM pg_advisory_xact_lock(hashtextextended(e.id::text, 0));

    BEGIN
      complete := e.cohort_id IS NOT NULL AND e.end_date IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM public.programme_modules pm
          WHERE pm.programme_id = e.programme_id
            AND pm.enabled
            AND NOT EXISTS (
              SELECT 1
              FROM public.enrollment_module_snapshots s
              WHERE s.enrollment_id = e.id
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
          WHERE s.enrollment_id = e.id
            AND NOT EXISTS (
              SELECT 1 FROM public.programme_modules pm
              WHERE pm.id = s.programme_module_id
                AND pm.programme_id = e.programme_id
                AND pm.enabled
            )
        );

      IF complete THEN
        DELETE FROM public.enrollment_schedule_backfill_audit
         WHERE enrollment_id = e.id;
        n_skipped := n_skipped + 1;
        CONTINUE;
      END IF;

      PERFORM public.generate_enrollment_schedule(e.id);
      DELETE FROM public.enrollment_schedule_backfill_audit
       WHERE enrollment_id = e.id;
      n_succeeded := n_succeeded + 1;
    EXCEPTION
      WHEN OTHERS THEN
        IF SQLERRM = 'Existing enrollment schedule snapshot is incomplete' THEN
          failure_reason := 'partial_snapshot';
        ELSIF e.cohort_id IS NULL OR e.end_date IS NULL THEN
          failure_reason := 'missing_schedule_context';
        ELSE
          failure_reason := 'invalid_or_ambiguous_configuration';
        END IF;
        INSERT INTO public.enrollment_schedule_backfill_audit
          (enrollment_id, reason, metadata, last_seen_at)
        VALUES (
          e.id,
          failure_reason,
          jsonb_build_object(
            'programme_id', e.programme_id,
            'cohort_id', e.cohort_id,
            'start_date', e.start_date,
            'end_date', e.end_date
          ),
          now()
        )
        ON CONFLICT (enrollment_id) DO UPDATE SET
          reason = EXCLUDED.reason,
          metadata = EXCLUDED.metadata,
          last_seen_at = now();
        n_unresolved := n_unresolved + 1;
    END;
  END LOOP;

  RETURN QUERY SELECT n_processed, n_succeeded, n_unresolved, n_skipped;
END;
$$;

