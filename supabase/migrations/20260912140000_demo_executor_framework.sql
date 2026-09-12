-- Batch 1: transactional executor framework for the fixed Clariva demo.
--
-- This migration does not create the 40 leaders, demo accounts, programmes,
-- cohorts, or activity rows. It adds the server-only state machine that later
-- fixture batches will use.

CREATE TABLE IF NOT EXISTS public.demo_executor_target (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  organization_id uuid NOT NULL
    CHECK (organization_id = 'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2e7a01'::uuid),
  fixture_version text NOT NULL
    CHECK (fixture_version = 'clariva-live-demo-v1'),
  anchor_date date NOT NULL
    CHECK (anchor_date = DATE '2026-01-05'),
  configured_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.demo_executor_target ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.demo_operations
  ADD COLUMN IF NOT EXISTS expected_generation bigint
    CHECK (expected_generation IS NULL OR expected_generation >= 0);

ALTER TABLE public.demo_operations
  ADD COLUMN IF NOT EXISTS request_fingerprint text NOT NULL DEFAULT '';

ALTER TABLE public.demo_operations
  ADD COLUMN IF NOT EXISTS lock_key bigint;

ALTER TABLE public.demo_operations
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS demo_operations_active_idx
  ON public.demo_operations (organization_id, status, started_at)
  WHERE status = 'started';

CREATE OR REPLACE FUNCTION public.demo_assert_service_target(
  p_organization_id uuid,
  p_fixture_version text,
  p_anchor_date date
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_organization_id <> 'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2e7a01'::uuid
     OR p_fixture_version <> 'clariva-live-demo-v1'
     OR p_anchor_date <> DATE '2026-01-05' THEN
    RAISE EXCEPTION 'Demo executor target or fixture contract is not approved'
      USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.demo_executor_target t
    WHERE t.singleton
      AND t.organization_id = p_organization_id
      AND t.fixture_version = p_fixture_version
      AND t.anchor_date = p_anchor_date
  ) THEN
    RAISE EXCEPTION 'Demo executor target has not been configured'
      USING ERRCODE = '42501';
  END IF;
END;
$$;

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
    p_organization_id,
    'clariva-demo-organization',
    'Clariva Demo Organization',
    p_fixture_version,
    p_anchor_date
  )
  ON CONFLICT (organization_id) DO UPDATE
    SET fixture_version = EXCLUDED.fixture_version,
        anchor_date = COALESCE(demo_organization_registry.anchor_date, EXCLUDED.anchor_date),
        updated_at = now();
END;
$$;

