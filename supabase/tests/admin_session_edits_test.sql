-- Admin session edits (20261005110000_admin_session_edits).
--
--   g. guard_session_protected_fields() has no Admin bypass: an Admin writing
--      status, time, Coach or participant notes straight at the table is
--      refused like everyone else.
--   r. admin_reschedule_session(): Admin only, a reason, a live session, a
--      future start, the booking rules re-run (Coach still in the cohort pool,
--      no clash with the Coach's other live sessions); one audit row.
--   o. admin_reopen_session(): cancelled -> pending_coach_approval (future
--      start, requirement still free), completed -> confirmed (the unit stops
--      counting until the Coach completes it again); one audit row.
--   a. session_admin_audit is written only by those functions, read by Admins.
--   c. confirm_peer_session(): the provider or an Admin confirms a Peer session
--      and stores its meeting link in one step.
begin;
select plan(41);

-- ---------------------------------------------------------------------------
-- Fixture
-- ---------------------------------------------------------------------------
-- 01 Coach K   02 learner A   04 Admin   05 learner D (coach-to-coach Peer)
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_user_meta_data, created_at, updated_at, confirmation_token, email_change_token_new, recovery_token)
select ('f9b00000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid,
  '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated',
  'admin-edit-' || n || '@example.test', 'test', now(),
  jsonb_build_object('full_name', 'Admin Edit Person ' || n), now(), now(), '', '', ''
from unnest(array[1, 2, 4, 5]) n;

insert into public.user_roles (user_id, role) values
  ('f9b00000-0000-4000-8000-000000000001', 'coach'),
  ('f9b00000-0000-4000-8000-000000000002', 'coachee'),
  ('f9b00000-0000-4000-8000-000000000004', 'admin'),
  ('f9b00000-0000-4000-8000-000000000005', 'coachee')
on conflict do nothing;
update public.profiles set status = 'active'::public.user_status where id::text like 'f9b00000-%';
insert into public.coach_profiles (id, approval_status, peer_coaching_opt_in)
values ('f9b00000-0000-4000-8000-000000000001', 'active', true)
on conflict (id) do update set approval_status = 'active', peer_coaching_opt_in = true;

insert into public.programmes (id, name) values
  ('f9b10000-0000-4000-8000-000000000001', 'Admin Edit Programme'),
  ('f9b10000-0000-4000-8000-000000000002', 'Admin Edit coach-to-coach Programme');
insert into public.programme_modules (programme_id, module, enabled, config) values
  ('f9b10000-0000-4000-8000-000000000001', 'coaching', true, '{"required": true, "required_units": 5}'),
  ('f9b10000-0000-4000-8000-000000000002', 'peer_coaching', true, '{"monthly_limit": 9}');
insert into public.cohorts (id, name, programme_id, start_date, end_date) values
  ('f9b20000-0000-4000-8000-000000000001', 'Admin Edit Cohort', 'f9b10000-0000-4000-8000-000000000001',
   current_date - 30, current_date + 200);
-- Every Coaching requirement is due in 5 days: open since 9 days ago.
update public.cohort_requirement_dates
   set due_on = current_date + 5, is_overridden = true,
       generation_method = 'manual', materialized_via = 'admin_save'
 where cohort_id = 'f9b20000-0000-4000-8000-000000000001';

insert into public.programme_enrollments (id, programme_id, user_id, cohort_id, status, start_date, end_date) values
  ('f9b30000-0000-4000-8000-000000000002', 'f9b10000-0000-4000-8000-000000000001',
   'f9b00000-0000-4000-8000-000000000002', 'f9b20000-0000-4000-8000-000000000001', 'active', current_date - 30, current_date + 200),
  ('f9b30000-0000-4000-8000-000000000005', 'f9b10000-0000-4000-8000-000000000002',
   'f9b00000-0000-4000-8000-000000000005', null, 'active', current_date - 30, null);
insert into public.coachee_goals (coachee_id, enrollment_id, title)
select e.user_id, e.id, 'Booking gate goal' from public.programme_enrollments e where e.id::text like 'f9b30000-%';
insert into public.cohort_coach_assignments (cohort_id, coach_id)
values ('f9b20000-0000-4000-8000-000000000001', 'f9b00000-0000-4000-8000-000000000001');

create temporary table req (ordinal integer, id uuid);
insert into req select d.ordinal, d.id from public.cohort_requirement_dates d
 where d.cohort_id = 'f9b20000-0000-4000-8000-000000000001' and d.module = 'coaching';
grant select on req to authenticated;

-- Sessions, written as trusted SQL:
--   s1  Coaching 1, pending,   in 7 days 09:00
--   s2  Coaching 2, confirmed, in 10 days 09:00
--   s3  Coaching 3, cancelled, in 12 days
--   s4  Coaching 4, completed, held yesterday
--   s5  Coaching 5, cancelled, 3 days ago (reopen needs a new time)
--   s7  Coaching 1, cancelled, in 14 days (Coaching 1 is held again by s1)
--   p1  coach-to-coach Peer, pending, in 5 days
select set_config('app.session_transition', 'on', true);
insert into public.sessions (id, enrollment_id, cohort_requirement_id, coach_id, coachee_id, topic,
  start_time, duration_minutes, status) values
  ('f9b40000-0000-4000-8000-000000000001', 'f9b30000-0000-4000-8000-000000000002', (select id from req where ordinal = 1),
   'f9b00000-0000-4000-8000-000000000001', 'f9b00000-0000-4000-8000-000000000002', 'S1',
   date_trunc('hour', now()) + interval '7 days', 60, 'pending_coach_approval'),
  ('f9b40000-0000-4000-8000-000000000002', 'f9b30000-0000-4000-8000-000000000002', (select id from req where ordinal = 2),
   'f9b00000-0000-4000-8000-000000000001', 'f9b00000-0000-4000-8000-000000000002', 'S2',
   date_trunc('hour', now()) + interval '10 days', 60, 'confirmed'),
  ('f9b40000-0000-4000-8000-000000000003', 'f9b30000-0000-4000-8000-000000000002', (select id from req where ordinal = 3),
   'f9b00000-0000-4000-8000-000000000001', 'f9b00000-0000-4000-8000-000000000002', 'S3',
   date_trunc('hour', now()) + interval '12 days', 60, 'cancelled'),
  ('f9b40000-0000-4000-8000-000000000004', 'f9b30000-0000-4000-8000-000000000002', (select id from req where ordinal = 4),
   'f9b00000-0000-4000-8000-000000000001', 'f9b00000-0000-4000-8000-000000000002', 'S4',
   now() - interval '1 day', 60, 'completed'),
  ('f9b40000-0000-4000-8000-000000000005', 'f9b30000-0000-4000-8000-000000000002', (select id from req where ordinal = 5),
   'f9b00000-0000-4000-8000-000000000001', 'f9b00000-0000-4000-8000-000000000002', 'S5',
   now() - interval '3 days', 60, 'cancelled'),
  ('f9b40000-0000-4000-8000-000000000007', 'f9b30000-0000-4000-8000-000000000002', (select id from req where ordinal = 1),
   'f9b00000-0000-4000-8000-000000000001', 'f9b00000-0000-4000-8000-000000000002', 'S7',
   date_trunc('hour', now()) + interval '14 days', 60, 'cancelled');
insert into public.peer_sessions (id, peer_coach_id, peer_coachee_id, enrollment_id, topic, start_time, duration_minutes, status)
values ('f9b40000-0000-4000-8000-0000000000a1', 'f9b00000-0000-4000-8000-000000000001',
        'f9b00000-0000-4000-8000-000000000005', 'f9b30000-0000-4000-8000-000000000005',
        'P1', date_trunc('hour', now()) + interval '5 days', 30, 'pending_coach_approval');
select set_config('app.session_transition', '', true);

-- ---------------------------------------------------------------------------
-- g. No Admin bypass of the protected fields
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'f9b00000-0000-4000-8000-000000000004')::text, true);

