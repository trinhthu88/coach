-- Admin user detail wrappers (20260925300000_admin_enrollment_detail).
--
-- Proves:
--   * every admin_* wrapper returns nothing to a non-admin (even for the
--     caller's own enrollment) and is not executable by anon;
--   * the internal engines (canonical_session_history,
--     canonical_reflection_feed) are not client-callable;
--   * learner_session_history / learner_reflection_feed still return the
--     caller's own rows and nothing for another learner's enrollment;
--   * the admin reads are the same rows as the learner's (one engine), per
--     enrollment, with private My Journey reflections withheld from admin;
--   * a past enrollment is listed and read on its own, never blended.
begin;

select plan(40);

-- Learners 1-3 share a cohort (a Triad needs three members); 7 is an admin.
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_user_meta_data, created_at, updated_at, confirmation_token, email_change_token_new, recovery_token)
select ('c3a00000-0000-0000-0000-00000000000' || n)::uuid, '00000000-0000-0000-0000-000000000000'::uuid,
  'authenticated', 'authenticated', 'admin-detail-' || n || '@example.test', 'test', now(),
  jsonb_build_object('full_name', 'Admin Detail ' || n), now(), now(), '', '', ''
from unnest(array[1, 2, 3, 7]) n;

insert into public.user_roles (user_id, role) values ('c3a00000-0000-0000-0000-000000000007', 'admin');

insert into public.organizations (id, name) values ('c3a00000-0000-0000-0000-0000000000a1', 'Admin detail org');
insert into public.programmes (id, name) values
  ('c3a00000-0000-0000-0000-0000000000b1', 'Admin detail programme'),
  ('c3a00000-0000-0000-0000-0000000000b0', 'Admin detail past programme');
insert into public.cohorts (id, name, programme_id, organization_id, start_date, end_date) values
  ('c3a00000-0000-0000-0000-0000000000c1', 'Admin detail cohort', 'c3a00000-0000-0000-0000-0000000000b1',
   'c3a00000-0000-0000-0000-0000000000a1', date '2026-01-05', date '2026-07-05'),
  ('c3a00000-0000-0000-0000-0000000000c0', 'Admin detail past cohort', 'c3a00000-0000-0000-0000-0000000000b0',
   'c3a00000-0000-0000-0000-0000000000a1', date '2025-01-05', date '2025-07-05');
insert into public.programme_modules (programme_id, module, enabled, config) values
  ('c3a00000-0000-0000-0000-0000000000b1', 'triads', true, '{"required":true,"required_units":1,"distribution_settings":{}}');

insert into public.programme_enrollments (id, user_id, programme_id, cohort_id, organization_id, start_date, end_date, status)
select ('c3a00000-0000-0000-0000-0000000000e' || n)::uuid, ('c3a00000-0000-0000-0000-00000000000' || n)::uuid,
  'c3a00000-0000-0000-0000-0000000000b1', 'c3a00000-0000-0000-0000-0000000000c1',
  'c3a00000-0000-0000-0000-0000000000a1', date '2026-01-05', date '2026-07-05', 'active'
from generate_series(1, 3) n;
-- Learner 1 also has a finished, earlier enrollment in another programme.
insert into public.programme_enrollments (id, user_id, programme_id, cohort_id, organization_id, start_date, end_date, status)
values ('c3a00000-0000-0000-0000-0000000000e0', 'c3a00000-0000-0000-0000-000000000001',
  'c3a00000-0000-0000-0000-0000000000b0', 'c3a00000-0000-0000-0000-0000000000c0',
  'c3a00000-0000-0000-0000-0000000000a1', date '2025-01-05', date '2025-07-05', 'completed');

select set_config('request.jwt.claim.sub', 'c3a00000-0000-0000-0000-000000000001', true);

-- One completed Triad for the current enrollment, with learner 1's reflection.
insert into public.triad_groups (id, cohort_requirement_date_id, is_active)
select 'c3a00000-0000-0000-0000-0000000000f0', d.id, true
from public.cohort_requirement_dates d
where d.cohort_id = 'c3a00000-0000-0000-0000-0000000000c1' and d.module = 'triads' and d.ordinal = 1;
insert into public.triad_group_members (triad_group_id, enrollment_id, member_order) values
  ('c3a00000-0000-0000-0000-0000000000f0', 'c3a00000-0000-0000-0000-0000000000e1', 1),
  ('c3a00000-0000-0000-0000-0000000000f0', 'c3a00000-0000-0000-0000-0000000000e2', 2),
  ('c3a00000-0000-0000-0000-0000000000f0', 'c3a00000-0000-0000-0000-0000000000e3', 3);
