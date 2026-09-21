-- Programme quantity / cohort requirement cardinality invariant.
--
--   1 programme unit = 1 cohort requirement = 1 ordinal = 1 deadline
--
-- INPUT INTEGRITY is asserted here alongside OUTPUT CONSISTENCY, because
-- either alone is worthless: four roles agreeing on "3 of 4 required" is still
-- the wrong answer if the programme said 4 and the cohort only ever held 3.
--
-- The fixture is the shape section 17 names: Coaching 4, Mentoring 2,
-- Triads 3, in one cohort, with real activity on it.
--
-- Note on the deferred guards. cohort_requirement_dates_assert_schedule and
-- programme_modules_assert_schedules are DEFERRABLE INITIALLY DEFERRED, so
-- they do not fire when a statement runs -- they fire at COMMIT, which is what
-- lets a legitimate multi-row regeneration delete and re-insert freely. To
-- observe them inside this always-rolled-back transaction, the cases below
-- force the check with SET CONSTRAINTS ALL IMMEDIATE.
begin;

select plan(36);

-- ---------------------------------------------------------------------------
-- Fixture
-- ---------------------------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_user_meta_data, created_at, updated_at, confirmation_token, email_change_token_new, recovery_token)
select ('a2000000-0000-0000-0000-00000000000' || n)::uuid, '00000000-0000-0000-0000-000000000000'::uuid,
  'authenticated', 'authenticated', 'quantity-' || n || '@example.test', 'test', now(),
  jsonb_build_object('full_name', 'Quantity Person ' || n), now(), now(), '', '', ''
from generate_series(1, 9) n;
-- 1 = Coach (also the Mentor)   2..6 = Learners L1..L5   7 = Sponsor

insert into public.user_roles (user_id, role) values
  ('a2000000-0000-0000-0000-000000000001', 'coach'),
  ('a2000000-0000-0000-0000-000000000002', 'coachee'),
  ('a2000000-0000-0000-0000-000000000003', 'coachee'),
  ('a2000000-0000-0000-0000-000000000004', 'coachee'),
  ('a2000000-0000-0000-0000-000000000005', 'coachee'),
  ('a2000000-0000-0000-0000-000000000006', 'coachee'),
  ('a2000000-0000-0000-0000-000000000007', 'sponsor') on conflict do nothing;

insert into public.organizations (id, name)
  values ('a2000000-0000-0000-0000-00000000aaaa'::uuid, 'Quantity Org');
insert into public.sponsor_profiles (user_id, organization_id)
  values ('a2000000-0000-0000-0000-000000000007'::uuid, 'a2000000-0000-0000-0000-00000000aaaa'::uuid);

-- THE quantity. Nothing else in this test is allowed to answer "how many?".
insert into public.programmes (id, name)
  values ('a2000000-0000-0000-0000-00000000a0a0'::uuid, 'Quantity Programme');
insert into public.programme_modules (programme_id, module, enabled, config) values
  ('a2000000-0000-0000-0000-00000000a0a0'::uuid, 'coaching',  true, '{"required": true, "required_units": 4}'::jsonb),
  ('a2000000-0000-0000-0000-00000000a0a0'::uuid, 'mentoring', true, '{"required": true, "required_units": 2}'::jsonb),
  ('a2000000-0000-0000-0000-00000000a0a0'::uuid, 'triads',    true, '{"required": true, "required_units": 3}'::jsonb);

-- Section 8: creating the cohort materialises the whole schedule. No
-- enrollment exists yet, and none is needed.
insert into public.cohorts (id, name, programme_id, organization_id, start_date, end_date)
  values ('a2000000-0000-0000-0000-00000000b0b0'::uuid, 'Quantity Cohort',
          'a2000000-0000-0000-0000-00000000a0a0'::uuid, 'a2000000-0000-0000-0000-00000000aaaa'::uuid,
          current_date - 120, current_date + 120);

