-- ===========================================================================
-- Requirement calendar verification (READ-ONLY).
--
-- Prints the canonical requirement calendar of chosen leaders and proves that
-- the headline numbers every surface shows (Admin roster, Sponsor header,
-- Learner dashboard, checkpoints) are aggregates of it.
--
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -f scripts/requirement-calendar-verification.sql
--   psql "$DB_URL" -v leaders="'Ana Silva','Grace Adeyemi'" -v as_of="'2026-09-22'" -f ...
--
-- Defaults: leaders Ana Silva and Grace Adeyemi, as-of = current_date.
-- Nothing here writes; the whole script runs in a read-only transaction.
-- ===========================================================================
\set ON_ERROR_STOP 1
\if :{?leaders}
\else
  \set leaders '''Ana Silva'',''Grace Adeyemi'''
\endif
\if :{?as_of}
\else
  \set as_of 'current_date'
\endif

BEGIN READ ONLY;

-- The chosen leaders' enrollments (inlined into every query below).
\set v_enrollments '(SELECT e.id AS enrollment_id, pr.full_name AS leader, pr.email, o.name AS organisation, c.name AS cohort, p.name AS programme, e.status FROM public.programme_enrollments e JOIN public.profiles pr ON pr.id = e.user_id LEFT JOIN public.organizations o ON o.id = e.organization_id LEFT JOIN public.cohorts c ON c.id = e.cohort_id LEFT JOIN public.programmes p ON p.id = e.programme_id WHERE pr.full_name IN (' :leaders '))'

\echo
\echo '== 1. Enrollments (organisation comes from the enrollment, never the cohort) =='
SELECT leader, email, organisation, cohort, programme, status, enrollment_id
FROM :v_enrollments v ORDER BY leader, cohort;

\echo
\echo '== 2. Canonical requirement calendar: module | requirement | due_date | completed | due | overdue =='
SELECT v.leader, v.cohort, k.module, k.requirement_label AS requirement, k.due_on AS due_date,
  k.is_completed AS completed, k.completed_on, k.is_due_as_of AS due, k.is_overdue AS overdue
FROM :v_enrollments v
CROSS JOIN LATERAL public.canonical_enrollment_requirement_calendar(v.enrollment_id, :as_of) k
ORDER BY v.leader, v.cohort, k.due_on NULLS LAST, k.module, k.requirement_index;

\echo
\echo '== 3. Totals: calendar vs canonical progress (the Sponsor header / Admin roster numbers) =='
SELECT v.leader, v.cohort,
  cal.required, cal.completed, cal.due, cal.overdue,
  cp.required_units AS progress_required, cp.completed_units AS progress_completed,
  cp.due_units AS progress_due, cp.overdue_units AS progress_overdue,
  (cal.required, cal.completed, cal.due, cal.overdue)
    = (cp.required_units, cp.completed_units, cp.due_units, cp.overdue_units) AS agrees
FROM :v_enrollments v
CROSS JOIN LATERAL (
  SELECT count(*)::int AS required, count(*) FILTER (WHERE k.is_completed)::int AS completed,
    count(*) FILTER (WHERE k.is_due_as_of)::int AS due, count(*) FILTER (WHERE k.is_overdue)::int AS overdue
  FROM public.canonical_enrollment_requirement_calendar(v.enrollment_id, :as_of) k) cal
CROSS JOIN LATERAL public.canonical_enrollment_progress(v.enrollment_id, :as_of) cp
ORDER BY v.leader, v.cohort;

\echo
\echo '== 4. Per module =='
SELECT v.leader, v.cohort, m.module, m.required_units, m.completed_units, m.due_units, m.overdue_units, m.pace_status
FROM :v_enrollments v
CROSS JOIN LATERAL public.canonical_module_progress(v.enrollment_id, :as_of) m
ORDER BY v.leader, v.cohort, m.module;

