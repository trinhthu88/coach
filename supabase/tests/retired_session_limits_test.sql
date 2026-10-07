-- Retired session limits (20261006110000_retire_session_limits).
--
-- 20261005130000 made programme_modules.config required_units, through the
-- cohort's requirements, the only answer to "how many Coaching sessions".
-- enforce_coach_as_coachee_limit() still counted completed sessions against
-- config.receive_limit (Coaching) / monthly_limit (Peer) on every status
-- change, so with receive_limit = required_units the learner could not
-- complete their last required session.
--
--   a. The Coach completes every required unit, whatever receive_limit says.
--   b. The trigger and the limit readers are gone.
--   d. An Admin raises Coaching / Mentoring units above a stored receive_limit /
--      give_limit (validate_programme_module_config no longer checks them).
--   c. The Peer practice entitlement (monthly_limit) is still enforced at
--      booking, by assert_peer_session_bookable_internal.
begin;
select plan(13);

-- ---------------------------------------------------------------------------
-- Fixture
-- ---------------------------------------------------------------------------
-- 01 Coach K (cohort pool, Peer opt-in)   02 learner A
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_user_meta_data, created_at, updated_at, confirmation_token, email_change_token_new, recovery_token)
select ('f9d00000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid,
  '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated',
  'limits-' || n || '@example.test', 'test', now(),
  jsonb_build_object('full_name', 'Limits Person ' || n), now(), now(), '', '', ''
from generate_series(1, 2) n;

insert into public.user_roles (user_id, role) values
  ('f9d00000-0000-4000-8000-000000000001', 'coach'),
  ('f9d00000-0000-4000-8000-000000000002', 'coachee')
on conflict do nothing;
update public.profiles set status = 'active'::public.user_status where id::text like 'f9d00000-%';
insert into public.coach_profiles (id, approval_status, peer_coaching_opt_in) values
  ('f9d00000-0000-4000-8000-000000000001', 'active', true)
on conflict (id) do update set approval_status = 'active', peer_coaching_opt_in = true;

-- Two required Coaching units and a legacy receive_limit of 2; Peer practice
-- capped at one session.
insert into public.programmes (id, name) values
  ('f9d10000-0000-4000-8000-000000000001', 'Limits Programme');
insert into public.programme_modules (programme_id, module, enabled, config) values
  ('f9d10000-0000-4000-8000-000000000001', 'coaching', true, '{"required": true, "required_units": 2, "receive_limit": 2}'),
  ('f9d10000-0000-4000-8000-000000000001', 'peer_coaching', true, '{"monthly_limit": 1}');
insert into public.cohorts (id, name, programme_id, start_date, end_date) values
  ('f9d20000-0000-4000-8000-000000000001', 'Limits Cohort', 'f9d10000-0000-4000-8000-000000000001',
   current_date - 30, current_date + 200);
-- Both Coaching requirements are due in 5 days: open since 9 days ago, so a
-- session held this week fulfils them.
update public.cohort_requirement_dates
   set due_on = current_date + 5, is_overridden = true,
       generation_method = 'manual', materialized_via = 'admin_save'
 where cohort_id = 'f9d20000-0000-4000-8000-000000000001';
insert into public.cohort_coach_assignments (cohort_id, coach_id) values
  ('f9d20000-0000-4000-8000-000000000001', 'f9d00000-0000-4000-8000-000000000001');
insert into public.programme_enrollments (id, programme_id, user_id, cohort_id, status, start_date, end_date) values
  ('f9d30000-0000-4000-8000-000000000002', 'f9d10000-0000-4000-8000-000000000001',
   'f9d00000-0000-4000-8000-000000000002', 'f9d20000-0000-4000-8000-000000000001', 'active', current_date - 30, current_date + 200);
insert into public.coachee_goals (coachee_id, enrollment_id, title) values
  ('f9d00000-0000-4000-8000-000000000002', 'f9d30000-0000-4000-8000-000000000002', 'Limits goal');

-- Both Coaching units held with Coach K and confirmed: one 2 days ago, one
-- yesterday. One Peer practice session with Coach K, pending.
select set_config('app.session_transition', 'on', true);
insert into public.sessions (id, enrollment_id, cohort_requirement_id, coach_id, coachee_id, topic,
  start_time, duration_minutes, status)
select ('f9d40000-0000-4000-8000-00000000000' || r.ordinal)::uuid, 'f9d30000-0000-4000-8000-000000000002', r.id,
  'f9d00000-0000-4000-8000-000000000001', 'f9d00000-0000-4000-8000-000000000002',
  'Limits ' || r.ordinal, now() - ((3 - r.ordinal) || ' days')::interval, 60, 'confirmed'
from public.cohort_requirement_dates r
where r.cohort_id = 'f9d20000-0000-4000-8000-000000000001' and r.module = 'coaching';
insert into public.peer_sessions (id, peer_coach_id, peer_coachee_id, enrollment_id, topic, start_time, duration_minutes, status)
values ('f9d40000-0000-4000-8000-0000000000a1', 'f9d00000-0000-4000-8000-000000000001',
        'f9d00000-0000-4000-8000-000000000002', 'f9d30000-0000-4000-8000-000000000002',
        'Practice', now() + interval '5 days', 30, 'pending_coach_approval');
select set_config('app.session_transition', '', true);

-- ---------------------------------------------------------------------------
-- a. Every required unit can be completed
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'f9d00000-0000-4000-8000-000000000001')::text, true);
select lives_ok($$select public.complete_coaching_session('f9d40000-0000-4000-8000-000000000001')$$,
  'a1. the Coach completes Coaching 1');
