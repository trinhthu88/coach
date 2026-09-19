-- Triad canonical contract: programme -> cohort requirement unit -> group
-- (membership by enrollment) -> session -> completion evidence -> reflection.
-- Admin, Learner, Sponsor (and a coach enrolled as a learner) read the same
-- Triad facts; privacy may hide detail, never change a fact.
--
-- Cohort C1 (programme P, Triads required 2, custom dates):
--   unit 1 due today-30, unit 2 due today+30.
--   E1..E6 active, E7 completed (not eligible). E8 is in cohort C2 of the
--   same programme (never assignable to C1). E6's learner is also a coach.
begin;

select plan(97);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_user_meta_data, created_at, updated_at, confirmation_token, email_change_token_new, recovery_token)
select ('a8800000-0000-0000-0000-0000000000' || lpad(n::text, 2, '0'))::uuid, '00000000-0000-0000-0000-000000000000'::uuid,
  'authenticated', 'authenticated', 'triad-contract-' || n || '@example.test', 'test', now(),
  jsonb_build_object('full_name', 'Triad Learner ' || n), now(), now(), '', '', ''
from generate_series(1, 8) n
union all
select ('a8800000-0000-0000-0000-0000000000' || s)::uuid, '00000000-0000-0000-0000-000000000000'::uuid,
  'authenticated', 'authenticated', 'triad-contract-' || s || '@example.test', 'test', now(),
  jsonb_build_object('full_name', 'Triad ' || s), now(), now(), '', '', ''
from unnest(array['98', '99']) s;

insert into public.organizations (id, name) values ('b8800000-0000-0000-0000-000000000001', 'Triad contract org');
insert into public.user_roles (user_id, role) values
  ('a8800000-0000-0000-0000-000000000006', 'coach'),
  ('a8800000-0000-0000-0000-000000000098', 'admin'),
  ('a8800000-0000-0000-0000-000000000099', 'sponsor');
insert into public.sponsor_profiles (user_id, organization_id)
values ('a8800000-0000-0000-0000-000000000099', 'b8800000-0000-0000-0000-000000000001');

insert into public.programmes (id, name) values
  ('c8800000-0000-0000-0000-000000000001', 'Triad contract programme'),
  ('c8800000-0000-0000-0000-000000000002', 'Flexible Triad programme');
insert into public.cohorts (id, name, programme_id, organization_id, start_date, end_date) values
  ('d8800000-0000-0000-0000-000000000001', 'C1', 'c8800000-0000-0000-0000-000000000001', 'b8800000-0000-0000-0000-000000000001', current_date - 120, current_date + 120),
  ('d8800000-0000-0000-0000-000000000002', 'C2', 'c8800000-0000-0000-0000-000000000001', 'b8800000-0000-0000-0000-000000000001', current_date - 120, current_date + 120),
  ('d8800000-0000-0000-0000-000000000003', 'Flex cohort', 'c8800000-0000-0000-0000-000000000002', 'b8800000-0000-0000-0000-000000000001', current_date - 120, current_date + 120);
insert into public.programme_modules (programme_id, module, enabled, config) values
  ('c8800000-0000-0000-0000-000000000001', 'triads', true, jsonb_build_object(
    'required', true, 'required_units', 2, 'distribution_mode', 'custom',
    'distribution_settings', jsonb_build_object('milestones', jsonb_build_array(
      jsonb_build_object('due_on', (current_date - 30)::text, 'required_units', 1),
      jsonb_build_object('due_on', (current_date + 30)::text, 'required_units', 1))))),
  ('c8800000-0000-0000-0000-000000000002', 'triads', true, '{"required":true,"required_units":3,"distribution_mode":"flexible","distribution_settings":{}}');

insert into public.programme_enrollments (id, user_id, programme_id, cohort_id, organization_id, start_date, end_date, status)
select ('e8800000-0000-0000-0000-00000000000' || n)::uuid, ('a8800000-0000-0000-0000-0000000000' || lpad(n::text, 2, '0'))::uuid,
  'c8800000-0000-0000-0000-000000000001',
  case when n = 8 then 'd8800000-0000-0000-0000-000000000002' else 'd8800000-0000-0000-0000-000000000001' end::uuid,
  'b8800000-0000-0000-0000-000000000001', current_date - 120, current_date + 120,
  case when n = 7 then 'completed' else 'active' end::public.enrollment_status
from generate_series(1, 8) n;

create temporary table unit (n integer primary key, id uuid, due_on date);
insert into unit select d.ordinal, d.id, d.due_on from public.cohort_requirement_dates d
where d.cohort_id = 'd8800000-0000-0000-0000-000000000001' and d.module = 'triads';
grant select on unit to authenticated;

-- ===========================================================================
-- PROGRAMME / COHORT
-- ===========================================================================
select results_eq(
  $$select n, due_on from unit order by n$$,
  $$values (1, current_date - 30), (2, current_date + 30)$$,
  '1. Triads required = 2 -> exactly two cohort Triad requirement units with their cohort dates');
