-- Every learner surface reads ONE enrollment through the same canonical
-- sources (20260928130000_learner_enrollment_context,
-- 20260928140000_learner_training_from_calendar).
--
-- Fixture: one learner with a COMPLETED historical enrollment (cohort A) and
-- an ACTIVE enrollment (cohort B) of the same programme -- Linh Nguyen's
-- shape. The programme gains its Training module AFTER both enrollments
-- exist, so neither enrollment has a Training snapshot (the state every demo
-- enrollment was in when the Training page read "No training weeks").
begin;
select plan(27);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_user_meta_data, created_at, updated_at, confirmation_token, email_change_token_new, recovery_token)
select ('a9910000-0000-4000-8000-0000000000' || n)::uuid, '00000000-0000-0000-0000-000000000000'::uuid,
  'authenticated', 'authenticated', 'lsurf-' || n || '@example.test', 'test', now(),
  jsonb_build_object('full_name', 'Surface ' || n), now(), now(), '', '', ''
from unnest(array['01', '02', '03', '04']) n;   -- 01 learner, 02 other learner, 03 sponsor, 04 admin
insert into public.profiles (id, full_name, email, status)
select id, raw_user_meta_data->>'full_name', email, 'active' from auth.users where email like 'lsurf-%'
on conflict (id) do update set status = 'active';
insert into public.organizations (id, name) values ('b9910000-0000-4000-8000-00000000000a', 'Surface Org');
insert into public.user_roles (user_id, role) values
  ('a9910000-0000-4000-8000-000000000003', 'sponsor'), ('a9910000-0000-4000-8000-000000000004', 'admin')
on conflict do nothing;
insert into public.sponsor_profiles (user_id, organization_id)
values ('a9910000-0000-4000-8000-000000000003', 'b9910000-0000-4000-8000-00000000000a');

insert into public.programmes (id, name, duration_months) values ('c9910000-0000-4000-8000-000000000001', 'Surface Programme', 6);
insert into public.programme_modules (programme_id, module, enabled, config) values
  ('c9910000-0000-4000-8000-000000000001', 'coaching', true, '{"required": true, "required_units": 2}');
insert into public.cohorts (id, name, programme_id, start_date, end_date) values
  ('d9910000-0000-4000-8000-00000000000a', 'Surface Cohort A', 'c9910000-0000-4000-8000-000000000001', current_date - 300, current_date - 120),
  ('d9910000-0000-4000-8000-00000000000b', 'Surface Cohort B', 'c9910000-0000-4000-8000-000000000001', current_date - 20, current_date + 160);

insert into public.programme_enrollments (id, programme_id, user_id, cohort_id, organization_id, status, start_date, end_date)
values
  ('e9910000-0000-4000-8000-00000000000a', 'c9910000-0000-4000-8000-000000000001', 'a9910000-0000-4000-8000-000000000001',
   'd9910000-0000-4000-8000-00000000000a', 'b9910000-0000-4000-8000-00000000000a', 'active', current_date - 300, current_date - 120);
-- A peer session the learner PROVIDED during cohort A (created while cohort A
-- ran; both cohort A enrollments are closed afterwards). The session row
-- names the RECEIVER's (partner's) enrollment; the learner's participation
-- must resolve to her OWN cohort A enrollment -- never the active one.
update public.profiles set peer_coaching_opt_in = true
where id in ('a9910000-0000-4000-8000-000000000001', 'a9910000-0000-4000-8000-000000000002');
insert into public.programme_modules (programme_id, module, enabled, config) values
  ('c9910000-0000-4000-8000-000000000001', 'peer_coaching', true, '{"required": true, "required_units": 1, "monthly_limit": 20}');
insert into public.programme_enrollments (id, programme_id, user_id, cohort_id, organization_id, status, start_date, end_date)
values ('e9910000-0000-4000-8000-00000000002a', 'c9910000-0000-4000-8000-000000000001', 'a9910000-0000-4000-8000-000000000002',
   'd9910000-0000-4000-8000-00000000000a', 'b9910000-0000-4000-8000-00000000000a', 'active', current_date - 300, current_date - 120);
insert into public.coachee_goals (coachee_id, enrollment_id, title, status) values
  ('a9910000-0000-4000-8000-000000000002', 'e9910000-0000-4000-8000-00000000002a', 'Partner goal', 'active'),
  ('a9910000-0000-4000-8000-000000000001', 'e9910000-0000-4000-8000-00000000000a', 'Cohort A goal', 'active');
