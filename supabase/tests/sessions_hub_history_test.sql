-- Sessions hub from the session history (20261006180000_sessions_hub_history).
begin;
select plan(6);

-- 01 Coach K   02 learner A   03 learner B
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_user_meta_data, created_at, updated_at, confirmation_token, email_change_token_new, recovery_token)
select ('fe000000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid,
  '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated',
  'hub-' || n || '@example.test', 'test', now(),
  jsonb_build_object('full_name', 'Hub Person ' || n), now(), now(), '', '', ''
from generate_series(1, 3) n;
insert into public.user_roles (user_id, role) values
  ('fe000000-0000-4000-8000-000000000001', 'coach'),
  ('fe000000-0000-4000-8000-000000000002', 'coachee'),
  ('fe000000-0000-4000-8000-000000000003', 'coachee')
on conflict do nothing;
update public.profiles set status = 'active'::public.user_status where id::text like 'fe000000-%';
insert into public.coach_profiles (id, approval_status) values ('fe000000-0000-4000-8000-000000000001', 'active')
on conflict (id) do update set approval_status = 'active';

insert into public.programmes (id, name) values ('fe100000-0000-4000-8000-000000000001', 'Hub Programme');
insert into public.programme_modules (programme_id, module, enabled, config) values
  ('fe100000-0000-4000-8000-000000000001', 'coaching', true, '{"required": true, "required_units": 3}');
insert into public.cohorts (id, name, programme_id, start_date, end_date) values
  ('fe200000-0000-4000-8000-000000000001', 'Hub Cohort', 'fe100000-0000-4000-8000-000000000001',
   public.programme_today() - 30, public.programme_today() + 200);
update public.cohort_requirement_dates
   set due_on = public.programme_today() + 5 * ordinal, is_overridden = true,
       generation_method = 'manual', materialized_via = 'admin_save'
 where cohort_id = 'fe200000-0000-4000-8000-000000000001';
insert into public.cohort_coach_assignments (cohort_id, coach_id)
values ('fe200000-0000-4000-8000-000000000001', 'fe000000-0000-4000-8000-000000000001');
insert into public.programme_enrollments (id, programme_id, user_id, cohort_id, status, start_date, end_date) values
  ('fe300000-0000-4000-8000-000000000002', 'fe100000-0000-4000-8000-000000000001', 'fe000000-0000-4000-8000-000000000002',
   'fe200000-0000-4000-8000-000000000001', 'active', public.programme_today() - 30, public.programme_today() + 200);

-- Coaching 1 cancelled (in 2 days), Coaching 2 confirmed (in 6 days),
-- Coaching 3 pending (in 9 days).
select set_config('app.session_transition', 'on', true);
insert into public.sessions (id, enrollment_id, cohort_requirement_id, coach_id, coachee_id, topic, start_time, duration_minutes, status)
select ('fe400000-0000-4000-8000-00000000000' || d.ordinal)::uuid, 'fe300000-0000-4000-8000-000000000002', d.id,
  'fe000000-0000-4000-8000-000000000001', 'fe000000-0000-4000-8000-000000000002', 'Hub ' || d.ordinal,
  now() + (case d.ordinal when 1 then 2 when 2 then 6 else 9 end || ' days')::interval, 60,
  (case d.ordinal when 1 then 'cancelled' when 2 then 'confirmed' else 'pending_coach_approval' end)::public.session_status
from public.cohort_requirement_dates d
where d.cohort_id = 'fe200000-0000-4000-8000-000000000001' and d.module = 'coaching';
select set_config('app.session_transition', '', true);

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'fe000000-0000-4000-8000-000000000002')::text, true);
select results_eq(
  $$select module::text, next_session_at from public.learner_next_session_by_module('fe300000-0000-4000-8000-000000000002')$$,
  $$select 'coaching'::text, start_time from public.sessions where id = 'fe400000-0000-4000-8000-000000000002'$$,
  '1. the next Coaching session is the earliest LIVE one (a cancelled earlier one is not)');
select results_eq(
  $$select requirement_unit_number, requirement_due_on from public.learner_session_history('fe300000-0000-4000-8000-000000000002')
     where source_id = 'fe400000-0000-4000-8000-000000000003'$$,
  $$values (3, public.programme_today() + 15)$$,
  '2. each history row carries its requirement unit and due date');
select is((select count(*)::int from public.learner_session_history('fe300000-0000-4000-8000-000000000002')
            where requirement_due_on is not null), 3,
  '3. every Coaching row carries the due date of the requirement it is booked against');

select set_config('request.jwt.claims', json_build_object('sub', 'fe000000-0000-4000-8000-000000000003')::text, true);
select is((select count(*)::int from public.learner_next_session_by_module('fe300000-0000-4000-8000-000000000002')),
  0, '4. another learner reads nothing');
reset role;
select ok(not has_function_privilege('authenticated', 'public.canonical_session_history(uuid)', 'EXECUTE'),
  '5. the canonical history stays internal');
select ok(has_function_privilege('authenticated', 'public.learner_session_history(uuid)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.admin_learner_session_history(uuid)', 'EXECUTE'),
  '6. the wrappers keep their grants');

select * from finish();
rollback;
