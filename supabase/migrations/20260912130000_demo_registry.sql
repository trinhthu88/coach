-- Production-safe live demo infrastructure.
--
-- This migration creates only the protected registry and operation ledger. It
-- deliberately does not create an organization, Auth identity, programme,
-- cohort, enrollment, or fixture row. Provisioning is a separate, explicit
-- server-side operation and must be pointed at the exact deployment/database.

CREATE TABLE IF NOT EXISTS public.demo_organization_registry (
  organization_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE RESTRICT,
  slug text NOT NULL UNIQUE CHECK (slug = 'clariva-demo-organization'),
  display_name text NOT NULL CHECK (display_name = 'Clariva Demo Organization'),
  fixture_version text NOT NULL,
  generation bigint NOT NULL DEFAULT 0 CHECK (generation >= 0),
  state text NOT NULL DEFAULT 'uninitialized'
    CHECK (state IN ('uninitialized', 'ready', 'resetting', 'failed')),
  anchor_date date,
  last_successful_reset_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.demo_accounts (
  organization_id uuid NOT NULL REFERENCES public.demo_organization_registry(organization_id) ON DELETE CASCADE,
  account_key text NOT NULL CHECK (account_key IN (
    'learner-executive',
    'learner-emerging',
    'coach',
    'sponsor'
  )),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  role public.app_role NOT NULL,
  is_prospect_login boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, account_key),
  UNIQUE (organization_id, user_id),
  UNIQUE (user_id),
  CHECK (
    (account_key IN ('learner-executive', 'learner-emerging') AND role = 'coachee')
    OR (account_key = 'coach' AND role = 'coach')
    OR (account_key = 'sponsor' AND role = 'sponsor')
  )
);

CREATE TABLE IF NOT EXISTS public.demo_resource_registry (
  organization_id uuid NOT NULL REFERENCES public.demo_organization_registry(organization_id) ON DELETE CASCADE,
  resource_type text NOT NULL,
  resource_id uuid NOT NULL,
  generation bigint NOT NULL CHECK (generation >= 0),
  protected_baseline boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, resource_type, resource_id)
);

CREATE TABLE IF NOT EXISTS public.demo_operations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.demo_organization_registry(organization_id) ON DELETE RESTRICT,
  operation text NOT NULL CHECK (operation IN ('provision', 'reset')),
  idempotency_key text NOT NULL,
  requested_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  fixture_version text NOT NULL,
  anchor_date date,
  generation_before bigint NOT NULL CHECK (generation_before >= 0),
  generation_after bigint,
  status text NOT NULL CHECK (status IN ('started', 'succeeded', 'failed', 'busy')),
  affected_counts jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_message text,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  UNIQUE (organization_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS demo_resource_registry_generation_idx
  ON public.demo_resource_registry (organization_id, generation);

CREATE INDEX IF NOT EXISTS demo_operations_org_started_idx
  ON public.demo_operations (organization_id, started_at DESC);

ALTER TABLE public.demo_organization_registry ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.demo_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.demo_resource_registry ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.demo_operations ENABLE ROW LEVEL SECURITY;

-- Admins may inspect the registry and audit ledger. All writes are server-only:
-- the browser cannot change the fixed target, generation, resource ownership,
-- or operation outcome by writing these tables directly.
CREATE POLICY "Demo registry: admin view"
  ON public.demo_organization_registry FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "Demo accounts: admin view"
  ON public.demo_accounts FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "Demo resources: admin view"
  ON public.demo_resource_registry FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "Demo operations: admin view"
  ON public.demo_operations FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

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
  last_operation_status text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
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
    (
      SELECT o.status
      FROM public.demo_operations o
      WHERE o.organization_id = r.organization_id
      ORDER BY o.started_at DESC
      LIMIT 1
    )
  FROM public.demo_organization_registry r
  WHERE r.organization_id = p_organization_id;
END;
$$;

REVOKE ALL ON FUNCTION public.get_demo_organization_status(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_demo_organization_status(uuid) TO authenticated;