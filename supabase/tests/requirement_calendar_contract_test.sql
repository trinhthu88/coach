-- N required units = N requirement instances, each independently dated, read
-- through ONE canonical requirement calendar by Admin, Learner and Sponsor
-- (20260928100000_requirement_calendar, 20260928110000_goal_setting_period,
-- 20260928120000_organisation_enrollments_and_integrity).
--
-- Fixture (as of current_date):
--   programme: Coaching 4, Mentoring 2, Peer 2, Triads 2, Training 8 selected
--              weeks (+ a 9th week that is NOT selected) = 18 requirements;
--              learning_components = all four child types
--   cohort:    start today-30, end today+200 -> Training weeks due at
--              -30,-23,-16,-9,-2 (5 due) and +5,+12,+19 (3 not yet due)
--   deadlines: Coaching today-5 (4 due), Mentoring +10, Peer +60, Triads +90
--   org A:     learners 11 (nothing done: the "Ana" shape), 12 (partial), 13
--   org B:     learners 14, 15 -- SAME cohort
begin;
select plan(65);

-- ---------------------------------------------------------------------------
-- Fixture
-- ---------------------------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_user_meta_data, created_at, updated_at, confirmation_token, email_change_token_new, recovery_token)
select ('a9900000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid,
  '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated',
  'rcal-' || n || '@example.test', 'test', now(),
  jsonb_build_object('full_name', 'Calendar User ' || lpad(n::text, 2, '0')), now(), now(), '', '', ''
from unnest(array[1, 2, 3, 4, 11, 12, 13, 14, 15]) n;

insert into public.profiles (id, full_name, email, status)
select id, raw_user_meta_data->>'full_name', email, 'active'
from auth.users where email like 'rcal-%'
on conflict (id) do update set full_name = excluded.full_name, status = 'active';

insert into public.organizations (id, name) values
  ('b9900000-0000-4000-8000-00000000000a', 'Calendar Org A'),
  ('b9900000-0000-4000-8000-00000000000b', 'Calendar Org B');

insert into public.user_roles (user_id, role) values
  ('a9900000-0000-4000-8000-000000000001', 'admin'),
  ('a9900000-0000-4000-8000-000000000002', 'sponsor'),
  ('a9900000-0000-4000-8000-000000000003', 'sponsor'),
  ('a9900000-0000-4000-8000-000000000004', 'coach')
on conflict do nothing;
insert into public.sponsor_profiles (user_id, organization_id) values
  ('a9900000-0000-4000-8000-000000000002', 'b9900000-0000-4000-8000-00000000000a'),
  ('a9900000-0000-4000-8000-000000000003', 'b9900000-0000-4000-8000-00000000000b');

insert into public.programmes (id, name, duration_months)
values ('c9900000-0000-4000-8000-000000000001', 'Calendar Programme', 9);

insert into public.training_weeks (id, programme_id, week_number, title, is_visible, skill_card_visible)
select ('79900000-0000-4000-8000-0000000000' || lpad(w::text, 2, '0'))::uuid,
  'c9900000-0000-4000-8000-000000000001', w, 'Calendar week ' || w, true, true
from generate_series(1, 9) w;

-- One visible quiz and one visible reflection per week; daily prompts in
-- weeks 1-2. Hidden children (a quiz in week 4, a prompt in week 3) and the
-- children of the unselected week 9 must never count.
insert into public.assignments (training_week_id, title, assignment_type, is_visible)
select ('79900000-0000-4000-8000-0000000000' || lpad(w::text, 2, '0'))::uuid, 'Quiz ' || w, 'quiz', true
from generate_series(1, 9) w;
insert into public.assignments (training_week_id, title, assignment_type, is_visible)
values ('79900000-0000-4000-8000-000000000004', 'Hidden quiz', 'quiz', false);
insert into public.programme_reflections (id, programme_id, reflection_number, title, appears_at_week, is_visible)
select ('69900000-0000-4000-8000-0000000000' || lpad(w::text, 2, '0'))::uuid,
  'c9900000-0000-4000-8000-000000000001', w, 'Reflection ' || w, w, true
from generate_series(1, 9) w;
insert into public.daily_prompts (training_week_id, day_offset, prompt_text, is_visible) values
  ('79900000-0000-4000-8000-000000000001', 1, 'Prompt 1', true),
  ('79900000-0000-4000-8000-000000000002', 2, 'Prompt 2', true),
  ('79900000-0000-4000-8000-000000000003', 3, 'Hidden prompt', false);

insert into public.programme_modules (programme_id, module, enabled, config) values
  ('c9900000-0000-4000-8000-000000000001', 'coaching', true, '{"required": true, "required_units": 4}'),
  ('c9900000-0000-4000-8000-000000000001', 'mentoring', true, '{"required": true, "required_units": 2}'),
  ('c9900000-0000-4000-8000-000000000001', 'peer_coaching', true, '{"required": true, "required_units": 2}'),
  ('c9900000-0000-4000-8000-000000000001', 'triads', true, '{"required": true, "required_units": 2}'),
  ('c9900000-0000-4000-8000-000000000001', 'training', true,
   jsonb_build_object('required', true, 'required_units', 8,
     'learning_components', jsonb_build_array('skill_cards', 'quizzes', 'reflections', 'daily_prompts'),
     'distribution_settings', jsonb_build_object('training_week_ids',
       (select jsonb_agg(('79900000-0000-4000-8000-0000000000' || lpad(w::text, 2, '0'))) from generate_series(1, 8) w))));

insert into public.cohorts (id, name, programme_id, organization_id, start_date, end_date)
values ('d9900000-0000-4000-8000-000000000001', 'Calendar Shared Cohort', 'c9900000-0000-4000-8000-000000000001',
  'b9900000-0000-4000-8000-00000000000a', current_date - 30, current_date + 200);

select set_config('request.jwt.claim.sub', 'a9900000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select public.admin_set_cohort_module_deadlines('d9900000-0000-4000-8000-000000000001', jsonb_build_array(
  jsonb_build_object('programme_id', 'c9900000-0000-4000-8000-000000000001', 'module', 'coaching', 'completion_deadline', (current_date - 5)::text),
  jsonb_build_object('programme_id', 'c9900000-0000-4000-8000-000000000001', 'module', 'mentoring', 'completion_deadline', (current_date + 10)::text),
  jsonb_build_object('programme_id', 'c9900000-0000-4000-8000-000000000001', 'module', 'peer_coaching', 'completion_deadline', (current_date + 60)::text),
  jsonb_build_object('programme_id', 'c9900000-0000-4000-8000-000000000001', 'module', 'triads', 'completion_deadline', (current_date + 90)::text)));

