-- Admin Peer re-validation (20261006100000_admin_peer_revalidation).
--
-- admin_reschedule_session() and admin_reopen_session() re-run the Peer
-- booking rules for a coach-to-coach Peer session, not only the past-start and
-- clash checks: the receiver's enrollment is still ongoing, the peer coach is
-- still eligible and opted in, Peer coaching is still enabled, and the
-- entitlement is not exhausted. validate_peer_session_enrollment() fires only
-- on UPDATE OF enrollment_id / peer_coach_id / peer_coachee_id, which neither
-- Admin function writes, so before this none of those rules ran.
begin;
select plan(12);

-- ---------------------------------------------------------------------------
-- Fixture
-- ---------------------------------------------------------------------------
-- 01 Coach K   04 Admin   05 learner D   06 Coach Z
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_user_meta_data, created_at, updated_at, confirmation_token, email_change_token_new, recovery_token)
select ('f9c00000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid,
  '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated',
  'admin-peer-' || n || '@example.test', 'test', now(),
  jsonb_build_object('full_name', 'Admin Peer Person ' || n), now(), now(), '', '', ''
from unnest(array[1, 4, 5, 6]) n;

insert into public.user_roles (user_id, role) values
  ('f9c00000-0000-4000-8000-000000000001', 'coach'),
  ('f9c00000-0000-4000-8000-000000000004', 'admin'),
  ('f9c00000-0000-4000-8000-000000000005', 'coachee'),
  ('f9c00000-0000-4000-8000-000000000006', 'coach')
on conflict do nothing;
update public.profiles set status = 'active'::public.user_status where id::text like 'f9c00000-%';
insert into public.coach_profiles (id, approval_status, peer_coaching_opt_in) values
  ('f9c00000-0000-4000-8000-000000000001', 'active', true),
  ('f9c00000-0000-4000-8000-000000000006', 'active', true)
on conflict (id) do update set approval_status = 'active', peer_coaching_opt_in = true;

-- One Peer session per enrollment.
insert into public.programmes (id, name) values
  ('f9c10000-0000-4000-8000-000000000001', 'Admin Peer Programme');
insert into public.programme_modules (programme_id, module, enabled, config) values
  ('f9c10000-0000-4000-8000-000000000001', 'peer_coaching', true, '{"monthly_limit": 1}');
insert into public.programme_enrollments (id, programme_id, user_id, cohort_id, status, start_date, end_date) values
  ('f9c30000-0000-4000-8000-000000000005', 'f9c10000-0000-4000-8000-000000000001',
   'f9c00000-0000-4000-8000-000000000005', null, 'active', current_date - 30, null);
insert into public.coachee_goals (coachee_id, enrollment_id, title)
values ('f9c00000-0000-4000-8000-000000000005', 'f9c30000-0000-4000-8000-000000000005', 'Booking gate goal');

-- Sessions, written as trusted SQL:
--   p1  K -> D, cancelled, in 5 days
--   p2  Z -> D, pending,   in 7 days (holds D's only unit)
select set_config('app.session_transition', 'on', true);
insert into public.peer_sessions (id, peer_coach_id, peer_coachee_id, enrollment_id, topic, start_time, duration_minutes, status) values
  ('f9c40000-0000-4000-8000-0000000000a1', 'f9c00000-0000-4000-8000-000000000001',
   'f9c00000-0000-4000-8000-000000000005', 'f9c30000-0000-4000-8000-000000000005',
   'P1', date_trunc('hour', now()) + interval '5 days', 30, 'cancelled'),
  ('f9c40000-0000-4000-8000-0000000000a2', 'f9c00000-0000-4000-8000-000000000006',
   'f9c00000-0000-4000-8000-000000000005', 'f9c30000-0000-4000-8000-000000000005',
   'P2', date_trunc('hour', now()) + interval '7 days', 30, 'pending_coach_approval');
select set_config('app.session_transition', '', true);

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'f9c00000-0000-4000-8000-000000000004')::text, true);

-- ---------------------------------------------------------------------------
-- Reopen: the entitlement
-- ---------------------------------------------------------------------------
select throws_ok($$select public.admin_reopen_session('peer', 'f9c40000-0000-4000-8000-0000000000a1', 'Cancelled by mistake')$$,
  '42501', 'Peer coaching entitlement has been exhausted',
  'e1. a cancelled Peer session is not reopened over an exhausted entitlement');

