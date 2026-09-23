-- Peer partner eligibility, booking enforcement and lifecycle contract.
--
-- The learner Peer partner is the Admin-assigned dyad: exactly two active
-- enrollments of one cohort + programme (20260929100000, 20260930110000).
-- The legacy dynamic pool -- opted-in learners of the own cohort plus cohorts
-- granted through peer_cohort_permissions -- grants nothing any more. This
-- proves WHO may be the other enrollment, that the answer is enforced by the
-- database rather than by the client, and that the session lifecycle neither
-- loses a requirement nor counts one twice.
--
--   Cohort A (programme P): A1..A5.  Dyads A1-A3 and A2-A4; A5 unpaired.
--   Cohort B (programme P): B1.      A legacy grant A --> B still exists.
--   Cohort X (programme Q): X1.
--
-- Peer requirements carry explicit, Admin-set due dates (Cohort A: Peer 1..3
-- due today + 10, + 12, + 14, so their windows open at today - 4, - 2, 0).
begin;

select plan(39);

-- ---------------------------------------------------------------------------
-- Fixture
-- ---------------------------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_user_meta_data, created_at, updated_at, confirmation_token, email_change_token_new, recovery_token)
select ('f2000000-0000-0000-0000-00000000000' || n)::uuid, '00000000-0000-0000-0000-000000000000'::uuid,
  'authenticated', 'authenticated', 'peer-elig-' || n || '@example.test', 'test', now(),
  jsonb_build_object('full_name', 'Peer Elig ' || n), now(), now(), '', '', ''
from generate_series(1, 9) n;
-- 1 = A1  2 = A2  3 = A3  4 = A4  5 = A5  6 = B1  7 = X1
-- 8 = a learner with a CLOSED enrollment in A and a live one in B
-- 9 = Admin

insert into public.user_roles (user_id, role)
select ('f2000000-0000-0000-0000-00000000000' || n)::uuid, 'coachee'
from generate_series(1, 8) n on conflict do nothing;
insert into public.user_roles (user_id, role)
values ('f2000000-0000-0000-0000-000000000009'::uuid, 'admin') on conflict do nothing;

-- Usable accounts (the signup trigger leaves profiles at pending_approval).
-- Everyone is ALSO opted in: under the dyad model opting in grants nothing.
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

insert into public.cohorts (id, name, programme_id, start_date, end_date) values
  ('f2000000-0000-0000-0000-00000000b0a0'::uuid, 'Cohort A', 'f2000000-0000-0000-0000-00000000a0a0'::uuid, current_date - 100, current_date + 200),
  ('f2000000-0000-0000-0000-00000000b0b0'::uuid, 'Cohort B', 'f2000000-0000-0000-0000-00000000a0a0'::uuid, current_date - 100, current_date + 200),
  ('f2000000-0000-0000-0000-00000000b0f0'::uuid, 'Cohort X', 'f2000000-0000-0000-0000-00000000a1a1'::uuid, current_date - 100, current_date + 200);

update public.cohort_requirement_dates d
   set due_on = current_date + 8 + 2 * d.ordinal, is_overridden = true,
       generation_method = 'manual', materialized_via = 'admin_save'
 where d.cohort_id = 'f2000000-0000-0000-0000-00000000b0a0'::uuid
   and d.module = 'peer_coaching'::public.programme_module_type;

insert into public.programme_enrollments (id, programme_id, user_id, cohort_id, status, start_date, end_date)
select ('f2000000-0000-0000-0000-0000000000e' || n)::uuid,
  case when n = 7 then 'f2000000-0000-0000-0000-00000000a1a1' else 'f2000000-0000-0000-0000-00000000a0a0' end::uuid,
  ('f2000000-0000-0000-0000-00000000000' || n)::uuid,
  case when n <= 5 then 'f2000000-0000-0000-0000-00000000b0a0'
       when n = 6 then 'f2000000-0000-0000-0000-00000000b0b0'
       else 'f2000000-0000-0000-0000-00000000b0f0' end::uuid,
  'active', current_date - 100, current_date + 200
from generate_series(1, 7) n;

-- Booking goal gate (20260925400000): the cohorts started 100 days ago.
insert into public.coachee_goals (coachee_id, enrollment_id, title)
select ('f2000000-0000-0000-0000-00000000000' || n)::uuid, ('f2000000-0000-0000-0000-0000000000e' || n)::uuid, 'Booking gate goal'
from generate_series(1, 7) n;

-- A legacy grant, written as history. It must grant nothing.
insert into public.peer_cohort_permissions (source_cohort_id, allowed_peer_cohort_id)
values ('f2000000-0000-0000-0000-00000000b0a0'::uuid, 'f2000000-0000-0000-0000-00000000b0b0'::uuid);