-- ---------------------------------------------------------------------------
-- 1. Section 8 + 3: cohort creation yields exactly N, ordinals 1..N, units 1
-- ---------------------------------------------------------------------------

select is(
  (select count(*)::int from public.cohort_requirement_dates
    where cohort_id = 'a2000000-0000-0000-0000-00000000b0b0'::uuid and module = 'coaching'),
  4, 'cohort creation materialises exactly the 4 Coaching requirements');

select is(
  (select count(*)::int from public.cohort_requirement_dates
    where cohort_id = 'a2000000-0000-0000-0000-00000000b0b0'::uuid and module = 'mentoring'),
  2, 'and exactly the 2 Mentoring requirements');

select is(
  (select count(*)::int from public.cohort_requirement_dates
    where cohort_id = 'a2000000-0000-0000-0000-00000000b0b0'::uuid and module = 'triads'),
  3, 'and exactly the 3 Triad requirements');

select is(
  (select array_agg(ordinal order by ordinal) from public.cohort_requirement_dates
    where cohort_id = 'a2000000-0000-0000-0000-00000000b0b0'::uuid and module = 'coaching'),
  ARRAY[1, 2, 3, 4], 'Coaching ordinals are exactly 1..4, with no gap and no duplicate');

select is(
  (select array_agg(distinct units) from public.cohort_requirement_dates
    where cohort_id = 'a2000000-0000-0000-0000-00000000b0b0'::uuid),
  ARRAY[1], 'section 1: every requirement row is one unit -- no weighted rows');

select is(
  (select count(*)::int from public.cohort_requirement_dates
    where cohort_id = 'a2000000-0000-0000-0000-00000000b0b0'::uuid and due_on is null),
  0, 'every requirement carries a deadline');

select ok(
  (select public.cohort_module_schedule_violation(
     'a2000000-0000-0000-0000-00000000b0b0'::uuid,
     'a2000000-0000-0000-0000-00000000a0a0'::uuid, 'coaching') is null),
  'the schedule reports no violation');

-- ---------------------------------------------------------------------------
-- 2. Section 2: the programme is the ONLY quantity authority
-- ---------------------------------------------------------------------------

insert into public.cohort_coach_assignments (cohort_id, coach_id)
  values ('a2000000-0000-0000-0000-00000000b0b0'::uuid, 'a2000000-0000-0000-0000-000000000001'::uuid);
insert into public.cohort_mentors (cohort_id, mentor_user_id)
  values ('a2000000-0000-0000-0000-00000000b0b0'::uuid, 'a2000000-0000-0000-0000-000000000001'::uuid);

-- Sponsor visibility is the ENROLLMENT organisation, so the enrollments carry
-- the sponsor's organisation.
insert into public.programme_enrollments (id, programme_id, user_id, cohort_id, organization_id, status)
select ('a2000000-0000-0000-0000-00000000e00' || n)::uuid,
       'a2000000-0000-0000-0000-00000000a0a0'::uuid,
       ('a2000000-0000-0000-0000-00000000000' || (n + 1))::uuid,
       'a2000000-0000-0000-0000-00000000b0b0'::uuid,
       'a2000000-0000-0000-0000-00000000aaaa'::uuid, 'active'
from generate_series(1, 5) n;

-- Booking goal gate (20260925400000): the cohort started 120 days ago, so the
-- learner's own live booking below needs an active goal.
insert into public.coachee_goals (coachee_id, enrollment_id, title)
values ('a2000000-0000-0000-0000-000000000002', 'a2000000-0000-0000-0000-00000000e001', 'Booking gate goal');

select is(
  public.programme_required_units('a2000000-0000-0000-0000-00000000e001'::uuid, 'coaching'),
  4, 'eligibility reads the programme quantity');

select is(
  public.programme_required_units('a2000000-0000-0000-0000-00000000e001'::uuid, 'coaching'),
  (select required_units from public.canonical_module_progress('a2000000-0000-0000-0000-00000000e001'::uuid, current_date)
    where module = 'coaching'),
  'and it is the SAME number canonical progress scores against');