select throws_ok($$update public.sessions set status = 'completed' where id = 'f9b40000-0000-4000-8000-000000000002'$$,
  '42501', null, 'g1. an Admin cannot write a Coaching status at the table');
select throws_ok($$update public.sessions set start_time = now() + interval '20 days' where id = 'f9b40000-0000-4000-8000-000000000001'$$,
  '42501', null, 'g2. an Admin cannot move a Coaching session at the table');
select throws_ok($$update public.sessions set coach_notes = 'Admin wrote this' where id = 'f9b40000-0000-4000-8000-000000000001'$$,
  '42501', null, 'g3. an Admin cannot write the Coach''s notes');
select throws_ok($$update public.peer_sessions set status = 'confirmed' where id = 'f9b40000-0000-4000-8000-0000000000a1'$$,
  '42501', null, 'g4. an Admin cannot write a Peer status at the table');
select throws_ok($$update public.sessions set cohort_requirement_id = (select id from req where ordinal = 3) where id = 'f9b40000-0000-4000-8000-000000000001'$$,
  '42501', null, 'g5. an Admin cannot move a session to another requirement');

-- ---------------------------------------------------------------------------
-- r. admin_reschedule_session
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', 'f9b00000-0000-4000-8000-000000000001')::text, true);
select throws_ok($$select public.admin_reschedule_session('coaching', 'f9b40000-0000-4000-8000-000000000001',
  date_trunc('hour', now()) + interval '8 days', 45, 'Coach asked')$$,
  '42501', null, 'r1. only an Admin may use admin_reschedule_session');

