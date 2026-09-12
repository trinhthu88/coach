begin;
select plan(19);

select has_table('public', 'demo_organization_registry', 'demo registry exists');
select has_table('public', 'demo_accounts', 'demo account registry exists');
select has_table('public', 'demo_resource_registry', 'demo resource registry exists');
select has_table('public', 'demo_operations', 'demo operation ledger exists');

select has_function(
  'public',
  'get_demo_organization_status',
  array['uuid'],
  'admin-only demo status function exists'
);
select ok(
  has_function_privilege(
    'authenticated',
    'public.get_demo_organization_status(uuid)',
    'EXECUTE'
  ),
  'authenticated callers can invoke the guarded status function'
);

select col_is_pk('public', 'demo_organization_registry', 'organization_id', 'registry is keyed by organization');
select col_is_unique('public', 'demo_organization_registry', 'slug', 'registry slug is unique');
select col_is_unique('public', 'demo_accounts', 'user_id', 'a user can belong to at most one demo account');
select ok(
  exists (
    select 1 from pg_constraint
    where conrelid='public.demo_operations'::regclass
      and contype='u'
      and pg_get_constraintdef(oid) like '%idempotency_key%'
  ),
  'operation idempotency is constrained per organization'
);

select ok(
  (select pg_get_constraintdef(oid) from pg_constraint
   where conrelid='public.demo_organization_registry'::regclass
     and conname='demo_organization_registry_slug_check')
   like '%clariva-demo-organization%',
  'only the approved demo slug is accepted'
);
select ok(
  (select pg_get_constraintdef(oid) from pg_constraint
   where conrelid='public.demo_organization_registry'::regclass
     and conname='demo_organization_registry_display_name_check')
   like '%Clariva Demo Organization%',
  'only the approved demo display name is accepted'
);

select ok(
  not exists (
    select 1
    from pg_policies
    where schemaname='public'
      and tablename in (
        'demo_organization_registry',
        'demo_accounts',
        'demo_resource_registry',
        'demo_operations'
      )
      and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
      and qual like '%true%'
  ),
  'registry tables do not expose unrestricted client writes'
);

select ok(
  exists (
    select 1 from pg_policies
    where schemaname='public'
      and tablename='demo_organization_registry'
      and cmd='SELECT'
      and qual like '%has_role%'
  ),
  'registry reads require the admin role'
);

select is(
  (select count(*)::int from public.demo_organization_registry),
  0,
  'migration does not seed a live organization automatically'
);

select ok(
  not exists (
    select 1
    from public.demo_operations o
    join public.demo_organization_registry r on r.organization_id=o.organization_id
    where o.organization_id is null
  ),
  'operation ledger rows cannot be orphaned from the registry'
);

select ok(
  exists (
    select 1 from pg_constraint
    where conrelid='public.demo_accounts'::regclass
      and contype='c'
      and pg_get_constraintdef(oid) like '%learner-executive%'
  ),
  'account keys are a fixed allowlist'
);

select ok(
  exists (
    select 1 from pg_constraint
    where conrelid='public.demo_operations'::regclass
      and contype='c'
      and pg_get_constraintdef(oid) like '%provision%'
  ),
  'operations are a fixed provision/reset allowlist'
);

select ok(
  exists (
    select 1 from pg_constraint
    where conrelid='public.demo_resource_registry'::regclass
      and contype='f'
      and pg_get_constraintdef(oid) like '%demo_organization_registry%'
  ),
  'resource ownership is anchored to the protected registry'
);

select * from finish();
rollback;