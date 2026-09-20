-- Peer cohort eligibility, booking enforcement and lifecycle contract
-- (Peer cutover, phases 2 and 3).
--
-- Phase 1 proved a Peer session is two enrollments with two requirements. This
-- proves WHO may be the other enrollment, that the answer is enforced by the
-- database rather than by the client, and that the session lifecycle around it
-- neither loses a requirement nor counts one twice.
--
-- Five cohorts of ONE programme so directionality is observable:
--
--   A --> B      A --> C      A --> D      (granted)
--   A     E                                (never granted)
--
-- plus cohort X in a DIFFERENT programme, which may not be connected at all.
begin;

select plan(34);

-- ---------------------------------------------------------------------------
-- Fixture
-- ---------------------------------------------------------------------------

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_user_meta_data, created_at, updated_at, confirmation_token, email_change_token_new, recovery_token)
select ('f2000000-0000-0000-0000-00000000000' || n)::uuid, '00000000-0000-0000-0000-000000000000'::uuid,
  'authenticated', 'authenticated', 'peer-elig-' || n || '@example.test', 'test', now(),
  jsonb_build_object('full_name', 'Peer Elig ' || n), now(), now(), '', '', ''
from generate_series(1, 8) n;
-- 1 = A1   2 = A2   3 = B1   4 = C1   5 = D1   6 = E1   7 = X1
-- 8 = a learner with a CLOSED enrollment in A and a live one in E

insert into public.user_roles (user_id, role)
select ('f2000000-0000-0000-0000-00000000000' || n)::uuid, 'coachee'
from generate_series(1, 8) n on conflict do nothing;

-- Willing, and with a usable account: both are required to be an eligible
-- partner, and the signup trigger leaves profiles at pending_approval.
update public.profiles
   set peer_coaching_opt_in = true, status = 'active'::public.user_status
 where id::text like 'f2000000-0000-0000-0000-00000000000%';

insert into public.programmes (id, name) values
  ('f2000000-0000-0000-0000-00000000a0a0'::uuid, 'Peer Eligibility Programme'),
  ('f2000000-0000-0000-0000-00000000a1a1'::uuid, 'Unrelated Programme');
insert into public.programme_modules (programme_id, module, enabled, config) values
  ('f2000000-0000-0000-0000-00000000a0a0'::uuid, 'peer_coaching', true,
   '{"required": true, "required_units": 3, "monthly_limit": 20}'::jsonb),
  ('f2000000-0000-0000-0000-00000000a1a1'::uuid, 'peer_coaching', true,
   '{"required": true, "required_units": 3, "monthly_limit": 20}'::jsonb);

-- Every cohort needs an end date, or Part A's rule gives it no deadline and
-- therefore no requirement rows to fulfil.
insert into public.cohorts (id, name, programme_id, start_date, end_date) values
  ('f2000000-0000-0000-0000-00000000b0a0'::uuid, 'Cohort A', 'f2000000-0000-0000-0000-00000000a0a0'::uuid, current_date - 100, current_date + 200),
  ('f2000000-0000-0000-0000-00000000b0b0'::uuid, 'Cohort B', 'f2000000-0000-0000-0000-00000000a0a0'::uuid, current_date - 100, current_date + 200),
  ('f2000000-0000-0000-0000-00000000b0c0'::uuid, 'Cohort C', 'f2000000-0000-0000-0000-00000000a0a0'::uuid, current_date - 100, current_date + 200),
  ('f2000000-0000-0000-0000-00000000b0d0'::uuid, 'Cohort D', 'f2000000-0000-0000-0000-00000000a0a0'::uuid, current_date - 100, current_date + 200),
  ('f2000000-0000-0000-0000-00000000b0e0'::uuid, 'Cohort E', 'f2000000-0000-0000-0000-00000000a0a0'::uuid, current_date - 100, current_date + 200),
  ('f2000000-0000-0000-0000-00000000b0f0'::uuid, 'Cohort X', 'f2000000-0000-0000-0000-00000000a1a1'::uuid, current_date - 100, current_date + 200);

