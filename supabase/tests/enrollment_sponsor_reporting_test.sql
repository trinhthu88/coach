begin;
select plan(32);

-- Contract and authorization surface: the canonical Sponsor reporting chain
-- (canonical_enrollment_progress -> sponsor_canonical_enrollment_progress ->
-- sponsor_canonical_cohort_progress -> sponsor_canonical_organisation_progress).
-- The former sponsor_enrollment_summaries / sponsor_cohort_summaries /
-- sponsor_organisation_summary engines were retired in
-- 20260918180000_retire_legacy_sponsor_sources.
select has_function('public', 'sponsor_canonical_enrollment_progress', array['uuid', 'date']);
select has_function('public', 'sponsor_canonical_cohort_progress', array['uuid', 'date']);
select has_function('public', 'sponsor_canonical_organisation_progress', array['date']);
select hasnt_function('public', 'sponsor_enrollment_summaries', array['uuid'], 'legacy enrollment summary engine is retired');
select hasnt_function('public', 'sponsor_cohort_summaries', array['uuid'], 'legacy cohort summary engine is retired');
select hasnt_function('public', 'sponsor_organisation_summary', array[]::text[], 'legacy organisation summary engine is retired');
select hasnt_function('public', 'sponsor_satisfaction_summary', array['uuid'], 'legacy satisfaction summary is retired');
select ok(has_function_privilege('authenticated', 'public.sponsor_canonical_enrollment_progress(uuid,date)', 'EXECUTE'), 'authenticated can execute the canonical enrollment rollup');
select ok(has_function_privilege('authenticated', 'public.sponsor_canonical_cohort_progress(uuid,date)', 'EXECUTE'), 'authenticated can execute the canonical cohort rollup');
select ok(not has_function_privilege('authenticated', 'public.canonical_enrollment_progress(uuid,date)', 'EXECUTE'), 'the shared construction itself is not client-callable');

-- With no authenticated sponsor identity, all scope variants are empty,
-- including NULL and nonexistent/cross-organization UUIDs.
select is_empty(
  $$select * from public.sponsor_canonical_enrollment_progress(null::uuid, current_date)$$,
  'NULL enrollment scope returns no rows without a sponsor identity');
select is_empty(
  $$select * from public.sponsor_canonical_enrollment_progress('00000000-0000-4000-8000-000000000000'::uuid, current_date)$$,
  'unknown enrollment cohort returns no rows');
select is_empty(
  $$select * from public.sponsor_canonical_cohort_progress('00000000-0000-4000-8000-000000000000'::uuid, current_date)$$,
  'unknown aggregate cohort returns no rows');
select lives_ok(
  $$select * from public.sponsor_canonical_cohort_progress(null::uuid, current_date)$$,
  'cohort rollup executes without ambiguous projected columns');

-- Result shape is an allow-list: no identity foreign keys, text content,
-- provider identity, or assessment/private fields can be added silently.
select ok(not exists (
  select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname in ('sponsor_canonical_enrollment_progress','sponsor_canonical_cohort_progress','sponsor_canonical_organisation_progress','sponsor_canonical_enrollment_metadata')
     and pg_get_function_result(p.oid) ~* '(user_id|coachee_id|goal_title|action_title|description|notes?|quiz|score|reflection|prompt|comment|file|recording|transcript|provider|red_flag)'
), 'sponsor result columns contain only approved scalar fields');
select ok(pg_get_functiondef('public.sponsor_canonical_enrollment_progress(uuid,date)'::regprocedure) ~ 'canonical_enrollment_progress',
  'enrollment rows are the shared canonical construction');
select ok(pg_get_functiondef('public.sponsor_canonical_enrollment_progress(uuid,date)'::regprocedure) ~ 'sponsor_min_leaders_for_distribution',
  'enrollment rows enforce the minimum cohort threshold');
select ok(pg_get_functiondef('public.sponsor_canonical_cohort_progress_one(uuid,date)'::regprocedure) ~ 'sponsor_canonical_enrollment_progress'
    and pg_get_functiondef('public.sponsor_canonical_cohort_progress_one(uuid,date)'::regprocedure) !~ 'canonical_module_progress|get_enrollment_progress|coachee_goals|enrollment_actions',
  'the cohort rollup only aggregates canonical enrollment rows');
select ok(pg_get_functiondef('public.sponsor_canonical_organisation_progress(date)'::regprocedure) ~ 'sponsor_canonical_cohort_progress'
    and pg_get_functiondef('public.sponsor_canonical_organisation_progress(date)'::regprocedure) !~ 'canonical_module_progress|sponsor_canonical_enrollment_progress|coachee_goals',
  'the organisation rollup only aggregates canonical cohort rows');
select ok(pg_get_functiondef('public.canonical_enrollment_progress(uuid,date)'::regprocedure) ~ 'least\(c\.completed_units, c\.required_units\)',
  'enrollment percentages are capped');
select ok(pg_get_function_result('public.canonical_enrollment_progress(uuid,date)'::regprocedure) ~ 'booked_units'
    and pg_get_function_result('public.canonical_enrollment_progress(uuid,date)'::regprocedure) ~ 'completed_units',
  'booked units remain distinct from completed units');
select ok(pg_get_functiondef('public.get_enrollment_progress(uuid,date)'::regprocedure) ~ 'least\(raw_booked',
  'historical engine: booked units are bounded to remaining required units');
select ok(pg_get_functiondef('public.sponsor_canonical_cohort_progress_one(uuid,date)'::regprocedure) ~ 'sponsor_min_leaders_for_distribution',
  'cohort rollup is threshold suppressed');
select ok(pg_get_function_result('public.sponsor_canonical_organisation_progress(date)'::regprocedure) !~* '(learner|full_name|user_id|coachee_id)',
  'organisation rollup is unnamed');

-- Sponsors have no direct table path around the threshold-aware reporting
-- functions.  In fixture runs these same checks are executed as a suppressed
-- sponsor and must return zero rows for names, enrollment ids, and progress.
select ok(not exists (
  select 1 from pg_policies
  where schemaname='public'
    and tablename in ('profiles','coachee_profiles','programme_enrollments','programme_modules')
    and policyname ilike '%sponsor%'
), 'sponsors have no direct SELECT policies on private programme tables');
select ok(pg_get_functiondef('public.get_enrollment_progress(uuid,date)'::regprocedure)
  ~ 'sponsor_min_leaders_for_distribution', 'individual progress requires canonical cohort threshold');
select ok(pg_get_functiondef('public.get_enrollment_progress(uuid,date)'::regprocedure)
  ~ 'count\(\*\).*programme_enrollments', 'progress authorization counts the complete cohort');
select has_function('public', 'get_peer_session_usage', array['uuid']);
select has_function('public', 'can_book_peer_session', array['uuid','uuid']);
select has_function('public', 'book_peer_session', array['uuid','uuid','text','timestamptz','integer','uuid']);
select ok(pg_get_functiondef('public.book_peer_session(uuid,uuid,text,timestamptz,integer,uuid)'::regprocedure)
  ~ 'auth\.uid\(\)', 'peer booking RPC preserves authenticated actor identity');
select ok(pg_get_functiondef('public.validate_peer_session_enrollment()'::regprocedure)
  ~ 'peer_coaching', 'peer booking trigger checks enabled peer coaching module');

select * from finish();
rollback;