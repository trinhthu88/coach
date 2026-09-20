-- ============================================================================
-- DEMO GENERATOR -> CANONICAL TRIAD MODEL (ships before 20260918190000).
--
-- Production carries an out-of-band demo system (demo_* tables and
-- functions; "Clariva Demo Organization") that is not defined anywhere else
-- in this repository. Five of its functions read or write the legacy Triad
-- shape (slot members, role enrollments, round_number, per-member response
-- columns, group name / programme). Left as they are, the cutover's
-- final-state guard stops deployment 1, "Reset Demo Data" would write
-- legacy columns nothing reads, and deployment 2 would break them.
--
-- When (and only when) those functions exist, their Triad parts are
-- replaced by the canonical model; nothing else in them changes (the bodies
-- below are the production definitions of 2026-09-19 with the Triad parts
-- rewritten):
--   demo_apply_batch_3 ........................ cohort group + members +
--                                                scheduled sessions + responses;
--                                                Cohort D gets two DISTINCT
--                                                completed sessions (the old
--                                                generator gave both the same
--                                                timestamp)
--   demo_assert_batch_4_cross_org_references ... group cohort + member
--                                                enrollments' profile / programme
--   demo_assert_batch_4_privacy ................ groups carry no name
--   demo_validate_batch_3_ownership ............ group programme via its cohort
--   demo_delete_batch_4_owned_resources ........ the demo reset is the
--                                                privileged correction workflow
--                                                for registered demo Triad
--                                                history (clariva.demo_reset)
-- Local / fresh databases have no demo system: this migration is a no-op there.
-- ============================================================================

DO $demo_migration$
BEGIN
  IF to_regclass('public.demo_resource_registry') IS NULL THEN
    RETURN;
  END IF;

  IF to_regprocedure('public.demo_apply_batch_3(uuid)') IS NOT NULL THEN
    EXECUTE $demo_def$