insert into public.programme_enrollments (id, programme_id, user_id, cohort_id, status, start_date, end_date) values
  ('f2000000-0000-0000-0000-0000000000e1'::uuid, 'f2000000-0000-0000-0000-00000000a0a0'::uuid, 'f2000000-0000-0000-0000-000000000001'::uuid, 'f2000000-0000-0000-0000-00000000b0a0'::uuid, 'active', current_date - 100, current_date + 200),
  ('f2000000-0000-0000-0000-0000000000e2'::uuid, 'f2000000-0000-0000-0000-00000000a0a0'::uuid, 'f2000000-0000-0000-0000-000000000002'::uuid, 'f2000000-0000-0000-0000-00000000b0a0'::uuid, 'active', current_date - 100, current_date + 200),
  ('f2000000-0000-0000-0000-0000000000e3'::uuid, 'f2000000-0000-0000-0000-00000000a0a0'::uuid, 'f2000000-0000-0000-0000-000000000003'::uuid, 'f2000000-0000-0000-0000-00000000b0b0'::uuid, 'active', current_date - 100, current_date + 200),
  ('f2000000-0000-0000-0000-0000000000e4'::uuid, 'f2000000-0000-0000-0000-00000000a0a0'::uuid, 'f2000000-0000-0000-0000-000000000004'::uuid, 'f2000000-0000-0000-0000-00000000b0c0'::uuid, 'active', current_date - 100, current_date + 200),
  ('f2000000-0000-0000-0000-0000000000e5'::uuid, 'f2000000-0000-0000-0000-00000000a0a0'::uuid, 'f2000000-0000-0000-0000-000000000005'::uuid, 'f2000000-0000-0000-0000-00000000b0d0'::uuid, 'active', current_date - 100, current_date + 200),
  ('f2000000-0000-0000-0000-0000000000e6'::uuid, 'f2000000-0000-0000-0000-00000000a0a0'::uuid, 'f2000000-0000-0000-0000-000000000006'::uuid, 'f2000000-0000-0000-0000-00000000b0e0'::uuid, 'active', current_date - 100, current_date + 200),
  ('f2000000-0000-0000-0000-0000000000e7'::uuid, 'f2000000-0000-0000-0000-00000000a1a1'::uuid, 'f2000000-0000-0000-0000-000000000007'::uuid, 'f2000000-0000-0000-0000-00000000b0f0'::uuid, 'active', current_date - 100, current_date + 200);

-- The grants. Directional, and E is deliberately never granted.
insert into public.peer_cohort_permissions (source_cohort_id, allowed_peer_cohort_id) values
  ('f2000000-0000-0000-0000-00000000b0a0'::uuid, 'f2000000-0000-0000-0000-00000000b0b0'::uuid),
  ('f2000000-0000-0000-0000-00000000b0a0'::uuid, 'f2000000-0000-0000-0000-00000000b0c0'::uuid),
  ('f2000000-0000-0000-0000-00000000b0a0'::uuid, 'f2000000-0000-0000-0000-00000000b0d0'::uuid);

-- ---------------------------------------------------------------------------
-- Same cohort needs no permission row
-- ---------------------------------------------------------------------------

select set_config('request.jwt.claims',
  json_build_object('sub', 'f2000000-0000-0000-0000-000000000001')::text, true);

select ok(
  exists (select 1 from public.eligible_peer_partners('f2000000-0000-0000-0000-0000000000e1'::uuid)
           where user_id = 'f2000000-0000-0000-0000-000000000002'::uuid and is_own_cohort),
  'a learner may peer inside their OWN cohort with no permission row at all');

-- ---------------------------------------------------------------------------
-- Multi-cohort: the pool is own + every granted cohort, and nothing else
-- ---------------------------------------------------------------------------

select is(
  (select array_agg(distinct c.name order by c.name)
     from public.eligible_peer_partners('f2000000-0000-0000-0000-0000000000e1'::uuid) p
     join public.cohorts c on c.id = p.cohort_id),
  array['Cohort A', 'Cohort B', 'Cohort C', 'Cohort D'],
  'A --> B, C, D gives one pool spanning A + B + C + D');

