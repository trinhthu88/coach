-- Grants and profile guard (20261005120000_grants_and_profile_guard).
--
--   a. No canonical_*, *_internal, next_*_requirement, programme_required_units,
--      assert_enrollment_scope, resolve_current_enrollment or dashboard_summary
--      function is executable by anon or authenticated. A later migration that
--      re-creates one of them (Supabase's default privileges grant EXECUTE to
--      both) fails this suite until it revokes the grant again.
--   b. dashboard_summary is gone.
--   c. The app reads through learner_ / coach_ wrappers that check the owner.
--   d. Only an Admin or trusted SQL changes coach_profiles.max_coachee_invites,
--      approval_status, rating_avg or sessions_completed; a Coach still edits
--      the rest of their own profile, and a learner's rating still updates the
--      Coach's rating_avg (recompute_coach_rating).
begin;
select plan(29);

-- ---------------------------------------------------------------------------
-- a, b. Grants
-- ---------------------------------------------------------------------------
select is_empty($$
  select p.oid::regprocedure::text
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and (p.proname like 'canonical\_%'
      or p.proname like '%\_internal'
      or p.proname ~ '^next_.+_requirement$'
      or p.proname in ('programme_required_units', 'assert_enrollment_scope',
                       'resolve_current_enrollment', 'dashboard_summary'))
    and has_function_privilege('anon', p.oid, 'EXECUTE')
$$, 'anon executes no canonical / internal / next_*_requirement function');

select is_empty($$
  select p.oid::regprocedure::text
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and (p.proname like 'canonical\_%'
      or p.proname like '%\_internal'
      or p.proname ~ '^next_.+_requirement$'
      or p.proname in ('programme_required_units', 'assert_enrollment_scope',
                       'resolve_current_enrollment', 'dashboard_summary'))
    and has_function_privilege('authenticated', p.oid, 'EXECUTE')
$$, 'authenticated executes no canonical / internal / next_*_requirement function');

select hasnt_function('public', 'dashboard_summary', 'dashboard_summary is dropped');

select ok(has_function_privilege('service_role', 'public.canonical_coaching_requirement_fulfilment(uuid)', 'EXECUTE')
      and has_function_privilege('service_role', 'public.triad_create_group_internal(uuid, uuid[], text, text, timestamptz, timestamptz)', 'EXECUTE')
      and has_function_privilege('service_role', 'public.canonical_enrollment_inactivity_internal(timestamptz)', 'EXECUTE'),
  'the service role (edge functions) keeps EXECUTE');

select ok(not has_function_privilege('anon', 'public.learner_next_coaching_requirement(uuid)', 'EXECUTE')
      and not has_function_privilege('anon', 'public.learner_coaching_requirement_fulfilment(uuid)', 'EXECUTE')
      and not has_function_privilege('anon', 'public.coach_coaching_requirement_fulfilment(uuid)', 'EXECUTE'),
  'anon executes none of the wrappers');

select ok(has_function_privilege('authenticated', 'public.learner_next_coaching_requirement(uuid)', 'EXECUTE')
      and has_function_privilege('authenticated', 'public.learner_coaching_requirement_fulfilment(uuid)', 'EXECUTE')
      and has_function_privilege('authenticated', 'public.coach_coaching_requirement_fulfilment(uuid)', 'EXECUTE'),
  'signed-in users execute the wrappers');

