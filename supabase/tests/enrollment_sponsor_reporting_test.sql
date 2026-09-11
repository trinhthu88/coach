begin;
select plan(38);

-- Contract and authorization surface.
select has_function('public', 'sponsor_enrollment_summaries', array['uuid']);
select has_function('public', 'sponsor_cohort_summaries', array['uuid']);
select function_lang_is('public', 'sponsor_enrollment_summaries', 'sql');
select function_lang_is('public', 'sponsor_cohort_summaries', 'sql');
select ok(has_function_privilege('authenticated', 'public.sponsor_enrollment_summaries(uuid)', 'EXECUTE'), 'authenticated can execute sponsor_enrollment_summaries');
select ok(has_function_privilege('authenticated', 'public.sponsor_cohort_summaries(uuid)', 'EXECUTE'), 'authenticated can execute sponsor_cohort_summaries');
select ok((select pronargdefaults from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='sponsor_enrollment_summaries') = 0,
  'enrollment scope has no nullable/default cohort bypass');

-- With no authenticated sponsor identity, all scope variants are empty,
-- including NULL and nonexistent/cross-organization UUIDs. Deployment
-- fixtures additionally execute these calls as own-org >=5, own-org <5,
-- cross-org, admin, and non-sponsor identities.
select is_empty(
  $$select * from public.sponsor_enrollment_summaries(null::uuid)$$,
  'NULL enrollment scope returns no rows');
select is_empty(
  $$select * from public.sponsor_enrollment_summaries('00000000-0000-4000-8000-000000000000'::uuid)$$,
  'unknown enrollment cohort returns no rows');
select is_empty(
  $$select * from public.sponsor_cohort_summaries('00000000-0000-4000-8000-000000000000'::uuid)$$,
  'unknown aggregate cohort returns no rows');
select lives_ok(
  $$select * from public.sponsor_cohort_summaries(null::uuid)$$,
  'cohort summaries execute without ambiguous projected columns');

-- Result shape is an allow-list: no identity foreign keys, text content,
-- provider identity, or assessment/private fields can be added silently.
select ok(not exists (
  select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname in ('sponsor_enrollment_summaries','sponsor_cohort_summaries')
     and pg_get_function_result(p.oid) ~* '(user_id|coachee_id|goal_title|action_title|description|notes?|quiz|score|reflection|prompt|comment|file|recording|transcript|provider|red_flag)'
), 'sponsor result columns contain only approved scalar fields');
select ok(pg_get_functiondef('public.sponsor_enrollment_summaries(uuid)'::regprocedure) ~ 'enrollment_id',
  'enrollment rows are enrollment-scoped');
select ok(pg_get_functiondef('public.sponsor_enrollment_summaries(uuid)'::regprocedure) ~ 'sponsor_min_leaders_for_distribution',
  'enrollment rows enforce the minimum cohort threshold');
select ok(pg_get_functiondef('public.sponsor_enrollment_summaries(uuid)'::regprocedure) ~ 'completed',
  'completion and booked activity are distinguished');
select ok(pg_get_functiondef('public.sponsor_enrollment_summaries(uuid)'::regprocedure) ~ 'goals',
  'goal counts use an independent pre-aggregate');
select ok(pg_get_functiondef('public.sponsor_enrollment_summaries(uuid)'::regprocedure) ~ 'actions',
  'action counts use an independent pre-aggregate');
select ok(pg_get_functiondef('public.sponsor_enrollment_summaries(uuid)'::regprocedure) ~ 'e\.id AS enrollment_id',
  'progress CTE uses the programme enrollment primary key');
select ok(pg_get_functiondef('public.sponsor_enrollment_summaries(uuid)'::regprocedure) !~ 'e\.enrollment_id',
  'progress CTE does not reference a nonexistent enrollment_id column');
select ok(pg_get_functiondef('public.sponsor_cohort_summaries(uuid)'::regprocedure) ~ 'THEN NULL ELSE n END',
  'suppressed cohorts do not expose exact enrollment counts');
select ok(pg_get_functiondef('public.sponsor_cohort_summaries(uuid)'::regprocedure) ~ 'sponsor_min_leaders_for_distribution\(\)',
  'privacy threshold uses canonical zero-argument function');
select ok(pg_get_functiondef('public.sponsor_enrollment_summaries(uuid)'::regprocedure) ~ 'least\(100',
  'enrollment percentages are capped');
select ok(pg_get_functiondef('public.sponsor_enrollment_summaries(uuid)'::regprocedure) ~ 'booked_units',
  'booked units remain distinct from completed units');
select ok(pg_get_functiondef('public.get_enrollment_progress(uuid,date)'::regprocedure) ~ 'least\(count',
  'booked units are bounded to remaining required units');
select ok(pg_get_functiondef('public.sponsor_enrollment_summaries(uuid)'::regprocedure) ~ 'greatest\(0, coalesce\(pr.due_units',
  'overdue remains due minus completed even when booked');
select ok(pg_get_functiondef('public.sponsor_satisfaction_summary(uuid)'::regprocedure) ~ 'sponsor_min_leaders_for_distribution',
  'satisfaction is threshold suppressed');
select has_function('public', 'sponsor_organisation_summary', array[]::text[]);
select ok(pg_get_functiondef('public.sponsor_organisation_summary()'::regprocedure) ~ 'sponsor_min_leaders_for_distribution\(\)',
  'organisation summary uses canonical zero-argument threshold');
select ok(pg_get_function_result('public.sponsor_organisation_summary()'::regprocedure) !~* '(learner|full_name|user_id|coachee_id)',
  'organisation summary is unnamed');
select ok(pg_get_functiondef('public.sponsor_organisation_summary()'::regprocedure) ~ 'pace_state',
  'organisation pace distribution is derived from one state per enrollment');

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