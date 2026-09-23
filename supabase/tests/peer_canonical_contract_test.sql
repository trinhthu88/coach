-- Peer canonical architecture contract.
--
-- One real Peer meeting, two participants, each attributed to their OWN
-- enrollment and their OWN Peer requirement. Partner eligibility is the
-- Admin-assigned dyad (exactly two enrollments, 20260929100000); the legacy
-- cross-cohort permission pool is no longer a booking authority.
--
-- Every Peer requirement below carries an explicit, Admin-set due date
-- (cohort_requirement_dates.due_on, is_overridden). The module deadline is
-- only the default a row starts at; nothing here relies on it.
--
--   Cohort A  Peer 1 due today - 3, Peer 2 due today - 1  (both past)
--   Cohort B  Peer 1 due today + 30, Peer 2 due today + 60 (both future)
--   Cohort H  a finished cohort: Peer 1 due today - 140, Peer 2 due today - 110
begin;

select plan(19);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_user_meta_data, created_at, updated_at, confirmation_token, email_change_token_new, recovery_token)
select ('f1000000-0000-0000-0000-00000000000' || n)::uuid, '00000000-0000-0000-0000-000000000000'::uuid,
  'authenticated', 'authenticated', 'peer-canon-' || n || '@example.test', 'test', now(),
  jsonb_build_object('full_name', 'Peer Person ' || n), now(), now(), '', '', ''
from generate_series(1, 6) n;
-- 1 = learner A (cohort A)   2 = learner B (cohort B, in no dyad with A)
-- 3 = learner C (cohort A)   4 = learner with a historical and a current enrollment
-- 5 = learner in the finished cohort H   6 = Admin

insert into public.user_roles (user_id, role)
select ('f1000000-0000-0000-0000-00000000000' || n)::uuid, 'coachee'
from generate_series(1, 5) n on conflict do nothing;
insert into public.user_roles (user_id, role)
values ('f1000000-0000-0000-0000-000000000006'::uuid, 'admin') on conflict do nothing;

-- Usable accounts: the signup trigger leaves new profiles at pending_approval.
update public.profiles set peer_coaching_opt_in = true, status = 'active'::public.user_status
 where id in (select ('f1000000-0000-0000-0000-00000000000' || n)::uuid from generate_series(1, 5) n);

insert into public.programmes (id, name)
  values ('f1000000-0000-0000-0000-00000000a0a0'::uuid, 'Peer Canon Programme');
-- The PROGRAMME says how many Peer units are required.
insert into public.programme_modules (programme_id, module, enabled, config)
  values ('f1000000-0000-0000-0000-00000000a0a0'::uuid, 'peer_coaching', true,
          '{"required": true, "required_units": 2, "monthly_limit": 20}'::jsonb);

insert into public.cohorts (id, name, programme_id, start_date, end_date) values
  ('f1000000-0000-0000-0000-00000000b0b0'::uuid, 'Peer Cohort A',
   'f1000000-0000-0000-0000-00000000a0a0'::uuid, current_date - 200, current_date + 200),
  ('f1000000-0000-0000-0000-00000000b1b1'::uuid, 'Peer Cohort B',
   'f1000000-0000-0000-0000-00000000a0a0'::uuid, current_date - 200, current_date + 200),
  ('f1000000-0000-0000-0000-00000000b2b2'::uuid, 'Peer Cohort H',
   'f1000000-0000-0000-0000-00000000a0a0'::uuid, current_date - 300, current_date - 100);

-- The COHORT says by when, one date per requirement. The programme requires
-- two units, so each cohort materialised two rows at its default; the Admin
-- then dates each row explicitly.
update public.cohort_requirement_dates d
   set due_on = v.due_on, is_overridden = true,
       generation_method = 'manual', materialized_via = 'admin_save'
  from (values
    ('f1000000-0000-0000-0000-00000000b0b0'::uuid, 1, current_date - 3),
    ('f1000000-0000-0000-0000-00000000b0b0'::uuid, 2, current_date - 1),
    ('f1000000-0000-0000-0000-00000000b1b1'::uuid, 1, current_date + 30),
    ('f1000000-0000-0000-0000-00000000b1b1'::uuid, 2, current_date + 60),
    ('f1000000-0000-0000-0000-00000000b2b2'::uuid, 1, current_date - 140),
    ('f1000000-0000-0000-0000-00000000b2b2'::uuid, 2, current_date - 110)) v(cohort_id, ordinal, due_on)
 where d.cohort_id = v.cohort_id
   and d.module = 'peer_coaching'::public.programme_module_type
   and d.ordinal = v.ordinal;

