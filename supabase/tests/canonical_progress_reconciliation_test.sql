-- Cross-user canonical reconciliation.
--
-- THE source-of-truth property, asserted rather than assumed: for one
-- enrollment and one p_as_of, Admin, Sponsor, Learner and the shared spine
-- report the SAME numbers for every module. Privacy may remove narrative and
-- detail; it must never change a number.
--
-- Each role reaches progress by a different route:
--
--   spine     canonical_module_progress -> canonical_enrollment_progress
--   Learner   learner_canonical_progress(enrollment)
--   Admin     admin_canonical_enrollment_progress(enrollment[])
--   Sponsor   sponsor_canonical_enrollment_progress(cohort)
--
-- A regression in any wrapper -- a re-derived denominator, a re-counted
-- activity union, a role-specific filter applied to the wrong side -- shows up
-- here as a row that differs from the spine.
--
-- The fixture deliberately carries non-trivial numbers in every module:
-- Coaching has a held session AND a future booking, Mentoring has a held
-- session, Peer has a held dyad session AND a practice session that must not
-- count, and Triads are required with one deadline already past and nothing
-- fulfilled, so due/overdue are non-zero. A test where every number is 0 would
-- pass even if the wrappers disagreed about how to compute them.
--
-- A Coach enrolled as a learner (Coach K, enrollment E6) is reconciled the
-- same way: one person holding both roles is still ONE enrollment row, and
-- the Peer practice K gives from the Coach opt-in pool never becomes K's own
-- Peer progress (20261005140000).
begin;

select plan(21);

-- The cohort carries five enrolled learners of the sponsor's organisation
-- (sponsor visibility: enrollment organisation = sponsor organisation).
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_user_meta_data, created_at, updated_at, confirmation_token, email_change_token_new, recovery_token)
select ('e1000000-0000-0000-0000-00000000000' || n)::uuid, '00000000-0000-0000-0000-000000000000'::uuid,
  'authenticated', 'authenticated', 'reconcile-' || n || '@example.test', 'test', now(),
  jsonb_build_object('full_name', 'Reconcile Person ' || n), now(), now(), '', '', ''
from generate_series(1, 8) n;
-- 1=Coach K (also enrolled as a learner)  2=Mentor M (also a cohort Coach)
-- 3..7=Learners L1..L5  8=Sponsor

-- The Mentor is a Coach with a cohort Mentoring assignment, so user 2 holds
-- the Coach role too (20260921200000). There is no separate Mentor role.
insert into public.user_roles (user_id, role) values
  ('e1000000-0000-0000-0000-000000000001', 'coach'),
  ('e1000000-0000-0000-0000-000000000002', 'coach'),
  ('e1000000-0000-0000-0000-000000000003', 'coachee'),
  ('e1000000-0000-0000-0000-000000000004', 'coachee'),
  ('e1000000-0000-0000-0000-000000000005', 'coachee'),
  ('e1000000-0000-0000-0000-000000000006', 'coachee'),
  ('e1000000-0000-0000-0000-000000000007', 'coachee'),
  ('e1000000-0000-0000-0000-000000000008', 'sponsor')
on conflict do nothing;

update public.profiles set status = 'active'::public.user_status where id::text like 'e1000000-%';

insert into public.mentor_profiles (coach_user_id, is_active)
  values ('e1000000-0000-0000-0000-000000000002'::uuid, true);

insert into public.organizations (id, name)
  values ('e1000000-0000-0000-0000-00000000aaaa'::uuid, 'Reconciliation Org');
insert into public.sponsor_profiles (user_id, organization_id)
  values ('e1000000-0000-0000-0000-000000000008'::uuid, 'e1000000-0000-0000-0000-00000000aaaa'::uuid);

-- Programme owns HOW MANY for every module.
insert into public.programmes (id, name)
  values ('e1000000-0000-0000-0000-00000000a0a0'::uuid, 'Reconciliation Programme');
