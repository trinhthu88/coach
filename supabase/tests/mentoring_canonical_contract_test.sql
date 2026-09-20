-- Mentoring canonical architecture contract (Mentoring cutover).
--
-- Historical isolation fixture, per section 21: ONE learner holds two
-- enrollments in different cohorts with different mentor pools.
--
--   Enrollment A / Cohort A / Mentor A   (completed, historical)
--   Enrollment B / Cohort B / Mentor B   (active, current)
--
-- Mentor X is in no pool at all.
begin;

select plan(50);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_user_meta_data, created_at, updated_at, confirmation_token, email_change_token_new, recovery_token)
select ('d1000000-0000-0000-0000-00000000000' || n)::uuid, '00000000-0000-0000-0000-000000000000'::uuid,
  'authenticated', 'authenticated', 'mentoring-canon-' || n || '@example.test', 'test', now(),
  jsonb_build_object('full_name', 'Mentoring Person ' || n), now(), now(), '', '', ''
from generate_series(1, 4) n;
-- 1=Mentor A  2=Mentor B  3=Learner L  4=Mentor X (unassigned)

insert into public.user_roles (user_id, role) values
  ('d1000000-0000-0000-0000-000000000003', 'coachee') on conflict do nothing;

insert into public.mentor_profiles (coach_user_id, is_active) values
  ('d1000000-0000-0000-0000-000000000001'::uuid, true),
  ('d1000000-0000-0000-0000-000000000002'::uuid, true),
  ('d1000000-0000-0000-0000-000000000004'::uuid, true);

insert into public.programmes (id, name) values
  ('d1000000-0000-0000-0000-00000000a1a1'::uuid, 'Mentoring Programme A'),
  ('d1000000-0000-0000-0000-00000000a2a2'::uuid, 'Mentoring Programme B');

-- Programme owns HOW MANY (section 2): 2 required Mentoring units each.
insert into public.programme_modules (programme_id, module, enabled, config) values
  ('d1000000-0000-0000-0000-00000000a1a1'::uuid, 'mentoring', true, '{"required": true, "required_units": 2}'::jsonb),
  ('d1000000-0000-0000-0000-00000000a2a2'::uuid, 'mentoring', true, '{"required": true, "required_units": 2}'::jsonb);

insert into public.cohorts (id, name, programme_id) values
  ('d1000000-0000-0000-0000-00000000b1b1'::uuid, 'Cohort A', 'd1000000-0000-0000-0000-00000000a1a1'::uuid),
  ('d1000000-0000-0000-0000-00000000b2b2'::uuid, 'Cohort B', 'd1000000-0000-0000-0000-00000000a2a2'::uuid);

-- Cohort owns WHEN (section 3): deadlines come from the generic schedule.
insert into public.cohort_requirement_dates
  (cohort_id, programme_id, module, ordinal, due_on, generation_method, materialized_via) values
  ('d1000000-0000-0000-0000-00000000b1b1'::uuid, 'd1000000-0000-0000-0000-00000000a1a1'::uuid, 'mentoring', 1, current_date - 200, 'manual', 'admin_save'),
  ('d1000000-0000-0000-0000-00000000b1b1'::uuid, 'd1000000-0000-0000-0000-00000000a1a1'::uuid, 'mentoring', 2, current_date - 100, 'manual', 'admin_save'),
  ('d1000000-0000-0000-0000-00000000b2b2'::uuid, 'd1000000-0000-0000-0000-00000000a2a2'::uuid, 'mentoring', 1, current_date + 30, 'manual', 'admin_save'),
  ('d1000000-0000-0000-0000-00000000b2b2'::uuid, 'd1000000-0000-0000-0000-00000000a2a2'::uuid, 'mentoring', 2, current_date + 60, 'manual', 'admin_save');

-- One learner, two enrollments. A is history; B is current.
-- Enrollment A is opened first so its Mentoring history can be recorded, then
-- closed before B opens: ux_programme_enrollments_one_ongoing allows only one
-- ongoing enrollment per learner, and the entitlement trigger refuses a
-- booking against a closed one. Back-dating into a finished enrollment is
-- therefore impossible, which is the correct behaviour.
insert into public.programme_enrollments (id, programme_id, user_id, cohort_id, status) values
  ('d1000000-0000-0000-0000-00000000e1e1'::uuid, 'd1000000-0000-0000-0000-00000000a1a1'::uuid,
   'd1000000-0000-0000-0000-000000000003'::uuid, 'd1000000-0000-0000-0000-00000000b1b1'::uuid, 'active');