CREATE OR REPLACE FUNCTION public.demo_apply_batch_3(p_operation_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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

  -- Seven deterministic cohort Triad groups: four current-cohort (C) groups
  -- and three completed-historical (D) groups, in the canonical Triad model:
  -- a group belongs to its cohort, members are enrollments, and a session is
  -- one actual practice session of the group (scheduled time, status,
  -- responses). C: Session 1 completed (16 Feb), Session 2 confirmed
  -- (20 Apr). D: two DISTINCT completed sessions (3 Mar and 2 Jun 2025) —
  -- the earlier generator gave both D sessions the same timestamp.
  FOR group_no IN 1..7 LOOP
    SELECT * INTO e1 FROM public.demo_batch_2_leader(
      CASE WHEN group_no <= 4 THEN 19 + (group_no - 1) * 3
        ELSE 31 + (group_no - 5) * 3 END
    );
    SELECT * INTO e2 FROM public.demo_batch_2_leader(e1.serial_number + 1);
    SELECT * INTO e3 FROM public.demo_batch_2_leader(e1.serial_number + 2);
    expected_id := public.demo_batch_3_id('triad_group', group_no);
    INSERT INTO public.triad_groups (id, cohort_id, is_active, assigned_by, group_language)
    VALUES (expected_id, e1.cohort_id, true, 'admin', 'en')
    ON CONFLICT (id) DO NOTHING;
    INSERT INTO public.triad_group_members (triad_group_id, enrollment_id, member_order)
    SELECT expected_id, m.enrollment_id, m.ord
    FROM (VALUES (e1.enrollment_id, 1), (e2.enrollment_id, 2), (e3.enrollment_id, 3)) AS m(enrollment_id, ord)
    WHERE NOT EXISTS (
      SELECT 1 FROM public.triad_group_members x
      WHERE x.triad_group_id = expected_id AND x.enrollment_id = m.enrollment_id
    );
    PERFORM public.demo_batch_3_register_resource(
      'triad_group', expected_id, registry_generation
    );

    FOR session_no IN 1..2 LOOP
      expected_id := public.demo_batch_3_id(
        'triad_session', group_no * 10 + session_no
      );
      progress_complete := group_no >= 5 OR session_no = 1;
      activity_start := CASE WHEN group_no >= 5
        THEN CASE WHEN session_no = 1
          THEN TIMESTAMPTZ '2025-03-03 10:00:00+07'
          ELSE TIMESTAMPTZ '2025-06-02 10:00:00+07' END
        ELSE CASE WHEN session_no = 1
          THEN TIMESTAMPTZ '2026-02-16 10:00:00+07'
          ELSE TIMESTAMPTZ '2026-04-20 10:00:00+07' END END;
      -- A completed session is final history: it is only ever inserted.
      INSERT INTO public.triad_sessions (id, triad_group_id, scheduled_start_time, scheduled_end_time, status)
      SELECT expected_id, public.demo_batch_3_id('triad_group', group_no),
        activity_start, activity_start + INTERVAL '60 minutes',
        CASE WHEN progress_complete THEN 'completed' ELSE 'confirmed' END
      WHERE NOT EXISTS (SELECT 1 FROM public.triad_sessions s WHERE s.id = expected_id);
      INSERT INTO public.triad_session_responses (triad_session_id, enrollment_id, response, responded_at)
      SELECT expected_id, m, 'accepted', activity_start - INTERVAL '7 days'
      FROM unnest(ARRAY[e1.enrollment_id, e2.enrollment_id, e3.enrollment_id]) AS m
      ON CONFLICT (triad_session_id, enrollment_id) DO NOTHING;
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
$function$
$demo_def$;
  END IF;

  IF to_regprocedure('public.demo_assert_batch_4_cross_org_references()') IS NOT NULL THEN
    EXECUTE $demo_def$
CREATE OR REPLACE FUNCTION public.demo_assert_batch_4_cross_org_references()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  fixed_org uuid := 'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2e7a01'::uuid;
  bad_count integer;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.demo_resource_registry r
    WHERE r.organization_id <> fixed_org
       OR r.resource_type NOT IN (
         'organization', 'programme', 'cohort', 'auth_user', 'demo_account',
         'profile', 'user_role', 'coachee_profile', 'coach_profile',
         'sponsor_profile', 'enrollment', 'programme_module', 'training_week',
         'enrollment_module_snapshot', 'enrollment_module_milestone', 'session',
         'mentoring_session', 'coachee_peer_session', 'triad_group',
         'triad_session', 'coachee_goal', 'coachee_milestone',
         'coachee_goal_rating', 'goal_checkin', 'enrollment_action',
         'training_progress'
       )
  ) THEN
    RAISE EXCEPTION 'Batch 4 found an invalid or cross-organization ownership row'
      USING ERRCODE = '42501';
  END IF;

  SELECT count(*) INTO bad_count
  FROM public.programme_enrollments e
  WHERE e.id IN (
    SELECT resource_id FROM public.demo_resource_registry
    WHERE organization_id = fixed_org AND resource_type = 'enrollment'
  )
  AND e.organization_id IS DISTINCT FROM fixed_org;
  IF bad_count <> 0 THEN
    RAISE EXCEPTION 'Batch 4 found % demo enrollments linked to another organization',
      bad_count USING ERRCODE = '42501';
  END IF;

  SELECT count(*) INTO bad_count
  FROM public.programme_enrollments e
  WHERE e.id IN (
    SELECT resource_id FROM public.demo_resource_registry
    WHERE organization_id = fixed_org AND resource_type = 'enrollment'
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.demo_resource_registry r
    WHERE r.organization_id = fixed_org
      AND r.resource_type = 'profile'
      AND r.resource_id = e.user_id
  );
  IF bad_count <> 0 THEN
    RAISE EXCEPTION 'Batch 4 found % demo enrollments linked to unowned profiles',
      bad_count USING ERRCODE = '42501';
  END IF;

  SELECT count(*) INTO bad_count
  FROM public.sessions s
  WHERE s.id IN (
    SELECT resource_id FROM public.demo_resource_registry
    WHERE organization_id = fixed_org AND resource_type = 'session'
  )
  AND (
    NOT EXISTS (
      SELECT 1 FROM public.demo_resource_registry r
      WHERE r.organization_id = fixed_org AND r.resource_type = 'enrollment'
        AND r.resource_id = s.enrollment_id
    )
    OR NOT EXISTS (
      SELECT 1 FROM public.demo_resource_registry r
      WHERE r.organization_id = fixed_org AND r.resource_type = 'profile'
        AND r.resource_id = s.coach_id
    )
    OR NOT EXISTS (
      SELECT 1 FROM public.demo_resource_registry r
      WHERE r.organization_id = fixed_org AND r.resource_type = 'profile'
        AND r.resource_id = s.coachee_id
    )
  );
  IF bad_count <> 0 THEN
    RAISE EXCEPTION 'Batch 4 found % coaching rows with cross-organization references',
      bad_count USING ERRCODE = '42501';
  END IF;

  SELECT count(*) INTO bad_count
  FROM public.mentoring_sessions s
  WHERE s.id IN (
    SELECT resource_id FROM public.demo_resource_registry
    WHERE organization_id = fixed_org AND resource_type = 'mentoring_session'
  )
  AND (
    NOT EXISTS (
      SELECT 1 FROM public.demo_resource_registry r
      WHERE r.organization_id = fixed_org AND r.resource_type = 'enrollment'
        AND r.resource_id = s.enrollment_id
    )
    OR NOT EXISTS (
      SELECT 1 FROM public.demo_resource_registry r
      WHERE r.organization_id = fixed_org AND r.resource_type = 'profile'
        AND r.resource_id = s.mentor_id
    )
    OR NOT EXISTS (
      SELECT 1 FROM public.demo_resource_registry r
      WHERE r.organization_id = fixed_org AND r.resource_type = 'profile'
        AND r.resource_id = s.mentee_id
    )
  );
  IF bad_count <> 0 THEN
    RAISE EXCEPTION 'Batch 4 found % mentoring rows with cross-organization references',
      bad_count USING ERRCODE = '42501';
  END IF;

  SELECT count(*) INTO bad_count
  FROM public.coachee_peer_sessions s
  WHERE s.id IN (
    SELECT resource_id FROM public.demo_resource_registry
    WHERE organization_id = fixed_org AND resource_type = 'coachee_peer_session'
  )
  AND (
    NOT EXISTS (
      SELECT 1 FROM public.demo_resource_registry r
      WHERE r.organization_id = fixed_org AND r.resource_type = 'enrollment'
        AND r.resource_id = s.enrollment_id
    )
    OR NOT EXISTS (
      SELECT 1 FROM public.demo_resource_registry r
      WHERE r.organization_id = fixed_org AND r.resource_type = 'profile'
        AND r.resource_id = s.peer_provider_id
    )
    OR NOT EXISTS (
      SELECT 1 FROM public.demo_resource_registry r
      WHERE r.organization_id = fixed_org AND r.resource_type = 'profile'
        AND r.resource_id = s.peer_receiver_id
    )
  );
  IF bad_count <> 0 THEN
    RAISE EXCEPTION 'Batch 4 found % peer rows with cross-organization references',
      bad_count USING ERRCODE = '42501';
  END IF;

  SELECT count(*) INTO bad_count
  FROM public.triad_groups g
  WHERE g.id IN (
    SELECT resource_id FROM public.demo_resource_registry
    WHERE organization_id = fixed_org AND resource_type = 'triad_group'
  )
  AND (
    NOT EXISTS (
      SELECT 1 FROM public.demo_resource_registry r
      WHERE r.organization_id = fixed_org AND r.resource_type = 'cohort'
        AND r.resource_id = g.cohort_id
    )
    OR EXISTS (
      SELECT 1 FROM public.triad_group_members m
      JOIN public.programme_enrollments e ON e.id = m.enrollment_id
      WHERE m.triad_group_id = g.id
        AND (NOT EXISTS (
               SELECT 1 FROM public.demo_resource_registry r
               WHERE r.organization_id = fixed_org AND r.resource_type = 'profile'
                 AND r.resource_id = e.user_id)
          OR NOT EXISTS (
               SELECT 1 FROM public.demo_resource_registry r
               WHERE r.organization_id = fixed_org AND r.resource_type = 'programme'
                 AND r.resource_id = e.programme_id))
    )
  );
  IF bad_count <> 0 THEN
    RAISE EXCEPTION 'Batch 4 found % triad groups with cross-organization references',
      bad_count USING ERRCODE = '42501';
  END IF;

  SELECT count(*) INTO bad_count
  FROM public.triad_sessions s
  WHERE s.id IN (
    SELECT resource_id FROM public.demo_resource_registry
    WHERE organization_id = fixed_org AND resource_type = 'triad_session'
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.demo_resource_registry r
    WHERE r.organization_id = fixed_org AND r.resource_type = 'triad_group'
      AND r.resource_id = s.triad_group_id
  );
  IF bad_count <> 0 THEN
    RAISE EXCEPTION 'Batch 4 found % triad sessions with cross-organization groups',
      bad_count USING ERRCODE = '42501';
  END IF;

  SELECT count(*) INTO bad_count
  FROM public.coachee_goals g
  WHERE g.id IN (
    SELECT resource_id FROM public.demo_resource_registry
    WHERE organization_id = fixed_org AND resource_type = 'coachee_goal'
  )
  AND (
    NOT EXISTS (
      SELECT 1 FROM public.demo_resource_registry r
      WHERE r.organization_id = fixed_org AND r.resource_type = 'enrollment'
        AND r.resource_id = g.enrollment_id
    )
    OR NOT EXISTS (
      SELECT 1 FROM public.demo_resource_registry r
      WHERE r.organization_id = fixed_org AND r.resource_type = 'profile'
        AND r.resource_id = g.coachee_id
    )
  );
  IF bad_count <> 0 THEN
    RAISE EXCEPTION 'Batch 4 found % goals with cross-organization references',
      bad_count USING ERRCODE = '42501';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.programme_modules pm
    WHERE pm.programme_id IN (
      SELECT resource_id FROM public.demo_resource_registry
      WHERE organization_id = fixed_org AND resource_type = 'programme'
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.demo_resource_registry r
      WHERE r.organization_id = fixed_org
        AND r.resource_type = 'programme_module'
        AND r.resource_id = pm.id
    )
  ) OR EXISTS (
    SELECT 1
    FROM public.training_weeks tw
    WHERE tw.programme_id IN (
      SELECT resource_id FROM public.demo_resource_registry
      WHERE organization_id = fixed_org AND resource_type = 'programme'
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.demo_resource_registry r
      WHERE r.organization_id = fixed_org
        AND r.resource_type = 'training_week'
        AND r.resource_id = tw.id
    )
  ) OR EXISTS (
    SELECT 1
    FROM public.cohorts c
    WHERE c.programme_id IN (
      SELECT resource_id FROM public.demo_resource_registry
      WHERE organization_id = fixed_org AND resource_type = 'programme'
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.demo_resource_registry r
      WHERE r.organization_id = fixed_org
        AND r.resource_type = 'cohort'
        AND r.resource_id = c.id
    )
  ) OR EXISTS (
    SELECT 1
    FROM public.programme_enrollments e
    WHERE (
      e.organization_id = fixed_org
      OR e.programme_id IN (
        SELECT resource_id FROM public.demo_resource_registry
        WHERE organization_id = fixed_org AND resource_type = 'programme'
      )
      OR e.cohort_id IN (
        SELECT resource_id FROM public.demo_resource_registry
        WHERE organization_id = fixed_org AND resource_type = 'cohort'
      )
    )
      AND NOT EXISTS (
        SELECT 1 FROM public.demo_resource_registry r
        WHERE r.organization_id = fixed_org
          AND r.resource_type = 'enrollment'
          AND r.resource_id = e.id
      )
  ) OR EXISTS (
    SELECT 1
    FROM public.programme_reflections pr
    WHERE pr.programme_id IN (
      SELECT resource_id FROM public.demo_resource_registry
      WHERE organization_id = fixed_org AND resource_type = 'programme'
    )
  ) OR EXISTS (
    SELECT 1
    FROM public.assignments a
    WHERE a.training_week_id IN (
      SELECT resource_id FROM public.demo_resource_registry
      WHERE organization_id = fixed_org AND resource_type = 'training_week'
    )
  ) OR EXISTS (
    SELECT 1
    FROM public.daily_prompts p
    WHERE p.training_week_id IN (
      SELECT resource_id FROM public.demo_resource_registry
      WHERE organization_id = fixed_org AND resource_type = 'training_week'
    )
  ) THEN
    RAISE EXCEPTION 'Batch 4 found unregistered rows that would be affected by reset'
      USING ERRCODE = '42501';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.cohorts c
    WHERE c.id IN (
      SELECT resource_id FROM public.demo_resource_registry
      WHERE organization_id = fixed_org AND resource_type = 'cohort'
    )
    AND c.organization_id IS DISTINCT FROM fixed_org
  ) THEN
    RAISE EXCEPTION 'Batch 4 found a demo cohort linked to another organization'
      USING ERRCODE = '42501';
  END IF;
