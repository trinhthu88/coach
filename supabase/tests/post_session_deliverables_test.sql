-- Post-session deliverables and cross-module satisfaction (20260925500000).
--
-- One fixture with a completed session in every module, both Peer roles and
-- a Triad member. Proves:
--   * learner_session_deliverables is ONE row per completed session the
--     enrollment took part in, across Coaching, Peer (receiver AND provider),
--     Mentoring and Triads, and never includes an unfinished session;
--   * each deliverable is read from the shared stores (reflection, goal
--     check-in, action, own 1-5 rating), keyed to the participant's OWN
--     enrollment -- the provider's evidence never lands on the receiver;
--   * legacy notes (mentee_notes, receiver_notes) and Triad answers reach the
--     one reflection store;
--   * coaching_session_evidence agrees with the shared rule;
--   * canonical_enrollment_engagement averages the learner's own ratings
--     across all four modules, completed sessions only;
--   * the writers refuse a non-participant and another learner's enrollment.
begin;

select plan(35);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_user_meta_data, created_at, updated_at, confirmation_token, email_change_token_new, recovery_token)
select ('a6000000-0000-0000-0000-00000000000' || n)::uuid, '00000000-0000-0000-0000-000000000000'::uuid,
  'authenticated', 'authenticated', 'deliverables-' || n || '@example.test', 'test', now(),
  jsonb_build_object('full_name', 'Deliverables ' || n), now(), now(), '', '', ''
from generate_series(1, 9) n;

insert into public.user_roles (user_id, role) values
  ('a6000000-0000-0000-0000-000000000009', 'coach'), ('a6000000-0000-0000-0000-000000000008', 'coach');
insert into public.coach_profiles (id, approval_status, peer_coaching_opt_in) values
  ('a6000000-0000-0000-0000-000000000009', 'active', false), ('a6000000-0000-0000-0000-000000000008', 'active', false);

insert into public.organizations (id, name) values ('b6000000-0000-0000-0000-000000000001', 'Deliverables org');
insert into public.programmes (id, name) values ('c6000000-0000-0000-0000-000000000001', 'Deliverables programme');
insert into public.cohorts (id, name, programme_id, organization_id, start_date, end_date)
values ('d6000000-0000-0000-0000-000000000001', 'Deliverables cohort', 'c6000000-0000-0000-0000-000000000001',
  'b6000000-0000-0000-0000-000000000001', date '2026-01-05', date '2026-07-05');
insert into public.programme_modules (programme_id, module, enabled, config) values
  ('c6000000-0000-0000-0000-000000000001', 'coaching', true, '{"required":true,"required_units":2,"receive_limit":5,"distribution_settings":{}}'),
  ('c6000000-0000-0000-0000-000000000001', 'peer_coaching', true, '{"required":true,"required_units":2,"distribution_settings":{}}'),
  ('c6000000-0000-0000-0000-000000000001', 'mentoring', true, '{"required":true,"required_units":1,"distribution_settings":{}}'),
  ('c6000000-0000-0000-0000-000000000001', 'triads', true, '{"required":true,"required_units":2,"distribution_settings":{}}');

insert into public.programme_enrollments (id, user_id, programme_id, cohort_id, organization_id, start_date, end_date, status)
select ('e6000000-0000-0000-0000-00000000000' || n)::uuid, ('a6000000-0000-0000-0000-00000000000' || n)::uuid,
  'c6000000-0000-0000-0000-000000000001', 'd6000000-0000-0000-0000-000000000001',
  'b6000000-0000-0000-0000-000000000001', date '2026-01-05', date '2026-07-05', 'active'
from generate_series(1, 3) n;

-- An active goal per learner: it makes the goal check-in a REQUIRED item and
-- satisfies the booking goal gate for the Peer inserts below.
insert into public.coachee_goals (id, coachee_id, enrollment_id, title)
select ('f6000000-0000-0000-0000-0000000009' || lpad(n::text, 2, '0'))::uuid,
  ('a6000000-0000-0000-0000-00000000000' || n)::uuid, ('e6000000-0000-0000-0000-00000000000' || n)::uuid, 'Goal ' || n
from generate_series(1, 3) n;

update public.profiles set peer_coaching_opt_in = true, status = 'active'::public.user_status
where id in ('a6000000-0000-0000-0000-000000000001', 'a6000000-0000-0000-0000-000000000002', 'a6000000-0000-0000-0000-000000000003');

