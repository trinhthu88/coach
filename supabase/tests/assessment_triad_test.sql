-- Triad submissions (20261006220000_assessment_triad; Prompt A2).
begin;
select plan(9);

-- 01 learner L   02 learner M
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_user_meta_data, created_at, updated_at, confirmation_token, email_change_token_new, recovery_token)
select ('ad000000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid,
  '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated',
  'atriad-' || n || '@example.test', 'test', now(),
  jsonb_build_object('full_name', 'ATriad Person ' || n), now(), now(), '', '', ''
from generate_series(1, 2) n;
insert into public.user_roles (user_id, role)
select ('ad000000-0000-4000-8000-00000000000' || n)::uuid, 'coachee' from generate_series(1, 2) n on conflict do nothing;
update public.profiles set status = 'active'::public.user_status where id::text like 'ad000000-%';

-- Two required Triads; Admin marks Triad 1 as assessed.
insert into public.programmes (id, name) values ('ad100000-0000-4000-8000-000000000001', 'Triad Programme');
insert into public.programme_modules (programme_id, module, enabled, config) values
  ('ad100000-0000-4000-8000-000000000001', 'triads', true, '{"required": true, "required_units": 2, "assessed_units": [1]}');
insert into public.cohorts (id, name, programme_id, start_date, end_date) values
  ('ad200000-0000-4000-8000-000000000001', 'Triad Cohort', 'ad100000-0000-4000-8000-000000000001',
   public.programme_today() - 30, public.programme_today() + 200);
update public.cohort_requirement_dates set due_on = public.programme_today() + 5, is_overridden = true,
  generation_method = 'manual', materialized_via = 'admin_save'
 where cohort_id = 'ad200000-0000-4000-8000-000000000001';
insert into public.programme_enrollments (id, programme_id, user_id, cohort_id, status, start_date, end_date)
select ('ad300000-0000-4000-8000-00000000000' || n)::uuid, 'ad100000-0000-4000-8000-000000000001',
  ('ad000000-0000-4000-8000-00000000000' || n)::uuid, 'ad200000-0000-4000-8000-000000000001',
  'active', public.programme_today() - 30, public.programme_today() + 200
from generate_series(1, 2) n;

-- A completed session for each Triad, L and M grouped together.
insert into public.triad_groups (id, cohort_requirement_date_id, is_active)
select ('ad600000-0000-4000-8000-00000000000' || d.ordinal)::uuid, d.id, true
from public.cohort_requirement_dates d where d.cohort_id = 'ad200000-0000-4000-8000-000000000001' and d.module = 'triads';
insert into public.triad_group_members (triad_group_id, enrollment_id, member_order)
select ('ad600000-0000-4000-8000-00000000000' || g)::uuid, ('ad300000-0000-4000-8000-00000000000' || m)::uuid, m
from generate_series(1, 2) g, generate_series(1, 2) m;
insert into public.triad_sessions (id, triad_group_id, scheduled_start_time, status)
select ('ad700000-0000-4000-8000-00000000000' || g)::uuid, ('ad600000-0000-4000-8000-00000000000' || g)::uuid,
  now() - interval '1 day', 'completed'
from generate_series(1, 2) g;

create temporary table before_completion as
select * from public.canonical_triad_completion('ad300000-0000-4000-8000-000000000001', public.programme_today());

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'ad000000-0000-4000-8000-000000000001')::text, true);
select is(public.learner_triad_session_assessed('ad700000-0000-4000-8000-000000000001'), true,
  '1. the reflection form for Triad 1 shows the assessor notice');
select is(public.learner_triad_session_assessed('ad700000-0000-4000-8000-000000000002'), false,
  '2. ... and not for Triad 2, which is not assessed');
select lives_ok($$select public.learner_triad_submit_reflection('ad700000-0000-4000-8000-000000000001', 4::smallint)$$,
  '3. L submits the Triad 1 reflection');
select lives_ok($$select public.learner_triad_submit_reflection('ad700000-0000-4000-8000-000000000002', 5::smallint)$$,
  '4. ... and the Triad 2 reflection');
reset role;
select results_eq(
  $$select s.kind, d.ordinal, s.status, s.triad_reflection_id = r.id
      from public.assessment_submissions s
      join public.cohort_requirement_dates d on d.id = s.cohort_requirement_id
      join public.triad_reflections r on r.triad_session_id = 'ad700000-0000-4000-8000-000000000001' and r.enrollment_id = s.enrollment_id
     where s.enrollment_id = 'ad300000-0000-4000-8000-000000000001'$$,
  $$values ('triad'::text, 1, 'awaiting_assignment'::text, true)$$,
  '5. one submission, for Triad 1 only, linked to the reflection by id');
select is((select count(*)::int from information_schema.columns
            where table_schema = 'public' and table_name = 'assessment_submissions' and column_name ~ 'answer|learned|will_use'),
  0, '6. no copy of the answers: the submission has no answer columns');
select results_eq(
  $$select * from public.canonical_triad_completion('ad300000-0000-4000-8000-000000000001', public.programme_today())$$,
  $$select * from before_completion$$,
  '7. a submission with no review leaves canonical_triad_completion unchanged');
select is((select count(*)::int from public.assessment_submissions where enrollment_id = 'ad300000-0000-4000-8000-000000000002'),
  0, '8. M, who has not reflected, has no submission');

reset role;
select ok(
  not has_function_privilege('authenticated', 'public.triad_requirement_is_assessed(uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.triad_requirement_is_assessed(uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.assessment_create_triad_submission_internal(uuid, uuid, uuid)', 'EXECUTE'),
  '9. the assessed-Triad helper and the submission constructor are not client-callable');
select * from finish();
rollback;
