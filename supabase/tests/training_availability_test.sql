-- Training availability and enrollment dates (20261006160000_training_availability).
--
--   a. A learner sees a Training week's content, and may write evidence for
--      it, only when the week is open to one of their ONGOING enrollments by
--      the canonical availability (cohort pacing / override), never by the
--      week's raw unlock_date.
--   b. A paused or ended enrollment opens nothing.
--   c. at_risk is never stored.
--   d. A cohort end-date change carries to enrollments that follow the cohort,
--      not to one with its own end date.
begin;
select plan(14);

-- 01 learner A (active)   02 learner P (paused)   03 learner O (own end date)
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_user_meta_data, created_at, updated_at, confirmation_token, email_change_token_new, recovery_token)
select ('fc000000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid,
  '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated',
  'training-' || n || '@example.test', 'test', now(),
  jsonb_build_object('full_name', 'Training Person ' || n), now(), now(), '', '', ''
from generate_series(1, 3) n;
insert into public.user_roles (user_id, role)
select ('fc000000-0000-4000-8000-00000000000' || n)::uuid, 'coachee' from generate_series(1, 3) n
on conflict do nothing;
update public.profiles set status = 'active'::public.user_status where id::text like 'fc000000-%';

insert into public.programmes (id, name) values ('fc100000-0000-4000-8000-000000000001', 'Training Programme');
insert into public.programme_modules (programme_id, module, enabled, config) values
  ('fc100000-0000-4000-8000-000000000001', 'training', true, '{"required": true, "required_units": 2}');
-- The cohort started 3 days ago: week 1 is open, week 2 opens in 4 days.
insert into public.cohorts (id, name, programme_id, start_date, end_date) values
  ('fc200000-0000-4000-8000-000000000001', 'Training Cohort', 'fc100000-0000-4000-8000-000000000001',
   public.programme_today() - 3, public.programme_today() + 60);
-- Week 2's raw unlock_date is long past: only the cohort's pacing says "not yet".
insert into public.training_weeks (id, programme_id, week_number, title, is_visible, unlock_date) values
  ('fc500000-0000-4000-8000-000000000001', 'fc100000-0000-4000-8000-000000000001', 1, 'Week 1', true, public.programme_today() - 30),
  ('fc500000-0000-4000-8000-000000000002', 'fc100000-0000-4000-8000-000000000001', 2, 'Week 2', true, public.programme_today() - 30);
insert into public.programme_enrollments (id, programme_id, user_id, cohort_id, status, start_date, end_date) values
  ('fc300000-0000-4000-8000-000000000001', 'fc100000-0000-4000-8000-000000000001', 'fc000000-0000-4000-8000-000000000001',
   'fc200000-0000-4000-8000-000000000001', 'active', public.programme_today() - 3, public.programme_today() + 60),
  ('fc300000-0000-4000-8000-000000000002', 'fc100000-0000-4000-8000-000000000001', 'fc000000-0000-4000-8000-000000000002',
   'fc200000-0000-4000-8000-000000000001', 'paused', public.programme_today() - 3, public.programme_today() + 60),
  ('fc300000-0000-4000-8000-000000000003', 'fc100000-0000-4000-8000-000000000001', 'fc000000-0000-4000-8000-000000000003',
   'fc200000-0000-4000-8000-000000000001', 'active', public.programme_today() - 3, public.programme_today() + 90);

-- ---------------------------------------------------------------------------
-- a. Open weeks, by the canonical availability
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'fc000000-0000-4000-8000-000000000001')::text, true);
select results_eq(
  $$select week_number from public.training_weeks where programme_id = 'fc100000-0000-4000-8000-000000000001' order by 1$$,
  $$values (1)$$,
  'a1. the learner sees week 1 only: week 2 has not opened by the cohort''s pacing');