-- Each cohort has its own mentor. Mentor X is assigned to neither.
insert into public.cohort_mentors (cohort_id, mentor_user_id) values
  ('d1000000-0000-0000-0000-00000000b1b1'::uuid, 'd1000000-0000-0000-0000-000000000001'::uuid),
  ('d1000000-0000-0000-0000-00000000b2b2'::uuid, 'd1000000-0000-0000-0000-000000000002'::uuid);

-- Act as the learner for every booking-gated write below:
-- can_book_mentoring_session_reason() reads auth.uid() exactly as PostgREST
-- would present it.
select set_config('request.jwt.claims',
  json_build_object('sub', 'd1000000-0000-0000-0000-000000000003')::text, true);

-- Enrollment A's historical Mentoring session, recorded while A was live.
insert into public.mentoring_sessions
  (id, enrollment_id, mentor_id, mentee_id, topic, start_time, duration_minutes, status)
values ('d1000000-0000-0000-0000-00000000c4c4'::uuid, 'd1000000-0000-0000-0000-00000000e1e1'::uuid,
        'd1000000-0000-0000-0000-000000000001'::uuid, 'd1000000-0000-0000-0000-000000000003'::uuid,
        'Historical', now() - interval '200 days', 60, 'confirmed');
update public.mentoring_sessions set status = 'completed'
  where id = 'd1000000-0000-0000-0000-00000000c4c4'::uuid;

-- A closes; B opens.
update public.programme_enrollments set status = 'completed'
  where id = 'd1000000-0000-0000-0000-00000000e1e1'::uuid;
insert into public.programme_enrollments (id, programme_id, user_id, cohort_id, status) values
  ('d1000000-0000-0000-0000-00000000e2e2'::uuid, 'd1000000-0000-0000-0000-00000000a2a2'::uuid,
   'd1000000-0000-0000-0000-000000000003'::uuid, 'd1000000-0000-0000-0000-00000000b2b2'::uuid, 'active');

-- ---------------------------------------------------------------------------
-- Cohort mentor pool
-- ---------------------------------------------------------------------------
select is(
  (select count(*)::int from public.cohort_mentoring_mentor_pool('d1000000-0000-0000-0000-00000000b2b2'::uuid)),
  1, 'cohort B pool holds exactly its own mentor');

select ok(
  exists (select 1 from public.cohort_mentoring_mentor_pool('d1000000-0000-0000-0000-00000000b2b2'::uuid)
          where mentor_user_id = 'd1000000-0000-0000-0000-000000000002'::uuid),
  'Mentor B is in cohort B pool');

select ok(
  not exists (select 1 from public.cohort_mentoring_mentor_pool('d1000000-0000-0000-0000-00000000b2b2'::uuid)
              where mentor_user_id = 'd1000000-0000-0000-0000-000000000001'::uuid),
  'Mentor A does NOT leak from cohort A into cohort B');

select ok(
  not exists (select 1 from public.cohort_mentoring_mentor_pool('d1000000-0000-0000-0000-00000000b1b1'::uuid)
              where mentor_user_id = 'd1000000-0000-0000-0000-000000000004'::uuid),
  'an unassigned mentor is in no pool');

-- An inactive MENTOR PROFILE removes them from the pool even while assigned.
update public.mentor_profiles set is_active = false
  where coach_user_id = 'd1000000-0000-0000-0000-000000000002'::uuid;
select ok(
  not exists (select 1 from public.cohort_mentoring_mentor_pool('d1000000-0000-0000-0000-00000000b2b2'::uuid)),
  'a mentor with an inactive profile cannot be booked even when assigned');
update public.mentor_profiles set is_active = true
  where coach_user_id = 'd1000000-0000-0000-0000-000000000002'::uuid;

-- An inactive ASSIGNMENT removes them too.
update public.cohort_mentors set is_active = false
  where cohort_id = 'd1000000-0000-0000-0000-00000000b2b2'::uuid;
select ok(
  not exists (select 1 from public.cohort_mentoring_mentor_pool('d1000000-0000-0000-0000-00000000b2b2'::uuid)),
  'an inactive cohort assignment removes the mentor from the pool');