insert into public.programme_enrollments (id, programme_id, user_id, cohort_id, organization_id, status, start_date)
select ('e9900000-0000-4000-8000-0000000000' || n)::uuid, 'c9900000-0000-4000-8000-000000000001',
  ('a9900000-0000-4000-8000-0000000000' || n)::uuid, 'd9900000-0000-4000-8000-000000000001',
  case when n <= 13 then 'b9900000-0000-4000-8000-00000000000a' else 'b9900000-0000-4000-8000-00000000000b' end::uuid,
  'active', current_date - 30
from unnest(array[11, 12, 13, 14, 15]) n;

-- Learner 12: an active rated goal, one completed Coaching session (on
-- requirement 1), Week 1 finished, and private text in every learning table.
insert into public.coachee_goals (id, coachee_id, enrollment_id, title, status)
values ('59900000-0000-4000-8000-000000000012', 'a9900000-0000-4000-8000-000000000012',
  'e9900000-0000-4000-8000-000000000012', 'Calendar goal', 'active');
insert into public.coachee_goal_ratings (goal_id, coachee_id, enrollment_id, start_rating, current_rating, target_rating)
values ('59900000-0000-4000-8000-000000000012', 'a9900000-0000-4000-8000-000000000012',
  'e9900000-0000-4000-8000-000000000012', 20, 50, 80);

select set_config('app.session_transition', 'on', true);
insert into public.sessions (id, enrollment_id, cohort_requirement_id, coach_id, coachee_id, topic, start_time, duration_minutes, status)
select '19900000-0000-4000-8000-000000000001', 'e9900000-0000-4000-8000-000000000012', d.id,
  'a9900000-0000-4000-8000-000000000004', 'a9900000-0000-4000-8000-000000000012',
  'Coaching 1', now() - interval '20 days', 60, 'completed'
from public.cohort_requirement_dates d
where d.cohort_id = 'd9900000-0000-4000-8000-000000000001' and d.module = 'coaching' and d.ordinal = 1;
select set_config('app.session_transition', 'off', true);

insert into public.training_progress (user_id, enrollment_id, training_week_id, viewed_at, completed_at)
values ('a9900000-0000-4000-8000-000000000012', 'e9900000-0000-4000-8000-000000000012',
  '79900000-0000-4000-8000-000000000001', now() - interval '28 days', now() - interval '28 days');
insert into public.assignment_submissions (assignment_id, user_id, enrollment_id, answers, reflection_text, submitted_at)
select a.id, 'a9900000-0000-4000-8000-000000000012', 'e9900000-0000-4000-8000-000000000012', '{}'::jsonb,
  'PRIVATE-QUIZ-NOTE-9f3', now() - interval '27 days'
