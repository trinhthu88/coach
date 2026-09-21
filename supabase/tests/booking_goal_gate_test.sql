-- Booking goal gate contract (20260925400000_booking_goal_gate).
--
-- Day 1 = coalesce(cohort.start_date, enrollment.start_date). Days 1-7 are the
-- grace period; from day 8 (current_date >= start + 7) a learner with no
-- active goal on the enrollment cannot book Coaching, Peer, Mentoring or
-- Triads. Max 3 active goals; after grace the learner cannot retire their
-- last active goal.
--
-- Cohort GC (no start_date, so each enrollment's own start_date is day 1):
--   L1  start = today - 6  (day 7: grace, no goal)
--   L2  start = today - 7  (day 8: blocked until a goal exists)
--   L3  start = today - 7  (day 8: blocked, never gets a goal)
--   L4  start = today - 30 (goal min/max)
-- Cohort GD (start_date = today - 30, another programme):
--   L5  start = today      (the cohort date wins over the enrollment date)
begin;

select plan(32);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_user_meta_data, created_at, updated_at, confirmation_token, email_change_token_new, recovery_token)
select ('b9a10000-0000-0000-0000-0000000000' || lpad(n::text, 2, '0'))::uuid, '00000000-0000-0000-0000-000000000000'::uuid,
  'authenticated', 'authenticated', 'goal-gate-' || n || '@example.test', 'test', now(),
  jsonb_build_object('full_name', 'Goal Gate Person ' || n), now(), now(), '', '', ''
from generate_series(1, 7) n;
-- 01=Coach K  02=Admin  03=L1  04=L2  05=L3  06=L4  07=L5

insert into public.user_roles (user_id, role) values
  ('b9a10000-0000-0000-0000-000000000001', 'coach'),
  ('b9a10000-0000-0000-0000-000000000002', 'admin'),
  ('b9a10000-0000-0000-0000-000000000003', 'coachee'),
  ('b9a10000-0000-0000-0000-000000000004', 'coachee'),
  ('b9a10000-0000-0000-0000-000000000005', 'coachee'),
  ('b9a10000-0000-0000-0000-000000000006', 'coachee'),
  ('b9a10000-0000-0000-0000-000000000007', 'coachee')
on conflict do nothing;

insert into public.programmes (id, name) values
  ('b9a10000-0000-0000-0000-00000000a0a0'::uuid, 'Goal Gate Programme'),
  ('b9a10000-0000-0000-0000-00000000a0a1'::uuid, 'Goal Gate Dated Programme');
insert into public.cohorts (id, name, programme_id) values
  ('b9a10000-0000-0000-0000-00000000b0b0'::uuid, 'GC', 'b9a10000-0000-0000-0000-00000000a0a0'::uuid);
insert into public.cohorts (id, name, programme_id, start_date) values
  ('b9a10000-0000-0000-0000-00000000b0b1'::uuid, 'GD', 'b9a10000-0000-0000-0000-00000000a0a1'::uuid, current_date - 30);
insert into public.programme_modules (programme_id, module, enabled, config) values
  ('b9a10000-0000-0000-0000-00000000a0a0'::uuid, 'coaching', true, '{"required": true, "required_units": 2}'::jsonb),
  ('b9a10000-0000-0000-0000-00000000a0a0'::uuid, 'triads', true, '{"required": true, "required_units": 1}'::jsonb);

insert into public.programme_enrollments (id, programme_id, user_id, cohort_id, status, start_date) values
  ('b9a10000-0000-0000-0000-0000000000e1'::uuid, 'b9a10000-0000-0000-0000-00000000a0a0'::uuid,
   'b9a10000-0000-0000-0000-000000000003'::uuid, 'b9a10000-0000-0000-0000-00000000b0b0'::uuid, 'active', current_date - 6),
  ('b9a10000-0000-0000-0000-0000000000e2'::uuid, 'b9a10000-0000-0000-0000-00000000a0a0'::uuid,
   'b9a10000-0000-0000-0000-000000000004'::uuid, 'b9a10000-0000-0000-0000-00000000b0b0'::uuid, 'active', current_date - 7),
  ('b9a10000-0000-0000-0000-0000000000e3'::uuid, 'b9a10000-0000-0000-0000-00000000a0a0'::uuid,
   'b9a10000-0000-0000-0000-000000000005'::uuid, 'b9a10000-0000-0000-0000-00000000b0b0'::uuid, 'active', current_date - 7),
  ('b9a10000-0000-0000-0000-0000000000e4'::uuid, 'b9a10000-0000-0000-0000-00000000a0a0'::uuid,
   'b9a10000-0000-0000-0000-000000000006'::uuid, 'b9a10000-0000-0000-0000-00000000b0b0'::uuid, 'active', current_date - 30),
  ('b9a10000-0000-0000-0000-0000000000e5'::uuid, 'b9a10000-0000-0000-0000-00000000a0a1'::uuid,
   'b9a10000-0000-0000-0000-000000000007'::uuid, 'b9a10000-0000-0000-0000-00000000b0b1'::uuid, 'active', current_date);

