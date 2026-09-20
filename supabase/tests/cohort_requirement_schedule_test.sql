-- Canonical requirement model: Programme says HOW MANY, Cohort says BY WHEN.
--
--   PROGRAMME   module + required_units = N
--   COHORT      one completion_deadline per module
--   SYSTEM      exactly N canonical requirement rows, all due on that deadline
--   ACTIVITY    fulfils one canonical requirement at a time
--
-- There is no distribution mode. Every module that has canonical requirements
-- behaves identically, and requirement IDENTITY (ordinal) carries the sequence
-- rather than the dates.
begin;

select plan(39);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_user_meta_data, created_at, updated_at, confirmation_token,
  email_change_token_new, recovery_token
)
select
  ('a8000000-0000-0000-0000-00000000000' || n)::uuid,
  '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated',
  'crd-learner-' || n || '@example.test', 'test', now(),
  jsonb_build_object('full_name', 'CRD Learner ' || n), now(), now(), '', '', ''
from generate_series(1, 5) as n
union all
select ('a8000000-0000-0000-0000-0000000000' || suffix)::uuid,
  '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated',
  'crd-' || suffix || '@example.test', 'test', now(),
  jsonb_build_object('full_name', 'CRD ' || suffix), now(), now(), '', '', ''
from unnest(array['97', '98', '99']) as suffix;

insert into public.organizations (id, name)
values ('b8000000-0000-0000-0000-000000000001', 'CRD organization');

insert into public.user_roles (user_id, role)
values
  ('a8000000-0000-0000-0000-000000000097', 'coach'),
  ('a8000000-0000-0000-0000-000000000098', 'admin'),
  ('a8000000-0000-0000-0000-000000000099', 'sponsor');
insert into public.coach_profiles (id, approval_status, peer_coaching_opt_in)
values ('a8000000-0000-0000-0000-000000000097', 'active', false);
insert into public.sponsor_profiles (user_id, organization_id)
values ('a8000000-0000-0000-0000-000000000099', 'b8000000-0000-0000-0000-000000000001');

insert into public.programmes (id, name)
values ('c8000000-0000-0000-0000-000000000001', 'CRD Emerging Leaders');

-- Four modules, four different unit counts. None of them names a schedule.
insert into public.programme_modules (programme_id, module, enabled, config)
values
  ('c8000000-0000-0000-0000-000000000001', 'coaching', true, '{"required":true,"required_units":3,"receive_limit":9}'),
  ('c8000000-0000-0000-0000-000000000001', 'peer_coaching', true, '{"required":true,"required_units":2}'),
  ('c8000000-0000-0000-0000-000000000001', 'mentoring', true, '{"required":true,"required_units":2}'),
  ('c8000000-0000-0000-0000-000000000001', 'triads', true, '{"required":true,"required_units":2}');

-- ---------------------------------------------------------------------------
-- 1. Creating the cohort materialises N requirements per module
-- ---------------------------------------------------------------------------
insert into public.cohorts (id, name, programme_id, start_date, end_date, organization_id)
values ('d8000000-0000-0000-0000-000000000001', 'CRD Cohort', 'c8000000-0000-0000-0000-000000000001',
        '2026-01-05', '2026-12-31', 'b8000000-0000-0000-0000-000000000001');

select is(
  (select array_agg(n order by m) from (
     select d.module::text m, count(*)::int n
     from public.cohort_requirement_dates d
     where d.cohort_id = 'd8000000-0000-0000-0000-000000000001'::uuid
     group by d.module) s),
  array[3, 2, 2, 2],
  'required_units becomes exactly that many canonical requirements (coaching 3, mentoring 2, peer 2, triads 2)');

select is(
  (select count(distinct due_on)::int from public.cohort_requirement_dates
   where cohort_id = 'd8000000-0000-0000-0000-000000000001'::uuid
     and module = 'coaching'::public.programme_module_type),
  1,
  'all three Coaching requirements share one completion deadline');

select is(
  (select array_agg(distinct due_on) from public.cohort_requirement_dates
   where cohort_id = 'd8000000-0000-0000-0000-000000000001'::uuid),
  array['2026-12-31'::date],
  'the default deadline is the cohort end date, for every module');

