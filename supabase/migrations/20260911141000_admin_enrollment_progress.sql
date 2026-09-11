-- Admin reporting uses enrollment-scoped canonical progress.  An overall
-- value is only meaningful when the programme has explicit, complete weights.
ALTER TABLE public.admin_alerts
  ADD COLUMN IF NOT EXISTS related_enrollment_id uuid
  REFERENCES public.programme_enrollments(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.get_admin_enrollment_progress(
  p_enrollment_ids uuid[],
  p_as_of date DEFAULT current_date
)
RETURNS TABLE(enrollment_id uuid, full_completion_pct numeric)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH requested AS (
    SELECT DISTINCT unnest(p_enrollment_ids) AS enrollment_id
  ), module_values AS (
    SELECT r.enrollment_id, s.module, s.required_units, s.weight,
      ep.full_completion_pct,
      count(*) OVER (PARTITION BY r.enrollment_id) AS module_count,
      count(*) FILTER (WHERE s.required_units > 0) OVER (PARTITION BY r.enrollment_id) AS required_module_count,
      count(*) FILTER (WHERE s.weight IS NOT NULL AND s.weight >= 0 AND s.weight <= 100)
        OVER (PARTITION BY r.enrollment_id) AS valid_weight_count,
      sum(s.weight) OVER (PARTITION BY r.enrollment_id) AS weight_sum
    FROM requested r
    JOIN public.programme_enrollments e ON e.id = r.enrollment_id
    JOIN public.programme_modules pm ON pm.programme_id = e.programme_id AND pm.enabled
    JOIN public.enrollment_module_snapshots s
      ON s.enrollment_id = r.enrollment_id AND s.programme_module_id = pm.id
    LEFT JOIN LATERAL public.get_enrollment_progress(r.enrollment_id, p_as_of) ep
      ON ep.module = s.module
    WHERE public.has_role(auth.uid(), 'admin'::public.app_role)
  ), aggregates AS (
    SELECT enrollment_id, module_count, required_module_count,
      count(*) FILTER (WHERE full_completion_pct IS NOT NULL) AS value_count,
      min(valid_weight_count) AS valid_weight_count, min(weight_sum) AS weight_sum,
      sum(full_completion_pct * weight / 100.0) AS weighted_value
    FROM module_values
    GROUP BY enrollment_id, module_count, required_module_count
  )
  SELECT enrollment_id,
    CASE
      WHEN required_module_count = 0
        OR required_module_count <> module_count
        OR value_count <> module_count
        OR valid_weight_count <> module_count
        OR weight_sum <> 100
      THEN NULL
      ELSE round(weighted_value, 1)
    END
  FROM aggregates;
$$;

REVOKE EXECUTE ON FUNCTION public.get_admin_enrollment_progress(uuid[], date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_admin_enrollment_progress(uuid[], date) TO authenticated;