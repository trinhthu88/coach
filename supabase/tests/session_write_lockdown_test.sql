-- Session write lockdown (20261005100000_session_write_lockdown).
--
--   a. A learner cannot write a session row straight into sessions,
--      mentoring_sessions, peer_sessions or coachee_peer_sessions -- least of
--      all one already 'completed' or held in the past. Every booking goes
--      through its RPC, which always creates pending_coach_approval.
--   b. In the Coaching branch of transition_session_status only the Coach (or
--      an Admin) confirms, and nobody completes: completion belongs to
--      complete_coaching_session.
--   c. sessions.cohort_requirement_id / cohort_id cannot be rewritten by an
--      UPDATE from the app.
--   d. Peer and Triad sessions cannot be booked, scheduled or re-proposed in
--      the past.
begin;
select plan(26);

-- ---------------------------------------------------------------------------
-- Fixture
-- ---------------------------------------------------------------------------
-- 01 Coach K   02 learner A   03 learner B (A's Peer dyad and Triad partner)
-- 04 Admin     05 learner D (coach-to-coach Peer, no cohort)
-- 06, 07 learners F and G (a second Triad pair)
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_user_meta_data, created_at, updated_at, confirmation_token, email_change_token_new, recovery_token)
select ('f9a00000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid,
  '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated',
  'lockdown-' || n || '@example.test', 'test', now(),
  jsonb_build_object('full_name', 'Lockdown Person ' || n), now(), now(), '', '', ''
from generate_series(1, 7) n;

insert into public.user_roles (user_id, role) values
  ('f9a00000-0000-4000-8000-000000000001', 'coach'),
  ('f9a00000-0000-4000-8000-000000000002', 'coachee'),
  ('f9a00000-0000-4000-8000-000000000003', 'coachee'),
  ('f9a00000-0000-4000-8000-000000000004', 'admin'),
  ('f9a00000-0000-4000-8000-000000000005', 'coachee'),
  ('f9a00000-0000-4000-8000-000000000006', 'coachee'),
  ('f9a00000-0000-4000-8000-000000000007', 'coachee')
on conflict do nothing;
update public.profiles set status = 'active'::public.user_status, peer_coaching_opt_in = true
 where id::text like 'f9a00000-%';
insert into public.coach_profiles (id, approval_status, peer_coaching_opt_in)
values ('f9a00000-0000-4000-8000-000000000001', 'active', true)
on conflict (id) do update set approval_status = 'active', peer_coaching_opt_in = true;
-- Coach K's Peer slot three days out (coach-pool practice is booked into one).
insert into public.coach_availability (id, coach_id, slot_date, start_time, end_time, slot_type)
values ('f9a50000-0000-4000-8000-000000000001', 'f9a00000-0000-4000-8000-000000000001',
        public.programme_today() + 3, '09:00', '11:00', 'peer');
insert into public.mentor_profiles (coach_user_id, is_active)
values ('f9a00000-0000-4000-8000-000000000001', true) on conflict do nothing;

-- Programme P runs Coaching, Mentoring, Peer and Triads in cohort C. Coaching
-- has a third unit left free, so a direct insert is not merely over the cap.
insert into public.programmes (id, name) values
  ('f9a10000-0000-4000-8000-000000000001', 'Lockdown Programme'),
  ('f9a10000-0000-4000-8000-000000000002', 'Lockdown coach-to-coach Programme');
insert into public.programme_modules (programme_id, module, enabled, config) values
  ('f9a10000-0000-4000-8000-000000000001', 'coaching', true, '{"required": true, "required_units": 3}'),
  ('f9a10000-0000-4000-8000-000000000001', 'mentoring', true, '{"required": true, "required_units": 1}'),
  ('f9a10000-0000-4000-8000-000000000001', 'peer_coaching', true, '{"required": true, "required_units": 2, "monthly_limit": 20}'),
  ('f9a10000-0000-4000-8000-000000000001', 'triads', true, '{"required": true, "required_units": 2}'),
  ('f9a10000-0000-4000-8000-000000000002', 'peer_coaching', true, '{"monthly_limit": 9}');
insert into public.cohorts (id, name, programme_id, start_date, end_date) values
  ('f9a20000-0000-4000-8000-000000000001', 'Lockdown Cohort', 'f9a10000-0000-4000-8000-000000000001',
   current_date - 30, current_date + 200);
-- Every requirement is open now and due well ahead.
update public.cohort_requirement_dates
   set due_on = current_date + 10 + ordinal * 30, is_overridden = true,
       generation_method = 'manual', materialized_via = 'admin_save'
 where cohort_id = 'f9a20000-0000-4000-8000-000000000001';

insert into public.programme_enrollments (id, programme_id, user_id, cohort_id, status, start_date, end_date) values
  ('f9a30000-0000-4000-8000-000000000002', 'f9a10000-0000-4000-8000-000000000001',
   'f9a00000-0000-4000-8000-000000000002', 'f9a20000-0000-4000-8000-000000000001', 'active', current_date - 30, current_date + 200),
  ('f9a30000-0000-4000-8000-000000000003', 'f9a10000-0000-4000-8000-000000000001',
   'f9a00000-0000-4000-8000-000000000003', 'f9a20000-0000-4000-8000-000000000001', 'active', current_date - 30, current_date + 200),
  ('f9a30000-0000-4000-8000-000000000005', 'f9a10000-0000-4000-8000-000000000002',
   'f9a00000-0000-4000-8000-000000000005', null, 'active', current_date - 30, null),
  ('f9a30000-0000-4000-8000-000000000006', 'f9a10000-0000-4000-8000-000000000001',
   'f9a00000-0000-4000-8000-000000000006', 'f9a20000-0000-4000-8000-000000000001', 'active', current_date - 30, current_date + 200),
  ('f9a30000-0000-4000-8000-000000000007', 'f9a10000-0000-4000-8000-000000000001',
   'f9a00000-0000-4000-8000-000000000007', 'f9a20000-0000-4000-8000-000000000001', 'active', current_date - 30, current_date + 200);
insert into public.coachee_goals (coachee_id, enrollment_id, title)
select e.user_id, e.id, 'Booking gate goal' from public.programme_enrollments e
 where e.id::text like 'f9a30000-%';

create temporary table req (module text, ordinal integer, id uuid);
insert into req select d.module::text, d.ordinal, d.id from public.cohort_requirement_dates d
 where d.cohort_id = 'f9a20000-0000-4000-8000-000000000001';
grant select on req to authenticated;

insert into public.cohort_coach_assignments (cohort_id, coach_id)
values ('f9a20000-0000-4000-8000-000000000001', 'f9a00000-0000-4000-8000-000000000001');
insert into public.cohort_mentors (cohort_id, mentor_user_id)
values ('f9a20000-0000-4000-8000-000000000001', 'f9a00000-0000-4000-8000-000000000001');

-- Admin pairs A and B for Peer.
select set_config('request.jwt.claims', json_build_object('sub', 'f9a00000-0000-4000-8000-000000000004')::text, true);
select public.admin_create_peer_dyad(
  'f9a20000-0000-4000-8000-000000000001', 'f9a10000-0000-4000-8000-000000000001',
  'f9a30000-0000-4000-8000-000000000002', 'f9a30000-0000-4000-8000-000000000003');

-- Coaching sessions, written as trusted SQL:
--   s1  Coaching 1, pending, next week
--   s2  Coaching 2, confirmed, held yesterday, with the learner's notes
select set_config('app.session_transition', 'on', true);
insert into public.sessions (id, enrollment_id, cohort_requirement_id, coach_id, coachee_id, topic,
  start_time, duration_minutes, status, coachee_notes) values
  ('f9a40000-0000-4000-8000-000000000001', 'f9a30000-0000-4000-8000-000000000002',
   (select id from req where module = 'coaching' and ordinal = 1),
   'f9a00000-0000-4000-8000-000000000001', 'f9a00000-0000-4000-8000-000000000002',
   'Pending', now() + interval '7 days', 60, 'pending_coach_approval', null),
  ('f9a40000-0000-4000-8000-000000000002', 'f9a30000-0000-4000-8000-000000000002',
   (select id from req where module = 'coaching' and ordinal = 2),
   'f9a00000-0000-4000-8000-000000000001', 'f9a00000-0000-4000-8000-000000000002',
   'Held', now() - interval '1 day', 60, 'confirmed', 'What I took away');
select set_config('app.session_transition', '', true);

-- Triad 1 groups: A with B, and F with G.
create temporary table grp (name text, id uuid);
insert into grp select 'AB', public.triad_create_group_internal(
  (select id from req where module = 'triads' and ordinal = 1),
  array['f9a30000-0000-4000-8000-000000000002', 'f9a30000-0000-4000-8000-000000000003']::uuid[], 'en', 'admin');
insert into grp select 'FG', public.triad_create_group_internal(
  (select id from req where module = 'triads' and ordinal = 1),
  array['f9a30000-0000-4000-8000-000000000006', 'f9a30000-0000-4000-8000-000000000007']::uuid[], 'en', 'admin');
grant select on grp to authenticated;
create temporary table tri (id uuid);
grant select, insert on tri to authenticated;

-- ---------------------------------------------------------------------------
-- a. No direct session INSERT from the app
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'f9a00000-0000-4000-8000-000000000002')::text, true);

