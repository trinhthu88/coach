-- Batch 2: deterministic Clariva demo structure, identities, and leaders.
--
-- This migration adds only the reconciliation routines. It does not create
-- demo data while migrations are applied. The server-side demo-admin function
-- invokes the routines inside the Batch 1 operation lifecycle.

CREATE OR REPLACE FUNCTION public.demo_batch_2_leader(p_serial integer)
RETURNS TABLE (
  serial_number integer,
  user_id uuid,
  email text,
  full_name text,
  programme_id uuid,
  cohort_id uuid,
  enrollment_id uuid
)
LANGUAGE plpgsql
IMMUTABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  leader_names text[] := ARRAY[
    'Demo Learner — Executive Coaching', 'Marcus Lee', 'Sofia Nguyen', 'Daniel Wong',
    'Maya Patel', 'Ethan Lim', 'Chloe Pham', 'Noah Chen', 'Isla Ho', 'Julian Park',
    'Nadia Vo', 'Theo Martin', 'Amara Singh', 'Leo Nguyen', 'Mina Le', 'Rafael Cruz',
    'Avery Do', 'Grace Tan', 'Demo Learner — Emerging Leaders', 'Caleb Ong', 'Hana Bui', 'Miles Dao',
    'Elena Pham', 'Kai Wong', 'Tessa Nguyen', 'Arjun Mehta', 'Sienna Lim', 'Ben Hoang',
    'Naomi Lee', 'Adam Vo', 'Claire Chen', 'Duy Phan', 'Ivy Tran', 'Samir Khan',
    'Jade Nguyen', 'Finn Le', 'Rina Patel', 'Luca Ho', 'Tuan Vo', 'Mai Nguyen'
  ];
  cohort_key text;
  cohort_position integer;
