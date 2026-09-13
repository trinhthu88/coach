-- Keep the legacy-compatible satisfaction RPC on the same canonical metric
-- contract as the current Sponsor Dashboard RPCs.

DROP FUNCTION IF EXISTS public.sponsor_satisfaction_summary(uuid);
CREATE FUNCTION public.sponsor_satisfaction_summary(p_cohort_id uuid)
RETURNS TABLE(cohort_id uuid, rated_session_count integer, avg_rating numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT r.cohort_id,
    sum(r.satisfaction_rated_count)::integer,
    round(avg(r.satisfaction_avg), 2)
  FROM public.sponsor_metric_rows(p_cohort_id, current_date) r
  WHERE r.satisfaction_avg IS NOT NULL
  GROUP BY r.cohort_id;
$$;

REVOKE ALL ON FUNCTION public.sponsor_satisfaction_summary(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sponsor_satisfaction_summary(uuid) TO authenticated;