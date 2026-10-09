-- Audit 8 Oct, Part A (20261008200000_audit_high_findings; Prompt 16 Part A).
--
--   H3. coach_public_delivered_sessions(): the held Coaching a learner sees per
--       Coach is the reported count (reported_held_sessions_internal, demo
--       excluded) -- the same number Admin -> Registrations shows -- and
--       coach_profiles.sessions_completed, which nothing maintained, is gone.
--   H4. learner_current_enrollment() / admin_current_enrollments(): "current"
--       is enrollment_is_ongoing, so a paused or past-end active enrollment is
--       not current for the learner or for Admin; resolve_current_enrollment
--       is retired.
--   M1. Booking refuses a slot whose Vietnam date is after the enrollment's
--       end (else its cohort's): Coaching, Mentoring, coach-pool Peer and the
--       dyad Peer session.
begin;
select plan(22);

-- 01 Admin   02 Coach K (Coach, Mentor, Peer opt-in)   03 learner A (ongoing,
-- own end date in 10 days)   04 learner P (paused)   05 learner E (active,
-- ended yesterday)   06 learner D (demo organisation)   07 learner B (ongoing,
-- no own end date: the cohort's applies; A's dyad partner)
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_user_meta_data, created_at, updated_at, confirmation_token, email_change_token_new, recovery_token)
select ('a16a0000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid,
  '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated',
  'audit16a-' || n || '@example.test', 'test', now(),
  jsonb_build_object('full_name', 'Audit Person ' || n), now(), now(), '', '', ''
from generate_series(1, 7) n;
insert into public.user_roles (user_id, role)
select ('a16a0000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid,
  (case n when 1 then 'admin' when 2 then 'coach' else 'coachee' end)::public.app_role
from generate_series(1, 7) n
on conflict do nothing;
update public.profiles set status = 'active'::public.user_status, peer_coaching_opt_in = true where id::text like 'a16a0000-%';
insert into public.coach_profiles (id, approval_status, peer_coaching_opt_in) values ('a16a0000-0000-4000-8000-000000000002', 'active', true)
on conflict (id) do update set approval_status = 'active', peer_coaching_opt_in = true;
insert into public.mentor_profiles (coach_user_id, is_active) values ('a16a0000-0000-4000-8000-000000000002', true) on conflict do nothing;
insert into public.organizations (id, name, is_demo) values
  ('a16a5000-0000-4000-8000-000000000001', 'Audit Real Org', false),
  ('a16a5000-0000-4000-8000-000000000002', 'Audit Demo Org', true);

-- Programme: two Coaching units, one Mentoring, one Peer (dyad; coach-pool
-- practice allowed). Cohort: 30 days ago to 60 days ahead.
insert into public.programmes (id, name) values ('a16a1000-0000-4000-8000-000000000001', 'Audit Programme');
insert into public.programme_modules (programme_id, module, enabled, config) values
  ('a16a1000-0000-4000-8000-000000000001', 'coaching', true, '{"required": true, "required_units": 2}'),
  ('a16a1000-0000-4000-8000-000000000001', 'mentoring', true, '{"required": true, "required_units": 1}'),
  ('a16a1000-0000-4000-8000-000000000001', 'peer_coaching', true, '{"required": true, "required_units": 1, "monthly_limit": 9}');
insert into public.cohorts (id, name, programme_id, start_date, end_date) values
  ('a16a2000-0000-4000-8000-000000000001', 'Audit Cohort', 'a16a1000-0000-4000-8000-000000000001',
   public.programme_today() - 30, public.programme_today() + 60);
update public.cohort_requirement_dates set due_on = public.programme_today() + 30,
  is_overridden = true, generation_method = 'manual', materialized_via = 'admin_save'
 where cohort_id = 'a16a2000-0000-4000-8000-000000000001';
insert into public.programme_enrollments (id, programme_id, user_id, cohort_id, organization_id, status, start_date, end_date) values
  ('a16a3000-0000-4000-8000-000000000003', 'a16a1000-0000-4000-8000-000000000001', 'a16a0000-0000-4000-8000-000000000003',
   'a16a2000-0000-4000-8000-000000000001', 'a16a5000-0000-4000-8000-000000000001', 'active', public.programme_today() - 30, public.programme_today() + 10),
  ('a16a3000-0000-4000-8000-000000000004', 'a16a1000-0000-4000-8000-000000000001', 'a16a0000-0000-4000-8000-000000000004',
   'a16a2000-0000-4000-8000-000000000001', 'a16a5000-0000-4000-8000-000000000001', 'paused', public.programme_today() - 30, null),
  ('a16a3000-0000-4000-8000-000000000005', 'a16a1000-0000-4000-8000-000000000001', 'a16a0000-0000-4000-8000-000000000005',
   'a16a2000-0000-4000-8000-000000000001', 'a16a5000-0000-4000-8000-000000000001', 'active', public.programme_today() - 30, public.programme_today() - 1),
  ('a16a3000-0000-4000-8000-000000000006', 'a16a1000-0000-4000-8000-000000000001', 'a16a0000-0000-4000-8000-000000000006',
   'a16a2000-0000-4000-8000-000000000001', 'a16a5000-0000-4000-8000-000000000002', 'active', public.programme_today() - 30, null),
  ('a16a3000-0000-4000-8000-000000000007', 'a16a1000-0000-4000-8000-000000000001', 'a16a0000-0000-4000-8000-000000000007',
   'a16a2000-0000-4000-8000-000000000001', 'a16a5000-0000-4000-8000-000000000001', 'active', public.programme_today() - 30, null);
-- E's earlier, completed enrollment: history, never current.
insert into public.programmes (id, name) values ('a16a1000-0000-4000-8000-000000000002', 'Audit Earlier Programme');
insert into public.programme_enrollments (id, programme_id, user_id, organization_id, status, start_date, end_date) values
  ('a16a3000-0000-4000-8000-000000000015', 'a16a1000-0000-4000-8000-000000000002', 'a16a0000-0000-4000-8000-000000000005',
   'a16a5000-0000-4000-8000-000000000001', 'completed', public.programme_today() - 400, public.programme_today() - 200);
insert into public.coachee_goals (coachee_id, enrollment_id, title)
select e.user_id, e.id, 'Audit goal' from public.programme_enrollments e where e.id::text like 'a16a3000-%' and e.cohort_id is not null;
insert into public.cohort_coach_assignments (cohort_id, coach_id) values ('a16a2000-0000-4000-8000-000000000001', 'a16a0000-0000-4000-8000-000000000002');
insert into public.cohort_mentors (cohort_id, mentor_user_id) values ('a16a2000-0000-4000-8000-000000000001', 'a16a0000-0000-4000-8000-000000000002');
select set_config('request.jwt.claims', json_build_object('sub', 'a16a0000-0000-4000-8000-000000000001')::text, true);
select public.admin_create_peer_dyad('a16a2000-0000-4000-8000-000000000001', 'a16a1000-0000-4000-8000-000000000001',
  'a16a3000-0000-4000-8000-000000000003', 'a16a3000-0000-4000-8000-000000000007');

create temporary table req (module text, ordinal integer, id uuid);
insert into req select d.module::text, d.ordinal, d.id from public.cohort_requirement_dates d where d.cohort_id = 'a16a2000-0000-4000-8000-000000000001';
grant select on req to authenticated;

-- Held Coaching with Coach K: A (reported) and D (demo organisation, never reported).
select set_config('app.session_transition', 'on', true);
insert into public.sessions (enrollment_id, cohort_requirement_id, coach_id, coachee_id, topic, start_time, duration_minutes, status) values
  ('a16a3000-0000-4000-8000-000000000003', (select id from req where module = 'coaching' and ordinal = 1),
   'a16a0000-0000-4000-8000-000000000002', 'a16a0000-0000-4000-8000-000000000003', 'A held', now() - interval '2 days', 60, 'completed'),
  ('a16a3000-0000-4000-8000-000000000006', (select id from req where module = 'coaching' and ordinal = 1),
   'a16a0000-0000-4000-8000-000000000002', 'a16a0000-0000-4000-8000-000000000006', 'D held', now() - interval '2 days', 60, 'completed');
select set_config('app.session_transition', '', true);

-- Coach K's slots: one inside A's enrollment (day +5) and one after its end
-- but inside the cohort (day +20), per slot type; B's partner A has none.
insert into public.coach_availability (id, coach_id, slot_date, start_time, end_time, slot_type)
select ('a16a6000-0000-4000-8000-0000000000' || lpad((t.n * 10 + d.n)::text, 2, '0'))::uuid,
  'a16a0000-0000-4000-8000-000000000002', public.programme_today() + d.days, '09:00', '11:00', t.slot_type::public.availability_slot_type
from (values (1, 'coaching'), (2, 'mentoring'), (3, 'peer')) t(n, slot_type)
cross join (values (1, 5), (2, 20)) d(n, days);
create or replace function pg_temp.slot_start(p_days integer) returns timestamptz language sql stable as $$
  select (public.programme_today() + p_days + time '09:00') at time zone public.availability_slot_time_zone('a16a0000-0000-4000-8000-000000000002')
$$;
grant execute on function pg_temp.slot_start(integer) to authenticated;

-- ===========================================================================
-- H3. The Coach directory's held sessions
-- ===========================================================================
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'a16a0000-0000-4000-8000-000000000003')::text, true);
select is((select delivered_sessions from public.coach_public_delivered_sessions()
            where coach_id = 'a16a0000-0000-4000-8000-000000000002'),
  1, 'H3a. a learner sees Coach K''s held Coaching: 1 (the demo organisation''s session is not reported)');
