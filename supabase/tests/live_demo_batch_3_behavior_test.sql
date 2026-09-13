-- Batch 3 behavior contract. Run only against an isolated local database.
-- This file never provisions production data.

insert into auth.users (
  id, instance_id, aud, role, email, email_confirmed_at,
  raw_user_meta_data, created_at, updated_at
)
values (
  '11111111-1111-4111-8111-399999999991'::uuid,
  '00000000-0000-0000-0000-000000000000'::uuid,
  'authenticated', 'authenticated', 'batch3-executor-test@demo.clariva.club',
  now(), '{"full_name":"Batch 3 Executor Test"}'::jsonb, now(), now()
)
on conflict (id) do nothing;

insert into public.profiles (id, full_name, email, status)
values (
  '11111111-1111-4111-8111-399999999991'::uuid,
  'Batch 3 Executor Test',
  'batch3-executor-test@demo.clariva.club',
  'active'
)
on conflict (id) do nothing;

insert into public.user_roles (user_id, role)
values ('11111111-1111-4111-8111-399999999991'::uuid, 'admin')
on conflict (user_id, role) do nothing;

do $$
begin
  perform public.demo_configure_target(
    'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2e7a01'::uuid,
    'clariva-live-demo-v1',
    date '2026-01-05'
  );
end
$$;

insert into public.organizations (id, name)
values (
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid,
  'Non-demo sentinel organization'
)
on conflict (id) do nothing;

select plan(52);

select has_function(
  'public',
  'demo_apply_batch_3',
  array['uuid'],
  'Batch 3 is exposed only through a server-side operation function'
);

select has_function(
  'public',
  'demo_begin_batch_3_operation',
  array['uuid','text','text','uuid','text','date','bigint'],
  'Batch 3 uses the protected operation lifecycle'
);

select lives_ok(
  $$select public.demo_assert_batch_3_collisions()$$,
  'Batch 3 collision checks preserve the fixed target'
);

do $$
declare
  existing_programmes integer;
  batch2_operation public.demo_operations;
  applied_counts jsonb;
begin
  select count(*)::integer into existing_programmes
  from public.programmes
  where id = 'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2a0101'::uuid;
  if existing_programmes = 0 then
    select * into batch2_operation
    from public.demo_begin_batch_2_operation(
      'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2e7a01'::uuid,
      'provision',
      'batch3-bootstrap-batch2',
      '11111111-1111-4111-8111-399999999991'::uuid,
      'clariva-live-demo-v1',
      date '2026-01-05'
    );
    if batch2_operation.status = 'started' then
      applied_counts := public.demo_apply_batch_2(batch2_operation.id);
      perform public.demo_finish_operation(batch2_operation.id, applied_counts);
    end if;
  end if;
end
$$;

select throws_ok(
  $$select public.demo_batch_3_id('not-a-fixture-kind', 1)$$,
  '22023',
  'Unknown or invalid Batch 3 identifier: not-a-fixture-kind/1',
  'Batch 3 identifier generation rejects unknown domains'
);

select lives_ok(
  $$select public.demo_begin_batch_3_operation(
    'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2e7a01'::uuid,
    'provision',
    'batch3-behavior-provision',
    '11111111-1111-4111-8111-399999999991'::uuid,
    'clariva-live-demo-v1',
    date '2026-01-05'
  )$$,
  'Batch 3 starts with the fixed organization and anchor date'
);

select lives_ok(
  $$select public.demo_apply_batch_3(
    (select id from public.demo_operations
     where idempotency_key = 'batch3-behavior-provision')
  )$$,
  'Batch 3 applies activity transactionally'
);

select set_config(
  'request.jwt.claim.sub',
  '11111111-1111-4111-8111-399999999991',
  true
);

select is(
  (select count(*)::int
   from (
     select distinct p.pace_status
     from public.programme_enrollments e
     cross join lateral public.get_enrollment_progress(e.id, date '2026-03-15') p
     where e.organization_id =
       'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2e7a01'::uuid
       and e.cohort_id in (
         'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2b0101'::uuid,
         'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2b0102'::uuid,
         'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2b0103'::uuid
       )
       and p.pace_status in ('ahead', 'on_track', 'scheduled', 'behind')
   ) states),
  4,
  'active cohorts expose ahead, on-track, scheduled, and behind pace states'
);

