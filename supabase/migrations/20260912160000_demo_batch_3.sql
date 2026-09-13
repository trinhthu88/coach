-- Batch 3: deterministic Clariva demo activity and progress.
--
-- This migration adds reconciliation routines only. It does not provision
-- anything while migrations are applied. The server-side demo-admin function
-- invokes demo_apply_batch_3 inside the existing operation lifecycle.
--
-- Batch 3 intentionally uses neutral fixture labels where legacy tables have
-- required text columns. It never writes notes, objectives, reflections,
-- written feedback, comments, files, recordings, transcripts, quiz detail,
-- assessment detail, or private peer/triad content.

CREATE OR REPLACE FUNCTION public.demo_batch_3_id(
  p_kind text,
  p_serial integer
) RETURNS uuid
LANGUAGE plpgsql
IMMUTABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  kind_code text;
BEGIN
  kind_code := CASE p_kind
    WHEN 'module' THEN '0040'
    WHEN 'training_week' THEN '0041'
    WHEN 'snapshot' THEN '0042'
    WHEN 'schedule_milestone' THEN '0043'
    WHEN 'coaching' THEN '0044'
    WHEN 'mentoring' THEN '0045'
    WHEN 'peer' THEN '0046'
    WHEN 'triad_group' THEN '0047'
    WHEN 'triad_session' THEN '0048'
    WHEN 'goal' THEN '0049'
    WHEN 'milestone' THEN '004a'
    WHEN 'rating' THEN '004b'
    WHEN 'checkin' THEN '004c'
    WHEN 'action' THEN '004d'
    WHEN 'training_progress' THEN '004e'
    ELSE NULL
  END;

  IF kind_code IS NULL OR p_serial < 1 OR p_serial > 9999 THEN
    RAISE EXCEPTION 'Unknown or invalid Batch 3 identifier: %/%', p_kind, p_serial
      USING ERRCODE = '22023';
  END IF;

  RETURN format(
    'c7f8e4b2-2f34-4a1d-8f6f-1f8e%s%s',
    kind_code,
    lpad(p_serial::text, 4, '0')
  )::uuid;
END;
$$;

CREATE OR REPLACE FUNCTION public.demo_batch_3_programme_key(
  p_serial integer
) RETURNS text
LANGUAGE sql
IMMUTABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN p_serial BETWEEN 1 AND 8 THEN 'A'
    WHEN p_serial BETWEEN 9 AND 18 THEN 'B'
    WHEN p_serial BETWEEN 19 AND 30 THEN 'C'
    WHEN p_serial BETWEEN 31 AND 40 THEN 'D'
    ELSE NULL
  END;
$$;

CREATE OR REPLACE FUNCTION public.demo_batch_3_position(
  p_serial integer
) RETURNS integer
LANGUAGE sql
IMMUTABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN p_serial BETWEEN 1 AND 8 THEN p_serial
    WHEN p_serial BETWEEN 9 AND 18 THEN p_serial - 8
    WHEN p_serial BETWEEN 19 AND 30 THEN p_serial - 18
    WHEN p_serial BETWEEN 31 AND 40 THEN p_serial - 30
    ELSE NULL
  END;
$$;