update public.cohort_mentors set is_active = true
  where cohort_id = 'd1000000-0000-0000-0000-00000000b2b2'::uuid;

select throws_ok($$
  insert into public.cohort_mentors (cohort_id, mentor_user_id)
  values ('d1000000-0000-0000-0000-00000000b2b2'::uuid, 'd1000000-0000-0000-0000-000000000002'::uuid)
$$, '23505', NULL, 'a duplicate cohort/mentor assignment is rejected');

-- ---------------------------------------------------------------------------
-- Enrollment-scoped mentor list (section 16)
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims',
  json_build_object('sub', 'd1000000-0000-0000-0000-000000000003')::text, true);

select is(
  (select count(*)::int from public.get_mentors_for_enrollment('d1000000-0000-0000-0000-00000000e2e2'::uuid)),
  1, 'the learner sees exactly one mentor for their current enrollment');

select is(
  (select mentor_user_id from public.get_mentors_for_enrollment('d1000000-0000-0000-0000-00000000e2e2'::uuid)),
  'd1000000-0000-0000-0000-000000000002'::uuid,
  'enrollment B resolves Mentor B, not Mentor A');

select is(
  (select mentor_user_id from public.get_mentors_for_enrollment('d1000000-0000-0000-0000-00000000e1e1'::uuid)),
  'd1000000-0000-0000-0000-000000000001'::uuid,
  'the historical enrollment still resolves its own historical mentor');

-- ---------------------------------------------------------------------------
-- Booking eligibility (sections 5 and 6)
-- ---------------------------------------------------------------------------
select is(
  public.can_book_mentoring_session_reason(
    'd1000000-0000-0000-0000-000000000003'::uuid,
    'd1000000-0000-0000-0000-000000000002'::uuid,
    'd1000000-0000-0000-0000-00000000e2e2'::uuid),
  'ok', 'booking the cohort mentor for the active enrollment is allowed');

select is(
  public.can_book_mentoring_session_reason(
    'd1000000-0000-0000-0000-000000000003'::uuid,
    'd1000000-0000-0000-0000-000000000001'::uuid,
    'd1000000-0000-0000-0000-00000000e2e2'::uuid),
  'not_in_cohort_pool', 'a mentor from another cohort cannot be booked');

select is(
  public.can_book_mentoring_session_reason(
    'd1000000-0000-0000-0000-000000000003'::uuid,
    'd1000000-0000-0000-0000-000000000004'::uuid,
    'd1000000-0000-0000-0000-00000000e2e2'::uuid),
  'not_in_cohort_pool', 'an unassigned mentor cannot be booked');

select is(
  public.can_book_mentoring_session_reason(
    'd1000000-0000-0000-0000-000000000003'::uuid,
    'd1000000-0000-0000-0000-000000000001'::uuid,
    'd1000000-0000-0000-0000-00000000e1e1'::uuid),
  'inactive', 'a completed historical enrollment cannot be booked against');

-- ---------------------------------------------------------------------------
-- Database enforcement: a direct INSERT cannot bypass the pool (section 20)
-- ---------------------------------------------------------------------------
select throws_ok($$
  insert into public.mentoring_sessions
    (enrollment_id, mentor_id, mentee_id, topic, start_time, duration_minutes, status)
  values ('d1000000-0000-0000-0000-00000000e2e2'::uuid, 'd1000000-0000-0000-0000-000000000001'::uuid,
          'd1000000-0000-0000-0000-000000000003'::uuid, 'Wrong cohort mentor',
          now() + interval '7 days', 60, 'confirmed')
$$, '42501', NULL, 'a direct INSERT with a mentor outside the cohort pool is rejected');

-- ---------------------------------------------------------------------------
-- Optional preparation document (section 7)
-- ---------------------------------------------------------------------------
insert into public.mentoring_sessions
  (id, enrollment_id, mentor_id, mentee_id, topic, start_time, duration_minutes, status)
values ('d1000000-0000-0000-0000-00000000c1c1'::uuid, 'd1000000-0000-0000-0000-00000000e2e2'::uuid,
        'd1000000-0000-0000-0000-000000000002'::uuid, 'd1000000-0000-0000-0000-000000000003'::uuid,
        'No prep doc', now() - interval '1 day', 60, 'confirmed');