select set_config('request.jwt.claim.sub', 'a9910000-0000-4000-8000-000000000002', true);   -- the receiver books
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('app.session_transition', 'on', true);
insert into public.coachee_peer_sessions (id, peer_provider_id, peer_receiver_id, enrollment_id, topic, start_time, duration_minutes, status)
values ('19910000-0000-4000-8000-0000000000a1', 'a9910000-0000-4000-8000-000000000001', 'a9910000-0000-4000-8000-000000000002',
  'e9910000-0000-4000-8000-00000000002a', 'Cohort A peer practice', now() - interval '200 days', 60, 'completed');
select set_config('app.session_transition', 'off', true);
select set_config('request.jwt.claim.sub', '', true);
update public.programme_enrollments set status = 'completed' where id = 'e9910000-0000-4000-8000-00000000002a';
update public.programme_enrollments set status = 'completed' where id = 'e9910000-0000-4000-8000-00000000000a';
-- The ACTIVE enrollment carries no end date of its own (as every seeded ongoing enrollment).
insert into public.programme_enrollments (id, programme_id, user_id, cohort_id, organization_id, status, start_date)
values ('e9910000-0000-4000-8000-00000000000b', 'c9910000-0000-4000-8000-000000000001', 'a9910000-0000-4000-8000-000000000001',
   'd9910000-0000-4000-8000-00000000000b', 'b9910000-0000-4000-8000-00000000000a', 'active', current_date - 20);

-- Training is added to the programme only now: no enrollment has a Training snapshot.
insert into public.training_weeks (id, programme_id, week_number, title, is_visible, skill_card_visible)
select ('79910000-0000-4000-8000-0000000000' || lpad(w::text, 2, '0'))::uuid, 'c9910000-0000-4000-8000-000000000001',
  w, 'Surface week ' || w, true, true
from generate_series(1, 3) w;
insert into public.assignments (training_week_id, title, assignment_type, is_visible)
values ('79910000-0000-4000-8000-000000000001', 'Quiz 1', 'quiz', true);
insert into public.programme_modules (programme_id, module, enabled, config) values
  ('c9910000-0000-4000-8000-000000000001', 'training', true, jsonb_build_object(
    'required', true, 'required_units', 2, 'learning_components', jsonb_build_array('skill_cards', 'quizzes'),
    'distribution_settings', jsonb_build_object('training_week_ids', jsonb_build_array(
      '79910000-0000-4000-8000-000000000001', '79910000-0000-4000-8000-000000000002'))));

-- One private reflection and one goal in EACH enrollment.
insert into public.coachee_reflections (coachee_id, enrollment_id, body) values
  ('a9910000-0000-4000-8000-000000000001', 'e9910000-0000-4000-8000-00000000000a', 'HISTORICAL-REFLECTION'),
  ('a9910000-0000-4000-8000-000000000001', 'e9910000-0000-4000-8000-00000000000b', 'ACTIVE-REFLECTION');
insert into public.coachee_goals (id, coachee_id, enrollment_id, title, status) values
  ('59910000-0000-4000-8000-00000000000a', 'a9910000-0000-4000-8000-000000000001', 'e9910000-0000-4000-8000-00000000000a', 'Old goal', 'active'),
  ('59910000-0000-4000-8000-00000000000b', 'a9910000-0000-4000-8000-000000000001', 'e9910000-0000-4000-8000-00000000000b', 'Current goal', 'active');
insert into public.coachee_goal_ratings (goal_id, coachee_id, enrollment_id, start_rating, current_rating, target_rating) values
  ('59910000-0000-4000-8000-00000000000b', 'a9910000-0000-4000-8000-000000000001', 'e9910000-0000-4000-8000-00000000000b', 20, 50, 80);
insert into public.training_progress (user_id, enrollment_id, training_week_id, viewed_at, completed_at)
values ('a9910000-0000-4000-8000-000000000001', 'e9910000-0000-4000-8000-00000000000b',
  '79910000-0000-4000-8000-000000000001', now() - interval '15 days', now() - interval '15 days');

select ok(not exists (select 1 from public.enrollment_module_snapshots
                      where enrollment_id = 'e9910000-0000-4000-8000-00000000000b' and module = 'training'),
  'fixture: the active enrollment has no Training snapshot');