insert into public.mentor_profiles (coach_user_id, is_active, bio)
values ('a6000000-0000-0000-0000-000000000008', true, 'Fixture mentor');
insert into public.cohort_mentors (cohort_id, mentor_user_id)
values ('d6000000-0000-0000-0000-000000000001', 'a6000000-0000-0000-0000-000000000008');
insert into public.cohort_coach_assignments (cohort_id, coach_id)
values ('d6000000-0000-0000-0000-000000000001', 'a6000000-0000-0000-0000-000000000009');

select set_config('request.jwt.claim.sub', 'a6000000-0000-0000-0000-000000000001', true);

-- Coaching: S1 fully evidenced below, S2 held with nothing written, S3 not held.
insert into public.sessions (id, coach_id, coachee_id, topic, start_time, duration_minutes, status, enrollment_id, coachee_rating)
values
  ('f6000000-0000-0000-0000-000000000001', 'a6000000-0000-0000-0000-000000000009', 'a6000000-0000-0000-0000-000000000001',
   'Coaching one', '2026-01-12T10:00:00Z', 60, 'completed', 'e6000000-0000-0000-0000-000000000001', 5),
  ('f6000000-0000-0000-0000-000000000002', 'a6000000-0000-0000-0000-000000000009', 'a6000000-0000-0000-0000-000000000001',
   'Coaching two', '2026-01-26T10:00:00Z', 60, 'completed', 'e6000000-0000-0000-0000-000000000001', null);

-- Peer: P1 learner 1 RECEIVES (with a legacy receiver note and rating 3);
-- P2 learner 1 PROVIDES to learner 2. Learners 1 and 2 are an assigned Peer
-- dyad (a learner Peer session needs one, 20260929100000).
insert into public.peer_dyads (id, cohort_id, programme_id, created_by)
values ('f6000000-0000-0000-0000-0000000000d1', 'd6000000-0000-0000-0000-000000000001', 'c6000000-0000-0000-0000-000000000001', 'a6000000-0000-0000-0000-000000000009');
insert into public.peer_dyad_members (dyad_id, enrollment_id) values
  ('f6000000-0000-0000-0000-0000000000d1', 'e6000000-0000-0000-0000-000000000001'),
  ('f6000000-0000-0000-0000-0000000000d1', 'e6000000-0000-0000-0000-000000000002');
insert into public.coachee_peer_sessions (id, peer_provider_id, peer_receiver_id, topic, start_time, duration_minutes, status, enrollment_id, receiver_notes, receiver_rating)
values ('f6000000-0000-0000-0000-000000000011', 'a6000000-0000-0000-0000-000000000002', 'a6000000-0000-0000-0000-000000000001',
  'Peer received', '2026-02-02T10:00:00Z', 60, 'completed', 'e6000000-0000-0000-0000-000000000001', 'Peer note: open questions helped.', 3);
select set_config('request.jwt.claim.sub', 'a6000000-0000-0000-0000-000000000002', true);
insert into public.coachee_peer_sessions (id, peer_provider_id, peer_receiver_id, topic, start_time, duration_minutes, status, enrollment_id)
values ('f6000000-0000-0000-0000-000000000012', 'a6000000-0000-0000-0000-000000000001', 'a6000000-0000-0000-0000-000000000002',
  'Peer given', '2026-02-09T10:00:00Z', 60, 'completed', 'e6000000-0000-0000-0000-000000000002');
select set_config('request.jwt.claim.sub', 'a6000000-0000-0000-0000-000000000001', true);

-- Mentoring: M1 completed with a legacy mentee note.
insert into public.mentoring_sessions (id, enrollment_id, mentor_id, mentee_id, topic, start_time, duration_minutes, status, mentee_notes)
values ('f6000000-0000-0000-0000-000000000021', 'e6000000-0000-0000-0000-000000000001', 'a6000000-0000-0000-0000-000000000008',
  'a6000000-0000-0000-0000-000000000001', 'Mentoring one', '2026-01-19T10:00:00Z', 60, 'completed',
  'Mentee note: map stakeholders earlier.');

-- Triads: T1 completed, T2 still confirmed (never a deliverable yet).
insert into public.triad_groups (id, cohort_requirement_date_id, is_active)
select g.id, d.id, true
from (values ('f6000000-0000-0000-0000-000000000030'::uuid, 1), ('f6000000-0000-0000-0000-000000000040'::uuid, 2)) g(id, ordinal)
join public.cohort_requirement_dates d on d.cohort_id = 'd6000000-0000-0000-0000-000000000001'
  and d.programme_id = 'c6000000-0000-0000-0000-000000000001' and d.module = 'triads' and d.ordinal = g.ordinal;