-- The point of the cutover: completion must not require a prep file.
update public.mentoring_sessions set status = 'completed'
  where id = 'd1000000-0000-0000-0000-00000000c1c1'::uuid;
select is(
  (select status::text from public.mentoring_sessions where id = 'd1000000-0000-0000-0000-00000000c1c1'::uuid),
  'completed', 'a Mentoring session completes WITHOUT a preparation document');

select is(
  (select prep_file_path from public.mentoring_sessions where id = 'd1000000-0000-0000-0000-00000000c1c1'::uuid),
  NULL, 'the completed session genuinely has no preparation document');

insert into public.mentoring_sessions
  (id, enrollment_id, mentor_id, mentee_id, topic, start_time, duration_minutes, status, prep_file_path)
values ('d1000000-0000-0000-0000-00000000c2c2'::uuid, 'd1000000-0000-0000-0000-00000000e2e2'::uuid,
        'd1000000-0000-0000-0000-000000000002'::uuid, 'd1000000-0000-0000-0000-000000000003'::uuid,
        'With prep doc', now() - interval '2 days', 60, 'confirmed', 'prep/doc.pdf');
update public.mentoring_sessions set status = 'completed'
  where id = 'd1000000-0000-0000-0000-00000000c2c2'::uuid;
select is(
  (select status::text from public.mentoring_sessions where id = 'd1000000-0000-0000-0000-00000000c2c2'::uuid),
  'completed', 'a Mentoring session also completes WITH a preparation document');

-- ---------------------------------------------------------------------------
-- Canonical progress (section 13)
-- ---------------------------------------------------------------------------
select is(
  (select completed_units from public.canonical_module_progress('d1000000-0000-0000-0000-00000000e2e2'::uuid, current_date)
    where module = 'mentoring'),
  2, 'two completed sessions give two completed Mentoring units');

select is(
  (select required_units from public.canonical_module_progress('d1000000-0000-0000-0000-00000000e2e2'::uuid, current_date)
    where module = 'mentoring'),
  2, 'required units come from the programme module configuration');

-- Post-session artefacts must not move the number.
update public.mentoring_sessions
  set mentee_notes = 'my reflection', mentor_notes = 'mentor private note'
  where id = 'd1000000-0000-0000-0000-00000000c1c1'::uuid;
select is(
  (select completed_units from public.canonical_module_progress('d1000000-0000-0000-0000-00000000e2e2'::uuid, current_date)
    where module = 'mentoring'),
  2, 'mentee reflection and mentor notes do not change completed units');

-- A cancelled session is not completion evidence.
insert into public.mentoring_sessions
  (id, enrollment_id, mentor_id, mentee_id, topic, start_time, duration_minutes, status)
values ('d1000000-0000-0000-0000-00000000c3c3'::uuid, 'd1000000-0000-0000-0000-00000000e2e2'::uuid,
        'd1000000-0000-0000-0000-000000000002'::uuid, 'd1000000-0000-0000-0000-000000000003'::uuid,
        'Cancelled', now() + interval '3 days', 60, 'confirmed');
update public.mentoring_sessions set status = 'cancelled', cancelled_at = now()
  where id = 'd1000000-0000-0000-0000-00000000c3c3'::uuid;
select is(
  (select completed_units from public.canonical_module_progress('d1000000-0000-0000-0000-00000000e2e2'::uuid, current_date)
    where module = 'mentoring'),
  2, 'a cancelled session does not count as completed');

-- ---------------------------------------------------------------------------
-- Historical isolation (section 21)
-- ---------------------------------------------------------------------------
select is(
  (select completed_units from public.canonical_module_progress('d1000000-0000-0000-0000-00000000e1e1'::uuid, current_date)
    where module = 'mentoring'),
  1, 'the historical enrollment shows only its OWN completed session');

select is(
  (select count(*)::int from public.mentoring_sessions
    where enrollment_id = 'd1000000-0000-0000-0000-00000000e1e1'::uuid),
  1, 'the current enrollment activity did not leak onto the historical one');

select is(
  (select completed_units from public.canonical_module_progress('d1000000-0000-0000-0000-00000000e1e1'::uuid, current_date)
    where module = 'mentoring'),
  1, 'the historical session counts for its OWN enrollment');