-- ---------------------------------------------------------------------------
-- Fixture
-- ---------------------------------------------------------------------------
-- 01 Coach K   02 learner A   03 learner B   04 Admin   05 Coach X
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_user_meta_data, created_at, updated_at, confirmation_token, email_change_token_new, recovery_token)
select ('f9b00000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid,
  '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated',
  'grants-' || n || '@example.test', 'test', now(),
  jsonb_build_object('full_name', 'Grants Person ' || n), now(), now(), '', '', ''
from generate_series(1, 5) n;

insert into public.user_roles (user_id, role) values
  ('f9b00000-0000-4000-8000-000000000001', 'coach'),
  ('f9b00000-0000-4000-8000-000000000002', 'coachee'),
  ('f9b00000-0000-4000-8000-000000000003', 'coachee'),
  ('f9b00000-0000-4000-8000-000000000004', 'admin'),
  ('f9b00000-0000-4000-8000-000000000005', 'coach')
on conflict do nothing;
update public.profiles set status = 'active'::public.user_status where id::text like 'f9b00000-%';
insert into public.coach_profiles (id, approval_status, max_coachee_invites) values
  ('f9b00000-0000-4000-8000-000000000001', 'active', 5),
  ('f9b00000-0000-4000-8000-000000000005', 'active', 5)
on conflict (id) do update set approval_status = 'active', max_coachee_invites = 5;

insert into public.programmes (id, name) values ('f9b10000-0000-4000-8000-000000000001', 'Grants Programme');
insert into public.programme_modules (programme_id, module, enabled, config) values
  ('f9b10000-0000-4000-8000-000000000001', 'coaching', true, '{"required": true, "required_units": 2}');
insert into public.cohorts (id, name, programme_id, start_date, end_date) values
  ('f9b20000-0000-4000-8000-000000000001', 'Grants Cohort', 'f9b10000-0000-4000-8000-000000000001',
   current_date - 30, current_date + 200);
update public.cohort_requirement_dates
   set due_on = current_date + 10 + ordinal * 30, is_overridden = true,
       generation_method = 'manual', materialized_via = 'admin_save'
 where cohort_id = 'f9b20000-0000-4000-8000-000000000001';
insert into public.cohort_coach_assignments (cohort_id, coach_id) values
  ('f9b20000-0000-4000-8000-000000000001', 'f9b00000-0000-4000-8000-000000000001'),
  ('f9b20000-0000-4000-8000-000000000001', 'f9b00000-0000-4000-8000-000000000005');

insert into public.programme_enrollments (id, programme_id, user_id, cohort_id, status, start_date, end_date) values
  ('f9b30000-0000-4000-8000-000000000002', 'f9b10000-0000-4000-8000-000000000001',
   'f9b00000-0000-4000-8000-000000000002', 'f9b20000-0000-4000-8000-000000000001', 'active', current_date - 30, current_date + 200),
  ('f9b30000-0000-4000-8000-000000000003', 'f9b10000-0000-4000-8000-000000000001',
   'f9b00000-0000-4000-8000-000000000003', 'f9b20000-0000-4000-8000-000000000001', 'active', current_date - 30, current_date + 200);

insert into public.coachee_goals (coachee_id, enrollment_id, title)
select e.user_id, e.id, 'Grants goal' from public.programme_enrollments e
where e.id::text like 'f9b30000-%';

-- Learner A: unit 1 with Coach K, unit 2 with Coach X. Learner B: nothing yet.
-- Written as the lifecycle service, as seed.sql does: booking rules are not
-- what this suite is about.
select set_config('app.session_transition', 'on', true);
insert into public.sessions (id, enrollment_id, cohort_requirement_id, coach_id, coachee_id, topic,
  start_time, duration_minutes, status)
select ('f9b40000-0000-4000-8000-00000000000' || r.ordinal)::uuid,
  'f9b30000-0000-4000-8000-000000000002',
  r.id,
  case r.ordinal when 1 then 'f9b00000-0000-4000-8000-000000000001'::uuid
                 else 'f9b00000-0000-4000-8000-000000000005'::uuid end,
  'f9b00000-0000-4000-8000-000000000002',
  'Grants ' || r.ordinal, now() + (r.ordinal || ' days')::interval, 60, 'pending_coach_approval'
from public.cohort_requirement_dates r
where r.cohort_id = 'f9b20000-0000-4000-8000-000000000001' and r.module = 'coaching';
select set_config('app.session_transition', 'off', true);

-- ---------------------------------------------------------------------------
-- c. Wrappers with owner checks
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'f9b00000-0000-4000-8000-000000000002')::text, true);

select throws_ok($$ select * from public.canonical_coaching_requirement_fulfilment('f9b30000-0000-4000-8000-000000000002') $$,
  '42501', null, 'a learner cannot call canonical_coaching_requirement_fulfilment');
select throws_ok($$ select * from public.next_coaching_requirement('f9b30000-0000-4000-8000-000000000003') $$,
  '42501', null, 'a learner cannot call next_coaching_requirement');
select throws_ok($$ select public.programme_required_units('f9b30000-0000-4000-8000-000000000003', 'coaching') $$,
  '42501', null, 'a learner cannot call programme_required_units');
select throws_ok($$ select public.resolve_current_enrollment('f9b00000-0000-4000-8000-000000000003') $$,
  '42501', null, 'a learner cannot call resolve_current_enrollment');

select is((select count(*)::int from public.learner_coaching_requirement_fulfilment('f9b30000-0000-4000-8000-000000000002')),
  2, 'learner A reads both Coaching units of their own enrollment');
select is((select count(*)::int from public.learner_coaching_requirement_fulfilment('f9b30000-0000-4000-8000-000000000003')),
  0, 'learner A reads nothing of learner B''s enrollment');