-- ---------------------------------------------------------------------------
-- 3. Section 3 + 19: invalid states are refused at COMMIT
-- ---------------------------------------------------------------------------

-- A surplus requirement: the cohort trying to add quantity the programme did
-- not ask for.
select throws_ok($$
  insert into public.cohort_requirement_dates
    (cohort_id, programme_id, module, ordinal, due_on, units, generation_method, materialized_via)
  values ('a2000000-0000-0000-0000-00000000b0b0'::uuid, 'a2000000-0000-0000-0000-00000000a0a0'::uuid,
          'coaching', 5, current_date + 10, 1, 'manual', 'admin_save');
  set constraints all immediate;
$$, '23514', NULL, 'a fifth Coaching requirement is refused: the cohort cannot add quantity');

-- A gap: ordinals 1,2,3,5 instead of 1..4.
select throws_ok($$
  update public.cohort_requirement_dates set ordinal = 9
   where cohort_id = 'a2000000-0000-0000-0000-00000000b0b0'::uuid
     and module = 'coaching' and ordinal = 4;
  set constraints all immediate;
$$, '23514', NULL, 'an ordinal gap is refused');

-- A weighted row. This one is an immediate CHECK, not a deferred trigger.
select throws_ok($$
  update public.cohort_requirement_dates set units = 4
   where cohort_id = 'a2000000-0000-0000-0000-00000000b0b0'::uuid
     and module = 'coaching' and ordinal = 1
$$, '23514', NULL, 'section 1: a weighted requirement row is refused outright');

-- Section 19's explicit requirement: the guard must NOT reject a valid
-- regeneration halfway through its own operation.
select lives_ok($$
  delete from public.cohort_requirement_dates
   where cohort_id = 'a2000000-0000-0000-0000-00000000b0b0'::uuid and module = 'mentoring';
  insert into public.cohort_requirement_dates
    (cohort_id, programme_id, module, ordinal, due_on, units, generation_method, materialized_via)
  select 'a2000000-0000-0000-0000-00000000b0b0'::uuid, 'a2000000-0000-0000-0000-00000000a0a0'::uuid,
         'mentoring', g.i, current_date + 60, 1, 'manual', 'admin_save'
  from generate_series(1, 2) g(i);
  set constraints all immediate;
$$, 'a complete regeneration inside one transaction is allowed: the guard is deferred');

set constraints all deferred;

-- ---------------------------------------------------------------------------
-- 4. Section 18: programme quantity changes
-- ---------------------------------------------------------------------------

-- INCREASE 3 -> 4 (Triads). The fourth requirement must appear by itself.
update public.programme_modules
   set config = '{"required": true, "required_units": 4}'::jsonb
 where programme_id = 'a2000000-0000-0000-0000-00000000a0a0'::uuid and module = 'triads';

select is(
  (select count(*)::int from public.cohort_requirement_dates
    where cohort_id = 'a2000000-0000-0000-0000-00000000b0b0'::uuid and module = 'triads'),
  4, 'increase 3 -> 4: the fourth Triad requirement appears');

select is(
  (select array_agg(ordinal order by ordinal) from public.cohort_requirement_dates
    where cohort_id = 'a2000000-0000-0000-0000-00000000b0b0'::uuid and module = 'triads'),
  ARRAY[1, 2, 3, 4], 'and the ordinals are still exactly 1..N');

select is(
  (select required_units from public.canonical_module_progress('a2000000-0000-0000-0000-00000000e001'::uuid, current_date)
    where module = 'triads'),
  4, 'and every role now reports required = 4');

-- DECREASE 4 -> 3 with NO activity on requirement 4: safe reconciliation.
update public.programme_modules
   set config = '{"required": true, "required_units": 3}'::jsonb
 where programme_id = 'a2000000-0000-0000-0000-00000000a0a0'::uuid and module = 'triads';