insert into public.cohort_requirement_dates
  (id, cohort_id, programme_id, module, ordinal, due_on, generation_method, materialized_via) values
  ('b9a10000-0000-0000-0000-00000000d1d1'::uuid, 'b9a10000-0000-0000-0000-00000000b0b0'::uuid,
   'b9a10000-0000-0000-0000-00000000a0a0'::uuid, 'coaching', 1, current_date + 30, 'manual', 'admin_save'),
  ('b9a10000-0000-0000-0000-00000000d2d2'::uuid, 'b9a10000-0000-0000-0000-00000000b0b0'::uuid,
   'b9a10000-0000-0000-0000-00000000a0a0'::uuid, 'coaching', 2, current_date + 60, 'manual', 'admin_save'),
  ('b9a10000-0000-0000-0000-00000000d3d3'::uuid, 'b9a10000-0000-0000-0000-00000000b0b0'::uuid,
   'b9a10000-0000-0000-0000-00000000a0a0'::uuid, 'triads', 1, current_date + 60, 'manual', 'admin_save');

insert into public.cohort_coach_assignments (cohort_id, coach_id)
  values ('b9a10000-0000-0000-0000-00000000b0b0'::uuid, 'b9a10000-0000-0000-0000-000000000001'::uuid);

insert into public.coach_availability (id, coach_id, slot_date, start_time, end_time, slot_type) values
  ('b9a10000-0000-0000-0000-00000000f1f1'::uuid, 'b9a10000-0000-0000-0000-000000000001'::uuid,
   current_date + 7, '09:00', '10:00', 'coaching'),
  ('b9a10000-0000-0000-0000-00000000f2f2'::uuid, 'b9a10000-0000-0000-0000-000000000001'::uuid,
   current_date + 8, '09:00', '10:00', 'coaching'),
  ('b9a10000-0000-0000-0000-00000000f3f3'::uuid, 'b9a10000-0000-0000-0000-000000000001'::uuid,
   current_date + 9, '09:00', '10:00', 'coaching'),
  ('b9a10000-0000-0000-0000-00000000f4f4'::uuid, 'b9a10000-0000-0000-0000-000000000001'::uuid,
   current_date + 10, '09:00', '10:00', 'coaching');

-- A Triad group of L3 (blocked) and L1 (grace), with an open session.
insert into public.triad_groups (id, cohort_requirement_date_id)
  values ('b9a10000-0000-0000-0000-00000000c0c0'::uuid, 'b9a10000-0000-0000-0000-00000000d3d3'::uuid);
insert into public.triad_group_members (triad_group_id, enrollment_id, member_order) values
  ('b9a10000-0000-0000-0000-00000000c0c0'::uuid, 'b9a10000-0000-0000-0000-0000000000e3'::uuid, 1),
  ('b9a10000-0000-0000-0000-00000000c0c0'::uuid, 'b9a10000-0000-0000-0000-0000000000e1'::uuid, 2);
insert into public.triad_sessions (id, triad_group_id, scheduled_start_time, scheduled_end_time, status)
  values ('b9a10000-0000-0000-0000-00000000c0c1'::uuid, 'b9a10000-0000-0000-0000-00000000c0c0'::uuid,
          now() + interval '5 days', now() + interval '5 days 1 hour', 'proposed');

-- ---------------------------------------------------------------------------
-- 1. The gate state and the day-N boundary
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims',
  json_build_object('sub', 'b9a10000-0000-0000-0000-000000000003')::text, true);