select is_empty($$ select * from public.learner_next_coaching_requirement('f9b30000-0000-4000-8000-000000000002') $$,
  'learner A has no free Coaching unit left');
select is_empty($$ select * from public.learner_next_coaching_requirement('f9b30000-0000-4000-8000-000000000003') $$,
  'learner A cannot read learner B''s next Coaching unit');

select set_config('request.jwt.claims', json_build_object('sub', 'f9b00000-0000-4000-8000-000000000003')::text, true);
select is((select ordinal from public.learner_next_coaching_requirement('f9b30000-0000-4000-8000-000000000003')),
  1, 'learner B reads their own next Coaching unit');

select set_config('request.jwt.claims', json_build_object('sub', 'f9b00000-0000-4000-8000-000000000001')::text, true);
select results_eq(
  $$ select session_id, ordinal from public.coach_coaching_requirement_fulfilment('f9b30000-0000-4000-8000-000000000002') $$,
  $$ values ('f9b40000-0000-4000-8000-000000000001'::uuid, 1) $$,
  'Coach K reads only the unit their own session fulfils');
select is_empty($$ select * from public.learner_coaching_requirement_fulfilment('f9b30000-0000-4000-8000-000000000002') $$,
  'Coach K cannot use the learner wrapper on learner A''s enrollment');
select is_empty($$ select * from public.coach_coaching_requirement_fulfilment('f9b30000-0000-4000-8000-000000000003') $$,
  'Coach K reads nothing of an enrollment they coach no session in');

-- ---------------------------------------------------------------------------
-- d. coach_profiles protected fields
-- ---------------------------------------------------------------------------
-- Still Coach K, through the "own update" policy.
select lives_ok($$ update public.coach_profiles set title = 'Senior Coach', peer_coaching_opt_in = true
                   where id = 'f9b00000-0000-4000-8000-000000000001' $$,
  'a Coach edits their own title and Peer opt-in');
select throws_ok($$ update public.coach_profiles set max_coachee_invites = 500
                    where id = 'f9b00000-0000-4000-8000-000000000001' $$,
  '42501', null, 'a Coach cannot raise their own invite limit');
select throws_ok($$ update public.coach_profiles set approval_status = 'pending_approval'
                    where id = 'f9b00000-0000-4000-8000-000000000001' $$,
  '42501', null, 'a Coach cannot change their own approval status');
select throws_ok($$ update public.coach_profiles set rating_avg = 4.9
                    where id = 'f9b00000-0000-4000-8000-000000000001' $$,
  '42501', null, 'a Coach cannot set their own rating');
select throws_ok($$ update public.coach_profiles set sessions_completed = 99
                    where id = 'f9b00000-0000-4000-8000-000000000001' $$,
  '42501', null, 'a Coach cannot set their own completed sessions');

-- A learner's rating reaches rating_avg through recompute_coach_rating.
select set_config('request.jwt.claims', json_build_object('sub', 'f9b00000-0000-4000-8000-000000000002')::text, true);
select lives_ok($$ update public.sessions set coachee_rating = 3
                   where id = 'f9b40000-0000-4000-8000-000000000001' $$,
  'a learner rates their Coaching session');
reset role;
select is((select rating_avg from public.coach_profiles where id = 'f9b00000-0000-4000-8000-000000000001'),
  3.00::numeric, 'the rating reaches Coach K''s rating_avg (trusted trigger)');

-- An Admin through the app.
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'f9b00000-0000-4000-8000-000000000004')::text, true);
select lives_ok($$ update public.coach_profiles set approval_status = 'suspended', max_coachee_invites = 8
                   where id = 'f9b00000-0000-4000-8000-000000000005' $$,
  'an Admin changes a Coach''s approval and invite limit');
reset role;
select is((select approval_status::text || '/' || max_coachee_invites from public.coach_profiles
           where id = 'f9b00000-0000-4000-8000-000000000005'),
  'suspended/8', 'the Admin change is stored');

-- The service role (edge functions such as approve-access-request).
set local role service_role;
select set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
select lives_ok($$ update public.coach_profiles set approval_status = 'active'
                   where id = 'f9b00000-0000-4000-8000-000000000005' $$,
  'the service role changes a Coach''s approval status');
reset role;

select is((select max_coachee_invites from public.coach_profiles where id = 'f9b00000-0000-4000-8000-000000000001'),
  5, 'Coach K''s invite limit is unchanged');

select * from finish();
rollback;
