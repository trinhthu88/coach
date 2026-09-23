-- Canonical "inactive 7+ days": one rule (population, signals, window) read
-- by Admin (admin_enrollment_inactivity) and the Edge Functions
-- (canonical_enrollment_inactivity_internal).
--
-- Cohort K (running), cohort X (ended yesterday).
--   N1 active, started 30 days ago, Training week completed 2 days ago  -> active
--   N2 active, started 30 days ago, Training week completed 10 days ago -> inactive (10 days)
--   N3 active, started 30 days ago, no activity ever                    -> inactive
--   N4 active, started 3 days ago                                       -> not in population (grace week)
--   N5 paused                                                           -> not in population
--   N6 stored active, its programme ended yesterday (enrollment and cohort end
--      alike; 20261001110000 settles status on the enrollment's own end)
--      (effective status is not active)                                -> not in population
begin;

select plan(7);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_user_meta_data, created_at, updated_at, confirmation_token, email_change_token_new, recovery_token)
select ('a9900000-0000-0000-0000-0000000000' || lpad(n::text, 2, '0'))::uuid, '00000000-0000-0000-0000-000000000000'::uuid,
  'authenticated', 'authenticated', 'engagement-' || n || '@example.test', 'test', now(),
  jsonb_build_object('full_name', 'Engagement Learner ' || n), now(), now(), '', '', ''
from generate_series(1, 7) n;
insert into public.user_roles (user_id, role) values ('a9900000-0000-0000-0000-000000000007', 'admin');

insert into public.programmes (id, name) values ('c9900000-0000-0000-0000-000000000001', 'Engagement programme');
insert into public.cohorts (id, name, programme_id, start_date, end_date) values
  ('d9900000-0000-0000-0000-000000000001', 'K', 'c9900000-0000-0000-0000-000000000001', current_date - 60, current_date + 60),
  ('d9900000-0000-0000-0000-000000000002', 'X', 'c9900000-0000-0000-0000-000000000001', current_date - 90, current_date - 1);
insert into public.training_weeks (id, programme_id, week_number, title, is_visible)
values ('f9900000-0000-0000-0000-000000000001', 'c9900000-0000-0000-0000-000000000001', 1, 'Week 1', true);

insert into public.programme_enrollments (id, user_id, programme_id, cohort_id, start_date, end_date, status)
select ('e9900000-0000-0000-0000-00000000000' || n)::uuid, ('a9900000-0000-0000-0000-0000000000' || lpad(n::text, 2, '0'))::uuid,
  'c9900000-0000-0000-0000-000000000001',
  case when n = 6 then 'd9900000-0000-0000-0000-000000000002' else 'd9900000-0000-0000-0000-000000000001' end::uuid,
  case when n = 4 then current_date - 3 else current_date - 30 end,
  case when n = 6 then current_date - 1 else current_date + 60 end,
  case when n = 5 then 'paused' else 'active' end::public.enrollment_status
from generate_series(1, 6) n;

insert into public.training_progress (user_id, training_week_id, enrollment_id, completed_at) values
  ('a9900000-0000-0000-0000-000000000001', 'f9900000-0000-0000-0000-000000000001', 'e9900000-0000-0000-0000-000000000001', now() - interval '2 days'),
  ('a9900000-0000-0000-0000-000000000002', 'f9900000-0000-0000-0000-000000000001', 'e9900000-0000-0000-0000-000000000002', now() - interval '10 days');

create temporary table inact as
select * from public.canonical_enrollment_inactivity_internal(now()) where programme_id = 'c9900000-0000-0000-0000-000000000001';
grant select on inact to authenticated;

select results_eq(
  $$select enrollment_id from inact order by 1$$,
  $$values ('e9900000-0000-0000-0000-000000000001'::uuid), ('e9900000-0000-0000-0000-000000000002'::uuid), ('e9900000-0000-0000-0000-000000000003'::uuid)$$,
  'population: effectively active enrollments past their first week (no grace-week, paused or ended-cohort enrollment)');
select results_eq(
  $$select enrollment_id, is_inactive, days_since_last_activity from inact order by 1$$,
  $$values ('e9900000-0000-0000-0000-000000000001'::uuid, false, 2), ('e9900000-0000-0000-0000-000000000002'::uuid, true, 10),
           ('e9900000-0000-0000-0000-000000000003'::uuid, true, null::integer)$$,
  'inactive = no activity signal in the last 7 days (or none ever)');

select results_eq(
  $$select (select is_inactive from public.canonical_enrollment_inactivity_internal(now() + interval '4 days') where enrollment_id = 'e9900000-0000-0000-0000-000000000001'),
           (select is_inactive from public.canonical_enrollment_inactivity_internal(now() + interval '6 days') where enrollment_id = 'e9900000-0000-0000-0000-000000000001')$$,
  $$values (false, true)$$,
  'the 7-day window moves with as-of (6 days since the last activity: active; 8 days: inactive)');

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a9900000-0000-0000-0000-000000000007', true);
select results_eq(
  $$select enrollment_id, is_inactive, days_since_last_activity from public.admin_enrollment_inactivity('c9900000-0000-0000-0000-000000000001') order by 1$$,
  $$select enrollment_id, is_inactive, days_since_last_activity from inact order by 1$$,
  'Admin reads exactly the canonical rule');
select throws_ok($$select * from public.canonical_enrollment_inactivity_internal(now())$$,
  '42501', null, 'the internal construction is not client-callable');
select set_config('request.jwt.claim.sub', 'a9900000-0000-0000-0000-000000000001', true);
select throws_ok($$select * from public.admin_enrollment_inactivity(null)$$,
  '42501', null, 'a learner cannot read engagement signals');
reset role;
select ok(
  has_function_privilege('service_role', 'public.canonical_enrollment_inactivity_internal(timestamptz)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.triad_reflection_rate_internal(uuid,date,date)', 'EXECUTE'),
  'the Edge Functions (service role) read the same constructions');

select * from finish();
rollback;
