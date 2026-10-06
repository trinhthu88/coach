-- One overdue rule (20261006130000_one_overdue_rule).
--
--   a. A cohort's overdue units are the SUM of its leaders' overdue units, and
--      its adherence / coverage aggregate the leaders' own credited units. A
--      leader who is ahead does not hide another leader's overdue unit.
--   b. The organisation rollup gives the same numbers from the cohort rows.
--   c. Triad per-requirement state comes from
--      canonical_enrollment_requirement_calendar: overdue = due_on < as_of, so
--      a Triad due TODAY is not overdue.
--   d. The reminder and daily-prompt readers are server functions, not client
--      callable.
begin;
select plan(16);

-- ---------------------------------------------------------------------------
-- Fixture
-- ---------------------------------------------------------------------------
-- 01 Coach K   02 leader L1 (behind)   03 leader L2 (ahead)   04 Sponsor S
-- 05 leader T1 (Triad programme)
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_user_meta_data, created_at, updated_at, confirmation_token, email_change_token_new, recovery_token)
select ('f9f00000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid,
  '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated',
  'overdue-' || n || '@example.test', 'test', now(),
  jsonb_build_object('full_name', 'Overdue Person ' || n), now(), now(), '', '', ''
from generate_series(1, 5) n;
insert into public.user_roles (user_id, role) values
  ('f9f00000-0000-4000-8000-000000000001', 'coach'),
  ('f9f00000-0000-4000-8000-000000000002', 'coachee'),
  ('f9f00000-0000-4000-8000-000000000003', 'coachee'),
  ('f9f00000-0000-4000-8000-000000000004', 'sponsor'),
  ('f9f00000-0000-4000-8000-000000000005', 'coachee')
on conflict do nothing;
update public.profiles set status = 'active'::public.user_status where id::text like 'f9f00000-%';
insert into public.coach_profiles (id, approval_status) values ('f9f00000-0000-4000-8000-000000000001', 'active')
on conflict (id) do update set approval_status = 'active';

insert into public.organizations (id, name) values ('f9f50000-0000-4000-8000-000000000001', 'Overdue Org');
insert into public.sponsor_profiles (user_id, organization_id)
values ('f9f00000-0000-4000-8000-000000000004', 'f9f50000-0000-4000-8000-000000000001');

-- Coaching programme: 2 required units. Coaching 1 was due 3 days ago,
-- Coaching 2 is due in 5 days.
insert into public.programmes (id, name) values
  ('f9f10000-0000-4000-8000-000000000001', 'Overdue Coaching Programme'),
  ('f9f10000-0000-4000-8000-000000000002', 'Overdue Triad Programme');
insert into public.programme_modules (programme_id, module, enabled, config) values
  ('f9f10000-0000-4000-8000-000000000001', 'coaching', true, '{"required": true, "required_units": 2}'),
  ('f9f10000-0000-4000-8000-000000000002', 'triads', true, '{"required": true, "required_units": 1}');
insert into public.cohorts (id, name, programme_id, organization_id, start_date, end_date) values
  ('f9f20000-0000-4000-8000-000000000001', 'Overdue Cohort', 'f9f10000-0000-4000-8000-000000000001',
   'f9f50000-0000-4000-8000-000000000001', current_date - 60, current_date + 200),
  ('f9f20000-0000-4000-8000-000000000002', 'Triad Cohort', 'f9f10000-0000-4000-8000-000000000002',
   'f9f50000-0000-4000-8000-000000000001', current_date - 60, current_date + 200);
update public.cohort_requirement_dates
   set due_on = case ordinal when 1 then current_date - 3 else current_date + 5 end,
       is_overridden = true, generation_method = 'manual', materialized_via = 'admin_save'
 where cohort_id = 'f9f20000-0000-4000-8000-000000000001';
-- Triad 1 is due TODAY.
update public.cohort_requirement_dates
   set due_on = current_date, is_overridden = true, generation_method = 'manual', materialized_via = 'admin_save'
 where cohort_id = 'f9f20000-0000-4000-8000-000000000002';
insert into public.cohort_coach_assignments (cohort_id, coach_id)
values ('f9f20000-0000-4000-8000-000000000001', 'f9f00000-0000-4000-8000-000000000001');

insert into public.programme_enrollments (id, programme_id, user_id, cohort_id, organization_id, status, start_date, end_date) values
  ('f9f30000-0000-4000-8000-000000000002', 'f9f10000-0000-4000-8000-000000000001', 'f9f00000-0000-4000-8000-000000000002',
   'f9f20000-0000-4000-8000-000000000001', 'f9f50000-0000-4000-8000-000000000001', 'active', current_date - 60, current_date + 200),
  ('f9f30000-0000-4000-8000-000000000003', 'f9f10000-0000-4000-8000-000000000001', 'f9f00000-0000-4000-8000-000000000003',
   'f9f20000-0000-4000-8000-000000000001', 'f9f50000-0000-4000-8000-000000000001', 'active', current_date - 60, current_date + 200),
  ('f9f30000-0000-4000-8000-000000000005', 'f9f10000-0000-4000-8000-000000000002', 'f9f00000-0000-4000-8000-000000000005',
   'f9f20000-0000-4000-8000-000000000002', 'f9f50000-0000-4000-8000-000000000001', 'active', current_date - 60, current_date + 200);

-- L1 has done nothing: Coaching 1 is overdue. L2 completed BOTH units, one of
-- them early: L2 is ahead (2 completed, 1 due).
select set_config('app.session_transition', 'on', true);
insert into public.sessions (id, enrollment_id, cohort_requirement_id, coach_id, coachee_id, topic, start_time, duration_minutes, status)
select gen_random_uuid(), 'f9f30000-0000-4000-8000-000000000003', d.id,
  'f9f00000-0000-4000-8000-000000000001', 'f9f00000-0000-4000-8000-000000000003', 'Ahead ' || d.ordinal,
  now() - (case d.ordinal when 1 then 5 else 2 end || ' days')::interval, 60, 'completed'
from public.cohort_requirement_dates d
where d.cohort_id = 'f9f20000-0000-4000-8000-000000000001' and d.module = 'coaching';
select set_config('app.session_transition', '', true);

-- The leaders, as every role reads them.
create temporary table leaders as
select p.enrollment_id, p.due_units, p.completed_units, p.booked_units, p.overdue_units
from public.programme_enrollments e
cross join lateral public.canonical_enrollment_progress(e.id, current_date) p
where e.cohort_id = 'f9f20000-0000-4000-8000-000000000001';
grant select on leaders to authenticated;

select results_eq(
  $$select overdue_units, completed_units, due_units from leaders order by enrollment_id$$,
  $$values (1, 0, 1), (0, 2, 1)$$,
  'fixture: L1 has one overdue unit; L2 is ahead (2 completed, 1 due)');

-- ---------------------------------------------------------------------------
-- a + b. Cohort and organisation rollups add up the leaders
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'f9f00000-0000-4000-8000-000000000004')::text, true);