select is((public.enrollment_goal_gate('b9a10000-0000-0000-0000-0000000000e1'::uuid)->>'blocked')::boolean,
  false, 'day 7 (start = today - 6) with no goal: booking is open');
select is((public.enrollment_goal_gate('b9a10000-0000-0000-0000-0000000000e1'::uuid)->>'in_grace_period')::boolean,
  true, 'day 7 is inside the grace period');
select is((public.enrollment_goal_gate('b9a10000-0000-0000-0000-0000000000e1'::uuid)->>'grace_ends_on')::date,
  current_date, 'grace_ends_on is day 7 (start + 6)');
select is((public.enrollment_goal_gate('b9a10000-0000-0000-0000-0000000000e1'::uuid)->>'blocked_from')::date,
  current_date + 1, 'blocked_from is day 8 (start + 7)');

select throws_ok($$select public.enrollment_goal_gate('b9a10000-0000-0000-0000-0000000000e2'::uuid)$$,
  '42501', NULL, 'a learner cannot read another learner''s gate');

select set_config('request.jwt.claims',
  json_build_object('sub', 'b9a10000-0000-0000-0000-000000000004')::text, true);
select is((public.enrollment_goal_gate('b9a10000-0000-0000-0000-0000000000e2'::uuid)->>'blocked')::boolean,
  true, 'day 8 (start = today - 7) with no goal: booking is blocked');
select is(public.enrollment_goal_gate('b9a10000-0000-0000-0000-0000000000e2'::uuid)->>'reason',
  'goal_required_before_booking', 'the blocked reason is machine-readable');
select is((public.enrollment_goal_gate('b9a10000-0000-0000-0000-0000000000e2'::uuid)->>'active_goal_count')::int,
  0, 'the gate reports the active goal count');

select set_config('request.jwt.claims',
  json_build_object('sub', 'b9a10000-0000-0000-0000-000000000007')::text, true);
select is((public.enrollment_goal_gate('b9a10000-0000-0000-0000-0000000000e5'::uuid)->>'gate_starts_on')::date,
  current_date - 30, 'day 1 is the cohort start_date when the cohort has one');
select is((public.enrollment_goal_gate('b9a10000-0000-0000-0000-0000000000e5'::uuid)->>'blocked')::boolean,
  true, 'so a learner enrolled today into an old cohort is already past grace');

select set_config('request.jwt.claims',
  json_build_object('sub', 'b9a10000-0000-0000-0000-000000000002')::text, true);
select is((public.enrollment_goal_gate('b9a10000-0000-0000-0000-0000000000e2'::uuid)->>'blocked')::boolean,
  true, 'an Admin can read any enrollment''s gate');

-- ---------------------------------------------------------------------------
-- 2. Grace period: Coaching books without a goal
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims',
  json_build_object('sub', 'b9a10000-0000-0000-0000-000000000003')::text, true);
select lives_ok($$
  select public.book_coaching_session(
    'b9a10000-0000-0000-0000-0000000000e1'::uuid, 'b9a10000-0000-0000-0000-000000000001'::uuid,
    'b9a10000-0000-0000-0000-00000000f1f1'::uuid, 'b9a10000-0000-0000-0000-00000000d1d1'::uuid, 'Grace booking')
$$, 'day <= 7 with no goal: Coaching booking succeeds');

-- ---------------------------------------------------------------------------
-- 3. Day >= 8 with no goal: every booking path raises the gate error
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims',
  json_build_object('sub', 'b9a10000-0000-0000-0000-000000000004')::text, true);
select throws_ok($$
  select public.book_coaching_session(
    'b9a10000-0000-0000-0000-0000000000e2'::uuid, 'b9a10000-0000-0000-0000-000000000001'::uuid,
    'b9a10000-0000-0000-0000-00000000f2f2'::uuid, 'b9a10000-0000-0000-0000-00000000d1d1'::uuid, 'Blocked')
$$, 'P0001', 'goal_required_before_booking', 'Coaching: book_coaching_session is gated');

select set_config('request.jwt.claims',
  json_build_object('sub', 'b9a10000-0000-0000-0000-000000000005')::text, true);