-- ---------------------------------------------------------------------------
-- The Admin assigns the dyads; nobody else can
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims',
  json_build_object('sub', 'f2000000-0000-0000-0000-000000000001')::text, true);
select throws_ok($$
  select public.admin_create_peer_dyad('f2000000-0000-0000-0000-00000000b0a0'::uuid, 'f2000000-0000-0000-0000-00000000a0a0'::uuid,
    'f2000000-0000-0000-0000-0000000000e1'::uuid, 'f2000000-0000-0000-0000-0000000000e2'::uuid)
$$, '42501', NULL, 'a learner cannot pick their own Peer partner');

select set_config('request.jwt.claims',
  json_build_object('sub', 'f2000000-0000-0000-0000-000000000009')::text, true);
create temporary table dyad (name text primary key, id uuid);
insert into dyad values
  ('A1-A3', public.admin_create_peer_dyad('f2000000-0000-0000-0000-00000000b0a0'::uuid, 'f2000000-0000-0000-0000-00000000a0a0'::uuid,
    'f2000000-0000-0000-0000-0000000000e1'::uuid, 'f2000000-0000-0000-0000-0000000000e3'::uuid)),
  ('A2-A4', public.admin_create_peer_dyad('f2000000-0000-0000-0000-00000000b0a0'::uuid, 'f2000000-0000-0000-0000-00000000a0a0'::uuid,
    'f2000000-0000-0000-0000-0000000000e2'::uuid, 'f2000000-0000-0000-0000-0000000000e4'::uuid));
grant select on dyad to authenticated;

select is(
  (select count(*)::int from public.peer_dyad_members where dyad_id = (select id from dyad where name = 'A1-A3')),
  2, 'a dyad is exactly two enrollments');

select throws_ok($$
  insert into public.peer_dyad_members (dyad_id, enrollment_id)
  values ((select id from dyad where name = 'A1-A3'), 'f2000000-0000-0000-0000-0000000000e5'::uuid)
$$, '23514', NULL, 'a third member is refused');

select throws_ok($$
  select public.admin_create_peer_dyad('f2000000-0000-0000-0000-00000000b0a0'::uuid, 'f2000000-0000-0000-0000-00000000a0a0'::uuid,
    'f2000000-0000-0000-0000-0000000000e1'::uuid, 'f2000000-0000-0000-0000-0000000000e5'::uuid)
$$, '23505', NULL, 'an enrollment may belong to only one active dyad');

select throws_ok($$
  select public.admin_create_peer_dyad('f2000000-0000-0000-0000-00000000b0a0'::uuid, 'f2000000-0000-0000-0000-00000000a0a0'::uuid,
    'f2000000-0000-0000-0000-0000000000e5'::uuid, 'f2000000-0000-0000-0000-0000000000e6'::uuid)
$$, '42501', NULL, 'both members belong to the dyad''s own cohort and programme');

select throws_ok($$
  select public.admin_create_peer_dyad('f2000000-0000-0000-0000-00000000b0a0'::uuid, 'f2000000-0000-0000-0000-00000000a0a0'::uuid,
    'f2000000-0000-0000-0000-0000000000e5'::uuid, 'f2000000-0000-0000-0000-0000000000e5'::uuid)
$$, '23514', NULL, 'a dyad needs two different enrollments');

-- ---------------------------------------------------------------------------
-- The partner is the dyad partner, and nobody else
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims',
  json_build_object('sub', 'f2000000-0000-0000-0000-000000000001')::text, true);

select is(
  (select array_agg(user_id::text) from public.eligible_peer_partners('f2000000-0000-0000-0000-0000000000e1'::uuid)),
  array['f2000000-0000-0000-0000-000000000003'],
  'A1''s only partner is A3, the assigned dyad partner');

select ok(
  not public.peer_partner_is_eligible('f2000000-0000-0000-0000-0000000000e1'::uuid, 'f2000000-0000-0000-0000-000000000002'::uuid),
  'an opted-in learner of the SAME cohort is not a partner without a dyad');

select ok(
  not public.peer_partner_is_eligible('f2000000-0000-0000-0000-0000000000e1'::uuid, 'f2000000-0000-0000-0000-000000000006'::uuid),
  'the legacy A --> B grant grants nothing');

select is(
  (select count(*)::int from public.eligible_peer_partners('f2000000-0000-0000-0000-0000000000e5'::uuid)),
  0, 'an unpaired enrollment has no Peer partner at all');