from public.assignments a where a.training_week_id = '79900000-0000-4000-8000-000000000001';
insert into public.reflection_submissions (reflection_id, user_id, enrollment_id, confidence_score, submitted_at)
values ('69900000-0000-4000-8000-000000000001', 'a9900000-0000-4000-8000-000000000012',
  'e9900000-0000-4000-8000-000000000012', 7, now() - interval '27 days');
insert into public.daily_prompt_responses (daily_prompt_id, user_id, enrollment_id, opened_at, responded_at, response_text)
select dp.id, 'a9900000-0000-4000-8000-000000000012', 'e9900000-0000-4000-8000-000000000012',
  now() - interval '29 days', now() - interval '29 days', 'PRIVATE-PROMPT-ANSWER-9f3'
from public.daily_prompts dp where dp.training_week_id = '79900000-0000-4000-8000-000000000001';

create temp table cal_totals on commit drop as
select c.enrollment_id,
  count(*)::int as required, count(*) filter (where c.is_completed)::int as completed,
  count(*) filter (where c.is_due_as_of)::int as due, count(*) filter (where c.is_overdue)::int as overdue
from public.programme_enrollments e
cross join lateral public.canonical_enrollment_requirement_calendar(e.id, current_date) c
where e.cohort_id = 'd9900000-0000-4000-8000-000000000001'
group by c.enrollment_id;

-- ---------------------------------------------------------------------------
-- 1. N required units = N requirement instances (S1, S12, S13)
-- ---------------------------------------------------------------------------
select is(
  (select array_agg(n order by module) from (
     select module::text as module, count(*)::int as n from public.cohort_requirement_dates
     where cohort_id = 'd9900000-0000-4000-8000-000000000001' group by module) x),
  array[4, 2, 2, 8, 2],
  'coaching 4 / mentoring 2 / peer 2 / training 8 / triads 2 requirement instances');
select is(
  (select count(distinct training_week_id)::int from public.cohort_requirement_dates
   where cohort_id = 'd9900000-0000-4000-8000-000000000001' and module = 'training'),
  8, 'each of the 8 selected Training weeks maps to exactly one requirement');
select is(
  (select array_agg(tw.week_number order by d.ordinal) from public.cohort_requirement_dates d
   join public.training_weeks tw on tw.id = d.training_week_id
   where d.cohort_id = 'd9900000-0000-4000-8000-000000000001' and d.module = 'training'),
  array[1, 2, 3, 4, 5, 6, 7, 8], 'Training requirement ordinals follow week order; the unselected week 9 has none');
select is(
  (select count(distinct due_on)::int from public.cohort_requirement_dates
   where cohort_id = 'd9900000-0000-4000-8000-000000000001' and module = 'training'),
  8, 'every Training week carries its own date');
select is(
  (select due_on from public.cohort_requirement_dates d join public.training_weeks tw on tw.id = d.training_week_id
   where d.cohort_id = 'd9900000-0000-4000-8000-000000000001' and tw.week_number = 3),
  current_date - 16, 'a Training week defaults to its pacing date (cohort start + (week - 1) * 7)');
select is(
  (select count(*)::int from public.requirement_integrity_issues() i
   where i.cohort_id = 'd9900000-0000-4000-8000-000000000001' or i.programme_id = 'c9900000-0000-4000-8000-000000000001'),
  0, 'the fixture has no requirement integrity issue');
select throws_ok(
  $$insert into public.cohort_requirement_dates (cohort_id, programme_id, module, ordinal, due_on, generation_method, materialized_via)
    values ('d9900000-0000-4000-8000-000000000001', 'c9900000-0000-4000-8000-000000000001', 'training', 9, current_date, 'manual', 'admin_save')$$,
  '23514', null, 'a Training requirement must name its week');

-- ---------------------------------------------------------------------------
-- 2. The calendar: the "0 completed, only some due" leader (S4, S6)
-- ---------------------------------------------------------------------------
select is(
  (select array[required, completed, due, overdue] from cal_totals where enrollment_id = 'e9900000-0000-4000-8000-000000000011'),
  array[18, 0, 9, 9],
  'nothing completed: required 18, completed 0, due 9 (Coaching 4 + Training weeks 1-5), overdue 9');
select is(
  (select count(*)::int from public.canonical_enrollment_requirement_calendar('e9900000-0000-4000-8000-000000000011', current_date)
   where is_overdue and (due_on > current_date or is_completed)),
  0, 'no future or completed requirement is overdue');
select is(
  (select count(*)::int from public.canonical_enrollment_requirement_calendar('e9900000-0000-4000-8000-000000000011', current_date + 365)
   where is_overdue),
  18, 'once every date has passed, all 18 are overdue');