select set_config('request.jwt.claims', json_build_object('sub', 'a16a0000-0000-4000-8000-000000000001')::text, true);
create temporary table admin_delivery as select * from public.admin_coach_delivery_summary();
select is((select delivered_sessions from public.coach_public_delivered_sessions() where coach_id = 'a16a0000-0000-4000-8000-000000000002'),
          (select delivered_sessions from admin_delivery where coach_id = 'a16a0000-0000-4000-8000-000000000002'),
  'H3b. ... the same number Admin -> Registrations shows (admin_coach_delivery_summary)');
reset role;
select ok(not has_function_privilege('anon', 'public.coach_public_delivered_sessions()', 'EXECUTE'),
  'H3c. the directory count is for signed-in users only');
select hasnt_column('public', 'coach_profiles', 'sessions_completed',
  'H3d. coach_profiles.sessions_completed, a copy nothing maintained, is dropped');

-- ===========================================================================
-- H4. The current enrollment is the ongoing one
-- ===========================================================================
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'a16a0000-0000-4000-8000-000000000003')::text, true);
select is((select enrollment_id from public.learner_current_enrollment()), 'a16a3000-0000-4000-8000-000000000003'::uuid,
  'H4a. an active enrollment inside its dates is the learner''s current enrollment');
select set_config('request.jwt.claims', json_build_object('sub', 'a16a0000-0000-4000-8000-000000000004')::text, true);
select is((select count(*)::int from public.learner_current_enrollment()), 0,
  'H4b. a PAUSED enrollment is not current (the server refuses its bookings and reminders)');
