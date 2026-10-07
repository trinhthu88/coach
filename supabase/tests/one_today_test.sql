-- One "today" (20261006150000_one_today).
--
-- The programme runs in Asia/Ho_Chi_Minh (decision 2). Every date the
-- canonical engine derives from a timestamp, and every default "as of", is
-- taken in programme_time_zone(): a session at 06:30 Vietnam time on 15 Oct
-- (23:30 UTC on 14 Oct) is dated 15 Oct.
begin;
select plan(9);

-- 01 Coach K   02 learner A
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_user_meta_data, created_at, updated_at, confirmation_token, email_change_token_new, recovery_token)
select ('fb000000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid,
  '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated',
  'today-' || n || '@example.test', 'test', now(),
  jsonb_build_object('full_name', 'Today Person ' || n), now(), now(), '', '', ''
from generate_series(1, 2) n;
insert into public.user_roles (user_id, role) values
  ('fb000000-0000-4000-8000-000000000001', 'coach'),
  ('fb000000-0000-4000-8000-000000000002', 'coachee')
on conflict do nothing;
update public.profiles set status = 'active'::public.user_status where id::text like 'fb000000-%';
insert into public.coach_profiles (id, approval_status) values ('fb000000-0000-4000-8000-000000000001', 'active')
on conflict (id) do update set approval_status = 'active';

insert into public.programmes (id, name) values ('fb100000-0000-4000-8000-000000000001', 'Today Programme');
insert into public.programme_modules (programme_id, module, enabled, config) values
  ('fb100000-0000-4000-8000-000000000001', 'coaching', true, '{"required": true, "required_units": 1}');
insert into public.cohorts (id, name, programme_id, start_date, end_date) values
  ('fb200000-0000-4000-8000-000000000001', 'Today Cohort', 'fb100000-0000-4000-8000-000000000001',
   date '2026-09-01', date '2027-03-01');
-- Coaching 1 is due 15 Oct: open from 1 Oct.
update public.cohort_requirement_dates
   set due_on = date '2026-10-15', is_overridden = true, generation_method = 'manual', materialized_via = 'admin_save'
 where cohort_id = 'fb200000-0000-4000-8000-000000000001';
insert into public.cohort_coach_assignments (cohort_id, coach_id)
values ('fb200000-0000-4000-8000-000000000001', 'fb000000-0000-4000-8000-000000000001');
insert into public.programme_enrollments (id, programme_id, user_id, cohort_id, status, start_date, end_date)
values ('fb300000-0000-4000-8000-000000000002', 'fb100000-0000-4000-8000-000000000001',
  'fb000000-0000-4000-8000-000000000002', 'fb200000-0000-4000-8000-000000000001', 'active', date '2026-09-01', date '2027-03-01');

-- Held at 06:30 on 15 Oct in Vietnam = 23:30 on 14 Oct in UTC.
select set_config('app.session_transition', 'on', true);
insert into public.sessions (id, enrollment_id, cohort_requirement_id, coach_id, coachee_id, topic, start_time, duration_minutes, status)
select 'fb400000-0000-4000-8000-000000000001', 'fb300000-0000-4000-8000-000000000002', d.id,
  'fb000000-0000-4000-8000-000000000001', 'fb000000-0000-4000-8000-000000000002', 'Early morning',
  timestamptz '2026-10-15 06:30:00+07', 60, 'completed'
from public.cohort_requirement_dates d
where d.cohort_id = 'fb200000-0000-4000-8000-000000000001' and d.module = 'coaching';
select set_config('app.session_transition', '', true);

select is(timestamptz '2026-10-15 06:30:00+07' at time zone 'UTC', timestamp '2026-10-14 23:30:00',
  'fixture: in UTC the session is still on 14 Oct');

-- ---------------------------------------------------------------------------
select is(public.programme_today(), (now() at time zone 'Asia/Ho_Chi_Minh')::date,
  '1. programme_today() is today in Vietnam');
select is(
  (select fulfilled_on from public.canonical_coaching_requirement_fulfilment('fb300000-0000-4000-8000-000000000002')),
  date '2026-10-15', '2. the session fulfils Coaching 1 on 15 Oct');
select is(
  (select completed_on from public.canonical_enrollment_requirement_calendar('fb300000-0000-4000-8000-000000000002', date '2026-10-15')
    where module = 'coaching'),
  date '2026-10-15', '3. the calendar dates its completion 15 Oct');
select is(
  (select is_overdue from public.canonical_enrollment_requirement_calendar('fb300000-0000-4000-8000-000000000002', date '2026-10-15')
    where module = 'coaching'),
  false, '4. so it was done on its due date, not overdue');
select is(
  (select occurred_on from public.session_activity_attributions
    where source_activity_id = 'fb400000-0000-4000-8000-000000000001'),
  date '2026-10-15', '5. the activity ledger stamps it 15 Oct too');

-- ---------------------------------------------------------------------------
-- No canonical function derives a date in UTC or from the server's date.
-- ---------------------------------------------------------------------------
select is(
  (select string_agg(p.proname, ', ' order by p.proname) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosrc ~* 'at time zone ''utc'''),
  null, '6. no public function takes a date in UTC');
select is(
  (select string_agg(p.proname, ', ' order by p.proname) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosrc ~* 'current_date'),
  null, '7. no public function body reads the server''s CURRENT_DATE');
select is(
  (select string_agg(p.proname, ', ' order by p.proname) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and pg_get_function_arguments(p.oid) ~* 'current_date'),
  null, '8. no "as of" defaults to the server''s CURRENT_DATE');

select * from finish();
rollback;