select is(
  (select array[required_units, completed_units, due_units, overdue_units]
   from public.canonical_enrollment_progress('e9900000-0000-4000-8000-000000000011', current_date)),
  (select array[required, completed, due, overdue] from cal_totals where enrollment_id = 'e9900000-0000-4000-8000-000000000011'),
  'canonical enrollment progress equals the calendar');
select is(
  (select requirement_label from public.canonical_enrollment_requirement_calendar('e9900000-0000-4000-8000-000000000011', current_date)
   where module = 'training' and requirement_index = 2),
  'Week 2: Calendar week 2', 'Training requirements carry their week label');
select is(
  (select requirement_label from public.canonical_enrollment_requirement_calendar('e9900000-0000-4000-8000-000000000011', current_date)
   where module = 'coaching' and requirement_index = 3),
  'Coaching Session 3', 'session requirements carry their unit label');

-- ---------------------------------------------------------------------------
-- 3. Completion (S5)
-- ---------------------------------------------------------------------------
select is(
  (select array[required, completed, due, overdue] from cal_totals where enrollment_id = 'e9900000-0000-4000-8000-000000000012'),
  array[18, 2, 9, 7],
  'partial leader: Coaching 1 + Week 1 completed, both due: overdue 7');
select is(
  (select array[is_completed, is_overdue]::text from public.canonical_enrollment_requirement_calendar('e9900000-0000-4000-8000-000000000012', current_date)
   where module = 'coaching' and requirement_index = 1),
  '{t,f}', 'a completed requirement is never overdue');
select is(
  (select completion_source from public.canonical_enrollment_requirement_calendar('e9900000-0000-4000-8000-000000000012', current_date)
   where module = 'coaching' and requirement_index = 1),
  'coaching_session', 'the calendar names the completion source');
select is(
  (select array_agg(array[required_units, completed_units, due_units, overdue_units] order by module)
   from public.canonical_module_progress('e9900000-0000-4000-8000-000000000012', current_date)),
  (select array_agg(t order by module) from (
     select c.module, array[count(*)::int, count(*) filter (where c.is_completed)::int,
            count(*) filter (where c.is_due_as_of)::int, count(*) filter (where c.is_overdue)::int] as t
     from public.canonical_enrollment_requirement_calendar('e9900000-0000-4000-8000-000000000012', current_date) c
     group by c.module) x),
  'module progress is the per-module aggregate of the calendar');

-- ---------------------------------------------------------------------------
-- 4. Checkpoints derive from the calendar (L)
-- ---------------------------------------------------------------------------
select is(
  (select count(*)::int from jsonb_array_elements(public.canonical_enrollment_journey('e9900000-0000-4000-8000-000000000011', current_date)) cp
   where (cp->>'required_units')::int <> (
     select count(*) from public.canonical_enrollment_requirement_calendar('e9900000-0000-4000-8000-000000000011', current_date) c
     where c.due_on <= (cp->>'due_on')::date)),
  0, 'every checkpoint total = calendar requirements due on or before that date');
select is(
  (select array_agg((cp->>'required_units')::int order by (cp->>'due_on')::date)
   from jsonb_array_elements(public.canonical_enrollment_journey('e9900000-0000-4000-8000-000000000011', current_date)) cp),
  array[1, 2, 3, 4, 8, 9, 10, 12, 13, 14, 16, 18],
  'cumulative checkpoints: weeks 1-4, Coaching x4 on its deadline, week 5, week 6, Mentoring x2, weeks 7-8, Peer x2, Triads x2');
select is(
  (select (cp->>'completed_units')::int from jsonb_array_elements(public.canonical_enrollment_journey('e9900000-0000-4000-8000-000000000012', current_date)) cp
   where (cp->>'due_on')::date = current_date - 5),
  2, 'partial leader: 2 of the 8 requirements due by the Coaching deadline are fulfilled');

-- ---------------------------------------------------------------------------
-- 5. Per-requirement dates (S2, S14)
-- ---------------------------------------------------------------------------
select public.admin_set_cohort_requirement_dates('d9900000-0000-4000-8000-000000000001', jsonb_build_array(
  jsonb_build_object('requirement_id', (select id from public.cohort_requirement_dates
    where cohort_id = 'd9900000-0000-4000-8000-000000000001' and module = 'coaching' and ordinal = 4),
    'due_on', (current_date + 30)::text)));

select is(
  (select array_agg(due_on order by ordinal) from public.cohort_requirement_dates
   where cohort_id = 'd9900000-0000-4000-8000-000000000001' and module = 'coaching'),
  array[current_date - 5, current_date - 5, current_date - 5, current_date + 30],
  'Coaching Session 4 has its own date; sessions 1-3 keep the module default');
select is(
  (select array[count(*)::int, count(*) filter (where is_due_as_of)::int, count(*) filter (where is_overdue)::int]
   from public.canonical_enrollment_requirement_calendar('e9900000-0000-4000-8000-000000000011', current_date)),
  array[18, 8, 8], 'moving one requirement changes due and overdue, never required');