select ok(
  not exists (select 1 from public.eligible_peer_partners('f2000000-0000-0000-0000-0000000000e1'::uuid)
               where cohort_id = 'f2000000-0000-0000-0000-00000000b0e0'::uuid),
  'cohort E was never granted, so none of its learners are selectable');

select ok(
  not exists (select 1 from public.eligible_peer_partners('f2000000-0000-0000-0000-0000000000e1'::uuid)
               where user_id = 'f2000000-0000-0000-0000-000000000001'::uuid),
  'a learner is never their own partner');

-- ---------------------------------------------------------------------------
-- Grants are DIRECTIONAL
-- ---------------------------------------------------------------------------

select set_config('request.jwt.claims',
  json_build_object('sub', 'f2000000-0000-0000-0000-000000000003')::text, true);

select ok(
  not exists (select 1 from public.eligible_peer_partners('f2000000-0000-0000-0000-0000000000e3'::uuid)
               where cohort_id = 'f2000000-0000-0000-0000-00000000b0a0'::uuid),
  'A --> B does NOT let B go looking in A');

insert into public.peer_cohort_permissions (source_cohort_id, allowed_peer_cohort_id)
values ('f2000000-0000-0000-0000-00000000b0b0'::uuid, 'f2000000-0000-0000-0000-00000000b0a0'::uuid);

select ok(
  exists (select 1 from public.eligible_peer_partners('f2000000-0000-0000-0000-0000000000e3'::uuid)
           where user_id = 'f2000000-0000-0000-0000-000000000001'::uuid),
  'mutual access is two rows: adding B --> A opens the other direction');

-- ---------------------------------------------------------------------------
-- Structural compatibility is a database rule, not a UI filter
-- ---------------------------------------------------------------------------

select throws_ok($$
  insert into public.peer_cohort_permissions (source_cohort_id, allowed_peer_cohort_id)
  values ('f2000000-0000-0000-0000-00000000b0a0'::uuid, 'f2000000-0000-0000-0000-00000000b0f0'::uuid)
$$, '23514', NULL, 'cohorts of different programmes cannot be connected');

select throws_ok($$
  insert into public.peer_cohort_permissions (source_cohort_id, allowed_peer_cohort_id)
  values ('f2000000-0000-0000-0000-00000000b0a0'::uuid, 'f2000000-0000-0000-0000-00000000b0a0'::uuid)
$$, '23514', NULL, 'a cohort cannot be granted to itself: own-cohort peering is implicit');

select throws_ok($$
  insert into public.peer_cohort_permissions (source_cohort_id, allowed_peer_cohort_id)
  values ('f2000000-0000-0000-0000-00000000b0a0'::uuid, 'f2000000-0000-0000-0000-00000000b0b0'::uuid)
$$, '23505', NULL, 'the same grant cannot be recorded twice');

-- ---------------------------------------------------------------------------
-- The partner result carries selection data only
-- ---------------------------------------------------------------------------

select is(
  (select array_agg(a.attname::text order by a.attname)
     from pg_proc p
     join unnest(p.proallargtypes, p.proargnames) with ordinality as a(typ, attname, ord) on true
    where p.oid = 'public.eligible_peer_partners(uuid)'::regprocedure
      and a.attname <> 'p_enrollment_id'),
  array['cohort_id', 'cohort_name', 'display_name', 'enrollment_id',
        'is_own_cohort', 'programme_id', 'programme_name', 'user_id'],
  'the partner list exposes selection fields only -- no email, sponsor, goals or narrative');

-- ---------------------------------------------------------------------------
-- Booking is enforced server-side, on every path
-- ---------------------------------------------------------------------------

select set_config('request.jwt.claims',
  json_build_object('sub', 'f2000000-0000-0000-0000-000000000001')::text, true);

-- A1 books B1: granted, so it is allowed.
select lives_ok($$
  select public.book_coachee_peer_session(
    'f2000000-0000-0000-0000-000000000003'::uuid,
    'f2000000-0000-0000-0000-0000000000e1'::uuid,
    'A with B', now() - interval '2 days', 45, null)
$$, 'a learner may book a partner in a granted cohort');

