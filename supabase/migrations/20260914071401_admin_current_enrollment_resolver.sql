-- Canonical, fail-closed current-enrollment lookup for Admin and other
-- server-side consumers.  Historical and unknown statuses are deliberately
-- excluded; the partial unique index remains the invariant for ongoing rows.
CREATE OR REPLACE FUNCTION public.resolve_current_enrollment(p_user_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT e.id
  FROM public.programme_enrollments e
  WHERE e.user_id = p_user_id
    AND e.status::text IN ('active', 'at_risk', 'paused')
    AND (
      public.has_role(auth.uid(), 'admin'::public.app_role)
      OR p_user_id = auth.uid()
    )
  ORDER BY CASE e.status::text
      WHEN 'active' THEN 0
      WHEN 'at_risk' THEN 1
      WHEN 'paused' THEN 1
      ELSE 99
    END,
    e.start_date DESC NULLS LAST,
    e.id
  LIMIT 1;
$$;

REVOKE EXECUTE ON FUNCTION public.resolve_current_enrollment(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.resolve_current_enrollment(uuid) TO authenticated;