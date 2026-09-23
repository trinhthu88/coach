-- Coaching canonical architecture contract (Coaching redesign).
--
-- Cohort VC schedules two Coaching requirements. Coach K is in the cohort
-- Coach pool; Coach X is not. Learners L1 and L2 are enrolled in VC.
--
-- Covers section 36: booking atomicity, requirement uniqueness, cohort Coach
-- eligibility, cancellation release, the separation of session completion from
-- unit completion, and each of the four evidence gates independently.
begin;

select plan(44);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_user_meta_data, created_at, updated_at, confirmation_token, email_change_token_new, recovery_token)
select ('c1000000-0000-0000-0000-00000000000' || n)::uuid, '00000000-0000-0000-0000-000000000000'::uuid,
  'authenticated', 'authenticated', 'coaching-canon-' || n || '@example.test', 'test', now(),
  jsonb_build_object('full_name', 'Coaching Person ' || n), now(), now(), '', '', ''
from generate_series(1, 4) n;
-- 1=Coach K (in pool) 2=Coach X (outside pool) 3=L1 4=L2

insert into public.user_roles (user_id, role) values
  ('c1000000-0000-0000-0000-000000000001', 'coach'),
  ('c1000000-0000-0000-0000-000000000002', 'coach'),
  ('c1000000-0000-0000-0000-000000000003', 'coachee'),
  ('c1000000-0000-0000-0000-000000000004', 'coachee')
on conflict do nothing;

insert into public.programmes (id, name)
  values ('c1000000-0000-0000-0000-00000000a0a0'::uuid, 'Coaching Canon Programme');
insert into public.cohorts (id, name, programme_id)
  values ('c1000000-0000-0000-0000-00000000b0b0'::uuid, 'VC', 'c1000000-0000-0000-0000-00000000a0a0'::uuid);
-- The Programme defines HOW MANY Coaching units are required (section 2).
insert into public.programme_modules (programme_id, module, enabled, config)
  values ('c1000000-0000-0000-0000-00000000a0a0'::uuid, 'coaching', true,
          '{"required": true, "required_units": 2}'::jsonb);

insert into public.programme_enrollments (id, programme_id, user_id, cohort_id, status) values
  ('c1000000-0000-0000-0000-00000000e1e1'::uuid, 'c1000000-0000-0000-0000-00000000a0a0'::uuid,
   'c1000000-0000-0000-0000-000000000003'::uuid, 'c1000000-0000-0000-0000-00000000b0b0'::uuid, 'active'),
  ('c1000000-0000-0000-0000-00000000e2e2'::uuid, 'c1000000-0000-0000-0000-00000000a0a0'::uuid,
   'c1000000-0000-0000-0000-000000000004'::uuid, 'c1000000-0000-0000-0000-00000000b0b0'::uuid, 'active');
-- Booking requires an active goal (check_booking_eligibility, 20260926600000).
insert into public.coachee_goals (coachee_id, enrollment_id, title)
select e.user_id, e.id, 'Fixture goal'
from public.programme_enrollments e
where e.status in ('active', 'at_risk', 'paused')
  and not exists (select 1 from public.coachee_goals g where g.enrollment_id = e.id and g.status = 'active');

-- Each Coaching requirement carries its own Admin-set date. Coaching 1 is due
-- in 13 days, so its availability window (due_on - 14,
-- 20260930100000) opens yesterday: the session held yesterday below fulfils it.
insert into public.cohort_requirement_dates
  (id, cohort_id, programme_id, module, ordinal, due_on, generation_method, materialized_via, is_overridden) values
  ('c1000000-0000-0000-0000-00000000d1d1'::uuid, 'c1000000-0000-0000-0000-00000000b0b0'::uuid,
   'c1000000-0000-0000-0000-00000000a0a0'::uuid, 'coaching', 1, current_date + 13, 'manual', 'admin_save', true),
  ('c1000000-0000-0000-0000-00000000d2d2'::uuid, 'c1000000-0000-0000-0000-00000000b0b0'::uuid,
   'c1000000-0000-0000-0000-00000000a0a0'::uuid, 'coaching', 2, current_date + 60, 'manual', 'admin_save', true);

-- Only Coach K is in the pool.
insert into public.cohort_coach_assignments (cohort_id, coach_id)
  values ('c1000000-0000-0000-0000-00000000b0b0'::uuid, 'c1000000-0000-0000-0000-000000000001'::uuid);