select is(
  (select count(*)::integer || '/' || max(units) from public.cohort_requirement_dates
   where cohort_id = 'd8800000-0000-0000-0000-000000000003' and module = 'triads'),
  '3/1',
  '1b. flexible Triads required = 3 materialize as three single-unit requirement rows');
select throws_ok(
  $$insert into public.cohort_requirement_dates (cohort_id, programme_id, module, ordinal, due_on, units, generation_method, materialized_via)
    values ('d8800000-0000-0000-0000-000000000001', 'c8800000-0000-0000-0000-000000000001', 'triads', 9, current_date, 2, 'manual', 'admin_save')$$,
  '23514', null, '2. a Triad requirement row is always one unit (one round)');
select hasnt_table('public', 'triad_rounds', '4. triad_rounds (independent round deadline) is gone');
select hasnt_table('public', 'programme_triad_rounds', '4b. programme_triad_rounds is gone');
select is(
  (select count(*)::integer from information_schema.columns where table_schema = 'public' and column_name = 'completion_deadline'),
  0, '4c. no table owns a Triad completion deadline');

-- ===========================================================================
-- GROUPS (as Admin)
-- ===========================================================================
select set_config('request.jwt.claim.sub', 'a8800000-0000-0000-0000-000000000098', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

select results_eq(
  $$select enrollment_id from public.admin_triad_requirement_candidates((select id from unit where n = 1)) order by enrollment_id$$,
  $$select ('e8800000-0000-0000-0000-00000000000' || n)::uuid from generate_series(1, 6) n order by 1$$,
  '5/7. the assignment pool is the selected cohort''s ongoing enrollments only (no other cohort, no completed enrollment)');
select throws_ok(
  $$select public.admin_triad_create_group((select id from unit where n = 1),
      array['e8800000-0000-0000-0000-000000000001', 'e8800000-0000-0000-0000-000000000008']::uuid[], 'vi')$$,
  '42501', null, '6. a mixed-cohort group can never be created');
select throws_ok(
  $$select public.admin_triad_create_group((select id from unit where n = 1),
      array['e8800000-0000-0000-0000-000000000001']::uuid[], 'vi')$$,
  '22023', null, '8a. a group needs at least 2 learners');

create temporary table grp (name text primary key, id uuid);
grant select, insert on grp to authenticated;
insert into grp values
  ('G1', public.admin_triad_create_group((select id from unit where n = 1),
     array['e8800000-0000-0000-0000-000000000001', 'e8800000-0000-0000-0000-000000000002', 'e8800000-0000-0000-0000-000000000003']::uuid[], 'vi')),
  ('G2', public.admin_triad_create_group((select id from unit where n = 1),
     array['e8800000-0000-0000-0000-000000000004', 'e8800000-0000-0000-0000-000000000005']::uuid[], 'en')),
  ('G3', public.admin_triad_create_group((select id from unit where n = 2),
     array['e8800000-0000-0000-0000-000000000001', 'e8800000-0000-0000-0000-000000000002']::uuid[], 'vi'));

select is((select count(*)::integer from public.triad_group_members where triad_group_id = (select id from grp where name = 'G2')), 2,
  '8b. dyads remain supported');
select throws_ok(
  $$select public.admin_triad_create_group((select id from unit where n = 1),
      array['e8800000-0000-0000-0000-000000000001', 'e8800000-0000-0000-0000-000000000006']::uuid[], 'vi')$$,
  '23505', null, '9a. an enrollment is in at most one active group per requirement unit');
select hasnt_column('public', 'triad_group_members', 'user_id', '9b. membership is the enrollment (no duplicated learner identity)');
select hasnt_column('public', 'triad_groups', 'member_1_id', '9c. no fixed member slots on groups');
select hasnt_column('public', 'triad_groups', 'cohort_id', '9d. cohort / programme / unit / due date are derived from the requirement');
reset role;
select throws_ok(
  $$insert into public.triad_group_members (triad_group_id, enrollment_id, member_order)
    values ((select id from grp where name = 'G2'), 'e8800000-0000-0000-0000-000000000008', 3)$$,
  '42501', null, '6b. even a direct write cannot put another cohort''s enrollment in a group');
select results_eq(
  $$select name, (select count(*)::integer from public.triad_sessions s where s.triad_group_id = grp.id)
    from grp order by name$$,
  $$values ('G1', 1), ('G2', 1), ('G3', 1)$$,
  'each new group gets one proposed session');

-- Admin schedules times (session time is the group's; no learner writes it directly).
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a8800000-0000-0000-0000-000000000098', true);
update public.triad_sessions set scheduled_start_time = now() - interval '35 days', scheduled_end_time = now() - interval '35 days' + interval '1 hour'
where triad_group_id = (select id from grp where name = 'G1');
update public.triad_sessions set scheduled_start_time = now() + interval '10 days', scheduled_end_time = now() + interval '10 days 1 hour'
where triad_group_id = (select id from grp where name = 'G2');
update public.triad_sessions set scheduled_start_time = now() - interval '2 days', scheduled_end_time = now() - interval '2 days' + interval '1 hour'
where triad_group_id = (select id from grp where name = 'G3');

-- ===========================================================================
-- SESSIONS (as learners)
-- ===========================================================================
create temporary table ses (name text primary key, id uuid);
grant select on ses to authenticated;
reset role;
insert into ses select g.name, s.id from grp g join public.triad_sessions s on s.triad_group_id = g.id;
set local role authenticated;

select set_config('request.jwt.claim.sub', 'a8800000-0000-0000-0000-000000000001', true);
select is(
  (select sessions->0->>'id' from public.learner_triad_overview('e8800000-0000-0000-0000-000000000001') where unit_number = 1),
  (select id::text from ses where name = 'G1'), '10a. E1 sees the G1 session');
select throws_ok($$select public.learner_triad_complete_session((select id from ses where name = 'G1'))$$,
  '42501', null, '16a. a proposed (unagreed) session cannot be completed');
select lives_ok($$select public.learner_triad_respond_session((select id from ses where name = 'G1'), 'accepted')$$, 'E1 accepts');
select set_config('request.jwt.claim.sub', 'a8800000-0000-0000-0000-000000000002', true);
select is(
  (select sessions->0->>'id' from public.learner_triad_overview('e8800000-0000-0000-0000-000000000002') where unit_number = 1),
  (select id::text from ses where name = 'G1'), '10b. E2 sees the same session');
select lives_ok($$select public.learner_triad_respond_session((select id from ses where name = 'G1'), 'accepted')$$, 'E2 accepts');
select set_config('request.jwt.claim.sub', 'a8800000-0000-0000-0000-000000000003', true);
select lives_ok($$select public.learner_triad_respond_session((select id from ses where name = 'G1'), 'accepted')$$, 'E3 accepts');
select is((select status from public.triad_sessions where id = (select id from ses where name = 'G1')), 'confirmed',
  'the session is confirmed once every member accepted');

-- Server-side completion rules.
select set_config('request.jwt.claim.sub', 'a8800000-0000-0000-0000-000000000004', true);
select throws_ok($$select public.learner_triad_complete_session((select id from ses where name = 'G1'))$$,
  '42501', null, '16b. a non-member cannot complete a session');
select is(
  (select count(*)::integer from public.triad_sessions where id = (select id from ses where name = 'G1')), 0,
  '27a. a learner cannot read another group''s session');
update public.triad_sessions set status = 'completed' where id = (select id from ses where name = 'G1');
select set_config('request.jwt.claim.sub', 'a8800000-0000-0000-0000-000000000001', true);
update public.triad_sessions set status = 'completed' where id = (select id from ses where name = 'G1');
select is((select status from public.triad_sessions where id = (select id from ses where name = 'G1')), 'confirmed',
  '16c. learners cannot write session state directly (only through validated functions)');
select lives_ok($$select public.learner_triad_complete_session((select id from ses where name = 'G1'))$$, 'E1 completes G1');
select is((select status from public.triad_sessions where id = (select id from ses where name = 'G1')), 'completed',
  '16f. a member''s completion persists although every member accepted (no auto-confirm revert)');
reset role;
update public.triad_sessions set meeting_url = 'https://meet.example/g1' where id = (select id from ses where name = 'G1');
update public.triad_session_responses set response = 'accepted', responded_at = now()
where triad_session_id = (select id from ses where name = 'G1');
select is((select status from public.triad_sessions where id = (select id from ses where name = 'G1')), 'completed',
  '16g. later session or response writes never move a completed session out of completed');
select throws_ok($$update public.triad_sessions set status = 'confirmed' where id = (select id from ses where name = 'G1')$$,
  '42501', null, '16h. a completed Triad session is final for every writer');
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a8800000-0000-0000-0000-000000000001', true);

-- Alternatives on G2 (E4, E5), a confirmed future session.
select set_config('request.jwt.claim.sub', 'a8800000-0000-0000-0000-000000000004', true);
select lives_ok($$select public.learner_triad_respond_session((select id from ses where name = 'G2'), 'accepted')$$, 'E4 accepts');
select set_config('request.jwt.claim.sub', 'a8800000-0000-0000-0000-000000000005', true);
select lives_ok($$select public.learner_triad_respond_session((select id from ses where name = 'G2'), 'accepted')$$, 'E5 accepts');
select throws_ok($$select public.learner_triad_complete_session((select id from ses where name = 'G2'))$$,
  '42501', null, '16d. a session cannot be completed before its time');
create temporary table alt (name text primary key, id uuid);
grant select, insert on alt to authenticated;
select set_config('request.jwt.claim.sub', 'a8800000-0000-0000-0000-000000000004', true);
insert into alt values
  ('A', public.learner_triad_propose_alternative((select id from ses where name = 'G2'), now() + interval '12 days', now() + interval '12 days 1 hour')),
  ('B', public.learner_triad_propose_alternative((select id from ses where name = 'G2'), now() + interval '14 days', now() + interval '14 days 1 hour'));
select ok(
  (select scheduled_start_time::date = (now() + interval '10 days')::date and status = 'confirmed'
   from public.triad_sessions where id = (select id from ses where name = 'G2')),
  '11/12. candidate times do not change the session: its time and status stay while alternatives are pending');
select results_eq(
  $$select status from public.triad_alternative_proposals where id in (select id from alt) order by proposed_start_time$$,
  $$values ('pending'::text), ('pending'::text)$$,
  '12b. proposal status is its own lifecycle');
select set_config('request.jwt.claim.sub', 'a8800000-0000-0000-0000-000000000005', true);
select lives_ok($$select public.learner_triad_respond_alternative((select id from alt where name = 'A'), 'accepted')$$, 'E5 accepts alternative A');
select ok(
  (select scheduled_start_time::date = (now() + interval '12 days')::date and status = 'confirmed'
   from public.triad_sessions where id = (select id from ses where name = 'G2')),
  '13. an alternative accepted by every member becomes the session time');
select results_eq(
  $$select status from public.triad_alternative_proposals where id in (select id from alt) order by proposed_start_time$$,
  $$values ('accepted'::text), ('superseded'::text)$$,
  '14. the other candidate is superseded and kept as history');

-- G3 (unit 2, E1 + E2): completed; then an extra completed session.
select set_config('request.jwt.claim.sub', 'a8800000-0000-0000-0000-000000000001', true);
select lives_ok($$select public.learner_triad_respond_session((select id from ses where name = 'G3'), 'accepted')$$, 'E1 accepts G3');
select set_config('request.jwt.claim.sub', 'a8800000-0000-0000-0000-000000000002', true);
select lives_ok($$select public.learner_triad_respond_session((select id from ses where name = 'G3'), 'accepted')$$, 'E2 accepts G3');
select lives_ok($$select public.learner_triad_complete_session((select id from ses where name = 'G3'))$$, 'E2 completes G3');
select set_config('request.jwt.claim.sub', 'a8800000-0000-0000-0000-000000000098', true);
insert into public.triad_sessions (triad_group_id, scheduled_start_time, scheduled_end_time, status)
values ((select id from grp where name = 'G3'), now() - interval '1 day', now() - interval '1 day' + interval '1 hour', 'completed');
reset role;

select results_eq(
  $$select a.enrollment_id from public.session_activity_attributions a
    where a.source_activity_type = 'triad' and a.source_activity_id = (select id from ses where name = 'G1') order by 1$$,
  $$values ('e8800000-0000-0000-0000-000000000001'::uuid), ('e8800000-0000-0000-0000-000000000002'::uuid), ('e8800000-0000-0000-0000-000000000003'::uuid)$$,
  '15a. a completed session is evidence for every group enrollment');
select results_eq(
  $$select e, p.completed_units, p.completed_activity_units, p.required_units
    from unnest(array['e8800000-0000-0000-0000-000000000001', 'e8800000-0000-0000-0000-000000000003', 'e8800000-0000-0000-0000-000000000004']::uuid[]) e
    cross join lateral public.canonical_module_progress(e, current_date) p where p.module = 'triads' order by e$$,
  $$values ('e8800000-0000-0000-0000-000000000001'::uuid, 2, 2, 2), ('e8800000-0000-0000-0000-000000000003'::uuid, 1, 1, 2), ('e8800000-0000-0000-0000-000000000004'::uuid, 0, 0, 2)$$,
  '15b/16. completion is per requirement and capped at the programme requirement (3 sessions over units 1 + 2 -> 2/2)');
select is(
  (select occurred_on from public.session_activity_attributions a
   where a.source_activity_type = 'triad' and a.source_activity_id = (select id from ses where name = 'G2')
     and a.enrollment_id = 'e8800000-0000-0000-0000-000000000004'),
  (now() + interval '12 days')::date,
  '13b. evidence follows the session''s current time after a reschedule');

-- ===========================================================================
-- REFLECTIONS + GOAL CHECK-IN (E1, E2, E3 on G1)
-- ===========================================================================
insert into public.coachee_goals (id, coachee_id, enrollment_id, title)
values ('98800000-0000-0000-0000-000000000001', 'a8800000-0000-0000-0000-000000000001', 'e8800000-0000-0000-0000-000000000001', 'Listen first');
insert into public.coachee_goal_ratings (coachee_id, enrollment_id, goal_id, start_rating, current_rating, target_rating)
values ('a8800000-0000-0000-0000-000000000001', 'e8800000-0000-0000-0000-000000000001', '98800000-0000-0000-0000-000000000001', 20, 30, 80);

select results_eq(
  $$select id, question_key from public.triad_reflection_questions where programme_id is null order by display_order$$,
  $$values ('7d1a0000-0000-4000-8000-000000000001'::uuid, 'learned_as_coach'::text), ('7d1a0000-0000-4000-8000-000000000002'::uuid, 'will_use_as_coach'::text),
           ('7d1a0000-0000-4000-8000-000000000003'::uuid, 'learned_as_coachee'::text), ('7d1a0000-0000-4000-8000-000000000004'::uuid, 'will_use_as_coachee'::text),
           ('7d1a0000-0000-4000-8000-000000000005'::uuid, 'learned_as_observer'::text), ('7d1a0000-0000-4000-8000-000000000006'::uuid, 'will_use_as_observer'::text)$$,
  '18. reflection questions have stable ids and keys');
select hasnt_column('public', 'triad_reflections', 'learned_as_coach', '19a. no hard-coded answer columns remain');
select hasnt_column('public', 'triad_reflections', 'participant_id', '19b. the author is the enrollment');

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a8800000-0000-0000-0000-000000000001', true);
select results_eq(
  $$select id from public.learner_triad_reflection_questions((select id from ses where name = 'G1')) order by display_order limit 1$$,
  $$values ('7d1a0000-0000-4000-8000-000000000001'::uuid)$$,
  'members read the question set for their session');
select lives_ok($$select public.learner_triad_submit_reflection((select id from ses where name = 'G1'), 4::smallint,
  '[{"question_id":"7d1a0000-0000-4000-8000-000000000001","answer_text":"Silence gives room"},{"question_id":"7d1a0000-0000-4000-8000-000000000006","answer_text":"Name patterns kindly"}]'::jsonb)$$,
  'E1 submits a reflection');
select throws_ok($$select public.learner_triad_submit_reflection((select id from ses where name = 'G1'), 5::smallint, '[]'::jsonb)$$,
  '23505', null, '17. one reflection per session and enrollment');
select throws_ok($$select public.learner_triad_submit_reflection((select id from ses where name = 'G2'), 5::smallint, '[]'::jsonb)$$,
  '42501', null, 'a learner cannot reflect on another group''s session');
select throws_ok(
  $$insert into public.triad_reflections (triad_session_id, enrollment_id, satisfaction_rating)
    values ((select id from ses where name = 'G1'), 'e8800000-0000-0000-0000-000000000001', 3)$$,
  '42501', null, 'learners cannot write reflections directly');
select is(
  (select satisfaction_rating::integer from public.triad_reflections where enrollment_id = 'e8800000-0000-0000-0000-000000000001'),
  4, '20. satisfaction stays on the reflection submission');
select lives_ok($$select public.record_goal_checkins('e8800000-0000-0000-0000-000000000001', 'triad', (select id from ses where name = 'G1'),
  '[{"goal_id":"98800000-0000-0000-0000-000000000001","new_rating":60,"note":"Clearer after the triad"}]'::jsonb)$$,
  '21a. a Triad goal check-in is recorded in the goal source');
select results_eq(
  $$select source_type, rating::integer from public.learner_reflection_feed('e8800000-0000-0000-0000-000000000001')
    where linked_session_id = (select id from ses where name = 'G1') order by source_type$$,
  $$values ('goal_checkin'::text, 60), ('triad_reflection'::text, 4)$$,
  '22a. My Journey projects the goal check-in and the Triad reflection side by side');
select is(
  (select details->'answers'->0->>'question_id' || '|' || (details->'answers'->0->>'answer')
   from public.learner_reflection_feed('e8800000-0000-0000-0000-000000000001') where source_type = 'triad_reflection'),
  '7d1a0000-0000-4000-8000-000000000001|Silence gives room',
  '22b. the feed reads normalized answers by question id');
select is(
  (select count(*)::integer from public.learner_triad_session_reflections((select id from ses where name = 'G1'))),
  1, 'before everyone submits, a member sees only their own reflection');
select set_config('request.jwt.claim.sub', 'a8800000-0000-0000-0000-000000000002', true);
select lives_ok($$select public.learner_triad_submit_reflection((select id from ses where name = 'G1'), 5::smallint, '[]'::jsonb)$$, 'E2 submits');
select set_config('request.jwt.claim.sub', 'a8800000-0000-0000-0000-000000000003', true);
select lives_ok($$select public.learner_triad_submit_reflection((select id from ses where name = 'G1'), 3::smallint, '[]'::jsonb)$$, 'E3 submits');
select results_eq(
  $$select member_slot, is_self from public.learner_triad_session_reflections((select id from ses where name = 'G1')) order by member_slot$$,
  $$values (1, false), (2, false), (3, true)$$,
  'once every member submitted, the group sees all reflections (by member slot)');
reset role;
select is(
  (select count(*)::integer from information_schema.columns where table_schema = 'public' and table_name = 'triad_reflections'
     and column_name ~ 'goal|rating_before|rating_after|new_rating'),
  0, '21b. goal ratings are never copied into triad_reflections');

-- ===========================================================================
-- CROSS ROLE (E1, E4 and E6)
-- ===========================================================================
create temporary table role_facts (who text, enrollment uuid, progress jsonb, journey jsonb);
create temporary table learner_of as select id as enrollment_id, user_id from public.programme_enrollments
where id::text like 'e8800000-%';
grant select, insert on role_facts to authenticated;
grant select on learner_of to authenticated;
set local role authenticated;
do $$
declare e uuid; u uuid;
begin
  foreach e in array array['e8800000-0000-0000-0000-000000000001', 'e8800000-0000-0000-0000-000000000004', 'e8800000-0000-0000-0000-000000000006']::uuid[] loop
    select user_id into u from learner_of where enrollment_id = e;
    perform set_config('request.jwt.claim.sub', u::text, true);
    insert into role_facts select 'learner', e,
      (select jsonb_build_object('req', p.triad_required_units, 'done', p.triad_completed_units, 'due', p.triad_due_units, 'booked', p.triad_booked_units, 'overdue', p.overdue_units)
       from public.learner_canonical_progress(e, current_date) p),
      public.learner_canonical_journey(e, current_date);
    perform set_config('request.jwt.claim.sub', 'a8800000-0000-0000-0000-000000000099', true);
    insert into role_facts select 'sponsor', e,
      (select jsonb_build_object('req', p.triad_required_units, 'done', p.triad_completed_units, 'due', p.triad_due_units, 'booked', p.triad_booked_units, 'overdue', p.overdue_units)
       from public.sponsor_canonical_leader_progress(e, current_date) p),
      public.sponsor_canonical_leader_journey(e, current_date);
    perform set_config('request.jwt.claim.sub', 'a8800000-0000-0000-0000-000000000098', true);
    insert into role_facts select 'admin', e,
      (select jsonb_build_object('req', p.triad_required_units, 'done', p.triad_completed_units, 'due', p.triad_due_units, 'booked', p.triad_booked_units, 'overdue', p.overdue_units)
       from public.admin_canonical_enrollment_progress(array[e], current_date) p),
      public.admin_canonical_enrollment_journey(e, current_date);
  end loop;
end $$;
select is((select count(distinct (enrollment, progress))::integer from role_facts), 3,
  '23. Learner, Sponsor and Admin Triad progress match per enrollment');
select is((select count(distinct (enrollment, journey))::integer from role_facts), 3,
  '25. Learner, Sponsor and Admin journeys match per enrollment');
select ok((select bool_and(progress is not null and journey is not null) from role_facts), 'every role received the facts');

select set_config('request.jwt.claim.sub', 'a8800000-0000-0000-0000-000000000098', true);
create temporary table admin_units as
select * from public.admin_cohort_triad_requirements('d8800000-0000-0000-0000-000000000001', current_date);
select results_eq(
  $$select unit_number, due_on from admin_units order by unit_number$$,
  $$select n, due_on from unit order by n$$,
  '24a. Admin due dates are the cohort requirement dates');
select results_eq(
  $$select unit_number, overdue_enrollments, completed_enrollments, eligible_enrollments from admin_units order by unit_number$$,
  $$values (1, 3, 3, 6), (2, 0, 2, 6)$$,
  'Admin unit state: unit 1 overdue for E4, E5, E6; completed for E1-E3; unit 2 completed for E1, E2');
reset role;
select is(
  (select sum(overdue_enrollments)::integer from admin_units),
  (select sum(p.overdue_units)::integer from unnest(array(select ('e8800000-0000-0000-0000-00000000000' || n)::uuid from generate_series(1, 6) n)) e
   cross join lateral public.canonical_module_progress(e, current_date) p where p.module = 'triads'),
  '27b. Admin overdue per unit sums to canonical overdue units (no local overdue rule)');
set local role authenticated;

select set_config('request.jwt.claim.sub', 'a8800000-0000-0000-0000-000000000004', true);
select results_eq(
  $$select unit_number, due_on, unit_overdue, unit_completed from public.learner_triad_overview('e8800000-0000-0000-0000-000000000004')$$,
  $$select 1, (select due_on from unit where n = 1), true, false$$,
  '24b. the learner sees the same due date and unit state as Admin');

-- Admin edits the cohort schedule: every surface follows.
select set_config('request.jwt.claim.sub', 'a8800000-0000-0000-0000-000000000098', true);
select lives_ok($$select public.admin_save_cohort_requirement_dates('d8800000-0000-0000-0000-000000000001',
  jsonb_build_array(jsonb_build_object('programme_id', 'c8800000-0000-0000-0000-000000000001', 'module', 'triads', 'ordinal', 2, 'due_on', (current_date + 45)::text)))$$,
  'Admin moves unit 2 in the cohort schedule');
select is((select due_on from public.admin_cohort_triad_requirements('d8800000-0000-0000-0000-000000000001') where unit_number = 2),
  current_date + 45, '3a. Admin Triads shows the new unit 2 date');
select set_config('request.jwt.claim.sub', 'a8800000-0000-0000-0000-000000000001', true);
select is((select due_on from public.learner_triad_overview('e8800000-0000-0000-0000-000000000001') where unit_number = 2),
  current_date + 45, '3b. the learner Triads view shows the new date');
select ok(public.learner_canonical_journey('e8800000-0000-0000-0000-000000000001', current_date)::text like '%' || (current_date + 45)::text || '%',
  '3c. the learner journey has a checkpoint on the new date');
select set_config('request.jwt.claim.sub', 'a8800000-0000-0000-0000-000000000099', true);
select ok(public.sponsor_canonical_leader_journey('e8800000-0000-0000-0000-000000000001', current_date)::text like '%' || (current_date + 45)::text || '%',
  '3d. the sponsor journey has the same checkpoint');
select set_config('request.jwt.claim.sub', 'a8800000-0000-0000-0000-000000000098', true);
select lives_ok($$select public.admin_save_cohort_requirement_dates('d8800000-0000-0000-0000-000000000001',
  jsonb_build_array(jsonb_build_object('programme_id', 'c8800000-0000-0000-0000-000000000001', 'module', 'triads', 'ordinal', 1, 'due_on', (current_date - 30)::text),
                    jsonb_build_object('programme_id', 'c8800000-0000-0000-0000-000000000001', 'module', 'triads', 'ordinal', 2, 'due_on', (current_date + 30)::text)), true)$$,
  'Admin regenerates the Triad schedule');
select results_eq(
  $$select d.ordinal, d.id from public.cohort_requirement_dates d where d.cohort_id = 'd8800000-0000-0000-0000-000000000001' and d.module = 'triads' order by 1$$,
  $$select n, id from unit order by n$$,
  '4d. regenerating keeps each requirement unit''s identity (groups stay attached)');
select throws_ok($$select public.admin_save_cohort_requirement_dates('d8800000-0000-0000-0000-000000000001',
  jsonb_build_array(jsonb_build_object('programme_id', 'c8800000-0000-0000-0000-000000000001', 'module', 'triads', 'ordinal', 1, 'due_on', (current_date - 30)::text)), true)$$,
  '22023', null, '4e. a unit with groups cannot be regenerated away');

-- 26. A coach enrolled as a learner sees the same session facts.
select set_config('request.jwt.claim.sub', 'a8800000-0000-0000-0000-000000000006', true);
select is((select count(*)::integer from public.learner_triad_overview('e8800000-0000-0000-0000-000000000006')), 0,
  '26a. the coach-learner (unassigned) has no group');
select is(
  (select jsonb_agg(h.source_id) from public.learner_session_history('e8800000-0000-0000-0000-000000000006') h where h.session_type = 'triad'),
  null, '26b. and no Triad history — the same fact every role sees');

-- ===========================================================================
-- SECURITY
-- ===========================================================================
select set_config('request.jwt.claim.sub', 'a8800000-0000-0000-0000-000000000004', true);
select is((select count(*)::integer from public.learner_triad_overview(null) where triad_group_id = (select id from grp where name = 'G1')), 0,
  '27c. a learner only sees groups they belong to');
select is((select count(*)::integer from public.learner_triad_session_reflections((select id from ses where name = 'G1'))), 0,
  '27d. a non-member cannot read a group''s reflections');
select set_config('request.jwt.claim.sub', 'a8800000-0000-0000-0000-000000000099', true);
select is(
  (select count(*)::integer from public.triad_reflections) + (select count(*)::integer from public.triad_reflection_answers)
  + (select count(*)::integer from public.triad_sessions) + (select count(*)::integer from public.triad_group_members),
  0, '28. a sponsor cannot read Triad sessions, members, reflections or answers');
select throws_ok($$select * from public.admin_cohort_triad_requirements('d8800000-0000-0000-0000-000000000001')$$,
  '42501', null, '28b. a sponsor cannot use Admin Triad functions');
select set_config('request.jwt.claim.sub', 'a8800000-0000-0000-0000-000000000001', true);
select ok(
  (select bool_and(not (s ? 'notes')) from public.learner_triad_overview(null) o, jsonb_array_elements(o.sessions) s),
  '29. private session notes are not projected to learners');
select set_config('request.jwt.claim.sub', 'a8800000-0000-0000-0000-000000000098', true);
select throws_ok($$delete from public.triad_sessions where id = (select id from ses where name = 'G1')$$,
  '42501', null, '16i. not even an Admin can delete a completed session (evidence and reflections are history)');
select ok((select count(*) from public.triad_reflections where triad_session_id = (select id from ses where name = 'G1')) > 0,
  '16j. the completed session''s reflections are intact');
select lives_ok($$insert into public.triad_group_members (triad_group_id, enrollment_id, member_order)
  select m.triad_group_id, m.enrollment_id, m.member_order from public.triad_group_members m where m.triad_group_id = (select id from grp where name = 'G1')
  on conflict (triad_group_id, enrollment_id) do nothing$$,
  '9e. re-inserting existing memberships is a no-op (idempotent writers), even once the group has a completed session');
select throws_ok($$insert into public.triad_group_members (triad_group_id, enrollment_id, member_order)
  select m.triad_group_id, m.enrollment_id, m.member_order from public.triad_group_members m where m.triad_group_id = (select id from grp where name = 'G1')$$,
  '23505', null, '9f. without ON CONFLICT the same membership is still a duplicate');
reset role;
select is(
  (select string_agg(p.proname, ', ' order by p.proname) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prokind = 'f'
     and (p.proname like 'triad\_%' or p.proname in ('canonical_triad_group_members', 'attribute_activity_to_cadence_milestone', 'cohort_requirement_proposal_internal'))
     and p.proname <> 'triad_reflections_visible_to_group'
     and has_function_privilege('authenticated', p.oid, 'EXECUTE')),
  null, '30. internal Triad constructions and helpers are not client-callable');
select isnt(
  (select p.provolatile::text from pg_proc p where p.oid = 'public.triad_session_can_complete(text,timestamptz)'::regprocedure),
  'i', '16e. the completion rule reads now(), so it is never IMMUTABLE');


-- ===========================================================================
-- REQUIREMENT FULFILMENT (a completed session fulfils its group's requirement)
-- ===========================================================================
reset role;
select results_eq(
  $$select is_total, expected_reflections, submitted_reflections, rate_pct
    from public.triad_reflection_rate_internal('c8800000-0000-0000-0000-000000000001') order by is_total$$,
  $$values (false, 7, 3, 42.9::numeric), (true, 7, 3, 42.9::numeric)$$,
  '32a. reflection rate = reflections / one per member of each completed session (G1 3/3, G3 2 sessions x 2 members 0/4)');
create temporary table rate_internal as
  select expected_reflections, submitted_reflections from public.triad_reflection_rate_internal('c8800000-0000-0000-0000-000000000001') where is_total;
grant select on rate_internal to authenticated;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a8800000-0000-0000-0000-000000000099', true);
select throws_ok($$select * from public.admin_programme_triad_reflection_rate('c8800000-0000-0000-0000-000000000001')$$,
  '42501', null, '32b. only Admin reads the reflection rate');
select set_config('request.jwt.claim.sub', 'a8800000-0000-0000-0000-000000000098', true);
select results_eq(
  $$select expected_reflections, submitted_reflections from public.admin_programme_triad_reflection_rate('c8800000-0000-0000-0000-000000000001') where is_total$$,
  $$select expected_reflections, submitted_reflections from rate_internal$$,
  '32c. Admin and the Edge Functions read the same reflection-rate calculation');
reset role;

-- E3 is only in G1 (unit 1). A second completed G1 session is the same requirement.
insert into public.triad_sessions (triad_group_id, scheduled_start_time, scheduled_end_time, status)
values ((select id from grp where name = 'G1'), now() - interval '20 days', now() - interval '20 days' + interval '1 hour', 'completed');
select results_eq(
  $$select p.completed_units, p.completed_activity_units, p.required_units
    from public.canonical_module_progress('e8800000-0000-0000-0000-000000000003', current_date) p where p.module = 'triads'$$,
  $$values (1, 1, 2)$$,
  '31a. two completed sessions for the same requirement fulfil it once (1/2, never 2/2)');

-- E4 / E5 fulfil unit 2 early while unit 1 (due 30 days ago) is still open.
create temporary table g5 as select public.triad_create_group_internal((select id from unit where n = 2),
  array['e8800000-0000-0000-0000-000000000004', 'e8800000-0000-0000-0000-000000000005']::uuid[], 'en', 'admin') as id;
update public.triad_sessions set scheduled_start_time = now() - interval '1 day', scheduled_end_time = now() - interval '1 day' + interval '1 hour', status = 'confirmed'
where triad_group_id = (select id from g5);
update public.triad_sessions set status = 'completed' where triad_group_id = (select id from g5);
select results_eq(
  $$select p.completed_units, p.due_units, p.overdue_units
    from public.canonical_module_progress('e8800000-0000-0000-0000-000000000004', current_date) p where p.module = 'triads'$$,
  $$values (1, 1, 1)$$,
  '31b. an early unit 2 never hides the overdue unit 1 (completed 1, due 1, overdue 1)');
select results_eq(
  $$select s.unit_number, s.unit_completed, s.unit_overdue from unit u
    cross join lateral public.triad_unit_enrollment_status_internal(u.id, current_date) s
    where s.enrollment_id = 'e8800000-0000-0000-0000-000000000004' order by 1$$,
  $$values (1, false, true), (2, true, false)$$,
  '31c. unit state is per requirement: unit 1 overdue, unit 2 fulfilled');
select is(
  (select (cp->>'completed_units')::integer from jsonb_array_elements(public.canonical_enrollment_journey('e8800000-0000-0000-0000-000000000004', current_date)) cp
   where (cp->>'due_on')::date = current_date - 30),
  0, '31d. the journey checkpoint for unit 1 is not credited with unit 2''s fulfilment');
select is(
  (select sum(overdue_units)::integer from public.canonical_module_progress('e8800000-0000-0000-0000-000000000004', current_date) where module = 'triads'),
  (select count(*)::integer from unit u cross join lateral public.triad_unit_enrollment_status_internal(u.id, current_date) s
   where s.enrollment_id = 'e8800000-0000-0000-0000-000000000004' and s.unit_overdue),
  '31e. canonical overdue units equal the per-unit overdue count (one rule)');

select * from finish();
rollback;