BEGIN
  IF p_serial NOT BETWEEN 1 AND 40 THEN
    RAISE EXCEPTION 'Batch 2 leader serial must be between 1 and 40'
      USING ERRCODE = '22023';
  END IF;

  serial_number := p_serial;
  cohort_key := CASE
    WHEN p_serial <= 8 THEN 'A'
    WHEN p_serial <= 18 THEN 'B'
    WHEN p_serial <= 30 THEN 'C'
    ELSE 'D'
  END;
  cohort_position := CASE
    WHEN p_serial <= 8 THEN p_serial
    WHEN p_serial <= 18 THEN p_serial - 8
    WHEN p_serial <= 30 THEN p_serial - 18
    ELSE p_serial - 30
  END;

  user_id := CASE
    WHEN p_serial = 1 THEN 'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2c0101'::uuid
    WHEN p_serial = 19 THEN 'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2c0102'::uuid
    ELSE format('c7f8e4b2-2f34-4a1d-8f6f-d%s', lpad(p_serial::text, 11, '0'))::uuid
  END;
  email := CASE
    WHEN p_serial = 1 THEN 'demo-learner-executive@demo.clariva.club'
    WHEN p_serial = 19 THEN 'demo-learner-emerging@demo.clariva.club'
    ELSE format('demo-leader-%s%s@demo.clariva.club', lower(cohort_key), lpad(cohort_position::text, 2, '0'))
  END;
  full_name := leader_names[p_serial];
  programme_id := CASE cohort_key
    WHEN 'A' THEN 'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2a0101'::uuid
    WHEN 'B' THEN 'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2a0102'::uuid
    WHEN 'C' THEN 'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2a0103'::uuid
    ELSE 'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2a0104'::uuid
  END;
  cohort_id := CASE cohort_key
    WHEN 'A' THEN 'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2b0101'::uuid
    WHEN 'B' THEN 'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2b0102'::uuid
    WHEN 'C' THEN 'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2b0103'::uuid
    ELSE 'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2b0104'::uuid
  END;
  enrollment_id := format('c7f8e4b2-2f34-4a1d-8f6f-e%s', lpad(p_serial::text, 11, '0'))::uuid;
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.demo_register_batch_2_resource(
  p_resource_type text,
  p_resource_id uuid,
  p_generation bigint
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
    RAISE EXCEPTION 'Batch 2 resource is already registered to another organization'
      USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.demo_resource_registry (
    organization_id, resource_type, resource_id, generation, protected_baseline
  )
  VALUES (
    'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2e7a01'::uuid,
    p_resource_type, p_resource_id, p_generation, true
  )
  ON CONFLICT (organization_id, resource_type, resource_id) DO UPDATE
    SET generation = EXCLUDED.generation,
        protected_baseline = true;
END;
$$;

CREATE OR REPLACE FUNCTION public.demo_batch_2_ensure_auth_identity(
  p_user_id uuid,
  p_email text,
  p_full_name text,
  p_role text
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  existing_id uuid;
  existing_email text;
BEGIN
  SELECT id, email INTO existing_id, existing_email
  FROM auth.users
  WHERE id = p_user_id;

  IF FOUND THEN
    IF lower(coalesce(existing_email, '')) <> lower(p_email) THEN
      RAISE EXCEPTION 'Batch 2 Auth identifier belongs to a different email; refusing adoption'
        USING ERRCODE = '23505';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.demo_resource_registry
      WHERE organization_id = 'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2e7a01'::uuid
        AND resource_type = 'auth_user'
        AND resource_id = p_user_id
    ) THEN
      RAISE EXCEPTION 'Batch 2 Auth identifier exists without demo ownership; refusing adoption'
        USING ERRCODE = '23505';
    END IF;
    RETURN false;
  END IF;

  SELECT id INTO existing_id
  FROM auth.users
  WHERE lower(email) = lower(p_email)
  LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'Batch 2 email already belongs to another Auth identifier; refusing adoption'
      USING ERRCODE = '23505';
  END IF;

  INSERT INTO auth.users (
    id, instance_id, aud, role, email, email_confirmed_at,
    raw_user_meta_data, created_at, updated_at
  )
  VALUES (
    p_user_id,
    '00000000-0000-0000-0000-000000000000'::uuid,
    'authenticated',
    'authenticated',
    p_email,
    now(),
    jsonb_build_object('full_name', p_full_name, 'role', p_role),
    now(),
    now()
  );
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.demo_assert_batch_2_collisions()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  account record;
  leader record;
  i integer;
  expected_id uuid;
  existing_id uuid;
  expected_programme record;
  expected_cohort record;
BEGIN
  PERFORM public.demo_assert_service_target(
    'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2e7a01'::uuid,
    'clariva-live-demo-v1',
    DATE '2026-01-05'
  );

  FOR account IN
    SELECT * FROM (VALUES
      ('learner-executive', 'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2c0101'::uuid, 'demo-learner-executive@demo.clariva.club'),
      ('learner-emerging', 'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2c0102'::uuid, 'demo-learner-emerging@demo.clariva.club'),
      ('coach', 'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2c0103'::uuid, 'demo-coach@demo.clariva.club'),
      ('sponsor', 'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2c0104'::uuid, 'demo-sponsor@demo.clariva.club')
    ) AS batch_values(account_key, user_id, email)
  LOOP
    SELECT id INTO existing_id FROM auth.users WHERE lower(email) = lower(account.email) LIMIT 1;
    IF FOUND AND existing_id <> account.user_id THEN
      RAISE EXCEPTION 'Batch 2 account email collision for %; refusing adoption', account.email
        USING ERRCODE = '23505';
    END IF;

    IF EXISTS (SELECT 1 FROM auth.users WHERE id = account.user_id AND lower(email) <> lower(account.email)) THEN
      RAISE EXCEPTION 'Batch 2 account identifier collision for %; refusing adoption', account.account_key
        USING ERRCODE = '23505';
    END IF;

    IF EXISTS (SELECT 1 FROM auth.users WHERE id = account.user_id)
       AND NOT EXISTS (
         SELECT 1 FROM public.demo_resource_registry
         WHERE organization_id = 'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2e7a01'::uuid
           AND resource_type = 'auth_user'
           AND resource_id = account.user_id
       ) THEN
      RAISE EXCEPTION 'Batch 2 account exists without demo ownership; refusing adoption'
        USING ERRCODE = '23505';
    END IF;

    IF EXISTS (
      SELECT 1 FROM public.demo_accounts
      WHERE account_key = account.account_key
        AND (organization_id <> 'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2e7a01'::uuid OR user_id <> account.user_id)
    ) THEN
      RAISE EXCEPTION 'Batch 2 account registry collision for %; refusing adoption', account.account_key
        USING ERRCODE = '23505';
    END IF;
  END LOOP;

  FOR i IN 1..40 LOOP
    SELECT * INTO leader FROM public.demo_batch_2_leader(i);
    SELECT id INTO existing_id FROM auth.users
    WHERE lower(email) = lower(leader.email)
    LIMIT 1;
    IF FOUND AND existing_id <> leader.user_id THEN
      RAISE EXCEPTION 'Batch 2 leader email collision for %; refusing adoption', leader.email
        USING ERRCODE = '23505';
    END IF;
    IF EXISTS (
      SELECT 1 FROM auth.users
      WHERE id = leader.user_id AND lower(email) <> lower(leader.email)
    ) THEN
      RAISE EXCEPTION 'Batch 2 leader identifier collision for %; refusing adoption', leader.full_name
        USING ERRCODE = '23505';
    END IF;
    IF EXISTS (SELECT 1 FROM auth.users WHERE id = leader.user_id)
       AND NOT EXISTS (
         SELECT 1 FROM public.demo_resource_registry
         WHERE organization_id = 'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2e7a01'::uuid
           AND resource_type = 'auth_user'
           AND resource_id = leader.user_id
       ) THEN
      RAISE EXCEPTION 'Batch 2 leader exists without demo ownership; refusing adoption'
        USING ERRCODE = '23505';
    END IF;

    -- An existing enrollment for any expected leader is a collision unless it
    -- is the exact deterministic Batch 2 enrollment.
    IF EXISTS (
      SELECT 1 FROM public.programme_enrollments
      WHERE user_id = leader.user_id AND id <> leader.enrollment_id
    ) THEN
      RAISE EXCEPTION 'Batch 2 leader has an existing non-demo enrollment; refusing adoption'
        USING ERRCODE = '23505';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.programme_enrollments
      WHERE id = leader.enrollment_id
    ) AND NOT EXISTS (
      SELECT 1 FROM public.demo_resource_registry
      WHERE organization_id = 'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2e7a01'::uuid
        AND resource_type = 'enrollment'
        AND resource_id = leader.enrollment_id
    ) THEN
      RAISE EXCEPTION 'Batch 2 enrollment identifier exists without demo ownership; refusing adoption'
        USING ERRCODE = '23505';
    END IF;
  END LOOP;

  FOR expected_programme IN
    SELECT * FROM (VALUES
      ('c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2a0101'::uuid, 'Executive Coaching'),
      ('c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2a0102'::uuid, 'Leadership Development'),
      ('c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2a0103'::uuid, 'Emerging Leaders'),
      ('c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2a0104'::uuid, 'Leadership Excellence')
    ) AS batch_values(id, name)
  LOOP
    IF EXISTS (
      SELECT 1 FROM public.programmes
      WHERE name = expected_programme.name
        AND id <> expected_programme.id
    ) THEN
      RAISE EXCEPTION 'Batch 2 programme name collision for %; refusing adoption', expected_programme.name
        USING ERRCODE = '23505';
    END IF;
    IF EXISTS (SELECT 1 FROM public.programmes WHERE id = expected_programme.id)
       AND NOT EXISTS (
         SELECT 1 FROM public.demo_resource_registry
         WHERE organization_id = 'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2e7a01'::uuid
           AND resource_type = 'programme'
           AND resource_id = expected_programme.id
       ) THEN
      RAISE EXCEPTION 'Batch 2 programme identifier exists without demo ownership; refusing adoption'
        USING ERRCODE = '23505';
    END IF;
  END LOOP;

  FOR expected_cohort IN
    SELECT * FROM (VALUES
      ('c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2b0101'::uuid, 'Executive Coaching — Cohort A'),
      ('c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2b0102'::uuid, 'Leadership Development — Cohort B'),
      ('c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2b0103'::uuid, 'Emerging Leaders — Cohort C'),
      ('c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2b0104'::uuid, 'Leadership Excellence — Cohort D')
    ) AS batch_values(id, name)
  LOOP
    IF EXISTS (
      SELECT 1 FROM public.cohorts
      WHERE name = expected_cohort.name
        AND id <> expected_cohort.id
    ) THEN
      RAISE EXCEPTION 'Batch 2 cohort name collision for %; refusing adoption', expected_cohort.name
        USING ERRCODE = '23505';
    END IF;
    IF EXISTS (SELECT 1 FROM public.cohorts WHERE id = expected_cohort.id)
       AND NOT EXISTS (
         SELECT 1 FROM public.demo_resource_registry
         WHERE organization_id = 'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2e7a01'::uuid
           AND resource_type = 'cohort'
           AND resource_id = expected_cohort.id
       ) THEN
      RAISE EXCEPTION 'Batch 2 cohort identifier exists without demo ownership; refusing adoption'
        USING ERRCODE = '23505';
    END IF;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.demo_validate_batch_2_ownership()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  registry_generation bigint;
  account record;
  leader record;
  i integer;
  role_count integer;
  expected_resource_count integer;
  actual_resource_count integer;
