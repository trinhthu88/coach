-- Peer canonical architecture contract (Peer cutover, phase 1).
--
-- One real Peer meeting, two participants, each attributed to their OWN
-- enrollment and their OWN cohort Peer requirement. Before this, only the
-- receiving side carried an enrollment and Peer reached canonical progress
-- with requirement_due_on NULL, so an early completed unit masked a later
-- overdue one.
--
-- Cohort A's two Peer deadlines are both in the past; cohort B's are both in
-- the future. That asymmetry is what makes the due/overdue assertions mean
-- something, and it proves the two participants of one session sit at
-- genuinely different checkpoints.
begin;

select plan(16);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_user_meta_data, created_at, updated_at, confirmation_token, email_change_token_new, recovery_token)
select ('f1000000-0000-0000-0000-00000000000' || n)::uuid, '00000000-0000-0000-0000-000000000000'::uuid,
  'authenticated', 'authenticated', 'peer-canon-' || n || '@example.test', 'test', now(),
  jsonb_build_object('full_name', 'Peer Person ' || n), now(), now(), '', '', ''
from generate_series(1, 4) n;
-- 1 = learner A (cohort A)  2 = learner B (cohort B)
-- 3 = learner C (cohort A)  4 = learner with a historical and a current enrollment

insert into public.user_roles (user_id, role)
select ('f1000000-0000-0000-0000-00000000000' || n)::uuid, 'coachee'
from generate_series(1, 4) n on conflict do nothing;

-- Peer practice is an opt-in pool; every fixture learner opts in so the
-- existing booking gate admits them.
update public.profiles set peer_coaching_opt_in = true
 where id in ('f1000000-0000-0000-0000-000000000001'::uuid,
              'f1000000-0000-0000-0000-000000000002'::uuid,
              'f1000000-0000-0000-0000-000000000003'::uuid,
              'f1000000-0000-0000-0000-000000000004'::uuid);

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
   'f1000000-0000-0000-0000-00000000a0a0'::uuid, current_date - 200, current_date + 200);

-- The COHORT says by when the module must be complete. A's deadline is past;
-- B's is not. Both cohorts already have their two Peer requirements: the
-- programme requires two units, so the system materialised two rows on the
-- cohort end date. Moving the DEADLINE moves both of them.
update public.cohort_module_deadlines
   set completion_deadline = current_date - 10
 where cohort_id = 'f1000000-0000-0000-0000-00000000b0b0'::uuid
   and module = 'peer_coaching'::public.programme_module_type;

update public.cohort_module_deadlines
   set completion_deadline = current_date + 60
 where cohort_id = 'f1000000-0000-0000-0000-00000000b1b1'::uuid
   and module = 'peer_coaching'::public.programme_module_type;

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

select set_config('request.jwt.claims',
  json_build_object('sub', 'f1000000-0000-0000-0000-000000000001')::text, true);

-- ---------------------------------------------------------------------------
-- Scenarios 1, 2, 8: one real session, two participants, two requirements
-- ---------------------------------------------------------------------------
--
-- Learner B (cohort B) provides; learner A (cohort A) receives. The session's
-- enrollment_id is the RECEIVER's, exactly as the legacy columns always meant.
insert into public.coachee_peer_sessions
  (id, peer_provider_id, peer_receiver_id, enrollment_id, topic, start_time, duration_minutes, status)
values ('f1000000-0000-0000-0000-0000000000c1'::uuid,
        'f1000000-0000-0000-0000-000000000002'::uuid, 'f1000000-0000-0000-0000-000000000001'::uuid,
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
      and user_id = 'f1000000-0000-0000-0000-000000000002'::uuid),
  'f1000000-0000-0000-0000-0000000000e2'::uuid,
  'the PROVIDER is attributed to their own enrollment, which was previously invisible');

select isnt(
  (select cohort_requirement_id from public.peer_session_participants
    where peer_session_id = 'f1000000-0000-0000-0000-0000000000c1'::uuid
      and user_id = 'f1000000-0000-0000-0000-000000000001'::uuid),
  (select cohort_requirement_id from public.peer_session_participants
    where peer_session_id = 'f1000000-0000-0000-0000-0000000000c1'::uuid
      and user_id = 'f1000000-0000-0000-0000-000000000002'::uuid),
  'the two participants hold DIFFERENT requirements: neither borrows the other''s');

