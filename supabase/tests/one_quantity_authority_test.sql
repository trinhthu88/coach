-- One quantity authority (20261005130000_one_quantity_authority).
--
--   a. programme_modules.config is the only answer to "how many units":
--      after an Admin raises Coaching from 2 to 3 and Mentoring from 1 to 2,
--      enrollment_module_config, programme_required_units,
--      get_enrollment_programme_modules, booking eligibility and
--      learner_canonical_progress all give the new number -- the
--      enrollment-time snapshot is not consulted.
--   b. Eligibility = a free requirement + the cohort pool + the goal gate.
--      A Coach outside the pool, an archived goal or a programme with no
--      Coaching requirement (the retired allowlist / receive_limit path) is
--      not eligible.
--   c. The snapshot config capture trigger is gone.
begin;
select plan(24);

-- ---------------------------------------------------------------------------
-- Fixture
-- ---------------------------------------------------------------------------
-- 01 Coach K (cohort pool, also Mentor M)   02 learner A   03 Coach X (no pool)
-- 04 learner C (programme with no Coaching requirement, allowlisted to Coach K)
-- 05 learner B (same cohort as A, no goal yet)
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_user_meta_data, created_at, updated_at, confirmation_token, email_change_token_new, recovery_token)
select ('f9c00000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid,
  '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated',
  'quantity-' || n || '@example.test', 'test', now(),
  jsonb_build_object('full_name', 'Quantity Person ' || n), now(), now(), '', '', ''
from generate_series(1, 5) n;

insert into public.user_roles (user_id, role) values
  ('f9c00000-0000-4000-8000-000000000001', 'coach'),
  ('f9c00000-0000-4000-8000-000000000002', 'coachee'),
  ('f9c00000-0000-4000-8000-000000000003', 'coach'),
  ('f9c00000-0000-4000-8000-000000000004', 'coachee'),
  ('f9c00000-0000-4000-8000-000000000005', 'coachee')
on conflict do nothing;
update public.profiles set status = 'active'::public.user_status where id::text like 'f9c00000-%';
insert into public.coach_profiles (id, approval_status) values
  ('f9c00000-0000-4000-8000-000000000001', 'active'),
  ('f9c00000-0000-4000-8000-000000000003', 'active')
on conflict (id) do update set approval_status = 'active';

insert into public.programmes (id, name, coachee_session_limit) values
  ('f9c10000-0000-4000-8000-000000000001', 'Quantity Programme', 10),
  ('f9c10000-0000-4000-8000-000000000002', 'No-requirement Programme', 10);
insert into public.programme_modules (programme_id, module, enabled, config) values
  ('f9c10000-0000-4000-8000-000000000001', 'coaching', true, '{"required": true, "required_units": 2, "receive_limit": 2}'),
  ('f9c10000-0000-4000-8000-000000000001', 'mentoring', true, '{"required": true, "required_units": 1, "give_limit": 1}'),
  ('f9c10000-0000-4000-8000-000000000002', 'coaching', true, '{"required": false, "receive_limit": 5}');
insert into public.cohorts (id, name, programme_id, start_date, end_date) values
  ('f9c20000-0000-4000-8000-000000000001', 'Quantity Cohort', 'f9c10000-0000-4000-8000-000000000001',
   current_date - 30, current_date + 200),
  ('f9c20000-0000-4000-8000-000000000002', 'No-requirement Cohort', 'f9c10000-0000-4000-8000-000000000002',
   current_date - 30, current_date + 200);
update public.cohort_requirement_dates
   set due_on = current_date + 10 + ordinal * 30, is_overridden = true,
       generation_method = 'manual', materialized_via = 'admin_save'
 where cohort_id = 'f9c20000-0000-4000-8000-000000000001';
insert into public.cohort_coach_assignments (cohort_id, coach_id) values
  ('f9c20000-0000-4000-8000-000000000001', 'f9c00000-0000-4000-8000-000000000001'),
  ('f9c20000-0000-4000-8000-000000000002', 'f9c00000-0000-4000-8000-000000000001');
insert into public.cohort_mentors (cohort_id, mentor_user_id) values
  ('f9c20000-0000-4000-8000-000000000001', 'f9c00000-0000-4000-8000-000000000001');

insert into public.programme_enrollments (id, programme_id, user_id, cohort_id, status, start_date, end_date) values
  ('f9c30000-0000-4000-8000-000000000002', 'f9c10000-0000-4000-8000-000000000001',
   'f9c00000-0000-4000-8000-000000000002', 'f9c20000-0000-4000-8000-000000000001', 'active', current_date - 30, current_date + 200),
  ('f9c30000-0000-4000-8000-000000000004', 'f9c10000-0000-4000-8000-000000000002',
   'f9c00000-0000-4000-8000-000000000004', 'f9c20000-0000-4000-8000-000000000002', 'active', current_date - 30, current_date + 200),
  ('f9c30000-0000-4000-8000-000000000005', 'f9c10000-0000-4000-8000-000000000001',
   'f9c00000-0000-4000-8000-000000000005', 'f9c20000-0000-4000-8000-000000000001', 'active', current_date - 30, current_date + 200);
-- Every enrollment made before 20261005130000 holds a snapshot of the module
-- config as it was at enrollment.
insert into public.enrollment_module_snapshots (enrollment_id, programme_module_id, module, required,
  required_units, starts_on, ends_on, config)
select e.id, pm.id, pm.module, true, (pm.config->>'required_units')::int, e.start_date, e.end_date, pm.config
from public.programme_enrollments e
join public.programme_modules pm on pm.programme_id = e.programme_id
where e.id in ('f9c30000-0000-4000-8000-000000000002', 'f9c30000-0000-4000-8000-000000000005');
insert into public.coachee_goals (coachee_id, enrollment_id, title) values
  ('f9c00000-0000-4000-8000-000000000002', 'f9c30000-0000-4000-8000-000000000002', 'Quantity goal'),
  ('f9c00000-0000-4000-8000-000000000004', 'f9c30000-0000-4000-8000-000000000004', 'Quantity goal');
insert into public.coachee_coach_allowlist (coachee_id, coach_id) values
  ('f9c00000-0000-4000-8000-000000000004', 'f9c00000-0000-4000-8000-000000000001');

-- Learner A has booked both Coaching units with Coach K and the one Mentoring
-- unit with Mentor M: everything the programme required at enrollment.
select set_config('app.session_transition', 'on', true);
insert into public.sessions (id, enrollment_id, cohort_requirement_id, coach_id, coachee_id, topic,
  start_time, duration_minutes, status)
select gen_random_uuid(), 'f9c30000-0000-4000-8000-000000000002', r.id,
  'f9c00000-0000-4000-8000-000000000001', 'f9c00000-0000-4000-8000-000000000002',
  'Quantity ' || r.ordinal, now() + (r.ordinal || ' days')::interval, 60, 'pending_coach_approval'
from public.cohort_requirement_dates r
where r.cohort_id = 'f9c20000-0000-4000-8000-000000000001' and r.module = 'coaching';
insert into public.mentoring_sessions (id, enrollment_id, cohort_requirement_id, mentor_id, mentee_id, topic,
  start_time, duration_minutes, status)
select gen_random_uuid(), 'f9c30000-0000-4000-8000-000000000002', r.id,
  'f9c00000-0000-4000-8000-000000000001', 'f9c00000-0000-4000-8000-000000000002',
  'Quantity mentoring', now() + interval '5 days', 60, 'pending_coach_approval'
from public.cohort_requirement_dates r
where r.cohort_id = 'f9c20000-0000-4000-8000-000000000001' and r.module = 'mentoring';
select set_config('app.session_transition', 'off', true);

-- ---------------------------------------------------------------------------
-- c. Snapshots are historical
-- ---------------------------------------------------------------------------
select hasnt_trigger('public', 'enrollment_module_snapshots', 'enrollment_module_snapshot_capture_config',
  'the snapshot config capture trigger is dropped');

-- ---------------------------------------------------------------------------
-- a. Before the Admin change: all units taken, every reader agrees
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'f9c00000-0000-4000-8000-000000000002')::text, true);