select lives_ok($$insert into public.training_progress (user_id, training_week_id, enrollment_id, viewed_at)
  values ('fc000000-0000-4000-8000-000000000001', 'fc500000-0000-4000-8000-000000000001', 'fc300000-0000-4000-8000-000000000001', now())$$,
  'a2. evidence for the open week is written');
select throws_ok($$insert into public.training_progress (user_id, training_week_id, enrollment_id, viewed_at)
  values ('fc000000-0000-4000-8000-000000000001', 'fc500000-0000-4000-8000-000000000002', 'fc300000-0000-4000-8000-000000000001', now())$$,
  '42501', null, 'a3. evidence for a week not yet open is refused');
select results_eq(
  $$select week_number, locked from public.get_enrollment_training_weeks('fc300000-0000-4000-8000-000000000001') order by 1$$,
  $$values (1, false), (2, true)$$,
  'a4. the week list agrees: week 2 is locked');

-- A cohort override opens week 2 early for this cohort.
reset role;
insert into public.cohort_week_overrides (cohort_id, training_week_id, unlock_date)
values ('fc200000-0000-4000-8000-000000000001', 'fc500000-0000-4000-8000-000000000002', public.programme_today());
set local role authenticated;
select is((select count(*)::int from public.training_weeks where programme_id = 'fc100000-0000-4000-8000-000000000001'),
  2, 'a5. a cohort override opens week 2 today');

-- ---------------------------------------------------------------------------
-- b. Only an ongoing enrollment opens anything
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', 'fc000000-0000-4000-8000-000000000002')::text, true);
select is((select count(*)::int from public.training_weeks where programme_id = 'fc100000-0000-4000-8000-000000000001'),
  0, 'b1. a paused enrollment sees no Training content');
select throws_ok($$insert into public.training_progress (user_id, training_week_id, enrollment_id, viewed_at)
  values ('fc000000-0000-4000-8000-000000000002', 'fc500000-0000-4000-8000-000000000001', 'fc300000-0000-4000-8000-000000000002', now())$$,
  '42501', null, 'b2. ... and writes no evidence');
reset role;
select is(public.enrollment_is_ongoing('fc300000-0000-4000-8000-000000000001'), true, 'b3. active, within its dates: ongoing');
update public.programme_enrollments set end_date = public.programme_today() - 1 where id = 'fc300000-0000-4000-8000-000000000001';
select is(public.enrollment_is_ongoing('fc300000-0000-4000-8000-000000000001'), false, 'b4. past its end date: not ongoing');
update public.programme_enrollments set end_date = public.programme_today() + 60 where id = 'fc300000-0000-4000-8000-000000000001';

-- ---------------------------------------------------------------------------
-- c. at_risk is effective, never stored
-- ---------------------------------------------------------------------------
select throws_ok($$update public.programme_enrollments set status = 'at_risk' where id = 'fc300000-0000-4000-8000-000000000001'$$,
  '23514', null, 'c1. storing at_risk is refused');
select is((select count(*)::int from public.programme_enrollments where status = 'at_risk'), 0, 'c2. no enrollment stores at_risk');

-- ---------------------------------------------------------------------------
-- d. Enrollment end follows the cohort's end
-- ---------------------------------------------------------------------------
update public.cohorts set end_date = public.programme_today() + 75 where id = 'fc200000-0000-4000-8000-000000000001';
select is((select end_date from public.programme_enrollments where id = 'fc300000-0000-4000-8000-000000000001'),
  public.programme_today() + 75, 'd1. an enrollment that ended with the cohort follows its new end');
select is((select end_date from public.programme_enrollments where id = 'fc300000-0000-4000-8000-000000000003'),
  public.programme_today() + 90, 'd2. an enrollment with its own end date keeps it');

select is(
  (select string_agg(tablename || '.' || policyname, ', ') from pg_policies
    where schemaname = 'public' and (coalesce(qual, '') || coalesce(with_check, '')) ~* 'current_date'),
  null, 'e1. no policy dates content by the server''s CURRENT_DATE');

select * from finish();
rollback;
