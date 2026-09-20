-- Coaching canonical architecture contract (Coaching redesign).
--
-- Cohort VC schedules two Coaching requirements. Coach K is in the cohort
-- Coach pool; Coach X is not. Learners L1 and L2 are enrolled in VC.
--
-- Covers section 36: booking atomicity, requirement uniqueness, cohort Coach
-- eligibility, cancellation release, the separation of session completion from
-- unit completion, and each of the four evidence gates independently.
begin;

select plan(27);

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

insert into public.cohort_requirement_dates
  (id, cohort_id, programme_id, module, ordinal, due_on, generation_method, materialized_via) values
  ('c1000000-0000-0000-0000-00000000d1d1'::uuid, 'c1000000-0000-0000-0000-00000000b0b0'::uuid,
   'c1000000-0000-0000-0000-00000000a0a0'::uuid, 'coaching', 1, current_date + 30, 'manual', 'admin_save'),
  ('c1000000-0000-0000-0000-00000000d2d2'::uuid, 'c1000000-0000-0000-0000-00000000b0b0'::uuid,
   'c1000000-0000-0000-0000-00000000a0a0'::uuid, 'coaching', 2, current_date + 60, 'manual', 'admin_save');

-- Only Coach K is in the pool.
insert into public.cohort_coach_assignments (cohort_id, coach_id)
  values ('c1000000-0000-0000-0000-00000000b0b0'::uuid, 'c1000000-0000-0000-0000-000000000001'::uuid);

insert into public.coach_availability (id, coach_id, slot_date, start_time, end_time, slot_type) values
  ('c1000000-0000-0000-0000-00000000f1f1'::uuid, 'c1000000-0000-0000-0000-000000000001'::uuid,
   current_date + 7, '09:00', '10:00', 'coaching'),
  ('c1000000-0000-0000-0000-00000000f2f2'::uuid, 'c1000000-0000-0000-0000-000000000001'::uuid,
   current_date + 8, '09:00', '10:00', 'coaching');

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

select ok(
  not (select unit_complete from public.coaching_session_evidence('c1000000-0000-0000-0000-00000000c2c2'::uuid)),
  'a held session with no evidence does NOT complete the Coaching unit');

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
select ok(
  not (select unit_complete from public.coaching_session_evidence('c1000000-0000-0000-0000-00000000c2c2'::uuid)),
  'reflection alone does not complete the unit');

-- Gate 2: goal check-in
insert into public.goal_checkins
  (enrollment_id, goal_id, source_activity_type, source_activity_id, new_rating, actor_user_id)
  values ('c1000000-0000-0000-0000-00000000e1e1'::uuid, 'c1000000-0000-0000-0000-00000000b1b1'::uuid,
          'coaching', 'c1000000-0000-0000-0000-00000000c2c2'::uuid, 60,
          'c1000000-0000-0000-0000-000000000003'::uuid);
select ok(
  not (select unit_complete from public.coaching_session_evidence('c1000000-0000-0000-0000-00000000c2c2'::uuid)),
  'reflection + check-in does not complete the unit');

-- Gate 3: follow-up action
insert into public.enrollment_actions
  (enrollment_id, source_activity_type, source_activity_id, title, owner_user_id)
  values ('c1000000-0000-0000-0000-00000000e1e1'::uuid, 'coaching',
          'c1000000-0000-0000-0000-00000000c2c2'::uuid, 'Delegate the report',
          'c1000000-0000-0000-0000-000000000003'::uuid);
select ok(
  not (select unit_complete from public.coaching_session_evidence('c1000000-0000-0000-0000-00000000c2c2'::uuid)),
  'reflection + check-in + action does not complete the unit without satisfaction');

-- A Coach private note must never be a gate.
insert into public.coach_session_private_notes (session_id, coach_id, body)
  values ('c1000000-0000-0000-0000-00000000c2c2'::uuid, 'c1000000-0000-0000-0000-000000000001'::uuid, 'note');
select ok(
  not (select unit_complete from public.coaching_session_evidence('c1000000-0000-0000-0000-00000000c2c2'::uuid)),
  'a Coach private note does not complete the unit');

-- Gate 4: satisfaction
update public.sessions set coachee_rating = 5, coachee_rated_at = now()
  where id = 'c1000000-0000-0000-0000-00000000c2c2'::uuid;
select ok(
  (select unit_complete from public.coaching_session_evidence('c1000000-0000-0000-0000-00000000c2c2'::uuid)),
  'all four evidence gates present completes the Coaching unit');

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

select * from finish();
rollback;