insert into public.programme_enrollments (id, programme_id, user_id, cohort_id, status, start_date, end_date) values
  ('f1000000-0000-0000-0000-0000000000e1'::uuid, 'f1000000-0000-0000-0000-00000000a0a0'::uuid,
   'f1000000-0000-0000-0000-000000000001'::uuid, 'f1000000-0000-0000-0000-00000000b0b0'::uuid,
   'active', current_date - 200, current_date + 200),
  ('f1000000-0000-0000-0000-0000000000e2'::uuid, 'f1000000-0000-0000-0000-00000000a0a0'::uuid,
   'f1000000-0000-0000-0000-000000000002'::uuid, 'f1000000-0000-0000-0000-00000000b1b1'::uuid,
   'active', current_date - 200, current_date + 200),
  ('f1000000-0000-0000-0000-0000000000e3'::uuid, 'f1000000-0000-0000-0000-00000000a0a0'::uuid,
   'f1000000-0000-0000-0000-000000000003'::uuid, 'f1000000-0000-0000-0000-00000000b0b0'::uuid,
   'active', current_date - 200, current_date + 200);

-- Booking goal gate (20260925400000): every receiver below needs a goal.
insert into public.coachee_goals (coachee_id, enrollment_id, title) values
  ('f1000000-0000-0000-0000-000000000001'::uuid, 'f1000000-0000-0000-0000-0000000000e1'::uuid, 'Booking gate goal'),
  ('f1000000-0000-0000-0000-000000000002'::uuid, 'f1000000-0000-0000-0000-0000000000e2'::uuid, 'Booking gate goal'),
  ('f1000000-0000-0000-0000-000000000003'::uuid, 'f1000000-0000-0000-0000-0000000000e3'::uuid, 'Booking gate goal');

-- The Admin assigns A and C to one dyad. B is deliberately left unpaired.
select set_config('request.jwt.claims',
  json_build_object('sub', 'f1000000-0000-0000-0000-000000000006')::text, true);
select public.admin_create_peer_dyad(
  'f1000000-0000-0000-0000-00000000b0b0'::uuid, 'f1000000-0000-0000-0000-00000000a0a0'::uuid,
  'f1000000-0000-0000-0000-0000000000e1'::uuid, 'f1000000-0000-0000-0000-0000000000e3'::uuid);

select set_config('request.jwt.claims',
  json_build_object('sub', 'f1000000-0000-0000-0000-000000000001')::text, true);

-- ---------------------------------------------------------------------------
-- Scenarios 1, 2, 8: one real session, two participants, two attributions
-- ---------------------------------------------------------------------------
--
-- Learner C provides; learner A receives. The session's enrollment_id is the
-- RECEIVER's, exactly as the legacy columns always meant. It is held 5 days
-- ago, inside Peer 1's window (available today - 17).
insert into public.coachee_peer_sessions
  (id, peer_provider_id, peer_receiver_id, enrollment_id, topic, start_time, duration_minutes, status)
values ('f1000000-0000-0000-0000-0000000000c1'::uuid,
        'f1000000-0000-0000-0000-000000000003'::uuid, 'f1000000-0000-0000-0000-000000000001'::uuid,
        'f1000000-0000-0000-0000-0000000000e1'::uuid, 'Shared peer session',
        now() - interval '5 days', 60, 'completed');

select is(
  (select count(*)::int from public.peer_session_participants
    where session_kind = 'coachee_peer'
      and peer_session_id = 'f1000000-0000-0000-0000-0000000000c1'::uuid),
  2, 'one real Peer session yields one participant row per person');

select is(
  (select enrollment_id from public.peer_session_participants
    where peer_session_id = 'f1000000-0000-0000-0000-0000000000c1'::uuid
      and user_id = 'f1000000-0000-0000-0000-000000000003'::uuid),
  'f1000000-0000-0000-0000-0000000000e3'::uuid,
  'the PROVIDER is attributed to their own enrollment through the dyad');

select is(
  (select array_agg(p.enrollment_id::text || ':' || d.ordinal order by p.participant_role)
     from public.peer_session_participants p
     join public.cohort_requirement_dates d on d.id = p.cohort_requirement_id
    where p.peer_session_id = 'f1000000-0000-0000-0000-0000000000c1'::uuid),
  array['f1000000-0000-0000-0000-0000000000e3:1', 'f1000000-0000-0000-0000-0000000000e1:1'],
  'each participant holds Peer 1 of their OWN enrollment: neither borrows the other''s');

select ok(
  (select fulfilled_on is not null
     from public.canonical_peer_requirement_fulfilment('f1000000-0000-0000-0000-0000000000e1'::uuid)
    where ordinal = 1),
  'the completed session fulfils the receiver''s own requirement');

select ok(
  (select fulfilled_on is not null
     from public.canonical_peer_requirement_fulfilment('f1000000-0000-0000-0000-0000000000e3'::uuid)
    where ordinal = 1),
  'and independently fulfils the provider''s own requirement');