insert into public.coach_availability (id, coach_id, slot_date, start_time, end_time, slot_type) values
  ('c1000000-0000-0000-0000-00000000f1f1'::uuid, 'c1000000-0000-0000-0000-000000000001'::uuid,
   current_date + 7, '09:00', '10:00', 'coaching'),
  ('c1000000-0000-0000-0000-00000000f2f2'::uuid, 'c1000000-0000-0000-0000-000000000001'::uuid,
   current_date + 8, '09:00', '10:00', 'coaching'),
  ('c1000000-0000-0000-0000-00000000f3f3'::uuid, 'c1000000-0000-0000-0000-000000000001'::uuid,
   current_date + 9, '09:00', '10:00', 'coaching'),
  ('c1000000-0000-0000-0000-00000000f4f4'::uuid, 'c1000000-0000-0000-0000-000000000001'::uuid,
   current_date + 10, '09:00', '10:00', 'coaching');

-- ---------------------------------------------------------------------------
-- Cohort Coach pool
-- ---------------------------------------------------------------------------
select is(
  (select count(*)::int from public.cohort_coaching_coach_pool('c1000000-0000-0000-0000-00000000b0b0'::uuid)),
  1, 'cohort Coach pool contains exactly the assigned Coach');

select is(
  (select count(*)::int from public.enrollment_coaching_coach_pool('c1000000-0000-0000-0000-00000000e1e1'::uuid)),
  1, 'enrollment resolves its own cohort Coach pool');

select ok(
  not exists (select 1 from public.cohort_coaching_coach_pool('c1000000-0000-0000-0000-00000000b0b0'::uuid)
              where coach_id = 'c1000000-0000-0000-0000-000000000002'::uuid),
  'a Coach with no assignment is not in the pool');

-- An inactive assignment leaves the pool.
insert into public.cohort_coach_assignments (cohort_id, coach_id, is_active)
  values ('c1000000-0000-0000-0000-00000000b0b0'::uuid, 'c1000000-0000-0000-0000-000000000002'::uuid, false);
select ok(
  not exists (select 1 from public.cohort_coaching_coach_pool('c1000000-0000-0000-0000-00000000b0b0'::uuid)
              where coach_id = 'c1000000-0000-0000-0000-000000000002'::uuid),
  'an inactive assignment is not in the pool');

-- ---------------------------------------------------------------------------
-- Booking and reservation
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims',
  json_build_object('sub', 'c1000000-0000-0000-0000-000000000003')::text, true);

-- Booking requires an active goal (check_booking_eligibility, 20260926600000):
-- give every ongoing fixture enrollment without one a goal before it books.
insert into public.coachee_goals (coachee_id, enrollment_id, title)
select e.user_id, e.id, 'Fixture goal'
from public.programme_enrollments e
where e.status in ('active', 'at_risk', 'paused')
  and not exists (select 1 from public.coachee_goals g where g.enrollment_id = e.id and g.status = 'active');
insert into public.sessions
  (id, enrollment_id, cohort_requirement_id, coach_id, coachee_id, slot_id, topic,
   start_time, duration_minutes, status)
values ('c1000000-0000-0000-0000-00000000c1c1'::uuid,
        'c1000000-0000-0000-0000-00000000e1e1'::uuid, 'c1000000-0000-0000-0000-00000000d1d1'::uuid,
        'c1000000-0000-0000-0000-000000000001'::uuid, 'c1000000-0000-0000-0000-000000000003'::uuid,
        'c1000000-0000-0000-0000-00000000f1f1'::uuid, 'Canon',
        (current_date + 7 + time '09:00') at time zone 'UTC', 60, 'pending_coach_approval');

select ok(
  (select is_booked from public.coach_availability where id = 'c1000000-0000-0000-0000-00000000f1f1'::uuid),
  'slot is reserved at pending_coach_approval, not at confirmation');

select is(
  (select session_id from public.coach_availability where id = 'c1000000-0000-0000-0000-00000000f1f1'::uuid),
  'c1000000-0000-0000-0000-00000000c1c1'::uuid,
  'reserved slot back-references the owning session');

-- Regression: booking used to DELETE the availability row outright, which made
-- releasing it on cancellation impossible. The row must survive.
select is(
  (select count(*)::int from public.coach_availability where id = 'c1000000-0000-0000-0000-00000000f1f1'::uuid),
  1, 'the availability row survives booking instead of being deleted');

select is(
  (select cohort_id from public.sessions where id = 'c1000000-0000-0000-0000-00000000c1c1'::uuid),
  'c1000000-0000-0000-0000-00000000b0b0'::uuid,
  'sessions.cohort_id is derived from the enrollment, not supplied');