select set_config('request.jwt.claims', json_build_object('sub', 'f9b00000-0000-4000-8000-000000000004')::text, true);
select throws_ok($$select public.admin_reschedule_session('coaching', 'f9b40000-0000-4000-8000-000000000001',
  date_trunc('hour', now()) + interval '8 days', 45, '   ')$$,
  '22023', 'A reason is required', 'r2. a reason is required');
select throws_ok($$select public.admin_reschedule_session('coaching', 'f9b40000-0000-4000-8000-000000000001',
  now() - interval '1 day', 45, 'Backdate')$$,
  '22023', 'A session cannot be booked in the past', 'r3. no rescheduling into the past');
select throws_ok($$select public.admin_reschedule_session('coaching', 'f9b40000-0000-4000-8000-000000000003',
  date_trunc('hour', now()) + interval '8 days', 45, 'Move it')$$,
  '23514', null, 'r4. a cancelled session is reopened, not rescheduled');
select throws_ok($$select public.admin_reschedule_session('coaching', 'f9b40000-0000-4000-8000-000000000001',
  date_trunc('hour', now()) + interval '10 days 30 minutes', 60, 'Clash')$$,
  '23505', null, 'r5. no clash with the Coach''s other live session');

reset role;
update public.cohort_coach_assignments set is_active = false
 where cohort_id = 'f9b20000-0000-4000-8000-000000000001' and coach_id = 'f9b00000-0000-4000-8000-000000000001';
set local role authenticated;
select throws_ok($$select public.admin_reschedule_session('coaching', 'f9b40000-0000-4000-8000-000000000001',
  date_trunc('hour', now()) + interval '8 days', 45, 'Coach left the pool')$$,
  '42501', null, 'r6. booking rules re-run: a Coach no longer in the cohort pool is refused');
reset role;
update public.cohort_coach_assignments set is_active = true
 where cohort_id = 'f9b20000-0000-4000-8000-000000000001' and coach_id = 'f9b00000-0000-4000-8000-000000000001';
set local role authenticated;

select lives_ok($$select public.admin_reschedule_session('coaching', 'f9b40000-0000-4000-8000-000000000001',
  date_trunc('hour', now()) + interval '8 days', 45, 'Coach asked to move it', 'New topic', 'https://meet.example/s1')$$,
  'r7. an Admin reschedules a live Coaching session with a reason');
