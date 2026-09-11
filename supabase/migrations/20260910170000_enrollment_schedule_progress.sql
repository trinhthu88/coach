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
              AND s.required_units = coalesce((pm.config->>'required_units')::integer, 0)
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

CREATE OR REPLACE FUNCTION public.get_enrollment_progress(
  p_enrollment_id uuid,
  p_as_of date DEFAULT current_date
)
RETURNS TABLE(
  module public.programme_module_type,
  full_completion_pct numeric,
  due_adherence_pct numeric,
  pace_status text,
  completed_units integer,
  due_units integer,
  required_units integer,
  booked_units integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH authorized AS (
    SELECT 1
    FROM public.programme_enrollments e
    WHERE e.id = p_enrollment_id
      AND (
        e.user_id = auth.uid()
        OR public.has_role(auth.uid(), 'admin'::public.app_role)
        OR public.coach_has_client(auth.uid(), e.user_id)
      )
  ), snapshots AS (
    SELECT s.*
    FROM public.enrollment_module_snapshots s
    JOIN authorized ON true
    WHERE s.enrollment_id = p_enrollment_id
  ), activity AS (
    SELECT 'coaching'::public.programme_module_type AS module,
           enrollment_id, status::text, start_time::date AS occurred_on
    FROM public.sessions
    UNION ALL
    SELECT 'peer_coaching'::public.programme_module_type,
           enrollment_id, status::text, start_time::date
    FROM public.peer_sessions
    UNION ALL
    SELECT 'peer_coaching'::public.programme_module_type,
           enrollment_id, status::text, start_time::date
    FROM public.coachee_peer_sessions
    UNION ALL
    SELECT 'mentoring'::public.programme_module_type,
           enrollment_id, status::text, start_time::date
    FROM public.mentoring_sessions
    UNION ALL
    SELECT 'triads'::public.programme_module_type,
           coach_enrollment_id, status::text,
           coalesce(start_time, proposed_start_time)::date
    FROM public.triad_sessions
    WHERE coach_enrollment_id IS NOT NULL
    UNION ALL
    SELECT 'triads'::public.programme_module_type,
           coachee_enrollment_id, status::text,
           coalesce(start_time, proposed_start_time)::date
    FROM public.triad_sessions
    WHERE coachee_enrollment_id IS NOT NULL
    UNION ALL
    SELECT 'triads'::public.programme_module_type,
           observer_enrollment_id, status::text,
           coalesce(start_time, proposed_start_time)::date
    FROM public.triad_sessions
    WHERE observer_enrollment_id IS NOT NULL
    UNION ALL
    SELECT 'training'::public.programme_module_type,
           enrollment_id, 'completed'::text, completed_at::date
    FROM public.training_progress
    WHERE completed_at IS NOT NULL
    UNION ALL
    SELECT 'quiz'::public.programme_module_type,
           sub.enrollment_id, 'completed'::text, sub.submitted_at::date
    FROM public.assignment_submissions sub
    JOIN public.assignments a ON a.id = sub.assignment_id
    WHERE sub.enrollment_id IS NOT NULL
      AND a.assignment_type = 'quiz'::public.assignment_type
    UNION ALL
    SELECT 'daily_prompt'::public.programme_module_type,
           enrollment_id, 'completed'::text, responded_at::date
    FROM public.daily_prompt_responses
    WHERE enrollment_id IS NOT NULL
      AND responded_at IS NOT NULL
    -- No assessment response/submission relation exists yet. Enabled
    -- assessment snapshots therefore remain visible with zero completions.
  ), counts AS (
    SELECT
      s.id,
      count(a.*) FILTER (
        WHERE a.status = 'completed'
          AND a.occurred_on <= p_as_of
      )::integer AS completed,
      count(a.*) FILTER (
        WHERE a.status IN ('pending_coach_approval', 'confirmed')
          AND a.occurred_on >= p_as_of
      )::integer AS booked
    FROM snapshots s
    LEFT JOIN activity a
      ON a.enrollment_id = s.enrollment_id
     AND a.module = s.module
    GROUP BY s.id
  ), due AS (
    SELECT
      s.id,
      coalesce(sum(m.required_units) FILTER (WHERE m.due_on <= p_as_of), 0)::integer AS units_due
    FROM snapshots s
    LEFT JOIN public.enrollment_module_milestones m
      ON m.enrollment_module_snapshot_id = s.id
    GROUP BY s.id
  )
  SELECT
    s.module,
    CASE WHEN s.required_units = 0 THEN NULL
         ELSE round(least(c.completed, s.required_units) * 100.0 / s.required_units, 1)
    END,
    CASE WHEN d.units_due = 0 THEN NULL
         ELSE round(least(c.completed, d.units_due) * 100.0 / d.units_due, 1)
    END,
    CASE
      WHEN s.required_units = 0 OR c.completed >= s.required_units THEN 'completed'
      WHEN d.units_due = 0 THEN 'not_yet_due'
      WHEN c.completed >= d.units_due THEN
        CASE WHEN c.completed > d.units_due THEN 'ahead' ELSE 'on_track' END
      WHEN c.completed + c.booked >= d.units_due THEN 'scheduled'
      ELSE 'behind'
    END,
    c.completed,
    d.units_due,
    s.required_units,
    c.booked
  FROM snapshots s
  JOIN counts c ON c.id = s.id
  JOIN due d ON d.id = s.id;
$$;

REVOKE EXECUTE ON FUNCTION public.generate_enrollment_schedule(uuid) FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_enrollment_progress(uuid, date) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_enrollment_progress(uuid, date) TO authenticated;
