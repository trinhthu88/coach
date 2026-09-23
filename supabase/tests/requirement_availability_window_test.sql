-- Requirement availability, programme-end freeze and the current-fulfilment
-- journey (20260930100000_journey_current_fulfilment).
--
--   Training           counts only when Skill Card + Quiz + Reflection are all
--                      dated within [week available_on, effective as-of];
--                      Daily Prompts never gate a week.
--   Coaching (etc.)    counts only when completed within
--                      [due_on - 14, effective as-of].
--   Programme end      effective as-of = least(as_of, programme end).
--   Journey            the same counted rows as module progress; the final
--                      checkpoint equals the canonical totals.
--
-- Fixture (as of current_date = T):
--   programme: Coaching 3 + Training 4 selected weeks (quiz + reflection per
--              week, a daily prompt in weeks 1 and 4)
--   cohort 1:  start T-14, end T+100 -> weeks available/due T-14, T-7, T, T+7;
--              Coaching 1..3 each dated T-1 (window opens T-15)
--     learner A: week 1 done inside its window, NO daily prompt answer;
--                week 2 evidence dated T-9 (before it opened at T-7);
--                week 4 evidence dated T-3 (week opens T+7)        <- seeded early
--     learner B: week 4 evidence dated T+7 (the day it opens)
--     learner C: Coaching 1 at deadline-15, 2 at deadline-14, 3 at deadline-5
--   cohort 2:  start T-120, end T-10 (finished); Coaching 1..3 each dated T-12
--     learner D: Coaching 1 at T-13 (inside window, before end),
--                Coaching 2 at T-5 (after the programme end)
begin;
select plan(43);