-- A second live session on the same slot is impossible. Learner 2 acts here,
-- so the JWT subject switches with them.
select set_config('request.jwt.claims',
  json_build_object('sub', 'c1000000-0000-0000-0000-000000000004')::text, true);
select throws_ok($$
  insert into public.sessions
    (enrollment_id, cohort_requirement_id, coach_id, coachee_id, slot_id, topic,
     start_time, duration_minutes, status)
  values ('c1000000-0000-0000-0000-00000000e2e2'::uuid, 'c1000000-0000-0000-0000-00000000d1d1'::uuid,
          'c1000000-0000-0000-0000-000000000001'::uuid, 'c1000000-0000-0000-0000-000000000004'::uuid,
          'c1000000-0000-0000-0000-00000000f1f1'::uuid, 'Double',
          (current_date + 7 + time '09:00') at time zone 'UTC', 60, 'pending_coach_approval')
$$, '23505', NULL, 'a second learner cannot book a slot that is already reserved');

-- A second live session on the same requirement is impossible.
select set_config('request.jwt.claims',
  json_build_object('sub', 'c1000000-0000-0000-0000-000000000003')::text, true);
select throws_ok($$
  insert into public.sessions
    (enrollment_id, cohort_requirement_id, coach_id, coachee_id, slot_id, topic,
     start_time, duration_minutes, status)
  values ('c1000000-0000-0000-0000-00000000e1e1'::uuid, 'c1000000-0000-0000-0000-00000000d1d1'::uuid,
          'c1000000-0000-0000-0000-000000000001'::uuid, 'c1000000-0000-0000-0000-000000000003'::uuid,
          'c1000000-0000-0000-0000-00000000f2f2'::uuid, 'Second live',
          (current_date + 8 + time '09:00') at time zone 'UTC', 60, 'pending_coach_approval')
$$, '23505', NULL, 'one Coaching requirement cannot hold two live sessions');

-- ...but that uniqueness is per LEARNER, not per cohort. A
-- cohort_requirement_dates row is "Coaching 1 OF THE COHORT" and is shared by
-- every enrolled learner, so L2 must be able to book the very same requirement
-- while L1's session for it is still live. Keying
-- sessions_one_live_session_per_requirement on cohort_requirement_id alone
-- (the state before 2026-09-20) turned one cohort requirement into a
-- cohort-wide lock: only one learner at a time could hold a live Coaching 1.
select set_config('request.jwt.claims',
  json_build_object('sub', 'c1000000-0000-0000-0000-000000000004')::text, true);
insert into public.sessions
  (id, enrollment_id, cohort_requirement_id, coach_id, coachee_id, slot_id, topic,
   start_time, duration_minutes, status)
values ('c1000000-0000-0000-0000-00000000c3c3'::uuid,
        'c1000000-0000-0000-0000-00000000e2e2'::uuid, 'c1000000-0000-0000-0000-00000000d1d1'::uuid,
        'c1000000-0000-0000-0000-000000000001'::uuid, 'c1000000-0000-0000-0000-000000000004'::uuid,
        'c1000000-0000-0000-0000-00000000f3f3'::uuid, 'Same requirement, other learner',
        (current_date + 9 + time '09:00') at time zone 'UTC', 60, 'pending_coach_approval');
select is(
  (select count(*)::int from public.sessions
    where cohort_requirement_id = 'c1000000-0000-0000-0000-00000000d1d1'::uuid
      and status in ('pending_coach_approval', 'confirmed')),
  2, 'two learners of one cohort can each hold a live session for the SAME Coaching requirement');

-- ---------------------------------------------------------------------------
-- Rescheduling: authorised by the entry point, validated by the shared insert
-- ---------------------------------------------------------------------------
--
-- reschedule_coaching_session admits the Coach and an Admin as well as the
-- learner, but delegated to book_coaching_session, which required the CALLER to
-- own the enrollment. Every Coach or Admin reschedule therefore failed 42501
-- after the original session had already been released in the same statement.

-- A third party with no relationship to the session is still refused.
select set_config('request.jwt.claims',
  json_build_object('sub', 'c1000000-0000-0000-0000-000000000003')::text, true);
select throws_ok($$
  select public.reschedule_coaching_session(
    'c1000000-0000-0000-0000-00000000c3c3'::uuid,
    'c1000000-0000-0000-0000-00000000f4f4'::uuid, NULL)
$$, '42501', NULL, 'a learner cannot reschedule another learner''s session');

-- The assigned Coach can.
select set_config('request.jwt.claims',
  json_build_object('sub', 'c1000000-0000-0000-0000-000000000001')::text, true);