select is(
  (select array_agg(distinct source) from public.cohort_module_deadlines
   where cohort_id = 'd8000000-0000-0000-0000-000000000001'::uuid),
  array['cohort_end'],
  'a deadline nobody chose is recorded as the cohort default, not as an Admin decision');

select is(
  (select array_agg(ordinal order by ordinal) from public.cohort_requirement_dates
   where cohort_id = 'd8000000-0000-0000-0000-000000000001'::uuid
     and module = 'coaching'::public.programme_module_type),
  array[1, 2, 3],
  'requirement identity is 1..N even though the dates are identical');

select is(
  (select count(*)::int from public.cohort_requirement_dates where units <> 1),
  0,
  'one requirement row is one required unit');

-- ---------------------------------------------------------------------------
-- 2. Module-specific deadlines
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', 'a8000000-0000-0000-0000-000000000098', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

select lives_ok($$
  select public.admin_set_cohort_module_deadlines(
    'd8000000-0000-0000-0000-000000000001'::uuid,
    jsonb_build_array(
      jsonb_build_object('programme_id', 'c8000000-0000-0000-0000-000000000001', 'module', 'coaching', 'completion_deadline', '2026-11-30'),
      jsonb_build_object('programme_id', 'c8000000-0000-0000-0000-000000000001', 'module', 'peer_coaching', 'completion_deadline', '2026-09-30'))
  )
$$, 'an Admin sets one completion deadline per module');

reset role;

select is(
  (select array_agg(distinct due_on) from public.cohort_requirement_dates
   where cohort_id = 'd8000000-0000-0000-0000-000000000001'::uuid
     and module = 'coaching'::public.programme_module_type),
  array['2026-11-30'::date],
  'every Coaching requirement moves with the Coaching deadline');

select is(
  (select array_agg(distinct due_on) from public.cohort_requirement_dates
   where cohort_id = 'd8000000-0000-0000-0000-000000000001'::uuid
     and module = 'peer_coaching'::public.programme_module_type),
  array['2026-09-30'::date],
  'Peer keeps its own earlier deadline: a deadline is module-specific');

select is(
  (select array_agg(distinct due_on) from public.cohort_requirement_dates
   where cohort_id = 'd8000000-0000-0000-0000-000000000001'::uuid
     and module = 'mentoring'::public.programme_module_type),
  array['2026-12-31'::date],
  'Mentoring is untouched by the Coaching and Peer deadlines');

-- ---------------------------------------------------------------------------
-- 3. Progress semantics (Cases A-D), from a real enrollment
-- ---------------------------------------------------------------------------
insert into public.profiles (id, full_name, email, status)
select id, coalesce(raw_user_meta_data->>'full_name', 'CRD'), email, 'active'
from auth.users where email like 'crd-%'
on conflict (id) do nothing;

insert into public.programme_enrollments (id, user_id, programme_id, cohort_id, organization_id, start_date, end_date, status)
values
  ('e8000000-0000-0000-0000-000000000001', 'a8000000-0000-0000-0000-000000000001',
   'c8000000-0000-0000-0000-000000000001', 'd8000000-0000-0000-0000-000000000001',
   'b8000000-0000-0000-0000-000000000001', '2026-01-05', '2026-12-31', 'active'),
  -- A historical enrollment of the SAME learner, in the same cohort window.
  ('e8000000-0000-0000-0000-000000000002', 'a8000000-0000-0000-0000-000000000001',
   'c8000000-0000-0000-0000-000000000001', 'd8000000-0000-0000-0000-000000000001',
   'b8000000-0000-0000-0000-000000000001', '2025-01-05', '2025-12-31', 'completed');

-- Case A: deadline in the future, nothing done.
select is(
  (select array[required_units, completed_units, due_units, overdue_units]
   from public.canonical_module_progress('e8000000-0000-0000-0000-000000000001'::uuid, '2026-06-01')
   where module = 'coaching'::public.programme_module_type),
  array[3, 0, 0, 0],
  'A. before the deadline: required 3, completed 0, due 0, overdue 0');

