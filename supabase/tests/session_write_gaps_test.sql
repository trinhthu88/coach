-- Session write gaps (20261007000700_session_write_gaps; Prompt 12: B5-B7,
-- P-1 leftovers).
--
--   g. book_peer_session validates p_slot_id: it exists, is the peer Coach's,
--      is a Peer slot, is not booked, and the booked time lies inside it.
--   h. sync_coaching_slot_reservation / sync_mentoring_slot_reservation
--      reserve only the session's own Coach's / Mentor's slot.
--   s. slot_id is a protected field on the four session tables.
--   i. No DELETE on the four session tables, no INSERT / UPDATE / DELETE on
--      triad_sessions, no TRUNCATE on any of them; "admin manage" reads only.
--   j. The coach_profiles guard covers is_featured and last_approved_at, on
--      INSERT as well as UPDATE.
--   k. The *_without_requirement() diagnostics are not client-callable.
--   l. The mentoring prep file is recorded by an RPC stamped with now().
begin;
select plan(40);

-- ---------------------------------------------------------------------------
-- Fixture
-- ---------------------------------------------------------------------------
-- 01 Coach K (Peer, Coach and Mentor of cohort C)   02 learner A   03 learner B
-- 04 Admin   05 learner D (coach-to-coach Peer)   06 Coach J   07 Coach X (no profile yet)
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_user_meta_data, created_at, updated_at, confirmation_token, email_change_token_new, recovery_token)
select ('b7e00000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid,
  '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated',
  'writegap-' || n || '@example.test', 'test', now(),
  jsonb_build_object('full_name', 'WriteGap Person ' || n), now(), now(), '', '', ''
from generate_series(1, 7) n;
insert into public.user_roles (user_id, role) values
  ('b7e00000-0000-4000-8000-000000000001', 'coach'), ('b7e00000-0000-4000-8000-000000000002', 'coachee'),
  ('b7e00000-0000-4000-8000-000000000003', 'coachee'), ('b7e00000-0000-4000-8000-000000000004', 'admin'),
  ('b7e00000-0000-4000-8000-000000000005', 'coachee'), ('b7e00000-0000-4000-8000-000000000006', 'coach'),
  ('b7e00000-0000-4000-8000-000000000007', 'coach')
on conflict do nothing;
update public.profiles set status = 'active'::public.user_status, peer_coaching_opt_in = true
 where id::text like 'b7e00000-%';
insert into public.coach_profiles (id, approval_status, peer_coaching_opt_in)
select c, 'active', true from unnest(array['b7e00000-0000-4000-8000-000000000001', 'b7e00000-0000-4000-8000-000000000006']::uuid[]) c
on conflict (id) do update set approval_status = 'active', peer_coaching_opt_in = true;
delete from public.coach_profiles where id = 'b7e00000-0000-4000-8000-000000000007';
insert into public.mentor_profiles (coach_user_id, is_active)
values ('b7e00000-0000-4000-8000-000000000001', true) on conflict do nothing;

insert into public.programmes (id, name) values
  ('b7e10000-0000-4000-8000-000000000001', 'WriteGap Programme'),
  ('b7e10000-0000-4000-8000-000000000002', 'WriteGap coach-to-coach Programme');
insert into public.programme_modules (programme_id, module, enabled, config) values
  ('b7e10000-0000-4000-8000-000000000001', 'coaching', true, '{"required": true, "required_units": 3}'),
  ('b7e10000-0000-4000-8000-000000000001', 'mentoring', true, '{"required": true, "required_units": 2}'),
  ('b7e10000-0000-4000-8000-000000000001', 'peer_coaching', true, '{"required": true, "required_units": 2, "monthly_limit": 20}'),
  ('b7e10000-0000-4000-8000-000000000002', 'peer_coaching', true, '{"monthly_limit": 9}');
insert into public.cohorts (id, name, programme_id, start_date, end_date) values
  ('b7e20000-0000-4000-8000-000000000001', 'WriteGap Cohort', 'b7e10000-0000-4000-8000-000000000001',
   current_date - 30, current_date + 200);
update public.cohort_requirement_dates
   set due_on = current_date + 10 + ordinal * 30, is_overridden = true,
       generation_method = 'manual', materialized_via = 'admin_save'
 where cohort_id = 'b7e20000-0000-4000-8000-000000000001';
insert into public.programme_enrollments (id, programme_id, user_id, cohort_id, status, start_date, end_date) values
  ('b7e30000-0000-4000-8000-000000000002', 'b7e10000-0000-4000-8000-000000000001',
   'b7e00000-0000-4000-8000-000000000002', 'b7e20000-0000-4000-8000-000000000001', 'active', current_date - 30, current_date + 200),
  ('b7e30000-0000-4000-8000-000000000003', 'b7e10000-0000-4000-8000-000000000001',
   'b7e00000-0000-4000-8000-000000000003', 'b7e20000-0000-4000-8000-000000000001', 'active', current_date - 30, current_date + 200),
  ('b7e30000-0000-4000-8000-000000000005', 'b7e10000-0000-4000-8000-000000000002',
   'b7e00000-0000-4000-8000-000000000005', null, 'active', current_date - 30, null);
insert into public.coachee_goals (coachee_id, enrollment_id, title)
select e.user_id, e.id, 'Booking gate goal' from public.programme_enrollments e where e.id::text like 'b7e30000-%';

create temporary table req (module text, ordinal integer, id uuid);
insert into req select d.module::text, d.ordinal, d.id from public.cohort_requirement_dates d
 where d.cohort_id = 'b7e20000-0000-4000-8000-000000000001';
grant select on req to authenticated;

insert into public.cohort_coach_assignments (cohort_id, coach_id)
values ('b7e20000-0000-4000-8000-000000000001', 'b7e00000-0000-4000-8000-000000000001');
insert into public.cohort_mentors (cohort_id, mentor_user_id)
values ('b7e20000-0000-4000-8000-000000000001', 'b7e00000-0000-4000-8000-000000000001');

select set_config('request.jwt.claims', json_build_object('sub', 'b7e00000-0000-4000-8000-000000000004')::text, true);
select public.admin_create_peer_dyad(
  'b7e20000-0000-4000-8000-000000000001', 'b7e10000-0000-4000-8000-000000000001',
  'b7e30000-0000-4000-8000-000000000002', 'b7e30000-0000-4000-8000-000000000003');

-- Availability, five days out (wall-clock Vietnam time, as Coaches enter it).
create temporary table slots (name text primary key, id uuid);
grant select on slots to authenticated;
insert into slots values
  ('k_peer', 'b7e50000-0000-4000-8000-000000000001'), ('k_coaching', 'b7e50000-0000-4000-8000-000000000002'),
  ('k_peer_booked', 'b7e50000-0000-4000-8000-000000000003'), ('j_peer', 'b7e50000-0000-4000-8000-000000000004'),
  ('j_coaching', 'b7e50000-0000-4000-8000-000000000005'), ('j_mentoring', 'b7e50000-0000-4000-8000-000000000006'),
  ('k_coaching_2', 'b7e50000-0000-4000-8000-000000000007');
insert into public.coach_availability (id, coach_id, slot_date, start_time, end_time, slot_type, is_booked) values
  ('b7e50000-0000-4000-8000-000000000001', 'b7e00000-0000-4000-8000-000000000001', public.programme_today() + 5, '09:00', '11:00', 'peer', false),
  ('b7e50000-0000-4000-8000-000000000002', 'b7e00000-0000-4000-8000-000000000001', public.programme_today() + 5, '09:00', '11:00', 'coaching', false),
  ('b7e50000-0000-4000-8000-000000000003', 'b7e00000-0000-4000-8000-000000000001', public.programme_today() + 5, '15:00', '16:00', 'peer', true),
  ('b7e50000-0000-4000-8000-000000000004', 'b7e00000-0000-4000-8000-000000000006', public.programme_today() + 5, '09:00', '11:00', 'peer', false),
  ('b7e50000-0000-4000-8000-000000000005', 'b7e00000-0000-4000-8000-000000000006', public.programme_today() + 6, '09:00', '10:00', 'coaching', false),
  ('b7e50000-0000-4000-8000-000000000006', 'b7e00000-0000-4000-8000-000000000006', public.programme_today() + 6, '09:00', '10:00', 'mentoring', false),
  ('b7e50000-0000-4000-8000-000000000007', 'b7e00000-0000-4000-8000-000000000001', public.programme_today() + 6, '12:00', '13:00', 'coaching', false);
-- The instant a wall-clock time on the slot day stands for.
create or replace function pg_temp.at_slot(p_hhmm text, p_days integer default 5) returns timestamptz
language sql stable as $$
  select (public.programme_today() + p_days + p_hhmm::time)
         at time zone public.availability_slot_time_zone('b7e00000-0000-4000-8000-000000000001')
$$;

-- Trusted SQL: a pending Coaching and Mentoring session of A with K.
select set_config('app.session_transition', 'on', true);
insert into public.sessions (id, enrollment_id, cohort_requirement_id, coach_id, coachee_id, topic, start_time, duration_minutes, status)
values ('b7e40000-0000-4000-8000-000000000001', 'b7e30000-0000-4000-8000-000000000002',
        (select id from req where module = 'coaching' and ordinal = 1),
        'b7e00000-0000-4000-8000-000000000001', 'b7e00000-0000-4000-8000-000000000002',
        'Coaching', now() + interval '7 days', 60, 'pending_coach_approval');
insert into public.mentoring_sessions (id, enrollment_id, cohort_requirement_id, mentor_id, mentee_id, topic, start_time, duration_minutes, status)
values ('b7e40000-0000-4000-8000-000000000002', 'b7e30000-0000-4000-8000-000000000002',
        (select id from req where module = 'mentoring' and ordinal = 1),
        'b7e00000-0000-4000-8000-000000000001', 'b7e00000-0000-4000-8000-000000000002',
        'Mentoring', now() + interval '8 days', 60, 'pending_coach_approval');
select set_config('app.session_transition', '', true);

-- ===========================================================================
-- g. book_peer_session validates the slot
-- ===========================================================================
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'b7e00000-0000-4000-8000-000000000005')::text, true);
select throws_ok($$select public.book_peer_session('b7e00000-0000-4000-8000-000000000001', 'b7e30000-0000-4000-8000-000000000005',
  'No slot', pg_temp.at_slot('09:30'), 60, gen_random_uuid())$$,
  '23503', null, 'g1. a slot that does not exist is refused');
