-- Peer booking rules (20261006120000_peer_booking_rules).
--
--   a. A dyad Peer booking (coachee_peer_sessions, which earn requirements) is
--      eligible on the same rule as Coaching and Mentoring: a free Peer
--      requirement + the Admin-assigned partner + the goal gate. No
--      receive_limit / monthly_limit caps it.
--   b. Practice from the Coach opt-in pool (peer_sessions, no requirement) is
--      capped by monthly_limit per calendar month in Asia/Ho_Chi_Minh.
--   c. get_peer_session_usage (what a page shows) counts exactly what the
--      booking check counts.
--   d. Nothing reads the retired limit keys: the Peer target is no longer
--      checked against a limit, and the unused allowance readers are gone.
begin;
select plan(19);

-- ---------------------------------------------------------------------------
-- Fixture
-- ---------------------------------------------------------------------------
-- 01 learner A1   02 learner A2 (A1's dyad partner, no goal yet)
-- 03 Coach K (Peer opt-in pool)   04 Admin
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_user_meta_data, created_at, updated_at, confirmation_token, email_change_token_new, recovery_token)
select ('f9e00000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid,
  '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated',
  'peer-rules-' || n || '@example.test', 'test', now(),
  jsonb_build_object('full_name', 'Peer Rules Person ' || n), now(), now(), '', '', ''
from generate_series(1, 4) n;

insert into public.user_roles (user_id, role) values
  ('f9e00000-0000-4000-8000-000000000001', 'coachee'),
  ('f9e00000-0000-4000-8000-000000000002', 'coachee'),
  ('f9e00000-0000-4000-8000-000000000003', 'coach'),
  ('f9e00000-0000-4000-8000-000000000004', 'admin')
on conflict do nothing;
update public.profiles set status = 'active'::public.user_status where id::text like 'f9e00000-%';
insert into public.coach_profiles (id, approval_status, peer_coaching_opt_in) values
  ('f9e00000-0000-4000-8000-000000000003', 'active', true)
on conflict (id) do update set approval_status = 'active', peer_coaching_opt_in = true;

-- Two required Peer units; a practice limit of one session a month; and the
-- retired receive_limit of 1, which must cap nothing.
insert into public.programmes (id, name) values
  ('f9e10000-0000-4000-8000-000000000001', 'Peer Rules Programme');
insert into public.programme_modules (programme_id, module, enabled, config) values
  ('f9e10000-0000-4000-8000-000000000001', 'peer_coaching', true,
   '{"required": true, "required_units": 2, "monthly_limit": 1, "receive_limit": 1}');
insert into public.cohorts (id, name, programme_id, start_date, end_date) values
  ('f9e20000-0000-4000-8000-000000000001', 'Peer Rules Cohort', 'f9e10000-0000-4000-8000-000000000001',
   current_date - 30, current_date + 200);
-- Peer 1 and 2 due in 10 and 12 days: both open now.
update public.cohort_requirement_dates
   set due_on = current_date + 8 + 2 * ordinal, is_overridden = true,
       generation_method = 'manual', materialized_via = 'admin_save'
 where cohort_id = 'f9e20000-0000-4000-8000-000000000001';
insert into public.programme_enrollments (id, programme_id, user_id, cohort_id, status, start_date, end_date)
select ('f9e30000-0000-4000-8000-00000000000' || n)::uuid, 'f9e10000-0000-4000-8000-000000000001',
  ('f9e00000-0000-4000-8000-00000000000' || n)::uuid, 'f9e20000-0000-4000-8000-000000000001',
  'active', current_date - 30, current_date + 200
from generate_series(1, 2) n;
-- A1 has set a goal; A2 has not.
insert into public.coachee_goals (coachee_id, enrollment_id, title) values
  ('f9e00000-0000-4000-8000-000000000001', 'f9e30000-0000-4000-8000-000000000001', 'Peer rules goal');

select set_config('request.jwt.claims', json_build_object('sub', 'f9e00000-0000-4000-8000-000000000004')::text, true);
select public.admin_create_peer_dyad('f9e20000-0000-4000-8000-000000000001', 'f9e10000-0000-4000-8000-000000000001',
  'f9e30000-0000-4000-8000-000000000001', 'f9e30000-0000-4000-8000-000000000002');

-- The calendar month in Vietnam, and instants inside later months.
create temporary table vn (name text primary key, at timestamptz);
insert into vn
select 'm0_mid', date_trunc('month', now() at time zone 'Asia/Ho_Chi_Minh') at time zone 'Asia/Ho_Chi_Minh' + interval '12 hours'
union all select 'm1_mid', (date_trunc('month', now() at time zone 'Asia/Ho_Chi_Minh') + interval '1 month 5 days') at time zone 'Asia/Ho_Chi_Minh'
union all select 'm2_mid', (date_trunc('month', now() at time zone 'Asia/Ho_Chi_Minh') + interval '2 months 5 days') at time zone 'Asia/Ho_Chi_Minh'
-- 00:30 on the 1st of month 3 in Vietnam: still the last day of month 2 in UTC.
union all select 'm3_start', (date_trunc('month', now() at time zone 'Asia/Ho_Chi_Minh') + interval '3 months 30 minutes') at time zone 'Asia/Ho_Chi_Minh';
grant select on vn to authenticated;

-- ---------------------------------------------------------------------------
-- a. Dyad: free requirement + partner + goal gate
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'f9e00000-0000-4000-8000-000000000002')::text, true);
select is(public.can_book_coachee_peer_session('f9e00000-0000-4000-8000-000000000001', 'f9e30000-0000-4000-8000-000000000002'),
  false, 'a1. the goal gate closes dyad booking for a learner with no goal');