select is(
  (select count(*)::int from public.eligible_peer_partners('f2000000-0000-0000-0000-0000000000e2'::uuid)),
  0, 'one learner cannot enumerate another learner''s partner');

select is(
  (select array_agg(a.attname::text order by a.attname)
     from pg_proc p
     join unnest(p.proallargtypes, p.proargnames) with ordinality as a(typ, attname, ord) on true
    where p.oid = 'public.eligible_peer_partners(uuid)'::regprocedure
      and a.attname <> 'p_enrollment_id'),
  array['cohort_id', 'cohort_name', 'display_name', 'enrollment_id',
        'is_own_cohort', 'programme_id', 'programme_name', 'user_id'],
  'the partner list exposes selection fields only -- no email, sponsor, goals or narrative');

-- The legacy graph is read-only history.
set local role authenticated;
select throws_ok($$
  insert into public.peer_cohort_permissions (source_cohort_id, allowed_peer_cohort_id)
  values ('f2000000-0000-0000-0000-00000000b0b0'::uuid, 'f2000000-0000-0000-0000-00000000b0a0'::uuid)
$$, '42501', NULL, 'nobody can write a new legacy cohort grant');
reset role;

select ok(
  to_regprocedure('public.peer_eligible_cohorts(uuid)') is null
  and to_regprocedure('public.peer_cohort_permission_issues()') is null,
  'the dynamic-pool helpers are gone');

-- ---------------------------------------------------------------------------
-- Booking is enforced server-side, on every path
-- ---------------------------------------------------------------------------
select lives_ok($$
  select public.book_coachee_peer_session(
    'f2000000-0000-0000-0000-000000000003'::uuid,
    'f2000000-0000-0000-0000-0000000000e1'::uuid,
    'A1 with A3', now() - interval '2 days', 45, null)
$$, 'a learner may book their dyad partner');

select is(
  (select array_agg(p.enrollment_id::text || ':' || d.ordinal order by p.participant_role)
     from public.peer_session_participants p
     join public.cohort_requirement_dates d on d.id = p.cohort_requirement_id
    where p.session_kind = 'coachee_peer'
      and p.peer_session_id = (select id from public.coachee_peer_sessions where topic = 'A1 with A3')),
  array['f2000000-0000-0000-0000-0000000000e3:1', 'f2000000-0000-0000-0000-0000000000e1:1'],
  'the session credits each side against its OWN enrollment');

select throws_ok($$
  select public.book_coachee_peer_session(
    'f2000000-0000-0000-0000-000000000002'::uuid,
    'f2000000-0000-0000-0000-0000000000e1'::uuid,
    'A1 with A2', now() - interval '2 days', 45, null)
$$, '42501', NULL, 'the booking RPC refuses a same-cohort learner outside the dyad');

select throws_ok($$
  select public.book_coachee_peer_session(
    'f2000000-0000-0000-0000-000000000006'::uuid,
    'f2000000-0000-0000-0000-0000000000e1'::uuid,
    'A1 with B1', now() - interval '2 days', 45, null)
$$, '42501', NULL, 'the booking RPC refuses a learner of a legacy-granted cohort');

-- The same attempt written straight at the table, with no RPC and no client.
select throws_ok($$
  insert into public.coachee_peer_sessions
    (peer_provider_id, peer_receiver_id, enrollment_id, topic, start_time, duration_minutes, status)
  values ('f2000000-0000-0000-0000-000000000002'::uuid, 'f2000000-0000-0000-0000-000000000001'::uuid,
          'f2000000-0000-0000-0000-0000000000e1'::uuid, 'direct bypass',
          now() - interval '2 days', 45, 'confirmed')
$$, '42501', NULL, 'a direct table insert is refused by the same dyad rule');

select throws_ok($$
  insert into public.coachee_peer_sessions
    (peer_provider_id, peer_receiver_id, enrollment_id, topic, start_time, duration_minutes, status)
  values ('f2000000-0000-0000-0000-000000000003'::uuid, 'f2000000-0000-0000-0000-000000000001'::uuid,
          'f2000000-0000-0000-0000-0000000000e2'::uuid, 'borrowed enrollment',
          now() - interval '2 days', 45, 'confirmed')
$$, '42501', NULL, 'the named enrollment must belong to the receiver');

-- ---------------------------------------------------------------------------
-- Eligibility is read through the REQUESTED enrollment, never user history
-- ---------------------------------------------------------------------------
insert into public.programme_enrollments (id, programme_id, user_id, cohort_id, status, start_date, end_date)
values ('f2000000-0000-0000-0000-0000000000e8'::uuid, 'f2000000-0000-0000-0000-00000000a0a0'::uuid,
        'f2000000-0000-0000-0000-000000000008'::uuid, 'f2000000-0000-0000-0000-00000000b0a0'::uuid,
        'active', current_date - 100, current_date - 60);