-- ---------------------------------------------------------------------------
-- As the learner
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', 'a9910000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

select is(
  (select array[enrollment_id::text, cohort_name, organization_name, is_ongoing::text]
   from public.learner_enrollment_context('e9910000-0000-4000-8000-00000000000b')),
  array['e9910000-0000-4000-8000-00000000000b', 'Surface Cohort B', 'Surface Org', 'true'],
  'the learner context names the active enrollment''s cohort and organisation');
select is(
  (select array[start_date, end_date] from public.learner_enrollment_context('e9910000-0000-4000-8000-00000000000b')),
  array[current_date - 20, current_date + 160],
  'effective dates: an ongoing enrollment without its own end date ends with its cohort');
select is(
  (select array[enrollment_start_date, enrollment_end_date] from public.learner_canonical_progress('e9910000-0000-4000-8000-00000000000b', current_date)),
  array[current_date - 20, current_date + 160],
  'the Dashboard header dates are the same effective dates (never "start - ")');

-- Training page: the programme's selected weeks, with their canonical requirement.
select is(
  (select array_agg(week_number order by week_number) from public.get_enrollment_training_weeks('e9910000-0000-4000-8000-00000000000b')),
  array[1, 2], 'Training page lists the programme-selected weeks even without a snapshot (unselected week 3 excluded)');
select is(
  (select array_agg(requirement_due_on order by week_number) from public.get_enrollment_training_weeks('e9910000-0000-4000-8000-00000000000b')),
  (select array_agg(d.due_on order by tw.week_number) from public.cohort_requirement_dates d join public.training_weeks tw on tw.id = d.training_week_id
   where d.cohort_id = 'd9910000-0000-4000-8000-00000000000b' and d.module = 'training'),
  'each week shows its cohort Training requirement date');
select is(
  (select array_agg(requirement_state order by week_number) from public.get_enrollment_training_weeks('e9910000-0000-4000-8000-00000000000b')),
  array['completed', 'overdue'], 'week states come from the requirement calendar (week 1 done, week 2 due and not done)');
select is(
  (select jsonb_object_agg(item_type, completed_units || '/' || required_units) from public.learner_training_week_items('e9910000-0000-4000-8000-00000000000b') i
   where i.training_week_id = '79910000-0000-4000-8000-000000000001'),
  '{"skill_cards": "1/1", "quizzes": "0/1"}'::jsonb, 'per-week child evidence counts every configured child type');
select is(
  (select sum(required_units)::int from public.learner_training_week_items('e9910000-0000-4000-8000-00000000000b') where item_type = 'skill_cards'),
  (select training_required_units from public.learner_canonical_progress('e9910000-0000-4000-8000-00000000000b', current_date)),
  'Training page weeks reconcile with the Dashboard Training requirement');

-- Module totals reconcile with the enrollment aggregate.
select is(
  (select array[sum(required_units), sum(completed_units), sum(due_units), sum(overdue_units)]::int[]
   from public.learner_module_progress('e9910000-0000-4000-8000-00000000000b', current_date)),
  (select array[required_units, completed_units, due_units, overdue_units]
   from public.learner_canonical_progress('e9910000-0000-4000-8000-00000000000b', current_date)),
  'module pages (learner_module_progress) sum to the Dashboard aggregate');
select is(
  (select array_agg(module::text order by module::text) from public.get_enrollment_programme_modules('e9910000-0000-4000-8000-00000000000b')),
  array['coaching', 'peer_coaching', 'training'], 'the sidebar modules are the programme''s enabled modules for the active enrollment');

-- Dashboard and My Journey read the same checkpoint source.
create temp table learner_journey on commit drop as
select public.learner_canonical_journey('e9910000-0000-4000-8000-00000000000b', current_date) as j;
select is((select j from learner_journey),
  public.canonical_enrollment_journey('e9910000-0000-4000-8000-00000000000b', current_date),
  'the learner journey is the canonical journey');

-- Reflections, goals and history never cross enrollments.
select ok(
  (select jsonb_agg(to_jsonb(f))::text from public.learner_reflection_feed('e9910000-0000-4000-8000-00000000000b') f) like '%ACTIVE-REFLECTION%'
  and (select coalesce(jsonb_agg(to_jsonb(f))::text, '') from public.learner_reflection_feed('e9910000-0000-4000-8000-00000000000b') f) not like '%HISTORICAL-REFLECTION%',
  'the active enrollment''s reflection feed holds only its own reflections');
