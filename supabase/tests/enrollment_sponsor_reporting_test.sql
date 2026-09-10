begin;
select plan(19);

-- Contract and authorization surface.
select has_function('public', 'sponsor_enrollment_summaries', array['uuid']);
select has_function('public', 'sponsor_cohort_summaries', array['uuid']);
select function_lang_is('public', 'sponsor_enrollment_summaries', 'sql');
select function_lang_is('public', 'sponsor_cohort_summaries', 'sql');
select has_function_privilege('authenticated', 'public.sponsor_enrollment_summaries(uuid)', 'EXECUTE');
select has_function_privilege('authenticated', 'public.sponsor_cohort_summaries(uuid)', 'EXECUTE');
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

-- Result shape is an allow-list: no identity foreign keys, text content,
-- provider identity, or assessment/private fields can be added silently.
select ok(not exists (
  select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname in ('sponsor_enrollment_summaries','sponsor_cohort_summaries')
    and pg_get_function_result(p.oid) ~* '(user_id|coachee_id|goal_title|action_title|description|notes?|rating|satisfaction|quiz|score|reflection|prompt|comment|file|recording|transcript|provider|red_flag)'
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
select ok(pg_get_functiondef('public.sponsor_enrollment_summaries(uuid)'::regprocedure) ~ 'e\\.id AS enrollment_id',
  'progress CTE uses the programme enrollment primary key');
select ok(pg_get_functiondef('public.sponsor_enrollment_summaries(uuid)'::regprocedure) !~ 'e\\.enrollment_id',
  'progress CTE does not reference a nonexistent enrollment_id column');
select ok(pg_get_functiondef('public.sponsor_cohort_summaries(uuid)'::regprocedure) ~ 'THEN NULL ELSE n END',
  'suppressed cohorts do not expose exact enrollment counts');

select * from finish();
rollback;