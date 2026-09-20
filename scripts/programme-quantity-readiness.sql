-- Programme quantity / cohort requirement cardinality readiness.
--
-- Run this BEFORE applying 20260923100000_programme_quantity_invariant.sql to
-- a database with real history. Read-only: it changes nothing.
--
--   psql "$DATABASE_URL" -f scripts/programme-quantity-readiness.sql
--
-- The migration refuses to complete while any cohort module is in a state the
-- new invariant calls a violation, so this tells you in advance what you would
-- have to resolve, and which cases the migration can resolve by itself.
--
-- Classification:
--
--   OK                   exactly required_units one-unit rows, ordinals 1..N
--   SAFE_AUTO_FIX        the migration repairs this with no decision: weighted
--                        rows with no activity are expanded in place,
--                        preserving each row's own date and their chronology
--   REQUIRES_ADMIN_DATE  fewer requirements than the programme needs and no
--                        cohort module deadline to project. No date may be
--                        invented (section 4), so an Admin supplies the
--                        completion deadline and the sync materialises the
--                        rest. Allowed to persist; blocks booking until fixed
--   BLOCKED_BY_ACTIVITY  a surplus or out-of-scope requirement that a session,
--                        Triad group or Peer participation points at. The
--                        programme quantity cannot be reduced while this
--                        activity exists: retire the activity, or leave the
--                        programme quantity alone
--   NEEDS_REVIEW         a shortfall, gap or duplicate that the sync cannot
--                        explain. Inspect before migrating

\pset pager off
\echo ''
\echo '=== 1. Per cohort module: required vs scheduled ==='

WITH in_scope AS (
  SELECT c.id AS cohort_id, c.name AS cohort_name, c.end_date,
         r.programme_id, r.module, r.required_units
  FROM public.cohorts c
  CROSS JOIN LATERAL public.cohort_required_module_units(c.id) r
), scope AS (
  SELECT * FROM in_scope
  UNION ALL
  -- Rows whose module the programme no longer requires have no scope entry.
  -- Only those: listing every module twice (once with a NULL required_units)
  -- would report each cohort module as both OK and surplus.
  SELECT DISTINCT d.cohort_id, c.name, c.end_date, d.programme_id, d.module, NULL::integer
  FROM public.cohort_requirement_dates d
  JOIN public.cohorts c ON c.id = d.cohort_id
  WHERE NOT EXISTS (
    SELECT 1 FROM in_scope s
    WHERE s.cohort_id = d.cohort_id AND s.programme_id = d.programme_id AND s.module = d.module)
), rows AS (
  SELECT d.cohort_id, d.programme_id, d.module,
         count(*)::integer                                   AS row_count,
         sum(d.units)::integer                               AS sum_units,
         count(*) FILTER (WHERE d.units <> 1)::integer       AS weighted_rows,
         array_agg(d.ordinal ORDER BY d.ordinal)             AS ordinals,
         count(*) FILTER (WHERE public.cohort_requirement_is_referenced(d.id))::integer
                                                             AS rows_with_activity
  FROM public.cohort_requirement_dates d
  GROUP BY 1, 2, 3
), joined AS (
  SELECT s.*,
    coalesce(r.row_count, 0) AS row_count,
    coalesce(r.sum_units, 0) AS sum_units,
    coalesce(r.weighted_rows, 0) AS weighted_rows,
    coalesce(r.ordinals, '{}') AS ordinals,
    coalesce(r.rows_with_activity, 0) AS rows_with_activity,
    EXISTS (SELECT 1 FROM public.cohort_module_deadlines dl
            WHERE dl.cohort_id = s.cohort_id AND dl.programme_id = s.programme_id
              AND dl.module = s.module) AS has_deadline,
    public.cohort_module_schedule_violation(s.cohort_id, s.programme_id, s.module) AS violation
  FROM scope s
  LEFT JOIN rows r
    ON r.cohort_id = s.cohort_id AND r.programme_id = s.programme_id AND r.module = s.module
)
SELECT
  j.cohort_name,
  j.module,
  j.required_units,
  j.row_count,
  j.sum_units,
  j.weighted_rows,
  j.ordinals,
  -- Ordinals the programme needs that the cohort does not hold, and vice versa.
  (SELECT coalesce(array_agg(g), '{}')
     FROM generate_series(1, coalesce(j.required_units, 0)) g
    WHERE NOT g = ANY (j.ordinals))                            AS missing_ordinals,
  (SELECT coalesce(array_agg(o), '{}')
     FROM unnest(j.ordinals) o
    WHERE o > coalesce(j.required_units, 0))                   AS surplus_ordinals,
  j.rows_with_activity,
  j.has_deadline,
  coalesce(j.violation, 'none')                                AS violation,
  CASE
    WHEN j.violation IS NULL                            THEN 'OK'
    WHEN j.violation = 'weighted_rows'
         AND j.rows_with_activity = 0                   THEN 'SAFE_AUTO_FIX'
    WHEN j.violation = 'weighted_rows'                  THEN 'BLOCKED_BY_ACTIVITY'
    WHEN j.violation = 'missing_deadline'               THEN 'REQUIRES_ADMIN_DATE'
    WHEN j.violation IN ('surplus_requirements', 'out_of_scope')
         AND j.rows_with_activity > 0                   THEN 'BLOCKED_BY_ACTIVITY'
    WHEN j.violation IN ('surplus_requirements', 'out_of_scope')
                                                        THEN 'SAFE_AUTO_FIX'
    ELSE 'NEEDS_REVIEW'
  END                                                          AS classification