select set_config('request.jwt.claims', json_build_object('sub', 'a16a0000-0000-4000-8000-000000000005')::text, true);
select is((select count(*)::int from public.learner_current_enrollment()), 0,
  'H4c. an ACTIVE enrollment past its end date is not current; nor is the completed earlier one');
select set_config('request.jwt.claims', json_build_object('sub', 'a16a0000-0000-4000-8000-000000000003')::text, true);
select throws_ok($$select * from public.admin_current_enrollments()$$, '42501', null,
  'H4d. only an Admin reads every learner''s current enrollment');
select set_config('request.jwt.claims', json_build_object('sub', 'a16a0000-0000-4000-8000-000000000001')::text, true);
select results_eq(
  $$select user_id::text, coalesce(enrollment_id::text, '-'), coalesce(latest_enrollment_id::text, '-')
      from public.admin_current_enrollments() where user_id::text like 'a16a0000-%' and user_id::text <> 'a16a0000-0000-4000-8000-000000000006'
     order by 1$$,
  $$values ('a16a0000-0000-4000-8000-000000000003', 'a16a3000-0000-4000-8000-000000000003', 'a16a3000-0000-4000-8000-000000000003'),
           ('a16a0000-0000-4000-8000-000000000004', '-', 'a16a3000-0000-4000-8000-000000000004'),
           ('a16a0000-0000-4000-8000-000000000005', '-', 'a16a3000-0000-4000-8000-000000000005'),
           ('a16a0000-0000-4000-8000-000000000007', 'a16a3000-0000-4000-8000-000000000007', 'a16a3000-0000-4000-8000-000000000007')$$,
  'H4e. Admin''s current enrollment is the learner''s (none for paused or past-end); the latest record stays visible to manage');
reset role;
select hasnt_function('public', 'resolve_current_enrollment', array['uuid'],
  'H4f. resolve_current_enrollment (a status-only rule) is retired');
select ok(not has_function_privilege('authenticated', 'public.current_enrollment_internal(uuid, date)', 'EXECUTE'),
  'H4g. the shared construction is internal');