insert into public.programme_modules (programme_id, module, enabled, config) values
  ('e1000000-0000-0000-0000-00000000a0a0'::uuid, 'coaching',  true, '{"required": true, "required_units": 3}'::jsonb),
  ('e1000000-0000-0000-0000-00000000a0a0'::uuid, 'mentoring', true, '{"required": true, "required_units": 2}'::jsonb),
  ('e1000000-0000-0000-0000-00000000a0a0'::uuid, 'peer_coaching', true, '{"required": true, "required_units": 2}'::jsonb),
  ('e1000000-0000-0000-0000-00000000a0a0'::uuid, 'triads',    true, '{"required": true, "required_units": 2}'::jsonb);

insert into public.cohorts (id, name, programme_id, organization_id)
  values ('e1000000-0000-0000-0000-00000000b0b0'::uuid, 'Reconcile Cohort',
          'e1000000-0000-0000-0000-00000000a0a0'::uuid, 'e1000000-0000-0000-0000-00000000aaaa'::uuid);

-- Cohort owns WHEN. Coaching 1, Mentoring 1, Triad 1 and both Peer units are
-- already due.
insert into public.cohort_requirement_dates
  (id, cohort_id, programme_id, module, ordinal, due_on, generation_method, materialized_via) values
  ('e1000000-0000-0000-0000-0000000000c1'::uuid, 'e1000000-0000-0000-0000-00000000b0b0'::uuid,
   'e1000000-0000-0000-0000-00000000a0a0'::uuid, 'coaching', 1, current_date - 20, 'manual', 'admin_save'),
  ('e1000000-0000-0000-0000-0000000000c2'::uuid, 'e1000000-0000-0000-0000-00000000b0b0'::uuid,
   'e1000000-0000-0000-0000-00000000a0a0'::uuid, 'coaching', 2, current_date + 20, 'manual', 'admin_save'),
  ('e1000000-0000-0000-0000-0000000000c3'::uuid, 'e1000000-0000-0000-0000-00000000b0b0'::uuid,
   'e1000000-0000-0000-0000-00000000a0a0'::uuid, 'coaching', 3, current_date + 40, 'manual', 'admin_save'),
  ('e1000000-0000-0000-0000-0000000000d1'::uuid, 'e1000000-0000-0000-0000-00000000b0b0'::uuid,
   'e1000000-0000-0000-0000-00000000a0a0'::uuid, 'mentoring', 1, current_date - 10, 'manual', 'admin_save'),
  ('e1000000-0000-0000-0000-0000000000d2'::uuid, 'e1000000-0000-0000-0000-00000000b0b0'::uuid,
   'e1000000-0000-0000-0000-00000000a0a0'::uuid, 'mentoring', 2, current_date + 30, 'manual', 'admin_save'),
  ('e1000000-0000-0000-0000-0000000000a5'::uuid, 'e1000000-0000-0000-0000-00000000b0b0'::uuid,
   'e1000000-0000-0000-0000-00000000a0a0'::uuid, 'peer_coaching', 1, current_date - 2, 'manual', 'admin_save'),
  ('e1000000-0000-0000-0000-0000000000a6'::uuid, 'e1000000-0000-0000-0000-00000000b0b0'::uuid,
   'e1000000-0000-0000-0000-00000000a0a0'::uuid, 'peer_coaching', 2, current_date - 1, 'manual', 'admin_save'),
  ('e1000000-0000-0000-0000-0000000000f1'::uuid, 'e1000000-0000-0000-0000-00000000b0b0'::uuid,
   'e1000000-0000-0000-0000-00000000a0a0'::uuid, 'triads', 1, current_date - 5, 'manual', 'admin_save'),
  ('e1000000-0000-0000-0000-0000000000f2'::uuid, 'e1000000-0000-0000-0000-00000000b0b0'::uuid,
   'e1000000-0000-0000-0000-00000000a0a0'::uuid, 'triads', 2, current_date + 50, 'manual', 'admin_save');

insert into public.cohort_coach_assignments (cohort_id, coach_id) values
  ('e1000000-0000-0000-0000-00000000b0b0'::uuid, 'e1000000-0000-0000-0000-000000000001'::uuid),
  ('e1000000-0000-0000-0000-00000000b0b0'::uuid, 'e1000000-0000-0000-0000-000000000002'::uuid);
