-- Triad canonical contract. EVERY REQUIRED TRIAD HAS ITS OWN GROUP ASSIGNMENT.
--   PROGRAMME   = how many Triads are required (programme_modules)
--   REQUIREMENT = the cohort's Triad 1..N, each with its own deadline
--                 (cohort_requirement_dates — the only Triad "round")
--   GROUP       = the enrollments assigned together for ONE requirement
--                 (triad_groups.cohort_requirement_date_id)
--   SESSION     = the actual practice session of that group
--   FULFILMENT  = a completed session of a requirement's group fulfils THAT
--                 requirement, once, for every member
--   PROGRESS    = fulfilled requirements, capped at required, each against
--                 its own deadline
-- Admin, Learner, Sponsor (and a coach enrolled as a learner) read the same
-- Triad facts; privacy may hide reflection detail, never change a fact.
--
-- Cohort C1 (programme P, Triads required 2, Triad 1 due today-30, Triad 2
-- due today+30): E1..E6 active, E7 completed (not eligible), E8 in cohort C2
-- (never assignable to C1). E6's learner is also a coach.
-- Cohort DC (programme PD, Triads required 2, Triad 1 due 2026-04-05,
-- Triad 2 due 2026-07-05): F1..F12 for the completion and due/overdue scenarios.
begin;

select plan(155);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_user_meta_data, created_at, updated_at, confirmation_token, email_change_token_new, recovery_token)
select ('a8800000-0000-0000-0000-0000000000' || lpad(n::text, 2, '0'))::uuid, '00000000-0000-0000-0000-000000000000'::uuid,
  'authenticated', 'authenticated', 'triad-contract-' || n || '@example.test', 'test', now(),
  jsonb_build_object('full_name', 'Triad Learner ' || n), now(), now(), '', '', ''
from generate_series(1, 22) n
union all
select ('a8800000-0000-0000-0000-0000000000' || s)::uuid, '00000000-0000-0000-0000-000000000000'::uuid,
  'authenticated', 'authenticated', 'triad-contract-' || s || '@example.test', 'test', now(),
  jsonb_build_object('full_name', 'Triad ' || s), now(), now(), '', '', ''
from unnest(array['98', '99']) s;

insert into public.organizations (id, name) values ('b8800000-0000-0000-0000-000000000001', 'Triad contract org');
insert into public.user_roles (user_id, role) values
  ('a8800000-0000-0000-0000-000000000006', 'coach'),
  ('a8800000-0000-0000-0000-000000000098', 'admin'),
  ('a8800000-0000-0000-0000-000000000099', 'sponsor');
insert into public.sponsor_profiles (user_id, organization_id)
values ('a8800000-0000-0000-0000-000000000099', 'b8800000-0000-0000-0000-000000000001');

insert into public.programmes (id, name) values
  ('c8800000-0000-0000-0000-000000000001', 'Triad contract programme'),
  ('c8800000-0000-0000-0000-000000000002', 'Flexible Triad programme'),
  ('c8800000-0000-0000-0000-000000000003', 'Dated Triad programme'),
  ('c8800000-0000-0000-0000-000000000004', 'No-Triad programme');
insert into public.cohorts (id, name, programme_id, organization_id, start_date, end_date) values
  ('d8800000-0000-0000-0000-000000000001', 'C1', 'c8800000-0000-0000-0000-000000000001', 'b8800000-0000-0000-0000-000000000001', current_date - 120, current_date + 120),
  ('d8800000-0000-0000-0000-000000000002', 'C2', 'c8800000-0000-0000-0000-000000000001', 'b8800000-0000-0000-0000-000000000001', current_date - 120, current_date + 120),
  ('d8800000-0000-0000-0000-000000000003', 'Flex cohort', 'c8800000-0000-0000-0000-000000000002', 'b8800000-0000-0000-0000-000000000001', current_date - 120, current_date + 120),
  ('d8800000-0000-0000-0000-000000000004', 'DC', 'c8800000-0000-0000-0000-000000000003', 'b8800000-0000-0000-0000-000000000001', '2026-01-05', '2026-07-31'),
  ('d8800000-0000-0000-0000-000000000005', 'No-Triad cohort', 'c8800000-0000-0000-0000-000000000004', 'b8800000-0000-0000-0000-000000000001', current_date - 120, current_date + 120);
insert into public.programme_modules (programme_id, module, enabled, config) values
  ('c8800000-0000-0000-0000-000000000001', 'triads', true, '{"required":true,"required_units":2}'),
  ('c8800000-0000-0000-0000-000000000002', 'triads', true, '{"required":true,"required_units":3}'),
  ('c8800000-0000-0000-0000-000000000003', 'triads', true, '{"required":true,"required_units":2}'),
  ('c8800000-0000-0000-0000-000000000004', 'triads', true, '{"group_size":3}');

-- The COHORT says by when Triads must be complete. Both required units of a
-- cohort share that one deadline; which unit a group fulfils is decided by the
-- requirement it is created against, never by the date.
update public.cohort_module_deadlines set completion_deadline = current_date - 30
 where cohort_id in ('d8800000-0000-0000-0000-000000000001'::uuid, 'd8800000-0000-0000-0000-000000000002'::uuid)
   and module = 'triads'::public.programme_module_type;
update public.cohort_module_deadlines set completion_deadline = '2026-04-05'::date
 where cohort_id = 'd8800000-0000-0000-0000-000000000004'::uuid
   and module = 'triads'::public.programme_module_type;

insert into public.programme_enrollments (id, user_id, programme_id, cohort_id, organization_id, start_date, end_date, status)
select ('e8800000-0000-0000-0000-00000000000' || n)::uuid, ('a8800000-0000-0000-0000-0000000000' || lpad(n::text, 2, '0'))::uuid,
  'c8800000-0000-0000-0000-000000000001'::uuid,
  case when n = 8 then 'd8800000-0000-0000-0000-000000000002' else 'd8800000-0000-0000-0000-000000000001' end::uuid,
  'b8800000-0000-0000-0000-000000000001'::uuid, current_date - 120, current_date + 120,
  case when n = 7 then 'completed' else 'active' end::public.enrollment_status
from generate_series(1, 8) n
union all
select ('f8800000-0000-0000-0000-0000000000' || lpad(n::text, 2, '0'))::uuid, ('a8800000-0000-0000-0000-0000000000' || (10 + n))::uuid,
  'c8800000-0000-0000-0000-000000000003'::uuid, 'd8800000-0000-0000-0000-000000000004'::uuid,
  'b8800000-0000-0000-0000-000000000001'::uuid, '2026-01-05'::date, '2026-07-31'::date, 'active'::public.enrollment_status
from generate_series(1, 12) n;
-- A learner of the No-Triad programme placed in cohort C1 (a cohort can
-- schedule several programmes).
insert into public.programme_enrollments (id, user_id, programme_id, cohort_id, organization_id, start_date, end_date, status)
values ('e8800000-0000-0000-0000-000000000009', 'a8800000-0000-0000-0000-000000000009', 'c8800000-0000-0000-0000-000000000004',
  'd8800000-0000-0000-0000-000000000001', 'b8800000-0000-0000-0000-000000000001', current_date - 120, current_date + 120, 'active');

create temporary table unit (n integer primary key, id uuid, due_on date);
insert into unit select d.ordinal, d.id, d.due_on from public.cohort_requirement_dates d
where d.cohort_id = 'd8800000-0000-0000-0000-000000000001' and d.module = 'triads'
  and d.programme_id = 'c8800000-0000-0000-0000-000000000001';
grant select on unit to authenticated;
create temporary table dcu (n integer primary key, id uuid);
insert into dcu select d.ordinal, d.id from public.cohort_requirement_dates d
where d.cohort_id = 'd8800000-0000-0000-0000-000000000004' and d.module = 'triads';
grant select on dcu to authenticated;

-- ===========================================================================
-- PROGRAMME / COHORT / NO ROUND
-- ===========================================================================
select results_eq(
  $$select n, due_on from unit order by n$$,
  $$values (1, current_date - 30), (2, current_date - 30)$$,
  'A. Triads required = 2 -> exactly two cohort Triad requirements (Triad 1, Triad 2), both on the cohort''s one Triads deadline');
select is(
  (select count(*)::integer || '/' || max(units) from public.cohort_requirement_dates
   where cohort_id = 'd8800000-0000-0000-0000-000000000003' and module = 'triads'),
  '3/1', '1b. flexible Triads required = 3 materialize as three single-unit requirements');
select throws_ok(
  $$insert into public.cohort_requirement_dates (cohort_id, programme_id, module, ordinal, due_on, units, generation_method, materialized_via)
    values ('d8800000-0000-0000-0000-000000000001', 'c8800000-0000-0000-0000-000000000001', 'triads', 9, current_date, 2, 'manual', 'admin_save')$$,
  '23514', null, '2. a Triad requirement is always one unit');
