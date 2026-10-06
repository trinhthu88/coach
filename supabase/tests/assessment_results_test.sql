-- Final Assessment results everywhere (20261007000200_final_assessment_results; Prompt A6).
begin;
select plan(6);

-- 01 learner with a Final Assessment   02 learner without   03 Sponsor of Org 1   04 Sponsor of Org 2
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_user_meta_data, created_at, updated_at, confirmation_token, email_change_token_new, recovery_token)
select ('ab000000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid,
  '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated',
  'aresult-' || n || '@example.test', 'test', now(),
  jsonb_build_object('full_name', 'AResult Person ' || n), now(), now(), '', '', ''
from generate_series(1, 4) n;
insert into public.user_roles (user_id, role) values
  ('ab000000-0000-4000-8000-000000000001', 'coachee'), ('ab000000-0000-4000-8000-000000000002', 'coachee'),
  ('ab000000-0000-4000-8000-000000000003', 'sponsor'), ('ab000000-0000-4000-8000-000000000004', 'sponsor')
on conflict do nothing;
update public.profiles set status = 'active'::public.user_status where id::text like 'ab000000-%';
insert into public.organizations (id, name) values
  ('ab500000-0000-4000-8000-000000000001', 'Org 1'), ('ab500000-0000-4000-8000-000000000002', 'Org 2');
insert into public.sponsor_profiles (user_id, organization_id) values
  ('ab000000-0000-4000-8000-000000000003', 'ab500000-0000-4000-8000-000000000001'),
  ('ab000000-0000-4000-8000-000000000004', 'ab500000-0000-4000-8000-000000000002');

insert into public.programmes (id, name) values
  ('ab100000-0000-4000-8000-000000000001', 'With FA'), ('ab100000-0000-4000-8000-000000000002', 'Without FA');
insert into public.programme_modules (programme_id, module, enabled, config) values
  ('ab100000-0000-4000-8000-000000000001', 'final_assessment', true, '{"required": true}'),
  ('ab100000-0000-4000-8000-000000000002', 'triads', true, '{"required": true, "required_units": 1}');
insert into public.cohorts (id, name, programme_id, start_date, end_date) values
  ('ab200000-0000-4000-8000-000000000001', 'C1', 'ab100000-0000-4000-8000-000000000001', public.programme_today() - 30, public.programme_today() + 30),
  ('ab200000-0000-4000-8000-000000000002', 'C2', 'ab100000-0000-4000-8000-000000000002', public.programme_today() - 30, public.programme_today() + 30);
insert into public.programme_enrollments (id, programme_id, user_id, cohort_id, organization_id, status, start_date, end_date) values
  ('ab300000-0000-4000-8000-000000000001', 'ab100000-0000-4000-8000-000000000001', 'ab000000-0000-4000-8000-000000000001',
   'ab200000-0000-4000-8000-000000000001', 'ab500000-0000-4000-8000-000000000001', 'active', public.programme_today() - 30, public.programme_today() + 30),
  ('ab300000-0000-4000-8000-000000000002', 'ab100000-0000-4000-8000-000000000002', 'ab000000-0000-4000-8000-000000000002',
   'ab200000-0000-4000-8000-000000000002', 'ab500000-0000-4000-8000-000000000001', 'active', public.programme_today() - 30, public.programme_today() + 30);

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'ab000000-0000-4000-8000-000000000003')::text, true);
select results_eq($$select status, result from public.sponsor_final_assessment_status('ab300000-0000-4000-8000-000000000001')$$,
  $$values ('not_submitted'::text, null::text)$$, '1. a visible leader with a Final Assessment: Not submitted, no result');
select is((select count(*)::int from public.sponsor_final_assessment_status('ab300000-0000-4000-8000-000000000002')),
  0, '2. a leader whose programme has no Final Assessment: no row, so no card');
select set_config('request.jwt.claims', json_build_object('sub', 'ab000000-0000-4000-8000-000000000004')::text, true);
select is((select count(*)::int from public.sponsor_final_assessment_status('ab300000-0000-4000-8000-000000000001')),
  0, '3. another organisation''s Sponsor sees nothing');
select set_config('request.jwt.claims', json_build_object('sub', 'ab000000-0000-4000-8000-000000000002')::text, true);
select is((select count(*)::int from public.learner_final_assessment('ab300000-0000-4000-8000-000000000001')),
  0, '4. a learner reads only their own Final Assessment');
select is((select count(*)::int from public.learner_final_assessment('ab300000-0000-4000-8000-000000000002')),
  0, '5. ... and a programme without one returns no row');
select throws_ok($$select * from public.admin_final_assessment_result('ab300000-0000-4000-8000-000000000001')$$,
  '42501', null, '6. only an Admin reads the Admin result');
select * from finish();
rollback;
