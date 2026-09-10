begin;
select plan(4);

-- Self-contained behavioral fixture: one receiver, one opted-in peer coach,
-- and two programme histories for the receiver.  The selected enrollment is
-- active; the other is completed and must never contribute to its usage.
insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at)
values
  ('b1000000-0000-4000-8000-000000000001','authenticated','authenticated',
   'peer-test-receiver@example.test','x',now()),
  ('b1000000-0000-4000-8000-000000000002','authenticated','authenticated',
   'peer-test-coach@example.test','x',now());
-- auth's signup trigger creates the profiles and baseline coachee roles.
insert into public.user_roles (user_id, role)
values ('b1000000-0000-4000-8000-000000000002','coach');
insert into public.coach_profiles (id, approval_status, peer_coaching_opt_in)
values ('b1000000-0000-4000-8000-000000000002','active',true);

insert into public.programmes (id, name)
values
  ('b1000000-0000-4000-8000-000000000011','Peer booking test programme A'),
  ('b1000000-0000-4000-8000-000000000012','Peer booking test programme B');
insert into public.programme_modules (programme_id, module, enabled, config)
values
  ('b1000000-0000-4000-8000-000000000011','peer_coaching',true,'{"monthly_limit":1}'),
  ('b1000000-0000-4000-8000-000000000012','peer_coaching',true,'{"monthly_limit":9}');
insert into public.programme_enrollments
  (id, coachee_id, user_id, programme_id, start_date, status)
values
  ('b1000000-0000-4000-8000-000000000021',
   'b1000000-0000-4000-8000-000000000001',
   'b1000000-0000-4000-8000-000000000001',
   'b1000000-0000-4000-8000-000000000011',current_date,'completed'),
  ('b1000000-0000-4000-8000-000000000022',
   'b1000000-0000-4000-8000-000000000001',
   'b1000000-0000-4000-8000-000000000001',
   'b1000000-0000-4000-8000-000000000012',current_date - 30,'active');

-- History on the other enrollment must not consume the selected entitlement.
insert into public.peer_sessions
  (peer_coach_id, peer_coachee_id, enrollment_id, topic, start_time, duration_minutes, status)
values
  ('b1000000-0000-4000-8000-000000000002',
   'b1000000-0000-4000-8000-000000000001',
   'b1000000-0000-4000-8000-000000000022',
   'other enrollment history',now(),30,'completed');
-- Preserve the one-ongoing-enrollment invariant while exercising the
-- enrollment trigger: history is created while its receiver enrollment is
-- ongoing, then that historical enrollment is closed before selection.
update public.programme_enrollments
set status='completed'::public.enrollment_status
where id='b1000000-0000-4000-8000-000000000022';
update public.programme_enrollments
set status='active'::public.enrollment_status
where id='b1000000-0000-4000-8000-000000000021';

select set_config('request.jwt.claim.sub','b1000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claim.role','authenticated',true);
set local role authenticated;

select is(
  public.can_book_peer_session(
    'b1000000-0000-4000-8000-000000000002',
    'b1000000-0000-4000-8000-000000000021'
  ), true, 'selected enrollment is bookable below its monthly limit');
select is(
  (select used_count from public.get_peer_session_usage(
    'b1000000-0000-4000-8000-000000000021'
  )), 0, 'usage excludes peer sessions on another enrollment');

-- Consume the selected enrollment's one allowed unit through the same RLS
-- insert path used by the application.
insert into public.peer_sessions
  (peer_coach_id, peer_coachee_id, enrollment_id, topic, start_time, duration_minutes, status)
values
  ('b1000000-0000-4000-8000-000000000002',
   'b1000000-0000-4000-8000-000000000001',
   'b1000000-0000-4000-8000-000000000021',
   'selected enrollment unit',now(),30,'pending_coach_approval');
select is(
  public.can_book_peer_session(
    'b1000000-0000-4000-8000-000000000002',
    'b1000000-0000-4000-8000-000000000021'
  ), false, 'selected enrollment is rejected at its monthly limit');
select throws_ok(
  $$select public.book_peer_session(
      'b1000000-0000-4000-8000-000000000002',
      'b1000000-0000-4000-8000-000000000021',
      'over limit', now(), 30, null)$$,
  '42501', 'Peer booking is not allowed for this enrollment',
  'booking RPC rejects the selected enrollment at its limit'
);

select * from finish();
rollback;