select throws_ok($$
  insert into public.sessions
    (enrollment_id, cohort_requirement_id, coach_id, coachee_id, slot_id, topic,
     start_time, duration_minutes, status)
  values ('b9a10000-0000-0000-0000-0000000000e3'::uuid, 'b9a10000-0000-0000-0000-00000000d1d1'::uuid,
          'b9a10000-0000-0000-0000-000000000001'::uuid, 'b9a10000-0000-0000-0000-000000000005'::uuid,
          'b9a10000-0000-0000-0000-00000000f4f4'::uuid, 'Direct',
          (current_date + 10 + time '09:00') at time zone 'UTC', 60, 'pending_coach_approval')
$$, 'P0001', 'goal_required_before_booking', 'Coaching: a learner''s direct INSERT hits the same gate');

select throws_ok($$
  select public.book_mentoring_session(
    'b9a10000-0000-0000-0000-0000000000e3'::uuid, 'b9a10000-0000-0000-0000-000000000001'::uuid,
    gen_random_uuid(), 'Blocked mentoring')
$$, 'P0001', 'goal_required_before_booking', 'Mentoring: book_mentoring_session is gated');

select throws_ok($$
  select public.book_coachee_peer_session(
    'b9a10000-0000-0000-0000-000000000003'::uuid, 'b9a10000-0000-0000-0000-0000000000e3'::uuid,
    'Blocked peer', now() + interval '3 days', 45, null)
$$, 'P0001', 'goal_required_before_booking', 'Peer: book_coachee_peer_session is gated for the receiver');

select throws_ok($$
  select public.book_peer_session(
    'b9a10000-0000-0000-0000-000000000001'::uuid, 'b9a10000-0000-0000-0000-0000000000e3'::uuid,
    'Blocked coach peer', now() + interval '3 days', 45, null)
$$, 'P0001', 'goal_required_before_booking', 'Peer (coach-to-coach): book_peer_session is gated');

select throws_ok($$
  select public.learner_triad_schedule_session('b9a10000-0000-0000-0000-00000000c0c0'::uuid,
    now() + interval '6 days', now() + interval '6 days 1 hour')
$$, 'P0001', 'goal_required_before_booking', 'Triads: learner_triad_schedule_session is gated');

select throws_ok($$
  select public.learner_triad_propose_alternative('b9a10000-0000-0000-0000-00000000c0c1'::uuid,
    now() + interval '7 days', now() + interval '7 days 1 hour')
$$, 'P0001', 'goal_required_before_booking', 'Triads: learner_triad_propose_alternative is gated');

-- ---------------------------------------------------------------------------
-- 4. With an active goal, booking succeeds; reschedule is not a new booking
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims',
  json_build_object('sub', 'b9a10000-0000-0000-0000-000000000004')::text, true);
select lives_ok($$
  insert into public.coachee_goals (id, coachee_id, enrollment_id, title)
  values ('b9a10000-0000-0000-0000-00000000a201'::uuid, 'b9a10000-0000-0000-0000-000000000004'::uuid,
          'b9a10000-0000-0000-0000-0000000000e2'::uuid, 'Lead with questions')
$$, 'the learner can create a goal at any time');
select is((public.enrollment_goal_gate('b9a10000-0000-0000-0000-0000000000e2'::uuid)->>'blocked')::boolean,
  false, 'one active goal opens the gate');
select lives_ok($$
  select public.book_coaching_session(
    'b9a10000-0000-0000-0000-0000000000e2'::uuid, 'b9a10000-0000-0000-0000-000000000001'::uuid,
    'b9a10000-0000-0000-0000-00000000f2f2'::uuid, 'b9a10000-0000-0000-0000-00000000d1d1'::uuid, 'With goal')
$$, 'day >= 8 with an active goal: Coaching booking succeeds');

-- An Admin retires the goal (Admins are exempt from the minimum rule).
select set_config('request.jwt.claims',
  json_build_object('sub', 'b9a10000-0000-0000-0000-000000000002')::text, true);
select lives_ok($$
  update public.coachee_goals set status = 'archived' where id = 'b9a10000-0000-0000-0000-00000000a201'::uuid
$$, 'an Admin may archive a learner''s last goal');

select set_config('request.jwt.claims',
  json_build_object('sub', 'b9a10000-0000-0000-0000-000000000004')::text, true);