-- Coach K gives Peer practice from the Coach opt-in pool.
insert into public.coach_profiles (id, approval_status, peer_coaching_opt_in)
  values ('e1000000-0000-0000-0000-000000000001'::uuid, 'active', true)
  on conflict (id) do update set approval_status = 'active', peer_coaching_opt_in = true;
insert into public.cohort_mentors (cohort_id, mentor_user_id)
  values ('e1000000-0000-0000-0000-00000000b0b0'::uuid, 'e1000000-0000-0000-0000-000000000002'::uuid);

-- Sponsor visibility is the ENROLLMENT organisation, so each enrollment
-- carries the sponsor's organisation.
insert into public.programme_enrollments (id, programme_id, user_id, cohort_id, organization_id, status)
select ('e1000000-0000-0000-0000-0000000000e' || n)::uuid,
       'e1000000-0000-0000-0000-00000000a0a0'::uuid,
       ('e1000000-0000-0000-0000-00000000000' || (n + 2))::uuid,
       'e1000000-0000-0000-0000-00000000b0b0'::uuid,
       'e1000000-0000-0000-0000-00000000aaaa'::uuid, 'active'
from generate_series(1, 5) n;
-- Coach K enrolled as a learner in the same cohort (E6), since a month ago:
-- the practice K gives below falls inside E6, so K's half of it is filed
-- under E6 (only_enrollment_candidate) -- and must still earn nothing.
insert into public.programme_enrollments (id, programme_id, user_id, cohort_id, organization_id, status, start_date)
values ('e1000000-0000-0000-0000-0000000000e6'::uuid, 'e1000000-0000-0000-0000-00000000a0a0'::uuid,
        'e1000000-0000-0000-0000-000000000001'::uuid, 'e1000000-0000-0000-0000-00000000b0b0'::uuid,
        'e1000000-0000-0000-0000-00000000aaaa'::uuid, 'active', current_date - 30);

-- L1's activity: one Coaching session held, one booked for the future, and one
-- Mentoring session held. Triads are required and untouched.
select set_config('request.jwt.claims',
  json_build_object('sub', 'e1000000-0000-0000-0000-000000000003')::text, true);

-- Booking requires an active goal (check_booking_eligibility, 20260926600000):
-- give every ongoing fixture enrollment without one a goal before it books.
insert into public.coachee_goals (coachee_id, enrollment_id, title)
select e.user_id, e.id, 'Fixture goal'
from public.programme_enrollments e
where e.status in ('active', 'at_risk', 'paused')
  and not exists (select 1 from public.coachee_goals g where g.enrollment_id = e.id and g.status = 'active');
insert into public.sessions
  (id, enrollment_id, cohort_requirement_id, coach_id, coachee_id, topic,
   start_time, duration_minutes, status) values
  ('e1000000-0000-0000-0000-0000000000a1'::uuid, 'e1000000-0000-0000-0000-0000000000e1'::uuid,
   'e1000000-0000-0000-0000-0000000000c1'::uuid, 'e1000000-0000-0000-0000-000000000001'::uuid,
   'e1000000-0000-0000-0000-000000000003'::uuid, 'Held', now() - interval '15 days', 60, 'completed'),
  ('e1000000-0000-0000-0000-0000000000a2'::uuid, 'e1000000-0000-0000-0000-0000000000e1'::uuid,
   'e1000000-0000-0000-0000-0000000000c2'::uuid, 'e1000000-0000-0000-0000-000000000001'::uuid,
   'e1000000-0000-0000-0000-000000000003'::uuid, 'Booked', now() + interval '15 days', 60, 'confirmed');

insert into public.mentoring_sessions
  (id, enrollment_id, cohort_requirement_id, mentor_id, mentee_id, topic,
   start_time, duration_minutes, status)