select is(
  (select array_agg(ordinal order by ordinal) from public.cohort_requirement_dates
    where cohort_id = 'a2000000-0000-0000-0000-00000000b0b0'::uuid and module = 'triads'),
  ARRAY[1, 2, 3], 'decrease 4 -> 3 with nothing attached: requirements become 1..3');

-- DECREASE 4 -> 3 with activity on requirement 4 (Coaching). The booking is
-- made first, then the reduction attempted.
select set_config('request.jwt.claims',
  json_build_object('sub', 'a2000000-0000-0000-0000-000000000002')::text, true);

insert into public.sessions
  (id, enrollment_id, cohort_requirement_id, coach_id, coachee_id, topic,
   start_time, duration_minutes, status)
values ('a2000000-0000-0000-0000-0000000000c4'::uuid, 'a2000000-0000-0000-0000-00000000e001'::uuid,
        (select id from public.cohort_requirement_dates
          where cohort_id = 'a2000000-0000-0000-0000-00000000b0b0'::uuid
            and module = 'coaching' and ordinal = 4),
        'a2000000-0000-0000-0000-000000000001'::uuid, 'a2000000-0000-0000-0000-000000000002'::uuid,
        'On requirement four', now() - interval '2 days', 60, 'confirmed');

select throws_ok($$
  update public.programme_modules
     set config = '{"required": true, "required_units": 3}'::jsonb
   where programme_id = 'a2000000-0000-0000-0000-00000000a0a0'::uuid and module = 'coaching';
  set constraints all immediate;
$$, '23514', NULL,
  'section 6: reducing Coaching 4 -> 3 is REFUSED while requirement 4 holds a session');

set constraints all deferred;

select is(
  (select count(*)::int from public.sessions
    where id = 'a2000000-0000-0000-0000-0000000000c4'::uuid),
  1, 'and the historical activity is untouched');

select is(
  (select count(*)::int from public.cohort_requirement_dates
    where cohort_id = 'a2000000-0000-0000-0000-00000000b0b0'::uuid and module = 'coaching'),
  4, 'and the cohort still holds its 4 Coaching requirements');

-- ---------------------------------------------------------------------------
-- 5. Section 9: an invalid schedule is not operationally usable
-- ---------------------------------------------------------------------------
--
-- A second cohort, deliberately left without a completion deadline, so no
-- requirement can be materialised and none may be invented.

insert into public.cohorts (id, name, programme_id, organization_id)
  values ('a2000000-0000-0000-0000-00000000b1b1'::uuid, 'Undated Cohort',
          'a2000000-0000-0000-0000-00000000a0a0'::uuid, 'a2000000-0000-0000-0000-00000000aaaa'::uuid);
insert into public.cohort_coach_assignments (cohort_id, coach_id)
  values ('a2000000-0000-0000-0000-00000000b1b1'::uuid, 'a2000000-0000-0000-0000-000000000001'::uuid);
insert into public.cohort_mentors (cohort_id, mentor_user_id)
  values ('a2000000-0000-0000-0000-00000000b1b1'::uuid, 'a2000000-0000-0000-0000-000000000001'::uuid);
insert into public.programme_enrollments (id, programme_id, user_id, cohort_id, status) values
  ('a2000000-0000-0000-0000-00000000e0f0'::uuid, 'a2000000-0000-0000-0000-00000000a0a0'::uuid,
   'a2000000-0000-0000-0000-000000000008'::uuid, 'a2000000-0000-0000-0000-00000000b1b1'::uuid, 'active');

select is(
  (select count(*)::int from public.cohort_requirement_dates
    where cohort_id = 'a2000000-0000-0000-0000-00000000b1b1'::uuid),
  0, 'section 4: with no deadline, no requirement is materialised and no date is invented');

select is(
  public.cohort_module_schedule_violation(
    'a2000000-0000-0000-0000-00000000b1b1'::uuid,
    'a2000000-0000-0000-0000-00000000a0a0'::uuid, 'coaching'),
  'missing_deadline', 'the cohort is reported as pending an Admin deadline');