-- ---------------------------------------------------------------------------
-- Reschedule: enrollment, opt-in, eligibility, module
-- ---------------------------------------------------------------------------
reset role;
update public.programme_enrollments set status = 'paused' where id = 'f9c30000-0000-4000-8000-000000000005';
set local role authenticated;
select throws_ok($$select public.admin_reschedule_session('peer', 'f9c40000-0000-4000-8000-0000000000a2',
  date_trunc('hour', now()) + interval '8 days', 30, 'Receiver asked')$$,
  '42501', 'Peer booking receiver enrollment is invalid',
  'r1. a Peer session is not rescheduled for an enrollment no longer ongoing');
reset role;
update public.programme_enrollments set status = 'active' where id = 'f9c30000-0000-4000-8000-000000000005';

update public.coach_profiles set peer_coaching_opt_in = false where id = 'f9c00000-0000-4000-8000-000000000006';
set local role authenticated;
select throws_ok($$select public.admin_reschedule_session('peer', 'f9c40000-0000-4000-8000-0000000000a2',
  date_trunc('hour', now()) + interval '8 days', 30, 'Receiver asked')$$,
  '42501', 'Peer booking participant is invalid',
  'r2. a Peer session is not rescheduled with a peer coach who opted out');
reset role;
update public.coach_profiles set peer_coaching_opt_in = true where id = 'f9c00000-0000-4000-8000-000000000006';

update public.coach_profiles set approval_status = 'inactive' where id = 'f9c00000-0000-4000-8000-000000000006';
set local role authenticated;
select throws_ok($$select public.admin_reschedule_session('peer', 'f9c40000-0000-4000-8000-0000000000a2',
  date_trunc('hour', now()) + interval '8 days', 30, 'Receiver asked')$$,
  '42501', null,
  'r3. a Peer session is not rescheduled with a peer coach no longer eligible');
reset role;
update public.coach_profiles set approval_status = 'active' where id = 'f9c00000-0000-4000-8000-000000000006';

update public.programme_modules set enabled = false
 where programme_id = 'f9c10000-0000-4000-8000-000000000001' and module = 'peer_coaching';
set local role authenticated;
select throws_ok($$select public.admin_reschedule_session('peer', 'f9c40000-0000-4000-8000-0000000000a2',
  date_trunc('hour', now()) + interval '8 days', 30, 'Receiver asked')$$,
  '42501', null,
  'r4. a Peer session is not rescheduled once Peer coaching is disabled');
reset role;
update public.programme_modules set enabled = true
 where programme_id = 'f9c10000-0000-4000-8000-000000000001' and module = 'peer_coaching';
set local role authenticated;

select is((select count(*)::int from public.session_admin_audit where session_id::text like 'f9c40000-%'),
  0, 'r5. a refused edit leaves no audit row');

-- ---------------------------------------------------------------------------
-- The rules pass: the edits go through
-- ---------------------------------------------------------------------------
-- A live session counts itself once: rescheduling it at the limit is fine.
select lives_ok($$select public.admin_reschedule_session('peer', 'f9c40000-0000-4000-8000-0000000000a2',
  date_trunc('hour', now()) + interval '8 days', 30, 'Receiver asked')$$,
  'ok1. a Peer session at the entitlement limit can still be rescheduled');

reset role;
select set_config('app.session_transition', 'on', true);
update public.peer_sessions set status = 'cancelled' where id = 'f9c40000-0000-4000-8000-0000000000a2';
select set_config('app.session_transition', '', true);
set local role authenticated;
select lives_ok($$select public.admin_reopen_session('peer', 'f9c40000-0000-4000-8000-0000000000a1', 'Cancelled by mistake')$$,
  'ok2. with the unit free again, the cancelled session is reopened');
select is((select status::text from public.peer_sessions where id = 'f9c40000-0000-4000-8000-0000000000a1'),
  'pending_coach_approval', 'ok3. it is a pending request again');
select is((select count(*)::int from public.session_admin_audit where session_id::text like 'f9c40000-%'),
  2, 'ok4. both edits are audited');

-- ---------------------------------------------------------------------------
-- The trigger still owns the same rules at booking
-- ---------------------------------------------------------------------------
reset role;
select throws_ok($$insert into public.peer_sessions (peer_coach_id, peer_coachee_id, enrollment_id, topic, start_time, duration_minutes, status)
  values ('f9c00000-0000-4000-8000-000000000006', 'f9c00000-0000-4000-8000-000000000005',
          'f9c30000-0000-4000-8000-000000000005', 'P3', now() + interval '9 days', 30, 'pending_coach_approval')$$,
  '42501', 'Peer coaching entitlement has been exhausted',
  't1. a new Peer booking over the entitlement is still refused');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname = 'assert_peer_session_bookable_internal'
              and (has_function_privilege('anon', p.oid, 'EXECUTE')
                or has_function_privilege('authenticated', p.oid, 'EXECUTE'))),
  0, 't2. the shared rule function is not client-callable');

select * from finish();
rollback;