select is(
  (select count(*)::int from public.programme_modules
   where programme_id in (
     'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2a0101'::uuid,
     'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2a0102'::uuid,
     'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2a0103'::uuid,
     'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2a0104'::uuid
   )),
  24,
  'module enablement is deterministic'
);

select is(
  (select count(*)::int from public.training_weeks
   where programme_id in (
     'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2a0102'::uuid,
     'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2a0103'::uuid,
     'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2a0104'::uuid
   )),
  18,
  'training weeks are present only where training is enabled'
);

select is(
  (select count(*)::int from public.sessions s
   join public.programme_enrollments e on e.id = s.enrollment_id
   where e.organization_id =
     'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2e7a01'::uuid),
  128,
  'coaching rows have deterministic count and enrollment ownership'
);

select is(
  (select count(*)::int from public.mentoring_sessions s
   join public.programme_enrollments e on e.id = s.enrollment_id
   where e.organization_id =
     'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2e7a01'::uuid),
  60,
  'mentoring rows have deterministic count and enrollment ownership'
);

select is(
  (select count(*)::int from public.coachee_peer_sessions s
   join public.programme_enrollments e on e.id = s.enrollment_id
   where e.organization_id =
     'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2e7a01'::uuid),
  44,
  'peer rows have deterministic count and enrollment ownership'
);

select is(
  (select count(*)::int from public.triad_groups
   where programme_id in (
     'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2a0103'::uuid,
     'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2a0104'::uuid
   )),
  7,
  'triad group count is deterministic'
);

select is(
  (select count(*)::int from public.triad_sessions ts
   join public.triad_groups tg on tg.id = ts.triad_group_id
   where tg.programme_id in (
     'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2a0103'::uuid,
     'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2a0104'::uuid
   )),
  14,
  'triad session count is deterministic'
);

select is(
  (select count(*)::int from public.programme_enrollments
   where cohort_id = 'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2b0104'::uuid
     and status = 'completed'),
  10,
  'historical cohort D remains completed'
);

select is(
  (select count(*)::int from public.training_progress tp
   join public.programme_enrollments e on e.id = tp.enrollment_id
   where e.organization_id =
     'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2e7a01'::uuid),
  192,
  'training progress is enrollment-scoped'
);

select is(
  (select count(*)::int from public.coachee_goals g
   join public.programme_enrollments e on e.id = g.enrollment_id
   where e.organization_id =
     'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2e7a01'::uuid),
  40,
  'goals are one per enrollment'
);

select is(
  (select count(*)::int from public.enrollment_actions a
   join public.programme_enrollments e on e.id = a.enrollment_id
   where e.organization_id =
     'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2e7a01'::uuid),
  57,
  'normalized actions are enrollment-scoped'
);

select is(
  (select count(*)::int from public.demo_resource_registry
   where organization_id =
     'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2e7a01'::uuid
     and resource_type in (
       'programme_module', 'training_week', 'session', 'mentoring_session',
       'coachee_peer_session', 'triad_group', 'triad_session', 'coachee_goal',
       'coachee_milestone', 'coachee_goal_rating', 'goal_checkin',
       'enrollment_action', 'training_progress',
       'enrollment_module_snapshot', 'enrollment_module_milestone'
     )),
  1746,
  'all Batch 3 resources are registered to the fixed organization'
);

select is(
  (select count(*)::int from public.sessions
   where topic <> 'Demo session'
      or coach_notes is not null
      or coach_private_notes is not null
      or coachee_notes is not null
      or coachee_rating_comment is not null),
  0,
  'coaching rows contain no restricted text or written feedback'
);

select is(
  (select count(*)::int from public.mentoring_sessions
   where mentor_notes is not null
      or mentee_notes is not null
      or prep_file_notes is not null
      or feedback_submitted_at is not null),
  0,
  'mentoring rows contain no notes, feedback, or file content'
);