select set_config('request.jwt.claims',
  json_build_object('sub', 'a2000000-0000-0000-0000-000000000008')::text, true);

select ok(
  not public.can_book_session(
    'a2000000-0000-0000-0000-000000000008'::uuid,
    'a2000000-0000-0000-0000-000000000001'::uuid,
    'a2000000-0000-0000-0000-00000000e0f0'::uuid),
  'Coaching booking refuses to operate against an incomplete schedule');

select is(
  public.can_book_mentoring_session_reason(
    'a2000000-0000-0000-0000-000000000008'::uuid,
    'a2000000-0000-0000-0000-000000000001'::uuid,
    'a2000000-0000-0000-0000-00000000e0f0'::uuid),
  'cohort_schedule_invalid',
  'and Mentoring names the cause rather than failing generically');

select throws_ok($$
  select public.assert_enrollment_schedule_valid(
    'a2000000-0000-0000-0000-00000000e0f0'::uuid, 'coaching'::public.programme_module_type)
$$, '23514', NULL, 'the operational guard raises cohort_schedule_invalid');

-- Supplying the deadline repairs it with no other intervention.
insert into public.cohort_module_deadlines (cohort_id, programme_id, module, completion_deadline, source)
select 'a2000000-0000-0000-0000-00000000b1b1'::uuid, 'a2000000-0000-0000-0000-00000000a0a0'::uuid,
       r.module, current_date + 90, 'admin'
from public.cohort_required_module_units('a2000000-0000-0000-0000-00000000b1b1'::uuid) r;

select is(
  (select count(*)::int from public.cohort_requirement_dates
    where cohort_id = 'a2000000-0000-0000-0000-00000000b1b1'::uuid and module = 'coaching'),
  4, 'once the Admin sets the deadline the full schedule materialises');

select ok(
  public.can_book_session(
    'a2000000-0000-0000-0000-000000000008'::uuid,
    'a2000000-0000-0000-0000-000000000001'::uuid,
    'a2000000-0000-0000-0000-00000000e0f0'::uuid),
  'and booking is allowed again');

-- ---------------------------------------------------------------------------
-- 6. Section 11: Mentoring capacity is requirement occupancy, not raw sessions
-- ---------------------------------------------------------------------------
--
-- Two unattributed historical sessions against a 2-requirement programme. They
-- fulfil nothing, so they must not exhaust the allowance either.

insert into public.mentoring_sessions
  (id, enrollment_id, mentor_id, mentee_id, topic,
   start_time, duration_minutes, status)
values
  ('a2000000-0000-0000-0000-0000000000f1'::uuid, 'a2000000-0000-0000-0000-00000000e0f0'::uuid,
   'a2000000-0000-0000-0000-000000000001'::uuid, 'a2000000-0000-0000-0000-000000000008'::uuid,
   'Pre-cutover one', now() - interval '80 days', 60, 'completed'),
  ('a2000000-0000-0000-0000-0000000000f2'::uuid, 'a2000000-0000-0000-0000-00000000e0f0'::uuid,
   'a2000000-0000-0000-0000-000000000001'::uuid, 'a2000000-0000-0000-0000-000000000008'::uuid,
   'Pre-cutover two', now() - interval '70 days', 60, 'completed');

-- A session created TODAY is auto-attributed on insert
-- (validate_mentoring_session_requirement), so an unattributed row can only be
-- what it is in production: a pre-cutover session the backfill could not map.
-- Stripping the attribution reproduces that shape exactly.
select set_config('app.session_transition', 'on', true);
update public.mentoring_sessions set cohort_requirement_id = NULL
 where id in ('a2000000-0000-0000-0000-0000000000f1'::uuid,
              'a2000000-0000-0000-0000-0000000000f2'::uuid);
select set_config('app.session_transition', 'off', true);