select set_config('request.jwt.claims', json_build_object('sub', 'f9e00000-0000-4000-8000-000000000001')::text, true);
select is(public.can_book_coachee_peer_session('f9e00000-0000-4000-8000-000000000002', 'f9e30000-0000-4000-8000-000000000001'),
  true, 'a2. A1 may book their partner: two Peer requirements are free');
select lives_ok($$select public.book_coachee_peer_session('f9e00000-0000-4000-8000-000000000002',
  'f9e30000-0000-4000-8000-000000000001', 'Dyad 1', now() + interval '3 days', 45)$$,
  'a3. A1 books Peer 1 with their partner');
select is(public.can_book_coachee_peer_session('f9e00000-0000-4000-8000-000000000002', 'f9e30000-0000-4000-8000-000000000001'),
  true, 'a4. Peer 2 is still free: the retired receive_limit of 1 caps nothing');
select lives_ok($$select public.book_coachee_peer_session('f9e00000-0000-4000-8000-000000000002',
  'f9e30000-0000-4000-8000-000000000001', 'Dyad 2', now() + interval '4 days', 45)$$,
  'a5. A1 books Peer 2');
select is(public.can_book_coachee_peer_session('f9e00000-0000-4000-8000-000000000002', 'f9e30000-0000-4000-8000-000000000001'),
  false, 'a6. with every Peer requirement held, A1 is not eligible');
select throws_ok($$select public.book_coachee_peer_session('f9e00000-0000-4000-8000-000000000002',
  'f9e30000-0000-4000-8000-000000000001', 'Dyad 3', now() + interval '5 days', 45)$$,
  '42501', null, 'a7. a third dyad booking is refused');
select is(public.can_book_coachee_peer_session('f9e00000-0000-4000-8000-000000000003', 'f9e30000-0000-4000-8000-000000000001'),
  false, 'a8. an opt-in Coach is not A1''s dyad partner');

-- ---------------------------------------------------------------------------
-- b. Practice: monthly_limit per Vietnamese calendar month
-- ---------------------------------------------------------------------------
reset role;
select lives_ok($$insert into public.peer_sessions (peer_coach_id, peer_coachee_id, enrollment_id, topic, start_time, duration_minutes, status)
  values ('f9e00000-0000-4000-8000-000000000003', 'f9e00000-0000-4000-8000-000000000001',
          'f9e30000-0000-4000-8000-000000000001', 'Practice m1', (select at from vn where name = 'm1_mid'), 30, 'pending_coach_approval')$$,
  'b1. one practice session next month');
