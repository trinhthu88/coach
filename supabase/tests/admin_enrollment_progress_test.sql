begin;
select plan(5);

-- Admin reads THE canonical completion engine. The former weighted snapshot
-- aggregate (get_admin_enrollment_progress) was a second engine and was
-- retired in 20260918180000_retire_legacy_sponsor_sources.
select hasnt_function('public', 'get_admin_enrollment_progress', array['uuid[]', 'date'],
  'the Admin weighted-snapshot progress engine is retired');
select has_function('public', 'admin_canonical_enrollment_progress', array['uuid[]', 'date']);
select ok(
  pg_get_functiondef('public.admin_canonical_enrollment_progress(uuid[],date)'::regprocedure) ~ 'canonical_enrollment_progress'
    and pg_get_functiondef('public.admin_canonical_enrollment_progress(uuid[],date)'::regprocedure) ~ 'has_role',
  'admin canonical progress is the shared construction behind an admin check'
);
select ok(
  pg_get_functiondef('public.canonical_enrollment_progress(uuid,date)'::regprocedure) !~ 'enrollment_module_snapshots|get_enrollment_progress|weight',
  'the shared construction reads no snapshot progress or module weights'
);
select ok(
  pg_get_functiondef('public.learner_canonical_progress(uuid,date)'::regprocedure) ~ 'canonical_enrollment_progress'
    and pg_get_functiondef('public.sponsor_canonical_enrollment_progress(uuid,date)'::regprocedure) ~ 'canonical_enrollment_progress',
  'Learner and Sponsor progress use the same construction'
);

select * from finish();
rollback;