select results_eq(
  $$select start_time, duration_minutes, topic, meeting_url, status::text, cohort_requirement_id
      from public.sessions where id = 'f9b40000-0000-4000-8000-000000000001'$$,
  $$select date_trunc('hour', now()) + interval '8 days', 45, 'New topic'::text, 'https://meet.example/s1'::text,
           'pending_coach_approval'::text, (select id from req where ordinal = 1)$$,
  'r8. time, duration, topic and link change; status and requirement do not');
select results_eq(
  $$select session_kind, action, reason, actor_id,
           (before_state->>'duration_minutes')::int, (after_state->>'duration_minutes')::int
      from public.session_admin_audit where session_id = 'f9b40000-0000-4000-8000-000000000001'$$,
  $$values ('coaching'::text, 'reschedule'::text, 'Coach asked to move it'::text,
            'f9b00000-0000-4000-8000-000000000004'::uuid, 60, 45)$$,
  'r9. one audit row: kind, action, reason, actor, before and after');
select lives_ok($$select public.admin_reschedule_session('peer', 'f9b40000-0000-4000-8000-0000000000a1',
  date_trunc('hour', now()) + interval '6 days', 30, 'Receiver asked')$$,
  'r10. an Admin reschedules a Peer session');
select is((select count(*)::int from public.session_admin_audit
            where session_id = 'f9b40000-0000-4000-8000-0000000000a1' and action = 'reschedule'),
  1, 'r11. the Peer reschedule is audited');
select throws_ok($$select public.admin_reschedule_session('coaching', 'f9b40000-0000-4000-8000-000000000001',
  date_trunc('hour', now()) + interval '6 days 15 minutes', 30, 'Clash with Peer')$$,
  '23505', null, 'r12. no clash with the Coach''s live Peer session either');

-- ---------------------------------------------------------------------------
-- o. admin_reopen_session
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', 'f9b00000-0000-4000-8000-000000000001')::text, true);
select throws_ok($$select public.admin_reopen_session('coaching', 'f9b40000-0000-4000-8000-000000000003', 'Mistake')$$,
  '42501', null, 'o1. only an Admin may reopen');
select set_config('request.jwt.claims', json_build_object('sub', 'f9b00000-0000-4000-8000-000000000004')::text, true);
select throws_ok($$select public.admin_reopen_session('coaching', 'f9b40000-0000-4000-8000-000000000003', '')$$,
  '22023', 'A reason is required', 'o2. a reason is required');
select throws_ok($$select public.admin_reopen_session('coaching', 'f9b40000-0000-4000-8000-000000000002', 'Already live')$$,
  '23514', null, 'o3. a live session is not reopened');

select lives_ok($$select public.admin_reopen_session('coaching', 'f9b40000-0000-4000-8000-000000000003', 'Cancelled by mistake')$$,
  'o4. an Admin reopens a cancelled Coaching session');
select results_eq(
  $$select status::text, cancelled_at, cancelled_by, cancel_reason
      from public.sessions where id = 'f9b40000-0000-4000-8000-000000000003'$$,
  $$values ('pending_coach_approval'::text, null::timestamptz, null::uuid, null::text)$$,
  'o5. it is a pending request again, with no cancellation stamp');

select throws_ok($$select public.admin_reopen_session('coaching', 'f9b40000-0000-4000-8000-000000000007', 'Requirement taken')$$,
  '23505', null, 'o6. booking rules re-run: the requirement is held by another live session');
select throws_ok($$select public.admin_reopen_session('coaching', 'f9b40000-0000-4000-8000-000000000005', 'Its time has passed')$$,
  '22023', 'A session cannot be booked in the past', 'o7. a cancelled session in the past needs a new time');
select lives_ok($$select public.admin_reopen_session('coaching', 'f9b40000-0000-4000-8000-000000000005', 'Rebook it',
  date_trunc('hour', now()) + interval '20 days', 60)$$,
  'o8. ... and is reopened at a new future time');
select results_eq(
  $$select status::text, start_time from public.sessions where id = 'f9b40000-0000-4000-8000-000000000005'$$,
  $$select 'pending_coach_approval'::text, date_trunc('hour', now()) + interval '20 days'$$,
  'o9. reopened at the new time');