CREATE OR REPLACE FUNCTION public.demo_assert_no_account_collisions()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  conflicting_email text;
BEGIN
  SELECT lower(u.email)
  INTO conflicting_email
  FROM auth.users u
  WHERE lower(u.email) IN (
    'demo-learner-executive@demo.clariva.club',
    'demo-learner-emerging@demo.clariva.club',
    'demo-coach@demo.clariva.club',
    'demo-sponsor@demo.clariva.club'
  )
    AND NOT EXISTS (
      SELECT 1
      FROM public.demo_accounts da
      WHERE da.user_id = u.id
        AND da.organization_id = 'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2e7a01'::uuid
    )
  ORDER BY lower(u.email)
  LIMIT 1;

  IF conflicting_email IS NOT NULL THEN
    RAISE EXCEPTION 'A real or unregistered Auth account already uses the demo email %; refusing adoption',
      conflicting_email USING ERRCODE = '23505';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.demo_begin_operation(
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
  result public.demo_operations;
  registry public.demo_organization_registry;
  active_operation public.demo_operations;
  lock_value bigint;
  fingerprint text;
BEGIN
  PERFORM public.demo_assert_service_target(
    p_organization_id, p_fixture_version, p_anchor_date
  );

  IF p_operation NOT IN ('provision', 'reset') THEN
    RAISE EXCEPTION 'Unsupported demo operation' USING ERRCODE = '22023';
  END IF;
  IF p_idempotency_key IS NULL OR length(btrim(p_idempotency_key)) < 8
     OR length(p_idempotency_key) > 120
     OR p_idempotency_key !~ '^[A-Za-z0-9._:-]+$' THEN
    RAISE EXCEPTION 'Invalid demo operation idempotency key' USING ERRCODE = '22023';
  END IF;
  IF p_requested_by IS NULL THEN
    RAISE EXCEPTION 'Demo operations require an authenticated requester'
      USING ERRCODE = '23502';
  END IF;

  fingerprint := p_operation || ':' || p_fixture_version || ':' ||
    p_anchor_date::text || ':' || coalesce(p_expected_generation::text, '*');

  SELECT * INTO result
  FROM public.demo_operations
  WHERE organization_id = p_organization_id
    AND idempotency_key = btrim(p_idempotency_key)
  FOR UPDATE;

  IF FOUND THEN
    IF result.request_fingerprint <> fingerprint THEN
      RAISE EXCEPTION 'Idempotency key was reused for a different demo operation'
        USING ERRCODE = '23505';
    END IF;
    RETURN result;
  END IF;

  SELECT * INTO registry
  FROM public.demo_organization_registry
  WHERE organization_id = p_organization_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'The fixed demo organization registry is not configured'
      USING ERRCODE = 'P0001';
  END IF;

  IF p_expected_generation IS NOT NULL
     AND registry.generation <> p_expected_generation THEN
    INSERT INTO public.demo_operations (
      organization_id, operation, idempotency_key, requested_by,
      fixture_version, anchor_date, generation_before, expected_generation,
      request_fingerprint, status, error_message, finished_at, updated_at
    )
    VALUES (
      p_organization_id, p_operation, btrim(p_idempotency_key), p_requested_by,
      p_fixture_version, p_anchor_date, registry.generation, p_expected_generation,
      fingerprint, 'failed', 'Generation changed before the operation started',
      now(), now()
    )
    RETURNING * INTO result;
    RETURN result;
  END IF;

  lock_value := hashtextextended(
    'clariva-demo-operation:' || p_organization_id::text, 0
  );

  IF NOT pg_try_advisory_xact_lock(lock_value) THEN
    INSERT INTO public.demo_operations (
      organization_id, operation, idempotency_key, requested_by,
      fixture_version, anchor_date, generation_before, expected_generation,
      request_fingerprint, lock_key, status, error_message, finished_at, updated_at
    )
    VALUES (
      p_organization_id, p_operation, btrim(p_idempotency_key), p_requested_by,
      p_fixture_version, p_anchor_date, registry.generation, p_expected_generation,
      fingerprint, lock_value, 'busy',
      'Another demo operation is already holding the organization lock',
      now(), now()
    )
    RETURNING * INTO result;
    RETURN result;
  END IF;

  SELECT * INTO active_operation
  FROM public.demo_operations
  WHERE organization_id = p_organization_id
    AND status = 'started'
  ORDER BY started_at DESC
  LIMIT 1
  FOR UPDATE;

  IF FOUND AND active_operation.started_at > now() - interval '15 minutes' THEN
    INSERT INTO public.demo_operations (
      organization_id, operation, idempotency_key, requested_by,
      fixture_version, anchor_date, generation_before, expected_generation,
      request_fingerprint, lock_key, status, error_message, finished_at, updated_at
    )
    VALUES (
      p_organization_id, p_operation, btrim(p_idempotency_key), p_requested_by,
      p_fixture_version, p_anchor_date, registry.generation, p_expected_generation,
      fingerprint, lock_value, 'busy',
      'Another demo operation is already active',
      now(), now()
    )
    RETURNING * INTO result;
    RETURN result;
  END IF;

  IF FOUND THEN
    UPDATE public.demo_operations
    SET status = 'failed',
        error_message = 'Operation expired before completion',
        finished_at = now(),
        updated_at = now()
    WHERE id = active_operation.id;

    IF registry.state IN ('resetting', 'uninitialized') THEN
      UPDATE public.demo_organization_registry
      SET state = 'failed', updated_at = now()
      WHERE organization_id = p_organization_id;
    END IF;
  END IF;

  IF p_operation = 'reset' AND registry.state <> 'ready' THEN
    INSERT INTO public.demo_operations (
      organization_id, operation, idempotency_key, requested_by,
      fixture_version, anchor_date, generation_before, expected_generation,
      request_fingerprint, lock_key, status, error_message, finished_at, updated_at
    )
    VALUES (
      p_organization_id, p_operation, btrim(p_idempotency_key), p_requested_by,
      p_fixture_version, p_anchor_date, registry.generation, p_expected_generation,
      fingerprint, lock_value, 'failed',
      'Reset requires a ready demo registry',
      now(), now()
    )
    RETURNING * INTO result;
    RETURN result;
  END IF;

  IF p_operation = 'provision' AND registry.state = 'ready' THEN
    INSERT INTO public.demo_operations (
      organization_id, operation, idempotency_key, requested_by,
      fixture_version, anchor_date, generation_before, generation_after,
      expected_generation, request_fingerprint, lock_key, status,
      affected_counts, finished_at, updated_at
    )
    VALUES (
      p_organization_id, p_operation, btrim(p_idempotency_key), p_requested_by,
      p_fixture_version, p_anchor_date, registry.generation, registry.generation,
      p_expected_generation, fingerprint, lock_value, 'succeeded',
      jsonb_build_object('noop', true), now(), now()
    )
    RETURNING * INTO result;
    RETURN result;
  END IF;

  INSERT INTO public.demo_operations (
    organization_id, operation, idempotency_key, requested_by,
    fixture_version, anchor_date, generation_before, expected_generation,
    request_fingerprint, lock_key, status, updated_at
  )
  VALUES (
    p_organization_id, p_operation, btrim(p_idempotency_key), p_requested_by,
    p_fixture_version, p_anchor_date, registry.generation, p_expected_generation,
    fingerprint, lock_value, 'started', now()
  )
  RETURNING * INTO result;

  IF p_operation = 'reset' THEN
    UPDATE public.demo_organization_registry
    SET state = 'resetting', updated_at = now()
    WHERE organization_id = p_organization_id;
  END IF;

  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION public.demo_finish_operation(
  p_operation_id uuid,
  p_affected_counts jsonb DEFAULT '{}'::jsonb
) RETURNS public.demo_operations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  operation_row public.demo_operations;
  registry public.demo_organization_registry;
  next_generation bigint;
BEGIN
  SELECT * INTO operation_row
  FROM public.demo_operations
  WHERE id = p_operation_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Demo operation was not found' USING ERRCODE = 'P0001';
  END IF;
  IF operation_row.status <> 'started' THEN
    RETURN operation_row;
  END IF;

  PERFORM pg_advisory_xact_lock(operation_row.lock_key);

  SELECT * INTO registry
  FROM public.demo_organization_registry
  WHERE organization_id = operation_row.organization_id
  FOR UPDATE;
  IF NOT FOUND OR registry.generation <> operation_row.generation_before THEN
    UPDATE public.demo_operations
    SET status = 'failed',
        error_message = 'Generation changed while the demo operation was running',
        finished_at = now(),
        updated_at = now()
    WHERE id = p_operation_id
    RETURNING * INTO operation_row;
    UPDATE public.demo_organization_registry
    SET state = 'failed', updated_at = now()
    WHERE organization_id = operation_row.organization_id;
    RETURN operation_row;
  END IF;

  next_generation := registry.generation + 1;
  UPDATE public.demo_organization_registry
  SET generation = next_generation,
      state = 'ready',
      fixture_version = operation_row.fixture_version,
      anchor_date = operation_row.anchor_date,
      last_successful_reset_at = CASE
        WHEN operation_row.operation = 'reset' THEN now()
        ELSE last_successful_reset_at
      END,
      updated_at = now()
  WHERE organization_id = operation_row.organization_id;

  UPDATE public.demo_operations
  SET status = 'succeeded',
      generation_after = next_generation,
      affected_counts = coalesce(p_affected_counts, '{}'::jsonb),
      finished_at = now(),
      updated_at = now()
  WHERE id = p_operation_id
  RETURNING * INTO operation_row;

  RETURN operation_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.demo_fail_operation(
  p_operation_id uuid,
  p_error_message text
) RETURNS public.demo_operations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  operation_row public.demo_operations;
BEGIN
  SELECT * INTO operation_row
  FROM public.demo_operations
  WHERE id = p_operation_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Demo operation was not found' USING ERRCODE = 'P0001';
  END IF;
  IF operation_row.status <> 'started' THEN
    RETURN operation_row;
  END IF;

  PERFORM pg_advisory_xact_lock(operation_row.lock_key);
  UPDATE public.demo_operations
  SET status = 'failed',
      error_message = left(coalesce(nullif(btrim(p_error_message), ''), 'Demo operation failed'), 500),
      finished_at = now(),
      updated_at = now()
  WHERE id = p_operation_id
  RETURNING * INTO operation_row;

  UPDATE public.demo_organization_registry
  SET state = 'failed', updated_at = now()
  WHERE organization_id = operation_row.organization_id
    AND state IN ('resetting', 'uninitialized');

  RETURN operation_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.demo_reap_stale_operation(
  p_operation_id uuid,
  p_max_age interval DEFAULT interval '15 minutes'
) RETURNS public.demo_operations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  operation_row public.demo_operations;
BEGIN
  SELECT * INTO operation_row
  FROM public.demo_operations
  WHERE id = p_operation_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Demo operation was not found' USING ERRCODE = 'P0001';
  END IF;
  IF operation_row.status = 'started'
     AND operation_row.started_at < now() - p_max_age THEN
    RETURN public.demo_fail_operation(
      p_operation_id,
      'Operation was marked failed after exceeding the stale-operation window'
    );
  END IF;
  RETURN operation_row;
END;
$$;

REVOKE ALL ON TABLE public.demo_executor_target FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.demo_assert_service_target(uuid, text, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.demo_configure_target(uuid, text, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.demo_assert_no_account_collisions() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.demo_begin_operation(uuid, text, text, uuid, text, date, bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.demo_finish_operation(uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.demo_fail_operation(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.demo_reap_stale_operation(uuid, interval) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.demo_assert_service_target(uuid, text, date) TO service_role;
GRANT EXECUTE ON FUNCTION public.demo_configure_target(uuid, text, date) TO service_role;
GRANT EXECUTE ON FUNCTION public.demo_assert_no_account_collisions() TO service_role;
GRANT EXECUTE ON FUNCTION public.demo_begin_operation(uuid, text, text, uuid, text, date, bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.demo_finish_operation(uuid, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.demo_fail_operation(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.demo_reap_stale_operation(uuid, interval) TO service_role;

CREATE OR REPLACE FUNCTION public.get_demo_organization_status(p_organization_id uuid)
RETURNS TABLE (
  organization_id uuid,
  is_demo boolean,
  display_name text,
  fixture_version text,
  generation bigint,
  state text,
  anchor_date date,
  last_successful_reset_at timestamptz,
  last_operation_status text,
  last_operation_id uuid,
  last_operation_error text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.role() <> 'service_role'
     AND NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Only administrators can inspect demo status' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    r.organization_id,
    true,
    r.display_name,
    r.fixture_version,
    r.generation,
    r.state,
    r.anchor_date,
    r.last_successful_reset_at,
    latest.status,
    latest.id,
    latest.error_message
  FROM public.demo_organization_registry r
  LEFT JOIN LATERAL (
    SELECT o.status, o.id, o.error_message
    FROM public.demo_operations o
    WHERE o.organization_id = r.organization_id
    ORDER BY o.started_at DESC
    LIMIT 1
  ) latest ON true
  WHERE r.organization_id = p_organization_id;
END;
$$;

REVOKE ALL ON FUNCTION public.get_demo_organization_status(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_demo_organization_status(uuid) TO authenticated, service_role;