FROM joined j
ORDER BY
  CASE
    WHEN j.violation IS NULL THEN 3
    WHEN j.violation = 'missing_deadline' THEN 2
    ELSE 1
  END,
  j.cohort_name, j.module;

\echo ''
\echo '=== 2. Summary by classification ==='

WITH v AS (
  SELECT DISTINCT c.id AS cohort_id, r.programme_id, r.module
  FROM public.cohorts c
  CROSS JOIN LATERAL public.cohort_required_module_units(c.id) r
  UNION
  SELECT DISTINCT d.cohort_id, d.programme_id, d.module
  FROM public.cohort_requirement_dates d
)
SELECT coalesce(public.cohort_module_schedule_violation(v.cohort_id, v.programme_id, v.module), 'none')
         AS violation,
       count(*) AS cohort_modules
FROM v GROUP BY 1 ORDER BY 2 DESC;

\echo ''
\echo '=== 3. Weighted rows, with the expansion the migration would perform ==='
\echo '    (empty = nothing to expand)'

WITH weighted AS (
  SELECT DISTINCT d.cohort_id, d.programme_id, d.module
  FROM public.cohort_requirement_dates d
  WHERE d.units > 1
)
SELECT c.name AS cohort_name, d.module,
  d.ordinal AS current_ordinal, d.units AS current_units, d.due_on,
  row_number() OVER (PARTITION BY d.cohort_id, d.programme_id, d.module
                     ORDER BY d.ordinal, d.id, g.i) AS new_ordinal,
  public.cohort_requirement_is_referenced(d.id) AS has_activity
FROM public.cohort_requirement_dates d
JOIN weighted w
  ON w.cohort_id = d.cohort_id AND w.programme_id = d.programme_id AND w.module = d.module
JOIN public.cohorts c ON c.id = d.cohort_id
CROSS JOIN LATERAL generate_series(1, d.units) AS g(i)
ORDER BY c.name, d.module, new_ordinal;

\echo ''
\echo '=== 4. Verdict ==='

SELECT
  CASE
    WHEN count(*) FILTER (WHERE violation NOT IN ('missing_deadline')) = 0
      THEN 'READY: the migration will apply. '
           || count(*) FILTER (WHERE violation = 'missing_deadline')
           || ' cohort module(s) await an Admin deadline and cannot book until set.'
    ELSE 'NOT READY: ' || count(*) FILTER (WHERE violation NOT IN ('missing_deadline'))
           || ' cohort module(s) violate the invariant. Resolve section 1 above first.'
  END AS verdict
FROM public.cohort_schedule_violations();