select is(
  (select count(distinct d.cohort_id)::int
     from public.peer_session_participants p
     join public.cohort_requirement_dates d on d.id = p.cohort_requirement_id
    where p.session_kind = 'coachee_peer'
      and p.peer_session_id = (select id from public.coachee_peer_sessions where topic = 'A with B')),
  2, 'the cross-cohort session credits each side against its OWN cohort schedule');

-- A1 books E1: never granted.
select throws_ok($$
  select public.book_coachee_peer_session(
    'f2000000-0000-0000-0000-000000000006'::uuid,
    'f2000000-0000-0000-0000-0000000000e1'::uuid,
    'A with E', now() - interval '2 days', 45, null)
$$, '42501', NULL, 'the booking RPC refuses a partner from an ungranted cohort');

-- The same attempt written straight at the table, with no RPC and no client.
-- This is the path frontend filtering cannot protect.
select throws_ok($$
  insert into public.coachee_peer_sessions
    (peer_provider_id, peer_receiver_id, enrollment_id, topic, start_time, duration_minutes, status)
  values ('f2000000-0000-0000-0000-000000000006'::uuid, 'f2000000-0000-0000-0000-000000000001'::uuid,
          'f2000000-0000-0000-0000-0000000000e1'::uuid, 'direct bypass',
          now() - interval '2 days', 45, 'confirmed')
$$, '42501', NULL, 'a direct table insert is refused by the same cohort rule');

-- And an enrollment that is not the receiver's own cannot be borrowed.
select throws_ok($$
  insert into public.coachee_peer_sessions
    (peer_provider_id, peer_receiver_id, enrollment_id, topic, start_time, duration_minutes, status)
  values ('f2000000-0000-0000-0000-000000000003'::uuid, 'f2000000-0000-0000-0000-000000000001'::uuid,
          'f2000000-0000-0000-0000-0000000000e2'::uuid, 'borrowed enrollment',
          now() - interval '2 days', 45, 'confirmed')
$$, '42501', NULL, 'the named enrollment must belong to the receiver');

-- ---------------------------------------------------------------------------
-- One session, two participants, DIFFERENT requirement positions
-- ---------------------------------------------------------------------------
--
-- A1 already holds Peer unit 1 from the session above. B1 holds their own
-- unit 1. The next shared session must therefore advance A1 to unit 2 while
-- C1 -- who has done nothing yet -- takes unit 1.

select set_config('request.jwt.claims',
  json_build_object('sub', 'f2000000-0000-0000-0000-000000000001')::text, true);
select public.book_coachee_peer_session(
  'f2000000-0000-0000-0000-000000000004'::uuid,
  'f2000000-0000-0000-0000-0000000000e1'::uuid,
  'A with C', now() - interval '1 day', 45, null);

select is(
  (select d.ordinal from public.peer_session_participants p
     join public.cohort_requirement_dates d on d.id = p.cohort_requirement_id
    where p.peer_session_id = (select id from public.coachee_peer_sessions where topic = 'A with C')
      and p.user_id = 'f2000000-0000-0000-0000-000000000001'::uuid),
  2, 'the receiver advances to their OWN next unfulfilled unit');

select is(
  (select d.ordinal from public.peer_session_participants p
     join public.cohort_requirement_dates d on d.id = p.cohort_requirement_id
    where p.peer_session_id = (select id from public.coachee_peer_sessions where topic = 'A with C')
      and p.user_id = 'f2000000-0000-0000-0000-000000000004'::uuid),
  1, 'the provider takes their own unit 1: neither side inherits the other''s position');

-- ---------------------------------------------------------------------------
-- Eligibility is read through the REQUESTED enrollment, never user history
-- ---------------------------------------------------------------------------

insert into public.programme_enrollments (id, programme_id, user_id, cohort_id, status, start_date, end_date)
values ('f2000000-0000-0000-0000-0000000000e8'::uuid, 'f2000000-0000-0000-0000-00000000a0a0'::uuid,
        'f2000000-0000-0000-0000-000000000008'::uuid, 'f2000000-0000-0000-0000-00000000b0a0'::uuid,
        'active', current_date - 100, current_date - 60);
update public.programme_enrollments set status = 'completed'
 where id = 'f2000000-0000-0000-0000-0000000000e8'::uuid;
