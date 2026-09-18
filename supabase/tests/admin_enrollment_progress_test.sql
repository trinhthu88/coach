begin;
select plan(5);

select has_function(
  'public',
  'get_admin_enrollment_progress',
  array['uuid[]', 'date']
);

-- The Admin completion number is the canonical engine's, not a second
-- (weighted snapshot) calculation.
select ok(
  pg_get_functiondef(
    'public.get_admin_enrollment_progress(uuid[],date)'::regprocedure
  ) ~ 'admin_canonical_enrollment_progress',
  'admin progress projects the canonical completion engine'
);
select ok(
  pg_get_functiondef(
    'public.get_admin_enrollment_progress(uuid[],date)'::regprocedure
  ) !~ 'enrollment_module_snapshots|get_enrollment_progress|weight',
  'admin progress no longer reads snapshot progress or module weights'
);
select ok(
  pg_get_functiondef(
    'public.admin_canonical_enrollment_progress(uuid[],date)'::regprocedure
  ) ~ 'canonical_enrollment_progress'
    and pg_get_functiondef(
      'public.admin_canonical_enrollment_progress(uuid[],date)'::regprocedure
    ) ~ 'has_role',
  'admin canonical progress is the shared construction behind an admin check'
);
select ok(
  pg_get_functiondef(
    'public.learner_canonical_progress(uuid,date)'::regprocedure
  ) ~ 'canonical_enrollment_progress'
    and pg_get_functiondef(
      'public.sponsor_canonical_enrollment_progress(uuid,date)'::regprocedure
    ) ~ 'canonical_enrollment_progress',
  'Learner and Sponsor progress use the same construction'
);

select * from finish();
rollback;