select lives_ok($$
  select public.reschedule_coaching_session(
    'c1000000-0000-0000-0000-00000000c3c3'::uuid,
    'c1000000-0000-0000-0000-00000000f4f4'::uuid, 'Coach moved it')
$$, 'the assigned Coach can reschedule the learner''s session');

select is(
  (select status::text from public.sessions
    where id = 'c1000000-0000-0000-0000-00000000c3c3'::uuid),
  'rescheduled', 'the original session is released as rescheduled');

-- The replacement belongs to the LEARNER, not to whoever moved it. Taking
-- coachee_id from auth.uid() would have written the Coach in here.
select is(
  (select coachee_id from public.sessions
    where enrollment_id = 'c1000000-0000-0000-0000-00000000e2e2'::uuid
      and cohort_requirement_id = 'c1000000-0000-0000-0000-00000000d1d1'::uuid
      and status in ('pending_coach_approval', 'confirmed')),
  'c1000000-0000-0000-0000-000000000004'::uuid,
  'the rescheduled session still belongs to the learner, not the Coach who moved it');

-- A Coach outside the pool is rejected.
select set_config('request.jwt.claims',
  json_build_object('sub', 'c1000000-0000-0000-0000-000000000004')::text, true);
select throws_ok($$
  insert into public.sessions
    (enrollment_id, cohort_requirement_id, coach_id, coachee_id, slot_id, topic,
     start_time, duration_minutes, status)
  values ('c1000000-0000-0000-0000-00000000e2e2'::uuid, 'c1000000-0000-0000-0000-00000000d2d2'::uuid,
          'c1000000-0000-0000-0000-000000000002'::uuid, 'c1000000-0000-0000-0000-000000000004'::uuid,
          'c1000000-0000-0000-0000-00000000f2f2'::uuid, 'Outside',
          (current_date + 8 + time '09:00') at time zone 'UTC', 60, 'pending_coach_approval')
$$, '42501', NULL, 'a Coach outside the cohort pool cannot be booked');

-- A requirement from another module is rejected.
insert into public.cohort_requirement_dates
  (id, cohort_id, programme_id, module, ordinal, due_on, generation_method, materialized_via)
values ('c1000000-0000-0000-0000-00000000d9d9'::uuid, 'c1000000-0000-0000-0000-00000000b0b0'::uuid,
        'c1000000-0000-0000-0000-00000000a0a0'::uuid, 'triads', 1, current_date + 30, 'manual', 'admin_save');
select throws_ok($$
  insert into public.sessions
    (enrollment_id, cohort_requirement_id, coach_id, coachee_id, slot_id, topic,
     start_time, duration_minutes, status)
  values ('c1000000-0000-0000-0000-00000000e2e2'::uuid, 'c1000000-0000-0000-0000-00000000d9d9'::uuid,
          'c1000000-0000-0000-0000-000000000001'::uuid, 'c1000000-0000-0000-0000-000000000004'::uuid,
          'c1000000-0000-0000-0000-00000000f2f2'::uuid, 'Wrong module',
          (current_date + 8 + time '09:00') at time zone 'UTC', 60, 'pending_coach_approval')
$$, '23514', NULL, 'a non-coaching requirement cannot back a Coaching session');

-- ---------------------------------------------------------------------------
-- Cancellation releases slot and requirement
-- ---------------------------------------------------------------------------
-- Back to learner 1, who owns the session being cancelled and rebooked.
select set_config('request.jwt.claims',
  json_build_object('sub', 'c1000000-0000-0000-0000-000000000003')::text, true);
select set_config('app.session_transition', 'on', true);
update public.sessions set status = 'cancelled', cancelled_at = now(),
  cancelled_by = 'c1000000-0000-0000-0000-000000000003'::uuid
  where id = 'c1000000-0000-0000-0000-00000000c1c1'::uuid;

select ok(
  not (select is_booked from public.coach_availability where id = 'c1000000-0000-0000-0000-00000000f1f1'::uuid),
  'cancelling releases the availability slot');

select is(
  (select session_id from public.coach_availability where id = 'c1000000-0000-0000-0000-00000000f1f1'::uuid),
  NULL::uuid, 'released slot drops its session back-reference');

-- The requirement is bookable again, on the same slot.
insert into public.sessions
  (id, enrollment_id, cohort_requirement_id, coach_id, coachee_id, slot_id, topic,
   start_time, duration_minutes, status)