select throws_ok($$insert into public.peer_sessions (peer_coach_id, peer_coachee_id, enrollment_id, topic, start_time, duration_minutes, status)
  values ('f9e00000-0000-4000-8000-000000000003', 'f9e00000-0000-4000-8000-000000000001',
          'f9e30000-0000-4000-8000-000000000001', 'Practice m1 again', (select at from vn where name = 'm1_mid') + interval '1 day', 30, 'pending_coach_approval')$$,
  '42501', 'Peer coaching entitlement has been exhausted', 'b2. a second practice session in the same month is refused');
select lives_ok($$insert into public.peer_sessions (peer_coach_id, peer_coachee_id, enrollment_id, topic, start_time, duration_minutes, status)
  values ('f9e00000-0000-4000-8000-000000000003', 'f9e00000-0000-4000-8000-000000000001',
          'f9e30000-0000-4000-8000-000000000001', 'Practice m2', (select at from vn where name = 'm2_mid'), 30, 'pending_coach_approval')$$,
  'b3. the following month has its own allowance');
select lives_ok($$insert into public.peer_sessions (peer_coach_id, peer_coachee_id, enrollment_id, topic, start_time, duration_minutes, status)
  values ('f9e00000-0000-4000-8000-000000000003', 'f9e00000-0000-4000-8000-000000000001',
          'f9e30000-0000-4000-8000-000000000001', 'Practice m3', (select at from vn where name = 'm3_start'), 30, 'pending_coach_approval')$$,
  'b4. 00:30 on the 1st in Vietnam is the new month, although UTC is still on the previous one');

-- ---------------------------------------------------------------------------
-- c. The usage a page shows is what the booking check counts
-- ---------------------------------------------------------------------------
insert into public.peer_sessions (peer_coach_id, peer_coachee_id, enrollment_id, topic, start_time, duration_minutes, status)
values ('f9e00000-0000-4000-8000-000000000003', 'f9e00000-0000-4000-8000-000000000001',
        'f9e30000-0000-4000-8000-000000000001', 'Practice m0', (select at from vn where name = 'm0_mid'), 30, 'completed');
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'f9e00000-0000-4000-8000-000000000001')::text, true);
select results_eq(
  $$select monthly_limit, used_count from public.get_peer_session_usage('f9e30000-0000-4000-8000-000000000001')$$,
  $$values (1, 1)$$,
  'c1. this month: limit 1, used 1 (sessions in other months do not count)');
select is(public.can_book_peer_session('f9e00000-0000-4000-8000-000000000003', 'f9e30000-0000-4000-8000-000000000001'),
  false, 'c2. the booking pre-check agrees: this month is full');
reset role;
select throws_ok($$insert into public.peer_sessions (peer_coach_id, peer_coachee_id, enrollment_id, topic, start_time, duration_minutes, status)
  values ('f9e00000-0000-4000-8000-000000000003', 'f9e00000-0000-4000-8000-000000000001',
          'f9e30000-0000-4000-8000-000000000001', 'Practice m0 again', (select at from vn where name = 'm0_mid') + interval '1 hour', 30, 'pending_coach_approval')$$,
  '42501', 'Peer coaching entitlement has been exhausted', 'c3. ... and so does the insert check');

-- ---------------------------------------------------------------------------
-- d. Nothing reads the retired limit keys
-- ---------------------------------------------------------------------------
select lives_ok($$update public.programme_modules
    set config = '{"required": true, "required_units": 3, "receive": true, "give": true, "monthly_limit": 1}'
  where programme_id = 'f9e10000-0000-4000-8000-000000000001' and module = 'peer_coaching'$$,
  'd1. the Peer requirement is not capped by the practice limit');
select hasnt_function('public', 'get_coachee_peer_session_usage', array['uuid'],
  'd2. the dyad allowance reader is dropped');
select hasnt_function('public', 'get_mentoring_session_usage', array['uuid'],
  'd3. the Mentoring allowance reader is dropped');
select is(
  (select string_agg(p.proname, ', ' order by p.proname) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosrc ~ '(receive_limit|give_limit|coachee_session_limit|mentoring_received_limit)'),
  null, 'd4. no public function reads a retired limit key or column');

select * from finish();
rollback;