select throws_ok($$
  insert into public.sessions (enrollment_id, cohort_requirement_id, coach_id, coachee_id, topic, start_time, duration_minutes, status)
  values ('f9a30000-0000-4000-8000-000000000002', (select id from req where module = 'coaching' and ordinal = 3),
          'f9a00000-0000-4000-8000-000000000001', 'f9a00000-0000-4000-8000-000000000002',
          'Self-completed', now() - interval '2 days', 60, 'completed')
$$, '42501', 'permission denied for table sessions',
  'a1. a learner cannot insert a completed Coaching session in the past');

select throws_ok($$
  insert into public.sessions (enrollment_id, cohort_requirement_id, coach_id, coachee_id, topic, start_time, duration_minutes, status)
  values ('f9a30000-0000-4000-8000-000000000002', (select id from req where module = 'coaching' and ordinal = 3),
          'f9a00000-0000-4000-8000-000000000001', 'f9a00000-0000-4000-8000-000000000002',
          'Self-confirmed', now() + interval '9 days', 60, 'confirmed')
$$, '42501', 'permission denied for table sessions',
  'a2. a learner cannot insert a Coaching session already confirmed');

select throws_ok($$
  insert into public.coachee_peer_sessions (peer_provider_id, peer_receiver_id, enrollment_id, topic, start_time, duration_minutes, status)
  values ('f9a00000-0000-4000-8000-000000000003', 'f9a00000-0000-4000-8000-000000000002',
          'f9a30000-0000-4000-8000-000000000002', 'Self-completed', now() - interval '2 days', 60, 'completed')
$$, '42501', 'permission denied for table coachee_peer_sessions',
  'a3. a learner cannot insert a completed Peer session in the past');

