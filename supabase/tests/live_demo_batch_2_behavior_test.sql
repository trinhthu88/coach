begin;

select plan(22);

insert into auth.users (
  id, instance_id, aud, role, email, email_confirmed_at,
  raw_user_meta_data, created_at, updated_at
)
values (
  '11111111-1111-4111-8111-299999999991'::uuid,
  '00000000-0000-0000-0000-000000000000'::uuid,
  'authenticated', 'authenticated', 'batch2-executor-test@demo.clariva.club',
  now(), '{"full_name":"Batch 2 Executor Test"}'::jsonb, now(), now()
)
on conflict (id) do nothing;

insert into public.profiles (id, full_name, email, status)
values (
  '11111111-1111-4111-8111-299999999991'::uuid,
  'Batch 2 Executor Test',
  'batch2-executor-test@demo.clariva.club',
  'active'
)
on conflict (id) do nothing;

select lives_ok(
  $$select public.demo_configure_target(
    'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2e7a01'::uuid,
    'clariva-live-demo-v1',
    date '2026-01-05'
  )$$,
  'Batch 2 configures the fixed target'
);

insert into public.programmes (id, name, description)
values (
  '99999999-9999-4999-8999-999999999991'::uuid,
  'Batch 2 non-demo sentinel',
  'Must remain untouched by reconciliation'
);

insert into public.programmes (id, name)
values (
  'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2a0101'::uuid,
  'Collision Programme'
);

select throws_ok(
  $$select public.demo_assert_batch_2_collisions()$$,
  '23505',
  'Batch 2 programme identifier exists without demo ownership; refusing adoption',
  'an existing fixed programme identifier cannot be adopted'
);

delete from public.programmes
where id = 'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2a0101'::uuid;

insert into public.organizations (id, name)
values ('99999999-9999-4999-8999-999999999992'::uuid, 'Batch 2 other organization');
insert into public.cohorts (id, name, organization_id)
values (
  'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2b0101'::uuid,
  'Batch 2 wrong-organization cohort',
  '99999999-9999-4999-8999-999999999992'::uuid
);

select throws_ok(
  $$select public.demo_assert_batch_2_collisions()$$,
  '23505',
  'Batch 2 cohort identifier exists without demo ownership; refusing adoption',
  'a cohort owned by another organization cannot be adopted'
);

delete from public.cohorts
where id = 'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2b0101'::uuid;
delete from public.organizations
where id = '99999999-9999-4999-8999-999999999992'::uuid;

select lives_ok(
  $$select public.demo_begin_batch_2_operation(
    'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2e7a01'::uuid,
    'provision',
    'batch2-first-provision',
    '11111111-1111-4111-8111-299999999991'::uuid,
    'clariva-live-demo-v1',
    date '2026-01-05'
  )$$,
  'Batch 2 starts through the protected lifecycle'
);

select is(
  (select status from public.demo_operations where idempotency_key = 'batch2-first-provision'),
  'started',
  'Batch 2 starts in the started state'
);

select lives_ok(
  $$select public.demo_apply_batch_2(
    (select id from public.demo_operations where idempotency_key = 'batch2-first-provision')
  )$$,
  'Batch 2 reconciliation commits its fixture rows transactionally'
);

select lives_ok(
  $$select public.demo_finish_operation(
    (select id from public.demo_operations where idempotency_key = 'batch2-first-provision'),
    '{"programmes":4,"cohorts":4,"accounts":4,"authUsers":42,"profiles":42,"roleAssignments":42,"leaderProfiles":40,"enrollments":40,"activity":0,"ownershipResources":221}'::jsonb
  )$$,
  'Batch 2 finishes and advances the generation'
);

select is(
  (select count(*)::int from public.programmes where id::text like 'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2a01%'),
  4,
  'exactly four deterministic programmes exist'
);

select is(
  (select count(*)::int from public.cohorts where id::text like 'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2b01%'),
  4,
  'exactly four deterministic cohorts exist'
);