-- One completed Coaching session, attributed to the first requirement. The
-- lifecycle escape hatch is used because this fixture writes the session
-- directly rather than going through book_coaching_session().
select set_config('app.session_transition', 'on', true);

insert into public.sessions
  (id, enrollment_id, cohort_requirement_id, coach_id, coachee_id, topic, start_time, duration_minutes, status)
select 'f8000000-0000-0000-0000-000000000001'::uuid,
       'e8000000-0000-0000-0000-000000000001'::uuid, d.id,
       'a8000000-0000-0000-0000-000000000097'::uuid, 'a8000000-0000-0000-0000-000000000001'::uuid,
       'Coaching 1', timestamptz '2026-03-02 09:00+00', 60, 'completed'
from public.cohort_requirement_dates d
where d.cohort_id = 'd8000000-0000-0000-0000-000000000001'::uuid
  and d.module = 'coaching'::public.programme_module_type and d.ordinal = 1;

-- Case B: one of three done, still before the deadline.
select is(
  (select array[required_units, completed_units, due_units, overdue_units]
   from public.canonical_module_progress('e8000000-0000-0000-0000-000000000001'::uuid, '2026-06-01')
   where module = 'coaching'::public.programme_module_type),
  array[3, 1, 0, 0],
  'B. one of three completed before the deadline: due 0, overdue 0');

-- Case C: past the deadline.
select is(
  (select array[required_units, completed_units, due_units, overdue_units]
   from public.canonical_module_progress('e8000000-0000-0000-0000-000000000001'::uuid, '2026-12-01')
   where module = 'coaching'::public.programme_module_type),
  array[3, 1, 3, 2],
  'C. on/after the deadline: due 3, overdue 2');

insert into public.sessions
  (id, enrollment_id, cohort_requirement_id, coach_id, coachee_id, topic, start_time, duration_minutes, status)
select ('f8000000-0000-0000-0000-00000000000' || d.ordinal)::uuid,
       'e8000000-0000-0000-0000-000000000001'::uuid, d.id,
       'a8000000-0000-0000-0000-000000000097'::uuid, 'a8000000-0000-0000-0000-000000000001'::uuid,
       'Coaching ' || d.ordinal, timestamptz '2026-03-02 09:00+00' + (d.ordinal * interval '7 days'), 60, 'completed'
from public.cohort_requirement_dates d
where d.cohort_id = 'd8000000-0000-0000-0000-000000000001'::uuid
  and d.module = 'coaching'::public.programme_module_type and d.ordinal in (2, 3);

select set_config('app.session_transition', 'off', true);

-- Case D: all three done.
select is(
  (select array[required_units, completed_units, due_units, overdue_units]
   from public.canonical_module_progress('e8000000-0000-0000-0000-000000000001'::uuid, '2026-12-01')
   where module = 'coaching'::public.programme_module_type),
  array[3, 3, 3, 0],
  'D. everything completed: overdue 0 even past the deadline');

-- ---------------------------------------------------------------------------
-- 4. Case E: next_*_requirement advances across every canonical unit
-- ---------------------------------------------------------------------------
select is(
  (select count(*)::int from public.canonical_coaching_requirement_fulfilment('e8000000-0000-0000-0000-000000000001'::uuid)),
  3,
  'E. canonical Coaching fulfilment reports one row per required unit');

select is(
  (select count(*)::int from public.next_coaching_requirement('e8000000-0000-0000-0000-000000000001'::uuid)),
  0,
  'E. no Coaching requirement is left once all three are fulfilled');

select is(
  (select r.ordinal from public.next_mentoring_requirement('e8000000-0000-0000-0000-000000000001'::uuid) r),
  1,
  'E. Mentoring starts at its first canonical unit');

select is(
  (select r.ordinal from public.next_peer_requirement('e8000000-0000-0000-0000-000000000001'::uuid) r),
  1,
  'E. Peer starts at its first canonical unit');

-- ---------------------------------------------------------------------------
-- 5. Case F: historical enrollment isolation
-- ---------------------------------------------------------------------------
select is(
  (select completed_units from public.canonical_module_progress('e8000000-0000-0000-0000-000000000002'::uuid, '2026-12-01')
   where module = 'coaching'::public.programme_module_type),
  0,
  'F. the same learner''s historical enrollment gains nothing from the current one');