reset role;
select is(
  (select completed_units from public.canonical_module_progress('f9b30000-0000-4000-8000-000000000002', current_date)
    where module = 'coaching'),
  1, 'o10. before: the completed session fulfils Coaching 4');
set local role authenticated;
select lives_ok($$select public.admin_reopen_session('coaching', 'f9b40000-0000-4000-8000-000000000004', 'Not actually held')$$,
  'o11. an Admin reopens a completed Coaching session');
select is((select status::text from public.sessions where id = 'f9b40000-0000-4000-8000-000000000004'),
  'confirmed', 'o12. a reopened completed session is confirmed');
reset role;
select is(
  (select completed_units from public.canonical_module_progress('f9b30000-0000-4000-8000-000000000002', current_date)
    where module = 'coaching'),
  0, 'o13. after: the unit no longer counts');
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'f9b00000-0000-4000-8000-000000000001')::text, true);
select lives_ok($$select public.complete_coaching_session('f9b40000-0000-4000-8000-000000000004')$$,
  'o14. the Coach can complete it again');
select set_config('request.jwt.claims', json_build_object('sub', 'f9b00000-0000-4000-8000-000000000004')::text, true);

select results_eq(
  $$select action, before_state->>'status', after_state->>'status' from public.session_admin_audit
     where session_id in ('f9b40000-0000-4000-8000-000000000003', 'f9b40000-0000-4000-8000-000000000004',
                          'f9b40000-0000-4000-8000-000000000005')
     order by session_id$$,
  $$values ('reopen'::text, 'cancelled'::text, 'pending_coach_approval'::text),
           ('reopen', 'completed', 'confirmed'),
           ('reopen', 'cancelled', 'pending_coach_approval')$$,
  'o15. every reopen is audited once, with the status it left and entered');
select is((select count(*)::int from public.session_admin_audit
            where session_id in ('f9b40000-0000-4000-8000-000000000007', 'f9b40000-0000-4000-8000-000000000002')),
  0, 'o16. a refused edit leaves no audit row');

-- ---------------------------------------------------------------------------
-- a. The audit table
-- ---------------------------------------------------------------------------
select throws_ok($$insert into public.session_admin_audit (session_kind, session_id, action, reason, actor_id)
  values ('coaching', 'f9b40000-0000-4000-8000-000000000001', 'reschedule', 'forged', 'f9b00000-0000-4000-8000-000000000004')$$,
  '42501', null, 'a1. not even an Admin writes audit rows directly');
select throws_ok($$update public.session_admin_audit set reason = 'rewritten'$$,
  '42501', null, 'a2. nor rewrites them');
select ok((select count(*) from public.session_admin_audit) >= 5, 'a3. an Admin reads the audit trail');
select set_config('request.jwt.claims', json_build_object('sub', 'f9b00000-0000-4000-8000-000000000002')::text, true);
select is((select count(*)::int from public.session_admin_audit), 0, 'a4. a learner reads none of it');

-- ---------------------------------------------------------------------------
-- c. confirm_peer_session
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', 'f9b00000-0000-4000-8000-000000000005')::text, true);
select throws_ok($$select public.confirm_peer_session('f9b40000-0000-4000-8000-0000000000a1', 'https://meet.example/p1')$$,
  '42501', null, 'c1. the receiver cannot confirm their own request');
select set_config('request.jwt.claims', json_build_object('sub', 'f9b00000-0000-4000-8000-000000000001')::text, true);
select lives_ok($$select public.confirm_peer_session('f9b40000-0000-4000-8000-0000000000a1', 'https://meet.example/p1')$$,
  'c2. the provider confirms with the meeting link');
select results_eq(
  $$select status::text, meeting_url from public.peer_sessions where id = 'f9b40000-0000-4000-8000-0000000000a1'$$,
  $$values ('confirmed'::text, 'https://meet.example/p1'::text)$$, 'c3. status and link land together');
select throws_ok($$select public.confirm_peer_session('f9b40000-0000-4000-8000-0000000000a1', null)$$,
  '23514', null, 'c4. a session already confirmed is not confirmed again');

select * from finish();
rollback;