select is((select coaching_required_units from public.learner_canonical_progress('f9c30000-0000-4000-8000-000000000002')),
  2, 'learner_canonical_progress: Coaching requires 2');
select is(public.check_can_book_session('f9c00000-0000-4000-8000-000000000001', 'f9c30000-0000-4000-8000-000000000002'),
  false, 'both Coaching units booked: not eligible');
select is(public.check_can_book_mentoring_session_reason_for_enrollment('f9c00000-0000-4000-8000-000000000001', 'f9c30000-0000-4000-8000-000000000002'),
  'received_limit_reached', 'the Mentoring unit booked: no free requirement');

-- ---------------------------------------------------------------------------
-- The Admin raises Coaching 2 -> 3 and Mentoring 1 -> 2
-- ---------------------------------------------------------------------------
reset role;
update public.programme_modules
   set config = config || '{"required_units": 3}'
 where programme_id = 'f9c10000-0000-4000-8000-000000000001' and module = 'coaching';
update public.programme_modules
   set config = config || '{"required_units": 2}'
 where programme_id = 'f9c10000-0000-4000-8000-000000000001' and module = 'mentoring';
update public.cohort_requirement_dates
   set due_on = current_date + 10 + ordinal * 30, is_overridden = true,
       generation_method = 'manual', materialized_via = 'admin_save'
 where cohort_id = 'f9c20000-0000-4000-8000-000000000001' and not is_overridden;

select is((select count(*)::int from public.enrollment_module_snapshots
           where enrollment_id = 'f9c30000-0000-4000-8000-000000000002' and module = 'coaching'
             and (config->>'required_units')::int = 3),
  0, 'fixture: the enrollment snapshot still says 2 Coaching units');
select is(public.enrollment_module_config('f9c30000-0000-4000-8000-000000000002', 'coaching')->>'required_units',
  '3', 'enrollment_module_config reads the programme config');
