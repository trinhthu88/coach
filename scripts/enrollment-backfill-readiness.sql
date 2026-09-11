-- Read-only readiness report. Run separately against each intended database.
-- A clean test fixture does not establish production readiness.
WITH unresolved AS (
  SELECT table_name AS domain, unresolved_reason AS reason
  FROM public.enrollment_scope_backfill_audit
  UNION ALL
  SELECT 'actions/' || source_activity_type, unresolved_reason
  FROM public.enrollment_action_backfill_audit
  UNION ALL
  SELECT 'schedule', reason FROM public.enrollment_schedule_backfill_audit
)
SELECT CASE WHEN grouping(domain)=1 THEN 'TOTAL' ELSE domain END AS domain,
       CASE WHEN grouping(reason)=1 THEN 'ALL' ELSE reason END AS reason,
       count(*) AS unresolved_count
FROM unresolved
GROUP BY GROUPING SETS ((domain,reason), ())
ORDER BY grouping(domain), domain, reason;