values ('c1000000-0000-0000-0000-00000000c2c2'::uuid,
        'c1000000-0000-0000-0000-00000000e1e1'::uuid, 'c1000000-0000-0000-0000-00000000d1d1'::uuid,
        'c1000000-0000-0000-0000-000000000001'::uuid, 'c1000000-0000-0000-0000-000000000003'::uuid,
        'c1000000-0000-0000-0000-00000000f1f1'::uuid, 'Rebooked',
        (current_date - 1 + time '09:00') at time zone 'UTC', 60, 'confirmed');
select pass('a cancelled requirement can be rebooked, reusing the released slot');

-- ---------------------------------------------------------------------------
-- Session completion is not unit completion
-- ---------------------------------------------------------------------------
update public.sessions set status = 'completed' where id = 'c1000000-0000-0000-0000-00000000c2c2'::uuid;

-- Operational completion IS programme completion. A held session with no
-- evidence at all already fulfils its requirement; the four evidence items are
-- reported separately and gate nothing.
select ok(
  (select fulfilled_on is not null from public.canonical_coaching_requirement_fulfilment('c1000000-0000-0000-0000-00000000e1e1'::uuid)
    where ordinal = 1),
  'a held session with no evidence already fulfils its Coaching requirement');

select ok(
  not (select evidence_complete from public.coaching_session_evidence('c1000000-0000-0000-0000-00000000c2c2'::uuid)),
  'its after-session evidence is separately reported as incomplete');

select is(
  (select completed_units from public.canonical_module_progress('c1000000-0000-0000-0000-00000000e1e1'::uuid, current_date)
    where module = 'coaching'),
  1, 'the bare completed session counts one programme unit');

insert into public.coachee_goals (id, enrollment_id, coachee_id, title, status)
  values ('c1000000-0000-0000-0000-00000000b1b1'::uuid, 'c1000000-0000-0000-0000-00000000e1e1'::uuid,
          'c1000000-0000-0000-0000-000000000003'::uuid, 'Improve delegation', 'active');

select ok(
  (select goal_checkin_required from public.coaching_session_evidence('c1000000-0000-0000-0000-00000000c2c2'::uuid)),
  'the goal check-in gate applies when the enrollment has an active goal');

-- Gate 1: reflection
insert into public.session_learning_reflections (enrollment_id, source_activity_type, source_activity_id, body)
  values ('c1000000-0000-0000-0000-00000000e1e1'::uuid, 'coaching',
          'c1000000-0000-0000-0000-00000000c2c2'::uuid, 'What I learned');
select is(
  (select completed_units from public.canonical_module_progress('c1000000-0000-0000-0000-00000000e1e1'::uuid, current_date)
    where module = 'coaching'),
  1, 'adding a reflection does not change the completed unit count');

-- Gate 2: goal check-in
insert into public.goal_checkins
  (enrollment_id, goal_id, source_activity_type, source_activity_id, new_rating, actor_user_id)
  values ('c1000000-0000-0000-0000-00000000e1e1'::uuid, 'c1000000-0000-0000-0000-00000000b1b1'::uuid,
          'coaching', 'c1000000-0000-0000-0000-00000000c2c2'::uuid, 60,
          'c1000000-0000-0000-0000-000000000003'::uuid);
select is(
  (select completed_units from public.canonical_module_progress('c1000000-0000-0000-0000-00000000e1e1'::uuid, current_date)
    where module = 'coaching'),
  1, 'adding a goal check-in does not change it either');

-- Gate 3: follow-up action
-- New actions carry a goal and a due date (20260929100000).
insert into public.enrollment_actions
  (enrollment_id, source_activity_type, source_activity_id, title, owner_user_id, goal_id, due_date)
  values ('c1000000-0000-0000-0000-00000000e1e1'::uuid, 'coaching',
          'c1000000-0000-0000-0000-00000000c2c2'::uuid, 'Delegate the report',
          'c1000000-0000-0000-0000-000000000003'::uuid,
          'c1000000-0000-0000-0000-00000000b1b1'::uuid, current_date + 7);
select ok(
  not (select evidence_complete from public.coaching_session_evidence('c1000000-0000-0000-0000-00000000c2c2'::uuid)),
  'evidence stays incomplete while satisfaction is outstanding');

-- A Coach private note must never be a gate.
insert into public.coach_session_private_notes (session_id, coach_id, body)
  values ('c1000000-0000-0000-0000-00000000c2c2'::uuid, 'c1000000-0000-0000-0000-000000000001'::uuid, 'note');
select ok(
  not (select evidence_complete from public.coaching_session_evidence('c1000000-0000-0000-0000-00000000c2c2'::uuid)),
  'a Coach private note is not an evidence item');