insert into public.triad_group_members (triad_group_id, enrollment_id, member_order)
select g, e, o from unnest(array['f6000000-0000-0000-0000-000000000030', 'f6000000-0000-0000-0000-000000000040']::uuid[]) g
cross join (values ('e6000000-0000-0000-0000-000000000001'::uuid, 1), ('e6000000-0000-0000-0000-000000000002'::uuid, 2),
                   ('e6000000-0000-0000-0000-000000000003'::uuid, 3)) m(e, o);
insert into public.triad_sessions (id, triad_group_id, scheduled_start_time, status)
values
  ('f6000000-0000-0000-0000-000000000031', 'f6000000-0000-0000-0000-000000000030', '2026-02-16T10:00:00Z', 'completed'),
  ('f6000000-0000-0000-0000-000000000032', 'f6000000-0000-0000-0000-000000000040', '2099-04-20T10:00:00Z', 'confirmed');
insert into public.triad_reflections (id, triad_session_id, enrollment_id, satisfaction_rating)
values ('f6000000-0000-0000-0000-000000000033', 'f6000000-0000-0000-0000-000000000031', 'e6000000-0000-0000-0000-000000000001', 2);
insert into public.triad_reflection_answers (triad_reflection_id, question_id, answer_text)
values ('f6000000-0000-0000-0000-000000000033', '7d1a0000-0000-4000-8000-000000000001', 'Triad answer: silence is useful.');

-- S1: every deliverable present (reflection, check-in, action, rating 5).
insert into public.session_learning_reflections (enrollment_id, source_activity_type, source_activity_id, body)
values ('e6000000-0000-0000-0000-000000000001', 'coaching', 'f6000000-0000-0000-0000-000000000001', 'Coaching reflection.');
insert into public.goal_checkins (enrollment_id, goal_id, source_activity_type, source_activity_id, previous_rating, new_rating, actor_user_id)
values ('e6000000-0000-0000-0000-000000000001', 'f6000000-0000-0000-0000-000000000901', 'coaching',
  'f6000000-0000-0000-0000-000000000001', 10, 20, 'a6000000-0000-0000-0000-000000000001');
-- A new action carries its goal and a due date (validate_enrollment_action, 20260929100000).
insert into public.enrollment_actions (enrollment_id, owner_user_id, source_activity_type, source_activity_id, title, goal_id, due_date)
values ('e6000000-0000-0000-0000-000000000001', 'a6000000-0000-0000-0000-000000000001', 'coaching',
  'f6000000-0000-0000-0000-000000000001', 'Try the new opener', 'f6000000-0000-0000-0000-000000000901', date '2026-03-01');

-- ===== Bridging (run as the migration owner) =====
select ok(exists(select 1 from public.session_learning_reflections
    where enrollment_id = 'e6000000-0000-0000-0000-000000000001' and source_activity_type = 'mentoring'
      and source_activity_id = 'f6000000-0000-0000-0000-000000000021' and body like 'Mentee note:%'),
  'a mentee note lands in the one reflection store');
select ok(exists(select 1 from public.session_learning_reflections
    where enrollment_id = 'e6000000-0000-0000-0000-000000000001' and source_activity_type = 'peer_coaching'
      and source_activity_id = 'f6000000-0000-0000-0000-000000000011'),
  'a peer receiver note lands in the one reflection store on the receiver''s enrollment');
select ok(exists(select 1 from public.session_learning_reflections
    where enrollment_id = 'e6000000-0000-0000-0000-000000000001' and source_activity_type = 'triads'
      and source_activity_id = 'f6000000-0000-0000-0000-000000000031' and body like 'Triad answer:%'),
  'Triad answers are mirrored into the one reflection store');
select throws_ok($$
  insert into public.session_learning_reflections (enrollment_id, source_activity_type, source_activity_id, body)
  values ('e6000000-0000-0000-0000-000000000003', 'mentoring', 'f6000000-0000-0000-0000-000000000021', 'not mine')
$$, '42501', null, 'a reflection cannot be filed against a Mentoring session the enrollment did not attend');
select throws_ok($$
  insert into public.session_learning_reflections (enrollment_id, source_activity_type, source_activity_id, body)
  values ('e6000000-0000-0000-0000-000000000003', 'peer_coaching', 'f6000000-0000-0000-0000-000000000012', 'not mine')
$$, '42501', null, 'a reflection cannot be filed against a Peer session the enrollment did not attend');