select is(
  (select count(*)::int from public.coachee_goals
   where title <> 'Demo goal' or description is not null),
  0,
  'goal text is neutral and descriptions are absent'
);

select is(
  (select count(*)::int from public.enrollment_actions
   where title <> 'Demo action' or description is not null),
  0,
  'action text is neutral and descriptions are absent'
);

select lives_ok(
  $$select public.demo_validate_batch_3_ownership()$$,
  'ownership closure and cross-organization isolation pass'
);

do $$
begin
  perform public.demo_finish_operation(
    (select id from public.demo_operations
     where idempotency_key = 'batch3-behavior-provision')
  );
end
$$;

select has_function(
  'public',
  'demo_apply_batch_4',
  array['uuid'],
  'Batch 4 exposes a server-only full reset executor'
);

select has_function(
  'public',
  'demo_begin_batch_4_operation',
  array['uuid','text','text','uuid','text','date','bigint'],
  'Batch 4 reset uses the existing lifecycle wrapper'
);

select lives_ok(
  $$select public.demo_validate_batch_4_ownership()$$,
  'Batch 4 verifies ownership closure before reset'
);

select lives_ok(
  $$select public.demo_begin_batch_4_operation(
    'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2e7a01'::uuid,
    'reset',
    'batch4-reset-one',
    '11111111-1111-4111-8111-399999999991'::uuid,
    'clariva-live-demo-v1',
    date '2026-01-05',
    (select generation from public.demo_organization_registry
     where organization_id = 'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2e7a01'::uuid)
  )$$,
  'Batch 4 starts a fixed-target reset'
);

select lives_ok(
  $$select public.demo_begin_batch_4_operation(
    'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2e7a01'::uuid,
    'reset',
    'batch4-reset-one',
    '11111111-1111-4111-8111-399999999991'::uuid,
    'clariva-live-demo-v1',
    date '2026-01-05'
  )$$,
  'Duplicate reset idempotency returns the original operation'
);

select is(
  (select count(*)::int from public.demo_operations where idempotency_key = 'batch4-reset-one'),
  1,
  'Duplicate reset does not create a second operation'
);

select is(
  (select (public.demo_begin_batch_4_operation(
    'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2e7a01'::uuid,
    'reset',
    'batch4-reset-concurrent',
    '11111111-1111-4111-8111-399999999991'::uuid,
    'clariva-live-demo-v1',
    date '2026-01-05'
  )).status),
  'busy',
  'Concurrent reset is rejected as busy'
);

select lives_ok(
  $$select public.demo_apply_batch_4(
    (select id from public.demo_operations
     where idempotency_key = 'batch4-reset-one')
  )$$,
  'Batch 4 deletes only registered demo resources and rebuilds the fixture'
);

select lives_ok(
  $$select public.demo_finish_operation(
    (select id from public.demo_operations
     where idempotency_key = 'batch4-reset-one')
  )$$,
  'Batch 4 records a successful reset transition'
);

select is(
  (select generation::int from public.demo_organization_registry
   where organization_id = 'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2e7a01'::uuid),
  3,
  'First reset increments the generation exactly once'
);

select is(
  (select count(*)::int from public.demo_resource_registry
   where organization_id = 'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2e7a01'::uuid),
  1746,
  'First reset rebuilds the exact ownership resource count'
);

select is(
  (select count(*)::int from public.organizations
   where id = 'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2e7a01'::uuid),
  1,
  'First reset preserves the fixed demo organization'
);

select is(
  (select count(*)::int from public.organizations
   where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid),
  1,
  'First reset preserves a non-demo sentinel organization'
);

select lives_ok(
  $$select public.demo_assert_batch_4_privacy()$$,
  'First reset preserves the sponsor privacy boundary'
);

select lives_ok(
  $$select public.demo_begin_batch_4_operation(
    'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2e7a01'::uuid,
    'reset',
    'batch4-reset-two',
    '11111111-1111-4111-8111-399999999991'::uuid,
    'clariva-live-demo-v1',
    date '2026-01-05',
    3
  )$$,
  'A second reset can start from the rebuilt ready state'
);