BEGIN
  SELECT generation INTO registry_generation
  FROM public.demo_organization_registry
  WHERE organization_id = 'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2e7a01'::uuid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Batch 2 demo registry is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.organizations
    WHERE id = 'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2e7a01'::uuid
      AND name = 'Clariva Demo Organization'
  ) THEN
    RAISE EXCEPTION 'Batch 2 demo organization is missing or has changed';
  END IF;

  IF (SELECT count(*) FROM public.programmes WHERE id IN (
    'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2a0101'::uuid,
    'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2a0102'::uuid,
    'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2a0103'::uuid,
    'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2a0104'::uuid
  )) <> 4 THEN
    RAISE EXCEPTION 'Batch 2 programme ownership closure failed';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.cohorts
    WHERE id IN (
      'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2b0101'::uuid,
      'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2b0102'::uuid,
      'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2b0103'::uuid,
      'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2b0104'::uuid
    )
    AND (
      organization_id IS DISTINCT FROM 'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2e7a01'::uuid
      OR programme_id NOT IN (
        'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2a0101'::uuid,
        'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2a0102'::uuid,
        'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2a0103'::uuid,
        'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2a0104'::uuid
      )
    )
  ) THEN
    RAISE EXCEPTION 'Batch 2 cohort references a different organization or programme'
      USING ERRCODE = '42501';
  END IF;

  FOR account IN
    SELECT * FROM (VALUES
      ('learner-executive', 'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2c0101'::uuid, 'coachee'::public.app_role),
      ('learner-emerging', 'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2c0102'::uuid, 'coachee'::public.app_role),
      ('coach', 'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2c0103'::uuid, 'coach'::public.app_role),
      ('sponsor', 'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2c0104'::uuid, 'sponsor'::public.app_role)
    ) AS batch_values(account_key, user_id, role)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.demo_accounts
      WHERE organization_id = 'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2e7a01'::uuid
        AND account_key = account.account_key
        AND user_id = account.user_id
        AND role = account.role
    ) THEN
      RAISE EXCEPTION 'Batch 2 account linkage is incomplete for %', account.account_key;
    END IF;
    SELECT count(*) INTO role_count FROM public.user_roles
    WHERE user_id = account.user_id;
    IF role_count <> 1 OR NOT EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = account.user_id AND role = account.role
    ) THEN
      RAISE EXCEPTION 'Batch 2 account role linkage is incomplete for %', account.account_key;
    END IF;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1 FROM public.coach_profiles
    WHERE id = 'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2c0103'::uuid
      AND approval_status = 'active'
  ) OR NOT EXISTS (
    SELECT 1 FROM public.sponsor_profiles
    WHERE user_id = 'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2c0104'::uuid
      AND organization_id = 'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2e7a01'::uuid
  ) THEN
    RAISE EXCEPTION 'Batch 2 provider or sponsor profile linkage is incomplete';
  END IF;

  FOR i IN 1..40 LOOP
    SELECT * INTO leader FROM public.demo_batch_2_leader(i);
    IF NOT EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = leader.user_id AND email = leader.email AND full_name = leader.full_name AND status = 'active'
    ) OR NOT EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = leader.user_id AND role = 'coachee'
    ) OR (SELECT count(*) FROM public.user_roles WHERE user_id = leader.user_id) <> 1
      OR NOT EXISTS (
        SELECT 1 FROM public.coachee_profiles
        WHERE id = leader.user_id AND approval_status = 'active'
      ) THEN
      RAISE EXCEPTION 'Batch 2 leader profile or role closure failed for %', leader.full_name;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.programme_enrollments
      WHERE id = leader.enrollment_id
        AND user_id = leader.user_id
        AND coachee_id = leader.user_id
        AND programme_id = leader.programme_id
        AND cohort_id = leader.cohort_id
        AND organization_id = 'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2e7a01'::uuid
        AND start_date = CASE WHEN leader.serial_number BETWEEN 31 AND 40 THEN DATE '2025-01-06' ELSE DATE '2026-01-05' END
        AND end_date = CASE
          WHEN leader.serial_number BETWEEN 1 AND 8 THEN DATE '2026-04-05'
          WHEN leader.serial_number BETWEEN 9 AND 18 THEN DATE '2026-07-05'
          WHEN leader.serial_number BETWEEN 19 AND 30 THEN DATE '2026-07-05'
          ELSE DATE '2025-07-06'
        END
        AND status = CASE WHEN leader.serial_number BETWEEN 31 AND 40
          THEN 'completed'::public.enrollment_status ELSE 'active'::public.enrollment_status END
    ) THEN
      RAISE EXCEPTION 'Batch 2 enrollment ownership closure failed for %', leader.full_name;
    END IF;
  END LOOP;

  expected_resource_count := 221;
  SELECT count(*) INTO actual_resource_count
  FROM public.demo_resource_registry
  WHERE organization_id = 'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2e7a01'::uuid
    AND protected_baseline;
  IF actual_resource_count <> expected_resource_count THEN
    RAISE EXCEPTION 'Batch 2 ownership registry expected %, found %',
      expected_resource_count, actual_resource_count;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.demo_resource_registry
    WHERE organization_id = 'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2e7a01'::uuid
      AND resource_type NOT IN (
        'organization', 'programme', 'cohort', 'auth_user', 'demo_account',
        'profile', 'user_role', 'coachee_profile', 'coach_profile',
        'sponsor_profile', 'enrollment'
      )
  ) THEN
    RAISE EXCEPTION 'Batch 2 ownership registry contains an unknown resource type';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.demo_apply_batch_2(p_operation_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  operation_row public.demo_operations;
  registry_generation bigint;
  account record;
  leader record;
  programme record;
  cohort record;
  created_auth boolean;
  role_id uuid;
  existing_org uuid;
  i integer;
  counts jsonb;
BEGIN
  SELECT * INTO operation_row
  FROM public.demo_operations
  WHERE id = p_operation_id
  FOR UPDATE;
  IF NOT FOUND OR operation_row.status <> 'started' THEN
    RAISE EXCEPTION 'Batch 2 requires a started demo operation'
      USING ERRCODE = 'P0001';
  END IF;

  PERFORM public.demo_assert_service_target(
    operation_row.organization_id,
    operation_row.fixture_version,
    operation_row.anchor_date
  );
  PERFORM public.demo_assert_batch_2_collisions();

  SELECT generation INTO registry_generation
  FROM public.demo_organization_registry
  WHERE organization_id = operation_row.organization_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Batch 2 demo registry is missing';
  END IF;

  IF operation_row.generation_before <> registry_generation THEN
    RAISE EXCEPTION 'Batch 2 generation changed before fixture application'
      USING ERRCODE = '40001';
  END IF;

  SELECT id INTO existing_org
  FROM public.organizations
  WHERE id = operation_row.organization_id;
  IF NOT FOUND OR NOT EXISTS (
    SELECT 1 FROM public.organizations
    WHERE id = operation_row.organization_id AND name = 'Clariva Demo Organization'
  ) THEN
    RAISE EXCEPTION 'Batch 2 fixed organization is missing or has changed'
      USING ERRCODE = '42501';
  END IF;
  PERFORM public.demo_register_batch_2_resource('organization', operation_row.organization_id, registry_generation);

  FOR programme IN
    SELECT * FROM (VALUES
      ('c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2a0101'::uuid, 'Executive Coaching', 'Focused coaching development programme', 3, 'cobalt'),
      ('c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2a0102'::uuid, 'Leadership Development', 'Blended leadership development programme', 6, 'teal'),
      ('c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2a0103'::uuid, 'Emerging Leaders', 'Blended programme for emerging leaders', 6, 'gold'),
      ('c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2a0104'::uuid, 'Leadership Excellence', 'Completed historical leadership programme', 6, 'violet')
    ) AS batch_values(id, name, description, duration_months, color)
  LOOP
    INSERT INTO public.programmes (
      id, name, description, duration_months, color, is_active
    )
    VALUES (
      programme.id, programme.name, programme.description, programme.duration_months,
      programme.color, programme.id <> 'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2a0104'::uuid
    )
    ON CONFLICT (id) DO UPDATE SET
      name = EXCLUDED.name,
      description = EXCLUDED.description,
      duration_months = EXCLUDED.duration_months,
      color = EXCLUDED.color,
      is_active = EXCLUDED.is_active;
    PERFORM public.demo_register_batch_2_resource('programme', programme.id, registry_generation);
  END LOOP;

  FOR cohort IN
    SELECT * FROM (VALUES
      ('c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2b0101'::uuid, 'Executive Coaching — Cohort A', 'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2a0101'::uuid, DATE '2026-01-05', DATE '2026-04-05'),
      ('c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2b0102'::uuid, 'Leadership Development — Cohort B', 'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2a0102'::uuid, DATE '2026-01-05', DATE '2026-07-05'),
      ('c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2b0103'::uuid, 'Emerging Leaders — Cohort C', 'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2a0103'::uuid, DATE '2026-01-05', DATE '2026-07-05'),
      ('c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2b0104'::uuid, 'Leadership Excellence — Cohort D', 'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2a0104'::uuid, DATE '2025-01-06', DATE '2025-07-06')
    ) AS batch_values(id, name, programme_id, start_date, end_date)
  LOOP
    INSERT INTO public.cohorts (
      id, name, programme_id, organization_id, start_date, end_date, color
    )
    VALUES (
      cohort.id, cohort.name, cohort.programme_id, operation_row.organization_id,
      cohort.start_date, cohort.end_date,
      CASE WHEN cohort.id = 'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2b0104'::uuid THEN 'violet' ELSE 'teal' END
    )
    ON CONFLICT (id) DO UPDATE SET
      name = EXCLUDED.name,
      programme_id = EXCLUDED.programme_id,
      organization_id = EXCLUDED.organization_id,
      start_date = EXCLUDED.start_date,
      end_date = EXCLUDED.end_date,
      color = EXCLUDED.color;
    PERFORM public.demo_register_batch_2_resource('cohort', cohort.id, registry_generation);
  END LOOP;

  FOR account IN
    SELECT * FROM (VALUES
      ('learner-executive', 'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2c0101'::uuid, 'Demo Learner — Executive Coaching', 'demo-learner-executive@demo.clariva.club', 'coachee'::public.app_role, 'coachee'),
      ('learner-emerging', 'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2c0102'::uuid, 'Demo Learner — Emerging Leaders', 'demo-learner-emerging@demo.clariva.club', 'coachee'::public.app_role, 'coachee'),
      ('coach', 'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2c0103'::uuid, 'Demo Coach', 'demo-coach@demo.clariva.club', 'coach'::public.app_role, 'coach'),
      ('sponsor', 'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2c0104'::uuid, 'Demo Sponsor', 'demo-sponsor@demo.clariva.club', 'sponsor'::public.app_role, 'coachee')
    ) AS batch_values(account_key, user_id, full_name, email, app_role, auth_role)
  LOOP
    created_auth := public.demo_batch_2_ensure_auth_identity(
      account.user_id, account.email, account.full_name, account.auth_role
    );
    IF created_auth AND account.account_key = 'sponsor' THEN
      DELETE FROM public.user_roles
      WHERE user_id = account.user_id AND role = 'coachee'::public.app_role;
      DELETE FROM public.coachee_profiles WHERE id = account.user_id;
    END IF;

    INSERT INTO public.profiles (id, full_name, email, status)
    VALUES (account.user_id, account.full_name, account.email, 'active')
    ON CONFLICT (id) DO UPDATE SET
      full_name = EXCLUDED.full_name,
      email = EXCLUDED.email,
      status = EXCLUDED.status;

    IF EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = account.user_id AND role <> account.app_role
    ) THEN
      RAISE EXCEPTION 'Batch 2 account % has an unexpected role', account.account_key
        USING ERRCODE = '42501';
    END IF;
    INSERT INTO public.user_roles (user_id, role)
    VALUES (account.user_id, account.app_role)
    ON CONFLICT (user_id, role) DO NOTHING
    RETURNING id INTO role_id;
    IF role_id IS NULL THEN
      SELECT id INTO role_id FROM public.user_roles
      WHERE user_id = account.user_id AND role = account.app_role;
    END IF;

    IF account.account_key IN ('learner-executive', 'learner-emerging') THEN
      INSERT INTO public.coachee_profiles (id, job_title, industry, location, timezone, goals, approval_status)
      VALUES (account.user_id, 'Demo Leader', 'Leadership development', 'Ho Chi Minh City, Vietnam',
        'Asia/Ho_Chi_Minh', 'Explore the fictional Clariva programme experience.', 'active')
      ON CONFLICT (id) DO UPDATE SET approval_status = 'active';
      PERFORM public.demo_register_batch_2_resource('coachee_profile', account.user_id, registry_generation);
    ELSIF account.account_key = 'coach' THEN
      INSERT INTO public.coach_profiles (id, title, approval_status, peer_coaching_opt_in)
      VALUES (account.user_id, 'Executive Coach', 'active', false)
      ON CONFLICT (id) DO UPDATE SET approval_status = 'active';
      PERFORM public.demo_register_batch_2_resource('coach_profile', account.user_id, registry_generation);
    ELSE
      SELECT organization_id INTO existing_org
      FROM public.sponsor_profiles WHERE user_id = account.user_id;
      IF FOUND AND existing_org <> operation_row.organization_id THEN
        RAISE EXCEPTION 'Batch 2 sponsor profile belongs to another organization'
          USING ERRCODE = '42501';
      END IF;
      INSERT INTO public.sponsor_profiles (user_id, organization_id, title, department)
      VALUES (account.user_id, operation_row.organization_id, 'Programme Sponsor', 'Leadership Development')
      ON CONFLICT (user_id) DO UPDATE SET
        organization_id = EXCLUDED.organization_id,
        title = EXCLUDED.title,
        department = EXCLUDED.department;
      PERFORM public.demo_register_batch_2_resource('sponsor_profile', account.user_id, registry_generation);
    END IF;

    INSERT INTO public.demo_accounts (organization_id, account_key, user_id, role, is_prospect_login)
    VALUES (operation_row.organization_id, account.account_key, account.user_id, account.app_role, true)
    ON CONFLICT (organization_id, account_key) DO UPDATE SET
      user_id = EXCLUDED.user_id,
      role = EXCLUDED.role,
      is_prospect_login = true;

    PERFORM public.demo_register_batch_2_resource('auth_user', account.user_id, registry_generation);
    PERFORM public.demo_register_batch_2_resource('demo_account', account.user_id, registry_generation);
    PERFORM public.demo_register_batch_2_resource('profile', account.user_id, registry_generation);
    PERFORM public.demo_register_batch_2_resource('user_role', role_id, registry_generation);
  END LOOP;

  FOR i IN 1..40 LOOP
    SELECT * INTO leader FROM public.demo_batch_2_leader(i);
    IF leader.serial_number NOT IN (1, 19) THEN
      created_auth := public.demo_batch_2_ensure_auth_identity(
        leader.user_id, leader.email, leader.full_name, 'coachee'
      );
    ELSE
      created_auth := false;
    END IF;

    INSERT INTO public.profiles (id, full_name, email, status)
    VALUES (leader.user_id, leader.full_name, leader.email, 'active')
    ON CONFLICT (id) DO UPDATE SET
      full_name = EXCLUDED.full_name,
      email = EXCLUDED.email,
      status = EXCLUDED.status;

    IF EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = leader.user_id AND role <> 'coachee'::public.app_role
    ) THEN
      RAISE EXCEPTION 'Batch 2 leader % has an unexpected role', leader.full_name
        USING ERRCODE = '42501';
    END IF;
    INSERT INTO public.user_roles (user_id, role)
    VALUES (leader.user_id, 'coachee'::public.app_role)
    ON CONFLICT (user_id, role) DO NOTHING
    RETURNING id INTO role_id;
    IF role_id IS NULL THEN
      SELECT id INTO role_id FROM public.user_roles
      WHERE user_id = leader.user_id AND role = 'coachee'::public.app_role;
    END IF;

    INSERT INTO public.coachee_profiles (
      id, job_title, industry, location, timezone, goals, approval_status
    )
    VALUES (
      leader.user_id, 'Demo Leader', 'Leadership development', 'Ho Chi Minh City, Vietnam',
      'Asia/Ho_Chi_Minh', 'Practise leadership habits in a fictional Clariva programme.', 'active'
    )
    ON CONFLICT (id) DO UPDATE SET
      approval_status = 'active',
      goals = EXCLUDED.goals;

    INSERT INTO public.programme_enrollments (
      id, user_id, coachee_id, programme_id, cohort_id, organization_id,
      start_date, end_date, status
    )
    VALUES (
      leader.enrollment_id,
      leader.user_id,
      leader.user_id,
      leader.programme_id,
      leader.cohort_id,
      operation_row.organization_id,
      CASE WHEN leader.serial_number BETWEEN 31 AND 40 THEN DATE '2025-01-06' ELSE DATE '2026-01-05' END,
      CASE
        WHEN leader.serial_number BETWEEN 1 AND 8 THEN DATE '2026-04-05'
        WHEN leader.serial_number BETWEEN 9 AND 18 THEN DATE '2026-07-05'
        WHEN leader.serial_number BETWEEN 19 AND 30 THEN DATE '2026-07-05'
        ELSE DATE '2025-07-06'
      END,
      CASE WHEN leader.serial_number BETWEEN 31 AND 40
        THEN 'completed'::public.enrollment_status ELSE 'active'::public.enrollment_status END
    )
    ON CONFLICT (id) DO UPDATE SET
      user_id = EXCLUDED.user_id,
      coachee_id = EXCLUDED.coachee_id,
      programme_id = EXCLUDED.programme_id,
      cohort_id = EXCLUDED.cohort_id,
      organization_id = EXCLUDED.organization_id,
      start_date = EXCLUDED.start_date,
      end_date = EXCLUDED.end_date,
      status = EXCLUDED.status;

    PERFORM public.demo_register_batch_2_resource('auth_user', leader.user_id, registry_generation);
    PERFORM public.demo_register_batch_2_resource('profile', leader.user_id, registry_generation);
    PERFORM public.demo_register_batch_2_resource('user_role', role_id, registry_generation);
    PERFORM public.demo_register_batch_2_resource('coachee_profile', leader.user_id, registry_generation);
    PERFORM public.demo_register_batch_2_resource('enrollment', leader.enrollment_id, registry_generation);
  END LOOP;

  PERFORM public.demo_validate_batch_2_ownership();

  counts := jsonb_build_object(
    'programmes', 4,
    'cohorts', 4,
    'accounts', 4,
    'authUsers', 42,
    'profiles', 42,
    'roleAssignments', 42,
    'leaderProfiles', 40,
    'enrollments', 40,
    'activity', 0,
    'ownershipResources', 221
  );
  RETURN counts;