select throws_ok($$select public.book_peer_session('b7e00000-0000-4000-8000-000000000001', 'b7e30000-0000-4000-8000-000000000005',
  'J''s slot', pg_temp.at_slot('09:30'), 60, (select id from slots where name = 'j_peer'))$$,
  '42501', null, 'g2. another Coach''s slot is refused');
reset role;
select ok(exists (select 1 from public.coach_availability where id = (select id from slots where name = 'j_peer')),
  'g3. ... and that Coach''s slot is left alone (a booking deletes the slot it carries)');
set local role authenticated;
select throws_ok($$select public.book_peer_session('b7e00000-0000-4000-8000-000000000001', 'b7e30000-0000-4000-8000-000000000005',
  'Coaching slot', pg_temp.at_slot('09:30'), 60, (select id from slots where name = 'k_coaching'))$$,
  '23514', null, 'g4. a Coaching slot is not a Peer slot');
select throws_ok($$select public.book_peer_session('b7e00000-0000-4000-8000-000000000001', 'b7e30000-0000-4000-8000-000000000005',
  'Booked slot', pg_temp.at_slot('15:00'), 60, (select id from slots where name = 'k_peer_booked'))$$,
  '23505', null, 'g5. a booked slot is refused');
select throws_ok($$select public.book_peer_session('b7e00000-0000-4000-8000-000000000001', 'b7e30000-0000-4000-8000-000000000005',
  'Late start', pg_temp.at_slot('10:30'), 60, (select id from slots where name = 'k_peer'))$$,
  '23514', null, 'g6. a time that does not fit inside the slot is refused');