select lives_ok(
  $$select public.demo_apply_batch_4(
    (select id from public.demo_operations
     where idempotency_key = 'batch4-reset-two')
  )$$,
  'Second reset rebuilds from the same registered ownership set'
);

select lives_ok(
  $$select public.demo_finish_operation(
    (select id from public.demo_operations
     where idempotency_key = 'batch4-reset-two')
  )$$,
  'Second reset completes successfully'
);

select is(
  (select generation::int from public.demo_organization_registry
   where organization_id = 'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2e7a01'::uuid),
  4,
  'Second reset increments the generation exactly once'
);

select is(
  (select count(*)::int from public.sessions s
   join public.programme_enrollments e on e.id = s.enrollment_id
   where e.organization_id = 'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2e7a01'::uuid),
  128,
  'Second reset returns the deterministic coaching count'
);

select is(
  (select count(*)::int from public.enrollment_actions a
   join public.programme_enrollments e on e.id = a.enrollment_id
   where e.organization_id = 'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2e7a01'::uuid),
  57,
  'Second reset returns the deterministic action count'
);

update public.organizations
set account_manager_id = (
  select resource_id
  from public.demo_resource_registry
  where organization_id = 'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2e7a01'::uuid
    and resource_type = 'profile'
  order by resource_id
  limit 1
)
where id = 'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2e7a01'::uuid;

select lives_ok(
  $$select public.demo_begin_batch_4_operation(
    'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2e7a01'::uuid,
    'reset',
    'batch4-fail-closed',
    '11111111-1111-4111-8111-399999999991'::uuid,
    'clariva-live-demo-v1',
    date '2026-01-05',
    4
  )$$,
  'Fail-closed reset starts before checking an unsafe reference'
);

select throws_ok(
  $$select public.demo_apply_batch_4(
    (select id from public.demo_operations
     where idempotency_key = 'batch4-fail-closed')
  )$$,
  '42501',
  'Batch 4 found an unregistered profile reference in public.organizations',
  'Unsafe profile references abort the reset before deletion commits'
);

select is(
  (select count(*)::int from public.sessions s
   join public.programme_enrollments e on e.id = s.enrollment_id
   where e.organization_id = 'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2e7a01'::uuid),
  128,
  'A failed reset rolls back its attempted deletes and rebuilds'
);

select lives_ok(
  $$select public.demo_fail_operation(
    (select id from public.demo_operations
     where idempotency_key = 'batch4-fail-closed'),
    'Expected test failure'
  )$$,
  'The failed reset is recorded in the audit ledger'
);

update public.organizations
set account_manager_id = null
where id = 'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2e7a01'::uuid;

select throws_ok(
  $$select public.demo_begin_batch_4_operation(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid,
    'reset',
    'batch4-wrong-target',
    '11111111-1111-4111-8111-399999999991'::uuid,
    'clariva-live-demo-v1',
    date '2026-01-05'
  )$$,
  '42501',
  'Demo executor target or fixture contract is not approved',
  'Batch 4 rejects a browser or caller-supplied organization target'
);

select lives_ok(
  $$select public.demo_begin_batch_4_operation(
    'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2e7a01'::uuid,
    'reset',
    'batch4-stale-reset',
    '11111111-1111-4111-8111-399999999991'::uuid,
    'clariva-live-demo-v1',
    date '2026-01-05',
    4
  )$$,
  'Stale-operation handling starts a third reset lifecycle record'
);

update public.demo_operations
set started_at = now() - interval '16 minutes'
where idempotency_key = 'batch4-stale-reset';

select lives_ok(
  $$select public.demo_reap_stale_operation(
    (select id from public.demo_operations
     where idempotency_key = 'batch4-stale-reset')
  )$$,
  'Stale reset is failed closed by the executor'
);

select is(
  (select status from public.demo_operations
   where idempotency_key = 'batch4-stale-reset'),
  'failed',
  'Stale reset records a failed audit transition'
);

select * from finish();