select ok(
  exists (select 1 from jsonb_array_elements(public.canonical_enrollment_journey('e9900000-0000-4000-8000-000000000011', current_date)) cp
          where (cp->>'due_on')::date = current_date + 30 and cp->'module_scope' ? 'coaching'),
  'the moved requirement opens its own checkpoint');
select is(
  (select array[count(*)::int, count(*) filter (where is_due_as_of)::int, count(*) filter (where is_overdue)::int]
   from public.sponsor_leader_requirement_calendar('e9900000-0000-4000-8000-000000000011', current_date)),
  array[0, 0, 0], 'an admin (not a sponsor) gets nothing from the sponsor wrapper');

-- Moving the module default moves only the requirements that follow it.
select public.admin_set_cohort_module_deadlines('d9900000-0000-4000-8000-000000000001', jsonb_build_array(
  jsonb_build_object('programme_id', 'c9900000-0000-4000-8000-000000000001', 'module', 'coaching', 'completion_deadline', (current_date - 3)::text)));
select is(
  (select array_agg(due_on order by ordinal) from public.cohort_requirement_dates
   where cohort_id = 'd9900000-0000-4000-8000-000000000001' and module = 'coaching'),
  array[current_date - 3, current_date - 3, current_date - 3, current_date + 30],
  'a new module default moves the non-overridden requirements and leaves the Admin date alone');
select is(
  (select is_overridden from public.cohort_requirement_dates
   where cohort_id = 'd9900000-0000-4000-8000-000000000001' and module = 'coaching' and ordinal = 4),
  true, 'the Admin-dated requirement is marked overridden');

-- Week 4 moved into the future: the Training due count drops by one.
select public.admin_set_cohort_requirement_dates('d9900000-0000-4000-8000-000000000001', jsonb_build_array(
  jsonb_build_object('requirement_id', (select d.id from public.cohort_requirement_dates d join public.training_weeks tw on tw.id = d.training_week_id
    where d.cohort_id = 'd9900000-0000-4000-8000-000000000001' and tw.week_number = 4),
    'due_on', (current_date + 3)::text)));
select is(
  (select array[required_units, due_units, overdue_units] from public.canonical_module_progress('e9900000-0000-4000-8000-000000000011', current_date)
   where module = 'training'),
  array[8, 4, 4], 'Week 4 in the future: Training required 8, due 4, overdue 4');
select ok(
  exists (select 1 from jsonb_array_elements(public.canonical_enrollment_journey('e9900000-0000-4000-8000-000000000011', current_date)) cp
          where (cp->>'due_on')::date = current_date + 3 and cp->>'label' = 'Calendar week 4'),
  'the Week 4 date is a checkpoint labelled with the week');
select is(
  (select min(d) from (select (x->>'due_on')::date as d
     from jsonb_array_elements(public.canonical_learning_breakdown('e9900000-0000-4000-8000-000000000011', current_date)) x) y),
  null::date, 'the breakdown exposes counts only (no per-item dates)');

-- A cohort week override no longer moves an Admin-dated week, but still moves a default one.
insert into public.cohort_week_overrides (cohort_id, training_week_id, unlock_date, is_visible) values
  ('d9900000-0000-4000-8000-000000000001', '79900000-0000-4000-8000-000000000004', current_date - 1, true),
  ('d9900000-0000-4000-8000-000000000001', '79900000-0000-4000-8000-000000000005', current_date + 1, true);
select is(
  (select array_agg(d.due_on order by tw.week_number) from public.cohort_requirement_dates d join public.training_weeks tw on tw.id = d.training_week_id
   where d.cohort_id = 'd9900000-0000-4000-8000-000000000001' and tw.week_number in (4, 5)),
  array[current_date + 3, current_date + 1],
  'a week override moves only the week that follows its default');

-- Reset returns a requirement to its default.
select public.admin_set_cohort_requirement_dates('d9900000-0000-4000-8000-000000000001', jsonb_build_array(
  jsonb_build_object('requirement_id', (select id from public.cohort_requirement_dates
    where cohort_id = 'd9900000-0000-4000-8000-000000000001' and module = 'coaching' and ordinal = 4), 'due_on', null)));
select is(
  (select array[due_on::text, is_overridden::text] from public.cohort_requirement_dates
   where cohort_id = 'd9900000-0000-4000-8000-000000000001' and module = 'coaching' and ordinal = 4),
  array[(current_date - 3)::text, 'false'], 'a reset requirement follows the module default again');

