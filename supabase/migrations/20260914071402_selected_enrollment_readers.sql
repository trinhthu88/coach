-- All learner module gates must use the explicitly selected enrollment.
-- Keeping this separate from the legacy user-wide RPCs lets historical
-- enrollments remain readable without allowing their modules to bleed into
-- the current programme.
CREATE OR REPLACE FUNCTION public.get_enrollment_programme_modules(p_enrollment_id uuid)
RETURNS TABLE (
  module public.programme_module_type,
  enabled boolean,
  config jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT ms.module, true, jsonb_build_object(
    'required', ms.required,
    'required_units', ms.required_units,
    'distribution_mode', ms.distribution_mode,
    'distribution_settings', ms.distribution_settings,
    'weight', ms.weight
  )
  FROM public.enrollment_module_snapshots ms
  JOIN public.programme_enrollments pe ON pe.id = ms.enrollment_id
  WHERE ms.enrollment_id = p_enrollment_id
    AND pe.user_id = auth.uid()
    AND pe.user_id = auth.uid()
  UNION ALL
  SELECT pm.module, pm.enabled, pm.config
  FROM public.programme_enrollments pe
  JOIN public.programme_modules pm ON pm.programme_id = pe.programme_id
  WHERE pe.id = p_enrollment_id
    AND pe.user_id = auth.uid()
    AND pm.enabled = true
    AND NOT EXISTS (
      SELECT 1
      FROM public.enrollment_module_snapshots ms
      WHERE ms.enrollment_id = pe.id
    );
$$;

REVOKE EXECUTE ON FUNCTION public.get_enrollment_programme_modules(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_enrollment_programme_modules(uuid) TO authenticated;