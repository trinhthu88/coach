begin;

select plan(11);

select ok(
  pg_get_functiondef(
    'public.sponsor_canonical_cohort_progress(uuid,date)'::regprocedure
  ) ~ 'sponsor_canonical_cohort_progress_one'
    AND pg_get_functiondef(
      'public.sponsor_canonical_cohort_progress(uuid,date)'::regprocedure
    ) !~ 'sponsor_canonical_enrollment_progress\(p_cohort_id',
  'all-cohort progress delegates to the bounded per-cohort canonical path'
);

select ok(
  pg_get_functiondef(
    'public.sponsor_canonical_organisation_progress(date)'::regprocedure
  ) ~ 'sponsor_canonical_cohort_progress\(NULL, p_as_of\)',
  'organisation progress rolls up the canonical cohort RPC'
);

select ok(
  pg_get_functiondef(
    'public.sponsor_canonical_organisation_progress(date)'::regprocedure
  ) !~ 'sponsor_canonical_enrollment_progress',
  'organisation progress does not bypass the canonical cohort rollup'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.sponsor_canonical_cohort_progress(uuid,date)',
    'execute'
  ),
  'authenticated retains execute on the public cohort RPC'
);

select ok(
  NOT has_function_privilege(
    'authenticated',
    'public.sponsor_canonical_cohort_progress_one(uuid,date)',
    'execute'
  ),
  'the per-cohort implementation is not directly exposed'
);

select set_config(
  'request.jwt.claim.sub',
  '11111111-1111-4111-8111-111111111116',
  true
);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

-- The bounded all-cohort path must complete under the hosted authenticated
-- timeout. This is deliberately a timeout assertion rather than a wall-clock
-- threshold so the test remains deterministic across local machines.
set local statement_timeout = '8s';

select is(
  (select count(*)::integer
   from public.sponsor_canonical_cohort_progress(NULL::uuid, '2026-07-05'::date)),
  (select count(distinct v.cohort_id)::integer
   from public.sponsor_visible_enrollments() v
   where v.cohort_id is not null),
  'all-cohort progress returns one row per cohort holding a sponsor-visible enrollment before timeout'
);

select is(
  (select count(*)::integer
   from public.sponsor_canonical_cohort_progress(
     '11111111-1111-4111-8111-111111111119'::uuid,
     '2026-07-05'::date
   )),
  1,
  'the existing per-cohort contract still returns one row'
);

select is(
  (select count(*)::integer
   from public.sponsor_canonical_organisation_progress('2026-07-05'::date)),
  1,
  'organisation progress completes through the bounded cohort rollup'
);

select is(
  (select completed_units
   from public.sponsor_canonical_organisation_progress('2026-07-05'::date)),
  (select sum(completed_units)::integer
   from public.sponsor_canonical_cohort_progress(NULL::uuid, '2026-07-05'::date)
   where not suppressed),
  'organisation completed units still equal the visible cohort rollup'
);

select is(
  (select required_units
   from public.sponsor_canonical_organisation_progress('2026-07-05'::date)),
  (select sum(required_units)::integer
   from public.sponsor_canonical_cohort_progress(NULL::uuid, '2026-07-05'::date)
   where not suppressed),
  'organisation required units still equal the visible cohort rollup'
);

select is(
  (select count(*)::integer
   from public.sponsor_canonical_cohort_progress(NULL::uuid, '2026-07-05'::date)
   where suppressed),
  0,
  'visible cohorts are never suppressed (named rows and their exact rollups are not size-gated)'
);

reset role;
select * from finish();
rollback;