END;
$function$
$demo_def$;
  END IF;

  IF to_regprocedure('public.demo_assert_batch_4_privacy()') IS NOT NULL THEN
    EXECUTE $demo_def$
CREATE OR REPLACE FUNCTION public.demo_assert_batch_4_privacy()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  fixed_org uuid := 'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2e7a01'::uuid;
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.sessions s
    JOIN public.demo_resource_registry r
      ON r.resource_type = 'session' AND r.resource_id = s.id
    WHERE r.organization_id = fixed_org
      AND (s.topic <> 'Demo session' OR s.coach_notes IS NOT NULL
        OR s.coachee_notes IS NOT NULL OR s.action_items <> '[]'::jsonb
        OR s.meeting_url IS NOT NULL
        OR s.coachee_rating_comment IS NOT NULL)
  ) THEN
    RAISE EXCEPTION 'Batch 4 coaching privacy boundary failed';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.mentoring_sessions s
    JOIN public.demo_resource_registry r
      ON r.resource_type = 'mentoring_session' AND r.resource_id = s.id
    WHERE r.organization_id = fixed_org
      AND (s.topic <> 'Demo session' OR s.mentor_notes IS NOT NULL
        OR s.mentee_notes IS NOT NULL OR s.action_items <> '[]'::jsonb
        OR s.meeting_url IS NOT NULL OR s.prep_file_notes IS NOT NULL
        OR s.feedback_submitted_at IS NOT NULL
        OR (s.prep_file_path IS NOT NULL AND s.prep_file_path <> 'demo://no-file-content'))
  ) THEN
    RAISE EXCEPTION 'Batch 4 mentoring privacy boundary failed';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.coachee_peer_sessions s
    JOIN public.demo_resource_registry r
      ON r.resource_type = 'coachee_peer_session' AND r.resource_id = s.id
    WHERE r.organization_id = fixed_org
      AND (s.topic <> 'Demo session' OR s.provider_notes IS NOT NULL
        OR s.provider_private_notes IS NOT NULL OR s.receiver_notes IS NOT NULL
        OR s.action_items <> '[]'::jsonb OR s.meeting_url IS NOT NULL
        OR s.receiver_rating_comment IS NOT NULL)
  ) THEN
    RAISE EXCEPTION 'Batch 4 peer privacy boundary failed';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.triad_sessions s
    JOIN public.demo_resource_registry r
      ON r.resource_type = 'triad_session' AND r.resource_id = s.id
    WHERE r.organization_id = fixed_org AND s.notes IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Batch 4 triad privacy boundary failed';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.coachee_goals g
    JOIN public.demo_resource_registry r
      ON r.resource_type = 'coachee_goal' AND r.resource_id = g.id
    WHERE r.organization_id = fixed_org
      AND (g.title <> 'Demo goal' OR g.description IS NOT NULL)
  ) OR EXISTS (
    SELECT 1 FROM public.coachee_milestones m
    JOIN public.demo_resource_registry r
      ON r.resource_type = 'coachee_milestone' AND r.resource_id = m.id
    WHERE r.organization_id = fixed_org
      AND m.title <> 'Demo milestone'
  ) OR EXISTS (
    SELECT 1 FROM public.enrollment_actions a
    JOIN public.demo_resource_registry r
      ON r.resource_type = 'enrollment_action' AND r.resource_id = a.id
    WHERE r.organization_id = fixed_org
      AND (a.title <> 'Demo action' OR a.description IS NOT NULL)
  ) OR EXISTS (
    SELECT 1 FROM public.goal_checkins c
    JOIN public.demo_resource_registry r
      ON r.resource_type = 'goal_checkin' AND r.resource_id = c.id
    WHERE r.organization_id = fixed_org AND c.note IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Batch 4 goal and action privacy boundary failed';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.programme_enrollments e
    WHERE e.organization_id = fixed_org
      AND (
        EXISTS (SELECT 1 FROM public.reflection_submissions x WHERE x.enrollment_id = e.id)
        OR EXISTS (SELECT 1 FROM public.assignment_submissions x WHERE x.enrollment_id = e.id)
        OR EXISTS (SELECT 1 FROM public.daily_prompt_responses x WHERE x.enrollment_id = e.id)
        OR EXISTS (SELECT 1 FROM public.triad_reflections x WHERE x.enrollment_id = e.id)
      )
  ) THEN
    RAISE EXCEPTION 'Batch 4 created restricted sponsor-content rows';
  END IF;
