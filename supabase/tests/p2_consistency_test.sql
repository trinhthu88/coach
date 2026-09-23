-- P2 consistency (20261001120000_p2_consistency).
--
-- Fixture (T = current_date):
--   Programme P  Coaching x1 + Mentoring x1; cohort K (P)
--   Programme Q  another programme. Cohort K also holds a stale Coaching and
--                Mentoring requirement row for Q, written directly after the
--                enrollment (cohort_requirement_dates only has plain FKs).
--   L1 (P, K)    learner with goal G1; Coach / Mentor 01
--   Sponsor 21   sponsor role, organisation O1 (one report request)
--   User 22      sponsor_profiles row for O2 (one report request) but NO
--                sponsor role
begin;
select plan(18);

-- ---------------------------------------------------------------------------
-- Fixture
-- ---------------------------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_user_meta_data, created_at, updated_at, confirmation_token, email_change_token_new, recovery_token)
select ('fa900000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid,
  '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated',
  'p2con-' || n || '@example.test', 'test', now(),
  jsonb_build_object('full_name', 'P2 Person ' || n), now(), now(), '', '', ''
from unnest(array[1, 11, 21, 22]) n;
insert into public.profiles (id, full_name, email, status)
select id, raw_user_meta_data->>'full_name', email, 'active' from auth.users where email like 'p2con-%'
on conflict (id) do update set status = 'active';
insert into public.user_roles (user_id, role) values
  ('fa900000-0000-4000-8000-000000000001', 'coach'),
  ('fa900000-0000-4000-8000-000000000021', 'sponsor')
on conflict do nothing;

insert into public.programmes (id, name) values
  ('fa910000-0000-4000-8000-00000000000a', 'P2 Programme P'),
  ('fa910000-0000-4000-8000-00000000000b', 'P2 Programme Q');
insert into public.programme_modules (programme_id, module, enabled, config) values
  ('fa910000-0000-4000-8000-00000000000a', 'coaching', true, '{"required": true, "required_units": 1}'),
  ('fa910000-0000-4000-8000-00000000000a', 'mentoring', true, '{"required": true, "required_units": 1}'),
  ('fa910000-0000-4000-8000-00000000000b', 'coaching', true, '{"required": true, "required_units": 1}'),
  ('fa910000-0000-4000-8000-00000000000b', 'mentoring', true, '{"required": true, "required_units": 1}');

insert into public.cohorts (id, name, programme_id, start_date, end_date) values
  ('fa920000-0000-4000-8000-0000000000a1', 'K', 'fa910000-0000-4000-8000-00000000000a', current_date - 30, null);

insert into public.cohort_requirement_dates
  (id, cohort_id, programme_id, module, ordinal, due_on, generation_method, materialized_via, is_overridden) values
  ('fa930000-0000-4000-8000-0000000000a1', 'fa920000-0000-4000-8000-0000000000a1', 'fa910000-0000-4000-8000-00000000000a', 'coaching', 1, current_date + 10, 'manual', 'admin_save', true),
  ('fa930000-0000-4000-8000-0000000000a2', 'fa920000-0000-4000-8000-0000000000a1', 'fa910000-0000-4000-8000-00000000000a', 'mentoring', 1, current_date + 10, 'manual', 'admin_save', true);

insert into public.programme_enrollments (id, programme_id, user_id, cohort_id, start_date, end_date, status) values
  ('fa940000-0000-4000-8000-000000000011', 'fa910000-0000-4000-8000-00000000000a', 'fa900000-0000-4000-8000-000000000011',
   'fa920000-0000-4000-8000-0000000000a1', current_date - 30, null, 'active');
-- The stale Q rows go in after the enrollment: enrolling runs the schedule
-- sync, which drops rows for programmes the cohort does not run. A later
-- direct write can still create one, which is what the triggers must catch.
insert into public.cohort_requirement_dates
  (id, cohort_id, programme_id, module, ordinal, due_on, generation_method, materialized_via, is_overridden) values
  ('fa930000-0000-4000-8000-0000000000b1', 'fa920000-0000-4000-8000-0000000000a1', 'fa910000-0000-4000-8000-00000000000b', 'coaching', 1, current_date + 10, 'manual', 'admin_save', true),
  ('fa930000-0000-4000-8000-0000000000b2', 'fa920000-0000-4000-8000-0000000000a1', 'fa910000-0000-4000-8000-00000000000b', 'mentoring', 1, current_date + 10, 'manual', 'admin_save', true);
insert into public.coachee_goals (id, coachee_id, enrollment_id, title) values
  ('fa950000-0000-4000-8000-000000000011', 'fa900000-0000-4000-8000-000000000011', 'fa940000-0000-4000-8000-000000000011', 'P2 goal'),
  ('fa950000-0000-4000-8000-000000000012', 'fa900000-0000-4000-8000-000000000011', 'fa940000-0000-4000-8000-000000000011', 'P2 goal without actions');
insert into public.cohort_coach_assignments (cohort_id, coach_id) values
  ('fa920000-0000-4000-8000-0000000000a1', 'fa900000-0000-4000-8000-000000000001');
insert into public.cohort_mentors (cohort_id, mentor_user_id) values
  ('fa920000-0000-4000-8000-0000000000a1', 'fa900000-0000-4000-8000-000000000001');

select set_config('app.session_transition', 'on', true);

-- ---------------------------------------------------------------------------
-- 11. Attribution checks the programme as well as the cohort
-- ---------------------------------------------------------------------------
select throws_ok(
  $$insert into public.sessions (enrollment_id, cohort_requirement_id, coach_id, coachee_id, topic, start_time, duration_minutes, status)
    values ('fa940000-0000-4000-8000-000000000011', 'fa930000-0000-4000-8000-0000000000b1',
      'fa900000-0000-4000-8000-000000000001', 'fa900000-0000-4000-8000-000000000011', 'Wrong programme',
      now() + interval '2 days', 60, 'confirmed')$$,
  '42501', null,
  '11a. a Coaching session cannot attach to another programme''s requirement in its own cohort');
select lives_ok(
  $$insert into public.sessions (id, enrollment_id, cohort_requirement_id, coach_id, coachee_id, topic, start_time, duration_minutes, status)
    values ('fa960000-0000-4000-8000-000000000001', 'fa940000-0000-4000-8000-000000000011', 'fa930000-0000-4000-8000-0000000000a1',
      'fa900000-0000-4000-8000-000000000001', 'fa900000-0000-4000-8000-000000000011', 'Right programme',
      now() + interval '2 days', 60, 'confirmed')$$,
  '11b. its own programme''s requirement is accepted');
select throws_ok(
  $$insert into public.mentoring_sessions (enrollment_id, cohort_requirement_id, mentor_id, mentee_id, topic, start_time, duration_minutes, status)
    values ('fa940000-0000-4000-8000-000000000011', 'fa930000-0000-4000-8000-0000000000b2',
      'fa900000-0000-4000-8000-000000000001', 'fa900000-0000-4000-8000-000000000011', 'Wrong programme',
      now() + interval '3 days', 60, 'confirmed')$$,
  '42501', null,
  '11c. a Mentoring session cannot attach to another programme''s requirement');
select lives_ok(
  $$insert into public.mentoring_sessions (id, enrollment_id, cohort_requirement_id, mentor_id, mentee_id, topic, start_time, duration_minutes, status)
    values ('fa970000-0000-4000-8000-000000000001', 'fa940000-0000-4000-8000-000000000011', 'fa930000-0000-4000-8000-0000000000a2',
      'fa900000-0000-4000-8000-000000000001', 'fa900000-0000-4000-8000-000000000011', 'Right programme',
      now() + interval '3 days', 60, 'confirmed')$$,
  '11d. its own programme''s Mentoring requirement is accepted');
select throws_ok(
  $$update public.sessions set cohort_requirement_id = 'fa930000-0000-4000-8000-0000000000b1'
    where id = 'fa960000-0000-4000-8000-000000000001'$$,
  '42501', null,
  '11e. re-pointing a session at another programme''s requirement is refused');

-- ---------------------------------------------------------------------------
-- 12. Follow-up actions
-- ---------------------------------------------------------------------------
-- A session with no requirement that never took place.
insert into public.sessions (id, enrollment_id, coach_id, coachee_id, topic, start_time, duration_minutes, status)
values ('fa960000-0000-4000-8000-000000000002', 'fa940000-0000-4000-8000-000000000011',
  'fa900000-0000-4000-8000-000000000001', 'fa900000-0000-4000-8000-000000000011', 'Called off',
  now() + interval '5 days', 60, 'pending_coach_approval');

select lives_ok(
  $$insert into public.enrollment_actions (id, enrollment_id, owner_user_id, goal_id, due_date, title, source_activity_type, source_activity_id)
    values ('fa980000-0000-4000-8000-000000000001', 'fa940000-0000-4000-8000-000000000011', 'fa900000-0000-4000-8000-000000000011',
      'fa950000-0000-4000-8000-000000000011', current_date + 7, 'In-session commitment', 'coaching', 'fa960000-0000-4000-8000-000000000001')$$,
  '12a. a confirmed session can source a new action (in-session GROW commitment)');
select throws_ok(
  $$insert into public.enrollment_actions (enrollment_id, owner_user_id, goal_id, due_date, title, source_activity_type, source_activity_id)
    values ('fa940000-0000-4000-8000-000000000011', 'fa900000-0000-4000-8000-000000000011',
      'fa950000-0000-4000-8000-000000000011', current_date + 7, 'Too soon', 'coaching', 'fa960000-0000-4000-8000-000000000002')$$,
  '23514', 'Actions can only be added to a confirmed or completed session (status=pending_coach_approval)',
  '12b. a session awaiting approval cannot source an action');
update public.sessions set status = 'cancelled' where id = 'fa960000-0000-4000-8000-000000000002';
select throws_ok(
  $$insert into public.enrollment_actions (enrollment_id, owner_user_id, goal_id, due_date, title, source_activity_type, source_activity_id)
    values ('fa940000-0000-4000-8000-000000000011', 'fa900000-0000-4000-8000-000000000011',
      'fa950000-0000-4000-8000-000000000011', current_date + 7, 'Never happened', 'coaching', 'fa960000-0000-4000-8000-000000000002')$$,
  '23514', 'Actions can only be added to a confirmed or completed session (status=cancelled)',
  '12c. a cancelled session cannot source an action');

update public.sessions set status = 'completed', start_time = now() - interval '1 hour'
where id = 'fa960000-0000-4000-8000-000000000001';
select lives_ok(
  $$insert into public.enrollment_actions (enrollment_id, owner_user_id, goal_id, due_date, title, source_activity_type, source_activity_id)
    values ('fa940000-0000-4000-8000-000000000011', 'fa900000-0000-4000-8000-000000000011',
      'fa950000-0000-4000-8000-000000000011', current_date + 7, 'Post-session action', 'coaching', 'fa960000-0000-4000-8000-000000000001')$$,
  '12d. a completed session can source a new action');

-- The save RPC upserts every action; the BEFORE INSERT trigger then sees
-- existing ids too. An existing action of a session cancelled later must stay
-- editable.
update public.sessions set status = 'cancelled' where id = 'fa960000-0000-4000-8000-000000000001';
select lives_ok(
  $$insert into public.enrollment_actions (id, enrollment_id, owner_user_id, goal_id, due_date, title, source_activity_type, source_activity_id, status)
    values ('fa980000-0000-4000-8000-000000000001', 'fa940000-0000-4000-8000-000000000011', 'fa900000-0000-4000-8000-000000000011',
      'fa950000-0000-4000-8000-000000000011', current_date + 7, 'In-session commitment (edited)', 'coaching', 'fa960000-0000-4000-8000-000000000001', 'in_progress')
    on conflict (id) do update set title = excluded.title, status = excluded.status$$,
  '12e. an existing action stays editable after its session is cancelled');
select is((select title || '/' || status from public.enrollment_actions where id = 'fa980000-0000-4000-8000-000000000001'),
  'In-session commitment (edited)/in_progress', '12f. ... and the edit is saved');

select throws_ok(
  $$delete from public.coachee_goals where id = 'fa950000-0000-4000-8000-000000000011'$$,
  '23503', 'Cannot delete a goal that has follow-up actions',
  '12g. a goal with actions cannot be deleted, with a clear message');
select is((select confdeltype::text from pg_constraint where conname = 'enrollment_actions_goal_id_fkey'), 'r',
  '12h. the action -> goal FK is ON DELETE RESTRICT');
select lives_ok(
  $$delete from public.coachee_goals where id = 'fa950000-0000-4000-8000-000000000012'$$,
  '12i. a goal without actions can still be deleted');

-- ---------------------------------------------------------------------------
-- 15. Report requests and the organisation row need the sponsor role
-- ---------------------------------------------------------------------------
insert into public.organizations (id, name) values
  ('fa9a0000-0000-4000-8000-000000000001', 'P2 Org One'),
  ('fa9a0000-0000-4000-8000-000000000002', 'P2 Org Two');
insert into public.sponsor_profiles (user_id, organization_id) values
  ('fa900000-0000-4000-8000-000000000021', 'fa9a0000-0000-4000-8000-000000000001'),
  ('fa900000-0000-4000-8000-000000000022', 'fa9a0000-0000-4000-8000-000000000002');
insert into public.sponsor_report_requests (organization_id, cohort_id, requested_by) values
  ('fa9a0000-0000-4000-8000-000000000001', 'fa920000-0000-4000-8000-0000000000a1', 'fa900000-0000-4000-8000-000000000021'),
  ('fa9a0000-0000-4000-8000-000000000002', 'fa920000-0000-4000-8000-0000000000a1', 'fa900000-0000-4000-8000-000000000022');

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'fa900000-0000-4000-8000-000000000021', 'role', 'authenticated')::text, true);
select results_eq(
  $$select (select count(*) from public.organizations where id in ('fa9a0000-0000-4000-8000-000000000001', 'fa9a0000-0000-4000-8000-000000000002'))::int,
           (select count(*) from public.sponsor_report_requests where organization_id in ('fa9a0000-0000-4000-8000-000000000001', 'fa9a0000-0000-4000-8000-000000000002'))::int,
           (select count(*) from public.sponsor_list_report_requests())::int$$,
  $$values (1, 1, 1)$$,
  '15a. a sponsor sees their own organisation and its report requests');