select is(public.programme_required_units('f9c30000-0000-4000-8000-000000000002', 'coaching'),
  3, 'programme_required_units: Coaching requires 3');
select is(public.programme_required_units('f9c30000-0000-4000-8000-000000000002', 'mentoring'),
  2, 'programme_required_units: Mentoring requires 2');

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'f9c00000-0000-4000-8000-000000000002')::text, true);

select is((select config->>'required_units' from public.get_enrollment_programme_modules('f9c30000-0000-4000-8000-000000000002')
           where module = 'coaching'),
  '3', 'get_enrollment_programme_modules: Coaching requires 3');
select is((select coaching_required_units from public.learner_canonical_progress('f9c30000-0000-4000-8000-000000000002')),
  3, 'learner_canonical_progress: Coaching requires 3');
select is((select ordinal from public.learner_next_coaching_requirement('f9c30000-0000-4000-8000-000000000002')),
  3, 'the next Coaching requirement is unit 3');
select is(public.check_can_book_session('f9c00000-0000-4000-8000-000000000001', 'f9c30000-0000-4000-8000-000000000002'),
  true, 'Coaching unit 3 is free: eligible');
select is(
  (select coaching_required_units - coaching_booked_units - coaching_completed_units > 0
   from public.learner_canonical_progress('f9c30000-0000-4000-8000-000000000002')),
  public.check_can_book_session('f9c00000-0000-4000-8000-000000000001', 'f9c30000-0000-4000-8000-000000000002'),
  'eligibility agrees with learner_canonical_progress (units left to book)');
select is((select mentoring_required_units from public.learner_canonical_progress('f9c30000-0000-4000-8000-000000000002')),
  2, 'learner_canonical_progress: Mentoring requires 2');
select is(public.check_can_book_mentoring_session_reason_for_enrollment('f9c00000-0000-4000-8000-000000000001', 'f9c30000-0000-4000-8000-000000000002'),
  'ok', 'Mentoring unit 2 is free: eligible (the Mentor give_limit of 1 no longer applies)');

-- ---------------------------------------------------------------------------
-- b. Pool and goal gate
-- ---------------------------------------------------------------------------
select is(public.check_can_book_session('f9c00000-0000-4000-8000-000000000003', 'f9c30000-0000-4000-8000-000000000002'),
  false, 'a Coach outside the cohort pool: not eligible');
select is(public.check_can_book_mentoring_session_reason_for_enrollment('f9c00000-0000-4000-8000-000000000003', 'f9c30000-0000-4000-8000-000000000002'),
  'not_in_cohort_pool', 'a Mentor outside the cohort pool: not eligible');

-- Learner B: every unit free, Coach K in the pool, no goal yet.
select set_config('request.jwt.claims', json_build_object('sub', 'f9c00000-0000-4000-8000-000000000005')::text, true);
select is(public.check_can_book_session('f9c00000-0000-4000-8000-000000000001', 'f9c30000-0000-4000-8000-000000000005'),
  false, 'no active goal: Coaching not eligible');
select is(public.check_can_book_mentoring_session_reason_for_enrollment('f9c00000-0000-4000-8000-000000000001', 'f9c30000-0000-4000-8000-000000000005'),
  'goal_required_before_booking', 'no active goal: Mentoring reports the goal gate');
select is(public.can_book_mentoring_session_reason('f9c00000-0000-4000-8000-000000000005', 'f9c00000-0000-4000-8000-000000000001', 'f9c30000-0000-4000-8000-000000000005'),
  'goal_required_before_booking', 'the goal gate is part of the eligibility rule itself');

-- The retired path: no Coaching requirement, an allowlisted Coach, a
-- receive_limit and a programme session limit with room left.
select set_config('request.jwt.claims', json_build_object('sub', 'f9c00000-0000-4000-8000-000000000004')::text, true);
select is(public.check_can_book_session('f9c00000-0000-4000-8000-000000000001', 'f9c30000-0000-4000-8000-000000000004'),
  false, 'no Coaching requirement: not eligible, whatever the allowlist or receive_limit');
reset role;

select ok(
  not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('enrollment_module_config', 'programme_required_units', 'get_enrollment_programme_modules')
      and p.prosrc ~ 'enrollment_module_snapshots'),
  'no quantity function reads enrollment_module_snapshots');
select ok(
  not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('can_book_session', 'can_book_mentoring_session_reason')
      and p.prosrc ~ '(receive_limit|coachee_session_limit|give_limit)'),
  'eligibility reads no session limit');
select ok(
  (select bool_and(p.prosrc ~ 'next_(coaching|mentoring)_requirement' and p.prosrc ~ 'enrollment_goal_gate_blocked')
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.oid in ('public.can_book_session(uuid,uuid,uuid)'::regprocedure,
                                             'public.can_book_mentoring_session_reason(uuid,uuid,uuid)'::regprocedure)),
  'eligibility is the next requirement + the goal gate');

select * from finish();
rollback;
