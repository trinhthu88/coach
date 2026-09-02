-- Phase 0 (programme-module unification), part 3: RPCs the frontend uses
-- to gate nav/routes on the caller's active programme's modules, instead
-- of the old per-feature user_module_access / coach_session_limits checks.

CREATE OR REPLACE FUNCTION public.get_my_programme_modules()
RETURNS TABLE (
  module public.programme_module_type,
  enabled BOOLEAN,
  config JSONB
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT pm.module, pm.enabled, pm.config
  FROM public.programme_modules pm
  JOIN public.programme_enrollments pe ON pe.programme_id = pm.programme_id
  WHERE pe.user_id = auth.uid()
    AND pe.status = 'active'
    AND pm.enabled = true;
$$;

CREATE OR REPLACE FUNCTION public.has_programme_module(p_module public.programme_module_type)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.programme_modules pm
    JOIN public.programme_enrollments pe ON pe.programme_id = pm.programme_id
    WHERE pe.user_id = auth.uid()
      AND pe.status = 'active'
      AND pm.module = p_module
      AND pm.enabled = true
  );
$$;

CREATE OR REPLACE FUNCTION public.has_programme_module_direction(
  p_module public.programme_module_type,
  p_direction TEXT
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.programme_modules pm
    JOIN public.programme_enrollments pe ON pe.programme_id = pm.programme_id
    WHERE pe.user_id = auth.uid()
      AND pe.status = 'active'
      AND pm.module = p_module
      AND pm.enabled = true
      AND (pm.config->>p_direction)::boolean = true
  );
$$;

REVOKE EXECUTE ON FUNCTION public.get_my_programme_modules() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_programme_modules() TO authenticated;
REVOKE EXECUTE ON FUNCTION public.has_programme_module(public.programme_module_type) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_programme_module(public.programme_module_type) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.has_programme_module_direction(public.programme_module_type, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_programme_module_direction(public.programme_module_type, TEXT) TO authenticated;
