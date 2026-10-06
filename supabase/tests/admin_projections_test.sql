-- Admin projections (20261006200000_admin_projections; Prompt 9d).
--
--   a. Admin's completion rate is summed like Sponsor's: completed units over
--      required units across enrollments -- not a mean of per-enrollment
--      percentages, which weighs a 1-unit programme like a 12-unit one.
--   b. A Mentor is a Coach in an active cohort_mentors row: that, not a
--      learner's programme module, opens the mentoring workspace to them.
begin;
select plan(5);

-- 01 Coach K   02 learner A (1-unit programme, done)   03 learner B (3 units, none)   04 Admin
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_user_meta_data, created_at, updated_at, confirmation_token, email_change_token_new, recovery_token)
select ('fa900000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid,
  '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated',
  'proj-' || n || '@example.test', 'test', now(),
  jsonb_build_object('full_name', 'Proj Person ' || n), now(), now(), '', '', ''
from generate_series(1, 4) n;
insert into public.user_roles (user_id, role) values
  ('fa900000-0000-4000-8000-000000000001', 'coach'),
  ('fa900000-0000-4000-8000-000000000002', 'coachee'),
  ('fa900000-0000-4000-8000-000000000003', 'coachee'),
  ('fa900000-0000-4000-8000-000000000004', 'admin')
on conflict do nothing;
update public.profiles set status = 'active'::public.user_status where id::text like 'fa900000-%';
insert into public.coach_profiles (id, approval_status) values ('fa900000-0000-4000-8000-000000000001', 'active')
on conflict (id) do update set approval_status = 'active';

insert into public.programmes (id, name) values
  ('fa910000-0000-4000-8000-000000000001', 'One unit'), ('fa910000-0000-4000-8000-000000000002', 'Three units');
insert into public.programme_modules (programme_id, module, enabled, config) values
  ('fa910000-0000-4000-8000-000000000001', 'coaching', true, '{"required": true, "required_units": 1}'),
  ('fa910000-0000-4000-8000-000000000002', 'coaching', true, '{"required": true, "required_units": 3}');
insert into public.cohorts (id, name, programme_id, start_date, end_date) values
  ('fa920000-0000-4000-8000-000000000001', 'C1', 'fa910000-0000-4000-8000-000000000001', public.programme_today() - 30, public.programme_today() + 200),
  ('fa920000-0000-4000-8000-000000000002', 'C3', 'fa910000-0000-4000-8000-000000000002', public.programme_today() - 30, public.programme_today() + 200);
update public.cohort_requirement_dates
   set due_on = public.programme_today() + 5, is_overridden = true, generation_method = 'manual', materialized_via = 'admin_save'
 where cohort_id in ('fa920000-0000-4000-8000-000000000001', 'fa920000-0000-4000-8000-000000000002');
insert into public.cohort_coach_assignments (cohort_id, coach_id) values
  ('fa920000-0000-4000-8000-000000000001', 'fa900000-0000-4000-8000-000000000001');
insert into public.programme_enrollments (id, programme_id, user_id, cohort_id, status, start_date, end_date) values
  ('fa930000-0000-4000-8000-000000000002', 'fa910000-0000-4000-8000-000000000001', 'fa900000-0000-4000-8000-000000000002',
   'fa920000-0000-4000-8000-000000000001', 'active', public.programme_today() - 30, public.programme_today() + 200),
  ('fa930000-0000-4000-8000-000000000003', 'fa910000-0000-4000-8000-000000000002', 'fa900000-0000-4000-8000-000000000003',
   'fa920000-0000-4000-8000-000000000002', 'active', public.programme_today() - 30, public.programme_today() + 200);
select set_config('app.session_transition', 'on', true);
insert into public.sessions (enrollment_id, cohort_requirement_id, coach_id, coachee_id, topic, start_time, duration_minutes, status)
select 'fa930000-0000-4000-8000-000000000002', d.id, 'fa900000-0000-4000-8000-000000000001',
  'fa900000-0000-4000-8000-000000000002', 'Done', now() - interval '1 day', 60, 'completed'
from public.cohort_requirement_dates d where d.cohort_id = 'fa920000-0000-4000-8000-000000000001' and d.module = 'coaching';
select set_config('app.session_transition', '', true);

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'fa900000-0000-4000-8000-000000000004')::text, true);
select results_eq(
  $$select enrollment_count, required_units, completed_units, full_completion_pct
      from public.admin_canonical_completion_rate(array['fa930000-0000-4000-8000-000000000002', 'fa930000-0000-4000-8000-000000000003']::uuid[])$$,
  $$values (2, 4, 1, 25.0::numeric)$$,
  'a1. 1 of 4 required units: 25% (the mean of 100% and 0% would say 50%)');
select set_config('request.jwt.claims', json_build_object('sub', 'fa900000-0000-4000-8000-000000000002')::text, true);
select throws_ok($$select * from public.admin_canonical_completion_rate(array['fa930000-0000-4000-8000-000000000002']::uuid[])$$,
  '42501', null, 'a2. only an Admin reads it');

-- b. Mentor
select set_config('request.jwt.claims', json_build_object('sub', 'fa900000-0000-4000-8000-000000000001')::text, true);
select is(public.is_active_cohort_mentor(), false, 'b1. a Coach with no cohort Mentor row is not a Mentor');
reset role;
insert into public.cohort_mentors (cohort_id, mentor_user_id) values ('fa920000-0000-4000-8000-000000000001', 'fa900000-0000-4000-8000-000000000001');
set local role authenticated;
select is(public.is_active_cohort_mentor(), true, 'b2. ... until Admin adds them to a cohort''s Mentor pool');
reset role;
update public.cohort_mentors set is_active = false where mentor_user_id = 'fa900000-0000-4000-8000-000000000001';
set local role authenticated;
select is(public.is_active_cohort_mentor(), false, 'b3. an inactive assignment does not count');

select * from finish();
rollback;
