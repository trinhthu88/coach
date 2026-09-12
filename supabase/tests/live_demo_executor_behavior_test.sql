begin;

select plan(17);

-- A disposable operator profile is used so this test does not depend on the
-- contents of the local seed. Everything is rolled back at the end.
insert into auth.users (
  id, instance_id, aud, role, email, email_confirmed_at,
  raw_user_meta_data, created_at, updated_at
)
values (
  '11111111-1111-4111-8111-199999999991'::uuid,
  '00000000-0000-0000-0000-000000000000'::uuid,
  'authenticated', 'authenticated', 'batch1-executor-test@demo.clariva.club',
  now(), '{"full_name":"Batch 1 Executor Test"}'::jsonb, now(), now()
)
on conflict (id) do nothing;

insert into public.profiles (id, full_name, email, status)
values (
  '11111111-1111-4111-8111-199999999991'::uuid,
  'Batch 1 Executor Test',
  'batch1-executor-test@demo.clariva.club',
  'active'
)
on conflict (id) do nothing;

select lives_ok(
  $$select public.demo_configure_target(
    'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2e7a01'::uuid,
    'clariva-live-demo-v1',
    date '2026-01-05'
  )$$,
  'the approved target can be configured by the server executor'
);

select lives_ok(
  $$select public.demo_begin_operation(
    'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2e7a01'::uuid,
    'provision',
    'batch1-duplicate-key',
    '11111111-1111-4111-8111-199999999991'::uuid,
    'clariva-live-demo-v1',
    date '2026-01-05'
  )$$,
  'the first operation request starts'
);

select is(
  (select count(*)::int from public.demo_operations
   where idempotency_key = 'batch1-duplicate-key'),
  1,
  'the first idempotency key creates one ledger row'
);

select lives_ok(
  $$select public.demo_begin_operation(
    'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2e7a01'::uuid,
    'provision',
    'batch1-duplicate-key',
    '11111111-1111-4111-8111-199999999991'::uuid,
    'clariva-live-demo-v1',
    date '2026-01-05'
  )$$,
  'a duplicate request replays the existing operation safely'
);

select is(
  (select count(*)::int from public.demo_operations
   where idempotency_key = 'batch1-duplicate-key'),
  1,
  'a duplicate request does not create a second ledger row'
);

select throws_ok(
  $$select public.demo_begin_operation(
    'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2e7a01'::uuid,
    'reset',
    'batch1-duplicate-key',
    '11111111-1111-4111-8111-199999999991'::uuid,
    'clariva-live-demo-v1',
    date '2026-01-05'
  )$$,
  '23505',
  'Idempotency key was reused for a different demo operation',
  'a key cannot be reused for a different request'
);

select lives_ok(
  $$select public.demo_finish_operation(
    (select id from public.demo_operations where idempotency_key = 'batch1-duplicate-key'),
    '{"organizations":1,"registryRows":1,"leaders":0,"activity":0}'::jsonb
  )$$,
  'a started operation can commit its generation'
);

select is(
  (select generation from public.demo_organization_registry
   where organization_id = 'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2e7a01'::uuid),
  1::bigint,
  'a successful operation advances the generation exactly once'
);

select lives_ok(
  $$select public.demo_begin_operation(
    'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2e7a01'::uuid,
    'reset',
    'batch1-concurrent-first',
    '11111111-1111-4111-8111-199999999991'::uuid,
    'clariva-live-demo-v1',
    date '2026-01-05'
  )$$,
  'a reset can start from a ready registry'
);

select is(
  (select status from public.demo_operations
   where idempotency_key = 'batch1-concurrent-first'),
  'started',
  'the first reset remains active until its executor phase finishes'
);

select lives_ok(
  $$select public.demo_begin_operation(
    'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2e7a01'::uuid,
    'reset',
    'batch1-concurrent-second',
    '11111111-1111-4111-8111-199999999991'::uuid,
    'clariva-live-demo-v1',
    date '2026-01-05'
  )$$,
  'a concurrent request is recorded instead of running'
);

select is(
  (select status from public.demo_operations
   where idempotency_key = 'batch1-concurrent-second'),
  'busy',
  'a second active request is marked busy'
);

update public.demo_operations
set started_at = now() - interval '16 minutes'
where idempotency_key = 'batch1-concurrent-first';

select lives_ok(
  $$select public.demo_reap_stale_operation(
    (select id from public.demo_operations where idempotency_key = 'batch1-concurrent-first')
  )$$,
  'a stale operation is failed safely'
);

select is(
  (select status from public.demo_operations
   where idempotency_key = 'batch1-concurrent-first'),
  'failed',
  'stale operations are never silently resumed'
);

select is(
  (select state from public.demo_organization_registry
   where organization_id = 'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2e7a01'::uuid),
  'failed',
  'a stale reset leaves the registry fail-closed'
);

select throws_ok(
  $$select public.demo_begin_operation(
    '00000000-0000-4000-8000-000000000099'::uuid,
    'provision',
    'batch1-non-demo-target',
    '11111111-1111-4111-8111-199999999991'::uuid,
    'clariva-live-demo-v1',
    date '2026-01-05'
  )$$,
  '42501',
  'Demo executor target or fixture contract is not approved',
  'a non-demo organization cannot be targeted'
);

insert into auth.users (
  id, instance_id, aud, role, email, email_confirmed_at,
  raw_user_meta_data, created_at, updated_at
)
values (
  '11111111-1111-4111-8111-199999999992'::uuid,
  '00000000-0000-0000-0000-000000000000'::uuid,
  'authenticated', 'authenticated', 'demo-coach@demo.clariva.club',
  now(), '{"full_name":"Real Account Collision"}'::jsonb, now(), now()
)
on conflict (id) do nothing;

select throws_ok(
  $$select public.demo_assert_no_account_collisions()$$,
  '23505',
  'A real or unregistered Auth account already uses the demo email demo-coach@demo.clariva.club; refusing adoption',
  'an existing real account cannot be silently adopted'
);

select * from finish();
rollback;