END;
$function$
$demo_def$;
  END IF;

  IF to_regprocedure('public.demo_validate_batch_3_ownership()') IS NOT NULL THEN
    EXECUTE $demo_def$
CREATE OR REPLACE FUNCTION public.demo_validate_batch_3_ownership()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
    JOIN public.cohorts c ON c.id = g.cohort_id
    WHERE c.programme_id IN (
      'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2a0103'::uuid,
      'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2a0104'::uuid
    )
    UNION ALL
    SELECT 'triad_session', s.id FROM public.triad_sessions s
    JOIN public.triad_groups g ON g.id = s.triad_group_id
    JOIN public.cohorts c ON c.id = g.cohort_id
    WHERE c.programme_id IN (
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
$function$
$demo_def$;
  END IF;

  IF to_regprocedure('public.demo_delete_batch_4_owned_resources(uuid)') IS NOT NULL THEN
    EXECUTE $demo_def$
CREATE OR REPLACE FUNCTION public.demo_delete_batch_4_owned_resources(p_operation_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  operation_row public.demo_operations;
  fixed_org uuid := 'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2e7a01'::uuid;
  deleted_count integer := 0;
  rows_deleted integer;
  fk record;
  has_profile_reference boolean;
BEGIN
  SELECT * INTO operation_row
  FROM public.demo_operations
  WHERE id = p_operation_id
  FOR UPDATE;
  IF NOT FOUND OR operation_row.status <> 'started' OR operation_row.operation <> 'reset' THEN
    RAISE EXCEPTION 'Batch 4 reset requires a started reset operation'
      USING ERRCODE = 'P0001';
  END IF;

  PERFORM public.demo_assert_service_target(
    operation_row.organization_id,
    operation_row.fixture_version,
    operation_row.anchor_date
  );
  PERFORM public.demo_validate_batch_4_ownership();

  DELETE FROM public.goal_checkins
  WHERE id IN (SELECT resource_id FROM public.demo_resource_registry
              WHERE organization_id = fixed_org AND resource_type = 'goal_checkin');
  GET DIAGNOSTICS rows_deleted = ROW_COUNT; deleted_count := deleted_count + rows_deleted;

  DELETE FROM public.enrollment_actions
  WHERE id IN (SELECT resource_id FROM public.demo_resource_registry
              WHERE organization_id = fixed_org AND resource_type = 'enrollment_action');
  GET DIAGNOSTICS rows_deleted = ROW_COUNT; deleted_count := deleted_count + rows_deleted;

  DELETE FROM public.coachee_goal_ratings
  WHERE id IN (SELECT resource_id FROM public.demo_resource_registry
              WHERE organization_id = fixed_org AND resource_type = 'coachee_goal_rating');
  GET DIAGNOSTICS rows_deleted = ROW_COUNT; deleted_count := deleted_count + rows_deleted;

  DELETE FROM public.coachee_milestones
  WHERE id IN (SELECT resource_id FROM public.demo_resource_registry
              WHERE organization_id = fixed_org AND resource_type = 'coachee_milestone');
  GET DIAGNOSTICS rows_deleted = ROW_COUNT; deleted_count := deleted_count + rows_deleted;

  DELETE FROM public.coachee_goals
  WHERE id IN (SELECT resource_id FROM public.demo_resource_registry
              WHERE organization_id = fixed_org AND resource_type = 'coachee_goal');
  GET DIAGNOSTICS rows_deleted = ROW_COUNT; deleted_count := deleted_count + rows_deleted;

  DELETE FROM public.training_progress
  WHERE id IN (SELECT resource_id FROM public.demo_resource_registry
              WHERE organization_id = fixed_org AND resource_type = 'training_progress');
  GET DIAGNOSTICS rows_deleted = ROW_COUNT; deleted_count := deleted_count + rows_deleted;

  -- Demo reset is the privileged correction workflow for registered demo
  -- Triad history (triad_demo_reset_allows); nothing else may delete it.
  PERFORM set_config('clariva.demo_reset', 'on', true);
  DELETE FROM public.triad_sessions
  WHERE id IN (SELECT resource_id FROM public.demo_resource_registry
              WHERE organization_id = fixed_org AND resource_type = 'triad_session');
  GET DIAGNOSTICS rows_deleted = ROW_COUNT; deleted_count := deleted_count + rows_deleted;

  DELETE FROM public.triad_groups
  WHERE id IN (SELECT resource_id FROM public.demo_resource_registry
              WHERE organization_id = fixed_org AND resource_type = 'triad_group');
  GET DIAGNOSTICS rows_deleted = ROW_COUNT; deleted_count := deleted_count + rows_deleted;
  PERFORM set_config('clariva.demo_reset', 'off', true);

  DELETE FROM public.sessions
  WHERE id IN (SELECT resource_id FROM public.demo_resource_registry
              WHERE organization_id = fixed_org AND resource_type = 'session');
  GET DIAGNOSTICS rows_deleted = ROW_COUNT; deleted_count := deleted_count + rows_deleted;

  DELETE FROM public.mentoring_sessions
  WHERE id IN (SELECT resource_id FROM public.demo_resource_registry
              WHERE organization_id = fixed_org AND resource_type = 'mentoring_session');
  GET DIAGNOSTICS rows_deleted = ROW_COUNT; deleted_count := deleted_count + rows_deleted;

  DELETE FROM public.coachee_peer_sessions
  WHERE id IN (SELECT resource_id FROM public.demo_resource_registry
              WHERE organization_id = fixed_org AND resource_type = 'coachee_peer_session');
  GET DIAGNOSTICS rows_deleted = ROW_COUNT; deleted_count := deleted_count + rows_deleted;

  DELETE FROM public.enrollment_module_milestones
  WHERE id IN (SELECT resource_id FROM public.demo_resource_registry
              WHERE organization_id = fixed_org AND resource_type = 'enrollment_module_milestone');
  GET DIAGNOSTICS rows_deleted = ROW_COUNT; deleted_count := deleted_count + rows_deleted;

  DELETE FROM public.enrollment_module_snapshots
  WHERE id IN (SELECT resource_id FROM public.demo_resource_registry
              WHERE organization_id = fixed_org AND resource_type = 'enrollment_module_snapshot');
  GET DIAGNOSTICS rows_deleted = ROW_COUNT; deleted_count := deleted_count + rows_deleted;

  DELETE FROM public.programme_modules
  WHERE id IN (SELECT resource_id FROM public.demo_resource_registry
              WHERE organization_id = fixed_org AND resource_type = 'programme_module');
  GET DIAGNOSTICS rows_deleted = ROW_COUNT; deleted_count := deleted_count + rows_deleted;

  DELETE FROM public.training_weeks
  WHERE id IN (SELECT resource_id FROM public.demo_resource_registry
              WHERE organization_id = fixed_org AND resource_type = 'training_week');
  GET DIAGNOSTICS rows_deleted = ROW_COUNT; deleted_count := deleted_count + rows_deleted;

  DELETE FROM public.programme_enrollments
  WHERE id IN (SELECT resource_id FROM public.demo_resource_registry
              WHERE organization_id = fixed_org AND resource_type = 'enrollment');
  GET DIAGNOSTICS rows_deleted = ROW_COUNT; deleted_count := deleted_count + rows_deleted;

  DELETE FROM public.demo_accounts
  WHERE organization_id = fixed_org;
  GET DIAGNOSTICS rows_deleted = ROW_COUNT; deleted_count := deleted_count + rows_deleted;

  DELETE FROM public.sponsor_profiles
  WHERE user_id IN (SELECT resource_id FROM public.demo_resource_registry
                    WHERE organization_id = fixed_org AND resource_type = 'sponsor_profile');
  DELETE FROM public.coach_profiles
  WHERE id IN (SELECT resource_id FROM public.demo_resource_registry
              WHERE organization_id = fixed_org AND resource_type = 'coach_profile');
  DELETE FROM public.coachee_profiles
  WHERE id IN (SELECT resource_id FROM public.demo_resource_registry
              WHERE organization_id = fixed_org AND resource_type = 'coachee_profile');

  DELETE FROM public.user_roles
  WHERE id IN (SELECT resource_id FROM public.demo_resource_registry
              WHERE organization_id = fixed_org AND resource_type = 'user_role');

  FOR fk IN
    SELECT DISTINCT
      tc.table_schema,
      tc.table_name,
      kcu.column_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON kcu.constraint_name = tc.constraint_name
     AND kcu.constraint_schema = tc.constraint_schema
    JOIN information_schema.constraint_column_usage ccu
      ON ccu.constraint_name = tc.constraint_name
     AND ccu.constraint_schema = tc.constraint_schema
    JOIN information_schema.referential_constraints rc
      ON rc.constraint_name = tc.constraint_name
     AND rc.constraint_schema = tc.constraint_schema
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND tc.table_schema = 'public'
      AND ccu.table_schema = 'public'
      AND ccu.table_name = 'profiles'
      AND ccu.column_name = 'id'
      AND rc.delete_rule <> 'CASCADE'
  LOOP
    EXECUTE format(
      'SELECT EXISTS (
         SELECT 1 FROM %I.%I child
         WHERE child.%I IN (
           SELECT resource_id
           FROM public.demo_resource_registry
           WHERE organization_id = $1 AND resource_type = ''profile''
         )
       )',
      fk.table_schema,
      fk.table_name,
      fk.column_name
    )
    INTO has_profile_reference
    USING fixed_org;

    IF has_profile_reference THEN
      RAISE EXCEPTION 'Batch 4 found an unregistered profile reference in %.%',
        fk.table_schema, fk.table_name
        USING ERRCODE = '42501';
    END IF;
  END LOOP;

  DELETE FROM public.profiles
  WHERE id IN (SELECT resource_id FROM public.demo_resource_registry
              WHERE organization_id = fixed_org AND resource_type = 'profile');
  DELETE FROM auth.users
  WHERE id IN (SELECT resource_id FROM public.demo_resource_registry
              WHERE organization_id = fixed_org AND resource_type = 'auth_user');

  DELETE FROM public.cohorts
  WHERE id IN (SELECT resource_id FROM public.demo_resource_registry
              WHERE organization_id = fixed_org AND resource_type = 'cohort');
  DELETE FROM public.programmes
  WHERE id IN (SELECT resource_id FROM public.demo_resource_registry
              WHERE organization_id = fixed_org AND resource_type = 'programme');

  DELETE FROM public.demo_resource_registry
  WHERE organization_id = fixed_org;

  RETURN jsonb_build_object(
    'deletedRows', deleted_count,
    'deletedOwnershipResources', 1743,
    'preservedOrganization', true,
    'preservedNonDemoRows', true
  );
END;
$function$
$demo_def$;
  END IF;
END
$demo_migration$;
