-- P0-3: the Coach reads completion and status from canonical_enrollment_progress,
-- authorized through the coach's cohort assignment (or a coaching session).
begin;
select plan(5);

insert into auth.users(id, email, raw_user_meta_data) values
 ('a8300000-0000-4000-8000-000000000001', 'coachstat-coach@example.test',   '{"full_name":"Assigned coach","role":"coach"}'),
 ('a8300000-0000-4000-8000-000000000002', 'coachstat-learner@example.test', '{"full_name":"Coach status learner"}'),
 ('a8300000-0000-4000-8000-000000000003', 'coachstat-other@example.test',   '{"full_name":"Unassigned coach","role":"coach"}');
insert into public.user_roles(user_id, role) values
 ('a8300000-0000-4000-8000-000000000001', 'coach'),
 ('a8300000-0000-4000-8000-000000000003', 'coach')
on conflict do nothing;
insert into public.programmes(id, name, duration_months) values
 ('a8300000-0000-4000-8000-000000000010', 'Coach status programme', 6);
insert into public.programme_modules(programme_id, module, enabled, config) values
 ('a8300000-0000-4000-8000-000000000010', 'coaching', true, '{"required": true, "required_units": 2}');
insert into public.cohorts(id, name, programme_id, start_date, end_date) values
 ('a8300000-0000-4000-8000-000000000020', 'Coach status cohort', 'a8300000-0000-4000-8000-000000000010',
  current_date - 30, current_date + 150);
insert into public.cohort_coach_assignments(cohort_id, coach_id) values
 ('a8300000-0000-4000-8000-000000000020', 'a8300000-0000-4000-8000-000000000001');
insert into public.programme_enrollments(id, programme_id, user_id, cohort_id, status, start_date)
values ('a8300000-0000-4000-8000-000000000030', 'a8300000-0000-4000-8000-000000000010',
        'a8300000-0000-4000-8000-000000000002', 'a8300000-0000-4000-8000-000000000020', 'active', current_date - 30);

create temp table expected as
  select full_completion_pct, pace_status, effective_enrollment_status
  from public.canonical_enrollment_progress('a8300000-0000-4000-8000-000000000030', current_date);
grant select on expected to authenticated;

select set_config('request.jwt.claim.sub', 'a8300000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;
select is((select count(*)::int from public.coach_canonical_enrollment_progress(array['a8300000-0000-4000-8000-000000000030'::uuid])),
  1, 'a coach assigned to the cohort reads the enrollment before any session exists');
select is((select full_completion_pct from public.coach_canonical_enrollment_progress(array['a8300000-0000-4000-8000-000000000030'::uuid])),
  (select full_completion_pct from expected), 'completion % is the canonical number');
select is((select pace_status from public.coach_canonical_enrollment_progress(array['a8300000-0000-4000-8000-000000000030'::uuid])),
  (select pace_status from expected), 'status is the canonical pace_status, not a coach-side heuristic');
select is((select effective_enrollment_status from public.coach_canonical_enrollment_progress(array['a8300000-0000-4000-8000-000000000030'::uuid])),
  (select effective_enrollment_status from expected), 'the effective status Admin and Sponsor see is returned too');
reset role;

select set_config('request.jwt.claim.sub', 'a8300000-0000-4000-8000-000000000003', true);
set local role authenticated;
select is((select count(*)::int from public.coach_canonical_enrollment_progress(array['a8300000-0000-4000-8000-000000000030'::uuid])),
  0, 'a coach neither assigned to the cohort nor coaching the learner sees nothing');
reset role;

select * from finish();
rollback;