-- ---------------------------------------------------------------------------
-- Fixture
-- ---------------------------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_user_meta_data, created_at, updated_at, confirmation_token, email_change_token_new, recovery_token)
select ('f7700000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid,
  '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated',
  'avail-' || n || '@example.test', 'test', now(),
  jsonb_build_object('full_name', 'Window User ' || lpad(n::text, 2, '0')), now(), now(), '', '', ''
from unnest(array[1, 2, 4, 11, 12, 13, 21]) n;

insert into public.profiles (id, full_name, email, status)
select id, raw_user_meta_data->>'full_name', email, 'active'
from auth.users where email like 'avail-%'
on conflict (id) do update set full_name = excluded.full_name, status = 'active';

insert into public.organizations (id, name)
values ('f7710000-0000-4000-8000-00000000000a', 'Window Org');

insert into public.user_roles (user_id, role) values
  ('f7700000-0000-4000-8000-000000000001', 'admin'),
  ('f7700000-0000-4000-8000-000000000002', 'sponsor'),
  ('f7700000-0000-4000-8000-000000000004', 'coach')
on conflict do nothing;
insert into public.sponsor_profiles (user_id, organization_id)
values ('f7700000-0000-4000-8000-000000000002', 'f7710000-0000-4000-8000-00000000000a');

insert into public.programmes (id, name, duration_months)
values ('f7720000-0000-4000-8000-000000000001', 'Window Programme', 6);

insert into public.training_weeks (id, programme_id, week_number, title, is_visible, skill_card_visible)
select ('f7730000-0000-4000-8000-0000000000' || lpad(w::text, 2, '0'))::uuid,
  'f7720000-0000-4000-8000-000000000001', w, 'Window week ' || w, true, true
from generate_series(1, 4) w;

insert into public.assignments (training_week_id, title, assignment_type, is_visible)
select ('f7730000-0000-4000-8000-0000000000' || lpad(w::text, 2, '0'))::uuid, 'Quiz ' || w, 'quiz', true
from generate_series(1, 4) w;
insert into public.programme_reflections (id, programme_id, reflection_number, title, appears_at_week, is_visible)
select ('f7740000-0000-4000-8000-0000000000' || lpad(w::text, 2, '0'))::uuid,
  'f7720000-0000-4000-8000-000000000001', w, 'Reflection ' || w, w, true
from generate_series(1, 4) w;
insert into public.daily_prompts (training_week_id, day_offset, prompt_text, is_visible) values
  ('f7730000-0000-4000-8000-000000000001', 1, 'Prompt week 1', true),
  ('f7730000-0000-4000-8000-000000000004', 1, 'Prompt week 4', true);

insert into public.programme_modules (programme_id, module, enabled, config) values
  ('f7720000-0000-4000-8000-000000000001', 'coaching', true, '{"required": true, "required_units": 3}'),
  ('f7720000-0000-4000-8000-000000000001', 'training', true,
   jsonb_build_object('required', true, 'required_units', 4,
     'learning_components', jsonb_build_array('skill_cards', 'quizzes', 'reflections', 'daily_prompts'),
     'distribution_settings', jsonb_build_object('training_week_ids',
       (select jsonb_agg(('f7730000-0000-4000-8000-0000000000' || lpad(w::text, 2, '0'))) from generate_series(1, 4) w))));

insert into public.cohorts (id, name, programme_id, organization_id, start_date, end_date) values
  ('f7750000-0000-4000-8000-000000000001', 'Window Cohort 1', 'f7720000-0000-4000-8000-000000000001',
   'f7710000-0000-4000-8000-00000000000a', current_date - 14, current_date + 100),
  ('f7750000-0000-4000-8000-000000000002', 'Window Cohort 2 (finished)', 'f7720000-0000-4000-8000-000000000001',
   'f7710000-0000-4000-8000-00000000000a', current_date - 120, current_date - 10);

select set_config('request.jwt.claim.sub', 'f7700000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
-- Each Coaching requirement is dated explicitly by the Admin (its own
-- cohort_requirement_dates.due_on); the module deadline plays no part.
select public.admin_set_cohort_requirement_dates(c.cohort_id, (
  select jsonb_agg(jsonb_build_object('requirement_id', d.id, 'due_on', c.due_on::text))
  from public.cohort_requirement_dates d
  where d.cohort_id = c.cohort_id and d.module = 'coaching'::public.programme_module_type))
from (values ('f7750000-0000-4000-8000-000000000001'::uuid, current_date - 1),
             ('f7750000-0000-4000-8000-000000000002'::uuid, current_date - 12)) c(cohort_id, due_on);

insert into public.programme_enrollments (id, programme_id, user_id, cohort_id, organization_id, status, start_date)
select ('f7760000-0000-4000-8000-0000000000' || n)::uuid, 'f7720000-0000-4000-8000-000000000001',
  ('f7700000-0000-4000-8000-0000000000' || n)::uuid,
  case when n = 21 then 'f7750000-0000-4000-8000-000000000002' else 'f7750000-0000-4000-8000-000000000001' end::uuid,
  'f7710000-0000-4000-8000-00000000000a', 'active',
  case when n = 21 then current_date - 120 else current_date - 14 end
from unnest(array[11, 12, 13, 21]) n;

-- Training evidence: Skill Card, every visible quiz and the week's reflection
-- for (learner, week) on one day.
create temp table evidence (learner int, week int, on_day date) on commit drop;
insert into evidence values
  (11, 1, current_date - 10),  -- inside week 1's window
  (11, 2, current_date - 9),   -- week 2 opens at T-7: seeded before availability
  (11, 4, current_date - 3),   -- week 4 opens at T+7: seeded before availability
  (12, 4, current_date + 7);   -- on the day week 4 opens

insert into public.training_progress (user_id, enrollment_id, training_week_id, viewed_at, completed_at)
select ('f7700000-0000-4000-8000-0000000000' || e.learner)::uuid, ('f7760000-0000-4000-8000-0000000000' || e.learner)::uuid,
  ('f7730000-0000-4000-8000-0000000000' || lpad(e.week::text, 2, '0'))::uuid,
  e.on_day + time '09:00', e.on_day + time '10:00'
from evidence e;
insert into public.assignment_submissions (assignment_id, user_id, enrollment_id, answers, submitted_at)
select a.id, ('f7700000-0000-4000-8000-0000000000' || e.learner)::uuid, ('f7760000-0000-4000-8000-0000000000' || e.learner)::uuid,
  '{}'::jsonb, e.on_day + time '11:00'
from evidence e
join public.assignments a on a.training_week_id = ('f7730000-0000-4000-8000-0000000000' || lpad(e.week::text, 2, '0'))::uuid;
insert into public.reflection_submissions (reflection_id, user_id, enrollment_id, confidence_score, submitted_at)
select ('f7740000-0000-4000-8000-0000000000' || lpad(e.week::text, 2, '0'))::uuid,
  ('f7700000-0000-4000-8000-0000000000' || e.learner)::uuid, ('f7760000-0000-4000-8000-0000000000' || e.learner)::uuid,
  7, e.on_day + time '12:00'
from evidence e;

-- Coaching sessions (UTC noon, so the fulfilment date is exactly the day).
select set_config('app.session_transition', 'on', true);
insert into public.sessions (id, enrollment_id, cohort_requirement_id, coach_id, coachee_id, topic, start_time, duration_minutes, status)
select ('f7780000-0000-4000-8000-' || lpad((s.learner * 10 + s.ordinal)::text, 12, '0'))::uuid,
  ('f7760000-0000-4000-8000-0000000000' || s.learner)::uuid, d.id,
  'f7700000-0000-4000-8000-000000000004', ('f7700000-0000-4000-8000-0000000000' || s.learner)::uuid,
  'Coaching ' || s.ordinal, (s.on_day + time '12:00') at time zone 'UTC', 60, 'completed'
from (values
  (13, 1, current_date - 1 - 15),  -- deadline - 15
  (13, 2, current_date - 1 - 14),  -- deadline - 14
  (13, 3, current_date - 1 - 5),   -- deadline - 5
  (21, 1, current_date - 13),      -- inside window, before the programme end (T-10)
  (21, 2, current_date - 5)        -- after the programme end
) s(learner, ordinal, on_day)
join public.cohort_requirement_dates d
  on d.module = 'coaching' and d.ordinal = s.ordinal
 and d.cohort_id = case when s.learner = 21 then 'f7750000-0000-4000-8000-000000000002' else 'f7750000-0000-4000-8000-000000000001' end::uuid;
select set_config('app.session_transition', 'off', true);

create temp table ids on commit drop as select
  'f7760000-0000-4000-8000-000000000011'::uuid as a, 'f7760000-0000-4000-8000-000000000012'::uuid as b,
  'f7760000-0000-4000-8000-000000000013'::uuid as c, 'f7760000-0000-4000-8000-000000000021'::uuid as d,
  'f7750000-0000-4000-8000-000000000001'::uuid as cohort1;

create temp view week_status as
select e.id as enrollment_id, f.week_number, f.week_complete, f.daily_prompts_required, f.daily_prompts_completed
from public.programme_enrollments e
cross join lateral public.canonical_training_week_fulfilment(e.id, current_date) f
where e.programme_id = 'f7720000-0000-4000-8000-000000000001';

create temp view coaching_rows as
select c.enrollment_id, c.requirement_index, c.is_completed, c.completed_on
from public.programme_enrollments e
cross join lateral public.canonical_enrollment_requirement_calendar(e.id, current_date) c
where e.programme_id = 'f7720000-0000-4000-8000-000000000001' and c.module = 'coaching';

-- ---------------------------------------------------------------------------
-- 1. A future / unavailable Training week with evidence rows -> 0 completed
-- ---------------------------------------------------------------------------
select is((select week_complete from week_status, ids where enrollment_id = ids.a and week_number = 4), false,
  '1. week 4 is not available yet: its seeded Skill Card, Quiz and Reflection complete nothing');
select is((select f.week_complete from ids, public.canonical_training_week_fulfilment(ids.a, current_date + 30) f where f.week_number = 4), false,
  '1. ... and never later either: evidence dated before availability does not count once the week opens');
select is((select week_complete from week_status, ids where enrollment_id = ids.a and week_number = 2), false,
  '1. an open week whose evidence predates its availability is not complete');
select is((select completed_units from ids, public.canonical_module_progress(ids.a, current_date) m where m.module = 'training'), 1,
  '1. learner A: Training counts only week 1');

-- ---------------------------------------------------------------------------
-- 2. The same week reaches available_on with all three mandatory items -> 1
-- ---------------------------------------------------------------------------
select is((select week_complete from week_status, ids where enrollment_id = ids.b and week_number = 4), false,
  '2. learner B: before week 4 opens it counts 0');
select is((select f.week_complete from ids, public.canonical_training_week_fulfilment(ids.b, current_date + 8) f where f.week_number = 4), true,
  '2. learner B: once week 4 is open, Skill Card + Quiz + Reflection dated in its window complete it');
select is((select c.completed_on from ids, public.canonical_enrollment_requirement_calendar(ids.b, current_date + 8) c
    where c.module = 'training' and c.requirement_index = 4), current_date + 7,
  '2. its completion date is the evidence date, not earlier than availability');

-- ---------------------------------------------------------------------------
-- 3. Daily Prompts are tracked but never gate a week
-- ---------------------------------------------------------------------------
select is((select week_complete from week_status, ids where enrollment_id = ids.a and week_number = 1), true,
  '3. week 1 is complete without its Daily Prompt');
select is((select daily_prompts_required::text || '/' || daily_prompts_completed::text from week_status, ids
    where enrollment_id = ids.a and week_number = 1), '1/0',
  '3. ... and the unanswered prompt is still tracked');

-- ---------------------------------------------------------------------------
-- 4-6. Session requirements: eligible from due_on - 14
-- ---------------------------------------------------------------------------
select is((select is_completed from coaching_rows, ids where enrollment_id = ids.c and requirement_index = 1), false,
  '4. a session 15 days before the deadline does not fulfil');
select is((select is_completed from coaching_rows, ids where enrollment_id = ids.c and requirement_index = 2), true,
  '5. a session exactly 14 days before the deadline fulfils');
select is((select is_completed from coaching_rows, ids where enrollment_id = ids.c and requirement_index = 3), true,
  '6. a session 5 days before the deadline fulfils');
select is((select s.state from ids, public.canonical_enrollment_requirement_status(ids.c, current_date) s
    where s.module = 'coaching' and s.requirement_index = 1), 'overdue',
  '4. the too-early requirement is open, and overdue once its deadline has passed');
select is((select s.available_on from ids, public.canonical_enrollment_requirement_status(ids.c, current_date) s
    where s.module = 'coaching' and s.requirement_index = 1), current_date - 15,
  '4-6. a session requirement is available 14 days before its due date');

-- ---------------------------------------------------------------------------
-- 7. Programme end freeze
-- ---------------------------------------------------------------------------
select is((select public.canonical_enrollment_effective_as_of(ids.d, current_date) from ids), current_date - 10,
  '7. a finished programme is evaluated at its end date');
select is((select is_completed from coaching_rows, ids where enrollment_id = ids.d and requirement_index = 1), true,
  '7. a session inside the window and before the end counts');
select is((select is_completed from coaching_rows, ids where enrollment_id = ids.d and requirement_index = 2), false,
  '7. a session after the programme end is historical only');
select is((select coaching_completed_units from ids, public.canonical_enrollment_progress(ids.d, current_date)), 1,
  '7. ... and does not improve the frozen programme completion');
select is((select count(*)::int from public.sessions s, ids where s.enrollment_id = ids.d and s.status = 'completed'), 2,
  '7. the after-end session itself is untouched (still a completed session)');

-- ---------------------------------------------------------------------------
-- 8. Future Training weeks are excluded (the Linh shape)
-- ---------------------------------------------------------------------------
select is((select s.state || ':' || coalesce(s.completed_on::text, '-') from ids, public.canonical_enrollment_requirement_status(ids.a, current_date) s
    where s.module = 'training' and s.requirement_index = 4), 'upcoming:-',
  '8. an unavailable week with evidence is upcoming and uncounted');
select is((select training_completed_units::text || '/' || training_required_units::text from ids, public.canonical_enrollment_progress(ids.a, current_date)), '1/4',
  '8. learner A Training = 1/4 (weeks 2 and 4 excluded)');

-- ---------------------------------------------------------------------------
-- Sponsor projections (visibility = enrollment organisation)
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', 'f7700000-0000-4000-8000-000000000002', true);

create temp table cohort_journey on commit drop as
select (x->>'checkpoint_number')::int as n, (x->>'due_on')::date as due_on,
  (x->>'required_units')::int as required_units, (x->>'completed_units')::int as completed_units, x->>'state' as state
from ids, jsonb_array_elements(public.get_sponsor_programme_journey(ids.cohort1, current_date)) x;

create temp table cohort_totals on commit drop as
select * from ids, public.sponsor_canonical_cohort_progress(ids.cohort1, current_date);

create temp table leader_rows on commit drop as
select p.* from ids, public.sponsor_canonical_enrollment_progress(ids.cohort1, current_date) p;

-- ---------------------------------------------------------------------------
-- 9. The screenshot case: an unavailable Training checkpoint raises the
--    denominator only
-- ---------------------------------------------------------------------------
select is((select required_units from cohort_journey where due_on = current_date + 7)
          - (select required_units from cohort_journey where due_on = current_date), 3,
  '9. the week-4 checkpoint adds one unit per leader to the denominator');
select is((select completed_units from cohort_journey where due_on = current_date + 7),
          (select completed_units from cohort_journey where due_on = current_date),
  '9. ... and nothing to the numerator, although learner A has week-4 evidence rows');
select is((select state from cohort_journey where due_on = current_date + 7), 'upcoming',
  '9. the week-4 checkpoint is upcoming');
select is((select completed_units from cohort_journey where due_on = current_date - 14), 1,
  '9. week 1 counts once (learner A)');

-- ---------------------------------------------------------------------------
-- 10. Cohort totals are sums of the same canonical leader rows
-- ---------------------------------------------------------------------------
select is((select count(*)::int from leader_rows), 3, '10. the sponsor sees the three cohort-1 leaders');
select is((select required_units from cohort_totals), (select sum(required_units)::int from leader_rows),
  '10. cohort required = sum of leader required');
select is((select completed_units from cohort_totals), (select sum(completed_units)::int from leader_rows),
  '10. cohort completed = sum of leader completed');
select is((select coaching_completed_units from cohort_totals), (select sum(coaching_completed_units)::int from leader_rows),
  '10. cohort Coaching completed = sum of leader Coaching completed');
select is((select training_completed_units from cohort_totals), (select sum(training_completed_units)::int from leader_rows),
  '10. cohort Training completed = sum of leader Training completed');
select is((select training_required_units from cohort_totals), (select sum(training_required_units)::int from leader_rows),
  '10. cohort Training required = sum of leader Training required');
select is((select sum(completed_units)::int from leader_rows),
          (select sum(p.completed_units)::int from ids, public.programme_enrollments e
             cross join lateral public.canonical_enrollment_progress(e.id, current_date) p
            where e.cohort_id = ids.cohort1),
  '10. leader rows are the canonical enrollment rows');
select is((select completed_units from cohort_totals), 3,
  '10. cohort 1 counts week 1 (A) + Coaching 2 and 3 (C)');

-- ---------------------------------------------------------------------------
-- 11. Final checkpoint = canonical cohort totals at the same effective as-of
-- ---------------------------------------------------------------------------
select is((select required_units from cohort_journey order by n desc limit 1), (select required_units from cohort_totals),
  '11. final checkpoint required = cohort required');
select is((select completed_units from cohort_journey order by n desc limit 1), (select completed_units from cohort_totals),
  '11. final checkpoint completed = cohort completed');

select set_config('request.jwt.claim.sub', '', true);

select is((select count(*)::int from public.programme_enrollments e
    cross join lateral public.canonical_enrollment_progress(e.id, current_date) p
    cross join lateral (
      select x from jsonb_array_elements(public.canonical_enrollment_journey(e.id, current_date)) x
      order by (x->>'checkpoint_number')::int desc limit 1) last
   where e.programme_id = 'f7720000-0000-4000-8000-000000000001'
     and ((last.x->>'required_units')::int <> p.required_units or (last.x->>'completed_units')::int <> p.completed_units)), 0,
  '11. every enrollment''s final checkpoint equals its canonical totals');
select is((select (x->>'completed_units')::int from ids,
      jsonb_array_elements(public.canonical_enrollment_journey(ids.d, current_date)) x
    order by (x->>'checkpoint_number')::int desc limit 1), 1,
  '11. the finished enrollment''s journey is frozen with its programme');

-- ---------------------------------------------------------------------------
-- Diagnostic
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', 'f7700000-0000-4000-8000-000000000001', true);
create temp table ineligible on commit drop as
select d.* from public.admin_ineligible_programme_activity() d, ids
where d.enrollment_id in (ids.a, ids.b, ids.c, ids.d);

select is((select count(*)::int from ineligible, ids where enrollment_id = ids.c and module = 'coaching'
    and requirement_index = 1 and reason = 'completed_before_available'), 1,
  'diagnostic: the session 15 days early is listed');
select is((select count(*)::int from ineligible, ids where enrollment_id = ids.d and module = 'coaching'
    and requirement_index = 2 and reason = 'completed_after_programme_end'), 1,
  'diagnostic: the session after the programme end is listed');
select ok((select count(*) from ineligible, ids where enrollment_id = ids.a and module = 'training'
    and requirement_index = 4 and reason = 'completed_before_available') >= 3,
  'diagnostic: every piece of seeded week-4 evidence is listed');
select is((select count(*)::int from ineligible, ids where enrollment_id = ids.a and module = 'training' and requirement_index = 1), 0,
  'diagnostic: valid evidence is never listed');
select is((select count(*)::int from ineligible, ids where enrollment_id = ids.b), 0,
  'diagnostic: evidence dated on the availability day is valid');
select set_config('request.jwt.claim.sub', 'f7700000-0000-4000-8000-000000000011', true);
select throws_ok('select * from public.admin_ineligible_programme_activity()', '42501', null,
  'diagnostic: admin only');

select * from finish();
rollback;