select lives_ok($$select public.book_peer_session('b7e00000-0000-4000-8000-000000000001', 'b7e30000-0000-4000-8000-000000000005',
  'Peer practice', pg_temp.at_slot('09:30'), 60, (select id from slots where name = 'k_peer'))$$,
  'g7. K''s own Peer slot, inside its window, books');

-- ===========================================================================
-- s. slot_id is protected on all four session tables
-- ===========================================================================
select throws_ok($$update public.peer_sessions set slot_id = (select id from slots where name = 'j_peer')
  where peer_coachee_id = 'b7e00000-0000-4000-8000-000000000005'$$,
  '42501', null, 's1. the Peer learner cannot move their session onto another slot');
select set_config('request.jwt.claims', json_build_object('sub', 'b7e00000-0000-4000-8000-000000000002')::text, true);
select lives_ok($$select public.book_coachee_peer_session('b7e00000-0000-4000-8000-000000000003', 'b7e30000-0000-4000-8000-000000000002',
  'Dyad practice', now() + interval '3 days', 60, null)$$, 'fixture: A books B for Peer practice');
select throws_ok($$update public.coachee_peer_sessions set slot_id = gen_random_uuid()
  where enrollment_id = 'b7e30000-0000-4000-8000-000000000002'$$,
  '42501', null, 's2. ... nor a Peer receiver theirs');