-- ---------------------------------------------------------------------------
-- Partner eligibility is the Admin-assigned dyad
-- ---------------------------------------------------------------------------
select is(
  (select array_agg(enrollment_id::text) from public.eligible_peer_partners('f1000000-0000-0000-0000-0000000000e1'::uuid)),
  array['f1000000-0000-0000-0000-0000000000e3'],
  'the only eligible partner is the assigned dyad partner');

select set_config('request.jwt.claims',
  json_build_object('sub', 'f1000000-0000-0000-0000-000000000002')::text, true);
select throws_ok($$
  insert into public.coachee_peer_sessions
    (peer_provider_id, peer_receiver_id, enrollment_id, topic, start_time, duration_minutes, status)
  values ('f1000000-0000-0000-0000-000000000001'::uuid, 'f1000000-0000-0000-0000-000000000002'::uuid,
          'f1000000-0000-0000-0000-0000000000e2'::uuid, 'Not my dyad', now() + interval '2 days', 60, 'confirmed')
$$, NULL, NULL, 'a learner cannot book a Peer session with someone outside their dyad');

select is(
  (select count(*)::int from public.eligible_peer_partners('f1000000-0000-0000-0000-0000000000e2'::uuid)),
  0, 'an enrollment with no assigned dyad has no Peer partner at all');

-- ---------------------------------------------------------------------------
-- Scenario 6: post-session artefacts do not gate completion
-- ---------------------------------------------------------------------------
select is(
  (select completed_units from public.canonical_module_progress('f1000000-0000-0000-0000-0000000000e1'::uuid, current_date)
    where module = 'peer_coaching'),
  1, 'a completed session with no reflection and no feedback still counts');

-- ---------------------------------------------------------------------------
-- Scenario 9: an early completed unit must not mask a later overdue one
-- ---------------------------------------------------------------------------
select is(
  (select array[required_units, completed_units, due_units, overdue_units]
     from public.canonical_module_progress('f1000000-0000-0000-0000-0000000000e1'::uuid, current_date)
    where module = 'peer_coaching'),
  array[2, 1, 2, 1],
  'both Peer dates are past: required 2, completed 1, due 2, overdue 1');

select is(
  (select array[required_units, completed_units, due_units, overdue_units]
     from public.canonical_module_progress('f1000000-0000-0000-0000-0000000000e1'::uuid, current_date - 2)
    where module = 'peer_coaching'),
  array[2, 1, 1, 0],
  'read two days ago only Peer 1 was due, and it was done: nothing overdue');

-- ---------------------------------------------------------------------------
-- Scenarios 4 and 5: only completed sessions fulfil
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims',
  json_build_object('sub', 'f1000000-0000-0000-0000-000000000003')::text, true);
insert into public.coachee_peer_sessions
  (id, peer_provider_id, peer_receiver_id, enrollment_id, topic, start_time, duration_minutes, status)
values ('f1000000-0000-0000-0000-0000000000c2'::uuid,
        'f1000000-0000-0000-0000-000000000001'::uuid, 'f1000000-0000-0000-0000-000000000003'::uuid,
        'f1000000-0000-0000-0000-0000000000e3'::uuid, 'Confirmed only',
        now() + interval '3 days', 60, 'confirmed');

select is(
  (select completed_units from public.canonical_module_progress('f1000000-0000-0000-0000-0000000000e3'::uuid, current_date)
    where module = 'peer_coaching'),
  1, 'a confirmed session fulfils nothing: C still has only the unit they provided');

-- ---------------------------------------------------------------------------
-- Scenario 7: enrollment-first duplicate protection (while C2 is live)
-- ---------------------------------------------------------------------------
select throws_ok($$
  update public.peer_session_participants
     set cohort_requirement_id = (select id from public.cohort_requirement_dates
                                  where cohort_id = 'f1000000-0000-0000-0000-00000000b0b0'::uuid
                                    and module = 'peer_coaching'::public.programme_module_type and ordinal = 1)
   where peer_session_id = 'f1000000-0000-0000-0000-0000000000c2'::uuid
     and user_id = 'f1000000-0000-0000-0000-000000000001'::uuid
$$, '23505', NULL, 'one enrollment cannot hold the same Peer requirement twice');

select set_config('app.session_transition', 'on', true);
update public.coachee_peer_sessions set status = 'cancelled'
 where id = 'f1000000-0000-0000-0000-0000000000c2'::uuid;

select is(
  (select completed_units from public.canonical_module_progress('f1000000-0000-0000-0000-0000000000e3'::uuid, current_date)
    where module = 'peer_coaching'),
  1, 'a cancelled session fulfils nothing');