-- Gate 4: satisfaction
update public.sessions set coachee_rating = 5, coachee_rated_at = now()
  where id = 'c1000000-0000-0000-0000-00000000c2c2'::uuid;
select ok(
  (select evidence_complete from public.coaching_session_evidence('c1000000-0000-0000-0000-00000000c2c2'::uuid)),
  'all four evidence items present reports evidence complete');

select is(
  (select completed_units from public.canonical_module_progress('c1000000-0000-0000-0000-00000000e1e1'::uuid, current_date)
    where module = 'coaching'),
  1, 'and the completed unit count is still exactly what the session gave it');

-- ---------------------------------------------------------------------------
-- Canonical progress is the same source for every role
-- ---------------------------------------------------------------------------
select is(
  (select completed_units from public.canonical_module_progress('c1000000-0000-0000-0000-00000000e1e1'::uuid, current_date)
    where module = 'coaching'),
  1, 'canonical progress counts exactly one completed Coaching unit');

select is(
  (select required_units from public.canonical_module_progress('c1000000-0000-0000-0000-00000000e1e1'::uuid, current_date)
    where module = 'coaching'),
  2, 'required Coaching units come from the cohort requirement schedule');

-- A booked-but-unevidenced second unit counts as booked, never completed.
insert into public.sessions
  (enrollment_id, cohort_requirement_id, coach_id, coachee_id, slot_id, topic,
   start_time, duration_minutes, status)
values ('c1000000-0000-0000-0000-00000000e1e1'::uuid, 'c1000000-0000-0000-0000-00000000d2d2'::uuid,
        'c1000000-0000-0000-0000-000000000001'::uuid, 'c1000000-0000-0000-0000-000000000003'::uuid,
        'c1000000-0000-0000-0000-00000000f2f2'::uuid, 'Second unit',
        (current_date + 8 + time '09:00') at time zone 'UTC', 60, 'confirmed');

select is(
  (select completed_units from public.canonical_module_progress('c1000000-0000-0000-0000-00000000e1e1'::uuid, current_date)
    where module = 'coaching'),
  1, 'a confirmed second session does not increment completed units');

select is(
  (select booked_units from public.canonical_module_progress('c1000000-0000-0000-0000-00000000e1e1'::uuid, current_date)
    where module = 'coaching'),
  1, 'a confirmed second session counts as booked');

-- Enrollment isolation: L2 shares the cohort but has none of L1's activity.
select is(
  (select completed_units from public.canonical_module_progress('c1000000-0000-0000-0000-00000000e2e2'::uuid, current_date)
    where module = 'coaching'),
  0, 'another enrollment in the same cohort is unaffected by L1 activity');

select is(
  (select count(*)::int from public.canonical_coaching_requirement_fulfilment('c1000000-0000-0000-0000-00000000e1e1'::uuid)),
  2, 'requirement fulfilment reports one row per cohort Coaching requirement');

-- ---------------------------------------------------------------------------
-- Role consistency (section 36): every role reads the SAME numbers
-- ---------------------------------------------------------------------------
--
-- Coachee, Coach, Journey and Admin all read canonical_module_progress
-- directly. Sponsor reaches it through
--   sponsor_canonical_leader_progress
--     -> sponsor_canonical_enrollment_progress
--       -> canonical_enrollment_progress
--         -> canonical_module_progress
-- so this asserts the whole Sponsor chain agrees with the direct reader rather
-- than trusting that it does.

-- canonical_enrollment_progress is the layer the whole Sponsor chain delegates
-- to, and it applies no sponsor gating of its own. Asserting it against
-- canonical_module_progress proves the shared spine agrees; the Sponsor
-- wrapper above it only filters rows, it never recomputes them.
select is(
  (select array[coaching_required_units, coaching_completed_units,
                coaching_booked_units, coaching_due_units]
     from public.canonical_enrollment_progress('c1000000-0000-0000-0000-00000000e1e1'::uuid, current_date)),
  (select array[required_units, completed_units, booked_units, due_units]::int[]
     from public.canonical_module_progress('c1000000-0000-0000-0000-00000000e1e1'::uuid, current_date)
    where module = 'coaching'),
  'the Sponsor/Admin progress spine reports the same numbers as the canonical reader');

select is(
  (select coaching_completed_units
     from public.canonical_enrollment_progress('c1000000-0000-0000-0000-00000000e1e1'::uuid, current_date)),
  1, 'the shared spine counts the held-and-evidenced unit as completed, and only that one');