insert into public.programme_enrollments (id, programme_id, user_id, cohort_id, status, start_date, end_date)
values ('f2000000-0000-0000-0000-0000000000e9'::uuid, 'f2000000-0000-0000-0000-00000000a0a0'::uuid,
        'f2000000-0000-0000-0000-000000000008'::uuid, 'f2000000-0000-0000-0000-00000000b0e0'::uuid,
        'active', current_date - 50, current_date + 200);

select set_config('request.jwt.claims',
  json_build_object('sub', 'f2000000-0000-0000-0000-000000000008')::text, true);

select is(
  (select count(*)::int from public.eligible_peer_partners('f2000000-0000-0000-0000-0000000000e9'::uuid)
    where cohort_id <> 'f2000000-0000-0000-0000-00000000b0e0'::uuid),
  0, 'a closed enrollment in cohort A grants this learner nothing through their current cohort E enrollment');

select ok(
  not public.peer_partner_is_eligible(
    'f2000000-0000-0000-0000-0000000000e9'::uuid, 'f2000000-0000-0000-0000-000000000003'::uuid),
  'and they cannot book cohort B, which only their HISTORICAL cohort could reach');

-- A learner may not resolve somebody else's partner pool.
select throws_ok($$
  select * from public.eligible_peer_partners('f2000000-0000-0000-0000-0000000000e1'::uuid)
$$, '42501', NULL, 'one learner cannot enumerate another learner''s eligible partners');

-- ---------------------------------------------------------------------------
-- Lifecycle: one operational path, no artefact gates
-- ---------------------------------------------------------------------------

select set_config('request.jwt.claims',
  json_build_object('sub', 'f2000000-0000-0000-0000-000000000002')::text, true);
select public.book_coachee_peer_session(
  'f2000000-0000-0000-0000-000000000005'::uuid,
  'f2000000-0000-0000-0000-0000000000e2'::uuid,
  'lifecycle', now() - interval '1 day', 45, null);

-- pending -> completed is not a transition; it has to be confirmed first.
select throws_ok($$
  select public.transition_peer_session_status('coachee_peer',
    (select id from public.coachee_peer_sessions where topic = 'lifecycle'), 'completed')
$$, '23514', NULL, 'a pending Peer session cannot jump straight to completed');

-- The requester cannot accept on the provider's behalf.
select throws_ok($$
  select public.transition_peer_session_status('coachee_peer',
    (select id from public.coachee_peer_sessions where topic = 'lifecycle'), 'confirmed')
$$, '42501', NULL, 'the learner who asked cannot confirm their own request');

select set_config('request.jwt.claims',
  json_build_object('sub', 'f2000000-0000-0000-0000-000000000005')::text, true);
select public.transition_peer_session_status('coachee_peer',
  (select id from public.coachee_peer_sessions where topic = 'lifecycle'), 'confirmed');

-- No reflection, no feedback, no rating, no goal, no action exists for this
-- session. Completion must still be allowed and must still count.
select lives_ok($$
  select public.transition_peer_session_status('coachee_peer',
    (select id from public.coachee_peer_sessions where topic = 'lifecycle'), 'completed')
$$, 'completion records that the meeting happened; artefacts gate nothing');

select is(
  (select completed_units from public.canonical_module_progress('f2000000-0000-0000-0000-0000000000e2'::uuid, current_date)
    where module = 'peer_coaching'),
  1, 'a completed session with no reflection still counts for the receiver');

select is(
  (select completed_units from public.canonical_module_progress('f2000000-0000-0000-0000-0000000000e5'::uuid, current_date)
    where module = 'peer_coaching'),
  1, 'and independently counts for the provider');

-- ---------------------------------------------------------------------------
-- Cancellation counts for nothing, and RELEASES the requirement
-- ---------------------------------------------------------------------------

-- A2 completed unit 1 above; this booking (into granted cohort D) takes
-- unit 2, so the next free unit is 3 while it is live.
select set_config('request.jwt.claims',
  json_build_object('sub', 'f2000000-0000-0000-0000-000000000002')::text, true);
select public.book_coachee_peer_session(
  'f2000000-0000-0000-0000-000000000005'::uuid,
  'f2000000-0000-0000-0000-0000000000e2'::uuid,
  'to cancel', now() - interval '1 day', 45, null);

