-- Sponsor attention and health (20261006190000_sponsor_attention; decision 8).
--
-- A leader needs attention when behind pace OR with >= 1 overdue unit. Health
-- is green at 0%, amber up to 15%, red above 15% of leaders needing attention.
begin;
select plan(12);

-- ---------------------------------------------------------------------------
-- The rule
-- ---------------------------------------------------------------------------
select is(public.sponsor_needs_attention('behind', 0), true, 'r1. behind pace: needs attention');
select is(public.sponsor_needs_attention('on_track', 1), true, 'r2. one overdue unit: needs attention');
select is(public.sponsor_needs_attention('ahead', 0), false, 'r3. on pace, nothing overdue: does not');
select is(public.sponsor_health_signal(0, 10), 'green', 'h1. 0% of leaders: green');
select is(public.sponsor_health_signal(1, 10), 'amber', 'h2. 10%: amber');
select is(public.sponsor_health_signal(3, 20), 'amber', 'h3. exactly 15%: amber');
select is(public.sponsor_health_signal(2, 10), 'red', 'h4. 20%: red');
select is(public.sponsor_health_signal(0, 0), null, 'h5. no leaders: no signal');

-- ---------------------------------------------------------------------------
-- On the Sponsor rows (L1 has an overdue unit; L2 is ahead)
-- ---------------------------------------------------------------------------
-- 01 Coach K   02 leader L1 (behind)   03 leader L2 (ahead)   04 Sponsor S
-- 05 leader T1 (Triad programme)
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_user_meta_data, created_at, updated_at, confirmation_token, email_change_token_new, recovery_token)
select ('faf00000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid,
  '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated',
  'overdue-' || n || '@example.test', 'test', now(),
  jsonb_build_object('full_name', 'Overdue Person ' || n), now(), now(), '', '', ''
from generate_series(1, 5) n;
insert into public.user_roles (user_id, role) values
  ('faf00000-0000-4000-8000-000000000001', 'coach'),
  ('faf00000-0000-4000-8000-000000000002', 'coachee'),
  ('faf00000-0000-4000-8000-000000000003', 'coachee'),
  ('faf00000-0000-4000-8000-000000000004', 'sponsor'),
  ('faf00000-0000-4000-8000-000000000005', 'coachee')
on conflict do nothing;
update public.profiles set status = 'active'::public.user_status where id::text like 'faf00000-%';
insert into public.coach_profiles (id, approval_status) values ('faf00000-0000-4000-8000-000000000001', 'active')
on conflict (id) do update set approval_status = 'active';

insert into public.organizations (id, name) values ('faf50000-0000-4000-8000-000000000001', 'Overdue Org');
insert into public.sponsor_profiles (user_id, organization_id)
values ('faf00000-0000-4000-8000-000000000004', 'faf50000-0000-4000-8000-000000000001');

-- Coaching programme: 2 required units. Coaching 1 was due 3 days ago,
-- Coaching 2 is due in 5 days.
insert into public.programmes (id, name) values
  ('faf10000-0000-4000-8000-000000000001', 'Overdue Coaching Programme'),
  ('faf10000-0000-4000-8000-000000000002', 'Overdue Triad Programme');
insert into public.programme_modules (programme_id, module, enabled, config) values
  ('faf10000-0000-4000-8000-000000000001', 'coaching', true, '{"required": true, "required_units": 2}'),
  ('faf10000-0000-4000-8000-000000000002', 'triads', true, '{"required": true, "required_units": 1}');
insert into public.cohorts (id, name, programme_id, organization_id, start_date, end_date) values
  ('faf20000-0000-4000-8000-000000000001', 'Overdue Cohort', 'faf10000-0000-4000-8000-000000000001',
   'faf50000-0000-4000-8000-000000000001', current_date - 60, current_date + 200),
  ('faf20000-0000-4000-8000-000000000002', 'Triad Cohort', 'faf10000-0000-4000-8000-000000000002',
   'faf50000-0000-4000-8000-000000000001', current_date - 60, current_date + 200);
update public.cohort_requirement_dates
   set due_on = case ordinal when 1 then current_date - 3 else current_date + 5 end,
       is_overridden = true, generation_method = 'manual', materialized_via = 'admin_save'
 where cohort_id = 'faf20000-0000-4000-8000-000000000001';
-- Triad 1 is due TODAY.
update public.cohort_requirement_dates
   set due_on = current_date, is_overridden = true, generation_method = 'manual', materialized_via = 'admin_save'
 where cohort_id = 'faf20000-0000-4000-8000-000000000002';
insert into public.cohort_coach_assignments (cohort_id, coach_id)
values ('faf20000-0000-4000-8000-000000000001', 'faf00000-0000-4000-8000-000000000001');

insert into public.programme_enrollments (id, programme_id, user_id, cohort_id, organization_id, status, start_date, end_date) values
  ('faf30000-0000-4000-8000-000000000002', 'faf10000-0000-4000-8000-000000000001', 'faf00000-0000-4000-8000-000000000002',
   'faf20000-0000-4000-8000-000000000001', 'faf50000-0000-4000-8000-000000000001', 'active', current_date - 60, current_date + 200),
  ('faf30000-0000-4000-8000-000000000003', 'faf10000-0000-4000-8000-000000000001', 'faf00000-0000-4000-8000-000000000003',
   'faf20000-0000-4000-8000-000000000001', 'faf50000-0000-4000-8000-000000000001', 'active', current_date - 60, current_date + 200),
  ('faf30000-0000-4000-8000-000000000005', 'faf10000-0000-4000-8000-000000000002', 'faf00000-0000-4000-8000-000000000005',
   'faf20000-0000-4000-8000-000000000002', 'faf50000-0000-4000-8000-000000000001', 'active', current_date - 60, current_date + 200);

-- L1 has done nothing: Coaching 1 is overdue. L2 completed BOTH units, one of
-- them early: L2 is ahead (2 completed, 1 due).
select set_config('app.session_transition', 'on', true);
insert into public.sessions (id, enrollment_id, cohort_requirement_id, coach_id, coachee_id, topic, start_time, duration_minutes, status)
select gen_random_uuid(), 'faf30000-0000-4000-8000-000000000003', d.id,
  'faf00000-0000-4000-8000-000000000001', 'faf00000-0000-4000-8000-000000000003', 'Ahead ' || d.ordinal,
  now() - (case d.ordinal when 1 then 5 else 2 end || ' days')::interval, 60, 'completed'
from public.cohort_requirement_dates d
where d.cohort_id = 'faf20000-0000-4000-8000-000000000001' and d.module = 'coaching';
select set_config('app.session_transition', '', true);


set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'faf00000-0000-4000-8000-000000000004')::text, true);
select results_eq(
  $$select learner_display_name, needs_attention from public.sponsor_canonical_enrollment_metadata('faf20000-0000-4000-8000-000000000001')
     order by learner_display_name$$,
  $$values ('Overdue Person 2'::text, true), ('Overdue Person 3'::text, false)$$,
  's1. each leader row says whether the leader needs attention');
select results_eq(
  $$select needs_attention_count, health_signal from public.sponsor_canonical_cohort_progress('faf20000-0000-4000-8000-000000000001')$$,
  $$values (1, 'red'::text)$$,
  's2. the cohort: 1 of 2 leaders (50%) -- red');
select results_eq(
  $$select needs_attention_count, health_signal from public.sponsor_canonical_organisation_progress()$$,
  $$select sum(needs_attention_count)::integer, public.sponsor_health_signal(sum(needs_attention_count)::integer, sum(enrollment_count)::integer)
     from public.sponsor_canonical_cohort_progress(NULL)$$,
  's3. the organisation adds up its cohorts');
reset role;
select ok(not has_function_privilege('authenticated', 'public.sponsor_canonical_cohort_progress_one(uuid,date)', 'EXECUTE'),
  's4. the per-cohort construction stays internal');

select * from finish();
rollback;