-- A participant may never be attributed to another cohort's requirement.
select throws_ok($$
  update public.peer_session_participants
     set cohort_requirement_id = (select id from public.cohort_requirement_dates
                                  where cohort_id = 'f1000000-0000-0000-0000-00000000b1b1'::uuid
                                    and module = 'peer_coaching'::public.programme_module_type and ordinal = 1)
   where peer_session_id = 'f1000000-0000-0000-0000-0000000000c1'::uuid
     and user_id = 'f1000000-0000-0000-0000-000000000001'::uuid
$$, '42501', NULL, 'a participant cannot borrow another cohort''s requirement');

-- ---------------------------------------------------------------------------
-- Scenario 3: historical enrollment isolation
-- ---------------------------------------------------------------------------
--
-- Learner 4 held an enrollment in the finished cohort H, paired there with
-- learner 5, and now holds a current one in cohort B. Participation recorded
-- against the historical enrollment must never satisfy the current one.
-- Created active so the session can be recorded, then closed: that is the real
-- sequence, and the booking gate refuses a closed enrollment.
insert into public.programme_enrollments (id, programme_id, user_id, cohort_id, status, start_date, end_date) values
  ('f1000000-0000-0000-0000-0000000000e4'::uuid, 'f1000000-0000-0000-0000-00000000a0a0'::uuid,
   'f1000000-0000-0000-0000-000000000004'::uuid, 'f1000000-0000-0000-0000-00000000b2b2'::uuid,
   'active', current_date - 300, current_date - 100),
  ('f1000000-0000-0000-0000-0000000000e6'::uuid, 'f1000000-0000-0000-0000-00000000a0a0'::uuid,
   'f1000000-0000-0000-0000-000000000005'::uuid, 'f1000000-0000-0000-0000-00000000b2b2'::uuid,
   'active', current_date - 300, current_date - 100);
insert into public.coachee_goals (coachee_id, enrollment_id, title)
values ('f1000000-0000-0000-0000-000000000004'::uuid, 'f1000000-0000-0000-0000-0000000000e4'::uuid, 'Booking gate goal');

select set_config('request.jwt.claims',
  json_build_object('sub', 'f1000000-0000-0000-0000-000000000006')::text, true);
select public.admin_create_peer_dyad(
  'f1000000-0000-0000-0000-00000000b2b2'::uuid, 'f1000000-0000-0000-0000-00000000a0a0'::uuid,
  'f1000000-0000-0000-0000-0000000000e4'::uuid, 'f1000000-0000-0000-0000-0000000000e6'::uuid);

-- Held 150 days ago: inside cohort H's Peer 1 window (available today - 154).
select set_config('request.jwt.claims',
  json_build_object('sub', 'f1000000-0000-0000-0000-000000000004')::text, true);
insert into public.coachee_peer_sessions
  (id, peer_provider_id, peer_receiver_id, enrollment_id, topic, start_time, duration_minutes, status)
values ('f1000000-0000-0000-0000-0000000000c3'::uuid,
        'f1000000-0000-0000-0000-000000000005'::uuid, 'f1000000-0000-0000-0000-000000000004'::uuid,
        'f1000000-0000-0000-0000-0000000000e4'::uuid, 'Historical',
        now() - interval '150 days', 60, 'completed');

update public.programme_enrollments set status = 'completed'
 where id in ('f1000000-0000-0000-0000-0000000000e4'::uuid, 'f1000000-0000-0000-0000-0000000000e6'::uuid);

insert into public.programme_enrollments (id, programme_id, user_id, cohort_id, status, start_date, end_date)
values ('f1000000-0000-0000-0000-0000000000e5'::uuid, 'f1000000-0000-0000-0000-00000000a0a0'::uuid,
        'f1000000-0000-0000-0000-000000000004'::uuid, 'f1000000-0000-0000-0000-00000000b1b1'::uuid,
        'active', current_date - 50, current_date + 200);

select is(
  (select completed_units from public.canonical_module_progress('f1000000-0000-0000-0000-0000000000e5'::uuid, current_date)
    where module = 'peer_coaching'),
  0, 'the historical enrollment''s Peer session never satisfies the current enrollment');

select is(
  (select completed_units from public.canonical_module_progress('f1000000-0000-0000-0000-0000000000e4'::uuid, current_date)
    where module = 'peer_coaching'),
  1, 'it satisfies the historical enrollment it actually belongs to');

select is(
  (select count(*)::int from public.peer_session_participants
    where peer_session_id = 'f1000000-0000-0000-0000-0000000000c3'::uuid and enrollment_id is not null),
  2, 'closing the enrollments leaves the historical participation and its attribution untouched');

-- ---------------------------------------------------------------------------
-- Diagnostic reports the malformed PARTICIPANT, not the whole session
-- ---------------------------------------------------------------------------
select ok(
  not exists (
    select 1 from public.peer_participants_without_requirement() d
    where d.peer_session_id = 'f1000000-0000-0000-0000-0000000000c1'::uuid
      and d.enrollment_id is not null),
  'a fully attributed session reports no malformed participant');

select * from finish();
rollback;
