-- Browser-computed numbers in SQL (20261007001100_browser_numbers; Prompt 15 Part B).
--
--   6. admin_dashboard_summary / admin_analytics_summary: held sessions over
--      reporting_enrollments() (a demo organisation's never count), Peer in
--      canonical units, practice apart, at risk = sponsor_needs_attention.
--      They span the whole database, so each assertion is the change this
--      fixture makes.
--   7. admin_programme_training_engagement: per week from
--      canonical_training_week_fulfilment.
--   8. coach_client_summary: the Coach's clients, current enrollment chosen
--      on the server, next session, overdue actions as of programme_today().
--   9. canonical_next_session_by_module and its learner and Coach wrappers.
--  10. learner_training_summary: quiz scores and average, the prompt streak.
--  12. admin_coach_delivery_summary: held Coaching per Coach, reported only.
begin;
select plan(22);

-- 01 Admin   02 Coach K (Coach, Mentor, Peer opt-in)   03 learner L1 (real org)
-- 04 learner L2 (demo org)   05 learner L3 (real org, L1's Peer partner)
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_user_meta_data, created_at, updated_at, confirmation_token, email_change_token_new, recovery_token)
select ('c7b00000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid,
  '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated',
  'numbers-' || n || '@example.test', 'test', now(),
  jsonb_build_object('full_name', 'Numbers Person ' || n), now(), now(), '', '', ''
from generate_series(1, 5) n;
insert into public.user_roles (user_id, role) values
  ('c7b00000-0000-4000-8000-000000000001', 'admin'), ('c7b00000-0000-4000-8000-000000000002', 'coach'),
  ('c7b00000-0000-4000-8000-000000000003', 'coachee'), ('c7b00000-0000-4000-8000-000000000004', 'coachee'),
  ('c7b00000-0000-4000-8000-000000000005', 'coachee')
on conflict do nothing;
update public.profiles set status = 'active'::public.user_status, peer_coaching_opt_in = true where id::text like 'c7b00000-%';
insert into public.coach_profiles (id, approval_status, peer_coaching_opt_in) values ('c7b00000-0000-4000-8000-000000000002', 'active', true)
on conflict (id) do update set approval_status = 'active', peer_coaching_opt_in = true;
insert into public.mentor_profiles (coach_user_id, is_active) values ('c7b00000-0000-4000-8000-000000000002', true) on conflict do nothing;
insert into public.organizations (id, name, is_demo) values
  ('c7b50000-0000-4000-8000-000000000001', 'Numbers Real Org', false),
  ('c7b50000-0000-4000-8000-000000000002', 'Numbers Demo Org', true);

-- The Admin's view before this fixture's enrollments exist.
select set_config('request.jwt.claims', json_build_object('sub', 'c7b00000-0000-4000-8000-000000000001')::text, true);
create temporary table base as
select public.admin_analytics_summary() as analytics, public.admin_dashboard_summary() as dashboard;
grant select on base to authenticated;

-- Programme P: two Coaching units (unit 1 due three days ago), one Mentoring,
-- one Peer (dyad), one Training week (Skill Card and quiz).
insert into public.programmes (id, name) values ('c7b10000-0000-4000-8000-000000000001', 'Numbers Programme');
insert into public.training_weeks (id, programme_id, week_number, title, is_visible, skill_card_visible)
values ('c7b70000-0000-4000-8000-000000000001', 'c7b10000-0000-4000-8000-000000000001', 1, 'Week 1', true, true);
insert into public.assignments (id, training_week_id, title, assignment_type, is_visible)
values ('c7b70000-0000-4000-8000-000000000002', 'c7b70000-0000-4000-8000-000000000001', 'Quiz 1', 'quiz', true);
insert into public.quiz_questions (id, assignment_id, question_text, options, sort_order) values
  ('c7b70000-0000-4000-8000-000000000003', 'c7b70000-0000-4000-8000-000000000002', 'Q1',
   '[{"id": "a", "text": "Right", "is_correct": true}, {"id": "b", "text": "Wrong", "is_correct": false}]', 1),
  ('c7b70000-0000-4000-8000-000000000004', 'c7b70000-0000-4000-8000-000000000002', 'Q2',
   '[{"id": "a", "text": "Right", "is_correct": true}, {"id": "b", "text": "Wrong", "is_correct": false}]', 2);
insert into public.programme_modules (programme_id, module, enabled, config) values
  ('c7b10000-0000-4000-8000-000000000001', 'coaching', true, '{"required": true, "required_units": 2}'),
  ('c7b10000-0000-4000-8000-000000000001', 'mentoring', true, '{"required": true, "required_units": 1}'),
  ('c7b10000-0000-4000-8000-000000000001', 'peer_coaching', true, '{"required": true, "required_units": 1}'),
  ('c7b10000-0000-4000-8000-000000000001', 'training', true,
   jsonb_build_object('required', true, 'required_units', 1, 'learning_components', jsonb_build_array('skill_cards', 'quizzes'),
     'distribution_settings', jsonb_build_object('training_week_ids', jsonb_build_array('c7b70000-0000-4000-8000-000000000001'))));
insert into public.cohorts (id, name, programme_id, start_date, end_date) values
  ('c7b20000-0000-4000-8000-000000000001', 'Numbers Cohort', 'c7b10000-0000-4000-8000-000000000001',
   public.programme_today() - 30, public.programme_today() + 120);
update public.cohort_requirement_dates set due_on = case when module = 'coaching' and ordinal = 1 then public.programme_today() - 3
    else public.programme_today() + 30 end,
  is_overridden = true, generation_method = 'manual', materialized_via = 'admin_save'
 where cohort_id = 'c7b20000-0000-4000-8000-000000000001' and module <> 'training';
insert into public.programme_enrollments (id, programme_id, user_id, cohort_id, organization_id, status, start_date, end_date)
select ('c7b30000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid, 'c7b10000-0000-4000-8000-000000000001',
  ('c7b00000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid, 'c7b20000-0000-4000-8000-000000000001',
  case when n = 4 then 'c7b50000-0000-4000-8000-000000000002' else 'c7b50000-0000-4000-8000-000000000001' end::uuid,
  'active', public.programme_today() - 30, public.programme_today() + 120
from unnest(array[3, 4, 5]) n;
insert into public.coachee_goals (coachee_id, enrollment_id, title)
select e.user_id, e.id, 'Numbers goal' from public.programme_enrollments e where e.id::text like 'c7b30000-%';
insert into public.cohort_coach_assignments (cohort_id, coach_id) values ('c7b20000-0000-4000-8000-000000000001', 'c7b00000-0000-4000-8000-000000000002');
insert into public.cohort_mentors (cohort_id, mentor_user_id) values ('c7b20000-0000-4000-8000-000000000001', 'c7b00000-0000-4000-8000-000000000002');
select public.admin_create_peer_dyad('c7b20000-0000-4000-8000-000000000001', 'c7b10000-0000-4000-8000-000000000001',
  'c7b30000-0000-4000-8000-000000000003', 'c7b30000-0000-4000-8000-000000000005');

create temporary table req (module text, ordinal integer, id uuid);
insert into req select d.module::text, d.ordinal, d.id from public.cohort_requirement_dates d where d.cohort_id = 'c7b20000-0000-4000-8000-000000000001';
-- Held this morning (Vietnam), so it is this month's.
create or replace function pg_temp.held_today(p_minutes integer) returns timestamptz language sql stable as $$
  select (public.programme_today() + time '00:30') at time zone public.programme_time_zone() + make_interval(mins => p_minutes)
$$;

-- Sessions, as the lifecycle writes them.
select set_config('app.session_transition', 'on', true);
insert into public.sessions (id, enrollment_id, cohort_requirement_id, coach_id, coachee_id, topic, start_time, duration_minutes, status, meeting_url) values
  -- L1: Coaching 1 held (60 min); L2 (demo): held, never counted; L3: Coaching 2 booked, no link yet.
  ('c7b40000-0000-4000-8000-000000000001', 'c7b30000-0000-4000-8000-000000000003', (select id from req where module = 'coaching' and ordinal = 1),
   'c7b00000-0000-4000-8000-000000000002', 'c7b00000-0000-4000-8000-000000000003', 'L1 held', pg_temp.held_today(0), 60, 'completed', 'https://meet'),
  ('c7b40000-0000-4000-8000-000000000002', 'c7b30000-0000-4000-8000-000000000004', (select id from req where module = 'coaching' and ordinal = 1),
   'c7b00000-0000-4000-8000-000000000002', 'c7b00000-0000-4000-8000-000000000004', 'L2 held', pg_temp.held_today(0), 60, 'completed', 'https://meet'),
  ('c7b40000-0000-4000-8000-000000000003', 'c7b30000-0000-4000-8000-000000000005', (select id from req where module = 'coaching' and ordinal = 2),
   'c7b00000-0000-4000-8000-000000000002', 'c7b00000-0000-4000-8000-000000000005', 'L3 next', now() + interval '4 days', 60, 'confirmed', null);
insert into public.mentoring_sessions (id, enrollment_id, cohort_requirement_id, mentor_id, mentee_id, topic, start_time, duration_minutes, status)
values ('c7b40000-0000-4000-8000-000000000011', 'c7b30000-0000-4000-8000-000000000003', (select id from req where module = 'mentoring'),
        'c7b00000-0000-4000-8000-000000000002', 'c7b00000-0000-4000-8000-000000000003', 'L1 mentoring', pg_temp.held_today(90), 45, 'completed');
-- The dyad's Peer session (60 min): one canonical unit for each of L1 and L3.
insert into public.coachee_peer_sessions (id, peer_provider_id, peer_receiver_id, enrollment_id, topic, start_time, duration_minutes, status)
values ('c7b40000-0000-4000-8000-000000000021', 'c7b00000-0000-4000-8000-000000000005', 'c7b00000-0000-4000-8000-000000000003',
        'c7b30000-0000-4000-8000-000000000003', 'Dyad', pg_temp.held_today(180), 60, 'completed');
-- Coach-pool practice (30 min): L1 with Coach K.
insert into public.peer_sessions (id, peer_coach_id, peer_coachee_id, enrollment_id, topic, start_time, duration_minutes, status)
values ('c7b40000-0000-4000-8000-000000000031', 'c7b00000-0000-4000-8000-000000000002', 'c7b00000-0000-4000-8000-000000000003',
        'c7b30000-0000-4000-8000-000000000003', 'Practice', pg_temp.held_today(300), 30, 'completed');
select set_config('app.session_transition', '', true);
-- L1's follow-up from Coaching 1, due yesterday and still open.
insert into public.enrollment_actions (enrollment_id, owner_user_id, title, goal_id, due_date, source_activity_type, source_activity_id, status)
select 'c7b30000-0000-4000-8000-000000000003', 'c7b00000-0000-4000-8000-000000000003', 'Ask for feedback', g.id,
  public.programme_today() - 1, 'coaching', 'c7b40000-0000-4000-8000-000000000001', 'open'
from public.coachee_goals g where g.enrollment_id = 'c7b30000-0000-4000-8000-000000000003';
-- Week 1's Daily Prompts (days 1 and 2, both due): L1 answered day 2 only.
insert into public.daily_prompts (id, training_week_id, day_offset, prompt_text, is_visible) values
  ('c7b70000-0000-4000-8000-000000000011', 'c7b70000-0000-4000-8000-000000000001', 1, 'Day 1', true),
  ('c7b70000-0000-4000-8000-000000000012', 'c7b70000-0000-4000-8000-000000000001', 2, 'Day 2', true);
insert into public.daily_prompt_responses (daily_prompt_id, user_id, enrollment_id, response_text, responded_at)
values ('c7b70000-0000-4000-8000-000000000012', 'c7b00000-0000-4000-8000-000000000003', 'c7b30000-0000-4000-8000-000000000003', 'Tried it', now() - interval '1 day');
-- L1's Training week 1: Skill Card and the quiz (one of two right: 50%, scored by the database).
insert into public.training_progress (user_id, enrollment_id, training_week_id, viewed_at, completed_at)
values ('c7b00000-0000-4000-8000-000000000003', 'c7b30000-0000-4000-8000-000000000003', 'c7b70000-0000-4000-8000-000000000001', now() - interval '1 day', now() - interval '1 day');
insert into public.assignment_submissions (assignment_id, user_id, enrollment_id, answers, submitted_at, score_pct)
values ('c7b70000-0000-4000-8000-000000000002', 'c7b00000-0000-4000-8000-000000000003', 'c7b30000-0000-4000-8000-000000000003',
        '{"c7b70000-0000-4000-8000-000000000003": "a", "c7b70000-0000-4000-8000-000000000004": "b"}', now() - interval '1 day', null);

-- ===========================================================================
-- 6. Admin dashboard and analytics
-- ===========================================================================
set local role authenticated;
select results_eq(
  $$select (a->>'coaching_sessions')::int - (b.analytics->>'coaching_sessions')::int,
           (a->>'mentoring_sessions')::int - (b.analytics->>'mentoring_sessions')::int,
           (a->>'peer_units')::int - (b.analytics->>'peer_units')::int,
           (a->>'practice_sessions')::int - (b.analytics->>'practice_sessions')::int
      from (select public.admin_analytics_summary() a) s, base b$$,
  $$values (1, 1, 2, 1)$$,
  '6a. held: 1 Coaching (the demo learner''s is not counted), 1 Mentoring, 2 Peer units (one dyad session, a unit each), 1 practice');
select is((select (a->>'total_minutes')::int - (b.analytics->>'total_minutes')::int
             from (select public.admin_analytics_summary() a) s, base b),
  195, '6b. hours count each session once: 60 + 45 + 60 (the dyad, once) + 30 minutes');
select is((select (a->>'learners_enrolled')::int - (b.analytics->>'learners_enrolled')::int
             from (select public.admin_analytics_summary() a) s, base b),
  2, '6c. two reported learners (not the demo one)');
select is((select (a->>'at_risk')::int - (b.analytics->>'at_risk')::int
             from (select public.admin_analytics_summary() a) s, base b),
  1, '6d. at risk is the Sponsor rule: L3''s Coaching 1 is overdue; L1''s is held');
select ok((select (a->'top_coaches') @> jsonb_build_array(jsonb_build_object('coach_id', 'c7b00000-0000-4000-8000-000000000002', 'delivered', 1, 'coachees', 1))
             from (select public.admin_analytics_summary() a) s),
  '6e. Coach K delivered one reported Coaching session, to one learner');
select ok((select (a->'practice_by_coach') @> jsonb_build_array(jsonb_build_object('coach_id', 'c7b00000-0000-4000-8000-000000000002', 'given', 1))
             from (select public.admin_analytics_summary() a) s),
  '6f. ... and gave one practice session (shown apart from Peer)');
select results_eq(
  $$select (d->>'sessions_this_month')::int - (b.dashboard->>'sessions_this_month')::int,
           (d->>'practice_this_month')::int - (b.dashboard->>'practice_this_month')::int,
           (d->>'pending_link_sessions')::int - (b.dashboard->>'pending_link_sessions')::int,
           jsonb_array_length(d->'monthly')
      from (select public.admin_dashboard_summary() d) s, base b$$,
  $$values (4, 1, 1, 8)$$,
  '6g. dashboard: 4 programme sessions and 1 practice held this month, 1 upcoming session without a link, 8 months of history');
select results_eq($$select delivered_sessions, learners_served from public.admin_coach_delivery_summary()
                     where coach_id = 'c7b00000-0000-4000-8000-000000000002'$$,
  $$values (1, 1)$$, '12a. Coach K delivered one reported Coaching session to one learner (the demo learner''s is not counted)');
select set_config('request.jwt.claims', json_build_object('sub', 'c7b00000-0000-4000-8000-000000000003')::text, true);
select throws_ok($$select public.admin_analytics_summary()$$, '42501', null, '6h. only an Admin reads the summaries');

-- ===========================================================================
-- 7. Training engagement per week
-- ===========================================================================
select set_config('request.jwt.claims', json_build_object('sub', 'c7b00000-0000-4000-8000-000000000001')::text, true);
select results_eq(
  $$select is_total, enrolled_count, completed_count, skill_card_completed_count, quiz_completed_count, quiz_pct, quiz_avg_score
      from public.admin_programme_training_engagement('c7b10000-0000-4000-8000-000000000001') order by is_total$$,
  $$values (false, 2, 1, 1, 1, 50.0::numeric, 50.0::numeric), (true, 2, 1, 1, 1, 50.0, 50.0)$$,
  '7a. week 1: 2 reported learners, 1 completed it (Skill Card and quiz), quiz done by 50%, 50% average score; the total row agrees');
select set_config('request.jwt.claims', json_build_object('sub', 'c7b00000-0000-4000-8000-000000000003')::text, true);
select throws_ok($$select * from public.admin_programme_training_engagement('c7b10000-0000-4000-8000-000000000001')$$,
  '42501', null, '7b. a learner cannot read it (the Admin and the service role can)');

-- ===========================================================================
-- 8. The Coach's clients
-- ===========================================================================
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'c7b00000-0000-4000-8000-000000000002')::text, true);
select results_eq(
  $$select client_id, enrollment_id, completed_sessions, upcoming_sessions, overdue_actions, action_items_total
      from public.coach_client_summary() where client_id::text like 'c7b00000-%' order by client_id$$,
  $$values ('c7b00000-0000-4000-8000-000000000003'::uuid, 'c7b30000-0000-4000-8000-000000000003'::uuid, 1, 0, 1, 1),
           ('c7b00000-0000-4000-8000-000000000004'::uuid, 'c7b30000-0000-4000-8000-000000000004'::uuid, 1, 0, 0, 0),
           ('c7b00000-0000-4000-8000-000000000005'::uuid, 'c7b30000-0000-4000-8000-000000000005'::uuid, 0, 1, 0, 0)$$,
  '8a. each client with their current enrollment, sessions with this Coach and actions overdue as of programme_today()');
select is((select next_session_at from public.coach_client_summary() where client_id = 'c7b00000-0000-4000-8000-000000000005'),
  (select start_time from public.sessions where id = 'c7b40000-0000-4000-8000-000000000003'),
  '8b. L3''s next session is their booked Coaching 2');
select results_eq(
  $$select c.progress_available, c.completion_pct = p.full_completion_pct, c.pace_status = p.pace_status
      from public.coach_client_summary() c,
           lateral (select * from public.coach_canonical_enrollment_progress(array[c.enrollment_id])) p
     where c.client_id = 'c7b00000-0000-4000-8000-000000000003'$$,
  $$values (true, true, true)$$,
  '8c. completion and pace are the canonical engine''s');
select set_config('request.jwt.claims', json_build_object('sub', 'c7b00000-0000-4000-8000-000000000003')::text, true);
select is((select count(*)::int from public.coach_client_summary()), 0, '8d. a learner has no clients');

-- ===========================================================================
-- 9. The next session per module
-- ===========================================================================
select set_config('request.jwt.claims', json_build_object('sub', 'c7b00000-0000-4000-8000-000000000005')::text, true);
select results_eq(
  $$select module::text, is_practice, title, counterpart_names, upcoming_count, next_session_at
      from public.learner_next_session_by_module('c7b30000-0000-4000-8000-000000000005')$$,
  $$values ('coaching'::text, false, 'L3 next'::text, array['Numbers Person 2']::text[], 1,
            (select start_time from public.sessions where id = 'c7b40000-0000-4000-8000-000000000003'))$$,
  '9a. the learner''s next session per module: Coaching 2, with Coach K, the only one ahead');
select is((select count(*)::int from public.learner_next_session_by_module('c7b30000-0000-4000-8000-000000000003')),
  0, '9b. ... and only for their own enrollment');
select set_config('request.jwt.claims', json_build_object('sub', 'c7b00000-0000-4000-8000-000000000002')::text, true);
select results_eq(
  $$select module::text, is_practice, title, learner_name, upcoming_count, pending_count, delivered_count, learner_count
      from public.coach_next_session_by_module() where module in ('coaching', 'mentoring', 'peer_coaching') order by module, is_practice$$,
  $$values ('coaching'::text, false, 'L3 next'::text, 'Numbers Person 5'::text, 1, 0, 2, 3),
           ('mentoring', false, null, null, 0, 0, 1, 1),
           ('peer_coaching', true, null, null, 0, 0, 1, 1)$$,
  '9c. the Coach''s side: next Coaching with L3; 2 delivered to 3 learners; Mentoring and practice delivered, nothing ahead');
-- ===========================================================================
-- 10. The learner's Training summary
-- ===========================================================================
select set_config('request.jwt.claims', json_build_object('sub', 'c7b00000-0000-4000-8000-000000000003')::text, true);
select results_eq($$select quiz_avg, quiz_scores, reflection_streak from public.learner_training_summary('c7b30000-0000-4000-8000-000000000003')$$,
  $$values (50.0::numeric, '[{"week_number": 1, "score_pct": 50.0}]'::jsonb, 1)$$,
  '10a. quiz scores as the database scored them, their average, and a streak of 1 (day 2 answered, day 1 not)');
select is((select count(*)::int from public.learner_training_summary('c7b30000-0000-4000-8000-000000000005')),
  0, '10b. only for the learner''s own enrollment');
reset role;
select ok(not has_function_privilege('authenticated', 'public.canonical_next_session_by_module(uuid)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.learner_next_session_by_module(uuid)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.coach_next_session_by_module()', 'EXECUTE'),
  '9d. the construction is internal; the learner and Coach wrappers are client-callable');
reset role;
select ok(not has_function_privilege('authenticated', 'public.reported_held_sessions_internal()', 'EXECUTE'),
  '8e. the held-sessions construction is not client-callable; the role wrappers are');

select * from finish();
rollback;
