begin;
select plan(10);

select has_table(
  'public'::name,
  'sponsor_report_requests'::name
);

select has_column(
  'public'::name,
  'sponsor_report_requests'::name,
  'organization_id'::name,
  'organization_id'
);

select has_column(
  'public'::name,
  'sponsor_report_requests'::name,
  'cohort_id'::name,
  'cohort_id'
);

select has_column(
  'public'::name,
  'sponsor_report_requests'::name,
  'status'::name,
  'status'
);
select ok(exists (
  select 1
  from pg_constraint
  where conrelid = 'public.sponsor_report_requests'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) ~ 'submitted.*in_progress.*ready.*declined'
), 'status is constrained');
select has_function('public', 'sponsor_submit_report_request', array['uuid','text']);
select has_function('public', 'sponsor_list_report_requests', array[]::text[]);
select has_function('public', 'admin_list_report_requests', array[]::text[]);
select has_function('public', 'admin_update_report_request', array['uuid','text','text']);
select ok(pg_get_functiondef('public.notify_sponsor_report_status()'::regprocedure) ~ 'notifications',
  'status changes notify the requester');

select * from finish();
rollback;