select is(
  (select overdue_units from public.sponsor_canonical_cohort_progress('f9f20000-0000-4000-8000-000000000001', current_date)),
  (select sum(overdue_units)::integer from leaders),
  'a1. cohort overdue = the sum of its leaders'' overdue units (L2 being ahead hides nothing)');
select is(
  (select due_adherence_pct from public.sponsor_canonical_cohort_progress('f9f20000-0000-4000-8000-000000000001', current_date)),
  (select round(sum(least(completed_units, due_units)) * 100.0 / sum(due_units), 1) from leaders),
  'a2. cohort adherence aggregates each leader''s credited due units (50%, not 100%)');
select is(
  (select schedule_coverage_pct from public.sponsor_canonical_cohort_progress('f9f20000-0000-4000-8000-000000000001', current_date)),
  (select round(sum(least(completed_units + booked_units, due_units)) * 100.0 / sum(due_units), 1) from leaders),
  'a3. cohort schedule coverage aggregates each leader''s credited units');
select results_eq(
  $$select adherence_credited_units, coverage_credited_units
      from public.sponsor_canonical_cohort_progress('f9f20000-0000-4000-8000-000000000001', current_date)$$,
  $$select sum(least(completed_units, due_units))::integer, sum(least(completed_units + booked_units, due_units))::integer from leaders$$,
  'a4. the cohort row carries the credited sums the organisation rollup adds up');