select ok(has_function_privilege('authenticated', 'public.learner_current_enrollment()', 'EXECUTE')
          and not has_function_privilege('anon', 'public.learner_current_enrollment()', 'EXECUTE'),
  'H4h. learner_current_enrollment is the signed-in learner''s');

-- ===========================================================================
-- M1. No slot after the enrollment ends
-- ===========================================================================
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'a16a0000-0000-4000-8000-000000000003')::text, true);
select throws_ok($$select public.book_coaching_session('a16a3000-0000-4000-8000-000000000003', 'a16a0000-0000-4000-8000-000000000002',
    'a16a6000-0000-4000-8000-000000000012', (select id from req where module = 'coaching' and ordinal = 2), 'Too late', null, null)$$,
  '23514', null, 'M1a. Coaching: a slot after the enrollment''s end date is refused');
-- 06:30 Vietnam time on A's last day + 1 is 23:30 UTC on its last day: the
-- Vietnamese date decides.
reset role;
insert into public.coach_availability (id, coach_id, slot_date, start_time, end_time, slot_type) values
  ('a16a6000-0000-4000-8000-000000000041', 'a16a0000-0000-4000-8000-000000000002', public.programme_today() + 11, '06:30', '08:00', 'coaching');
set local role authenticated;
select throws_ok($$select public.book_coaching_session('a16a3000-0000-4000-8000-000000000003', 'a16a0000-0000-4000-8000-000000000002',
    'a16a6000-0000-4000-8000-000000000041', (select id from req where module = 'coaching' and ordinal = 2), 'Early', null, null)$$,
  '23514', null, 'M1i. a slot early on the day after the end (still the end date in UTC) is refused: the Vietnamese date decides');
select lives_ok($$select public.book_coaching_session('a16a3000-0000-4000-8000-000000000003', 'a16a0000-0000-4000-8000-000000000002',
    'a16a6000-0000-4000-8000-000000000011', (select id from req where module = 'coaching' and ordinal = 2), 'In time', null, 60)$$,
  'M1b. ... a slot inside it books');
select throws_ok($$select public.book_mentoring_session('a16a3000-0000-4000-8000-000000000003', 'a16a0000-0000-4000-8000-000000000002',
    'a16a6000-0000-4000-8000-000000000022', 'Too late', null, null, null)$$,
  '23514', null, 'M1c. Mentoring: a slot after the enrollment''s end date is refused');
select lives_ok($$select public.book_mentoring_session('a16a3000-0000-4000-8000-000000000003', 'a16a0000-0000-4000-8000-000000000002',
    'a16a6000-0000-4000-8000-000000000021', 'In time', null, null, 60)$$,
  'M1d. ... a slot inside it books');
select throws_ok($$select public.book_peer_session('a16a0000-0000-4000-8000-000000000002', 'a16a3000-0000-4000-8000-000000000003',
    'Too late', pg_temp.slot_start(20), 60, 'a16a6000-0000-4000-8000-000000000032')$$,
  '23514', null, 'M1e. coach-pool Peer practice: a slot after the enrollment''s end date is refused');
select lives_ok($$select public.book_peer_session('a16a0000-0000-4000-8000-000000000002', 'a16a3000-0000-4000-8000-000000000003',
    'In time', pg_temp.slot_start(5), 60, 'a16a6000-0000-4000-8000-000000000031')$$,
  'M1f. ... a slot inside it books');
-- B has no end date of its own: the cohort's end (day +60) applies.
select set_config('request.jwt.claims', json_build_object('sub', 'a16a0000-0000-4000-8000-000000000007')::text, true);
select throws_ok($$select public.book_coachee_peer_session('a16a0000-0000-4000-8000-000000000003', 'a16a3000-0000-4000-8000-000000000007',
    'Too late', (public.programme_today() + 61 + time '09:00') at time zone public.programme_time_zone(), 60, null)$$,
  '23514', null, 'M1g. dyad Peer: a time after the COHORT''s end (no enrollment end date) is refused');
select lives_ok($$select public.book_coachee_peer_session('a16a0000-0000-4000-8000-000000000003', 'a16a3000-0000-4000-8000-000000000007',
    'Last day', (public.programme_today() + 60 + time '20:00') at time zone public.programme_time_zone(), 60, null)$$,
  'M1h. ... the cohort''s last Vietnamese day still books');
reset role;
select ok(not has_function_privilege('authenticated', 'public.assert_session_within_enrollment_internal(uuid, timestamptz)', 'EXECUTE'),
  'M1j. the end-date guard is internal');

select * from finish();
rollback;