insert into public.triad_sessions (id, triad_group_id, scheduled_start_time, status)
values ('c3a00000-0000-0000-0000-0000000000f1', 'c3a00000-0000-0000-0000-0000000000f0', '2026-02-16T10:00:00Z', 'completed');
insert into public.triad_reflections (id, triad_session_id, enrollment_id, satisfaction_rating)
values ('c3a00000-0000-0000-0000-0000000000f2', 'c3a00000-0000-0000-0000-0000000000f1', 'c3a00000-0000-0000-0000-0000000000e1', 4);
insert into public.triad_reflection_answers (triad_reflection_id, question_id, answer_text)
values ('c3a00000-0000-0000-0000-0000000000f2', '7d1a0000-0000-4000-8000-000000000001', 'Triad reflection: pausing helps.');

-- A private My Journey reflection, a goal and an action on the current enrollment.
insert into public.coachee_reflections (coachee_id, enrollment_id, body, mood)
values ('c3a00000-0000-0000-0000-000000000001', 'c3a00000-0000-0000-0000-0000000000e1', 'PRIVATE JOURNEY NOTE', 'proud');
insert into public.coachee_goals (id, coachee_id, enrollment_id, title)
values ('c3a00000-0000-0000-0000-0000000000d1', 'c3a00000-0000-0000-0000-000000000001', 'c3a00000-0000-0000-0000-0000000000e1', 'Delegate more');
insert into public.enrollment_actions (enrollment_id, owner_user_id, goal_id, title, status)
values ('c3a00000-0000-0000-0000-0000000000e1', 'c3a00000-0000-0000-0000-000000000001',
  'c3a00000-0000-0000-0000-0000000000d1', 'Open action', 'open');

-- ===== Grants =====
select ok(not has_function_privilege('authenticated', 'public.canonical_session_history(uuid)', 'EXECUTE'),
  'canonical_session_history is internal (not callable by authenticated)');
select ok(not has_function_privilege('authenticated', 'public.canonical_reflection_feed(uuid)', 'EXECUTE'),
  'canonical_reflection_feed is internal (not callable by authenticated)');
select ok(not has_function_privilege('anon', f, 'EXECUTE'), 'anon cannot execute ' || f)
from unnest(array[
  'public.admin_user_enrollments(uuid,date)',
  'public.admin_enrollment_module_progress(uuid,date)',
  'public.admin_enrollment_engagement(uuid)',
  'public.admin_enrollment_goals(uuid)',
  'public.admin_enrollment_goal_checkins(uuid)',
  'public.admin_enrollment_actions(uuid)',
  'public.admin_learner_session_history(uuid)',
  'public.admin_learner_reflection_feed(uuid)'
]) f;

-- ===== Learner 1 (not an admin) =====
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

create temporary table learner_history as
select * from public.learner_session_history('c3a00000-0000-0000-0000-0000000000e1');
create temporary table learner_feed as
select * from public.learner_reflection_feed('c3a00000-0000-0000-0000-0000000000e1');

select is((select count(*)::integer from learner_history), 1, 'learner sees their own Triad session');
select is((select count(*)::integer from public.learner_session_history('c3a00000-0000-0000-0000-0000000000e2')), 0,
  'learner_session_history returns nothing for another learner''s enrollment');
select is((select count(*)::integer from learner_feed), 2,
  'learner sees their own reflections, private ones included');
select ok(exists(select 1 from learner_feed where source_type = 'journey_reflection' and is_private),
  'the learner''s private My Journey reflection is in their own feed');
select is((select count(*)::integer from public.learner_reflection_feed('c3a00000-0000-0000-0000-0000000000e2')), 0,
  'learner_reflection_feed returns nothing for another learner''s enrollment');

select is((select count(*)::integer from public.admin_user_enrollments('c3a00000-0000-0000-0000-000000000001')), 0,
  'non-admin: admin_user_enrollments returns nothing (own user id)');
select is((select count(*)::integer from public.admin_enrollment_module_progress('c3a00000-0000-0000-0000-0000000000e1')), 0,
  'non-admin: admin_enrollment_module_progress returns nothing');
select is((select count(*)::integer from public.admin_enrollment_engagement('c3a00000-0000-0000-0000-0000000000e1')), 0,
  'non-admin: admin_enrollment_engagement returns nothing');
select is((select count(*)::integer from public.admin_enrollment_goals('c3a00000-0000-0000-0000-0000000000e1')), 0,
  'non-admin: admin_enrollment_goals returns nothing');
select is((select count(*)::integer from public.admin_enrollment_goal_checkins('c3a00000-0000-0000-0000-0000000000e1')), 0,
  'non-admin: admin_enrollment_goal_checkins returns nothing');
select is((select count(*)::integer from public.admin_enrollment_actions('c3a00000-0000-0000-0000-0000000000e1')), 0,
  'non-admin: admin_enrollment_actions returns nothing');
select is((select count(*)::integer from public.admin_learner_session_history('c3a00000-0000-0000-0000-0000000000e1')), 0,
  'non-admin: admin_learner_session_history returns nothing');