select throws_ok($$update public.sessions set slot_id = (select id from slots where name = 'k_coaching_2')
  where id = 'b7e40000-0000-4000-8000-000000000001'$$,
  '42501', null, 's3. ... nor a Coaching learner theirs');
select throws_ok($$update public.mentoring_sessions set slot_id = gen_random_uuid()
  where id = 'b7e40000-0000-4000-8000-000000000002'$$,
  '42501', null, 's4. ... nor a mentee theirs');

-- ===========================================================================
-- h. Slot reservation holds only the session's own Coach's / Mentor's slot
-- ===========================================================================
reset role;
select set_config('app.session_transition', 'on', true);
select throws_ok($$insert into public.sessions (enrollment_id, cohort_requirement_id, coach_id, coachee_id, topic, start_time, duration_minutes, status, slot_id)
  values ('b7e30000-0000-4000-8000-000000000002', (select id from req where module = 'coaching' and ordinal = 2),
          'b7e00000-0000-4000-8000-000000000001', 'b7e00000-0000-4000-8000-000000000002',
          'On J''s slot', pg_temp.at_slot('09:00', 6), 60, 'pending_coach_approval', (select id from slots where name = 'j_coaching'))$$,
  '42501', null, 'h1. a Coaching session with K cannot hold J''s slot');
select is((select is_booked from public.coach_availability where id = (select id from slots where name = 'j_coaching')),
  false, 'h2. ... J''s slot stays free');
select throws_ok($$insert into public.mentoring_sessions (enrollment_id, cohort_requirement_id, mentor_id, mentee_id, topic, start_time, duration_minutes, status, slot_id)
  values ('b7e30000-0000-4000-8000-000000000002', (select id from req where module = 'mentoring' and ordinal = 2),
          'b7e00000-0000-4000-8000-000000000001', 'b7e00000-0000-4000-8000-000000000002',
          'On J''s slot', pg_temp.at_slot('09:00', 6), 60, 'pending_coach_approval', (select id from slots where name = 'j_mentoring'))$$,
  '42501', null, 'h3. a Mentoring session with K cannot hold J''s slot');
select lives_ok($$insert into public.sessions (enrollment_id, cohort_requirement_id, coach_id, coachee_id, topic, start_time, duration_minutes, status, slot_id)
  values ('b7e30000-0000-4000-8000-000000000002', (select id from req where module = 'coaching' and ordinal = 2),
          'b7e00000-0000-4000-8000-000000000001', 'b7e00000-0000-4000-8000-000000000002',
          'On K''s slot', pg_temp.at_slot('12:00', 6), 60, 'pending_coach_approval', (select id from slots where name = 'k_coaching_2'))$$,
  'h4. K''s own slot is held as before');