select is(
  (select count(*)::int from public.canonical_coaching_requirement_fulfilment('e8000000-0000-0000-0000-000000000002'::uuid) f
   where f.fulfilled_on is not null),
  0,
  'F. requirements are fulfilled per enrollment, never per user');

-- ---------------------------------------------------------------------------
-- 6. required_units changes propagate
-- ---------------------------------------------------------------------------
update public.programme_modules
set config = '{"required":true,"required_units":5,"receive_limit":9}'
where programme_id = 'c8000000-0000-0000-0000-000000000001'
  and module = 'coaching'::public.programme_module_type;

select is(
  (select count(*)::int from public.cohort_requirement_dates
   where cohort_id = 'd8000000-0000-0000-0000-000000000001'::uuid
     and module = 'coaching'::public.programme_module_type),
  5,
  'raising required_units 3 -> 5 materialises the two missing canonical units');

select is(
  (select count(distinct due_on)::int from public.cohort_requirement_dates
   where cohort_id = 'd8000000-0000-0000-0000-000000000001'::uuid
     and module = 'coaching'::public.programme_module_type),
  1,
  'the new units inherit the same module deadline');

select is(
  (select required_units from public.canonical_module_progress('e8000000-0000-0000-0000-000000000001'::uuid, '2026-12-01')
   where module = 'coaching'::public.programme_module_type),
  5,
  'progress follows the programme immediately: 3 of 5');

update public.programme_modules
set config = '{"required":true,"required_units":2,"receive_limit":9}'
where programme_id = 'c8000000-0000-0000-0000-000000000001'
  and module = 'coaching'::public.programme_module_type;

select is(
  (select count(*)::int from public.cohort_requirement_dates
   where cohort_id = 'd8000000-0000-0000-0000-000000000001'::uuid
     and module = 'coaching'::public.programme_module_type),
  3,
  'lowering required_units to 2 drops the empty units but keeps the three that carry a session');

select is(
  (select count(*)::int from public.sessions where enrollment_id = 'e8000000-0000-0000-0000-000000000001'::uuid
     and cohort_requirement_id is null),
  0,
  'no completed session loses its requirement when the programme shrinks');

update public.programme_modules
set config = '{"required":true,"required_units":3,"receive_limit":9}'
where programme_id = 'c8000000-0000-0000-0000-000000000001'
  and module = 'coaching'::public.programme_module_type;

-- ---------------------------------------------------------------------------
-- 7. A cohort end-date change moves only the deadlines the system chose
-- ---------------------------------------------------------------------------
update public.cohorts set end_date = '2027-02-28'
where id = 'd8000000-0000-0000-0000-000000000001';

select is(
  (select completion_deadline from public.cohort_module_deadlines
   where cohort_id = 'd8000000-0000-0000-0000-000000000001'::uuid
     and module = 'mentoring'::public.programme_module_type),
  '2027-02-28'::date,
  'a deadline the system defaulted from the cohort end follows the cohort');

select is(
  (select completion_deadline from public.cohort_module_deadlines
   where cohort_id = 'd8000000-0000-0000-0000-000000000001'::uuid
     and module = 'coaching'::public.programme_module_type),
  '2026-11-30'::date,
  'a deadline an Admin chose is never silently rewritten by a cohort date change');

-- ---------------------------------------------------------------------------
-- 8. Authorisation and validation
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', 'a8000000-0000-0000-0000-000000000001', true);
set local role authenticated;

select throws_ok($$
  select public.admin_set_cohort_module_deadlines(
    'd8000000-0000-0000-0000-000000000001'::uuid,
    jsonb_build_array(jsonb_build_object('programme_id', 'c8000000-0000-0000-0000-000000000001',
                                         'module', 'coaching', 'completion_deadline', '2026-10-01')))
$$, '42501', NULL, 'a learner cannot set a cohort completion deadline');