select throws_ok($$
  insert into public.mentoring_sessions (mentor_id, mentee_id, enrollment_id, topic, start_time, duration_minutes, status)
  values ('f9a00000-0000-4000-8000-000000000001', 'f9a00000-0000-4000-8000-000000000002',
          'f9a30000-0000-4000-8000-000000000002', 'Self-completed', now() - interval '2 days', 60, 'completed')
$$, '42501', 'permission denied for table mentoring_sessions',
  'a4. a learner cannot insert a completed Mentoring session in the past');

select set_config('request.jwt.claims', json_build_object('sub', 'f9a00000-0000-4000-8000-000000000005')::text, true);
select throws_ok($$
  insert into public.peer_sessions (peer_coach_id, peer_coachee_id, enrollment_id, topic, start_time, duration_minutes, status)
  values ('f9a00000-0000-4000-8000-000000000001', 'f9a00000-0000-4000-8000-000000000005',
          'f9a30000-0000-4000-8000-000000000005', 'Self-completed', now() - interval '2 days', 30, 'completed')
$$, '42501', 'permission denied for table peer_sessions',
  'a5. a learner cannot insert a completed coach-to-coach Peer session in the past');

select ok(
  not has_table_privilege('authenticated', 'public.sessions', 'INSERT')
  and not has_table_privilege('authenticated', 'public.mentoring_sessions', 'INSERT')
  and not has_table_privilege('authenticated', 'public.peer_sessions', 'INSERT')
  and not has_table_privilege('authenticated', 'public.coachee_peer_sessions', 'INSERT')
  and not has_table_privilege('anon', 'public.sessions', 'INSERT')
  and not has_table_privilege('anon', 'public.mentoring_sessions', 'INSERT')
  and not has_table_privilege('anon', 'public.peer_sessions', 'INSERT')
  and not has_table_privilege('anon', 'public.coachee_peer_sessions', 'INSERT'),
  'a6. no client role holds INSERT on any of the four session tables');