select is(
  (select completed_units from public.canonical_module_progress('d1000000-0000-0000-0000-00000000e2e2'::uuid, current_date)
    where module = 'mentoring'),
  2, 'the historical session does NOT count toward the current enrollment');

-- ---------------------------------------------------------------------------
-- Role consistency and Sponsor privacy (sections 13 and 18)
-- ---------------------------------------------------------------------------
select is(
  (select array[mentoring_required_units, mentoring_completed_units, mentoring_booked_units, mentoring_due_units]
     from public.canonical_enrollment_progress('d1000000-0000-0000-0000-00000000e2e2'::uuid, current_date)),
  (select array[required_units, completed_units, booked_units, due_units]::int[]
     from public.canonical_module_progress('d1000000-0000-0000-0000-00000000e2e2'::uuid, current_date)
    where module = 'mentoring'),
  'the Sponsor/Admin progress spine agrees with the canonical Mentoring reader');

-- The Sponsor contract carries numbers only; narrative columns are not in it.
select ok(
  not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'mentoring_sessions'
      and column_name in ('mentor_notes', 'mentee_notes', 'prep_file_path')
      and has_column_privilege('anon', 'public.mentoring_sessions', column_name, 'SELECT')
  ),
  'mentor notes, mentee reflection and the prep document are not readable by anon');

-- ---------------------------------------------------------------------------
-- Legacy user-global paths cannot authorize anything (sections 2 and 4)
-- ---------------------------------------------------------------------------
--
-- These must FAIL, not answer. A function that still returns a verdict without
-- an enrollment is a working user-global booking path.

select throws_ok($$
  select public.can_book_mentoring_session_reason(
    'd1000000-0000-0000-0000-000000000003'::uuid,
    'd1000000-0000-0000-0000-000000000002'::uuid)
$$, '42501', NULL, 'the 2-argument eligibility reason fails closed');

select throws_ok($$
  select public.can_book_mentoring_session(
    'd1000000-0000-0000-0000-000000000003'::uuid,
    'd1000000-0000-0000-0000-000000000002'::uuid)
$$, '42501', NULL, 'the 2-argument eligibility boolean fails closed');

select throws_ok($$
  select public.check_can_book_mentoring_session('d1000000-0000-0000-0000-000000000002'::uuid)
$$, '42501', NULL, 'the self-pinned user-global check fails closed');

select throws_ok($$
  select public.check_can_book_mentoring_session_reason('d1000000-0000-0000-0000-000000000002'::uuid)
$$, '42501', NULL, 'the self-pinned user-global reason fails closed');

select throws_ok($$
  select * from public.get_my_mentors()
$$, '42501', NULL, 'user-global mentor discovery fails closed');

-- The user-global learner entitlement readers are gone entirely.
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'get_mentoring_received_limit'),
  0, 'the user-global received-limit reader no longer exists');

-- An allowlist row ALONE must not make a mentor bookable for a current
-- enrollment. Mentor X is allowlisted to the learner but in no cohort pool.
insert into public.mentoring_allowlist (mentee_user_id, mentor_user_id)
  values ('d1000000-0000-0000-0000-000000000003'::uuid, 'd1000000-0000-0000-0000-000000000004'::uuid);

select is(
  public.can_book_mentoring_session_reason(
    'd1000000-0000-0000-0000-000000000003'::uuid,
    'd1000000-0000-0000-0000-000000000004'::uuid,
    'd1000000-0000-0000-0000-00000000e2e2'::uuid),
  'not_in_cohort_pool',
  'an allowlist row alone does NOT make a mentor bookable for the current enrollment');

select ok(
  not exists (
    select 1 from public.get_mentors_for_enrollment('d1000000-0000-0000-0000-00000000e2e2'::uuid)
    where mentor_user_id = 'd1000000-0000-0000-0000-000000000004'::uuid),
  'an allowlist-only mentor does not appear in the enrollment mentor list');

-- ---------------------------------------------------------------------------
-- Entitlement is per enrollment, never summed across history (section 3)
-- ---------------------------------------------------------------------------
select is(
  (select used_count from public.get_mentoring_session_usage('d1000000-0000-0000-0000-00000000e1e1'::uuid)),
  1, 'the historical enrollment counts only its own session');