select set_config('request.jwt.claims',
  json_build_object('sub', 'f2000000-0000-0000-0000-000000000009')::text, true);
insert into dyad values
  ('A5-H', public.admin_create_peer_dyad('f2000000-0000-0000-0000-00000000b0a0'::uuid, 'f2000000-0000-0000-0000-00000000a0a0'::uuid,
    'f2000000-0000-0000-0000-0000000000e5'::uuid, 'f2000000-0000-0000-0000-0000000000e8'::uuid));
update public.programme_enrollments set status = 'completed'
 where id = 'f2000000-0000-0000-0000-0000000000e8'::uuid;
insert into public.programme_enrollments (id, programme_id, user_id, cohort_id, status, start_date, end_date)
values ('f2000000-0000-0000-0000-0000000000e9'::uuid, 'f2000000-0000-0000-0000-00000000a0a0'::uuid,
        'f2000000-0000-0000-0000-000000000008'::uuid, 'f2000000-0000-0000-0000-00000000b0b0'::uuid,
        'active', current_date - 50, current_date + 200);

select set_config('request.jwt.claims',
  json_build_object('sub', 'f2000000-0000-0000-0000-000000000008')::text, true);
select is(
  (select count(*)::int from public.eligible_peer_partners('f2000000-0000-0000-0000-0000000000e9'::uuid)),
  0, 'a dyad held by a closed enrollment gives the learner nothing through their current enrollment');

select set_config('request.jwt.claims',
  json_build_object('sub', 'f2000000-0000-0000-0000-000000000005')::text, true);
select ok(
  not public.can_book_coachee_peer_session('f2000000-0000-0000-0000-000000000008'::uuid, 'f2000000-0000-0000-0000-0000000000e5'::uuid),
  'and a dyad partner whose enrollment has ended can no longer be booked');

-- ---------------------------------------------------------------------------
-- Lifecycle: one operational path, no artefact gates
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims',
  json_build_object('sub', 'f2000000-0000-0000-0000-000000000002')::text, true);
select public.book_coachee_peer_session(
  'f2000000-0000-0000-0000-000000000004'::uuid,
  'f2000000-0000-0000-0000-0000000000e2'::uuid,
  'lifecycle', now() - interval '1 day', 45, null);

select throws_ok($$
  select public.transition_peer_session_status('coachee_peer',
    (select id from public.coachee_peer_sessions where topic = 'lifecycle'), 'completed')
$$, '23514', NULL, 'a pending Peer session cannot jump straight to completed');

select throws_ok($$
  select public.transition_peer_session_status('coachee_peer',
    (select id from public.coachee_peer_sessions where topic = 'lifecycle'), 'confirmed')
$$, '42501', NULL, 'the learner who asked cannot confirm their own request');

select set_config('request.jwt.claims',
  json_build_object('sub', 'f2000000-0000-0000-0000-000000000004')::text, true);
select public.transition_peer_session_status('coachee_peer',
  (select id from public.coachee_peer_sessions where topic = 'lifecycle'), 'confirmed');

select lives_ok($$
  select public.transition_peer_session_status('coachee_peer',
    (select id from public.coachee_peer_sessions where topic = 'lifecycle'), 'completed')
$$, 'completion records that the meeting happened; artefacts gate nothing');

select is(
  (select completed_units from public.canonical_module_progress('f2000000-0000-0000-0000-0000000000e2'::uuid, current_date)
    where module = 'peer_coaching'),
  1, 'a completed session with no reflection still counts for the receiver');

select is(
  (select completed_units from public.canonical_module_progress('f2000000-0000-0000-0000-0000000000e4'::uuid, current_date)
    where module = 'peer_coaching'),
  1, 'and independently counts for the provider');

-- ---------------------------------------------------------------------------
-- Cancellation counts for nothing, and RELEASES the requirement
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims',
  json_build_object('sub', 'f2000000-0000-0000-0000-000000000002')::text, true);
select public.book_coachee_peer_session(
  'f2000000-0000-0000-0000-000000000004'::uuid,
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

select ok(
  exists (select 1 from public.peer_session_participants p
           where p.peer_session_id = (select id from public.coachee_peer_sessions where topic = 'to cancel')
             and p.cohort_requirement_id is not null
             and p.session_status = 'cancelled'::public.session_status),
  'the cancelled participation still names the unit it was aimed at: history is kept, ownership is not');

-- ---------------------------------------------------------------------------
-- Closing a dyad stops FUTURE booking and rewrites no history
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims',
  json_build_object('sub', 'f2000000-0000-0000-0000-000000000002')::text, true);