CREATE OR REPLACE FUNCTION public.demo_batch_3_activity_resource_owned(
  p_resource_type text,
  p_resource_id uuid,
  p_exists boolean
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.demo_resource_registry
    WHERE resource_type = p_resource_type
      AND resource_id = p_resource_id
      AND organization_id <> 'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2e7a01'::uuid
  ) THEN
    RAISE EXCEPTION 'Batch 3 resource is registered to another organization: %/%',
      p_resource_type, p_resource_id
      USING ERRCODE = '23505';
  END IF;

  IF p_exists AND NOT EXISTS (
    SELECT 1
    FROM public.demo_resource_registry
    WHERE resource_type = p_resource_type
      AND resource_id = p_resource_id
      AND organization_id = 'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2e7a01'::uuid
  ) THEN
    RAISE EXCEPTION 'Batch 3 refuses to adopt an unregistered existing resource: %/%',
      p_resource_type, p_resource_id
      USING ERRCODE = '23505';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.demo_batch_3_register_resource(
  p_resource_type text,
  p_resource_id uuid,
  p_generation bigint
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.demo_register_batch_2_resource(
    p_resource_type, p_resource_id, p_generation
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.demo_assert_batch_3_collisions()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  leader record;
  programme record;
  module_row record;
  week_row record;
  i integer;
  n integer;
  module_order integer;
  expected_id uuid;
  existing_id uuid;
  target_programme_id uuid;
  cohort_key text;
  position_no integer;
  completed_units integer;
  upcoming_units integer;
  activity_count integer;
BEGIN
  PERFORM public.demo_assert_service_target(
    'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2e7a01'::uuid,
    'clariva-live-demo-v1',
    DATE '2026-01-05'
  );
  -- Batch 3 must preserve the full Batch 1/2 collision boundary before it
  -- checks any activity-specific identifiers.
  PERFORM public.demo_assert_batch_2_collisions();

  FOR module_row IN
    SELECT *
    FROM (VALUES
      ('A', 'coaching', 4, 100),
      ('B', 'coaching', 4, 25), ('B', 'mentoring', 2, 20),
      ('B', 'triads', 2, 20), ('B', 'training', 6, 35),
      ('B', 'quiz', 0, NULL), ('B', 'daily_prompt', 0, NULL),
      ('B', 'assessment', 0, NULL),
      ('C', 'coaching', 4, 20), ('C', 'mentoring', 2, 15),
      ('C', 'peer_coaching', 2, 15), ('C', 'triads', 2, 15),
      ('C', 'training', 6, 35), ('C', 'quiz', 0, NULL),
      ('C', 'daily_prompt', 0, NULL), ('C', 'assessment', 0, NULL),
      ('D', 'coaching', 4, 20), ('D', 'mentoring', 2, 15),
      ('D', 'peer_coaching', 2, 15), ('D', 'triads', 2, 15),
      ('D', 'training', 6, 35), ('D', 'quiz', 0, NULL),
      ('D', 'daily_prompt', 0, NULL), ('D', 'assessment', 0, NULL)
    ) AS batch_values(programme_key, module_name, required_units, weight)
  LOOP
    target_programme_id := CASE module_row.programme_key
      WHEN 'A' THEN 'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2a0101'::uuid
      WHEN 'B' THEN 'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2a0102'::uuid
      WHEN 'C' THEN 'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2a0103'::uuid
      ELSE 'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2a0104'::uuid
    END;
    SELECT pm.id INTO existing_id
    FROM public.programme_modules pm
    WHERE pm.programme_id = target_programme_id
      AND pm.module = module_row.module_name::public.programme_module_type;
    expected_id := public.demo_batch_3_id(
      'module',
      CASE module_row.programme_key
        WHEN 'A' THEN 1
        WHEN 'B' THEN 10 + (
          CASE module_row.module_name
            WHEN 'coaching' THEN 1 WHEN 'mentoring' THEN 2 WHEN 'triads' THEN 4
            WHEN 'training' THEN 5 WHEN 'quiz' THEN 6 WHEN 'daily_prompt' THEN 7
            ELSE 8
          END)
        WHEN 'C' THEN 20 + (
          CASE module_row.module_name
            WHEN 'coaching' THEN 1 WHEN 'mentoring' THEN 2 WHEN 'peer_coaching' THEN 3
            WHEN 'triads' THEN 4 WHEN 'training' THEN 5 WHEN 'quiz' THEN 6
            WHEN 'daily_prompt' THEN 7 ELSE 8
          END)
        ELSE 30 + (
          CASE module_row.module_name
            WHEN 'coaching' THEN 1 WHEN 'mentoring' THEN 2 WHEN 'peer_coaching' THEN 3
            WHEN 'triads' THEN 4 WHEN 'training' THEN 5 WHEN 'quiz' THEN 6
            WHEN 'daily_prompt' THEN 7 ELSE 8
          END)
      END
    );
    IF existing_id IS NOT NULL AND existing_id <> expected_id THEN
      RAISE EXCEPTION 'Batch 3 programme module collision for %/%',
        module_row.programme_key, module_row.module_name
        USING ERRCODE = '23505';
    END IF;
    PERFORM public.demo_batch_3_activity_resource_owned(
      'programme_module', expected_id, existing_id IS NOT NULL
    );
  END LOOP;

  FOR week_row IN
    SELECT programme_key, week_number
    FROM (VALUES
      ('B', 1), ('B', 2), ('B', 3), ('B', 4), ('B', 5), ('B', 6),
      ('C', 1), ('C', 2), ('C', 3), ('C', 4), ('C', 5), ('C', 6),
      ('D', 1), ('D', 2), ('D', 3), ('D', 4), ('D', 5), ('D', 6)
    ) AS batch_values(programme_key, week_number)
  LOOP
    target_programme_id := CASE week_row.programme_key
      WHEN 'B' THEN 'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2a0102'::uuid
      WHEN 'C' THEN 'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2a0103'::uuid
      ELSE 'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2a0104'::uuid
    END;
    expected_id := public.demo_batch_3_id(
      'training_week',
      CASE week_row.programme_key WHEN 'B' THEN 0 WHEN 'C' THEN 10 ELSE 20 END
        + week_row.week_number
    );
    SELECT tw.id INTO existing_id
    FROM public.training_weeks tw
    WHERE tw.programme_id = target_programme_id
      AND tw.week_number = week_row.week_number;
    IF existing_id IS NOT NULL AND existing_id <> expected_id THEN
      RAISE EXCEPTION 'Batch 3 training week collision for %/%',
        week_row.programme_key, week_row.week_number
        USING ERRCODE = '23505';
    END IF;
    PERFORM public.demo_batch_3_activity_resource_owned(
      'training_week', expected_id, existing_id IS NOT NULL
    );
  END LOOP;

  FOR i IN 1..40 LOOP
    SELECT * INTO leader FROM public.demo_batch_2_leader(i);
    cohort_key := public.demo_batch_3_programme_key(i);
    position_no := public.demo_batch_3_position(i);

    expected_id := public.demo_batch_3_id('goal', i);
    PERFORM public.demo_batch_3_activity_resource_owned(
      'coachee_goal', expected_id,
      EXISTS (SELECT 1 FROM public.coachee_goals WHERE id = expected_id)
    );
    expected_id := public.demo_batch_3_id('rating', i);
    PERFORM public.demo_batch_3_activity_resource_owned(
      'coachee_goal_rating', expected_id,
      EXISTS (SELECT 1 FROM public.coachee_goal_ratings WHERE id = expected_id)
    );
    FOR n IN 1..2 LOOP
      expected_id := public.demo_batch_3_id('milestone', i * 10 + n);
      PERFORM public.demo_batch_3_activity_resource_owned(
        'coachee_milestone', expected_id,
        EXISTS (SELECT 1 FROM public.coachee_milestones WHERE id = expected_id)
      );
    END LOOP;
    expected_id := public.demo_batch_3_id('checkin', i);
    PERFORM public.demo_batch_3_activity_resource_owned(
      'goal_checkin', expected_id,
      EXISTS (SELECT 1 FROM public.goal_checkins WHERE id = expected_id)
    );
    FOR n IN 1..(CASE WHEN cohort_key = 'D' OR
      (cohort_key = 'A' AND position_no = 8) OR
      (cohort_key IN ('B','C') AND position_no >= 9) THEN 2 ELSE 1 END) LOOP
      expected_id := public.demo_batch_3_id('action', i * 10 + n);
      PERFORM public.demo_batch_3_activity_resource_owned(
        'enrollment_action', expected_id,
        EXISTS (SELECT 1 FROM public.enrollment_actions WHERE id = expected_id)
      );
    END LOOP;

    completed_units := CASE
      WHEN cohort_key = 'D' THEN 4
      WHEN cohort_key = 'A' AND position_no <= 3 THEN 4
      WHEN cohort_key = 'A' AND position_no <= 5 THEN 2
      WHEN cohort_key = 'B' AND position_no <= 3 THEN 3
      WHEN cohort_key = 'B' AND position_no <= 7 THEN 2
      WHEN cohort_key = 'C' AND position_no <= 4 THEN 4
      WHEN cohort_key = 'C' AND position_no <= 8 THEN 2
      ELSE 1
    END;
    upcoming_units := CASE
      WHEN cohort_key = 'A' AND position_no >= 6 THEN 2
      WHEN cohort_key = 'A' AND position_no >= 4 THEN 1
      WHEN cohort_key = 'B' AND position_no >= 6 THEN 1
      WHEN cohort_key = 'C' AND position_no >= 5 THEN 1
      ELSE 0
    END;
    FOR n IN 1..completed_units LOOP
      expected_id := public.demo_batch_3_id('coaching', i * 100 + n);
      PERFORM public.demo_batch_3_activity_resource_owned(
        'session', expected_id,
        EXISTS (SELECT 1 FROM public.sessions WHERE id = expected_id)
      );
    END LOOP;
    FOR n IN 1..upcoming_units LOOP
      expected_id := public.demo_batch_3_id('coaching', i * 100 + 50 + n);
      PERFORM public.demo_batch_3_activity_resource_owned(
        'session', expected_id,
        EXISTS (SELECT 1 FROM public.sessions WHERE id = expected_id)
      );
    END LOOP;

    IF cohort_key IN ('B', 'C', 'D') THEN
      completed_units := CASE
        WHEN cohort_key = 'D' THEN 2
        WHEN cohort_key = 'B' AND position_no <= 5 THEN 2
        WHEN cohort_key = 'C' AND position_no <= 4 THEN 2
        ELSE 1
      END;
      upcoming_units := CASE
        WHEN cohort_key = 'B' AND position_no >= 6 THEN 1
        WHEN cohort_key = 'C' AND position_no >= 9 THEN 1
        ELSE 0
      END;
      FOR n IN 1..completed_units LOOP
        expected_id := public.demo_batch_3_id('mentoring', i * 100 + n);
        PERFORM public.demo_batch_3_activity_resource_owned(
          'mentoring_session', expected_id,
          EXISTS (SELECT 1 FROM public.mentoring_sessions WHERE id = expected_id)
        );
      END LOOP;
      FOR n IN 1..upcoming_units LOOP
        expected_id := public.demo_batch_3_id('mentoring', i * 100 + 50 + n);
        PERFORM public.demo_batch_3_activity_resource_owned(
          'mentoring_session', expected_id,
          EXISTS (SELECT 1 FROM public.mentoring_sessions WHERE id = expected_id)
        );
      END LOOP;
    END IF;

    IF cohort_key IN ('C', 'D') THEN
      completed_units := CASE
        WHEN cohort_key = 'D' THEN 2
        WHEN position_no <= 6 THEN 2
        ELSE 1
      END;
      upcoming_units := CASE
        WHEN cohort_key = 'C' AND position_no >= 7 THEN 1
        ELSE 0
      END;
      FOR n IN 1..completed_units LOOP
        expected_id := public.demo_batch_3_id('peer', i * 100 + n);
        PERFORM public.demo_batch_3_activity_resource_owned(
          'coachee_peer_session', expected_id,
          EXISTS (SELECT 1 FROM public.coachee_peer_sessions WHERE id = expected_id)
        );
      END LOOP;
      FOR n IN 1..upcoming_units LOOP
        expected_id := public.demo_batch_3_id('peer', i * 100 + 50 + n);
        PERFORM public.demo_batch_3_activity_resource_owned(
          'coachee_peer_session', expected_id,
          EXISTS (SELECT 1 FROM public.coachee_peer_sessions WHERE id = expected_id)
        );
      END LOOP;
    END IF;

    FOR module_row IN
      SELECT *
      FROM (VALUES
        ('coaching', 1), ('mentoring', 2), ('peer_coaching', 3),
        ('triads', 4), ('training', 5), ('quiz', 6),
        ('daily_prompt', 7), ('assessment', 8)
      ) AS batch_values(module_name, module_order)
    LOOP
      IF module_row.module_name = 'coaching'
         OR (module_row.module_name IN ('mentoring','triads','training')
             AND cohort_key IN ('B','C','D'))
         OR (module_row.module_name = 'peer_coaching'
             AND cohort_key IN ('C','D'))
         OR (module_row.module_name IN ('quiz','daily_prompt','assessment')
             AND cohort_key IN ('B','C','D'))
      THEN
        expected_id := public.demo_batch_3_id(
          'snapshot',
          i * 10 + module_row.module_order
        );
        PERFORM public.demo_batch_3_activity_resource_owned(
          'enrollment_module_snapshot', expected_id,
          EXISTS (
            SELECT 1 FROM public.enrollment_module_snapshots
            WHERE id = expected_id
          )
        );
        FOR n IN 1..(CASE
          WHEN module_row.module_name = 'coaching' THEN 4
          WHEN module_row.module_name = 'mentoring' THEN 2
          WHEN module_row.module_name = 'peer_coaching' THEN 2
          WHEN module_row.module_name = 'triads' THEN 2
          WHEN module_row.module_name = 'training' THEN 6
          ELSE 0
        END) LOOP
          expected_id := public.demo_batch_3_id(
            'schedule_milestone',
            i * 100 + module_row.module_order * 10 + n
          );
          PERFORM public.demo_batch_3_activity_resource_owned(
            'enrollment_module_milestone', expected_id,
            EXISTS (
              SELECT 1 FROM public.enrollment_module_milestones
              WHERE id = expected_id
            )
          );
        END LOOP;
      END IF;
    END LOOP;

    FOR n IN 1..(CASE
      WHEN cohort_key IN ('B','C','D') THEN 6 ELSE 0
    END) LOOP
      expected_id := public.demo_batch_3_id(
        'training_progress',
        i * 10 + n
      );
      PERFORM public.demo_batch_3_activity_resource_owned(
        'training_progress', expected_id,
        EXISTS (SELECT 1 FROM public.training_progress WHERE id = expected_id)
      );
    END LOOP;
  END LOOP;

  FOR i IN 1..7 LOOP
    expected_id := public.demo_batch_3_id('triad_group', i);
    PERFORM public.demo_batch_3_activity_resource_owned(
      'triad_group', expected_id,
      EXISTS (SELECT 1 FROM public.triad_groups WHERE id = expected_id)
    );
    FOR n IN 1..2 LOOP
      expected_id := public.demo_batch_3_id('triad_session', i * 10 + n);
      PERFORM public.demo_batch_3_activity_resource_owned(
        'triad_session', expected_id,
        EXISTS (SELECT 1 FROM public.triad_sessions WHERE id = expected_id)
      );
    END LOOP;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.demo_validate_batch_3_ownership()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  expected_count integer := 1522;
  actual_count integer;
  unowned_count integer;
  bad_org_count integer;
BEGIN
  SELECT count(*)::integer INTO actual_count
  FROM public.demo_resource_registry
  WHERE organization_id = 'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2e7a01'::uuid
    AND generation = (
      SELECT generation FROM public.demo_organization_registry
      WHERE organization_id = 'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2e7a01'::uuid
    );
  IF actual_count < expected_count THEN
    RAISE EXCEPTION 'Batch 3 ownership closure has % rows; expected at least %',
      actual_count, expected_count;
  END IF;

  SELECT count(*)::integer INTO unowned_count
  FROM (
    SELECT 'programme_module'::text resource_type, pm.id resource_id
    FROM public.programme_modules pm
    WHERE pm.programme_id IN (
      'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2a0101'::uuid,
      'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2a0102'::uuid,
      'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2a0103'::uuid,
      'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2a0104'::uuid
    )
    UNION ALL
    SELECT 'training_week', tw.id
    FROM public.training_weeks tw
    WHERE tw.programme_id IN (
      'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2a0102'::uuid,
      'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2a0103'::uuid,
      'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2a0104'::uuid
    )
    UNION ALL
    SELECT 'session', s.id FROM public.sessions s
    JOIN public.programme_enrollments e ON e.id = s.enrollment_id
    WHERE e.organization_id = 'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2e7a01'::uuid
    UNION ALL
    SELECT 'mentoring_session', s.id FROM public.mentoring_sessions s
    JOIN public.programme_enrollments e ON e.id = s.enrollment_id
    WHERE e.organization_id = 'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2e7a01'::uuid
    UNION ALL
    SELECT 'coachee_peer_session', s.id FROM public.coachee_peer_sessions s
    JOIN public.programme_enrollments e ON e.id = s.enrollment_id
    WHERE e.organization_id = 'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2e7a01'::uuid
    UNION ALL
    SELECT 'triad_group', g.id FROM public.triad_groups g
    WHERE g.programme_id IN (
      'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2a0103'::uuid,
      'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2a0104'::uuid
    )
    UNION ALL
    SELECT 'triad_session', s.id FROM public.triad_sessions s
    JOIN public.triad_groups g ON g.id = s.triad_group_id
    WHERE g.programme_id IN (
      'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2a0103'::uuid,
      'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2a0104'::uuid
    )
    UNION ALL
    SELECT 'coachee_goal', g.id FROM public.coachee_goals g
    JOIN public.programme_enrollments e ON e.id = g.enrollment_id
    WHERE e.organization_id = 'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2e7a01'::uuid
    UNION ALL
    SELECT 'coachee_milestone', m.id FROM public.coachee_milestones m
    JOIN public.programme_enrollments e ON e.id = m.enrollment_id
    WHERE e.organization_id = 'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2e7a01'::uuid
    UNION ALL
    SELECT 'coachee_goal_rating', r.id FROM public.coachee_goal_ratings r
    JOIN public.programme_enrollments e ON e.id = r.enrollment_id
    WHERE e.organization_id = 'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2e7a01'::uuid
    UNION ALL
    SELECT 'goal_checkin', c.id FROM public.goal_checkins c
    JOIN public.programme_enrollments e ON e.id = c.enrollment_id
    WHERE e.organization_id = 'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2e7a01'::uuid
    UNION ALL
    SELECT 'enrollment_action', a.id FROM public.enrollment_actions a
    JOIN public.programme_enrollments e ON e.id = a.enrollment_id
    WHERE e.organization_id = 'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2e7a01'::uuid
    UNION ALL
    SELECT 'training_progress', p.id FROM public.training_progress p
    JOIN public.programme_enrollments e ON e.id = p.enrollment_id
    WHERE e.organization_id = 'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2e7a01'::uuid
    UNION ALL
    SELECT 'enrollment_module_snapshot', s.id FROM public.enrollment_module_snapshots s
    JOIN public.programme_enrollments e ON e.id = s.enrollment_id
    WHERE e.organization_id = 'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2e7a01'::uuid
    UNION ALL
    SELECT 'enrollment_module_milestone', m.id
    FROM public.enrollment_module_milestones m
    JOIN public.enrollment_module_snapshots s ON s.id = m.enrollment_module_snapshot_id
    JOIN public.programme_enrollments e ON e.id = s.enrollment_id
    WHERE e.organization_id = 'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2e7a01'::uuid
  ) resources
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.demo_resource_registry r
    WHERE r.organization_id = 'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2e7a01'::uuid
      AND r.resource_type = resources.resource_type
      AND r.resource_id = resources.resource_id
  );
  IF unowned_count <> 0 THEN
    RAISE EXCEPTION 'Batch 3 ownership closure has % unregistered resources',
      unowned_count;
  END IF;

  SELECT count(*)::integer INTO bad_org_count
  FROM public.demo_resource_registry
  WHERE resource_type IN (
    'programme_module', 'training_week', 'session', 'mentoring_session',
    'coachee_peer_session', 'triad_group', 'triad_session', 'coachee_goal',
    'coachee_milestone', 'coachee_goal_rating', 'goal_checkin',
    'enrollment_action', 'training_progress', 'enrollment_module_snapshot',
    'enrollment_module_milestone'
  )
  AND organization_id <> 'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2e7a01'::uuid;
  IF bad_org_count <> 0 THEN
    RAISE EXCEPTION 'Batch 3 ownership registry contains % cross-organization rows',
      bad_org_count;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.demo_apply_batch_3(
  p_operation_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  operation_row public.demo_operations;
  registry_generation bigint;
  leader record;
  module_row record;
  week_row record;
  group_row record;
  e1 record;
  e2 record;
  e3 record;
  programme_id uuid;
  cohort_id uuid;
  cohort_key text;
  position_no integer;
  module_id uuid;
  snapshot_id uuid;
  goal_id uuid;
  milestone_id uuid;
  training_week_id uuid;
  expected_id uuid;
  provider_id uuid;
  provider_enrollment_id uuid;
  completed_units integer;
  upcoming_units integer;
  module_order integer;
  unit_no integer;
  group_no integer;
  session_no integer;
  progress_complete boolean;
  activity_start timestamptz;
  counts jsonb;
  i integer;
BEGIN
  SELECT * INTO operation_row
  FROM public.demo_operations
  WHERE id = p_operation_id
  FOR UPDATE;
  IF NOT FOUND OR operation_row.status <> 'started' THEN
    RAISE EXCEPTION 'Batch 3 requires a started demo operation'
      USING ERRCODE = 'P0001';
  END IF;

  PERFORM public.demo_assert_service_target(
    operation_row.organization_id,
    operation_row.fixture_version,
    operation_row.anchor_date
  );
  PERFORM public.demo_assert_batch_3_collisions();

  SELECT generation INTO registry_generation
  FROM public.demo_organization_registry
  WHERE organization_id = operation_row.organization_id
  FOR UPDATE;
  IF NOT FOUND OR registry_generation <> operation_row.generation_before THEN
    RAISE EXCEPTION 'Batch 3 generation changed before fixture application'
      USING ERRCODE = '40001';
  END IF;

  -- Reconcile the module contract needed for deterministic progress snapshots.
  FOR module_row IN
    SELECT *
    FROM (VALUES
      ('A', 'coaching', 4, 100),
      ('B', 'coaching', 4, 25), ('B', 'mentoring', 2, 20),
      ('B', 'triads', 2, 20), ('B', 'training', 6, 35),
      ('B', 'quiz', 0, NULL), ('B', 'daily_prompt', 0, NULL),
      ('B', 'assessment', 0, NULL),
      ('C', 'coaching', 4, 20), ('C', 'mentoring', 2, 15),
      ('C', 'peer_coaching', 2, 15), ('C', 'triads', 2, 15),
      ('C', 'training', 6, 35), ('C', 'quiz', 0, NULL),
      ('C', 'daily_prompt', 0, NULL), ('C', 'assessment', 0, NULL),
      ('D', 'coaching', 4, 20), ('D', 'mentoring', 2, 15),
      ('D', 'peer_coaching', 2, 15), ('D', 'triads', 2, 15),
      ('D', 'training', 6, 35), ('D', 'quiz', 0, NULL),
      ('D', 'daily_prompt', 0, NULL), ('D', 'assessment', 0, NULL)
    ) AS batch_values(programme_key, module_name, required_units, weight)
  LOOP
    programme_id := CASE module_row.programme_key
      WHEN 'A' THEN 'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2a0101'::uuid
      WHEN 'B' THEN 'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2a0102'::uuid
      WHEN 'C' THEN 'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2a0103'::uuid
      ELSE 'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2a0104'::uuid
    END;
    module_order := CASE module_row.module_name
      WHEN 'coaching' THEN 1 WHEN 'mentoring' THEN 2
      WHEN 'peer_coaching' THEN 3 WHEN 'triads' THEN 4
      WHEN 'training' THEN 5 WHEN 'quiz' THEN 6
      WHEN 'daily_prompt' THEN 7 ELSE 8
    END;
    module_id := public.demo_batch_3_id(
      'module',
      CASE module_row.programme_key
        WHEN 'A' THEN 1
        WHEN 'B' THEN 10 + module_order
        WHEN 'C' THEN 20 + module_order
        ELSE 30 + module_order
      END
    );
    INSERT INTO public.programme_modules (
      id, programme_id, module, enabled, config
    )
    VALUES (
      module_id, programme_id,
      module_row.module_name::public.programme_module_type,
      true,
      jsonb_build_object(
        'required', module_row.required_units > 0,
        'required_units', module_row.required_units,
        'distribution_mode', 'evenly_distributed',
        'weight', module_row.weight
      )
    )
    ON CONFLICT (id) DO UPDATE SET
      programme_id = EXCLUDED.programme_id,
      module = EXCLUDED.module,
      enabled = EXCLUDED.enabled,
      config = EXCLUDED.config;
    PERFORM public.demo_batch_3_register_resource(
      'programme_module', module_id, registry_generation
    );
  END LOOP;

  -- Training weeks are neutral scaffolding for progress rows. No course
  -- content, quiz detail, assessment detail, files, or recordings are added.
  FOR week_row IN
    SELECT programme_key, week_number
    FROM (VALUES
      ('B', 1), ('B', 2), ('B', 3), ('B', 4), ('B', 5), ('B', 6),
      ('C', 1), ('C', 2), ('C', 3), ('C', 4), ('C', 5), ('C', 6),
      ('D', 1), ('D', 2), ('D', 3), ('D', 4), ('D', 5), ('D', 6)
    ) AS batch_values(programme_key, week_number)
  LOOP
    programme_id := CASE week_row.programme_key
      WHEN 'B' THEN 'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2a0102'::uuid
      WHEN 'C' THEN 'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2a0103'::uuid
      ELSE 'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2a0104'::uuid
    END;
    training_week_id := public.demo_batch_3_id(
      'training_week',
      CASE week_row.programme_key WHEN 'B' THEN 0 WHEN 'C' THEN 10 ELSE 20 END
        + week_row.week_number
    );
    INSERT INTO public.training_weeks (
      id, programme_id, week_number, title, subtitle,
      is_visible, unlock_date, sort_order
    )
    VALUES (
      training_week_id, programme_id, week_row.week_number,
      format('Demo training week %s', lpad(week_row.week_number::text, 2, '0')),
      'Neutral demo progress fixture',
      true,
      CASE week_row.programme_key
        WHEN 'D' THEN DATE '2025-01-06' + (week_row.week_number - 1) * 7
        ELSE DATE '2026-01-05' + (week_row.week_number - 1) * 7
      END,
      week_row.week_number
    )
    ON CONFLICT (id) DO UPDATE SET
      programme_id = EXCLUDED.programme_id,
      week_number = EXCLUDED.week_number,
      title = EXCLUDED.title,
      subtitle = EXCLUDED.subtitle,
      is_visible = EXCLUDED.is_visible,
      unlock_date = EXCLUDED.unlock_date,
      sort_order = EXCLUDED.sort_order;
    PERFORM public.demo_batch_3_register_resource(
      'training_week', training_week_id, registry_generation
    );
  END LOOP;

  -- Immutable enrollment snapshots and schedule milestones drive the
  -- enrollment progress/adherence RPCs without generating runtime schedules.
  FOR i IN 1..40 LOOP
    SELECT * INTO leader FROM public.demo_batch_2_leader(i);
    cohort_key := public.demo_batch_3_programme_key(i);
    FOR module_row IN
      SELECT *
      FROM (VALUES
        ('coaching', 1, 4, 100), ('mentoring', 2, 2, 15),
        ('peer_coaching', 3, 2, 15), ('triads', 4, 2, 15),
        ('training', 5, 6, 35), ('quiz', 6, 0, NULL),
        ('daily_prompt', 7, 0, NULL), ('assessment', 8, 0, NULL)
      ) AS batch_values(module_name, module_order, required_units, weight)
    LOOP
      IF module_row.module_name = 'coaching'
         OR (module_row.module_name IN ('mentoring','triads','training')
             AND cohort_key IN ('B','C','D'))
         OR (module_row.module_name = 'peer_coaching'
             AND cohort_key IN ('C','D'))
         OR (module_row.module_name IN ('quiz','daily_prompt','assessment')
             AND cohort_key IN ('B','C','D'))
      THEN
        programme_id := leader.programme_id;
        module_id := public.demo_batch_3_id(
          'module',
          CASE cohort_key
            WHEN 'A' THEN 1
            WHEN 'B' THEN 10 + module_row.module_order
            WHEN 'C' THEN 20 + module_row.module_order
            ELSE 30 + module_row.module_order
          END
        );
        snapshot_id := public.demo_batch_3_id(
          'snapshot', i * 10 + module_row.module_order
        );
        INSERT INTO public.enrollment_module_snapshots (
          id, enrollment_id, programme_module_id, module, required,
          required_units, distribution_mode, distribution_settings, weight,
          starts_on, ends_on
        )
        VALUES (
          snapshot_id, leader.enrollment_id, module_id,
          module_row.module_name::public.programme_module_type,
          module_row.required_units > 0,
          module_row.required_units, 'evenly_distributed', '{}'::jsonb,
          CASE WHEN module_row.required_units > 0
            THEN CASE cohort_key
              WHEN 'A' THEN 100
              ELSE module_row.weight
            END
          END,
          CASE WHEN cohort_key = 'D' THEN DATE '2025-01-06' ELSE DATE '2026-01-05' END,
          CASE
            WHEN cohort_key = 'A' THEN DATE '2026-04-05'
            WHEN cohort_key IN ('B','C') THEN DATE '2026-07-05'
            ELSE DATE '2025-07-06'
          END
        )
        ON CONFLICT (id) DO UPDATE SET
          enrollment_id = EXCLUDED.enrollment_id,
          programme_module_id = EXCLUDED.programme_module_id,
          module = EXCLUDED.module,
          required = EXCLUDED.required,
          required_units = EXCLUDED.required_units,
          distribution_mode = EXCLUDED.distribution_mode,
          distribution_settings = EXCLUDED.distribution_settings,
          weight = EXCLUDED.weight,
          starts_on = EXCLUDED.starts_on,
          ends_on = EXCLUDED.ends_on;
        PERFORM public.demo_batch_3_register_resource(
          'enrollment_module_snapshot', snapshot_id, registry_generation
        );

        FOR unit_no IN 1..module_row.required_units LOOP
          expected_id := public.demo_batch_3_id(
            'schedule_milestone',
            i * 100 + module_row.module_order * 10 + unit_no
          );
          training_week_id := NULL;
          IF module_row.module_name = 'training' THEN
            training_week_id := public.demo_batch_3_id(
              'training_week',
              CASE cohort_key WHEN 'B' THEN 0 WHEN 'C' THEN 10 ELSE 20 END
                + unit_no
            );
          END IF;
          INSERT INTO public.enrollment_module_milestones (
            id, enrollment_module_snapshot_id, sequence, due_on,
            window_end_on, training_week_id, required_units
          )
          VALUES (
            expected_id, snapshot_id, unit_no,
            CASE WHEN cohort_key = 'D' THEN DATE '2025-01-06'
              ELSE DATE '2026-01-05' END
              + (((CASE WHEN cohort_key = 'D' THEN DATE '2025-07-06'
                ELSE CASE WHEN cohort_key = 'A' THEN DATE '2026-04-05'
                ELSE DATE '2026-07-05' END END)
                - (CASE WHEN cohort_key = 'D' THEN DATE '2025-01-06'
                ELSE DATE '2026-01-05' END)) * (unit_no - 1)
                / NULLIF(module_row.required_units, 0)),
            NULL, training_week_id, 1
          )
          ON CONFLICT (id) DO UPDATE SET
            enrollment_module_snapshot_id = EXCLUDED.enrollment_module_snapshot_id,
            sequence = EXCLUDED.sequence,
            due_on = EXCLUDED.due_on,
            window_end_on = EXCLUDED.window_end_on,
            training_week_id = EXCLUDED.training_week_id,
            required_units = EXCLUDED.required_units;
          PERFORM public.demo_batch_3_register_resource(
            'enrollment_module_milestone', expected_id, registry_generation
          );
        END LOOP;
      END IF;
    END LOOP;
  END LOOP;

  -- Coaching, mentoring, and peer activity. All text fields that are
  -- required by legacy schemas contain neutral labels only.
  FOR i IN 1..40 LOOP
    SELECT * INTO leader FROM public.demo_batch_2_leader(i);
    cohort_key := public.demo_batch_3_programme_key(i);
    position_no := public.demo_batch_3_position(i);

    completed_units := CASE
      WHEN cohort_key = 'D' THEN 4
      WHEN cohort_key = 'A' AND position_no <= 3 THEN 4
      WHEN cohort_key = 'A' AND position_no <= 5 THEN 2
      WHEN cohort_key = 'B' AND position_no <= 3 THEN 3
      WHEN cohort_key = 'B' AND position_no <= 7 THEN 2
      WHEN cohort_key = 'C' AND position_no <= 4 THEN 4
      WHEN cohort_key = 'C' AND position_no <= 8 THEN 2
      ELSE 1
    END;
    upcoming_units := CASE
      WHEN cohort_key = 'A' AND position_no >= 6 THEN 2
      WHEN cohort_key = 'A' AND position_no >= 4 THEN 1
      WHEN cohort_key = 'B' AND position_no >= 6 THEN 1
      WHEN cohort_key = 'C' AND position_no >= 5 THEN 1
      ELSE 0
    END;
    FOR unit_no IN 1..completed_units LOOP
      expected_id := public.demo_batch_3_id('coaching', i * 100 + unit_no);
      activity_start := CASE WHEN cohort_key = 'D'
        THEN TIMESTAMPTZ '2025-01-13 09:00:00+07'
        ELSE TIMESTAMPTZ '2026-01-12 09:00:00+07' END
        + (unit_no - 1) * INTERVAL '14 days';
      INSERT INTO public.sessions (
        id, coach_id, coachee_id, enrollment_id, topic, start_time,
        duration_minutes, status, coachee_rating, coachee_rating_comment,
        coachee_rated_at, meeting_url, coach_notes, coachee_notes, action_items
      )
      VALUES (
        expected_id,
        'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2c0103'::uuid,
        leader.user_id, leader.enrollment_id, 'Demo session', activity_start,
        60, 'completed', 3 + ((i + unit_no) % 3), NULL,
        activity_start + INTERVAL '1 day', NULL, NULL, NULL, '[]'::jsonb
      )
      ON CONFLICT (id) DO UPDATE SET
        coach_id = EXCLUDED.coach_id, coachee_id = EXCLUDED.coachee_id,
        enrollment_id = EXCLUDED.enrollment_id, topic = EXCLUDED.topic,
        start_time = EXCLUDED.start_time, duration_minutes = EXCLUDED.duration_minutes,
        status = EXCLUDED.status, coachee_rating = EXCLUDED.coachee_rating,
        coachee_rating_comment = NULL, coachee_rated_at = EXCLUDED.coachee_rated_at,
        meeting_url = NULL, coach_notes = NULL, coachee_notes = NULL,
        action_items = '[]'::jsonb;
      PERFORM public.demo_batch_3_register_resource(
        'session', expected_id, registry_generation
      );
    END LOOP;
    FOR unit_no IN 1..upcoming_units LOOP
      expected_id := public.demo_batch_3_id('coaching', i * 100 + 50 + unit_no);
      activity_start := TIMESTAMPTZ '2026-03-22 09:00:00+07'
        + (unit_no - 1) * INTERVAL '7 days';
      INSERT INTO public.sessions (
        id, coach_id, coachee_id, enrollment_id, topic, start_time,
        duration_minutes, status, meeting_url, coach_notes, coachee_notes,
        action_items
      )
      VALUES (
        expected_id,
        'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2c0103'::uuid,
        leader.user_id, leader.enrollment_id, 'Demo session', activity_start,
        60, 'confirmed', NULL, NULL, NULL, '[]'::jsonb
      )
      ON CONFLICT (id) DO UPDATE SET
        coach_id = EXCLUDED.coach_id, coachee_id = EXCLUDED.coachee_id,
        enrollment_id = EXCLUDED.enrollment_id, topic = EXCLUDED.topic,
        start_time = EXCLUDED.start_time, duration_minutes = EXCLUDED.duration_minutes,
        status = EXCLUDED.status, meeting_url = NULL, coach_notes = NULL,
        coachee_notes = NULL, action_items = '[]'::jsonb;
      PERFORM public.demo_batch_3_register_resource(
        'session', expected_id, registry_generation
      );
    END LOOP;

    IF cohort_key IN ('B', 'C', 'D') THEN
      completed_units := CASE
        WHEN cohort_key = 'D' THEN 2
        WHEN cohort_key = 'B' AND position_no <= 5 THEN 2
        WHEN cohort_key = 'C' AND position_no <= 4 THEN 2
        ELSE 1
      END;
      upcoming_units := CASE
        WHEN cohort_key = 'B' AND position_no >= 6 THEN 1
        WHEN cohort_key = 'C' AND position_no >= 9 THEN 1
        ELSE 0
      END;
      FOR unit_no IN 1..completed_units LOOP
        expected_id := public.demo_batch_3_id('mentoring', i * 100 + unit_no);
        activity_start := CASE WHEN cohort_key = 'D'
          THEN TIMESTAMPTZ '2025-01-20 13:00:00+07'
          ELSE TIMESTAMPTZ '2026-01-19 13:00:00+07' END
          + (unit_no - 1) * INTERVAL '28 days';
        INSERT INTO public.mentoring_sessions (
          id, mentor_id, mentee_id, enrollment_id, topic, start_time,
          duration_minutes, status, meeting_url, mentor_notes, mentee_notes,
          action_items, prep_file_path, prep_file_notes, feedback_submitted_at
        )
        VALUES (
          expected_id,
          'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2c0103'::uuid,
          leader.user_id, leader.enrollment_id, 'Demo session', activity_start,
          60, 'completed', NULL, NULL, NULL, '[]'::jsonb,
          CASE WHEN cohort_key = 'D' THEN 'demo://no-file-content' ELSE NULL END,
          NULL, NULL
        )
        ON CONFLICT (id) DO UPDATE SET
          mentor_id = EXCLUDED.mentor_id, mentee_id = EXCLUDED.mentee_id,
          enrollment_id = EXCLUDED.enrollment_id, topic = EXCLUDED.topic,
          start_time = EXCLUDED.start_time, duration_minutes = EXCLUDED.duration_minutes,
          status = EXCLUDED.status, meeting_url = NULL, mentor_notes = NULL,
          mentee_notes = NULL, action_items = '[]'::jsonb,
          prep_file_path = CASE WHEN cohort_key = 'D' THEN 'demo://no-file-content' ELSE NULL END,
          prep_file_notes = NULL, feedback_submitted_at = NULL;
        PERFORM public.demo_batch_3_register_resource(
          'mentoring_session', expected_id, registry_generation
        );
      END LOOP;
      FOR unit_no IN 1..upcoming_units LOOP
        expected_id := public.demo_batch_3_id('mentoring', i * 100 + 50 + unit_no);
        activity_start := TIMESTAMPTZ '2026-03-29 13:00:00+07'
          + (unit_no - 1) * INTERVAL '14 days';
        INSERT INTO public.mentoring_sessions (
          id, mentor_id, mentee_id, enrollment_id, topic, start_time,
          duration_minutes, status, meeting_url, mentor_notes, mentee_notes,
          action_items, prep_file_path, prep_file_notes, feedback_submitted_at
        )
        VALUES (
          expected_id,
          'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2c0103'::uuid,
          leader.user_id, leader.enrollment_id, 'Demo session', activity_start,
          60, 'confirmed', NULL, NULL, NULL, '[]'::jsonb, NULL, NULL, NULL
        )
        ON CONFLICT (id) DO UPDATE SET
          mentor_id = EXCLUDED.mentor_id, mentee_id = EXCLUDED.mentee_id,
          enrollment_id = EXCLUDED.enrollment_id, topic = EXCLUDED.topic,
          start_time = EXCLUDED.start_time, duration_minutes = EXCLUDED.duration_minutes,
          status = EXCLUDED.status, meeting_url = NULL, mentor_notes = NULL,
          mentee_notes = NULL, action_items = '[]'::jsonb, prep_file_path = NULL,
          prep_file_notes = NULL, feedback_submitted_at = NULL;
        PERFORM public.demo_batch_3_register_resource(
          'mentoring_session', expected_id, registry_generation
        );
      END LOOP;
    END IF;

    IF cohort_key IN ('C', 'D') THEN
      completed_units := CASE WHEN cohort_key = 'D' OR position_no <= 6 THEN 2 ELSE 1 END;
      upcoming_units := CASE WHEN cohort_key = 'C' AND position_no >= 7 THEN 1 ELSE 0 END;
      FOR unit_no IN 1..completed_units LOOP
        expected_id := public.demo_batch_3_id('peer', i * 100 + unit_no);
        SELECT user_id, enrollment_id
        INTO provider_id, provider_enrollment_id
        FROM public.demo_batch_2_leader(
          CASE WHEN cohort_key = 'C'
            THEN 19 + (position_no % 12)
            ELSE 31 + (position_no % 10)
          END
        );
        INSERT INTO public.coachee_peer_sessions (
          id, peer_provider_id, peer_receiver_id, enrollment_id, topic,
          start_time, duration_minutes, status, receiver_rating,
          receiver_rating_comment, receiver_rated_at, meeting_url,
          provider_notes, provider_private_notes, receiver_notes, action_items
        )
        VALUES (
          expected_id, provider_id::uuid, leader.user_id, leader.enrollment_id,
          'Demo session',
          CASE WHEN cohort_key = 'D' THEN TIMESTAMPTZ '2025-02-03 15:00:00+07'
            ELSE TIMESTAMPTZ '2026-02-02 15:00:00+07' END
            + (unit_no - 1) * INTERVAL '28 days',
          60, 'completed', 3 + ((i + unit_no) % 3), NULL,
          TIMESTAMPTZ '2026-03-01 15:00:00+07', NULL, NULL, NULL, NULL, '[]'::jsonb
        )
        ON CONFLICT (id) DO UPDATE SET
          peer_provider_id = EXCLUDED.peer_provider_id,
          peer_receiver_id = EXCLUDED.peer_receiver_id,
          enrollment_id = EXCLUDED.enrollment_id, topic = EXCLUDED.topic,
          start_time = EXCLUDED.start_time, duration_minutes = EXCLUDED.duration_minutes,
          status = EXCLUDED.status, receiver_rating = EXCLUDED.receiver_rating,
          receiver_rating_comment = NULL, receiver_rated_at = EXCLUDED.receiver_rated_at,
          meeting_url = NULL, provider_notes = NULL, provider_private_notes = NULL,
          receiver_notes = NULL, action_items = '[]'::jsonb;
        PERFORM public.demo_batch_3_register_resource(
          'coachee_peer_session', expected_id, registry_generation
        );
      END LOOP;
      FOR unit_no IN 1..upcoming_units LOOP
        expected_id := public.demo_batch_3_id('peer', i * 100 + 50 + unit_no);
        SELECT user_id, enrollment_id
        INTO provider_id, provider_enrollment_id
        FROM public.demo_batch_2_leader(
          CASE WHEN cohort_key = 'C'
            THEN 19 + (position_no % 12)
            ELSE 31 + (position_no % 10)
          END
        );
        INSERT INTO public.coachee_peer_sessions (
          id, peer_provider_id, peer_receiver_id, enrollment_id, topic,
          start_time, duration_minutes, status, meeting_url, provider_notes,
          provider_private_notes, receiver_notes, action_items
        )
        VALUES (
          expected_id, provider_id::uuid, leader.user_id, leader.enrollment_id,
          'Demo session', TIMESTAMPTZ '2026-04-05 15:00:00+07'
            + (unit_no - 1) * INTERVAL '14 days',
          60, 'confirmed', NULL, NULL, NULL, NULL, '[]'::jsonb
        )
        ON CONFLICT (id) DO UPDATE SET
          peer_provider_id = EXCLUDED.peer_provider_id,
          peer_receiver_id = EXCLUDED.peer_receiver_id,
          enrollment_id = EXCLUDED.enrollment_id, topic = EXCLUDED.topic,
          start_time = EXCLUDED.start_time, duration_minutes = EXCLUDED.duration_minutes,
          status = EXCLUDED.status, receiver_rating = NULL,
          receiver_rating_comment = NULL, receiver_rated_at = NULL,
          meeting_url = NULL, provider_notes = NULL, provider_private_notes = NULL,
          receiver_notes = NULL, action_items = '[]'::jsonb;
        PERFORM public.demo_batch_3_register_resource(
          'coachee_peer_session', expected_id, registry_generation
        );
      END LOOP;
    END IF;
  END LOOP;

  -- Seven deterministic triad groups: four current-cohort groups and three
  -- completed-historical groups. D has two completed sessions per group;
  -- C has one completed and one upcoming session per group.
  FOR group_no IN 1..7 LOOP
    SELECT * INTO e1 FROM public.demo_batch_2_leader(
      CASE WHEN group_no <= 4 THEN 19 + (group_no - 1) * 3
        ELSE 31 + (group_no - 5) * 3 END
    );
    SELECT * INTO e2 FROM public.demo_batch_2_leader(e1.serial_number + 1);
    SELECT * INTO e3 FROM public.demo_batch_2_leader(e1.serial_number + 2);
    expected_id := public.demo_batch_3_id('triad_group', group_no);
    INSERT INTO public.triad_groups (
      id, cohort_id, programme_id, name, member_1_id, member_2_id,
      member_3_id, is_active, triad_round_id, assigned_by, group_language,
      enrollment_1_id, enrollment_2_id, enrollment_3_id, round_number
    )
    VALUES (
      expected_id, e1.cohort_id, e1.programme_id, 'Demo triad group',
      e1.user_id, e2.user_id, e3.user_id, true, NULL, 'admin', 'en',
      e1.enrollment_id, e2.enrollment_id, e3.enrollment_id,
      CASE WHEN group_no <= 4 THEN 1 ELSE 2 END
    )
    ON CONFLICT (id) DO UPDATE SET
      cohort_id = EXCLUDED.cohort_id, programme_id = EXCLUDED.programme_id,
      name = EXCLUDED.name, member_1_id = EXCLUDED.member_1_id,
      member_2_id = EXCLUDED.member_2_id, member_3_id = EXCLUDED.member_3_id,
      is_active = EXCLUDED.is_active, triad_round_id = NULL,
      assigned_by = EXCLUDED.assigned_by, group_language = EXCLUDED.group_language,
      enrollment_1_id = EXCLUDED.enrollment_1_id,
      enrollment_2_id = EXCLUDED.enrollment_2_id,
      enrollment_3_id = EXCLUDED.enrollment_3_id,
      round_number = EXCLUDED.round_number;
    PERFORM public.demo_batch_3_register_resource(
      'triad_group', expected_id, registry_generation
    );

    FOR session_no IN 1..2 LOOP
      expected_id := public.demo_batch_3_id(
        'triad_session', group_no * 10 + session_no
      );
      progress_complete := group_no >= 5 OR session_no = 1;
      activity_start := CASE WHEN group_no >= 5
        THEN TIMESTAMPTZ '2025-03-03 10:00:00+07'
        ELSE CASE WHEN session_no = 1
          THEN TIMESTAMPTZ '2026-02-16 10:00:00+07'
          ELSE TIMESTAMPTZ '2026-04-20 10:00:00+07' END END;
      INSERT INTO public.triad_sessions (
        id, triad_group_id, start_time, proposed_start_time,
        proposed_end_time, proposed_by, member_1_response,
        member_2_response, member_3_response, status,
        coach_enrollment_id, coachee_enrollment_id, observer_enrollment_id
      )
      VALUES (
        expected_id, public.demo_batch_3_id('triad_group', group_no),
        activity_start, activity_start, activity_start + INTERVAL '60 minutes',
        'demo', 'accepted', 'accepted', 'accepted',
        CASE WHEN progress_complete THEN 'completed' ELSE 'confirmed' END,
        e1.enrollment_id, e2.enrollment_id, e3.enrollment_id
      )
      ON CONFLICT (id) DO UPDATE SET
        triad_group_id = EXCLUDED.triad_group_id,
        start_time = EXCLUDED.start_time,
        proposed_start_time = EXCLUDED.proposed_start_time,
        proposed_end_time = EXCLUDED.proposed_end_time,
        proposed_by = EXCLUDED.proposed_by,
        member_1_response = EXCLUDED.member_1_response,
        member_2_response = EXCLUDED.member_2_response,
        member_3_response = EXCLUDED.member_3_response,
        status = EXCLUDED.status,
        coach_enrollment_id = EXCLUDED.coach_enrollment_id,
        coachee_enrollment_id = EXCLUDED.coachee_enrollment_id,
        observer_enrollment_id = EXCLUDED.observer_enrollment_id;
      PERFORM public.demo_batch_3_register_resource(
        'triad_session', expected_id, registry_generation
      );
    END LOOP;
  END LOOP;

  -- One neutral enrollment-level goal, two milestones, one numeric rating,
  -- one numeric check-in, and one or two normalized actions per leader.
  FOR i IN 1..40 LOOP
    SELECT * INTO leader FROM public.demo_batch_2_leader(i);
    cohort_key := public.demo_batch_3_programme_key(i);
    position_no := public.demo_batch_3_position(i);
    goal_id := public.demo_batch_3_id('goal', i);
    INSERT INTO public.coachee_goals (
      id, coachee_id, enrollment_id, title, description, target_date,
      status, sort_order
    )
    VALUES (
      goal_id, leader.user_id, leader.enrollment_id, 'Demo goal', NULL,
      CASE WHEN cohort_key = 'D' THEN DATE '2025-07-06'
        WHEN cohort_key = 'A' THEN DATE '2026-04-05'
        ELSE DATE '2026-07-05' END,
      CASE WHEN cohort_key = 'D' THEN 'completed' ELSE 'active' END, 0
    )
    ON CONFLICT (id) DO UPDATE SET
      coachee_id = EXCLUDED.coachee_id, enrollment_id = EXCLUDED.enrollment_id,
      title = EXCLUDED.title, description = NULL,
      target_date = EXCLUDED.target_date, status = EXCLUDED.status, sort_order = 0;

    PERFORM public.demo_batch_3_register_resource(
      'coachee_goal', goal_id, registry_generation
    );

    FOR unit_no IN 1..2 LOOP
      milestone_id := public.demo_batch_3_id('milestone', i * 10 + unit_no);
      INSERT INTO public.coachee_milestones (
        id, goal_id, coachee_id, enrollment_id, title, target_date,
        is_done, done_at, sort_order
      )
      VALUES (
        milestone_id, goal_id, leader.user_id, leader.enrollment_id,
        'Demo milestone',
        CASE WHEN cohort_key = 'D' THEN DATE '2025-03-06' + (unit_no - 1) * 60
          ELSE DATE '2026-03-06' + (unit_no - 1) * 60 END,
        cohort_key = 'D' OR (unit_no = 1 AND position_no <= 4),
        CASE WHEN cohort_key = 'D' OR (unit_no = 1 AND position_no <= 4)
          THEN CASE WHEN cohort_key = 'D' THEN TIMESTAMPTZ '2025-03-06 12:00:00+07'
            ELSE TIMESTAMPTZ '2026-03-06 12:00:00+07' END END,
        unit_no - 1
      )
      ON CONFLICT (id) DO UPDATE SET
        goal_id = EXCLUDED.goal_id, coachee_id = EXCLUDED.coachee_id,
        enrollment_id = EXCLUDED.enrollment_id, title = EXCLUDED.title,
        target_date = EXCLUDED.target_date, is_done = EXCLUDED.is_done,
        done_at = EXCLUDED.done_at, sort_order = EXCLUDED.sort_order;
      PERFORM public.demo_batch_3_register_resource(
        'coachee_milestone', milestone_id, registry_generation
      );
    END LOOP;

    expected_id := public.demo_batch_3_id('rating', i);
    INSERT INTO public.coachee_goal_ratings (
      id, goal_id, coachee_id, enrollment_id, start_rating,
      current_rating, target_rating, current_updated_at
    )
    VALUES (
      expected_id, goal_id, leader.user_id, leader.enrollment_id,
      30 + (i % 10),
      CASE WHEN cohort_key = 'D' THEN 80 + (i % 10)
        WHEN cohort_key = 'A' THEN CASE WHEN position_no <= 3 THEN 72 ELSE 52 END
        WHEN cohort_key = 'B' THEN 58 + (position_no % 4)
        ELSE 55 + (position_no % 5) END,
      85, CASE WHEN cohort_key = 'D' THEN TIMESTAMPTZ '2025-07-01 12:00:00+07'
        ELSE TIMESTAMPTZ '2026-03-10 12:00:00+07' END
    )
    ON CONFLICT (id) DO UPDATE SET
      goal_id = EXCLUDED.goal_id, coachee_id = EXCLUDED.coachee_id,
      enrollment_id = EXCLUDED.enrollment_id, start_rating = EXCLUDED.start_rating,
      current_rating = EXCLUDED.current_rating, target_rating = EXCLUDED.target_rating,
      current_updated_at = EXCLUDED.current_updated_at;
    PERFORM public.demo_batch_3_register_resource(
      'coachee_goal_rating', expected_id, registry_generation
    );

    expected_id := public.demo_batch_3_id('checkin', i);
    INSERT INTO public.goal_checkins (
      id, enrollment_id, goal_id, source_activity_type, source_activity_id,
      previous_rating, new_rating, note, actor_user_id
    )
    VALUES (
      expected_id, leader.enrollment_id, goal_id, 'coaching',
      public.demo_batch_3_id('coaching', i * 100 + 1),
      30 + (i % 10),
      CASE WHEN cohort_key = 'D' THEN 80 + (i % 10)
        ELSE 50 + (i % 20) END,
      NULL, leader.user_id
    )
    ON CONFLICT (id) DO UPDATE SET
      enrollment_id = EXCLUDED.enrollment_id, goal_id = EXCLUDED.goal_id,
      source_activity_type = EXCLUDED.source_activity_type,
      source_activity_id = EXCLUDED.source_activity_id,
      previous_rating = EXCLUDED.previous_rating, new_rating = EXCLUDED.new_rating,
      note = NULL, actor_user_id = EXCLUDED.actor_user_id;
    PERFORM public.demo_batch_3_register_resource(
      'goal_checkin', expected_id, registry_generation
    );

    FOR unit_no IN 1..(CASE
      WHEN cohort_key = 'D' OR (cohort_key = 'A' AND position_no = 8)
        OR (cohort_key IN ('B','C') AND position_no >= 9) THEN 2 ELSE 1
    END) LOOP
      expected_id := public.demo_batch_3_id('action', i * 10 + unit_no);
      INSERT INTO public.enrollment_actions (
        id, enrollment_id, goal_id, milestone_id, source_activity_type,
        source_activity_id, title, description, owner_user_id, due_date,
        status, completed_at
      )
      VALUES (
        expected_id, leader.enrollment_id, goal_id,
        public.demo_batch_3_id('milestone', i * 10 + least(unit_no, 2)),
        'coaching', public.demo_batch_3_id('coaching', i * 100 + 1),
        'Demo action', NULL, leader.user_id,
        CASE WHEN cohort_key = 'D' THEN DATE '2025-04-01'
          ELSE DATE '2026-04-01' END,
        CASE WHEN cohort_key = 'D' OR (unit_no = 1 AND position_no <= 4)
          THEN 'completed' ELSE 'open' END,
        CASE WHEN cohort_key = 'D' OR (unit_no = 1 AND position_no <= 4)
          THEN CASE WHEN cohort_key = 'D' THEN TIMESTAMPTZ '2025-03-28 12:00:00+07'
            ELSE TIMESTAMPTZ '2026-03-12 12:00:00+07' END END
      )
      ON CONFLICT (id) DO UPDATE SET
        enrollment_id = EXCLUDED.enrollment_id, goal_id = EXCLUDED.goal_id,
        milestone_id = EXCLUDED.milestone_id,
        source_activity_type = EXCLUDED.source_activity_type,
        source_activity_id = EXCLUDED.source_activity_id, title = EXCLUDED.title,
        description = NULL, owner_user_id = EXCLUDED.owner_user_id,
        due_date = EXCLUDED.due_date, status = EXCLUDED.status,
        completed_at = EXCLUDED.completed_at;
      PERFORM public.demo_batch_3_register_resource(
        'enrollment_action', expected_id, registry_generation
      );
    END LOOP;
  END LOOP;

  -- Training progress is intentionally limited to the three programmes where
  -- training is enabled. Every row is enrollment-scoped.
  FOR i IN 1..40 LOOP
    SELECT * INTO leader FROM public.demo_batch_2_leader(i);
    cohort_key := public.demo_batch_3_programme_key(i);
    position_no := public.demo_batch_3_position(i);
    IF cohort_key IN ('B', 'C', 'D') THEN
      FOR unit_no IN 1..6 LOOP
        progress_complete := CASE
          WHEN cohort_key = 'D' THEN true
          WHEN cohort_key = 'B' THEN unit_no <= CASE
            WHEN position_no <= 3 THEN 4
            WHEN position_no <= 6 THEN 3
            ELSE 2 END
          ELSE unit_no <= CASE
            WHEN position_no <= 4 THEN 5
            WHEN position_no <= 8 THEN 3
            ELSE 2 END
        END;
        training_week_id := public.demo_batch_3_id(
          'training_week',
          CASE cohort_key WHEN 'B' THEN 0 WHEN 'C' THEN 10 ELSE 20 END + unit_no
        );
        expected_id := public.demo_batch_3_id(
          'training_progress', i * 10 + unit_no
        );
        INSERT INTO public.training_progress (
          id, user_id, training_week_id, enrollment_id, viewed_at,
          completed_at, pdf_downloaded_at
        )
        VALUES (
          expected_id, leader.user_id, training_week_id, leader.enrollment_id,
          CASE WHEN progress_complete THEN
            CASE WHEN cohort_key = 'D' THEN TIMESTAMPTZ '2025-01-13 12:00:00+07'
              ELSE TIMESTAMPTZ '2026-01-12 12:00:00+07' END
            ELSE NULL END,
          CASE WHEN progress_complete THEN
            CASE WHEN cohort_key = 'D' THEN TIMESTAMPTZ '2025-01-15 12:00:00+07'
              ELSE TIMESTAMPTZ '2026-01-15 12:00:00+07' END
            ELSE NULL END,
          NULL
        )
        ON CONFLICT (id) DO UPDATE SET
          user_id = EXCLUDED.user_id, training_week_id = EXCLUDED.training_week_id,
          enrollment_id = EXCLUDED.enrollment_id, viewed_at = EXCLUDED.viewed_at,
          completed_at = EXCLUDED.completed_at, pdf_downloaded_at = NULL;
        PERFORM public.demo_batch_3_register_resource(
          'training_progress', expected_id, registry_generation
        );
      END LOOP;
    END IF;
  END LOOP;

  PERFORM public.demo_validate_batch_3_ownership();

  counts := jsonb_build_object(
    'programmeModules', 24,
    'trainingWeeks', 18,
    'enrollmentSnapshots', 254,
    'scheduleMilestones', 524,
    'coachingSessions', 128,
    'mentoringSessions', 60,
    'peerSessions', 44,
    'triadGroups', 7,
    'triadSessions', 14,
    'goals', 40,
    'goalMilestones', 80,
    'goalRatings', 40,
    'goalCheckins', 40,
    'actions', 57,
    'trainingProgress', 192,
    'sensitiveContentRows', 0,
    'ownershipResources', 1522
  );
  RETURN counts;
END;
$$;

-- Batch 3 reuses Batch 2's explicit ready-state reconciliation wrapper. The
-- wrapper retains the original lock, idempotency, and generation checks.
CREATE OR REPLACE FUNCTION public.demo_begin_batch_3_operation(
  p_organization_id uuid,
  p_operation text,
  p_idempotency_key text,
  p_requested_by uuid,
  p_fixture_version text,
  p_anchor_date date,
  p_expected_generation bigint DEFAULT NULL
) RETURNS public.demo_operations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN public.demo_begin_batch_2_operation(
    p_organization_id, p_operation, p_idempotency_key, p_requested_by,
    p_fixture_version, p_anchor_date, p_expected_generation
  );
END;
$$;

REVOKE ALL ON FUNCTION public.demo_batch_3_id(text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.demo_batch_3_programme_key(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.demo_batch_3_position(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.demo_batch_3_activity_resource_owned(text, uuid, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.demo_batch_3_register_resource(text, uuid, bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.demo_assert_batch_3_collisions() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.demo_validate_batch_3_ownership() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.demo_apply_batch_3(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.demo_begin_batch_3_operation(uuid, text, text, uuid, text, date, bigint) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.demo_assert_batch_3_collisions() TO service_role;
GRANT EXECUTE ON FUNCTION public.demo_validate_batch_3_ownership() TO service_role;
GRANT EXECUTE ON FUNCTION public.demo_apply_batch_3(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.demo_begin_batch_3_operation(uuid, text, text, uuid, text, date, bigint) TO service_role;