-- The booking RPCs still work, and always create a pending request.
select lives_ok($$
  select public.book_peer_session('f9a00000-0000-4000-8000-000000000001', 'f9a30000-0000-4000-8000-000000000005',
    'Future peer', (public.programme_today() + 3 + time '09:30')
      at time zone public.availability_slot_time_zone('f9a00000-0000-4000-8000-000000000001'),
    30, 'f9a50000-0000-4000-8000-000000000001')
$$, 'a7. book_peer_session still books a future session, into the Coach''s Peer slot');
select set_config('request.jwt.claims', json_build_object('sub', 'f9a00000-0000-4000-8000-000000000002')::text, true);
select lives_ok($$
  select public.book_coachee_peer_session('f9a00000-0000-4000-8000-000000000003', 'f9a30000-0000-4000-8000-000000000002',
    'Future peer', now() + interval '3 days', 60, null)
$$, 'a8. book_coachee_peer_session still books a future session');
select is(
  (select array_agg(distinct status::text) from public.coachee_peer_sessions
    where enrollment_id = 'f9a30000-0000-4000-8000-000000000002'),
  array['pending_coach_approval'], 'a9. the RPC booking is created pending_coach_approval');

-- ---------------------------------------------------------------------------
-- b. Coaching: the learner neither confirms nor completes
-- ---------------------------------------------------------------------------
select throws_ok($$
  select public.transition_session_status('f9a40000-0000-4000-8000-000000000001', 'coaching', 'confirm', null)
$$, '42501', null, 'b1. the coachee cannot confirm their own Coaching session');
select throws_ok($$
  select public.transition_session_status('f9a40000-0000-4000-8000-000000000002', 'coaching', 'complete', null)
$$, '42501', null, 'b2. the coachee cannot complete their own Coaching session');
select is(
  (select array_agg(status::text order by id) from public.sessions
    where id in ('f9a40000-0000-4000-8000-000000000001', 'f9a40000-0000-4000-8000-000000000002')),
  array['pending_coach_approval', 'confirmed'], 'b3. both sessions are unchanged');

select set_config('request.jwt.claims', json_build_object('sub', 'f9a00000-0000-4000-8000-000000000001')::text, true);
select throws_ok($$
  select public.transition_session_status('f9a40000-0000-4000-8000-000000000002', 'coaching', 'complete', null)
$$, '42501', null, 'b4. transition_session_status completes no Coaching session, not even for the Coach');
select lives_ok($$
  select public.transition_session_status('f9a40000-0000-4000-8000-000000000001', 'coaching', 'confirm', null)
$$, 'b5. the Coach still confirms through transition_session_status');
select lives_ok($$select public.complete_coaching_session('f9a40000-0000-4000-8000-000000000002')$$,
  'b6. the Coach completes through complete_coaching_session');
select is(
  (select array_agg(status::text order by id) from public.sessions
    where id in ('f9a40000-0000-4000-8000-000000000001', 'f9a40000-0000-4000-8000-000000000002')),
  array['confirmed', 'completed'], 'b7. confirm and complete land through their canonical paths');