-- ===== Learner 1 =====
select set_config('request.jwt.claim.sub', 'a6000000-0000-0000-0000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

create temporary table d0 as
select * from public.learner_session_deliverables('e6000000-0000-0000-0000-000000000001');

select is((select count(*)::integer from d0), 6,
  'one row per completed session: 2 coaching + 2 peer + 1 mentoring + 1 triad');
select is((select count(*)::integer from d0 where session_id = 'f6000000-0000-0000-0000-000000000032'), 0,
  'a session that has not been held owes no deliverables yet');
select results_eq(
  $$select module::text, participant_role from d0 where module = 'peer_coaching' order by start_time$$,
  $$values ('peer_coaching'::text, 'receiver'::text), ('peer_coaching', 'provider')$$,
  'both Peer roles are the learner''s own deliverable rows');

select ok((select deliverables_complete from d0 where session_id = 'f6000000-0000-0000-0000-000000000001'),
  'coaching S1 with reflection, check-in, action and rating is complete');
select ok((select not (has_reflection or has_goal_checkin or has_action or has_satisfaction or deliverables_complete)
    from d0 where session_id = 'f6000000-0000-0000-0000-000000000002'),
  'coaching S2, held with nothing written, has every item outstanding');
select ok((select goal_checkin_required from d0 where session_id = 'f6000000-0000-0000-0000-000000000002'),
  'the goal check-in is required while the enrollment holds an active goal');
select is(
  (select row(evidence_complete, has_reflection, has_goal_checkin, has_action, has_satisfaction)::text
     from public.coaching_session_evidence('f6000000-0000-0000-0000-000000000001')),
  (select row(deliverables_complete, has_reflection, has_goal_checkin, has_action, has_satisfaction)::text
     from d0 where session_id = 'f6000000-0000-0000-0000-000000000001'),
  'coaching_session_evidence agrees with the shared deliverable rule');

select ok((select has_reflection and has_satisfaction and satisfaction_rating = 3 from d0 where session_id = 'f6000000-0000-0000-0000-000000000011'),
  'peer receiver: bridged reflection and own receiver rating count');
select ok((select not has_reflection and not has_action and not has_satisfaction from d0 where session_id = 'f6000000-0000-0000-0000-000000000012'),
  'peer provider starts with its own outstanding deliverables');
select ok((select has_reflection and not has_satisfaction from d0 where session_id = 'f6000000-0000-0000-0000-000000000021'),
  'mentoring: bridged mentee reflection counts; no mentee rating yet');
select ok((select has_reflection and satisfaction_rating = 2 from d0 where session_id = 'f6000000-0000-0000-0000-000000000031'),
  'triad: mirrored reflection and the reflection''s satisfaction count');

-- The provider completes their OWN deliverables on their OWN enrollment.
insert into public.session_learning_reflections (enrollment_id, source_activity_type, source_activity_id, body)
values ('e6000000-0000-0000-0000-000000000001', 'peer_coaching', 'f6000000-0000-0000-0000-000000000012', 'What I learned giving the session.');
select lives_ok($$
  select public.save_enrollment_activity_actions('e6000000-0000-0000-0000-000000000001', 'coachee_peer_coaching',
    'f6000000-0000-0000-0000-000000000012', '[{"title":"Practise silence","goal_id":"f6000000-0000-0000-0000-000000000901","due_date":"2026-03-01"}]'::jsonb)
$$, 'the providing learner records a follow-up action on their own enrollment');
select lives_ok($$
  select * from public.record_goal_checkins('e6000000-0000-0000-0000-000000000001', 'peer_coaching',
    'f6000000-0000-0000-0000-000000000012',
    '[{"goal_id":"f6000000-0000-0000-0000-000000000901","new_rating":40}]'::jsonb)
$$, 'the providing learner records a goal check-in on their own enrollment');
select lives_ok($$
  select public.submit_session_satisfaction('coachee_peer_sessions', 'f6000000-0000-0000-0000-000000000012',
    'e6000000-0000-0000-0000-000000000001', 4::smallint)
$$, 'the providing learner rates the session');
select lives_ok($$
  select public.submit_session_satisfaction('mentoring_sessions', 'f6000000-0000-0000-0000-000000000021',
    'e6000000-0000-0000-0000-000000000001', 5::smallint)
$$, 'the mentee rates the mentoring session');
select lives_ok($$
  select public.save_enrollment_activity_actions('e6000000-0000-0000-0000-000000000001', 'triad',
    'f6000000-0000-0000-0000-000000000031', '[{"title":"Observe one more session","goal_id":"f6000000-0000-0000-0000-000000000901","due_date":"2026-03-01"}]'::jsonb)
$$, 'a Triad member records a follow-up action on their own enrollment');

create temporary table d1 as
select * from public.learner_session_deliverables('e6000000-0000-0000-0000-000000000001');
select ok((select has_reflection and has_action and has_goal_checkin and satisfaction_rating = 4 and deliverables_complete
    from d1 where session_id = 'f6000000-0000-0000-0000-000000000012'),
  'the provider''s own deliverables are complete');
select ok((select has_action from d1 where session_id = 'f6000000-0000-0000-0000-000000000031'),
  'the Triad follow-up action counts');
select throws_ok($$
  select public.submit_session_satisfaction('coachee_peer_sessions', 'f6000000-0000-0000-0000-000000000012',
    'e6000000-0000-0000-0000-000000000002', 1::smallint)
$$, '42501', null, 'a learner cannot rate on another learner''s enrollment');
select throws_ok($$
  select public.submit_session_satisfaction('coachee_peer_sessions', 'f6000000-0000-0000-0000-000000000012',
    'e6000000-0000-0000-0000-000000000001', 9::smallint)
$$, '22023', null, 'a rating outside 1-5 is refused');
select is((select count(*)::integer from public.learner_session_deliverables('e6000000-0000-0000-0000-000000000002')), 0,
  'a learner cannot read another learner''s deliverables');

-- Per-session view: both participants, the caller marked, the partner's rating hidden.
select is((select count(*)::integer from public.session_deliverables('coachee_peer_sessions', 'f6000000-0000-0000-0000-000000000012')), 2,
  'the session view lists every participating enrollment');
select ok((select is_self and satisfaction_rating = 4 from public.session_deliverables('coachee_peer_sessions', 'f6000000-0000-0000-0000-000000000012')
    where enrollment_id = 'e6000000-0000-0000-0000-000000000001'),
  'the caller''s own row is marked and carries their rating');
select ok((select not is_self and not has_reflection and satisfaction_rating is null
    from public.session_deliverables('coachee_peer_sessions', 'f6000000-0000-0000-0000-000000000012')
    where enrollment_id = 'e6000000-0000-0000-0000-000000000002'),
  'the receiver''s row holds none of the provider''s evidence');

-- Satisfaction: own ratings across all four modules, completed sessions only.
-- Coaching 5, Peer receiver 3, Peer provider 4, Mentoring 5, Triad 2.
select results_eq(
  $$select satisfaction_rated_count, satisfaction_avg from public.learner_canonical_engagement('e6000000-0000-0000-0000-000000000001')$$,
  $$values (5, 3.80::numeric)$$,
  'satisfaction averages the learner''s own ratings across Coaching, Peer (both roles), Mentoring and Triads');
select is((select count(*)::integer from public.admin_enrollment_satisfaction(array['e6000000-0000-0000-0000-000000000001']::uuid[])), 0,
  'the admin satisfaction reader returns nothing to a non-admin');

-- A counterpart may not change the learner's rating.
reset role;
select set_config('request.jwt.claim.sub', 'a6000000-0000-0000-0000-000000000002', true);
set local role authenticated;
select is((select count(*)::integer from public.session_deliverables('coachee_peer_sessions', 'f6000000-0000-0000-0000-000000000012')
    where is_self), 1, 'the partner sees their own row as theirs');
select throws_ok($$
  update public.coachee_peer_sessions set provider_rating = 1 where id = 'f6000000-0000-0000-0000-000000000012'
$$, '42501', null, 'the receiver cannot change the provider''s rating');

-- The mentor may read the mentee's reflection; nobody else outside the pair.
reset role;
select set_config('request.jwt.claim.sub', 'a6000000-0000-0000-0000-000000000008', true);
set local role authenticated;
select is((select count(*)::integer from public.session_learning_reflections
    where source_activity_id = 'f6000000-0000-0000-0000-000000000021'), 1,
  'the mentor reads the mentee''s reflection on their session');

reset role;
select set_config('request.jwt.claim.sub', 'a6000000-0000-0000-0000-000000000003', true);
set local role authenticated;
select is((select count(*)::integer from public.session_learning_reflections
    where source_activity_id in ('f6000000-0000-0000-0000-000000000021', 'f6000000-0000-0000-0000-000000000012')), 0,
  'another learner reads no one else''s reflections');

select * from finish();
rollback;