select ok(
  (select fulfilled_on is not null
     from public.canonical_peer_requirement_fulfilment('f1000000-0000-0000-0000-0000000000e1'::uuid)
    where ordinal = 1),
  'the completed session fulfils the receiver''s own cohort A requirement');

select ok(
  (select fulfilled_on is not null
     from public.canonical_peer_requirement_fulfilment('f1000000-0000-0000-0000-0000000000e2'::uuid)
    where ordinal = 1),
  'and independently fulfils the provider''s own cohort B requirement');

-- Cross-cohort structure is already valid: the two requirements belong to
-- different cohorts. Phase 2 adds the PERMISSION model, not the structure.
select is(
  (select count(distinct d.cohort_id)::int
     from public.peer_session_participants p
     join public.cohort_requirement_dates d on d.id = p.cohort_requirement_id
    where p.peer_session_id = 'f1000000-0000-0000-0000-0000000000c1'::uuid),
  2, 'one session already spans two cohorts'' requirements without schema change');

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
  'both cohort A deadlines are past: required 2, completed 1, due 2, overdue 1');

-- The provider's cohort B deadlines have NOT passed, so the same real session
-- leaves them with nothing overdue. Same session, different checkpoints.
select is(
  (select array[required_units, completed_units, due_units, overdue_units]
     from public.canonical_module_progress('f1000000-0000-0000-0000-0000000000e2'::uuid, current_date)
    where module = 'peer_coaching'),
  array[2, 1, 0, 0],
  'the provider''s own cohort deadlines are future: nothing due, nothing overdue');

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
  0, 'a confirmed session fulfils nothing');

select set_config('app.session_transition', 'on', true);
update public.coachee_peer_sessions set status = 'cancelled'
 where id = 'f1000000-0000-0000-0000-0000000000c2'::uuid;

select is(
  (select completed_units from public.canonical_module_progress('f1000000-0000-0000-0000-0000000000e3'::uuid, current_date)
    where module = 'peer_coaching'),
  0, 'a cancelled session fulfils nothing');

-- ---------------------------------------------------------------------------
-- Scenario 7: enrollment-first duplicate protection
-- ---------------------------------------------------------------------------
select throws_ok($$
  insert into public.peer_session_participants
    (session_kind, peer_session_id, user_id, enrollment_id, participant_role, cohort_requirement_id)
  values ('coachee_peer', 'f1000000-0000-0000-0000-0000000000c2'::uuid,
          'f1000000-0000-0000-0000-000000000001'::uuid, 'f1000000-0000-0000-0000-0000000000e1'::uuid,
          'provider', (select id from public.cohort_requirement_dates
                        where cohort_id = 'f1000000-0000-0000-0000-00000000b0b0'::uuid
                          and module = 'peer_coaching'::public.programme_module_type and ordinal = 1))
$$, '23505', NULL, 'one enrollment cannot hold the same Peer requirement twice');

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
-- Learner 4 holds a closed enrollment and a current one in different cohorts.
-- Participation recorded against the historical enrollment must never satisfy
-- the current one.
-- Created active so the session can be recorded, then closed: that is the real
-- sequence, and the booking gate refuses a closed enrollment.
insert into public.programme_enrollments (id, programme_id, user_id, cohort_id, status, start_date, end_date)
values ('f1000000-0000-0000-0000-0000000000e4'::uuid, 'f1000000-0000-0000-0000-00000000a0a0'::uuid,
        'f1000000-0000-0000-0000-000000000004'::uuid, 'f1000000-0000-0000-0000-00000000b0b0'::uuid,
        'active', current_date - 200, current_date - 100);

select set_config('request.jwt.claims',
  json_build_object('sub', 'f1000000-0000-0000-0000-000000000004')::text, true);
insert into public.coachee_peer_sessions
  (id, peer_provider_id, peer_receiver_id, enrollment_id, topic, start_time, duration_minutes, status)
values ('f1000000-0000-0000-0000-0000000000c3'::uuid,
        'f1000000-0000-0000-0000-000000000003'::uuid, 'f1000000-0000-0000-0000-000000000004'::uuid,
        'f1000000-0000-0000-0000-0000000000e4'::uuid, 'Historical',
        now() - interval '150 days', 60, 'completed');

update public.programme_enrollments set status = 'completed'
 where id = 'f1000000-0000-0000-0000-0000000000e4'::uuid;

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