-- ---------------------------------------------------------------------------
-- c. The requirement a Coaching session fulfils is not the app's to rewrite
-- ---------------------------------------------------------------------------
-- The lifecycle RPCs above raised app.session_transition for the rest of this
-- transaction; an API request is a transaction of its own, so start clean.
select set_config('app.session_transition', '', true);
select set_config('request.jwt.claims', json_build_object('sub', 'f9a00000-0000-4000-8000-000000000002')::text, true);
select throws_ok($$
  update public.sessions set cohort_requirement_id = (select id from req where module = 'coaching' and ordinal = 2)
   where id = 'f9a40000-0000-4000-8000-000000000001'
$$, '42501', null, 'c1. the coachee cannot move a session to another requirement');
select set_config('request.jwt.claims', json_build_object('sub', 'f9a00000-0000-4000-8000-000000000001')::text, true);
select throws_ok($$
  update public.sessions set cohort_requirement_id = (select id from req where module = 'coaching' and ordinal = 2)
   where id = 'f9a40000-0000-4000-8000-000000000001'
$$, '42501', null, 'c2. nor can the Coach');
select throws_ok($$
  update public.sessions set cohort_id = null where id = 'f9a40000-0000-4000-8000-000000000001'
$$, '42501', null, 'c3. nor detach it from its cohort');
select lives_ok($$
  update public.sessions set coach_notes = 'Still the Coach''s to write' where id = 'f9a40000-0000-4000-8000-000000000001'
$$, 'c4. the Coach still writes their own notes');
select is(
  (select cohort_requirement_id from public.sessions where id = 'f9a40000-0000-4000-8000-000000000001'),
  (select id from req where module = 'coaching' and ordinal = 1), 'c5. the session still fulfils Coaching 1');

-- ---------------------------------------------------------------------------
-- d. No Peer or Triad booking in the past
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', 'f9a00000-0000-4000-8000-000000000002')::text, true);
select throws_ok($$
  select public.book_coachee_peer_session('f9a00000-0000-4000-8000-000000000003', 'f9a30000-0000-4000-8000-000000000002',
    'Backdated', now() - interval '2 days', 60, null)
$$, '22023', 'A session cannot be booked in the past', 'd1. book_coachee_peer_session refuses a past start');

select set_config('request.jwt.claims', json_build_object('sub', 'f9a00000-0000-4000-8000-000000000005')::text, true);
select throws_ok($$
  select public.book_peer_session('f9a00000-0000-4000-8000-000000000001', 'f9a30000-0000-4000-8000-000000000005',
    'Backdated', now() - interval '2 days', 30, null)
$$, '22023', 'A session cannot be booked in the past', 'd2. book_peer_session refuses a past start');

select set_config('request.jwt.claims', json_build_object('sub', 'f9a00000-0000-4000-8000-000000000006')::text, true);
select throws_ok($$
  select public.learner_triad_schedule_session((select id from grp where name = 'FG'), now() - interval '2 days', now() - interval '2 days' + interval '1 hour')
$$, '22023', 'A session cannot be booked in the past', 'd3. learner_triad_schedule_session refuses a past start');
select set_config('request.jwt.claims', json_build_object('sub', 'f9a00000-0000-4000-8000-000000000002')::text, true);
insert into tri select public.learner_triad_schedule_session((select id from grp where name = 'AB'),
  now() + interval '5 days', now() + interval '5 days 1 hour');
select throws_ok($$
  select public.learner_triad_propose_alternative((select id from tri), now() - interval '1 day', now() - interval '1 day' + interval '1 hour')
$$, '22023', 'A session cannot be booked in the past', 'd4. learner_triad_propose_alternative refuses a past start');
reset role;
select throws_ok($$
  select public.triad_create_group_internal(
    (select id from req where module = 'triads' and ordinal = 2),
    array['f9a30000-0000-4000-8000-000000000002', 'f9a30000-0000-4000-8000-000000000003']::uuid[], 'en', 'admin',
    now() - interval '2 days', now() - interval '2 days' + interval '1 hour')
$$, '22023', 'A session cannot be booked in the past', 'd5. a Triad group is not created with a past session time');

select * from finish();
rollback;