select throws_ok($$
  select public.book_coaching_session(
    'b9a10000-0000-0000-0000-0000000000e2'::uuid, 'b9a10000-0000-0000-0000-000000000001'::uuid,
    'b9a10000-0000-0000-0000-00000000f4f4'::uuid, 'b9a10000-0000-0000-0000-00000000d2d2'::uuid, 'New without goal')
$$, 'P0001', 'goal_required_before_booking', 'without a goal again, a NEW booking is refused');
select lives_ok($$
  select public.reschedule_coaching_session(
    (select id from public.sessions
      where enrollment_id = 'b9a10000-0000-0000-0000-0000000000e2'::uuid
        and status = 'pending_coach_approval'),
    'b9a10000-0000-0000-0000-00000000f3f3'::uuid, 'Moved')
$$, 'a reschedule is exempt: it moves an existing booking');
select is(
  (select count(*)::int from public.sessions
    where enrollment_id = 'b9a10000-0000-0000-0000-0000000000e2'::uuid
      and status = 'pending_coach_approval'
      and slot_id = 'b9a10000-0000-0000-0000-00000000f3f3'::uuid),
  1, 'the rescheduled booking lives on the new slot');

-- ---------------------------------------------------------------------------
-- 5. Max 3 / min 1 active goals
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims',
  json_build_object('sub', 'b9a10000-0000-0000-0000-000000000006')::text, true);
insert into public.coachee_goals (id, coachee_id, enrollment_id, title) values
  ('b9a10000-0000-0000-0000-00000000a401'::uuid, 'b9a10000-0000-0000-0000-000000000006'::uuid, 'b9a10000-0000-0000-0000-0000000000e4'::uuid, 'Goal one'),
  ('b9a10000-0000-0000-0000-00000000a402'::uuid, 'b9a10000-0000-0000-0000-000000000006'::uuid, 'b9a10000-0000-0000-0000-0000000000e4'::uuid, 'Goal two'),
  ('b9a10000-0000-0000-0000-00000000a403'::uuid, 'b9a10000-0000-0000-0000-000000000006'::uuid, 'b9a10000-0000-0000-0000-0000000000e4'::uuid, 'Goal three');

select throws_ok($$
  insert into public.coachee_goals (coachee_id, enrollment_id, title)
  values ('b9a10000-0000-0000-0000-000000000006'::uuid, 'b9a10000-0000-0000-0000-0000000000e4'::uuid, 'Goal four')
$$, 'P0001', 'This enrollment already has the maximum of 3 active goals', 'a 4th active goal is rejected');

select lives_ok($$
  update public.coachee_goals set status = 'archived'
   where id in ('b9a10000-0000-0000-0000-00000000a401'::uuid, 'b9a10000-0000-0000-0000-00000000a402'::uuid)
$$, 'archiving goals that are not the last active one is allowed');

select lives_ok($$
  update public.coachee_goals set title = 'Goal three, sharper', description = 'Edited'
   where id = 'b9a10000-0000-0000-0000-00000000a403'::uuid
$$, 'the learner can edit their last active goal');

select throws_ok($$
  update public.coachee_goals set status = 'archived' where id = 'b9a10000-0000-0000-0000-00000000a403'::uuid
$$, 'P0001', 'last_active_goal_required', 'after grace the learner cannot archive their last active goal');

select throws_ok($$
  delete from public.coachee_goals where id = 'b9a10000-0000-0000-0000-00000000a403'::uuid
$$, 'P0001', 'last_active_goal_required', 'nor delete it');

-- Inside the grace period the minimum does not apply yet.
select set_config('request.jwt.claims',
  json_build_object('sub', 'b9a10000-0000-0000-0000-000000000003')::text, true);
insert into public.coachee_goals (id, coachee_id, enrollment_id, title)
values ('b9a10000-0000-0000-0000-00000000a101'::uuid, 'b9a10000-0000-0000-0000-000000000003'::uuid,
        'b9a10000-0000-0000-0000-0000000000e1'::uuid, 'Early goal');
select lives_ok($$
  update public.coachee_goals set status = 'archived' where id = 'b9a10000-0000-0000-0000-00000000a101'::uuid
$$, 'during grace the learner may archive their only goal');

select * from finish();
rollback;