select throws_ok(
  format($$select public.admin_set_cohort_requirement_dates('d9900000-0000-4000-8000-000000000001',
    jsonb_build_array(jsonb_build_object('requirement_id', '%s', 'due_on', '%s')))$$,
    (select id from public.cohort_requirement_dates where cohort_id = 'd9900000-0000-4000-8000-000000000001' and module = 'mentoring' and ordinal = 1),
    current_date + 400),
  '22023', null, 'a requirement date outside the cohort window is refused');
select is(
  (select count(*)::int from public.admin_cohort_requirement_schedule('d9900000-0000-4000-8000-000000000001')),
  18, 'the Admin schedule lists all 18 requirements');
select is(
  (select array[requirement_label, default_due_on::text] from public.admin_cohort_requirement_schedule('d9900000-0000-4000-8000-000000000001')
   where module = 'training' and requirement_index = 1),
  array['Week 1: Calendar week 1', (current_date - 30)::text], 'the Admin schedule shows each week''s label and default date');

-- ---------------------------------------------------------------------------
-- 6. Training / Learning child breakdown (S15, S16, S17)
-- ---------------------------------------------------------------------------
select is(
  (select jsonb_object_agg(x->>'key', (x->>'required_units')::int)
   from jsonb_array_elements(public.canonical_learning_breakdown('e9900000-0000-4000-8000-000000000012', current_date)) x),
  '{"skill_cards": 8, "quizzes": 8, "reflections": 8, "daily_prompts": 2}'::jsonb,
  'breakdown: every configured child type, hidden and unselected items excluded');
select is(
  (select jsonb_object_agg(x->>'key', (x->>'completed_units')::int)
   from jsonb_array_elements(public.canonical_learning_breakdown('e9900000-0000-4000-8000-000000000012', current_date)) x),
  '{"skill_cards": 1, "quizzes": 1, "reflections": 1, "daily_prompts": 1}'::jsonb,
  'breakdown completion counts evidence per child type');
select is(
  (select training_required_units from public.canonical_enrollment_progress('e9900000-0000-4000-8000-000000000012', current_date)),
  8, 'child evidence never inflates Training beyond its 8 weeks');

update public.programme_modules
set config = jsonb_set(config, '{learning_components}', '["skill_cards","quizzes","reflections"]')
where programme_id = 'c9900000-0000-4000-8000-000000000001' and module = 'training';
select is(
  (select (x->>'required_units')::int from jsonb_array_elements(public.canonical_learning_breakdown('e9900000-0000-4000-8000-000000000012', current_date)) x
   where x->>'key' = 'daily_prompts'),
  0, 'a child type not selected in learning_components is excluded');

update public.training_weeks set is_visible = false where id = '79900000-0000-4000-8000-000000000008';
select is(
  (select array[training_required_units, required_units] from public.canonical_enrollment_progress('e9900000-0000-4000-8000-000000000012', current_date)),
  array[7, 17], 'a hidden week is not a requirement');
select is(
  (select (x->>'required_units')::int from jsonb_array_elements(public.canonical_learning_breakdown('e9900000-0000-4000-8000-000000000012', current_date)) x
   where x->>'key' = 'quizzes'),
  7, 'a hidden week''s children are excluded');
update public.training_weeks set is_visible = true where id = '79900000-0000-4000-8000-000000000008';

-- ---------------------------------------------------------------------------
-- 7. Integrity report
-- ---------------------------------------------------------------------------
update public.programme_modules set config = jsonb_set(config, '{required_units}', '9')
where programme_id = 'c9900000-0000-4000-8000-000000000001' and module = 'training';
select ok(
  exists (select 1 from public.admin_requirement_integrity_issues()
          where issue = 'training_units_mismatch' and programme_id = 'c9900000-0000-4000-8000-000000000001'),
  'Training required_units different from the selected weeks is reported');
update public.programme_modules set config = jsonb_set(config, '{required_units}', '8')
where programme_id = 'c9900000-0000-4000-8000-000000000001' and module = 'training';
insert into public.programme_enrollments (id, programme_id, user_id, cohort_id, organization_id, status, start_date)
values ('e9900000-0000-4000-8000-000000000099', 'c9900000-0000-4000-8000-000000000001',
  'a9900000-0000-4000-8000-000000000004', 'd9900000-0000-4000-8000-000000000001', null, 'active', current_date);
select ok(
  exists (select 1 from public.admin_requirement_integrity_issues()
          where issue = 'enrollment_without_organization' and enrollment_id = 'e9900000-0000-4000-8000-000000000099'),
  'an ongoing enrollment with no organisation is reported (invisible to every sponsor)');
delete from public.programme_enrollments where id = 'e9900000-0000-4000-8000-000000000099';

