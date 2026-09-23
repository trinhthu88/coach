-- P1 source-of-truth correctness (20261001110000_p1_source_of_truth).
--
-- Fixture (T = current_date):
--   Programme P  Coaching x2 + Mentoring x1; cohort KP (P), cohort KP2 (P, empty)
--   Programme Q  Coaching x1;                cohort KQ (Q)
--   Programme R  Coaching x2, but cohort KR stores a date for unit 1 only
--   Programme S  Coaching x1; cohort KS has NO end date
--   Programme W  Training over "all weeks" (no selection array); cohort KW
--
--   L1 (P, KP)   Coaching 1 (due T+20, window opens T+6) held and completed at
--                T-10 -- before its window; Mentoring 1 (due T+20) likewise
--   L2 (R, KR)   completes the one stored Coaching requirement inside its window
--   L3 (S, KS)   enrollment ended T-5; its Coaching unit done in its window
--   L4 (S, KS)   enrollment ended T-5; nothing done
--   L5 (P, KP2)  stored status at_risk, ongoing
--   L6 (W, KW)   Training
begin;
select plan(35);

-- ---------------------------------------------------------------------------
-- Fixture
-- ---------------------------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_user_meta_data, created_at, updated_at, confirmation_token, email_change_token_new, recovery_token)
select ('f9900000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid,
  '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated',
  'p1sot-' || n || '@example.test', 'test', now(),
  jsonb_build_object('full_name', 'P1 Person ' || n), now(), now(), '', '', ''
from unnest(array[1, 11, 12, 13, 14, 15, 16]) n;
-- 01 = the Coach / Mentor; 11..16 = learners L1..L6
insert into public.profiles (id, full_name, email, status)
select id, raw_user_meta_data->>'full_name', email, 'active' from auth.users where email like 'p1sot-%'
on conflict (id) do update set status = 'active';
insert into public.user_roles (user_id, role) values ('f9900000-0000-4000-8000-000000000001', 'coach')
on conflict do nothing;

insert into public.programmes (id, name) values
  ('f9910000-0000-4000-8000-00000000000a', 'P1 Programme P'),
  ('f9910000-0000-4000-8000-00000000000b', 'P1 Programme Q'),
  ('f9910000-0000-4000-8000-00000000000c', 'P1 Programme R'),
  ('f9910000-0000-4000-8000-00000000000d', 'P1 Programme S'),
  ('f9910000-0000-4000-8000-00000000000e', 'P1 Programme W');
insert into public.programme_modules (programme_id, module, enabled, config) values
  ('f9910000-0000-4000-8000-00000000000a', 'coaching', true, '{"required": true, "required_units": 2}'),
  ('f9910000-0000-4000-8000-00000000000a', 'mentoring', true, '{"required": true, "required_units": 1}'),
  ('f9910000-0000-4000-8000-00000000000b', 'coaching', true, '{"required": true, "required_units": 1}'),
  ('f9910000-0000-4000-8000-00000000000c', 'coaching', true, '{"required": true, "required_units": 2}'),
  ('f9910000-0000-4000-8000-00000000000d', 'coaching', true, '{"required": true, "required_units": 1}'),
  ('f9910000-0000-4000-8000-00000000000e', 'training', true,
   '{"required": true, "required_units": 2, "learning_components": ["skill_cards"]}');

-- No end dates on the session cohorts: nothing is materialised automatically,
-- every requirement row below is stated explicitly.
insert into public.cohorts (id, name, programme_id, start_date, end_date) values
  ('f9920000-0000-4000-8000-0000000000a1', 'KP',  'f9910000-0000-4000-8000-00000000000a', current_date - 60, null),
  ('f9920000-0000-4000-8000-0000000000a2', 'KP2', 'f9910000-0000-4000-8000-00000000000a', current_date - 60, null),
  ('f9920000-0000-4000-8000-0000000000b1', 'KQ',  'f9910000-0000-4000-8000-00000000000b', current_date - 60, null),
  ('f9920000-0000-4000-8000-0000000000c1', 'KR',  'f9910000-0000-4000-8000-00000000000c', current_date - 60, null),
  ('f9920000-0000-4000-8000-0000000000d1', 'KS',  'f9910000-0000-4000-8000-00000000000d', current_date - 90, null),
  ('f9920000-0000-4000-8000-0000000000e1', 'KW',  'f9910000-0000-4000-8000-00000000000e', current_date - 14, current_date + 100);

insert into public.cohort_requirement_dates
  (id, cohort_id, programme_id, module, ordinal, due_on, generation_method, materialized_via, is_overridden) values
  ('f9930000-0000-4000-8000-0000000000a1', 'f9920000-0000-4000-8000-0000000000a1', 'f9910000-0000-4000-8000-00000000000a', 'coaching', 1, current_date + 20, 'manual', 'admin_save', true),
  ('f9930000-0000-4000-8000-0000000000a2', 'f9920000-0000-4000-8000-0000000000a1', 'f9910000-0000-4000-8000-00000000000a', 'coaching', 2, current_date + 60, 'manual', 'admin_save', true),
  ('f9930000-0000-4000-8000-0000000000a3', 'f9920000-0000-4000-8000-0000000000a1', 'f9910000-0000-4000-8000-00000000000a', 'mentoring', 1, current_date + 20, 'manual', 'admin_save', true),
  ('f9930000-0000-4000-8000-0000000000c1', 'f9920000-0000-4000-8000-0000000000c1', 'f9910000-0000-4000-8000-00000000000c', 'coaching', 1, current_date - 2, 'manual', 'admin_save', true),
  ('f9930000-0000-4000-8000-0000000000d1', 'f9920000-0000-4000-8000-0000000000d1', 'f9910000-0000-4000-8000-00000000000d', 'coaching', 1, current_date - 20, 'manual', 'admin_save', true);

insert into public.programme_enrollments (id, programme_id, user_id, cohort_id, start_date, end_date, status) values
  ('f9940000-0000-4000-8000-000000000011', 'f9910000-0000-4000-8000-00000000000a', 'f9900000-0000-4000-8000-000000000011', 'f9920000-0000-4000-8000-0000000000a1', current_date - 60, null, 'active'),
  ('f9940000-0000-4000-8000-000000000012', 'f9910000-0000-4000-8000-00000000000c', 'f9900000-0000-4000-8000-000000000012', 'f9920000-0000-4000-8000-0000000000c1', current_date - 60, null, 'active'),
  ('f9940000-0000-4000-8000-000000000013', 'f9910000-0000-4000-8000-00000000000d', 'f9900000-0000-4000-8000-000000000013', 'f9920000-0000-4000-8000-0000000000d1', current_date - 90, current_date - 5, 'active'),
  ('f9940000-0000-4000-8000-000000000014', 'f9910000-0000-4000-8000-00000000000d', 'f9900000-0000-4000-8000-000000000014', 'f9920000-0000-4000-8000-0000000000d1', current_date - 90, current_date - 5, 'active'),
  ('f9940000-0000-4000-8000-000000000015', 'f9910000-0000-4000-8000-00000000000a', 'f9900000-0000-4000-8000-000000000015', 'f9920000-0000-4000-8000-0000000000a2', current_date - 60, null, 'at_risk'),
  ('f9940000-0000-4000-8000-000000000016', 'f9910000-0000-4000-8000-00000000000e', 'f9900000-0000-4000-8000-000000000016', 'f9920000-0000-4000-8000-0000000000e1', current_date - 14, null, 'active');

insert into public.coachee_goals (id, coachee_id, enrollment_id, title) values
  ('f9950000-0000-4000-8000-000000000011', 'f9900000-0000-4000-8000-000000000011', 'f9940000-0000-4000-8000-000000000011', 'P1 goal');
insert into public.cohort_coach_assignments (cohort_id, coach_id) values
  ('f9920000-0000-4000-8000-0000000000a1', 'f9900000-0000-4000-8000-000000000001'),
  ('f9920000-0000-4000-8000-0000000000c1', 'f9900000-0000-4000-8000-000000000001'),
  ('f9920000-0000-4000-8000-0000000000d1', 'f9900000-0000-4000-8000-000000000001');
insert into public.cohort_mentors (cohort_id, mentor_user_id) values
  ('f9920000-0000-4000-8000-0000000000a1', 'f9900000-0000-4000-8000-000000000001');

-- ---------------------------------------------------------------------------
-- 4. Enrollment <-> cohort <-> programme
-- ---------------------------------------------------------------------------
select throws_ok(
  $$insert into public.programme_enrollments (programme_id, user_id, cohort_id, status)
    values ('f9910000-0000-4000-8000-00000000000a', 'f9900000-0000-4000-8000-000000000016',
            'f9920000-0000-4000-8000-0000000000b1', 'active')$$,
  'P0001', 'The selected cohort does not belong to the selected programme',
  '4a. an enrollment cannot be created in another programme''s cohort');
select throws_ok(
  $$update public.programme_enrollments set cohort_id = 'f9920000-0000-4000-8000-0000000000b1'
    where id = 'f9940000-0000-4000-8000-000000000011'$$,
  'P0001', 'The selected cohort does not belong to the selected programme',
  '4b. an enrollment cannot be moved into another programme''s cohort (reproduced P3)');
select lives_ok(
  $$update public.programme_enrollments set cohort_id = 'f9920000-0000-4000-8000-0000000000a2'
    where id = 'f9940000-0000-4000-8000-000000000015'$$,
  '4c. moving within the same programme is allowed');
select lives_ok(
  $$update public.programme_enrollments set notes = 'lifecycle edits are unaffected'
    where id = 'f9940000-0000-4000-8000-000000000011'$$,
  '4d. an update that does not touch cohort or programme is not re-validated');
select throws_ok(
  $$update public.cohorts set programme_id = 'f9910000-0000-4000-8000-00000000000b'
    where id = 'f9920000-0000-4000-8000-0000000000a1'$$,
  '23503', null,
  '4e. a cohort with enrollments cannot change programme');
insert into public.cohorts (id, name, programme_id) values
  ('f9920000-0000-4000-8000-0000000000ff', 'Empty', 'f9910000-0000-4000-8000-00000000000a');
select lives_ok(
  $$update public.cohorts set programme_id = 'f9910000-0000-4000-8000-00000000000b'
    where id = 'f9920000-0000-4000-8000-0000000000ff'$$,
  '4f. a cohort without enrollments can change programme');

-- ---------------------------------------------------------------------------
-- 5. An early session does not keep its requirement
-- ---------------------------------------------------------------------------
select is(public.session_occupies_requirement('confirmed', now() - interval '60 days', current_date + 20), true,
  '5a. a live session occupies its requirement');
select is(public.session_occupies_requirement('completed', (current_date - 10)::timestamptz, current_date + 20), false,
  '5b. a session completed before due_on - 14 does not');
select is(public.session_occupies_requirement('completed', (current_date + 6)::timestamptz, current_date + 20), true,
  '5c. a session completed on the day the window opens does');
select is(public.session_occupies_requirement('cancelled', now(), current_date + 20), false,
  '5d. a cancelled session does not');

select set_config('app.session_transition', 'on', true);
insert into public.sessions (id, enrollment_id, cohort_requirement_id, coach_id, coachee_id, topic, start_time, duration_minutes, status)
values ('f9960000-0000-4000-8000-000000000001', 'f9940000-0000-4000-8000-000000000011', 'f9930000-0000-4000-8000-0000000000a1',
  'f9900000-0000-4000-8000-000000000001', 'f9900000-0000-4000-8000-000000000011', 'Too early',
  (current_date - 10 + time '09:00') at time zone 'UTC', 60, 'completed');
insert into public.mentoring_sessions (id, enrollment_id, cohort_requirement_id, mentor_id, mentee_id, topic, start_time, duration_minutes, status)
values ('f9970000-0000-4000-8000-000000000001', 'f9940000-0000-4000-8000-000000000011', 'f9930000-0000-4000-8000-0000000000a3',
  'f9900000-0000-4000-8000-000000000001', 'f9900000-0000-4000-8000-000000000011', 'Too early',
  (current_date - 10 + time '09:00') at time zone 'UTC', 60, 'completed');

select is(
  (select completed_units from public.canonical_module_progress('f9940000-0000-4000-8000-000000000011', current_date) where module = 'coaching'),
  0, '5e. the early Coaching session still does not count');
select is(
  (select requirement_id from public.next_coaching_requirement('f9940000-0000-4000-8000-000000000011')),
  'f9930000-0000-4000-8000-0000000000a1'::uuid,
  '5f. next_coaching_requirement offers the requirement the early session used to lock');
select is(
  (select requirement_id from public.next_mentoring_requirement('f9940000-0000-4000-8000-000000000011')),
  'f9930000-0000-4000-8000-0000000000a3'::uuid,
  '5g. next_mentoring_requirement likewise');

insert into public.coach_availability (id, coach_id, slot_date, start_time, end_time, slot_type) values
  ('f9980000-0000-4000-8000-000000000001', 'f9900000-0000-4000-8000-000000000001', current_date + 10, '09:00', '10:00', 'coaching');
select lives_ok(
  $$select public.book_coaching_session_internal('f9940000-0000-4000-8000-000000000011',
      'f9900000-0000-4000-8000-000000000001', 'f9980000-0000-4000-8000-000000000001',
      'f9930000-0000-4000-8000-0000000000a1', 'Rebooked in the window')$$,
  '5h. the requirement can be booked again (it was refused before)');
select is(
  (select f.session_id <> 'f9960000-0000-4000-8000-000000000001'::uuid and f.booked_on is not null
   from public.canonical_coaching_requirement_fulfilment('f9940000-0000-4000-8000-000000000011') f where f.ordinal = 1),
  true, '5i. fulfilment now reports the new, live session for that requirement');
select is(
  (select count(*)::int from public.canonical_enrollment_requirement_calendar('f9940000-0000-4000-8000-000000000011', current_date)
   where module = 'coaching'),
  2, '5j. still exactly one calendar row per Coaching requirement');
select is(
  (select count(*)::int from public.next_coaching_requirement('f9940000-0000-4000-8000-000000000011')
   where requirement_id = 'f9930000-0000-4000-8000-0000000000a1'), 0,
  '5k. once rebooked, the requirement is taken again');

-- Mentoring auto-attribution: a session naming no requirement takes the one
-- the early session held.
insert into public.mentoring_sessions (id, enrollment_id, mentor_id, mentee_id, topic, start_time, duration_minutes, status)
values ('f9970000-0000-4000-8000-000000000002', 'f9940000-0000-4000-8000-000000000011',
  'f9900000-0000-4000-8000-000000000001', 'f9900000-0000-4000-8000-000000000011', 'In the window',
  (current_date + 10 + time '09:00') at time zone 'UTC', 60, 'confirmed');
select is(
  (select cohort_requirement_id from public.mentoring_sessions where id = 'f9970000-0000-4000-8000-000000000002'),
  'f9930000-0000-4000-8000-0000000000a3'::uuid,
  '5l. Mentoring auto-attribution treats the early session''s requirement as free');

-- ---------------------------------------------------------------------------
-- 6. A requirement without a stored date is not required
-- ---------------------------------------------------------------------------
insert into public.sessions (enrollment_id, cohort_requirement_id, coach_id, coachee_id, topic, start_time, duration_minutes, status)
values ('f9940000-0000-4000-8000-000000000012', 'f9930000-0000-4000-8000-0000000000c1',
  'f9900000-0000-4000-8000-000000000001', 'f9900000-0000-4000-8000-000000000012', 'In the window',
  (current_date - 5 + time '09:00') at time zone 'UTC', 60, 'completed');
select is(
  (select count(*)::int from public.canonical_enrollment_requirement_calendar('f9940000-0000-4000-8000-000000000012', current_date)),
  1, '6a. only the stored Coaching requirement is in the calendar (the programme asks for 2, the cohort dates 1)');
select is(
  (select (required_units, completed_units, full_completion_pct)::text
   from public.canonical_enrollment_progress('f9940000-0000-4000-8000-000000000012', current_date)),
  '(1,1,100.0)', '6b. with every dated requirement done the leader reaches 100%');
select is(
  (select count(*)::int from public.canonical_enrollment_requirement_calendar('f9940000-0000-4000-8000-000000000012', current_date)
   where requirement_id is null or due_on is null),
  0, '6c. no calendar row lacks a requirement or a date');
select ok(
  exists (select 1 from public.requirement_integrity_issues() i where i.cohort_id = 'f9920000-0000-4000-8000-0000000000c1'),
  '6d. the missing date is still reported as a schedule gap');

-- ---------------------------------------------------------------------------
-- 7. Training: only stored weeks, stored dates
-- ---------------------------------------------------------------------------
insert into public.training_weeks (id, programme_id, week_number, title, is_visible, skill_card_visible) values
  ('f9990000-0000-4000-8000-000000000001', 'f9910000-0000-4000-8000-00000000000e', 1, 'W week 1', true, true),
  ('f9990000-0000-4000-8000-000000000002', 'f9910000-0000-4000-8000-00000000000e', 2, 'W week 2', true, true);
delete from public.cohort_requirement_dates where cohort_id = 'f9920000-0000-4000-8000-0000000000e1';
select is(
  (select count(*)::int from public.canonical_training_week_fulfilment('f9940000-0000-4000-8000-000000000016', current_date)),
  0, '7a. weeks without a stored requirement row are not requirements (no computed dates)');
select is(
  (select count(*)::int from public.canonical_enrollment_requirement_calendar('f9940000-0000-4000-8000-000000000016', current_date)
   where module = 'training'),
  0, '7b. ... and are not in the calendar');
insert into public.cohort_requirement_dates
  (cohort_id, programme_id, module, ordinal, due_on, training_week_id, generation_method, materialized_via, is_overridden)
values ('f9920000-0000-4000-8000-0000000000e1', 'f9910000-0000-4000-8000-00000000000e', 'training', 1,
  current_date + 30, 'f9990000-0000-4000-8000-000000000001', 'manual', 'admin_save', true);
select is(
  (select array_agg(training_week_id::text || ' ' || due_on::text)
   from public.canonical_training_week_fulfilment('f9940000-0000-4000-8000-000000000016', current_date)),
  array['f9990000-0000-4000-8000-000000000001 ' || (current_date + 30)::text],
  '7c. a stored week is a requirement, due on its stored date');
select is(
  (select available_on from public.canonical_training_week_fulfilment('f9940000-0000-4000-8000-000000000016', current_date)),
  current_date - 14, '7d. it opens at its pacing date (cohort start + (week - 1) * 7)');

-- ---------------------------------------------------------------------------
-- 8. One end date; 9. at_risk is derived
-- ---------------------------------------------------------------------------
insert into public.sessions (enrollment_id, cohort_requirement_id, coach_id, coachee_id, topic, start_time, duration_minutes, status)
values ('f9940000-0000-4000-8000-000000000013', 'f9930000-0000-4000-8000-0000000000d1',
  'f9900000-0000-4000-8000-000000000001', 'f9900000-0000-4000-8000-000000000013', 'Done in time',
  (current_date - 25 + time '09:00') at time zone 'UTC', 60, 'completed');
select is(
  (select effective_enrollment_status::text from public.canonical_enrollment_progress('f9940000-0000-4000-8000-000000000013', current_date)),
  'completed', '8a. cohort without an end, enrollment ended, everything done: completed (not stuck on active)');
select is(
  (select effective_enrollment_status::text from public.canonical_enrollment_progress('f9940000-0000-4000-8000-000000000014', current_date)),
  'at_risk', '8b. same, nothing done: at_risk');
select is(
  (select effective_enrollment_status::text from public.canonical_enrollment_progress('f9940000-0000-4000-8000-000000000015', current_date)),
  'active', '9a. a stored at_risk on an ongoing enrollment reads as active');
select is(
  (select stored_enrollment_status::text from public.canonical_enrollment_progress('f9940000-0000-4000-8000-000000000015', current_date)),
  'at_risk', '9b. the stored value is still reported as stored');

-- ---------------------------------------------------------------------------
-- 10. Goal ratings reference their goal; + content deletes
-- ---------------------------------------------------------------------------
select throws_ok(
  $$insert into public.coachee_goal_ratings (goal_id, coachee_id, enrollment_id, start_rating, current_rating, target_rating)
    values (gen_random_uuid(), 'f9900000-0000-4000-8000-000000000011', 'f9940000-0000-4000-8000-000000000011', 30, 30, 80)$$,
  '23503', null, '10. a rating cannot reference a goal that does not exist');

insert into public.assignments (id, training_week_id, title, assignment_type, is_visible) values
  ('f99a0000-0000-4000-8000-000000000001', 'f9990000-0000-4000-8000-000000000002', 'Answered', 'reflection', true),
  ('f99a0000-0000-4000-8000-000000000002', 'f9990000-0000-4000-8000-000000000002', 'Unanswered', 'reflection', true);
insert into public.assignment_submissions (user_id, enrollment_id, assignment_id, reflection_text)
values ('f9900000-0000-4000-8000-000000000016', 'f9940000-0000-4000-8000-000000000016', 'f99a0000-0000-4000-8000-000000000001', 'Mine');
insert into public.daily_prompts (id, training_week_id, day_offset, prompt_text, is_visible) values
  ('f99b0000-0000-4000-8000-000000000001', 'f9990000-0000-4000-8000-000000000002', 1, 'Answered', true),
  ('f99b0000-0000-4000-8000-000000000002', 'f9990000-0000-4000-8000-000000000002', 2, 'Unanswered', true);
insert into public.daily_prompt_responses (user_id, enrollment_id, daily_prompt_id, responded_at)
values ('f9900000-0000-4000-8000-000000000016', 'f9940000-0000-4000-8000-000000000016', 'f99b0000-0000-4000-8000-000000000001', now());
select throws_ok(
  $$delete from public.assignments where id = 'f99a0000-0000-4000-8000-000000000001'$$,
  '23503', null, '+a. an assignment with a learner submission cannot be deleted');
select lives_ok(
  $$delete from public.assignments where id = 'f99a0000-0000-4000-8000-000000000002'$$,
  '+b. an assignment without submissions can');
select throws_ok(
  $$delete from public.daily_prompts where id = 'f99b0000-0000-4000-8000-000000000001'$$,
  '23503', null, '+c. a daily prompt with a response cannot be deleted');
select lives_ok(
  $$delete from public.daily_prompts where id = 'f99b0000-0000-4000-8000-000000000002'$$,
  '+d. a daily prompt without responses can');

select * from finish();
rollback;