-- Sponsor visibility: sponsor reads additionally require a sponsor whose
-- organisation equals the ENROLLMENT's organisation
-- (sponsor_visible_enrollments). This fixture's enrollments carry no
-- organisation, so no caller sees them through a sponsor surface.
select is(
  (select count(*)::int
     from public.sponsor_canonical_leader_progress('c1000000-0000-0000-0000-00000000e1e1'::uuid, current_date)),
  0, 'a non-sponsor caller sees no Sponsor row, and an enrollment with no organisation is visible to no sponsor');

-- The Sponsor contract exposes no reflection narrative: the column set is
-- fixed, so a narrative leak would be a schema change, not a query mistake.
select ok(
  not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'session_learning_reflections'
      and column_name = 'body'
      and has_column_privilege('anon', 'public.session_learning_reflections', 'body', 'SELECT')
  ),
  'the learner reflection narrative is not readable by anon');

-- ---------------------------------------------------------------------------
-- Operational completion drives progress; evidence is independent
-- ---------------------------------------------------------------------------
--
-- Programme requires 4 Coaching units. Three sessions were held (one fully
-- written up, one missing its reflection, one missing its satisfaction rating)
-- and a fourth is booked for the future.
--
--   completed_units = 3   -- three meetings happened
--   booked_units    = 1
--
-- and the two incomplete write-ups change none of it.
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_user_meta_data, created_at, updated_at, confirmation_token, email_change_token_new, recovery_token)
values ('c1000000-0000-0000-0000-000000000005'::uuid, '00000000-0000-0000-0000-000000000000'::uuid,
  'authenticated', 'authenticated', 'coaching-canon-5@example.test', 'test', now(),
  jsonb_build_object('full_name', 'Coaching Person 5'), now(), now(), '', '', '');
insert into public.user_roles (user_id, role)
  values ('c1000000-0000-0000-0000-000000000005', 'coachee') on conflict do nothing;

insert into public.programmes (id, name)
  values ('c1000000-0000-0000-0000-00000000a5a5'::uuid, 'Coaching Four-Unit Programme');
insert into public.programme_modules (programme_id, module, enabled, config)
  values ('c1000000-0000-0000-0000-00000000a5a5'::uuid, 'coaching', true,
          '{"required": true, "required_units": 4}'::jsonb);
insert into public.cohorts (id, name, programme_id)
  values ('c1000000-0000-0000-0000-00000000b5b5'::uuid, 'VC4', 'c1000000-0000-0000-0000-00000000a5a5'::uuid);
insert into public.cohort_requirement_dates
  (id, cohort_id, programme_id, module, ordinal, due_on, generation_method, materialized_via)
select ('c1000000-0000-0000-0000-0000000005' || lpad(n::text, 2, '0'))::uuid,
       'c1000000-0000-0000-0000-00000000b5b5'::uuid, 'c1000000-0000-0000-0000-00000000a5a5'::uuid,
       'coaching', n, current_date - 40 + (n * 10), 'manual', 'admin_save'
from generate_series(1, 4) n;
insert into public.cohort_coach_assignments (cohort_id, coach_id)
  values ('c1000000-0000-0000-0000-00000000b5b5'::uuid, 'c1000000-0000-0000-0000-000000000001'::uuid);
insert into public.programme_enrollments (id, programme_id, user_id, cohort_id, status) values
  ('c1000000-0000-0000-0000-00000000e5e5'::uuid, 'c1000000-0000-0000-0000-00000000a5a5'::uuid,
   'c1000000-0000-0000-0000-000000000005'::uuid, 'c1000000-0000-0000-0000-00000000b5b5'::uuid, 'active');
-- Booking requires an active goal (check_booking_eligibility, 20260926600000).
insert into public.coachee_goals (coachee_id, enrollment_id, title)
select e.user_id, e.id, 'Fixture goal'
from public.programme_enrollments e
where e.status in ('active', 'at_risk', 'paused')
  and not exists (select 1 from public.coachee_goals g where g.enrollment_id = e.id and g.status = 'active');

select set_config('request.jwt.claims',
  json_build_object('sub', 'c1000000-0000-0000-0000-000000000005')::text, true);

-- Three held sessions and one booked for the future.
insert into public.sessions
  (id, enrollment_id, cohort_requirement_id, coach_id, coachee_id, topic,
   start_time, duration_minutes, status, coachee_rating)