-- ---------------------------------------------------------------------------
-- 8. Organisation attribution is enrollment-scoped (S9, S10, S11)
-- ---------------------------------------------------------------------------
select is(
  (select array_agg(distinct organization_id order by organization_id) from public.programme_enrollments
   where cohort_id = 'd9900000-0000-4000-8000-000000000001'),
  array['b9900000-0000-4000-8000-00000000000a', 'b9900000-0000-4000-8000-00000000000b']::uuid[],
  'two organisations share the same cohort');
select is(
  (select count(*)::int from public.admin_organization_enrollments('b9900000-0000-4000-8000-00000000000a', current_date)),
  3, 'admin: organisation A lists its three enrollments');
select is(
  (select count(*)::int from public.admin_organization_enrollments('b9900000-0000-4000-8000-00000000000b', current_date)),
  2, 'admin: organisation B lists its two enrollments');
select is(
  (select array[ongoing_enrollments, ongoing_leaders] from public.admin_organization_leader_summary()
   where organization_id = 'b9900000-0000-4000-8000-00000000000a'),
  (select array[count(*)::int, count(distinct user_id)::int] from public.programme_enrollments
   where organization_id = 'b9900000-0000-4000-8000-00000000000a' and status in ('active', 'at_risk', 'paused')),
  'organisation leader count equals its canonical ongoing enrollments');
select is(
  (select array[required_units, completed_units, due_units, overdue_units] from public.admin_organization_enrollments('b9900000-0000-4000-8000-00000000000a', current_date)
   where enrollment_id = 'e9900000-0000-4000-8000-000000000012'),
  (select array[required_units, completed_units, due_units, overdue_units] from public.canonical_enrollment_progress('e9900000-0000-4000-8000-000000000012', current_date)),
  'the organisation list shows canonical progress');

-- ---------------------------------------------------------------------------
-- 9. Admin == Learner == Sponsor for the same enrollment and as-of (S3, M)
-- ---------------------------------------------------------------------------
create temp table role_calendar (role text, required int, completed int, due int, overdue int, org uuid) on commit drop;
insert into role_calendar
select 'admin', count(*), count(*) filter (where is_completed), count(*) filter (where is_due_as_of),
  count(*) filter (where is_overdue), min(organization_id::text)::uuid
from public.admin_enrollment_requirement_calendar('e9900000-0000-4000-8000-000000000012', current_date);
create temp table role_progress on commit drop as
select 'admin'::text as role, required_units, completed_units, due_units, overdue_units
from public.admin_canonical_enrollment_progress(array['e9900000-0000-4000-8000-000000000012'::uuid]);

select set_config('request.jwt.claim.sub', 'a9900000-0000-4000-8000-000000000012', true);
insert into role_calendar
select 'learner', count(*), count(*) filter (where is_completed), count(*) filter (where is_due_as_of),
  count(*) filter (where is_overdue), min(organization_id::text)::uuid
from public.learner_requirement_calendar('e9900000-0000-4000-8000-000000000012', current_date);
insert into role_progress
select 'learner', required_units, completed_units, due_units, overdue_units
from public.learner_canonical_progress('e9900000-0000-4000-8000-000000000012', current_date);

select set_config('request.jwt.claim.sub', 'a9900000-0000-4000-8000-000000000002', true);
insert into role_calendar
select 'sponsor', count(*), count(*) filter (where is_completed), count(*) filter (where is_due_as_of),
  count(*) filter (where is_overdue), min(organization_id::text)::uuid
from public.sponsor_leader_requirement_calendar('e9900000-0000-4000-8000-000000000012', current_date);
insert into role_progress
select 'sponsor', required_units, completed_units, due_units, overdue_units
from public.sponsor_canonical_enrollment_metadata(null, 'e9900000-0000-4000-8000-000000000012', current_date);

select is((select count(distinct (required, completed, due, overdue, org))::int from role_calendar), 1,
  'admin, learner and sponsor calendars agree on required / completed / due / overdue and organisation');
select is((select count(*)::int from role_calendar where required = 18), 3, 'all three roles see 18 requirements');
select is((select count(distinct (required_units, completed_units, due_units, overdue_units))::int from role_progress), 1,
  'admin, learner and sponsor canonical progress rows agree');
select is(
  (select array[required_units, completed_units, due_units, overdue_units] from role_progress where role = 'sponsor'),
  (select array[required, completed, due, overdue] from role_calendar where role = 'sponsor'),
  'sponsor header numbers equal the sponsor calendar');
select is(
  (select array_agg((cp->>'required_units')::int || '/' || (cp->>'completed_units')::int order by cp->>'due_on')
   from jsonb_array_elements(public.sponsor_canonical_leader_journey('e9900000-0000-4000-8000-000000000012', current_date)) cp),
  (select array_agg((cp->>'required_units')::int || '/' || (cp->>'completed_units')::int order by cp->>'due_on')
   from jsonb_array_elements(public.canonical_enrollment_journey('e9900000-0000-4000-8000-000000000012', current_date)) cp),
  'sponsor checkpoints equal the canonical journey');