select col_not_null('public', 'triad_groups', 'cohort_requirement_date_id', '4. every group is assigned for one cohort Triad requirement');
select fk_ok('public', 'triad_groups', 'cohort_requirement_date_id', 'public', 'cohort_requirement_dates', 'id',
  '4a. the group references the requirement that owns the deadline (the group owns no date)');
select col_not_null('public', 'triad_groups', 'cohort_id', '4b. the group''s cohort is kept (derived from the requirement)');
select ok((to_regclass('public.triad_rounds') is null or not has_table_privilege('authenticated', 'public.triad_rounds', 'SELECT'))
  and (to_regclass('public.programme_triad_rounds') is null or not has_table_privilege('authenticated', 'public.programme_triad_rounds', 'SELECT')),
  '4c. there is no Triad round: legacy round tables are unreachable (dropped in deployment 2)');
select hasnt_table('public', 'cohort_triad_operations', '4d. no replacement round/operations structure exists');
select hasnt_function('public', 'triad_requirement_units_internal', '4e. no legacy per-unit Triad construction remains');
select hasnt_function('public', 'triad_cohort_candidates_internal', '4f. the cohort-scoped assignment pool is gone (assignment is per requirement)');

-- ===========================================================================
-- GROUPS (as Admin)
-- ===========================================================================
select set_config('request.jwt.claim.sub', 'a8800000-0000-0000-0000-000000000098', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

select results_eq(
  $$select enrollment_id from public.admin_triad_requirement_candidates((select id from unit where n = 1)) order by enrollment_id$$,
  $$select ('e8800000-0000-0000-0000-00000000000' || n)::uuid from generate_series(1, 6) n order by 1$$,
  '5. the Triad 1 pool is the cohort''s ongoing enrollments requiring Triads (no other cohort, no completed enrollment, no No-Triad programme)');
select throws_ok(
  $$select public.admin_triad_create_group((select id from unit where n = 1),
      array['e8800000-0000-0000-0000-000000000001', 'e8800000-0000-0000-0000-000000000008']::uuid[], 'vi')$$,
  '42501', null, '6. a mixed-cohort group can never be created');
select throws_ok(
  $$select public.admin_triad_create_group((select id from unit where n = 1),
      array['e8800000-0000-0000-0000-000000000001', 'e8800000-0000-0000-0000-000000000009']::uuid[], 'vi')$$,
  '42501', null, '6c. a learner whose programme requires no Triads cannot be grouped');
select throws_ok(
  $$select public.admin_triad_create_group((select id from unit where n = 1),
      array['e8800000-0000-0000-0000-000000000001']::uuid[], 'vi')$$,
  '22023', null, '8a. a group needs at least 2 learners');
select throws_ok(
  $$select public.admin_triad_create_group('d8800000-0000-0000-0000-000000000001',
      array['e8800000-0000-0000-0000-000000000001', 'e8800000-0000-0000-0000-000000000002']::uuid[], 'vi')$$,
  'P0002', null, 'F0. a group is created for a Triad requirement, never for a cohort');

create temporary table grp (name text primary key, id uuid);
grant select, insert on grp to authenticated;
insert into grp values
  ('G1', public.admin_triad_create_group((select id from unit where n = 1),
     array['e8800000-0000-0000-0000-000000000001', 'e8800000-0000-0000-0000-000000000002', 'e8800000-0000-0000-0000-000000000003']::uuid[], 'vi')),
  ('G2', public.admin_triad_create_group((select id from unit where n = 1),
     array['e8800000-0000-0000-0000-000000000004', 'e8800000-0000-0000-0000-000000000005']::uuid[], 'en'));

select results_eq(
  $$select enrollment_id from public.admin_triad_requirement_candidates((select id from unit where n = 1)) order by 1$$,
  $$values ('e8800000-0000-0000-0000-000000000006'::uuid)$$,
  'F. Triad 1 candidates exclude learners grouped for Triad 1 ...');
select results_eq(
  $$select enrollment_id from public.admin_triad_requirement_candidates((select id from unit where n = 2)) order by 1$$,
  $$select ('e8800000-0000-0000-0000-00000000000' || n)::uuid from generate_series(1, 6) n order by 1$$,
  'D/F2. ... while Triad 2 is assigned independently: every eligible learner is still a Triad 2 candidate');
select results_eq(
  $$select prior_partner_enrollment_ids from public.admin_triad_requirement_candidates((select id from unit where n = 2))
    where enrollment_id = 'e8800000-0000-0000-0000-000000000002'$$,
  $$values (array['e8800000-0000-0000-0000-000000000001', 'e8800000-0000-0000-0000-000000000003']::uuid[])$$,
  'E. Triad 2 candidates carry their prior Triad partners (so assignment can prefer new partners)');
insert into grp values
  ('G3', public.admin_triad_create_group((select id from unit where n = 2),
     array['e8800000-0000-0000-0000-000000000001', 'e8800000-0000-0000-0000-000000000004']::uuid[], 'en'));
select results_eq(
  $$select d.ordinal, count(*)::integer from public.triad_group_members m
    join public.triad_groups g on g.id = m.triad_group_id and g.is_active
    join public.cohort_requirement_dates d on d.id = g.cohort_requirement_date_id
    where m.enrollment_id = 'e8800000-0000-0000-0000-000000000001' group by d.ordinal order by 1$$,
  $$values (1, 1), (2, 1)$$,
  'B. a learner belongs to Triad 1 Group G1 AND Triad 2 Group G3 (different members)');
select is((select cohort_id from public.triad_groups where id = (select id from grp where name = 'G3')),
  'd8800000-0000-0000-0000-000000000001'::uuid, '4g. the group''s cohort is derived from its requirement');
select is((select count(*)::integer from public.triad_group_members where triad_group_id = (select id from grp where name = 'G2')), 2,
  '8b. dyads remain supported');
select throws_ok(
  $$select public.admin_triad_create_group((select id from unit where n = 1),
      array['e8800000-0000-0000-0000-000000000001', 'e8800000-0000-0000-0000-000000000006']::uuid[], 'vi')$$,
  '23505', null, 'C. a learner cannot belong to two active groups for Triad 1');
select throws_ok(
  $$select public.admin_triad_create_group((select id from unit where n = 2),
      array['e8800000-0000-0000-0000-000000000004', 'e8800000-0000-0000-0000-000000000006']::uuid[], 'vi')$$,
  '23505', null, 'C2. ... nor two active groups for Triad 2');
select hasnt_column('public', 'triad_group_members', 'user_id', '9b. membership is the enrollment (no duplicated learner identity)');
select is((select count(*)::integer from public.triad_groups g where g.id in (select id from grp)
             and (to_jsonb(g) ->> 'member_1_id' is not null or to_jsonb(g) ->> 'enrollment_1_id' is not null or to_jsonb(g) ->> 'programme_id' is not null)), 0,
  '9c. new groups write no slot / programme columns (legacy; dropped in deployment 2)');
select is((select count(*)::integer from public.triad_sessions where triad_group_id in (select id from grp)), 0,
  '10. a group is created without a session (members or the system propose one)');
select lives_ok($$select public.admin_triad_change_member((select id from grp where name = 'G2'), null, 'e8800000-0000-0000-0000-000000000006')$$,
  '11a. before its first session a group''s membership can be adjusted');
select lives_ok($$select public.admin_triad_change_member((select id from grp where name = 'G2'), 'e8800000-0000-0000-0000-000000000006', null)$$,
  '11b. (and adjusted back)');
reset role;
select throws_ok(
  $$insert into public.triad_group_members (triad_group_id, enrollment_id, member_order)
    values ((select id from grp where name = 'G2'), 'e8800000-0000-0000-0000-000000000008', 3)$$,
  '42501', null, '6b. even a direct write cannot put another cohort''s enrollment in a group');
select throws_ok(
  $$insert into public.triad_groups (cohort_requirement_date_id, cohort_id, assigned_by, group_language)
    values ((select id from unit where n = 1), 'd8800000-0000-0000-0000-000000000002', 'admin', 'en')$$,
  '42501', null, '6d. a group''s cohort can never differ from its requirement''s cohort');
select throws_ok(
  $$update public.triad_groups set cohort_requirement_date_id = (select id from unit where n = 2) where id = (select id from grp where name = 'G1')$$,
  '42501', null, '6e. a group''s requirement never changes (a replacement group is created instead)');
select throws_ok(
  $$insert into public.triad_groups (assigned_by, group_language, cohort_id) values ('admin', 'en', 'd8800000-0000-0000-0000-000000000001')$$,
  '23502', null, '6f. a group without a requirement is refused');
set local role authenticated;

-- ===========================================================================
-- SESSIONS (as learners)
-- ===========================================================================
create temporary table ses (name text primary key, id uuid);
grant select, insert on ses to authenticated;

select set_config('request.jwt.claim.sub', 'a8800000-0000-0000-0000-000000000004', true);
select throws_ok($$select public.learner_triad_schedule_session((select id from grp where name = 'G1'), now() - interval '35 days', now() - interval '35 days' + interval '1 hour')$$,
  '42501', null, '12a. only a member schedules a group''s session');
select set_config('request.jwt.claim.sub', 'a8800000-0000-0000-0000-000000000001', true);
insert into ses values ('G1a', public.learner_triad_schedule_session((select id from grp where name = 'G1'),
  now() - interval '35 days', now() - interval '35 days' + interval '1 hour'));
select is(
  (select jsonb_array_length(sessions) from public.learner_triad_overview('e8800000-0000-0000-0000-000000000001')
   where triad_group_id = (select id from grp where name = 'G1')), 1,
  '12b. the learner sees the group''s proposed session');
select results_eq(
  $$select unit_number, due_on from public.learner_triad_overview('e8800000-0000-0000-0000-000000000001') order by unit_number$$,
  $$select n, due_on from unit order by n$$,
  'B2. the learner sees both groups independently: Triad 1 and Triad 2, each with its own deadline');
select throws_ok($$select public.learner_triad_complete_session((select id from ses where name = 'G1a'))$$,
  '42501', null, '16a. a proposed (unagreed) session cannot be completed');
select throws_ok($$select public.learner_triad_schedule_session((select id from grp where name = 'G1'), now(), now() + interval '1 hour')$$,
  '23505', null, '12c. one open session per group at a time');
select set_config('request.jwt.claim.sub', 'a8800000-0000-0000-0000-000000000002', true);
select lives_ok($$select public.learner_triad_respond_session((select id from ses where name = 'G1a'), 'accepted')$$, 'E2 accepts');
select set_config('request.jwt.claim.sub', 'a8800000-0000-0000-0000-000000000003', true);
select lives_ok($$select public.learner_triad_respond_session((select id from ses where name = 'G1a'), 'accepted')$$, 'E3 accepts');
select is((select status from public.triad_sessions where id = (select id from ses where name = 'G1a')), 'confirmed',
  '12d. the session is confirmed once every member accepted');

select set_config('request.jwt.claim.sub', 'a8800000-0000-0000-0000-000000000004', true);
select throws_ok($$select public.learner_triad_complete_session((select id from ses where name = 'G1a'))$$,
  '42501', null, '16b. a non-member cannot complete a session');
select is((select count(*)::integer from public.triad_sessions where id = (select id from ses where name = 'G1a')), 0,
  '27a. a learner cannot read another group''s session');
select set_config('request.jwt.claim.sub', 'a8800000-0000-0000-0000-000000000001', true);
update public.triad_sessions set status = 'completed' where id = (select id from ses where name = 'G1a');
select is((select status from public.triad_sessions where id = (select id from ses where name = 'G1a')), 'confirmed',
  '16c. learners cannot write session state directly (only through validated functions)');
select lives_ok($$select public.learner_triad_complete_session((select id from ses where name = 'G1a'))$$, 'E1 completes G1a');
select is((select status from public.triad_sessions where id = (select id from ses where name = 'G1a')), 'completed',
  '16f. completion persists (no auto-confirm revert)');
reset role;
update public.triad_session_responses set response = 'accepted', responded_at = now()
where triad_session_id = (select id from ses where name = 'G1a');
select is((select status from public.triad_sessions where id = (select id from ses where name = 'G1a')), 'completed',
  '16g. later response writes never move a completed session');
select throws_ok($$update public.triad_sessions set status = 'confirmed' where id = (select id from ses where name = 'G1a')$$,
  '42501', null, '16h. completed -> confirmed is refused for every writer');
select throws_ok($$update public.triad_sessions set status = 'proposed' where id = (select id from ses where name = 'G1a')$$,
  '42501', null, '16h2. completed -> proposed is refused');
select throws_ok($$update public.triad_sessions set scheduled_start_time = now() where id = (select id from ses where name = 'G1a')$$,
  '42501', null, '16h3. a completed session''s time (its activity date) is final');
select throws_ok($$delete from public.triad_group_members where triad_group_id = (select id from grp where name = 'G1') and enrollment_id = 'e8800000-0000-0000-0000-000000000003'$$,
  '42501', null, '42a. once a group has a session its membership is final (no removal)');
select throws_ok($$insert into public.triad_group_members (triad_group_id, enrollment_id, member_order) values ((select id from grp where name = 'G1'), 'e8800000-0000-0000-0000-000000000006', 3)$$,
  '42501', null, '42b. ... and no addition');
select throws_ok($$update public.triad_group_members set enrollment_id = 'e8800000-0000-0000-0000-000000000006' where triad_group_id = (select id from grp where name = 'G1') and member_order = 3$$,
  '42501', null, '42c. membership rows are never rewritten');
set local role authenticated;

-- Triad 1 is fulfilled for G1: the group schedules no further programme session.
select set_config('request.jwt.claim.sub', 'a8800000-0000-0000-0000-000000000002', true);
select throws_ok($$select public.learner_triad_schedule_session((select id from grp where name = 'G1'), now() - interval '3 days', now() - interval '3 days' + interval '1 hour')$$,
  '23505', null, '12e. a group whose Triad session is completed schedules no second programme session');
-- Triad 2 (G3: E1, E4): its own group and session.
select set_config('request.jwt.claim.sub', 'a8800000-0000-0000-0000-000000000004', true);
insert into ses values ('G3a', public.learner_triad_schedule_session((select id from grp where name = 'G3'),
  now() - interval '3 days', now() - interval '3 days' + interval '1 hour'));
select set_config('request.jwt.claim.sub', 'a8800000-0000-0000-0000-000000000001', true);
select lives_ok($$select public.learner_triad_respond_session((select id from ses where name = 'G3a'), 'accepted')$$, 'E1 accepts G3a');
select lives_ok($$select public.learner_triad_complete_session((select id from ses where name = 'G3a'))$$, 'E1 completes G3a (Triad 2)');

-- Alternatives on G2 (E4, E5): a confirmed future session.
select set_config('request.jwt.claim.sub', 'a8800000-0000-0000-0000-000000000004', true);
insert into ses values ('G2a', public.learner_triad_schedule_session((select id from grp where name = 'G2'),
  now() + interval '10 days', now() + interval '10 days 1 hour'));
select set_config('request.jwt.claim.sub', 'a8800000-0000-0000-0000-000000000005', true);
select lives_ok($$select public.learner_triad_respond_session((select id from ses where name = 'G2a'), 'accepted')$$, 'E5 accepts');
select throws_ok($$select public.learner_triad_complete_session((select id from ses where name = 'G2a'))$$,
  '42501', null, '16d. a session cannot be completed before its time');
create temporary table alt (name text primary key, id uuid);
grant select, insert on alt to authenticated;
select set_config('request.jwt.claim.sub', 'a8800000-0000-0000-0000-000000000004', true);
insert into alt values
  ('A', public.learner_triad_propose_alternative((select id from ses where name = 'G2a'), now() + interval '12 days', now() + interval '12 days 1 hour')),
  ('B', public.learner_triad_propose_alternative((select id from ses where name = 'G2a'), now() + interval '14 days', now() + interval '14 days 1 hour'));
select ok(
  (select scheduled_start_time::date = (now() + interval '10 days')::date and status = 'confirmed'
   from public.triad_sessions where id = (select id from ses where name = 'G2a')),
  '13a. candidate times do not change the session while pending');
select results_eq(
  $$select status from public.triad_alternative_proposals where id in (select id from alt) order by proposed_start_time$$,
  $$values ('pending'::text), ('pending'::text)$$,
  '13b. proposal status is its own lifecycle');
select set_config('request.jwt.claim.sub', 'a8800000-0000-0000-0000-000000000005', true);
select lives_ok($$select public.learner_triad_respond_alternative((select id from alt where name = 'A'), 'accepted')$$, 'E5 accepts alternative A');
select ok(
  (select scheduled_start_time::date = (now() + interval '12 days')::date and status = 'confirmed'
   from public.triad_sessions where id = (select id from ses where name = 'G2a')),
  '13c. an alternative accepted by every member becomes the session time');
select results_eq(
  $$select status from public.triad_alternative_proposals where id in (select id from alt) order by proposed_start_time$$,
  $$values ('accepted'::text), ('superseded'::text)$$,
  '13d. the other candidate is superseded and kept as history');
reset role;
select is(
  (select occurred_on from public.session_activity_attributions a
   where a.source_activity_type = 'triad' and a.source_activity_id = (select id from ses where name = 'G2a')
     and a.enrollment_id = 'e8800000-0000-0000-0000-000000000004'),
  (now() + interval '12 days')::date, '13e. evidence follows the session''s current time after a reschedule');

-- ===========================================================================
-- COMPLETION (C1)
-- ===========================================================================
select results_eq(
  $$select a.enrollment_id, a.milestone_id from public.session_activity_attributions a
    where a.source_activity_type = 'triad' and a.source_activity_id = (select id from ses where name = 'G1a') order by 1$$,
  $$values ('e8800000-0000-0000-0000-000000000001'::uuid, null::uuid), ('e8800000-0000-0000-0000-000000000002'::uuid, null::uuid), ('e8800000-0000-0000-0000-000000000003'::uuid, null::uuid)$$,
  '33. a completed session is evidence for every group member, linked to no requirement unit');
select results_eq(
  $$select c.required_units, c.raw_completed_sessions, c.completed_units from public.canonical_triad_completion('e8800000-0000-0000-0000-000000000003') c$$,
  $$values (2, 1, 1)$$,
  'G. a completed Triad 1 session -> 1/2');
select results_eq(
  $$select c.required_units, c.raw_completed_sessions, c.completed_units, c.overdue_units from public.canonical_triad_completion('e8800000-0000-0000-0000-000000000001') c$$,
  $$values (2, 2, 2, 0)$$,
  'I. completed Triad 1 (G1) + completed Triad 2 (G3) -> 2/2');
select results_eq(
  $$select x->>'milestone', x->>'fulfilled', x->>'triad_group_id' from public.canonical_triad_completion('e8800000-0000-0000-0000-000000000001') c,
      jsonb_array_elements(c.schedule) x order by 1$$,
  $$values ('1', 'true', (select id::text from grp where name = 'G1')), ('2', 'true', (select id::text from grp where name = 'G3'))$$,
  'I2. each requirement is fulfilled by ITS group');
-- H. a second completed session under Triad 1 (same group) is raw activity only.
insert into public.triad_sessions (triad_group_id, scheduled_start_time, scheduled_end_time, status)
values ((select id from grp where name = 'G1'), now() - interval '1 day', now() - interval '1 day' + interval '1 hour', 'completed');
select results_eq(
  $$select c.raw_completed_sessions, c.completed_units from public.canonical_triad_completion('e8800000-0000-0000-0000-000000000002') c$$,
  $$values (2, 1)$$,
  'H/J. two completed sessions under Triad 1 -> raw 2, still 1/2 (never fulfils Triad 2)');
select results_eq(
  $$select c.raw_completed_sessions, c.completed_units from public.canonical_triad_completion('e8800000-0000-0000-0000-000000000001') c$$,
  $$values (3, 2)$$,
  'J2. an extra session never creates an extra programme unit (raw 3, 2/2)');
select is((select count(*)::integer from public.session_activity_attributions a
           where a.enrollment_id = 'e8800000-0000-0000-0000-000000000002' and a.source_activity_type = 'triad'), 2,
  'B2. the extra session is not lost from the learner''s evidence');
-- K. E4: Triad 2 fulfilled early (G3a), Triad 1 (due today-30) only booked.
select results_eq(
  $$select c.completed_units, c.booked_units, c.due_units, c.overdue_units from public.canonical_triad_completion('e8800000-0000-0000-0000-000000000004') c$$,
  $$values (1, 1, 2, 1)$$,
  'K. an early Triad 2 never hides an overdue Triad 1: 1/2 fulfilled, Triad 1 booked and overdue');
-- G2's open session is cancelled; an earlier completed session (history) and
-- a new confirmed one follow (one open session per group).
update public.triad_sessions set status = 'cancelled' where id = (select id from ses where name = 'G2a');
insert into public.triad_sessions (triad_group_id, scheduled_start_time, scheduled_end_time, status)
values ((select id from grp where name = 'G2'), now() - interval '40 days', now() - interval '40 days' + interval '1 hour', 'completed'),
       ((select id from grp where name = 'G2'), now() + interval '5 days', now() + interval '5 days 1 hour', 'confirmed');
select results_eq(
  $$select c.required_units, c.completed_units, c.overdue_units from public.canonical_triad_completion('e8800000-0000-0000-0000-000000000004') c$$,
  $$values (2, 2, 0)$$,
  'K2. once Triad 1 is fulfilled by its own group, E4 reads 2/2 with nothing overdue');
select results_eq(
  $$select c.completed_units, c.due_units, c.overdue_units, c.next_due_on from public.canonical_triad_completion('e8800000-0000-0000-0000-000000000005') c$$,
  $$select 1, 2, 1, (select due_on from unit where n = 2)$$,
  'K3. E5 (Triad 1 only): 1/2, and the outstanding Triad 2 is overdue on the same deadline');
select is((select count(*)::integer from public.session_activity_attributions a
           where a.source_activity_type = 'triad' and a.source_activity_id = (select id from ses where name = 'G2a')), 0,
  '10b. a cancelled session is no evidence');
select throws_ok($$update public.triad_sessions set status = 'proposed' where id = (select id from ses where name = 'G2a')$$,
  '42501', null, '10c. a cancelled session is final');

-- ===========================================================================
-- COMPLETION + DUE / OVERDUE (DC: due 2026-04-05 and 2026-07-05)
-- ===========================================================================
create temporary table dc (name text primary key, id uuid);
grant select on dc to authenticated;
create or replace function pg_temp.dc_group(p_unit integer, p_members text[], p_starts timestamptz[]) returns uuid language plpgsql as $f$
declare g uuid; t timestamptz;
begin
  g := public.triad_create_group_internal((select id from dcu where n = p_unit),
         array(select ('f8800000-0000-0000-0000-0000000000' || lpad(m, 2, '0'))::uuid from unnest(p_members) m), 'en', 'admin');
  foreach t in array p_starts loop
    insert into public.triad_sessions (triad_group_id, scheduled_start_time, scheduled_end_time, status)
    values (g, t, t + interval '1 hour', 'completed');
  end loop;
  return g;
end $f$;
-- F10 partners each learner in turn (its groups are closed after use).
-- F1: Triad 1 Mar 1, Triad 2 Jun 20. F2: Triad 1 Apr 20, Triad 2 Jun 20.
-- F3: nothing. F4: Triad 1 Mar 1. F5: two sessions in its Triad 1 group.
insert into dc values ('F1-1', pg_temp.dc_group(1, array['1', '10'], array['2026-03-01 09:00+00']::timestamptz[]));
update public.triad_groups set is_active = false where id = (select id from dc where name = 'F1-1');
insert into dc values ('F1-2', pg_temp.dc_group(2, array['1', '10'], array['2026-06-20 09:00+00']::timestamptz[]));
update public.triad_groups set is_active = false where id = (select id from dc where name = 'F1-2');
insert into dc values ('F2-1', pg_temp.dc_group(1, array['2', '10'], array['2026-04-20 09:00+00']::timestamptz[]));
update public.triad_groups set is_active = false where id = (select id from dc where name = 'F2-1');
insert into dc values ('F2-2', pg_temp.dc_group(2, array['2', '10'], array['2026-06-20 10:00+00']::timestamptz[]));
update public.triad_groups set is_active = false where id = (select id from dc where name = 'F2-2');
insert into dc values ('F4', pg_temp.dc_group(1, array['4', '10'], array['2026-03-01 11:00+00']::timestamptz[]));
update public.triad_groups set is_active = false where id = (select id from dc where name = 'F4');
insert into dc values ('F5', pg_temp.dc_group(1, array['5', '10'], array['2026-03-01 12:00+00', '2026-03-02 12:00+00']::timestamptz[]));
update public.triad_groups set is_active = false where id = (select id from dc where name = 'F5');
-- Replacement for the SAME requirement: F6's Triad 1 group (F6, F7) is closed
-- after its session; a replacement Triad 1 group (F6, F8) completes again.
insert into dc values ('G-old', pg_temp.dc_group(1, array['6', '7'], array['2026-03-01 13:00+00']::timestamptz[]));
select throws_ok($$select public.triad_create_group_internal((select id from dcu where n = 1),
   array['f8800000-0000-0000-0000-000000000006', 'f8800000-0000-0000-0000-000000000008']::uuid[], 'en', 'admin')$$,
  '23505', null, '42d. a learner cannot join a second active group for the same Triad');
update public.triad_groups set is_active = false where id = (select id from dc where name = 'G-old');
insert into dc values ('G-new', pg_temp.dc_group(1, array['6', '8'], array['2026-06-20 13:00+00']::timestamptz[]));
-- F9: Triad 1 and Triad 2 sessions at the same timestamp (distinct groups).
insert into dc values ('H-1', pg_temp.dc_group(1, array['9', '12'], array['2026-03-10 09:00+00']::timestamptz[]));
insert into dc values ('H-2', pg_temp.dc_group(2, array['9', '11'], array['2026-03-10 09:00+00']::timestamptz[]));
-- F11: only Triad 2, completed early (Mar 1 via H-2 at Mar 10).

select results_eq(
  $$select c.completed_by_as_of, c.due_units, c.overdue_units, (c.schedule->0->>'satisfied')::boolean
    from public.canonical_triad_completion('f8800000-0000-0000-0000-000000000001', '2026-04-06') c$$,
  $$values (1, 2, 1, true)$$,
  'D2. Triad 1 fulfilled, Triad 2 not -> the day after the deadline: 1/2, 1 overdue');
select results_eq(
  $$select c.completed_units, c.overdue_units from public.canonical_triad_completion('f8800000-0000-0000-0000-000000000001', '2026-07-06') c$$,
  $$values (2, 0)$$,
  'E2. Triad 2 fulfilled by its own group before its deadline -> 06 Jul: 2/2');
select results_eq(
  $$select (cp->>'checkpoint_number')::integer, (cp->>'completed_units')::integer, cp->>'state'
    from jsonb_array_elements(public.canonical_enrollment_journey('f8800000-0000-0000-0000-000000000001', '2026-07-06')) cp order by 1$$,
  $$values (1, 1, 'overdue')$$,
  'E3. one deadline is one journey checkpoint, and it records what was fulfilled BY that date (1 of 2)');
select results_eq(
  $$select c.completed_by_as_of, c.overdue_units from public.canonical_triad_completion('f8800000-0000-0000-0000-000000000002', '2026-04-10') c$$,
  $$values (0, 2)$$,
  'K4. nothing fulfilled by the deadline: on 10 Apr both Triad units are overdue');
select results_eq(
  $$select c.completed_units, c.overdue_units from public.canonical_triad_completion('f8800000-0000-0000-0000-000000000002', current_date) c$$,
  $$values (2, 0)$$,
  'K5. ... and current progress still becomes 2/2');
select results_eq(
  $$select (cp->>'completed_units')::integer, cp->>'state'
    from jsonb_array_elements(public.canonical_enrollment_journey('f8800000-0000-0000-0000-000000000002', current_date)) cp
    where (cp->>'checkpoint_number')::integer = 1$$,
  $$values (0, 'overdue')$$,
  'K6. the first checkpoint stays historically overdue');
select results_eq(
  $$select e, c.completed_units from unnest(array['f8800000-0000-0000-0000-000000000006', 'f8800000-0000-0000-0000-000000000007', 'f8800000-0000-0000-0000-000000000008']::uuid[]) e
    cross join lateral public.canonical_triad_completion(e) c order by e$$,
  $$values ('f8800000-0000-0000-0000-000000000006'::uuid, 1), ('f8800000-0000-0000-0000-000000000007'::uuid, 1), ('f8800000-0000-0000-0000-000000000008'::uuid, 1)$$,
  'J3. a replacement group for the same Triad fulfils that Triad once (F6: 1/2, never 2/2)');
select results_eq(
  $$select m.enrollment_id from public.triad_sessions s join public.triad_group_members m on m.triad_group_id = s.triad_group_id
    where s.triad_group_id = (select id from dc where name = 'G-old') order by 1$$,
  $$values ('f8800000-0000-0000-0000-000000000006'::uuid), ('f8800000-0000-0000-0000-000000000007'::uuid)$$,
  'P. regrouping never rewrites the old session''s participants');
select results_eq(
  $$select c.raw_completed_sessions, c.completed_units from public.canonical_triad_completion('f8800000-0000-0000-0000-000000000009') c$$,
  $$values (2, 2)$$,
  'I3. Triad 1 and Triad 2 sessions at the same timestamp both count (distinct requirements)');
select results_eq(
  $$select c.completed_units, c.due_units, c.overdue_units from public.canonical_triad_completion('f8800000-0000-0000-0000-000000000011', '2026-04-06') c$$,
  $$values (1, 2, 1)$$,
  'K7. only Triad 2 fulfilled: Triad 1 is still its own outstanding requirement, and overdue');
select results_eq(
  $$select (cp->>'completed_units')::integer, cp->>'state'
    from jsonb_array_elements(public.canonical_enrollment_journey('f8800000-0000-0000-0000-000000000011', '2026-04-06')) cp
    where (cp->>'checkpoint_number')::integer = 1$$,
  $$values (1, 'overdue')$$,
  'K8. ... and the checkpoint is overdue in the journey: one of two fulfilled, not two');

-- Due / overdue matrix (DC's Triads deadline is Apr 5) — F3 (nothing),
-- F4 (Triad 1: Mar 1), F5 (Triad 1: Mar 1 + Mar 2 in the SAME group, so still
-- one fulfilled unit). Before the deadline nothing is due; from the day after
-- it, both required units are due and whatever is missing is overdue.
create temporary table matrix (e uuid, as_of date, due integer, done integer, overdue integer);
insert into matrix values
  ('f8800000-0000-0000-0000-000000000003', '2026-04-04', 0, 0, 0), ('f8800000-0000-0000-0000-000000000004', '2026-04-04', 0, 1, 0), ('f8800000-0000-0000-0000-000000000005', '2026-04-04', 0, 1, 0),
  ('f8800000-0000-0000-0000-000000000003', '2026-04-06', 2, 0, 2), ('f8800000-0000-0000-0000-000000000004', '2026-04-06', 2, 1, 1), ('f8800000-0000-0000-0000-000000000005', '2026-04-06', 2, 1, 1),
  ('f8800000-0000-0000-0000-000000000003', '2026-07-04', 2, 0, 2), ('f8800000-0000-0000-0000-000000000004', '2026-07-04', 2, 1, 1), ('f8800000-0000-0000-0000-000000000005', '2026-07-04', 2, 1, 1),
  ('f8800000-0000-0000-0000-000000000003', '2026-07-06', 2, 0, 2), ('f8800000-0000-0000-0000-000000000004', '2026-07-06', 2, 1, 1), ('f8800000-0000-0000-0000-000000000005', '2026-07-06', 2, 1, 1);
grant select on matrix to authenticated;
select results_eq(
  $$select m.e, m.as_of, c.due_units, c.completed_units, c.overdue_units
    from matrix m cross join lateral public.canonical_triad_completion(m.e, m.as_of) c order by 1, 2$$,
  $$select e, as_of, due, done, overdue from matrix order by 1, 2$$,
  'K9. due / fulfilled / overdue per requirement at Apr 4 / Apr 6 / Jul 4 / Jul 6 (two sessions in one Triad 1 group fulfil only Triad 1)');

create temporary table role_matrix (who text, e uuid, as_of date, facts jsonb, journey jsonb);
grant select, insert on role_matrix to authenticated;
create temporary table matrix_user as select id as enrollment_id, user_id from public.programme_enrollments where id::text like 'f8800000-%';
grant select on matrix_user to authenticated;
set local role authenticated;
do $$
declare r record; u uuid;
begin
  for r in select * from matrix loop
    select user_id into u from matrix_user where enrollment_id = r.e;
    perform set_config('request.jwt.claim.sub', u::text, true);
    insert into role_matrix select 'learner', r.e, r.as_of,
      (select jsonb_build_object('req', p.triad_required_units, 'done', p.triad_completed_units, 'due', p.triad_due_units,
         'overdue', p.overdue_units, 'adherence', p.due_adherence_pct, 'pace', p.pace_status)
       from public.learner_canonical_progress(r.e, r.as_of) p),
      public.learner_canonical_journey(r.e, r.as_of);
    perform set_config('request.jwt.claim.sub', 'a8800000-0000-0000-0000-000000000099', true);
    insert into role_matrix select 'sponsor', r.e, r.as_of,
      (select jsonb_build_object('req', p.triad_required_units, 'done', p.triad_completed_units, 'due', p.triad_due_units,
         'overdue', p.overdue_units, 'adherence', p.due_adherence_pct, 'pace', p.pace_status)
       from public.sponsor_canonical_leader_progress(r.e, r.as_of) p),
      public.sponsor_canonical_leader_journey(r.e, r.as_of);
    perform set_config('request.jwt.claim.sub', 'a8800000-0000-0000-0000-000000000098', true);
    insert into role_matrix select 'admin', r.e, r.as_of,
      (select jsonb_build_object('req', p.triad_required_units, 'done', p.triad_completed_units, 'due', p.triad_due_units,
         'overdue', p.overdue_units, 'adherence', p.due_adherence_pct, 'pace', p.pace_status)
       from public.admin_canonical_enrollment_progress(array[r.e], r.as_of) p),
      public.admin_canonical_enrollment_journey(r.e, r.as_of);
    insert into role_matrix select 'admin-triads', r.e, r.as_of,
      (select jsonb_build_object('req', l.required_units, 'done', l.completed_units, 'due', l.due_units, 'overdue', l.overdue_units)
       from public.admin_cohort_triad_learners('d8800000-0000-0000-0000-000000000004', r.as_of) l where l.enrollment_id = r.e),
      null;
  end loop;
end $$;
reset role;
select is((select count(*)::integer from role_matrix where facts is null or (who <> 'admin-triads' and journey is null)), 0,
  '41b. every role received the facts for every as-of date');
select is((select count(distinct (e, as_of, facts, journey))::integer from role_matrix where who <> 'admin-triads'), 12,
  'L. Learner, Sponsor and Admin agree on required / completed / due / overdue / adherence / pace / journey at every as-of date');
select is(
  (select count(*)::integer from role_matrix a join role_matrix l on l.e = a.e and l.as_of = a.as_of and l.who = 'learner'
   where a.who = 'admin-triads'
     and a.facts is distinct from jsonb_build_object('req', l.facts->'req', 'done', l.facts->'done', 'due', l.facts->'due', 'overdue', l.facts->'overdue')),
  0, '41d. Admin -> Cohort -> Triads shows the same numbers (no Admin formula)');
select is(
  (select count(*)::integer from matrix m cross join lateral public.canonical_triad_completion(m.e, m.as_of) c
   join lateral (select p.* from public.canonical_module_progress(m.e, m.as_of) p where p.module = 'triads') p on true
   where (c.completed_units, c.due_units, c.overdue_units, c.booked_units, c.pace_status)
         is distinct from (p.completed_units, p.due_units, p.overdue_units, p.booked_units, p.pace_status)),
  0, '41f. the Triad projection equals canonical module progress at every as-of date');
select results_eq(
  $$select t.enrollment_id, t.milestone_number, t.milestone_met, t.milestone_overdue
    from public.triad_reminder_targets_internal('2026-04-06', 'd8800000-0000-0000-0000-000000000004') t
    where t.enrollment_id in ('f8800000-0000-0000-0000-000000000003', 'f8800000-0000-0000-0000-000000000004', 'f8800000-0000-0000-0000-000000000011')
      and t.milestone_number = 1 order by 1$$,
  $$values ('f8800000-0000-0000-0000-000000000003'::uuid, 1, false, true), ('f8800000-0000-0000-0000-000000000004'::uuid, 1, true, false),
           ('f8800000-0000-0000-0000-000000000011'::uuid, 1, false, true)$$,
  '41g. reminders read the same per-requirement rule (Triad 1 overdue without its own fulfilment, even after an early Triad 2)');
select is((select count(distinct cohort_requirement_date_id)::integer from public.triad_reminder_targets_internal('2026-04-06', 'd8800000-0000-0000-0000-000000000004')),
  2, '41h. reminder targets are per Triad requirement');

-- ===========================================================================
-- REFLECTIONS + GOAL CHECK-IN (E1, E2, E3 on G1a)
-- ===========================================================================
insert into public.coachee_goals (id, coachee_id, enrollment_id, title)
values ('98800000-0000-0000-0000-000000000001', 'a8800000-0000-0000-0000-000000000001', 'e8800000-0000-0000-0000-000000000001', 'Listen first');
insert into public.coachee_goal_ratings (coachee_id, enrollment_id, goal_id, start_rating, current_rating, target_rating)
values ('a8800000-0000-0000-0000-000000000001', 'e8800000-0000-0000-0000-000000000001', '98800000-0000-0000-0000-000000000001', 20, 30, 80);

select results_eq(
  $$select id, question_key from public.triad_reflection_questions where programme_id is null order by display_order$$,
  $$values ('7d1a0000-0000-4000-8000-000000000001'::uuid, 'learned_as_coach'::text), ('7d1a0000-0000-4000-8000-000000000002'::uuid, 'will_use_as_coach'::text),
           ('7d1a0000-0000-4000-8000-000000000003'::uuid, 'learned_as_coachee'::text), ('7d1a0000-0000-4000-8000-000000000004'::uuid, 'will_use_as_coachee'::text),
           ('7d1a0000-0000-4000-8000-000000000005'::uuid, 'learned_as_observer'::text), ('7d1a0000-0000-4000-8000-000000000006'::uuid, 'will_use_as_observer'::text)$$,
  '43a. reflection questions have stable ids and keys');
select has_table('public', 'triad_reflection_answers', '43b. answers are rows per question');

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a8800000-0000-0000-0000-000000000001', true);
select results_eq(
  $$select id from public.learner_triad_reflection_questions((select id from ses where name = 'G1a')) order by display_order limit 1$$,
  $$values ('7d1a0000-0000-4000-8000-000000000001'::uuid)$$,
  'members read the question set for their session');
select lives_ok($$select public.learner_triad_submit_reflection((select id from ses where name = 'G1a'), 4::smallint,
  '[{"question_id":"7d1a0000-0000-4000-8000-000000000001","answer_text":"Silence gives room"},{"question_id":"7d1a0000-0000-4000-8000-000000000006","answer_text":"Name patterns kindly"}]'::jsonb)$$,
  'E1 submits a reflection');
select throws_ok($$select public.learner_triad_submit_reflection((select id from ses where name = 'G1a'), 5::smallint, '[]'::jsonb)$$,
  '23505', null, '43c. one reflection per session and enrollment');
select throws_ok($$select public.learner_triad_submit_reflection((select id from ses where name = 'G2a'), 5::smallint, '[]'::jsonb)$$,
  '42501', null, 'a learner cannot reflect on another group''s session');
select throws_ok(
  $$insert into public.triad_reflections (triad_session_id, enrollment_id, satisfaction_rating)
    values ((select id from ses where name = 'G1a'), 'e8800000-0000-0000-0000-000000000001', 3)$$,
  '42501', null, 'learners cannot write reflections directly');
select is(
  (select satisfaction_rating::integer from public.triad_reflections where enrollment_id = 'e8800000-0000-0000-0000-000000000001'),
  4, 'N. the reflection stays linked to its session and enrollment (satisfaction on the submission)');
select lives_ok($$select public.record_goal_checkins('e8800000-0000-0000-0000-000000000001', 'triad', (select id from ses where name = 'G1a'),
  '[{"goal_id":"98800000-0000-0000-0000-000000000001","new_rating":60,"note":"Clearer after the triad"}]'::jsonb)$$,
  'O. a Triad goal check-in is recorded in the goal source (separate from the reflection)');
select results_eq(
  $$select source_type, rating::integer from public.learner_reflection_feed('e8800000-0000-0000-0000-000000000001')
    where linked_session_id = (select id from ses where name = 'G1a') order by source_type$$,
  $$values ('goal_checkin'::text, 60), ('triad_reflection'::text, 4)$$,
  '43f. My Journey projects the goal check-in and the Triad reflection side by side (no copy)');
select ok(
  (select (details->>'session_start_time')::timestamptz = (select scheduled_start_time from public.triad_sessions where id = (select id from ses where name = 'G1a'))
     and details ? 'triad_group_id' and (details->>'requirement_unit')::integer = 1 and not details ? 'round_number'
   from public.learner_reflection_feed('e8800000-0000-0000-0000-000000000001') where source_type = 'triad_reflection'),
  'Q. My Journey labels the reflection "Triad 1" with its session date and group — never a round');
select results_eq(
  $$select source_id, requirement_unit_number, participant_role from public.learner_session_history('e8800000-0000-0000-0000-000000000001')
    where session_type = 'triad' and status = 'completed' and source_id in (select id from ses) order by 2$$,
  $$values ((select id from ses where name = 'G1a'), 1, 'participant'::text), ((select id from ses where name = 'G3a'), 2, 'participant'::text)$$,
  'Q2/R. Your Sessions labels sessions "Triad 1" / "Triad 2"; every member is a participant (no fixed coach / coachee / observer)');
select is(
  (select details->'answers'->0->>'question_id' || '|' || (details->'answers'->0->>'answer')
   from public.learner_reflection_feed('e8800000-0000-0000-0000-000000000001') where source_type = 'triad_reflection'),
  '7d1a0000-0000-4000-8000-000000000001|Silence gives room',
  '43h. the feed reads normalized answers by question id');
select is(
  (select count(*)::integer from public.learner_triad_session_reflections((select id from ses where name = 'G1a'))),
  1, '43i. before everyone submits, a member sees only their own reflection');
select set_config('request.jwt.claim.sub', 'a8800000-0000-0000-0000-000000000002', true);
select lives_ok($$select public.learner_triad_submit_reflection((select id from ses where name = 'G1a'), 5::smallint, '[]'::jsonb)$$, 'E2 submits');
select set_config('request.jwt.claim.sub', 'a8800000-0000-0000-0000-000000000003', true);
select lives_ok($$select public.learner_triad_submit_reflection((select id from ses where name = 'G1a'), 3::smallint, '[]'::jsonb)$$, 'E3 submits');
select results_eq(
  $$select member_slot, is_self from public.learner_triad_session_reflections((select id from ses where name = 'G1a')) order by member_slot$$,
  $$values (1, false), (2, false), (3, true)$$,
  '43j. once every member submitted, the group sees all reflections');
reset role;
select is(
  (select count(*)::integer from information_schema.columns where table_schema = 'public' and table_name = 'triad_reflections'
     and column_name ~ 'goal|rating_before|rating_after|new_rating'),
  0, '43k. goal ratings are never copied into triad_reflections');

-- ===========================================================================
-- CROSS ROLE (E1, E4 and coach-as-learner E6)
-- ===========================================================================
create temporary table role_facts (who text, enrollment uuid, progress jsonb, journey jsonb, history jsonb);
create temporary table learner_of as select id as enrollment_id, user_id from public.programme_enrollments
where id::text like 'e8800000-%';
grant select, insert on role_facts to authenticated;
grant select on learner_of to authenticated;
set local role authenticated;
do $$
declare e uuid; u uuid;
begin
  foreach e in array array['e8800000-0000-0000-0000-000000000001', 'e8800000-0000-0000-0000-000000000004', 'e8800000-0000-0000-0000-000000000006']::uuid[] loop
    select user_id into u from learner_of where enrollment_id = e;
    perform set_config('request.jwt.claim.sub', u::text, true);
    insert into role_facts select 'learner', e,
      (select jsonb_build_object('req', p.triad_required_units, 'done', p.triad_completed_units, 'due', p.triad_due_units, 'booked', p.triad_booked_units, 'overdue', p.overdue_units, 'adherence', p.due_adherence_pct)
       from public.learner_canonical_progress(e, current_date) p),
      public.learner_canonical_journey(e, current_date),
      (select coalesce(jsonb_agg(h.source_id order by h.source_id), '[]') from public.learner_session_history(e) h where h.session_type = 'triad');
    insert into role_facts select 'learner-triads', e,
      (select jsonb_build_object('req', s.required_units, 'done', s.completed_units, 'due', s.due_units, 'overdue', s.overdue_units, 'raw', s.raw_completed_sessions)
       from public.learner_triad_status(e) s), null, null;
    perform set_config('request.jwt.claim.sub', 'a8800000-0000-0000-0000-000000000099', true);
    insert into role_facts select 'sponsor', e,
      (select jsonb_build_object('req', p.triad_required_units, 'done', p.triad_completed_units, 'due', p.triad_due_units, 'booked', p.triad_booked_units, 'overdue', p.overdue_units, 'adherence', p.due_adherence_pct)
       from public.sponsor_canonical_leader_progress(e, current_date) p),
      public.sponsor_canonical_leader_journey(e, current_date), null;
    perform set_config('request.jwt.claim.sub', 'a8800000-0000-0000-0000-000000000098', true);
    insert into role_facts select 'admin', e,
      (select jsonb_build_object('req', p.triad_required_units, 'done', p.triad_completed_units, 'due', p.triad_due_units, 'booked', p.triad_booked_units, 'overdue', p.overdue_units, 'adherence', p.due_adherence_pct)
       from public.admin_canonical_enrollment_progress(array[e], current_date) p),
      public.admin_canonical_enrollment_journey(e, current_date),
      (select coalesce(jsonb_agg(s->>'id' order by s->>'id'), '[]') from public.admin_cohort_triad_groups('d8800000-0000-0000-0000-000000000001') g,
         jsonb_array_elements(g.sessions) s where g.members @> jsonb_build_array(jsonb_build_object('enrollment_id', e)));
    insert into role_facts select 'admin-triads', e,
      (select jsonb_build_object('req', l.required_units, 'done', l.completed_units, 'due', l.due_units, 'overdue', l.overdue_units, 'raw', l.raw_completed_sessions)
       from public.admin_cohort_triad_learners('d8800000-0000-0000-0000-000000000001') l where l.enrollment_id = e), null, null;
  end loop;
end $$;
reset role;
select is((select count(distinct (enrollment, progress, journey))::integer from role_facts where who in ('learner', 'sponsor', 'admin')), 3,
  '46a. Learner, Sponsor and Admin agree on Triad progress, adherence and journey per enrollment (incl. coach-as-learner)');
select is((select count(distinct (enrollment, progress))::integer from role_facts where who in ('learner-triads', 'admin-triads')), 3,
  '46b. the learner Triads page and Admin -> Cohort -> Triads read the same completion (required, completed, raw, due, overdue)');
select is((select count(*)::integer from role_facts l join role_facts a on a.enrollment = l.enrollment and a.who = 'admin'
           where l.who = 'learner' and (l.history::text) is distinct from (select coalesce(jsonb_agg(x order by x), '[]')::text from jsonb_array_elements_text(a.history) x)),
  0, '46c. Your Sessions and Admin list the same Triad session history per enrollment');
select ok((select bool_and(progress is not null) from role_facts), '46d. every role received the facts');

-- The requirement (Admin state A/B) and the schedule.
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a8800000-0000-0000-0000-000000000098', true);
select results_eq(
  $$select programme_id, required_units, (select array_agg((x->>'due_on')::date order by (x->>'milestone')::int) from jsonb_array_elements(schedule) x)
    from public.admin_cohort_triad_requirement('d8800000-0000-0000-0000-000000000001') order by 1$$,
  $$values ('c8800000-0000-0000-0000-000000000001'::uuid, 2, array[current_date - 30, current_date - 30]),
           ('c8800000-0000-0000-0000-000000000004'::uuid, 0, null::date[])$$,
  '27a. Admin Triads: "2 required" with the cohort''s cumulative dates; a programme without Triads reads 0 (not an error)');
select throws_ok($$select * from public.admin_cohort_triad_requirement('d8800000-0000-0000-0000-00000000dead')$$,
  'P0002', null, '26d. an unknown cohort is an error, never "0 required"');
select lives_ok($$select public.admin_set_cohort_module_deadlines('d8800000-0000-0000-0000-000000000001',
  jsonb_build_array(jsonb_build_object('programme_id', 'c8800000-0000-0000-0000-000000000001', 'module', 'triads', 'completion_deadline', (current_date + 45)::text)))$$,
  'M. Admin moves the cohort''s Triads completion deadline');
select is((select (schedule->1->>'due_on')::date from public.admin_cohort_triad_requirement('d8800000-0000-0000-0000-000000000001')
           where programme_id = 'c8800000-0000-0000-0000-000000000001'),
  current_date + 45, '3a. Admin Triads shows the new date');
select is((select count(distinct due_on)::integer from public.cohort_requirement_dates
           where cohort_id = 'd8800000-0000-0000-0000-000000000001' and programme_id = 'c8800000-0000-0000-0000-000000000001' and module = 'triads'),
  1, '3b. both Triad units move together: one module, one deadline');
select results_eq(
  $$select d.id from public.cohort_requirement_dates d
    where d.cohort_id = 'd8800000-0000-0000-0000-000000000001' and d.programme_id = 'c8800000-0000-0000-0000-000000000001' and d.module = 'triads' order by d.ordinal$$,
  $$select id from unit order by n$$,
  '3b2. ... so every requirement keeps its identity (its groups stay attached)');
-- Lowering required_units must not take a requirement away from the groups
-- already assigned to it.
select lives_ok($$update public.programme_modules set config = '{"required":true,"required_units":1}'::jsonb
  where programme_id = 'c8800000-0000-0000-0000-000000000001' and module = 'triads'$$,
  '3b3. the programme lowers Triads from 2 to 1');
select results_eq(
  $$select d.id from public.cohort_requirement_dates d
    where d.cohort_id = 'd8800000-0000-0000-0000-000000000001' and d.programme_id = 'c8800000-0000-0000-0000-000000000001' and d.module = 'triads' order by d.ordinal$$,
  $$select id from unit order by n$$,
  '3b4. a Triad requirement with assigned groups survives the reduction');
select lives_ok($$update public.programme_modules set config = '{"required":true,"required_units":2}'::jsonb
  where programme_id = 'c8800000-0000-0000-0000-000000000001' and module = 'triads'$$,
  '3b5. ... and restoring the requirement adds nothing new');
select set_config('request.jwt.claim.sub', 'a8800000-0000-0000-0000-000000000005', true);
select is((select next_due_on from public.learner_triad_status('e8800000-0000-0000-0000-000000000005')),
  current_date + 45, 'M2. the learner''s next deadline follows (Triad 1 fulfilled -> Triad 2''s new date)');
select ok(public.learner_canonical_journey('e8800000-0000-0000-0000-000000000005', current_date)::text like '%' || (current_date + 45)::text || '%',
  'M3. the learner journey has a checkpoint on the new date');
select set_config('request.jwt.claim.sub', 'a8800000-0000-0000-0000-000000000099', true);
select ok(public.sponsor_canonical_leader_journey('e8800000-0000-0000-0000-000000000005', current_date)::text like '%' || (current_date + 45)::text || '%',
  'M4. the sponsor journey has the same checkpoint');
select set_config('request.jwt.claim.sub', 'a8800000-0000-0000-0000-000000000098', true);
select is((select (x->>'due_on')::date from public.admin_cohort_triad_learners('d8800000-0000-0000-0000-000000000001') l,
             jsonb_array_elements(l.requirements) x where l.enrollment_id = 'e8800000-0000-0000-0000-000000000005' and x->>'milestone' = '2'),
  current_date + 45, 'M5. Admin -> Cohort -> Triads reads the same Triad 2 deadline');
select is((select due_on from public.admin_cohort_triad_requirements('d8800000-0000-0000-0000-000000000001') where unit_number = 2),
  current_date + 45, 'M6. ... on the Triad 2 card too');

-- Coach enrolled as a learner: the learner path, no coach-of-record role.
select set_config('request.jwt.claim.sub', 'a8800000-0000-0000-0000-000000000006', true);
select is((select count(*)::integer from public.learner_triad_overview('e8800000-0000-0000-0000-000000000006')), 0,
  '31a. the coach-learner (ungrouped) has no group');
select is((select completed_units from public.learner_triad_status('e8800000-0000-0000-0000-000000000006')), 0,
  '31b. and the same 0/2 every role sees');

-- ===========================================================================
-- ADMIN CLOSE / REGROUP
-- ===========================================================================
select set_config('request.jwt.claim.sub', 'a8800000-0000-0000-0000-000000000098', true);
select lives_ok($$select public.admin_triad_set_group_active((select id from grp where name = 'G2'), false)$$,
  '42f. Admin closes a group (regroup)');
select is((select count(*)::integer from public.triad_sessions where triad_group_id = (select id from grp where name = 'G2') and status in ('proposed', 'confirmed')), 0,
  '42g. closing cancels the group''s open session; completed history stays');
select is((select count(*)::integer from public.triad_sessions where triad_group_id = (select id from grp where name = 'G2') and status = 'completed'), 1,
  '42h. the closed group''s completed session remains');
select lives_ok($$select public.admin_triad_create_group((select id from unit where n = 1),
  array['e8800000-0000-0000-0000-000000000004', 'e8800000-0000-0000-0000-000000000006']::uuid[], 'en')$$,
  '42i. a replacement Triad 1 group is created for the same requirement (old inactive group retained)');
select throws_ok($$select public.admin_triad_set_group_active((select id from grp where name = 'G2'), true)$$,
  '23505', null, '42j. a closed group cannot reopen while a member is in another active group');
reset role;
select is((select completed_units from public.canonical_triad_completion('e8800000-0000-0000-0000-000000000004')), 2,
  '20. progress across a group change keeps the old group''s fulfilment');
set local role authenticated;

-- ===========================================================================
-- SECURITY / PRIVACY
-- ===========================================================================
select set_config('request.jwt.claim.sub', 'a8800000-0000-0000-0000-000000000004', true);
select is((select count(*)::integer from public.learner_triad_overview(null) where triad_group_id = (select id from grp where name = 'G1')), 0,
  '27c. a learner only sees groups they belong to');
select is((select count(*)::integer from public.learner_triad_session_reflections((select id from ses where name = 'G1a'))), 0,
  '27d. a non-member cannot read a group''s reflections');
select is((select count(*)::integer from public.learner_triad_status('e8800000-0000-0000-0000-000000000001')), 0,
  '27e. a learner cannot read another learner''s Triad status');
select set_config('request.jwt.claim.sub', 'a8800000-0000-0000-0000-000000000099', true);
select is(
  (select count(*)::integer from public.triad_reflections) + (select count(*)::integer from public.triad_reflection_answers)
  + (select count(*)::integer from public.triad_sessions) + (select count(*)::integer from public.triad_group_members)
  + (select count(*)::integer from public.triad_groups),
  0, '28. a sponsor cannot read Triad groups, sessions, members, reflections or answers');
select throws_ok($$select * from public.admin_cohort_triad_groups('d8800000-0000-0000-0000-000000000001')$$,
  '42501', null, '28b. a sponsor cannot use Admin Triad functions');
select is((select count(*)::integer from public.learner_reflection_feed('e8800000-0000-0000-0000-000000000001')), 0,
  '28c. a sponsor cannot read a learner''s My Journey reflections');
select set_config('request.jwt.claim.sub', 'a8800000-0000-0000-0000-000000000001', true);
select ok(
  (select bool_and(not (s ? 'notes')) from public.learner_triad_overview(null) o, jsonb_array_elements(o.sessions) s),
  '29. private session notes are not projected to learners');
select set_config('request.jwt.claim.sub', 'a8800000-0000-0000-0000-000000000098', true);
select throws_ok($$delete from public.triad_sessions where id = (select id from ses where name = 'G1a')$$,
  '42501', null, '16i. not even an Admin can delete a completed session');
select throws_ok($$delete from public.triad_groups where id = (select id from grp where name = 'G1')$$,
  '42501', null, '16j. nor a group with completed sessions');
select ok((select count(*) from public.triad_reflections where triad_session_id = (select id from ses where name = 'G1a')) = 3,
  '16k. the completed session''s reflections are intact');
select lives_ok($$insert into public.triad_group_members (triad_group_id, enrollment_id, member_order)
  select m.triad_group_id, m.enrollment_id, m.member_order from public.triad_group_members m where m.triad_group_id = (select id from grp where name = 'G1')
  on conflict (triad_group_id, enrollment_id) do nothing$$,
  '9e. re-inserting existing memberships is a no-op (idempotent writers)');
select throws_ok($$insert into public.triad_group_members (triad_group_id, enrollment_id, member_order)
  select m.triad_group_id, m.enrollment_id, m.member_order from public.triad_group_members m where m.triad_group_id = (select id from grp where name = 'G1')$$,
  '23505', null, '9f. without ON CONFLICT the same membership is still a duplicate');
reset role;
select is(
  (select string_agg(p.proname, ', ' order by p.proname) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prokind = 'f'
     and (p.proname like 'triad\_%' or p.proname in ('canonical_triad_group_members', 'canonical_triad_completion', 'sponsor_canonical_activity',
                                                    'canonical_triad_requirement_fulfilment', 'attribute_activity_to_cadence_milestone',
                                                    'cohort_requirement_proposal_internal'))
     and p.proname <> 'triad_reflections_visible_to_group'
     and has_function_privilege('authenticated', p.oid, 'EXECUTE')),
  null, '30. internal Triad constructions and helpers are not client-callable');
select isnt(
  (select p.provolatile::text from pg_proc p where p.oid = 'public.triad_session_can_complete(text,timestamptz)'::regprocedure),
  'i', '16e. the completion rule reads now(), so it is never IMMUTABLE');

-- ===========================================================================
-- ENGAGEMENT: Triad reflection rate (one calculation)
-- ===========================================================================
select results_eq(
  $$select expected_reflections, submitted_reflections from public.triad_reflection_rate_internal('c8800000-0000-0000-0000-000000000001') where is_total$$,
  $$values (10, 3)$$,
  '32a. reflection rate = reflections / one per member of each completed session (G1: 2 x 3, G2: 1 x 2, G3: 1 x 2; E1-E3 reflected on G1a)');
create temporary table rate_internal as
  select training_week_id, is_total, expected_reflections, submitted_reflections from public.triad_reflection_rate_internal('c8800000-0000-0000-0000-000000000001');
grant select on rate_internal to authenticated;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a8800000-0000-0000-0000-000000000099', true);
select throws_ok($$select * from public.admin_programme_triad_reflection_rate('c8800000-0000-0000-0000-000000000001')$$,
  '42501', null, '32b. only Admin reads the reflection rate');
select set_config('request.jwt.claim.sub', 'a8800000-0000-0000-0000-000000000098', true);
select results_eq(
  $$select training_week_id, is_total, expected_reflections, submitted_reflections from public.admin_programme_triad_reflection_rate('c8800000-0000-0000-0000-000000000001') order by 2, 1$$,
  $$select training_week_id, is_total, expected_reflections, submitted_reflections from rate_internal order by 2, 1$$,
  '32c. Admin and the Edge Functions read the same reflection-rate calculation');
reset role;

select * from finish();
rollback;