select is((select is_booked from public.coach_availability where id = (select id from slots where name = 'k_coaching_2')),
  true, 'h5. ... and reserved');
select set_config('app.session_transition', '', true);

-- ===========================================================================
-- i. Grants and the "admin manage" policies
-- ===========================================================================
select ok(not exists (
  select 1 from unnest(array['sessions', 'mentoring_sessions', 'peer_sessions', 'coachee_peer_sessions']) t, unnest(array['authenticated', 'anon']) r
  where has_table_privilege(r, 'public.' || t, 'DELETE')),
  'i1. no client role holds DELETE on the four session tables');
select ok(not exists (
  select 1 from unnest(array['INSERT', 'UPDATE', 'DELETE']) p, unnest(array['authenticated', 'anon']) r
  where has_table_privilege(r, 'public.triad_sessions', p)),
  'i2. no client role writes triad_sessions');
select ok(not exists (
  select 1 from unnest(array['sessions', 'mentoring_sessions', 'peer_sessions', 'coachee_peer_sessions', 'triad_sessions']) t,
                unnest(array['authenticated', 'anon']) r
  where has_table_privilege(r, 'public.' || t, 'TRUNCATE')),
  'i3. ... and none can TRUNCATE any of the five (TRUNCATE ignores RLS)');
select is((select string_agg(tablename || ': ' || cmd, ', ' order by tablename) from pg_policies
            where schemaname = 'public' and policyname::text ~* 'admin manage$'
              and tablename in ('sessions', 'mentoring_sessions', 'peer_sessions', 'coachee_peer_sessions', 'triad_sessions')),
  'coachee_peer_sessions: SELECT, mentoring_sessions: SELECT, peer_sessions: SELECT, sessions: SELECT, triad_sessions: SELECT',
  'i4. each "admin manage" policy reads only');
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'b7e00000-0000-4000-8000-000000000004')::text, true);
select throws_ok($$delete from public.sessions where id = 'b7e40000-0000-4000-8000-000000000001'$$,
  '42501', null, 'i5. not even an Admin deletes a session row');
select is((select count(*)::int from public.sessions where id = 'b7e40000-0000-4000-8000-000000000001'),
  1, 'i6. an Admin still reads it');

-- ===========================================================================
-- j. coach_profiles: is_featured and last_approved_at, on INSERT too
-- ===========================================================================
reset role;
select ok((select pg_get_triggerdef(oid) ~ 'BEFORE INSERT OR UPDATE' from pg_trigger
            where tgrelid = 'public.coach_profiles'::regclass and tgname = 'guard_coach_profile_protected_fields'),
  'j1. the guard runs BEFORE INSERT OR UPDATE');
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'b7e00000-0000-4000-8000-000000000007')::text, true);
select throws_ok($$insert into public.coach_profiles (id, approval_status) values ('b7e00000-0000-4000-8000-000000000007', 'active')$$,
  '42501', null, 'j2. a Coach cannot create their profile already approved');
select throws_ok($$insert into public.coach_profiles (id, is_featured) values ('b7e00000-0000-4000-8000-000000000007', true)$$,
  '42501', null, 'j3. ... nor featured');
select throws_ok($$insert into public.coach_profiles (id, last_approved_at) values ('b7e00000-0000-4000-8000-000000000007', now())$$,
  '42501', null, 'j4. ... nor with an approval date');
select lives_ok($$insert into public.coach_profiles (id) values ('b7e00000-0000-4000-8000-000000000007')$$,
  'j5. a Coach creates their own profile with the defaults');
select throws_ok($$update public.coach_profiles set is_featured = true where id = 'b7e00000-0000-4000-8000-000000000007'$$,
  '42501', null, 'j6. a Coach cannot feature themself');
select throws_ok($$update public.coach_profiles set last_approved_at = now() where id = 'b7e00000-0000-4000-8000-000000000007'$$,
  '42501', null, 'j7. ... nor set their approval date');
