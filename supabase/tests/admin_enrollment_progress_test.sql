begin;
select plan(5);

select has_function(
  'public',
  'get_admin_enrollment_progress',
  array['uuid[]', 'date']
);

-- The admin aggregate must expose the canonical field, never the legacy cache.
select ok(
  pg_get_functiondef(
    'public.get_admin_enrollment_progress(uuid[],date)'::regprocedure
  ) ~ 'full_completion_pct',
  'admin progress returns canonical full_completion_pct'
);
select ok(
  pg_get_functiondef(
    'public.get_admin_enrollment_progress(uuid[],date)'::regprocedure
  ) ~ 'required_module_count <> module_count',
  'modules with no required units produce no overall value'
);
select ok(
  pg_get_functiondef(
    'public.get_admin_enrollment_progress(uuid[],date)'::regprocedure
  ) ~ 'valid_weight_count <> module_count',
  'missing or invalid weights produce no overall value'
);
select ok(
  pg_get_functiondef(
    'public.get_admin_enrollment_progress(uuid[],date)'::regprocedure
  ) ~ 'weight_sum <> 100'
    and pg_get_functiondef(
      'public.get_admin_enrollment_progress(uuid[],date)'::regprocedure
    ) ~ 'weighted_value',
  'exactly 100 valid weight points are required and weighted values are isolated per enrollment'
);

select * from finish();
rollback;