-- ---------------------------------------------------------------------------
-- 10. Sponsor isolation (S7, S8) and privacy (S17)
-- ---------------------------------------------------------------------------
select is(
  (select array_agg(enrollment_id order by enrollment_id) from public.sponsor_canonical_enrollment_progress('d9900000-0000-4000-8000-000000000001', current_date)),
  array['e9900000-0000-4000-8000-000000000011', 'e9900000-0000-4000-8000-000000000012', 'e9900000-0000-4000-8000-000000000013']::uuid[],
  'sponsor A sees only organisation A''s leaders in the shared cohort');
select is(
  (select count(*)::int from public.sponsor_leader_requirement_calendar('e9900000-0000-4000-8000-000000000014', current_date)),
  0, 'sponsor A cannot read an organisation B leader''s calendar');
select is(public.sponsor_canonical_leader_journey('e9900000-0000-4000-8000-000000000014', current_date), '[]'::jsonb,
  'sponsor A cannot read an organisation B leader''s checkpoints');
select ok(
  position('PRIVATE-' in coalesce(public.sponsor_canonical_leader_experience('e9900000-0000-4000-8000-000000000012', current_date)::text, '')) = 0
  and position('PRIVATE-' in (select coalesce(jsonb_agg(to_jsonb(c))::text, '') from public.sponsor_leader_requirement_calendar('e9900000-0000-4000-8000-000000000012', current_date) c)) = 0
  and position('PRIVATE-' in (select coalesce(jsonb_agg(to_jsonb(m))::text, '') from public.sponsor_canonical_enrollment_metadata(null, 'e9900000-0000-4000-8000-000000000012', current_date) m)) = 0,
  'no sponsor RPC returns learner quiz notes or prompt answers');
select is(
  (select array[goal_count::numeric, goal_progress_pct] from public.sponsor_canonical_enrollment_metadata(null, 'e9900000-0000-4000-8000-000000000012', current_date)),
  array[1::numeric, (select progress_pct from public.canonical_goal_progress('e9900000-0000-4000-8000-000000000012'))],
  'sponsor goal aggregate is derived from the enrollment''s real goal');
select is(
  (select goal_count::int from public.sponsor_canonical_enrollment_metadata(null, 'e9900000-0000-4000-8000-000000000011', current_date)),
  0, '"No goal set" only where the enrollment truly has no goal');

select set_config('request.jwt.claim.sub', 'a9900000-0000-4000-8000-000000000003', true);
select is(
  (select array_agg(enrollment_id order by enrollment_id) from public.sponsor_canonical_enrollment_progress('d9900000-0000-4000-8000-000000000001', current_date)),
  array['e9900000-0000-4000-8000-000000000014', 'e9900000-0000-4000-8000-000000000015']::uuid[],
  'sponsor B sees only organisation B''s leaders in the shared cohort');
select is(
  (select count(*)::int from public.sponsor_leader_requirement_calendar('e9900000-0000-4000-8000-000000000012', current_date)),
  0, 'sponsor B cannot read an organisation A leader''s calendar');
select throws_ok(
  $$select public.admin_set_cohort_requirement_dates('d9900000-0000-4000-8000-000000000001', '[]'::jsonb)$$,
  '42501', null, 'a sponsor cannot edit requirement dates');

-- ---------------------------------------------------------------------------
-- 11. Goal-setting period and enrollment uniqueness (S18, S20)
-- ---------------------------------------------------------------------------
select is(
  (public.enrollment_goal_gate_state('e9900000-0000-4000-8000-000000000011')->>'goal_setup_deadline')::date,
  current_date - 23, 'goal-setting deadline defaults to cohort start + 7');
update public.cohorts set goal_setting_opens_on = current_date - 35, goal_setting_due_on = current_date - 10
where id = 'd9900000-0000-4000-8000-000000000001';
select is(
  array[(public.enrollment_goal_gate_state('e9900000-0000-4000-8000-000000000011')->>'goal_setting_opens_on')::date,
        (public.enrollment_goal_gate_state('e9900000-0000-4000-8000-000000000011')->>'goal_setup_deadline')::date],
  array[current_date - 35, current_date - 10], 'the cohort''s goal-setting period is the configured one');
select is((public.enrollment_goal_gate_state('e9900000-0000-4000-8000-000000000012')->>'goal_setup_overdue')::boolean, false,
  'a learner with an active goal is not overdue on goal setting');
select is(
  (select count(*)::int from (select user_id from public.programme_enrollments
     where status in ('active', 'at_risk', 'paused') group by user_id having count(*) > 1) x),
  0, 'no learner holds two ongoing enrollments');

select * from finish();
rollback;