select is(
  (select overdue_units from public.sponsor_canonical_organisation_progress(current_date)),
  (select sum(overdue_units)::integer from public.sponsor_canonical_cohort_progress(NULL, current_date)),
  'b1. organisation overdue = the sum of its cohorts'' (= its leaders'') overdue units');
select is(
  (select due_adherence_pct from public.sponsor_canonical_organisation_progress(current_date)),
  (select round(sum(adherence_credited_units) * 100.0 / nullif(sum(due_units), 0), 1)
     from public.sponsor_canonical_cohort_progress(NULL, current_date)),
  'b2. organisation adherence aggregates the leaders'' credited units');
select is(
  (select schedule_coverage_pct from public.sponsor_canonical_organisation_progress(current_date)),
  (select round(sum(coverage_credited_units) * 100.0 / nullif(sum(due_units), 0), 1)
     from public.sponsor_canonical_cohort_progress(NULL, current_date)),
  'b3. organisation coverage aggregates the leaders'' credited units');
reset role;

-- ---------------------------------------------------------------------------
-- c. A Triad due today is not overdue
-- ---------------------------------------------------------------------------
select is(
  (select s->>'overdue' from public.canonical_triad_completion('f9f30000-0000-4000-8000-000000000005', current_date) c,
     jsonb_array_elements(c.schedule) s),
  'false', 'c1. Triad 1, due today and not done: not overdue');
select is(
  (select s->>'is_due' from public.canonical_triad_completion('f9f30000-0000-4000-8000-000000000005', current_date) c,
     jsonb_array_elements(c.schedule) s),
  'true', 'c2. ... but due');
select is(
  (select s->>'overdue' from public.canonical_triad_completion('f9f30000-0000-4000-8000-000000000005', current_date + 1) c,
     jsonb_array_elements(c.schedule) s),
  'true', 'c3. tomorrow it is overdue');
select is(
  (select bool_or(l.overdue) from public.cohort_requirement_dates d
     cross join lateral public.triad_requirement_learners_internal(d.id, current_date) l
    where d.cohort_id = 'f9f20000-0000-4000-8000-000000000002' and d.module = 'triads'),
  false, 'c4. the Admin Triad view and reminders agree: not overdue today');
select is(
  (select bool_or(l.overdue) from public.cohort_requirement_dates d
     cross join lateral public.triad_requirement_learners_internal(d.id, current_date + 1) l
    where d.cohort_id = 'f9f20000-0000-4000-8000-000000000002' and d.module = 'triads'),
  true, 'c5. ... and overdue tomorrow');
select is(
  (select c.is_overdue from public.canonical_enrollment_requirement_calendar('f9f30000-0000-4000-8000-000000000005', current_date) c
    where c.module = 'triads'),
  false, 'c6. which is what the requirement calendar says');

-- ---------------------------------------------------------------------------
-- d. Reminder and prompt readers are server-side
-- ---------------------------------------------------------------------------
select ok(
  to_regprocedure('public.training_overdue_assignment_targets_internal(date)') is not null
  and not has_function_privilege('authenticated', 'public.training_overdue_assignment_targets_internal(date)', 'EXECUTE'),
  'd1. overdue-assignment reminder targets come from a server function over the requirement calendar');
select ok(
  to_regprocedure('public.daily_prompt_targets_internal(date)') is not null
  and not has_function_privilege('authenticated', 'public.daily_prompt_targets_internal(date)', 'EXECUTE'),
  'd2. daily-prompt targets come from a server function over each enrollment''s Training calendar');

select * from finish();
rollback;