select is(
  (select used_count from public.get_mentoring_session_usage('d1000000-0000-0000-0000-00000000e2e2'::uuid)),
  2, 'the current enrollment counts only its own sessions, not the historical one');

-- ---------------------------------------------------------------------------
-- Two independent state layers (section 7)
-- ---------------------------------------------------------------------------
--
-- Documentation completeness and session lifecycle move independently.

-- A confirmed session with EVERY post-session artefact present still counts as
-- booked, never completed: documentation does not complete a session.
insert into public.mentoring_sessions
  (id, enrollment_id, mentor_id, mentee_id, topic, start_time, duration_minutes, status,
   mentee_notes, mentor_notes, prep_file_path, feedback_submitted_at)
values ('d1000000-0000-0000-0000-00000000c5c5'::uuid, 'd1000000-0000-0000-0000-00000000e2e2'::uuid,
        'd1000000-0000-0000-0000-000000000002'::uuid, 'd1000000-0000-0000-0000-000000000003'::uuid,
        'Fully documented but only confirmed', now() + interval '5 days', 60, 'confirmed',
        'reflection', 'mentor note', 'prep/x.pdf', now());

select is(
  (select completed_units from public.canonical_module_progress('d1000000-0000-0000-0000-00000000e2e2'::uuid, current_date)
    where module = 'mentoring'),
  2, 'a confirmed session with all documentation present does not increment completed units');

-- booked_units is capped at the units still OUTSTANDING. Both required units
-- are already complete here, so a further confirmed session adds nothing --
-- booked never inflates the total beyond what the programme requires.
select is(
  (select booked_units from public.canonical_module_progress('d1000000-0000-0000-0000-00000000e2e2'::uuid, current_date)
    where module = 'mentoring'),
  0, 'booked units are capped at the remaining required units, so a surplus confirmed session adds none');

-- ---------------------------------------------------------------------------
-- Reschedule re-attribution (section 6)
-- ---------------------------------------------------------------------------
--
-- Moving a session's date must move its cadence attribution with it. Before
-- this was fixed, occurred_on kept the ORIGINAL date because the attribution
-- helper ends in ON CONFLICT DO NOTHING.

select is(
  (select occurred_on from public.session_activity_attributions
    where source_activity_type = 'mentoring'
      and source_activity_id = 'd1000000-0000-0000-0000-00000000c1c1'::uuid),
  (current_date - 1),
  'the attribution starts on the session date');

update public.mentoring_sessions
  set start_time = now() - interval '40 days'
  where id = 'd1000000-0000-0000-0000-00000000c1c1'::uuid;

select is(
  (select occurred_on from public.session_activity_attributions
    where source_activity_type = 'mentoring'
      and source_activity_id = 'd1000000-0000-0000-0000-00000000c1c1'::uuid),
  (current_date - 40),
  'rescheduling moves occurred_on to the new date');

select is(
  (select count(*)::int from public.session_activity_attributions
    where source_activity_type = 'mentoring'
      and source_activity_id = 'd1000000-0000-0000-0000-00000000c1c1'::uuid),
  1, 'rescheduling leaves exactly one attribution, not a stale duplicate');

select is(
  (select completed_units from public.canonical_module_progress('d1000000-0000-0000-0000-00000000e2e2'::uuid, current_date)
    where module = 'mentoring'),
  2, 'rescheduling does not change the completed unit count');

-- ---------------------------------------------------------------------------
-- Requirement attribution: an early Mentoring 2 never hides an overdue Mentoring 1
-- ---------------------------------------------------------------------------
--
-- Before Mentoring sessions carried a requirement, they reached the canonical
-- activity spine with requirement_due_on = NULL, and canonical_module_progress
-- lets a NULL pass the due-date filter unconditionally. A session completed
-- early therefore counted against a deadline that had not arrived, cancelling
-- out an earlier requirement that was genuinely overdue.
--
-- Cohort C is the shape that exposes it: Mentoring 1 is already due and
-- unfulfilled, Mentoring 2 is not due yet and IS fulfilled.
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_user_meta_data, created_at, updated_at, confirmation_token, email_change_token_new, recovery_token)
values ('d1000000-0000-0000-0000-000000000005'::uuid, '00000000-0000-0000-0000-000000000000'::uuid,
  'authenticated', 'authenticated', 'mentoring-canon-5@example.test', 'test', now(),
  jsonb_build_object('full_name', 'Mentoring Person 5'), now(), now(), '', '', '');
