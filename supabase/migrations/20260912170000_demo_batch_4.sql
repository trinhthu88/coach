-- Batch 4: full, fixed-target demo reset/rebuild executor.
--
-- Reset is deliberately separate from the reconciliation migrations. It
-- removes only rows whose IDs are already present in the demo ownership
-- registry, keeps the fixed organization and its registry row, then reuses
-- the Batch 2 and Batch 3 reconcilers inside the same transaction and
-- operation lifecycle.

CREATE OR REPLACE FUNCTION public.demo_assert_batch_4_cross_org_references()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
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
    OR NOT EXISTS (
      SELECT 1 FROM public.demo_resource_registry r
      WHERE r.organization_id = fixed_org AND r.resource_type = 'programme'
        AND r.resource_id = g.programme_id
    )
    OR NOT EXISTS (
      SELECT 1 FROM public.demo_resource_registry r
      WHERE r.organization_id = fixed_org AND r.resource_type = 'profile'
        AND r.resource_id = g.member_1_id
    )
    OR NOT EXISTS (
      SELECT 1 FROM public.demo_resource_registry r
      WHERE r.organization_id = fixed_org AND r.resource_type = 'profile'
        AND r.resource_id = g.member_2_id
    )
    OR NOT EXISTS (
      SELECT 1 FROM public.demo_resource_registry r
      WHERE r.organization_id = fixed_org AND r.resource_type = 'profile'
        AND r.resource_id = g.member_3_id
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
$$;

CREATE OR REPLACE FUNCTION public.demo_assert_batch_4_privacy()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  fixed_org uuid := 'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2e7a01'::uuid;
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.sessions s
    JOIN public.demo_resource_registry r
      ON r.resource_type = 'session' AND r.resource_id = s.id
    WHERE r.organization_id = fixed_org
      AND (s.topic <> 'Demo session' OR s.coach_notes IS NOT NULL
        OR s.coach_private_notes IS NOT NULL OR s.coachee_notes IS NOT NULL
        OR s.action_items <> '[]'::jsonb OR s.meeting_url IS NOT NULL
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
    SELECT 1 FROM public.triad_groups g
    JOIN public.demo_resource_registry r
      ON r.resource_type = 'triad_group' AND r.resource_id = g.id
    WHERE r.organization_id = fixed_org AND g.name <> 'Demo triad group'
  ) OR EXISTS (
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
$$;

CREATE OR REPLACE FUNCTION public.demo_validate_batch_4_ownership()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  fixed_org uuid := 'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2e7a01'::uuid;
  expected_count integer := 1746;
  actual_count integer;
BEGIN
  PERFORM public.demo_assert_batch_3_collisions();
  PERFORM public.demo_assert_batch_4_cross_org_references();
  PERFORM public.demo_assert_batch_4_privacy();

  IF (
    SELECT count(*) FROM public.demo_resource_registry
    WHERE organization_id = fixed_org AND resource_type = 'organization'
  ) <> 1
  OR (
    SELECT count(*) FROM public.demo_resource_registry
    WHERE organization_id = fixed_org AND resource_type = 'programme'
  ) <> 4
  OR (
    SELECT count(*) FROM public.demo_resource_registry
    WHERE organization_id = fixed_org AND resource_type = 'cohort'
  ) <> 4
  OR (
    SELECT count(*) FROM public.demo_resource_registry
    WHERE organization_id = fixed_org AND resource_type = 'enrollment'
  ) <> 40
  OR (
    SELECT count(*) FROM public.demo_resource_registry
    WHERE organization_id = fixed_org AND resource_type = 'auth_user'
  ) <> 42
  THEN
    RAISE EXCEPTION 'Batch 4 baseline ownership closure is incomplete';
  END IF;

  SELECT count(*) INTO actual_count
  FROM public.demo_resource_registry
  WHERE organization_id = fixed_org AND protected_baseline;
  IF actual_count <> expected_count THEN
    RAISE EXCEPTION 'Batch 4 ownership closure expected %, found %',
      expected_count, actual_count;
  END IF;

  IF (
    SELECT count(*) FROM public.programme_modules
    WHERE programme_id IN (
      SELECT resource_id FROM public.demo_resource_registry
      WHERE organization_id = fixed_org AND resource_type = 'programme'
    )
  ) <> 24
  OR (
    SELECT count(*) FROM public.training_weeks
    WHERE programme_id IN (
      SELECT resource_id FROM public.demo_resource_registry
      WHERE organization_id = fixed_org AND resource_type = 'programme'
    )
  ) <> 18
  OR (
    SELECT count(*) FROM public.sessions s
    JOIN public.programme_enrollments e ON e.id = s.enrollment_id
    WHERE e.organization_id = fixed_org
  ) <> 128
  OR (
    SELECT count(*) FROM public.mentoring_sessions s
    JOIN public.programme_enrollments e ON e.id = s.enrollment_id
    WHERE e.organization_id = fixed_org
  ) <> 60
  OR (
    SELECT count(*) FROM public.coachee_peer_sessions s
    JOIN public.programme_enrollments e ON e.id = s.enrollment_id
    WHERE e.organization_id = fixed_org
  ) <> 44
  OR (
    SELECT count(*) FROM public.triad_groups
    WHERE programme_id IN (
      SELECT resource_id FROM public.demo_resource_registry
      WHERE organization_id = fixed_org AND resource_type = 'programme'
    )
  ) <> 7
  OR (
    SELECT count(*) FROM public.triad_sessions s
    JOIN public.triad_groups g ON g.id = s.triad_group_id
    WHERE g.programme_id IN (
      SELECT resource_id FROM public.demo_resource_registry
      WHERE organization_id = fixed_org AND resource_type = 'programme'
    )
  ) <> 14
  OR (
    SELECT count(*) FROM public.coachee_goals g
    JOIN public.programme_enrollments e ON e.id = g.enrollment_id
    WHERE e.organization_id = fixed_org
  ) <> 40
  OR (
    SELECT count(*) FROM public.coachee_milestones m
    JOIN public.programme_enrollments e ON e.id = m.enrollment_id
    WHERE e.organization_id = fixed_org
  ) <> 80
  OR (
    SELECT count(*) FROM public.coachee_goal_ratings r
    JOIN public.programme_enrollments e ON e.id = r.enrollment_id
    WHERE e.organization_id = fixed_org
  ) <> 40
  OR (
    SELECT count(*) FROM public.goal_checkins c
    JOIN public.programme_enrollments e ON e.id = c.enrollment_id
    WHERE e.organization_id = fixed_org
  ) <> 40
  OR (
    SELECT count(*) FROM public.enrollment_actions a
    JOIN public.programme_enrollments e ON e.id = a.enrollment_id
    WHERE e.organization_id = fixed_org
  ) <> 57
  OR (
    SELECT count(*) FROM public.training_progress p
    JOIN public.programme_enrollments e ON e.id = p.enrollment_id
    WHERE e.organization_id = fixed_org
  ) <> 192
  OR (
    SELECT count(*) FROM public.enrollment_module_snapshots s
    JOIN public.programme_enrollments e ON e.id = s.enrollment_id
    WHERE e.organization_id = fixed_org
  ) <> 254
  OR (
    SELECT count(*) FROM public.enrollment_module_milestones m
    JOIN public.enrollment_module_snapshots s ON s.id = m.enrollment_module_snapshot_id
    JOIN public.programme_enrollments e ON e.id = s.enrollment_id
    WHERE e.organization_id = fixed_org
  ) <> 748
  THEN
    RAISE EXCEPTION 'Batch 4 domain count closure is incomplete';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.demo_delete_batch_4_owned_resources(
  p_operation_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
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

  DELETE FROM public.triad_sessions
  WHERE id IN (SELECT resource_id FROM public.demo_resource_registry
              WHERE organization_id = fixed_org AND resource_type = 'triad_session');
  GET DIAGNOSTICS rows_deleted = ROW_COUNT; deleted_count := deleted_count + rows_deleted;

  DELETE FROM public.triad_groups
  WHERE id IN (SELECT resource_id FROM public.demo_resource_registry
              WHERE organization_id = fixed_org AND resource_type = 'triad_group');
  GET DIAGNOSTICS rows_deleted = ROW_COUNT; deleted_count := deleted_count + rows_deleted;

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
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND tc.table_schema = 'public'
      AND ccu.table_schema = 'public'
      AND ccu.table_name = 'profiles'
      AND ccu.column_name = 'id'
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
    'deletedOwnershipResources', 1746,
    'preservedOrganization', true,
    'preservedNonDemoRows', true
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.demo_apply_batch_4(
  p_operation_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  operation_row public.demo_operations;
  deleted_counts jsonb;
  batch_2_counts jsonb;
  batch_3_counts jsonb;
  final_count integer;
BEGIN
  SELECT * INTO operation_row
  FROM public.demo_operations
  WHERE id = p_operation_id
  FOR UPDATE;
  IF NOT FOUND OR operation_row.status <> 'started' OR operation_row.operation <> 'reset' THEN
    RAISE EXCEPTION 'Batch 4 requires a started reset operation'
      USING ERRCODE = 'P0001';
  END IF;

  deleted_counts := public.demo_delete_batch_4_owned_resources(p_operation_id);
  batch_2_counts := public.demo_apply_batch_2(p_operation_id);
  batch_3_counts := public.demo_apply_batch_3(p_operation_id);
  PERFORM public.demo_validate_batch_4_ownership();

  SELECT count(*) INTO final_count
  FROM public.demo_resource_registry
  WHERE organization_id = operation_row.organization_id
    AND protected_baseline;
  IF final_count <> 1746 THEN
    RAISE EXCEPTION 'Batch 4 rebuild produced % ownership resources; expected 1746',
      final_count;
  END IF;

  RETURN jsonb_build_object(
    'batch', 4,
    'deleted', deleted_counts,
    'batch2', batch_2_counts,
    'batch3', batch_3_counts,
    'ownershipResourcesBefore', 1746,
    'ownershipResourcesAfter', final_count,
    'privacyValidated', true,
    'crossOrganizationReferencesValidated', true
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.demo_begin_batch_4_operation(
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
SET search_path = public
AS $$
DECLARE
  operation_row public.demo_operations;
BEGIN
  IF p_operation <> 'reset' THEN
    RAISE EXCEPTION 'Batch 4 supports reset only' USING ERRCODE = '22023';
  END IF;
  operation_row := public.demo_begin_operation(
    p_organization_id, p_operation, p_idempotency_key, p_requested_by,
    p_fixture_version, p_anchor_date, p_expected_generation
  );
  RETURN operation_row;
END;
$$;

REVOKE ALL ON FUNCTION public.demo_assert_batch_4_cross_org_references() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.demo_assert_batch_4_privacy() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.demo_validate_batch_4_ownership() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.demo_delete_batch_4_owned_resources(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.demo_apply_batch_4(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.demo_begin_batch_4_operation(uuid, text, text, uuid, text, date, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.demo_assert_batch_4_cross_org_references() TO service_role;
GRANT EXECUTE ON FUNCTION public.demo_assert_batch_4_privacy() TO service_role;
GRANT EXECUTE ON FUNCTION public.demo_validate_batch_4_ownership() TO service_role;
GRANT EXECUTE ON FUNCTION public.demo_delete_batch_4_owned_resources(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.demo_apply_batch_4(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.demo_begin_batch_4_operation(uuid, text, text, uuid, text, date, bigint) TO service_role;