values ('e1000000-0000-0000-0000-0000000000b1'::uuid, 'e1000000-0000-0000-0000-0000000000e1'::uuid,
        'e1000000-0000-0000-0000-0000000000d1'::uuid, 'e1000000-0000-0000-0000-000000000002'::uuid,
        'e1000000-0000-0000-0000-000000000003'::uuid, 'Held', now() - interval '8 days', 60, 'confirmed');
-- Lifecycle transitions go through the canonical writer; a direct UPDATE is
-- refused by guard_session_protected_fields(). The mentor is the actor.
select set_config('request.jwt.claims',
  json_build_object('sub', 'e1000000-0000-0000-0000-000000000002')::text, true);
select public.transition_mentoring_session_status(
  'e1000000-0000-0000-0000-0000000000b1'::uuid, 'completed');
select set_config('request.jwt.claims',
  json_build_object('sub', 'e1000000-0000-0000-0000-000000000003')::text, true);

-- Peer. L1 and L2 are an Admin-assigned dyad; one session between them is
-- held. L1 also receives a practice session from Coach K's opt-in pool --
-- practice, so it fulfils nothing for L1 and nothing for K's own enrollment
-- (K gives it, and K's only enrollment is E6).
insert into public.peer_dyads (id, cohort_id, programme_id, created_by)
  values ('e1000000-0000-0000-0000-0000000000dd'::uuid, 'e1000000-0000-0000-0000-00000000b0b0'::uuid,
          'e1000000-0000-0000-0000-00000000a0a0'::uuid, 'e1000000-0000-0000-0000-000000000008'::uuid);
insert into public.peer_dyad_members (dyad_id, enrollment_id) values
  ('e1000000-0000-0000-0000-0000000000dd'::uuid, 'e1000000-0000-0000-0000-0000000000e1'::uuid),
  ('e1000000-0000-0000-0000-0000000000dd'::uuid, 'e1000000-0000-0000-0000-0000000000e2'::uuid);
insert into public.coachee_peer_sessions
  (id, peer_provider_id, peer_receiver_id, topic, start_time, duration_minutes, status, enrollment_id)
values ('e1000000-0000-0000-0000-0000000000a7'::uuid, 'e1000000-0000-0000-0000-000000000004'::uuid,
        'e1000000-0000-0000-0000-000000000003'::uuid, 'Dyad', now() - interval '1 day', 45, 'completed',
        'e1000000-0000-0000-0000-0000000000e1'::uuid);
insert into public.peer_sessions
  (id, peer_coach_id, peer_coachee_id, topic, start_time, duration_minutes, status, enrollment_id)
values ('e1000000-0000-0000-0000-0000000000a8'::uuid, 'e1000000-0000-0000-0000-000000000001'::uuid,
        'e1000000-0000-0000-0000-000000000003'::uuid, 'Practice', now() - interval '3 days', 45, 'completed',
        'e1000000-0000-0000-0000-0000000000e1'::uuid);

-- Coach K as a learner: one Coaching session held with Mentor M, who is also
-- a cohort Coach. Trusted fixture history, written as the lifecycle service.
select set_config('app.session_transition', 'on', true);
insert into public.sessions
  (id, enrollment_id, cohort_requirement_id, coach_id, coachee_id, topic,
   start_time, duration_minutes, status) values
  ('e1000000-0000-0000-0000-0000000000a9'::uuid, 'e1000000-0000-0000-0000-0000000000e6'::uuid,
   'e1000000-0000-0000-0000-0000000000c1'::uuid, 'e1000000-0000-0000-0000-000000000002'::uuid,
   'e1000000-0000-0000-0000-000000000001'::uuid, 'Coach as learner', now() - interval '12 days', 60, 'completed');
select set_config('app.session_transition', 'off', true);

-- ---------------------------------------------------------------------------
-- The numbers themselves, so a silent "everything is 0" cannot pass
-- ---------------------------------------------------------------------------
select is(
  (select array[required_units, completed_units, booked_units]
     from public.canonical_module_progress('e1000000-0000-0000-0000-0000000000e1'::uuid, current_date)
    where module = 'coaching'),
  array[3, 1, 1], 'Coaching: one held session completed, one future session booked, three required');

select is(
  (select array[required_units, completed_units]
     from public.canonical_module_progress('e1000000-0000-0000-0000-0000000000e1'::uuid, current_date)
    where module = 'mentoring'),
  array[2, 1], 'Mentoring: the held session is a completed unit');

select is(
  (select array[required_units, completed_units, due_units, overdue_units]
     from public.canonical_module_progress('e1000000-0000-0000-0000-0000000000e1'::uuid, current_date)
    where module = 'triads'),
  array[2, 0, 1, 1], 'Triads: one deadline passed with nothing fulfilled is one overdue unit');

select is(
  (select array[required_units, completed_units, due_units, overdue_units]
     from public.canonical_module_progress('e1000000-0000-0000-0000-0000000000e1'::uuid, current_date)
    where module = 'peer_coaching'),
  array[2, 1, 2, 1], 'Peer: the dyad session is a completed unit; the practice session is not, so unit 2 is overdue');

select is(
  (select completed_units from public.canonical_module_progress('e1000000-0000-0000-0000-0000000000e2'::uuid, current_date)
    where module = 'peer_coaching'),
  1, 'Peer: the dyad session credits the partner too');

select is(
  (select array[c.completed_units, p.completed_units]
     from public.canonical_module_progress('e1000000-0000-0000-0000-0000000000e6'::uuid, current_date) c,
          public.canonical_module_progress('e1000000-0000-0000-0000-0000000000e6'::uuid, current_date) p
    where c.module = 'coaching' and p.module = 'peer_coaching'),
  array[1, 0], 'Coach K as a learner: the Coaching session counts; the practice K gives earns K no Peer unit');

-- ---------------------------------------------------------------------------
-- Every role reports the same numbers
-- ---------------------------------------------------------------------------
--
-- The full per-module numeric contract, compared as one row so a single
-- differing figure fails rather than being averaged away.
create temporary table _reconcile_expected as
select array[
    coaching_required_units, coaching_completed_units, coaching_due_units, coaching_booked_units,
    mentoring_required_units, mentoring_completed_units, mentoring_due_units, mentoring_booked_units,
    peer_required_units, peer_completed_units, peer_due_units, peer_booked_units,
    triad_required_units, triad_completed_units, triad_due_units, triad_booked_units,
    required_units, completed_units, due_units, booked_units, overdue_units
  ] as numbers,
  full_completion_pct, due_adherence_pct, pace_status
from public.canonical_enrollment_progress('e1000000-0000-0000-0000-0000000000e1'::uuid, current_date);

create temporary table _reconcile_coach_learner as
select array[
    coaching_required_units, coaching_completed_units, coaching_due_units, coaching_booked_units,
    mentoring_required_units, mentoring_completed_units, mentoring_due_units, mentoring_booked_units,
    peer_required_units, peer_completed_units, peer_due_units, peer_booked_units,
    triad_required_units, triad_completed_units, triad_due_units, triad_booked_units,
    required_units, completed_units, due_units, booked_units, overdue_units
  ] as numbers,
  full_completion_pct, due_adherence_pct
from public.canonical_enrollment_progress('e1000000-0000-0000-0000-0000000000e6'::uuid, current_date);

-- The spine agrees with itself: the enrollment row is the per-module rows.
select is(
  (select array[coaching_required_units, coaching_completed_units, coaching_booked_units]
     from public.canonical_enrollment_progress('e1000000-0000-0000-0000-0000000000e1'::uuid, current_date)),
  (select array[required_units, completed_units, booked_units]
     from public.canonical_module_progress('e1000000-0000-0000-0000-0000000000e1'::uuid, current_date)
    where module = 'coaching'),
  'the enrollment row repeats the per-module Coaching figures exactly');

select is(
  (select array[mentoring_required_units, mentoring_completed_units, mentoring_booked_units]
     from public.canonical_enrollment_progress('e1000000-0000-0000-0000-0000000000e1'::uuid, current_date)),
  (select array[required_units, completed_units, booked_units]
     from public.canonical_module_progress('e1000000-0000-0000-0000-0000000000e1'::uuid, current_date)
    where module = 'mentoring'),
  'and the per-module Mentoring figures exactly');

select is(
  (select array[peer_required_units, peer_completed_units, peer_booked_units]
     from public.canonical_enrollment_progress('e1000000-0000-0000-0000-0000000000e1'::uuid, current_date)),
  (select array[required_units, completed_units, booked_units]
     from public.canonical_module_progress('e1000000-0000-0000-0000-0000000000e1'::uuid, current_date)
    where module = 'peer_coaching'),
  'and the per-module Peer figures exactly');

select is(
  (select array[triad_required_units, triad_completed_units, triad_booked_units]
     from public.canonical_enrollment_progress('e1000000-0000-0000-0000-0000000000e1'::uuid, current_date)),
  (select array[required_units, completed_units, booked_units]
     from public.canonical_module_progress('e1000000-0000-0000-0000-0000000000e1'::uuid, current_date)
    where module = 'triads'),
  'and the per-module Triad figures exactly');

-- LEARNER, reading their own enrollment.
select is(
  (select array[
      coaching_required_units, coaching_completed_units, coaching_due_units, coaching_booked_units,
      mentoring_required_units, mentoring_completed_units, mentoring_due_units, mentoring_booked_units,
      peer_required_units, peer_completed_units, peer_due_units, peer_booked_units,
      triad_required_units, triad_completed_units, triad_due_units, triad_booked_units,
      required_units, completed_units, due_units, booked_units, overdue_units]
     from public.learner_canonical_progress('e1000000-0000-0000-0000-0000000000e1'::uuid, current_date)),
  (select numbers from _reconcile_expected),
  'LEARNER reports exactly the canonical numbers');

select is(
  (select array[full_completion_pct, due_adherence_pct]
     from public.learner_canonical_progress('e1000000-0000-0000-0000-0000000000e1'::uuid, current_date)),
  (select array[full_completion_pct, due_adherence_pct] from _reconcile_expected),
  'LEARNER percentages are the canonical percentages, not re-derived');

-- LEARNER: Coach K reading their own learner enrollment.
select set_config('request.jwt.claims',
  json_build_object('sub', 'e1000000-0000-0000-0000-000000000001')::text, true);
select is(
  (select array[
      coaching_required_units, coaching_completed_units, coaching_due_units, coaching_booked_units,
      mentoring_required_units, mentoring_completed_units, mentoring_due_units, mentoring_booked_units,
      peer_required_units, peer_completed_units, peer_due_units, peer_booked_units,
      triad_required_units, triad_completed_units, triad_due_units, triad_booked_units,
      required_units, completed_units, due_units, booked_units, overdue_units]
     from public.learner_canonical_progress('e1000000-0000-0000-0000-0000000000e6'::uuid, current_date)),
  (select numbers from _reconcile_coach_learner),
  'COACH AS LEARNER reports exactly the canonical numbers of their own enrollment');

-- ADMIN.
select set_config('request.jwt.claims',
  json_build_object('sub', 'e1000000-0000-0000-0000-000000000008')::text, true);
insert into public.user_roles (user_id, role)
  values ('e1000000-0000-0000-0000-000000000008', 'admin') on conflict do nothing;

select is(
  (select array[
      coaching_required_units, coaching_completed_units, coaching_due_units, coaching_booked_units,
      mentoring_required_units, mentoring_completed_units, mentoring_due_units, mentoring_booked_units,
      peer_required_units, peer_completed_units, peer_due_units, peer_booked_units,
      triad_required_units, triad_completed_units, triad_due_units, triad_booked_units,
      required_units, completed_units, due_units, booked_units, overdue_units]
     from public.admin_canonical_enrollment_progress(
       ARRAY['e1000000-0000-0000-0000-0000000000e1'::uuid], current_date)),
  (select numbers from _reconcile_expected),
  'ADMIN reports exactly the canonical numbers');

select is(
  (select array[
      coaching_required_units, coaching_completed_units, coaching_due_units, coaching_booked_units,
      mentoring_required_units, mentoring_completed_units, mentoring_due_units, mentoring_booked_units,
      peer_required_units, peer_completed_units, peer_due_units, peer_booked_units,
      triad_required_units, triad_completed_units, triad_due_units, triad_booked_units,
      required_units, completed_units, due_units, booked_units, overdue_units]
     from public.admin_canonical_enrollment_progress(
       ARRAY['e1000000-0000-0000-0000-0000000000e6'::uuid], current_date)),
  (select numbers from _reconcile_coach_learner),
  'ADMIN reports exactly the canonical numbers for the Coach as learner');

select is(
  (select pace_status from public.admin_canonical_enrollment_progress(
     ARRAY['e1000000-0000-0000-0000-0000000000e1'::uuid], current_date)),
  (select pace_status from _reconcile_expected),
  'ADMIN pace is the canonical pace');

-- SPONSOR. Five leaders clear the k-anonymity floor, so the row is visible;
-- the numbers must be identical to everyone else's.
delete from public.user_roles
 where user_id = 'e1000000-0000-0000-0000-000000000008' and role = 'admin';

select is(
  (select array[
      coaching_required_units, coaching_completed_units, coaching_due_units, coaching_booked_units,
      mentoring_required_units, mentoring_completed_units, mentoring_due_units, mentoring_booked_units,
      peer_required_units, peer_completed_units, peer_due_units, peer_booked_units,
      triad_required_units, triad_completed_units, triad_due_units, triad_booked_units,
      required_units, completed_units, due_units, booked_units, overdue_units]
     from public.sponsor_canonical_enrollment_progress('e1000000-0000-0000-0000-00000000b0b0'::uuid, current_date)
    where enrollment_id = 'e1000000-0000-0000-0000-0000000000e1'::uuid),
  (select numbers from _reconcile_expected),
  'SPONSOR reports exactly the canonical numbers');

select is(
  (select array[full_completion_pct, due_adherence_pct]
     from public.sponsor_canonical_enrollment_progress('e1000000-0000-0000-0000-00000000b0b0'::uuid, current_date)
    where enrollment_id = 'e1000000-0000-0000-0000-0000000000e1'::uuid),
  (select array[full_completion_pct, due_adherence_pct] from _reconcile_expected),
  'SPONSOR percentages are the canonical percentages');

select is(
  (select array[
      coaching_required_units, coaching_completed_units, coaching_due_units, coaching_booked_units,
      mentoring_required_units, mentoring_completed_units, mentoring_due_units, mentoring_booked_units,
      peer_required_units, peer_completed_units, peer_due_units, peer_booked_units,
      triad_required_units, triad_completed_units, triad_due_units, triad_booked_units,
      required_units, completed_units, due_units, booked_units, overdue_units]
     from public.sponsor_canonical_enrollment_progress('e1000000-0000-0000-0000-00000000b0b0'::uuid, current_date)
    where enrollment_id = 'e1000000-0000-0000-0000-0000000000e6'::uuid),
  (select numbers from _reconcile_coach_learner),
  'SPONSOR reports exactly the canonical numbers for the Coach as learner');

-- ---------------------------------------------------------------------------
-- Privacy removes detail, never numbers
-- ---------------------------------------------------------------------------
--
-- The Sponsor contract exposes no narrative column at all, so a leak would be
-- a schema change rather than a query mistake.
select is(
  (select count(*)::int from information_schema.columns
    where table_schema = 'public'
      and table_name = 'sponsor_canonical_enrollment_progress'
      and column_name in ('coachee_notes', 'mentee_notes', 'mentor_notes', 'body', 'reflection')),
  0, 'the Sponsor progress contract carries no narrative column');

select is(
  (select completed_units from public.canonical_module_progress('e1000000-0000-0000-0000-0000000000e2'::uuid, current_date)
    where module = 'coaching'),
  0, 'another learner in the same cohort is unaffected by L1''s activity');

select * from finish();
rollback;