select is(
  (select ordinal from public.next_peer_requirement('f2000000-0000-0000-0000-0000000000e2'::uuid)),
  3, 'while live, the booking owns unit 2 and the next free unit is 3');

select public.transition_peer_session_status('coachee_peer',
  (select id from public.coachee_peer_sessions where topic = 'to cancel'), 'cancelled', 'could not make it');

select is(
  (select ordinal from public.next_peer_requirement('f2000000-0000-0000-0000-0000000000e2'::uuid)),
  2, 'cancelling releases the unit: it is bookable again, not consumed forever');

select is(
  (select completed_units from public.canonical_module_progress('f2000000-0000-0000-0000-0000000000e2'::uuid, current_date)
    where module = 'peer_coaching'),
  1, 'and a cancelled session adds nothing to progress: only unit 1 stands');

-- The record of what the cancelled meeting was for is kept, not deleted.
select ok(
  exists (select 1 from public.peer_session_participants p
           where p.peer_session_id = (select id from public.coachee_peer_sessions where topic = 'to cancel')
             and p.cohort_requirement_id is not null
             and p.session_status = 'cancelled'::public.session_status),
  'the cancelled participation still names the unit it was aimed at: history is kept, ownership is not');

-- ---------------------------------------------------------------------------
-- One enrollment cannot fulfil one requirement twice
-- ---------------------------------------------------------------------------

select throws_ok($$
  insert into public.peer_session_participants
    (session_kind, peer_session_id, user_id, enrollment_id, participant_role, cohort_requirement_id)
  values ('coachee_peer',
          (select id from public.coachee_peer_sessions where topic = 'lifecycle'),
          'f2000000-0000-0000-0000-000000000004'::uuid,
          'f2000000-0000-0000-0000-0000000000e4'::uuid, 'provider',
          (select cohort_requirement_id from public.peer_session_participants
            where peer_session_id = (select id from public.coachee_peer_sessions where topic = 'A with C')
              and user_id = 'f2000000-0000-0000-0000-000000000004'::uuid))
$$, '23505', NULL, 'a second live participation cannot claim a unit this enrollment already holds');

-- ---------------------------------------------------------------------------
-- Withdrawing a grant stops FUTURE selection and rewrites no history
-- ---------------------------------------------------------------------------

delete from public.peer_cohort_permissions
 where source_cohort_id = 'f2000000-0000-0000-0000-00000000b0a0'::uuid
   and allowed_peer_cohort_id = 'f2000000-0000-0000-0000-00000000b0b0'::uuid;

select set_config('request.jwt.claims',
  json_build_object('sub', 'f2000000-0000-0000-0000-000000000001')::text, true);

select ok(
  not public.peer_partner_is_eligible(
    'f2000000-0000-0000-0000-0000000000e1'::uuid, 'f2000000-0000-0000-0000-000000000003'::uuid),
  'once the grant is withdrawn, that partner can no longer be selected');

select ok(
  exists (select 1 from public.coachee_peer_sessions where topic = 'A with B'),
  'the session booked while the grant stood is untouched by its withdrawal');

select is(
  (select count(*)::int from public.peer_session_participants p
    where p.peer_session_id = (select id from public.coachee_peer_sessions where topic = 'A with B')
      and p.cohort_requirement_id is not null),
  2, 'and both participants keep the units that session was attributed to');

-- ---------------------------------------------------------------------------
-- Diagnostics expose unresolved configuration rather than hiding it
-- ---------------------------------------------------------------------------

-- Cohort D is granted to A but has no learner willing to peer: the grant is
-- live and produces nobody.
update public.profiles set peer_coaching_opt_in = false
 where id = 'f2000000-0000-0000-0000-000000000005'::uuid;

select ok(
  exists (select 1 from public.peer_cohort_permission_issues()
           where allowed_peer_cohort_id = 'f2000000-0000-0000-0000-00000000b0d0'::uuid
             and issue = 'the granted cohort has no eligible learner'),
  'a grant that can never produce a partner is reported, not silently ignored');

select * from finish();
rollback;