select set_config('app.session_transition', '', true);
select lives_ok($$select public.complete_coaching_session('f9d40000-0000-4000-8000-000000000002')$$,
  'a2. the Coach completes Coaching 2, the last required unit, although receive_limit is 2');
reset role;
select is(
  (select completed_units from public.canonical_module_progress('f9d30000-0000-4000-8000-000000000002', current_date)
    where module = 'coaching'),
  2, 'a3. both units count as completed');

-- ---------------------------------------------------------------------------
-- b. The limit enforcement and its readers are gone
-- ---------------------------------------------------------------------------
select hasnt_trigger('public', 'sessions', 'trg_enforce_coach_as_coachee_limit_sessions',
  'b1. no session-limit trigger on Coaching');
select hasnt_trigger('public', 'peer_sessions', 'trg_enforce_coach_as_coachee_limit_peer',
  'b2. no session-limit trigger on Peer');
select hasnt_function('public', 'enforce_coach_as_coachee_limit', array[]::text[],
  'b3. the trigger function is dropped');
select hasnt_function('public', 'get_coachee_session_usage_for_enrollment', array['uuid'],
  'b4. the Coaching session-limit reader is dropped');
select hasnt_function('public', 'check_mentoring_given_usage', array['uuid'],
  'b5. the Mentor give-limit reader is dropped');
select hasnt_function('public', 'get_mentoring_given_usage', array['uuid'],
  'b6. ... with the function behind it');

-- ---------------------------------------------------------------------------
-- c. The Peer practice entitlement still holds at booking
-- ---------------------------------------------------------------------------
select throws_ok($$insert into public.peer_sessions (peer_coach_id, peer_coachee_id, enrollment_id, topic, start_time, duration_minutes, status)
  values ('f9d00000-0000-4000-8000-000000000001', 'f9d00000-0000-4000-8000-000000000002',
          'f9d30000-0000-4000-8000-000000000002', 'Practice 2', now() + interval '9 days', 30, 'pending_coach_approval')$$,
  '42501', 'Peer coaching entitlement has been exhausted',
  'c1. a second Peer practice booking over monthly_limit 1 is refused');
select set_config('app.session_transition', 'on', true);
select lives_ok($$update public.peer_sessions set status = 'cancelled' where id = 'f9d40000-0000-4000-8000-0000000000a1'$$,
  'c2. cancelling Peer practice is a status change like any other');

-- ---------------------------------------------------------------------------
-- d. A stored Coaching / Mentoring limit does not cap the requirement
-- ---------------------------------------------------------------------------
reset role;
select lives_ok($$update public.programme_modules
    set config = '{"required": true, "required_units": 3, "receive": true, "receive_limit": 2}'
  where programme_id = 'f9d10000-0000-4000-8000-000000000001' and module = 'coaching'$$,
  'd1. Coaching required_units is raised above an old receive_limit');
select lives_ok($$insert into public.programme_modules (programme_id, module, enabled, config)
  values ('f9d10000-0000-4000-8000-000000000001', 'mentoring', true,
          '{"required": true, "required_units": 2, "give": true, "give_limit": 1}')$$,
  'd2. Mentoring required_units is set above an old give_limit');

select * from finish();
rollback;