select throws_ok($$ select public.admin_close_peer_dyad((select id from dyad where name = 'A2-A4')) $$,
  '42501', NULL, 'a learner cannot close their own dyad');

select set_config('request.jwt.claims',
  json_build_object('sub', 'f2000000-0000-0000-0000-000000000009')::text, true);
select lives_ok($$ select public.admin_close_peer_dyad((select id from dyad where name = 'A2-A4')) $$,
  'the Admin closes the A2-A4 dyad');

select set_config('request.jwt.claims',
  json_build_object('sub', 'f2000000-0000-0000-0000-000000000002')::text, true);
select throws_ok($$
  select public.book_coachee_peer_session(
    'f2000000-0000-0000-0000-000000000004'::uuid,
    'f2000000-0000-0000-0000-0000000000e2'::uuid,
    'after close', now() + interval '2 days', 45, null)
$$, '42501', NULL, 'once the dyad is closed, the former partner can no longer be booked');

select is(
  (select count(*)::int from public.peer_session_participants p
    where p.peer_session_id = (select id from public.coachee_peer_sessions where topic = 'lifecycle')
      and p.cohort_requirement_id is not null
      and p.session_status = 'completed'::public.session_status),
  2, 'the session completed while the dyad stood keeps both participants and their units');

select is(
  (select completed_units from public.canonical_module_progress('f2000000-0000-0000-0000-0000000000e4'::uuid, current_date)
    where module = 'peer_coaching'),
  1, 'and the former partner keeps the programme credit it earned');

-- The Admin re-pairs: A5's old dyad partner has left, so that dyad is closed
-- first -- an enrollment is in one active dyad at a time.
select set_config('request.jwt.claims',
  json_build_object('sub', 'f2000000-0000-0000-0000-000000000009')::text, true);
select public.admin_close_peer_dyad((select id from dyad where name = 'A5-H'));
insert into dyad values
  ('A2-A5', public.admin_create_peer_dyad('f2000000-0000-0000-0000-00000000b0a0'::uuid, 'f2000000-0000-0000-0000-00000000a0a0'::uuid,
    'f2000000-0000-0000-0000-0000000000e2'::uuid, 'f2000000-0000-0000-0000-0000000000e5'::uuid));

select throws_ok($$
  update public.peer_dyad_members set status = 'active', ended_at = null
   where dyad_id = (select id from dyad where name = 'A2-A4');
  update public.peer_dyads set status = 'active' where id = (select id from dyad where name = 'A2-A4')
$$, '23505', NULL, 'a closed dyad cannot be reopened while a member has another active dyad');

-- ---------------------------------------------------------------------------
-- One session, two participants, DIFFERENT requirement positions
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims',
  json_build_object('sub', 'f2000000-0000-0000-0000-000000000002')::text, true);
select public.book_coachee_peer_session(
  'f2000000-0000-0000-0000-000000000005'::uuid,
  'f2000000-0000-0000-0000-0000000000e2'::uuid,
  'A2 with A5', now() - interval '1 day', 45, null);

select is(
  (select array_agg(p.enrollment_id::text || ':' || d.ordinal order by p.participant_role)
     from public.peer_session_participants p
     join public.cohort_requirement_dates d on d.id = p.cohort_requirement_id
    where p.peer_session_id = (select id from public.coachee_peer_sessions where topic = 'A2 with A5')),
  array['f2000000-0000-0000-0000-0000000000e5:1', 'f2000000-0000-0000-0000-0000000000e2:2'],
  'the receiver advances to their OWN next unit (2) while the new partner takes their own unit 1');

-- ---------------------------------------------------------------------------
-- One enrollment cannot fulfil one requirement twice
-- ---------------------------------------------------------------------------
select throws_ok($$
  update public.peer_session_participants
     set cohort_requirement_id = (select cohort_requirement_id from public.peer_session_participants
                                   where peer_session_id = (select id from public.coachee_peer_sessions where topic = 'lifecycle')
                                     and user_id = 'f2000000-0000-0000-0000-000000000002'::uuid)
   where peer_session_id = (select id from public.coachee_peer_sessions where topic = 'A2 with A5')
     and user_id = 'f2000000-0000-0000-0000-000000000002'::uuid
$$, '23505', NULL, 'a second live participation cannot claim a unit this enrollment already holds');

select * from finish();
rollback;