select is(
  (select count(*)::int from public.mentoring_sessions
    where enrollment_id = 'a2000000-0000-0000-0000-00000000e0f0'::uuid
      and cohort_requirement_id is null),
  2, 'the fixture holds two genuinely unattributed historical Mentoring sessions');

select is(
  (select completed_units from public.canonical_module_progress('a2000000-0000-0000-0000-00000000e0f0'::uuid, current_date)
    where module = 'mentoring'),
  0, 'two unattributed Mentoring sessions fulfil nothing');

select is(
  public.can_book_mentoring_session_reason(
    'a2000000-0000-0000-0000-000000000008'::uuid,
    'a2000000-0000-0000-0000-000000000001'::uuid,
    'a2000000-0000-0000-0000-00000000e0f0'::uuid),
  'ok',
  'and they do not consume the allowance: booking is still permitted');

-- ---------------------------------------------------------------------------
-- 7. Section 17: every role reports the SAME canonical numbers
-- ---------------------------------------------------------------------------
--
-- Learner L1 of the dated cohort: one Coaching session held, one booked ahead,
-- against a programme requiring 4 Coaching / 2 Mentoring / 3 Triads.

select set_config('request.jwt.claims',
  json_build_object('sub', 'a2000000-0000-0000-0000-000000000001')::text, true);
-- Operational completion, through the canonical RPC. Evidence gates nothing
-- (20260921130000), so no reflection or note is supplied.
select public.complete_coaching_session('a2000000-0000-0000-0000-0000000000c4'::uuid);

select is(
  (select completed_units from public.canonical_module_progress('a2000000-0000-0000-0000-00000000e001'::uuid, current_date)
    where module = 'coaching'),
  1, 'the spine: one completed Coaching unit of four');

-- LEARNER
select set_config('request.jwt.claims',
  json_build_object('sub', 'a2000000-0000-0000-0000-000000000002')::text, true);

select is(
  (select coaching_required_units || '/' || coaching_completed_units
     from public.learner_canonical_progress('a2000000-0000-0000-0000-00000000e001'::uuid)),
  '4/1', 'LEARNER reports the canonical Coaching figures');

select is(
  (select array_agg(m.required_units order by m.module::text)
     from public.learner_canonical_module_progress('a2000000-0000-0000-0000-00000000e001'::uuid, current_date) m
    where m.module in ('coaching', 'mentoring', 'triads')),
  ARRAY[4, 2, 3], 'and the programme quantity of all three modules');

-- ADMIN
select set_config('request.jwt.claims',
  json_build_object('sub', 'a2000000-0000-0000-0000-000000000001')::text, true);
insert into public.user_roles (user_id, role)
  values ('a2000000-0000-0000-0000-000000000001', 'admin') on conflict do nothing;

select is(
  (select coaching_required_units || '/' || coaching_completed_units
     from public.admin_canonical_enrollment_progress(ARRAY['a2000000-0000-0000-0000-00000000e001'::uuid])),
  '4/1', 'ADMIN reports exactly the same');

-- SPONSOR
select set_config('request.jwt.claims',
  json_build_object('sub', 'a2000000-0000-0000-0000-000000000007')::text, true);

select is(
  (select coaching_required_units || '/' || coaching_completed_units
     from public.sponsor_canonical_enrollment_progress('a2000000-0000-0000-0000-00000000b0b0'::uuid)
    where enrollment_id = 'a2000000-0000-0000-0000-00000000e001'::uuid),
  '4/1', 'SPONSOR reports exactly the same: privacy removes narrative, never math');

-- ---------------------------------------------------------------------------
-- 8. Nothing in the database violates the invariant
-- ---------------------------------------------------------------------------

select set_config('request.jwt.claims',
  json_build_object('sub', 'a2000000-0000-0000-0000-000000000001')::text, true);

select is(
  (select count(*)::int from public.cohort_schedule_violations()
    where violation <> 'missing_deadline'),
  0, 'no cohort module is in a refusable state');

select * from finish();
rollback;