select is((select count(*)::integer from public.admin_learner_reflection_feed('c3a00000-0000-0000-0000-0000000000e1')), 0,
  'non-admin: admin_learner_reflection_feed returns nothing');

-- Another learner in the same Triad group cannot use the admin wrappers either.
select set_config('request.jwt.claim.sub', 'c3a00000-0000-0000-0000-000000000002', true);
select is((select count(*)::integer from public.admin_learner_session_history('c3a00000-0000-0000-0000-0000000000e1')), 0,
  'non-admin peer: admin_learner_session_history returns nothing for someone else');
select is((select count(*)::integer from public.admin_learner_reflection_feed('c3a00000-0000-0000-0000-0000000000e1')), 0,
  'non-admin peer: admin_learner_reflection_feed returns nothing for someone else');

-- ===== Admin =====
select set_config('request.jwt.claim.sub', 'c3a00000-0000-0000-0000-000000000007', true);

select results_eq(
  $$select enrollment_id, stored_enrollment_status::text from public.admin_user_enrollments('c3a00000-0000-0000-0000-000000000001')$$,
  $$values ('c3a00000-0000-0000-0000-0000000000e1'::uuid, 'active'::text), ('c3a00000-0000-0000-0000-0000000000e0'::uuid, 'completed'::text)$$,
  'admin lists every enrollment of the user, newest first, past one included'
);
select is((select programme_name || ' / ' || cohort_name || ' / ' || organization_name
             from public.admin_user_enrollments('c3a00000-0000-0000-0000-000000000001')
            where enrollment_id = 'c3a00000-0000-0000-0000-0000000000e0'),
  'Admin detail past programme / Admin detail past cohort / Admin detail org',
  'each enrollment carries its own programme, cohort and organization');
select is((select count(*)::integer from public.admin_user_enrollments('c3a00000-0000-0000-0000-000000000002')), 1,
  'admin_user_enrollments is scoped to the requested user');

select set_eq(
  $$select session_key from public.admin_learner_session_history('c3a00000-0000-0000-0000-0000000000e1')$$,
  $$select session_key from learner_history$$,
  'admin session history is exactly the learner''s own (one engine)'
);
select is((select count(*)::integer from public.admin_learner_session_history('c3a00000-0000-0000-0000-0000000000e0')), 0,
  'the past enrollment has its own (empty) session history -- nothing blended in');

select set_eq(
  $$select reflection_key from public.admin_learner_reflection_feed('c3a00000-0000-0000-0000-0000000000e1')$$,
  $$select reflection_key from learner_feed where not is_private$$,
  'admin reflection feed = the learner''s feed minus private rows'
);
select is((select count(*)::integer from public.admin_learner_reflection_feed('c3a00000-0000-0000-0000-0000000000e1')
            where body ~ 'PRIVATE JOURNEY NOTE'), 0,
  'admin never sees the learner''s private My Journey reflection');

select is((select completed_units || '/' || required_units
             from public.admin_enrollment_module_progress('c3a00000-0000-0000-0000-0000000000e1')
            where module = 'triads'), '1/1',
  'admin module progress reads canonical_module_progress (Triads 1/1)');
select is((select count(*)::integer from public.admin_enrollment_module_progress('c3a00000-0000-0000-0000-0000000000e0')
            where required_units > 0), 0,
  'the past enrollment''s module progress is its own programme''s (no Triads)');

select is((select total_action_count from public.admin_enrollment_engagement('c3a00000-0000-0000-0000-0000000000e1')), 1,
  'admin engagement reads canonical_enrollment_engagement');
select is((select count(*)::integer from public.admin_enrollment_goals('c3a00000-0000-0000-0000-0000000000e1')), 1,
  'admin sees the enrollment''s goals');
select is((select count(*)::integer from public.admin_enrollment_goals('c3a00000-0000-0000-0000-0000000000e0')), 0,
  'goals of the current enrollment do not appear on the past one');
select is((select title from public.admin_enrollment_actions('c3a00000-0000-0000-0000-0000000000e1')), 'Open action',
  'admin sees the enrollment''s actions');

reset role;

select ok(pg_get_functiondef('public.learner_session_history(uuid)'::regprocedure) ~ 'canonical_session_history'
  and pg_get_functiondef('public.admin_learner_session_history(uuid)'::regprocedure) ~ 'canonical_session_history',
  'learner and admin session history are wrappers over the one engine');
select ok(pg_get_functiondef('public.canonical_reflection_feed(uuid)'::regprocedure)
    !~ 'coach_notes|coach_private_notes|provider_notes|provider_private_notes|mentor_notes|mentoring_feedback|coach_session_feedback',
  'the shared reflection engine never selects coach/mentor/provider-authored columns');

select * from finish();
rollback;