select throws_ok($$
  select public.admin_cohort_module_deadlines('d8000000-0000-0000-0000-000000000001'::uuid)
$$, '42501', NULL, 'a learner cannot read the Admin deadline configuration');

select is(
  (select count(*)::int from public.cohort_module_deadlines),
  0,
  'the deadline table itself is closed to a learner by RLS');

reset role;
select set_config('request.jwt.claim.sub', 'a8000000-0000-0000-0000-000000000098', true);
set local role authenticated;

select throws_ok($$
  select public.admin_set_cohort_module_deadlines(
    'd8000000-0000-0000-0000-000000000001'::uuid,
    jsonb_build_array(jsonb_build_object('programme_id', 'c8000000-0000-0000-0000-000000000001',
                                         'module', 'coaching', 'completion_deadline', '2030-01-01')))
$$, '22023', NULL, 'a completion deadline outside the cohort window is refused');

select throws_ok($$
  select public.admin_set_cohort_module_deadlines(
    'd8000000-0000-0000-0000-000000000001'::uuid,
    jsonb_build_array(jsonb_build_object('programme_id', 'c8000000-0000-0000-0000-000000000001',
                                         'module', 'quiz', 'completion_deadline', '2026-10-01')))
$$, '22023', NULL, 'a module the programme does not require cannot be given a deadline');

select is(
  (select array_agg(module::text order by module::text)
   from public.cohort_module_deadline_proposal('c8000000-0000-0000-0000-000000000001'::uuid, '2026-12-31')),
  array['coaching', 'mentoring', 'peer_coaching', 'triads'],
  'the new-cohort proposal offers one deadline per required module');

select is(
  (select array_agg(distinct completion_deadline)
   from public.cohort_module_deadline_proposal('c8000000-0000-0000-0000-000000000001'::uuid, '2026-12-31')),
  array['2026-12-31'::date],
  'the proposed deadline is the cohort end date the Admin is entering');

reset role;

-- ---------------------------------------------------------------------------
-- 9. A cohort with no end date invents nothing
-- ---------------------------------------------------------------------------
insert into public.cohorts (id, name, programme_id, start_date, end_date, organization_id)
values ('d8000000-0000-0000-0000-000000000002', 'CRD Undated', 'c8000000-0000-0000-0000-000000000001',
        '2026-01-05', NULL, 'b8000000-0000-0000-0000-000000000001');

select is(
  (select count(*)::int from public.cohort_module_deadlines
   where cohort_id = 'd8000000-0000-0000-0000-000000000002'::uuid),
  0,
  'no cohort end date means no fabricated deadline');

select is(
  (select count(*)::int from public.cohort_requirement_dates
   where cohort_id = 'd8000000-0000-0000-0000-000000000002'::uuid),
  0,
  'and therefore no requirement is materialised against a date nobody set');

select set_config('request.jwt.claim.sub', 'a8000000-0000-0000-0000-000000000098', true);
set local role authenticated;
select is(
  (select array_agg(distinct issue) from public.cohort_requirement_schedule_issues('d8000000-0000-0000-0000-000000000002'::uuid)),
  array['missing_dates', 'missing_deadline'],
  'the gap is reported to the Admin rather than hidden');
reset role;

-- ---------------------------------------------------------------------------
-- 10. The concept is gone from the schema
-- ---------------------------------------------------------------------------
select is(
  (select count(*)::int from pg_proc p
   join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
   where p.prokind = 'f'
     and p.proname in ('sync_cohort_requirement_dates', 'cohort_required_module_units',
                       'admin_set_cohort_module_deadlines', 'cohort_module_deadline_proposal')
     and regexp_replace(pg_get_functiondef(p.oid), '--[^\n]*', '', 'g') ~ 'distribution_mode'),
  0,
  'no requirement-scheduling function reads a distribution mode');

select is(
  (select count(*)::int from pg_proc p
   join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
   where p.proname in ('cohort_requirement_proposal_internal', 'cohort_requirement_schedule_proposal',
                       'admin_save_cohort_requirement_dates', 'materialize_missing_cohort_requirement_dates')),
  0,
  'the distribution-mode generator and the per-unit Admin editor no longer exist');

select * from finish();
rollback;