select is(
  (select count(*)::int from public.demo_accounts
   where organization_id = 'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2e7a01'::uuid),
  4,
  'exactly four dedicated demo accounts are linked'
);

select is(
  (select count(*)::int
   from public.programme_enrollments e
   where e.id in (
     select l.enrollment_id
     from generate_series(1, 40) s(serial)
     cross join lateral public.demo_batch_2_leader(s.serial) l
   )),
  40,
  'exactly 40 deterministic enrollments exist'
);

select is(
  (select count(*)::int
   from public.programme_enrollments e
   join public.cohorts c on c.id = e.cohort_id
   where c.name = 'Executive Coaching — Cohort A'),
  8,
  'cohort A has eight leaders'
);

select is(
  (select count(*)::int
   from public.programme_enrollments e
   join public.cohorts c on c.id = e.cohort_id
   where c.name = 'Leadership Development — Cohort B'),
  10,
  'cohort B has ten leaders'
);

select is(
  (select count(*)::int
   from public.programme_enrollments e
   join public.cohorts c on c.id = e.cohort_id
   where c.name = 'Emerging Leaders — Cohort C'),
  12,
  'cohort C has twelve leaders'
);

select is(
  (select count(*)::int
   from public.programme_enrollments e
   join public.cohorts c on c.id = e.cohort_id
   where c.name = 'Leadership Excellence — Cohort D'),
  10,
  'cohort D has ten leaders'
);

select is(
  (select count(*)::int
   from public.demo_resource_registry
   where organization_id = 'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2e7a01'::uuid
     and protected_baseline),
  221,
  'every Batch 2 resource is registered and protected'
);

select ok(
  exists (
    select 1 from public.programmes
    where id = '99999999-9999-4999-8999-999999999991'::uuid
      and name = 'Batch 2 non-demo sentinel'
  ),
  'non-demo sentinel data is unchanged'
);

select is(
  (select count(*)::int
   from public.programme_enrollments e
   where e.id in (
     select l.enrollment_id
     from generate_series(1, 40) s(serial)
     cross join lateral public.demo_batch_2_leader(s.serial) l
   )
   and not exists (select 1 from public.sessions x where x.enrollment_id = e.id)
   and not exists (select 1 from public.coachee_goals x where x.enrollment_id = e.id)
   and not exists (select 1 from public.training_progress x where x.enrollment_id = e.id)
   and not exists (select 1 from public.mentoring_sessions x where x.enrollment_id = e.id)
   and not exists (select 1 from public.peer_sessions x where x.enrollment_id = e.id)
   and not exists (select 1 from public.triad_sessions x
                   where e.id in (x.coach_enrollment_id, x.coachee_enrollment_id, x.observer_enrollment_id))
   and not exists (select 1 from public.enrollment_module_snapshots x where x.enrollment_id = e.id)
   and not exists (select 1 from public.enrollment_module_milestones x where x.enrollment_id = e.id)
  ),
  40,
  'Batch 2 creates no activity or schedule rows'
);

select lives_ok(
  $$select public.demo_begin_batch_2_operation(
    'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2e7a01'::uuid,
    'provision',
    'batch2-repeat-provision',
    '11111111-1111-4111-8111-299999999991'::uuid,
    'clariva-live-demo-v1',
    date '2026-01-05'
  )$$,
  'a ready-state provision re-enters the reconciliation path'
);

select lives_ok(
  $$select public.demo_apply_batch_2(
    (select id from public.demo_operations where idempotency_key = 'batch2-repeat-provision')
  )$$,
  'the repeated Batch 2 reconciliation is idempotent'
);

select lives_ok(
  $$select public.demo_finish_operation(
    (select id from public.demo_operations where idempotency_key = 'batch2-repeat-provision')
  )$$,
  'the repeated reconciliation completes normally'
);

select is(
  (select generation from public.demo_organization_registry
   where organization_id = 'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2e7a01'::uuid),
  2::bigint,
  'repeat reconciliation advances generation exactly once'
);

select * from finish();
rollback;