\echo
\echo '== 5. Checkpoints (cumulative: requirements due on/before the date, fulfilled by then) =='
SELECT v.leader, v.cohort, (cp->>'checkpoint_number')::int AS n, (cp->>'due_on')::date AS due_on,
  cp->>'label' AS training_week, cp->'module_scope' AS modules,
  (cp->>'completed_units') || ' / ' || (cp->>'required_units') AS progress, cp->>'state' AS state,
  (cp->>'required_units')::int = (
    SELECT count(*) FROM public.canonical_enrollment_requirement_calendar(v.enrollment_id, :as_of) k
    WHERE k.due_on <= (cp->>'due_on')::date) AS matches_calendar
FROM :v_enrollments v
CROSS JOIN LATERAL jsonb_array_elements(public.canonical_enrollment_journey(v.enrollment_id, :as_of)) cp
ORDER BY v.leader, v.cohort, 3;

\echo
\echo '== 6. Training / Learning child breakdown (counts only) =='
SELECT v.leader, v.cohort, b->>'label' AS child_type,
  (b->>'completed_units') || ' / ' || (b->>'required_units') AS completed, b->>'due_units' AS due,
  b->>'overdue_units' AS overdue, b->>'status' AS status
FROM :v_enrollments v
CROSS JOIN LATERAL jsonb_array_elements(public.canonical_learning_breakdown(v.enrollment_id, :as_of)) b
ORDER BY v.leader, v.cohort;

\echo
\echo '== 7. Goals (the data behind the Sponsor goal aggregate) =='
SELECT v.leader, v.cohort, g.title, g.status, gp.start_rating, gp.current_rating, gp.target_rating,
  round(gp.progress_pct) AS progress_pct,
  (SELECT count(*) FROM public.goal_checkins ci WHERE ci.goal_id = g.id) AS checkins,
  (SELECT count(*) FROM public.coachee_milestones ms WHERE ms.goal_id = g.id) AS milestones
FROM :v_enrollments v
JOIN public.coachee_goals g ON g.enrollment_id = v.enrollment_id
LEFT JOIN public.canonical_goal_progress(v.enrollment_id) gp ON gp.goal_id = g.id
ORDER BY v.leader, v.cohort, g.sort_order;

\echo
\echo '== 8. Organisation leader counts (enrollment-scoped) =='
SELECT o.name AS organisation,
  count(e.id) FILTER (WHERE e.status IN ('active', 'at_risk', 'paused')) AS ongoing_enrollments,
  count(DISTINCT e.user_id) FILTER (WHERE e.status IN ('active', 'at_risk', 'paused')) AS ongoing_leaders,
  count(e.id) FILTER (WHERE e.status NOT IN ('active', 'at_risk', 'paused')) AS historical_enrollments,
  count(DISTINCT e.cohort_id) AS cohorts
FROM public.organizations o
LEFT JOIN public.programme_enrollments e ON e.organization_id = o.id
GROUP BY o.name ORDER BY o.name;

\echo
\echo '== 9. Sponsors and the leaders their organisation scope makes visible =='
SELECT sp_pr.email AS sponsor, o.name AS organisation, c.name AS cohort,
  string_agg(pr.full_name, ', ' ORDER BY pr.full_name) AS visible_leaders
FROM public.sponsor_profiles sp
JOIN public.profiles sp_pr ON sp_pr.id = sp.user_id
JOIN public.organizations o ON o.id = sp.organization_id
JOIN public.programme_enrollments e ON e.organization_id = sp.organization_id
JOIN public.profiles pr ON pr.id = e.user_id
LEFT JOIN public.cohorts c ON c.id = e.cohort_id
GROUP BY sp_pr.email, o.name, c.name ORDER BY sp_pr.email, c.name;

\echo
\echo '== 10. Requirement integrity issues (empty = N units -> N dated requirements everywhere) =='
SELECT i.issue, c.name AS cohort, p.name AS programme, i.module, i.enrollment_id, i.detail
FROM public.requirement_integrity_issues() i
LEFT JOIN public.cohorts c ON c.id = i.cohort_id
LEFT JOIN public.programmes p ON p.id = i.programme_id
ORDER BY 1, 2;

ROLLBACK;