values
  ('c1000000-0000-0000-0000-0000000051c1'::uuid, 'c1000000-0000-0000-0000-00000000e5e5'::uuid,
   'c1000000-0000-0000-0000-000000000501'::uuid, 'c1000000-0000-0000-0000-000000000001'::uuid,
   'c1000000-0000-0000-0000-000000000005'::uuid, 'Fully written up',
   now() - interval '30 days', 60, 'completed', 5),
  ('c1000000-0000-0000-0000-0000000052c2'::uuid, 'c1000000-0000-0000-0000-00000000e5e5'::uuid,
   'c1000000-0000-0000-0000-000000000502'::uuid, 'c1000000-0000-0000-0000-000000000001'::uuid,
   'c1000000-0000-0000-0000-000000000005'::uuid, 'Reflection missing',
   now() - interval '20 days', 60, 'completed', 4),
  ('c1000000-0000-0000-0000-0000000053c3'::uuid, 'c1000000-0000-0000-0000-00000000e5e5'::uuid,
   'c1000000-0000-0000-0000-000000000503'::uuid, 'c1000000-0000-0000-0000-000000000001'::uuid,
   'c1000000-0000-0000-0000-000000000005'::uuid, 'Satisfaction missing',
   now() - interval '10 days', 60, 'completed', NULL),
  ('c1000000-0000-0000-0000-0000000054c4'::uuid, 'c1000000-0000-0000-0000-00000000e5e5'::uuid,
   'c1000000-0000-0000-0000-000000000504'::uuid, 'c1000000-0000-0000-0000-000000000001'::uuid,
   'c1000000-0000-0000-0000-000000000005'::uuid, 'Booked',
   now() + interval '10 days', 60, 'confirmed', NULL);

-- Session 1 is fully evidenced; session 3 has its reflection but no rating.
insert into public.session_learning_reflections (enrollment_id, source_activity_type, source_activity_id, body) values
  ('c1000000-0000-0000-0000-00000000e5e5'::uuid, 'coaching', 'c1000000-0000-0000-0000-0000000051c1'::uuid, 'Written up'),
  ('c1000000-0000-0000-0000-00000000e5e5'::uuid, 'coaching', 'c1000000-0000-0000-0000-0000000053c3'::uuid, 'Written up');
insert into public.enrollment_actions
  (enrollment_id, source_activity_type, source_activity_id, title, owner_user_id, goal_id, due_date)
select 'c1000000-0000-0000-0000-00000000e5e5'::uuid, 'coaching', s.id, 'Act', 'c1000000-0000-0000-0000-000000000005'::uuid,
       (select g.id from public.coachee_goals g
         where g.enrollment_id = 'c1000000-0000-0000-0000-00000000e5e5'::uuid and g.status = 'active' limit 1),
       current_date + 7
from unnest(array['c1000000-0000-0000-0000-0000000051c1'::uuid, 'c1000000-0000-0000-0000-0000000053c3'::uuid]) s(id);
-- The enrollment holds an active goal (required before booking), so a fully
-- written-up session also carries its goal check-in.
insert into public.goal_checkins (enrollment_id, goal_id, source_activity_type, source_activity_id, previous_rating, new_rating, actor_user_id)
select 'c1000000-0000-0000-0000-00000000e5e5'::uuid, g.id, 'coaching', 'c1000000-0000-0000-0000-0000000051c1'::uuid, null, 50,
       'c1000000-0000-0000-0000-000000000005'::uuid
from public.coachee_goals g
where g.enrollment_id = 'c1000000-0000-0000-0000-00000000e5e5'::uuid and g.status = 'active'
limit 1;

select is(
  (select completed_units from public.canonical_module_progress('c1000000-0000-0000-0000-00000000e5e5'::uuid, current_date)
    where module = 'coaching'),
  3, 'three held sessions are three completed units, whatever their write-up');

select is(
  (select booked_units from public.canonical_module_progress('c1000000-0000-0000-0000-00000000e5e5'::uuid, current_date)
    where module = 'coaching'),
  1, 'the future session counts as booked, never as completed');

select is(
  (select count(*)::int from public.coaching_session_evidence_bulk(ARRAY[
     'c1000000-0000-0000-0000-0000000051c1'::uuid,
     'c1000000-0000-0000-0000-0000000052c2'::uuid,
     'c1000000-0000-0000-0000-0000000053c3'::uuid]) where evidence_complete),
  1, 'evidence completeness is reported independently: only one session is fully written up');

select is(
  (select required_units from public.canonical_module_progress('c1000000-0000-0000-0000-00000000e5e5'::uuid, current_date)
    where module = 'coaching'),
  4, 'the denominator is the programme requirement, not the session count');

select * from finish();
rollback;