select ok(
  (select coalesce(jsonb_agg(to_jsonb(f))::text, '') from public.learner_reflection_feed('e9910000-0000-4000-8000-00000000000a') f) not like '%ACTIVE-REFLECTION%',
  'the historical enrollment''s feed never shows the active enrollment''s reflections');
select is(
  (select array_agg(goal_id) from public.canonical_goal_progress('e9910000-0000-4000-8000-00000000000b')),
  array['59910000-0000-4000-8000-00000000000b'::uuid], 'goal progress reads only the active enrollment''s goal');

-- Peer participation: each participant is attributed to their OWN enrollment.
select is(
  (select enrollment_id from public.peer_session_participants
   where session_kind = 'coachee_peer' and peer_session_id = '19910000-0000-4000-8000-0000000000a1'
     and user_id = 'a9910000-0000-4000-8000-000000000001'),
  'e9910000-0000-4000-8000-00000000000a'::uuid,
  'the PROVIDER''s participation resolves to her own historical cohort A enrollment (readable by her under RLS)');
select isnt(
  (select enrollment_id from public.peer_session_participants
   where peer_session_id = '19910000-0000-4000-8000-0000000000a1' and user_id = 'a9910000-0000-4000-8000-000000000001'),
  (select enrollment_id from public.coachee_peer_sessions where id = '19910000-0000-4000-8000-0000000000a1'),
  'the session row''s enrollment (the receiver''s) is NOT the provider''s participation enrollment');
select is(
  (select count(*)::int from public.peer_session_participants
   where user_id = 'a9910000-0000-4000-8000-000000000001' and enrollment_id = 'e9910000-0000-4000-8000-00000000000b'),
  0, 'the cohort A peer session is not attributed to the active cohort B enrollment');
select is(
  (select array_agg(enrollment_id order by enrollment_id) from public.peer_session_participants
   where peer_session_id = '19910000-0000-4000-8000-0000000000a1'),
  array['e9910000-0000-4000-8000-00000000000a', 'e9910000-0000-4000-8000-00000000002a']::uuid[],
  'the same physical session resolves to each participant''s own enrollment');

-- ---------------------------------------------------------------------------
-- Other learners and roles
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', 'a9910000-0000-4000-8000-000000000002', true);
select is((select count(*)::int from public.learner_enrollment_context('e9910000-0000-4000-8000-00000000000b')), 0,
  'another learner cannot read this learner''s enrollment context');
select is((select count(*)::int from public.get_enrollment_training_weeks('e9910000-0000-4000-8000-00000000000b')), 0,
  'another learner cannot read this learner''s Training weeks');
select is((select count(*)::int from public.learner_training_week_items('e9910000-0000-4000-8000-00000000000b')), 0,
  'another learner cannot read this learner''s training evidence');

select set_config('request.jwt.claim.sub', 'a9910000-0000-4000-8000-000000000003', true);
select is(public.sponsor_canonical_leader_journey('e9910000-0000-4000-8000-00000000000b', current_date),
  (select j from learner_journey), 'the sponsor sees the same checkpoints as the learner');
select is(
  (select goal_count::int from public.sponsor_canonical_enrollment_metadata(null, 'e9910000-0000-4000-8000-00000000000b', current_date)),
  1, 'the sponsor goal aggregate counts the same single active-enrollment goal');

select set_config('request.jwt.claim.sub', 'a9910000-0000-4000-8000-000000000004', true);
select is(public.admin_canonical_enrollment_journey('e9910000-0000-4000-8000-00000000000b', current_date),
  (select j from learner_journey), 'the admin sees the same checkpoints as the learner');

-- Schedule state and uniqueness.
select is(
  (select state from public.cohort_programme_schedule_state('d9910000-0000-4000-8000-00000000000b', 'c9910000-0000-4000-8000-000000000001')
   where module = 'training'),
  'aligned', 'Training schedule state counts its requirements (no "2 of 0 required units")');
select is(
  (select count(*)::int from public.programme_enrollments
   where user_id = 'a9910000-0000-4000-8000-000000000001' and status in ('active', 'at_risk', 'paused')),
  1, 'the learner holds exactly one ongoing enrollment');

select * from finish();
rollback;