select set_config('request.jwt.claims', json_build_object('sub', 'fa900000-0000-4000-8000-000000000022', 'role', 'authenticated')::text, true);
select results_eq(
  $$select (select count(*) from public.organizations where id in ('fa9a0000-0000-4000-8000-000000000001', 'fa9a0000-0000-4000-8000-000000000002'))::int,
           (select count(*) from public.sponsor_report_requests where organization_id in ('fa9a0000-0000-4000-8000-000000000001', 'fa9a0000-0000-4000-8000-000000000002'))::int,
           (select count(*) from public.sponsor_list_report_requests())::int$$,
  $$values (0, 0, 0)$$,
  '15b. a sponsor_profiles row without the sponsor role sees neither');
reset role;

-- ---------------------------------------------------------------------------
-- 16. The dormant Training block is gone
-- ---------------------------------------------------------------------------
select ok(pg_get_functiondef('public.canonical_enrollment_experience_base(uuid,date)'::regprocedure)
            !~ '(learning_items|learning_weeks|training_progress)',
  '16a. canonical_enrollment_experience_base no longer counts Training itself');
select ok(public.canonical_enrollment_experience('fa940000-0000-4000-8000-000000000011') ? 'learning_breakdown',
  '16b. the experience still carries the canonical learning_breakdown');

select * from finish();
rollback;