insert into public.user_roles (user_id, role)
  values ('d1000000-0000-0000-0000-000000000005', 'coachee') on conflict do nothing;

insert into public.cohorts (id, name, programme_id) values
  ('d1000000-0000-0000-0000-00000000b3b3'::uuid, 'Cohort C', 'd1000000-0000-0000-0000-00000000a1a1'::uuid);

insert into public.cohort_requirement_dates
  (id, cohort_id, programme_id, module, ordinal, due_on, generation_method, materialized_via) values
  ('d1000000-0000-0000-0000-0000000000d1'::uuid, 'd1000000-0000-0000-0000-00000000b3b3'::uuid,
   'd1000000-0000-0000-0000-00000000a1a1'::uuid, 'mentoring', 1, current_date - 10, 'manual', 'admin_save'),
  ('d1000000-0000-0000-0000-0000000000d2'::uuid, 'd1000000-0000-0000-0000-00000000b3b3'::uuid,
   'd1000000-0000-0000-0000-00000000a1a1'::uuid, 'mentoring', 2, current_date + 30, 'manual', 'admin_save');

insert into public.cohort_mentors (cohort_id, mentor_user_id) values
  ('d1000000-0000-0000-0000-00000000b3b3'::uuid, 'd1000000-0000-0000-0000-000000000001'::uuid);

insert into public.programme_enrollments (id, programme_id, user_id, cohort_id, status) values
  ('d1000000-0000-0000-0000-00000000e3e3'::uuid, 'd1000000-0000-0000-0000-00000000a1a1'::uuid,
   'd1000000-0000-0000-0000-000000000005'::uuid, 'd1000000-0000-0000-0000-00000000b3b3'::uuid, 'active');

select set_config('request.jwt.claims',
  json_build_object('sub', 'd1000000-0000-0000-0000-000000000005')::text, true);

-- Explicitly against Mentoring 2, the requirement that is NOT yet due.
insert into public.mentoring_sessions
  (id, enrollment_id, cohort_requirement_id, mentor_id, mentee_id, topic,
   start_time, duration_minutes, status)
values ('d1000000-0000-0000-0000-00000000c7c7'::uuid, 'd1000000-0000-0000-0000-00000000e3e3'::uuid,
        'd1000000-0000-0000-0000-0000000000d2'::uuid,
        'd1000000-0000-0000-0000-000000000001'::uuid, 'd1000000-0000-0000-0000-000000000005'::uuid,
        'Early second', now() - interval '5 days', 60, 'confirmed');
update public.mentoring_sessions set status = 'completed'
  where id = 'd1000000-0000-0000-0000-00000000c7c7'::uuid;

select is(
  (select count(*)::int from public.canonical_mentoring_requirement_fulfilment('d1000000-0000-0000-0000-00000000e3e3'::uuid)),
  2, 'fulfilment reports one row per cohort Mentoring requirement');

select ok(
  (select fulfilled_on is not null from public.canonical_mentoring_requirement_fulfilment('d1000000-0000-0000-0000-00000000e3e3'::uuid)
    where ordinal = 2),
  'the completed session fulfils the requirement it is attributed to');

select ok(
  (select fulfilled_on is null from public.canonical_mentoring_requirement_fulfilment('d1000000-0000-0000-0000-00000000e3e3'::uuid)
    where ordinal = 1),
  'it does not fulfil any other requirement');

select is(
  (select completed_units from public.canonical_module_progress('d1000000-0000-0000-0000-00000000e3e3'::uuid, current_date)
    where module = 'mentoring'),
  1, 'one completed session is one completed unit');

select is(
  (select due_units from public.canonical_module_progress('d1000000-0000-0000-0000-00000000e3e3'::uuid, current_date)
    where module = 'mentoring'),
  1, 'only the requirement whose deadline has passed is due');

-- THE regression: without requirement attribution this read 0, because the
-- early unit satisfied a deadline that had not arrived.
select is(
  (select overdue_units from public.canonical_module_progress('d1000000-0000-0000-0000-00000000e3e3'::uuid, current_date)
    where module = 'mentoring'),
  1, 'an early Mentoring 2 does not hide an overdue Mentoring 1');

select * from finish();
rollback;