END;
$$;

-- Batch 2 needs provision to reconcile an already-ready Batch 1 registry. The
-- wrapper preserves the original idempotency/lock implementation and converts
-- only its explicit ready-state provision no-op into a started reconciliation.
CREATE OR REPLACE FUNCTION public.demo_begin_batch_2_operation(
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
DECLARE
  operation_row public.demo_operations;
BEGIN
  SELECT * INTO operation_row
  FROM public.demo_begin_operation(
    p_organization_id, p_operation, p_idempotency_key, p_requested_by,
    p_fixture_version, p_anchor_date, p_expected_generation
  );

  IF p_operation = 'provision'
     AND operation_row.status = 'succeeded'
     AND coalesce(operation_row.affected_counts->>'noop', 'false') = 'true' THEN
    UPDATE public.demo_operations
    SET status = 'started',
        generation_after = NULL,
        affected_counts = '{}'::jsonb,
        finished_at = NULL,
        error_message = NULL,
        updated_at = now()
    WHERE id = operation_row.id
    RETURNING * INTO operation_row;
  END IF;

  RETURN operation_row;
END;
$$;

-- Batch 1's first configuration must never adopt an organization that already
-- existed outside the registry, even if its display name happens to match.
CREATE OR REPLACE FUNCTION public.demo_configure_target(
  p_organization_id uuid,
  p_fixture_version text,
  p_anchor_date date
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  existing_name text;
BEGIN
  IF p_organization_id <> 'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2e7a01'::uuid
     OR p_fixture_version <> 'clariva-live-demo-v1'
     OR p_anchor_date <> DATE '2026-01-05' THEN
    RAISE EXCEPTION 'Demo executor target or fixture contract is not approved'
      USING ERRCODE = '42501';
  END IF;

  SELECT name INTO existing_name
  FROM public.organizations
  WHERE id = p_organization_id;

  IF existing_name IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.demo_organization_registry
       WHERE organization_id = p_organization_id
     ) THEN
    RAISE EXCEPTION 'The fixed demo organization id already exists outside the demo registry'
      USING ERRCODE = '23505';
  END IF;
  IF existing_name IS NOT NULL AND existing_name <> 'Clariva Demo Organization' THEN
    RAISE EXCEPTION 'The fixed demo organization id belongs to another organization'
      USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.organizations (id, name, industry)
  VALUES (p_organization_id, 'Clariva Demo Organization', 'Leadership development')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.demo_executor_target (singleton, organization_id, fixture_version, anchor_date)
  VALUES (true, p_organization_id, p_fixture_version, p_anchor_date)
  ON CONFLICT (singleton) DO UPDATE
    SET organization_id = EXCLUDED.organization_id,
        fixture_version = EXCLUDED.fixture_version,
        anchor_date = EXCLUDED.anchor_date;

  INSERT INTO public.demo_organization_registry (
    organization_id, slug, display_name, fixture_version, anchor_date
  )
  VALUES (
    p_organization_id, 'clariva-demo-organization',
    'Clariva Demo Organization', p_fixture_version, p_anchor_date
  )
  ON CONFLICT (organization_id) DO UPDATE
    SET fixture_version = EXCLUDED.fixture_version,
        anchor_date = COALESCE(demo_organization_registry.anchor_date, EXCLUDED.anchor_date),
        updated_at = now();
END;
$$;

REVOKE ALL ON FUNCTION public.demo_batch_2_leader(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.demo_register_batch_2_resource(text, uuid, bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.demo_batch_2_ensure_auth_identity(uuid, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.demo_assert_batch_2_collisions() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.demo_validate_batch_2_ownership() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.demo_apply_batch_2(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.demo_begin_batch_2_operation(uuid, text, text, uuid, text, date, bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.demo_configure_target(uuid, text, date) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.demo_assert_batch_2_collisions() TO service_role;
GRANT EXECUTE ON FUNCTION public.demo_apply_batch_2(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.demo_begin_batch_2_operation(uuid, text, text, uuid, text, date, bigint) TO service_role;