select lives_ok($$update public.coach_profiles set peer_coaching_opt_in = true where id = 'b7e00000-0000-4000-8000-000000000007'$$,
  'j8. ... but still edits their own unprotected fields');
select set_config('request.jwt.claims', json_build_object('sub', 'b7e00000-0000-4000-8000-000000000004')::text, true);
select lives_ok($$update public.coach_profiles set is_featured = true where id = 'b7e00000-0000-4000-8000-000000000007'$$,
  'j9. an Admin features a Coach');

-- ===========================================================================
-- k. The orphan diagnostics are not client-callable
-- ===========================================================================
reset role;
select ok(not exists (
  select 1 from unnest(array['coaching_sessions_without_requirement()', 'mentoring_sessions_without_requirement()',
                             'peer_participants_without_requirement()']) f, unnest(array['authenticated', 'anon']) r
  where has_function_privilege(r, 'public.' || f, 'EXECUTE')),
  'k1. no client role runs the three *_without_requirement() diagnostics');
select ok(has_function_privilege('service_role', 'public.coaching_sessions_without_requirement()', 'EXECUTE')
  and has_function_privilege('service_role', 'public.mentoring_sessions_without_requirement()', 'EXECUTE')
  and has_function_privilege('service_role', 'public.peer_participants_without_requirement()', 'EXECUTE'),
  'k2. the service role still does');

-- ===========================================================================
-- l. The mentoring prep file: an RPC stamped with now()
-- ===========================================================================
insert into storage.objects (bucket_id, name, owner_id, metadata) values
  ('mentoring-prep-files', 'b7e40000-0000-4000-8000-000000000002/prep.pdf', 'b7e00000-0000-4000-8000-000000000002',
   '{"mimetype": "application/pdf", "size": 1000}');
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'b7e00000-0000-4000-8000-000000000002')::text, true);
select throws_ok($$update public.mentoring_sessions set prep_file_path = 'b7e40000-0000-4000-8000-000000000002/prep.pdf',
  prep_file_submitted_at = now() - interval '10 days' where id = 'b7e40000-0000-4000-8000-000000000002'$$,
  '42501', null, 'l1. the mentee cannot write the prep file (or back-date it) at the table');
select set_config('request.jwt.claims', json_build_object('sub', 'b7e00000-0000-4000-8000-000000000001')::text, true);
select throws_ok($$select public.learner_submit_mentoring_prep_file('b7e40000-0000-4000-8000-000000000002',
  'b7e40000-0000-4000-8000-000000000002/prep.pdf', null)$$,
  '42501', null, 'l2. only the mentee submits the prep file');
select set_config('request.jwt.claims', json_build_object('sub', 'b7e00000-0000-4000-8000-000000000002')::text, true);
select throws_ok($$select public.learner_submit_mentoring_prep_file('b7e40000-0000-4000-8000-000000000002',
  'b7e40000-0000-4000-8000-000000000001/prep.pdf', null)$$,
  '22023', null, 'l3. the file is under this session''s folder');
select throws_ok($$select public.learner_submit_mentoring_prep_file('b7e40000-0000-4000-8000-000000000002',
  'b7e40000-0000-4000-8000-000000000002/never-uploaded.pdf', null)$$,
  '22023', null, 'l4. ... and was uploaded by the mentee');
select is(public.learner_submit_mentoring_prep_file('b7e40000-0000-4000-8000-000000000002',
  'b7e40000-0000-4000-8000-000000000002/prep.pdf', '  Questions for K  '), now(),
  'l5. the mentee submits it; the RPC returns the server time');
reset role;
select results_eq($$select prep_file_path, prep_file_notes, prep_file_submitted_at from public.mentoring_sessions
                     where id = 'b7e40000-0000-4000-8000-000000000002'$$,
  $$values ('b7e40000-0000-4000-8000-000000000002/prep.pdf'::text, 'Questions for K'::text, now())$$,
  'l6. path, trimmed notes and the server''s timestamp are recorded');

select * from finish();
rollback;
