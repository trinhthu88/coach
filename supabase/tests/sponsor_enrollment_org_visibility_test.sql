-- Sponsor visibility is decided by programme_enrollments.organization_id only
-- (20260925100000_sponsor_visibility_by_enrollment_org).
--
-- Fixture: two organisations share ONE cohort (cohort X, whose convenience
-- organization_id is org A). Org A has 3 learners in it, org B has 3, and one
-- learner has no enrollment organisation at all. Cohort Y is also "owned" by
-- org A on the cohort row but contains only one org-B learner.
--
-- Expected:
--   * sponsor A sees exactly A1..A3 (progress, cohort aggregates, leader
--     detail) and does NOT see cohort Y — the cohort row's organisation is not
--     a visibility boundary;
--   * sponsor B sees exactly B1..B3 in cohort X, plus cohort Y;
--   * the NULL-organisation enrollment is visible to nobody;
--   * a 3-leader organisation still sees its named learners and aggregates
--     (the whole-cohort size gate no longer hides them);
--   * enrollment writers accept an organisation different from the cohort's
--     and default a NULL organisation to the cohort's.
begin;

select plan(41);

-- ---------------------------------------------------------------------------
-- Fixture
-- ---------------------------------------------------------------------------
-- 01..03 org-A learners, 04..06 org-B learners in cohort X, 07 org-B learner
-- in cohort Y, 08 no-organisation learner in cohort X, 09/10 learners created
-- through create_programme_enrollment, 11 sponsor A, 12 sponsor B, 13 admin.
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_user_meta_data, created_at, updated_at, confirmation_token, email_change_token_new, recovery_token)
select ('f9500000-0000-0000-0000-0000000000' || lpad(n::text, 2, '0'))::uuid,
  '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated',
  'org-visibility-' || n || '@example.test', 'test', now(),
  jsonb_build_object('full_name', 'Org Visibility ' || lpad(n::text, 2, '0')), now(), now(), '', '', ''
from generate_series(1, 13) n;

insert into public.organizations (id, name) values
  ('b9500000-0000-0000-0000-00000000000a'::uuid, 'Visibility Org A'),
  ('b9500000-0000-0000-0000-00000000000b'::uuid, 'Visibility Org B');

insert into public.user_roles (user_id, role) values
  ('f9500000-0000-0000-0000-000000000011', 'sponsor'),
  ('f9500000-0000-0000-0000-000000000012', 'sponsor'),
  ('f9500000-0000-0000-0000-000000000013', 'admin')
on conflict do nothing;
insert into public.sponsor_profiles (user_id, organization_id) values
  ('f9500000-0000-0000-0000-000000000011'::uuid, 'b9500000-0000-0000-0000-00000000000a'::uuid),
  ('f9500000-0000-0000-0000-000000000012'::uuid, 'b9500000-0000-0000-0000-00000000000b'::uuid);

insert into public.programmes (id, name)
  values ('c9500000-0000-0000-0000-000000000001'::uuid, 'Visibility Programme');
insert into public.programme_modules (programme_id, module, enabled, config) values
  ('c9500000-0000-0000-0000-000000000001'::uuid, 'coaching', true,
   '{"required": true, "required_units": 2, "distribution_settings": {}}'::jsonb);

-- Both cohorts carry org A on the cohort row (a convenience default only).
insert into public.cohorts (id, name, programme_id, organization_id) values
  ('d9500000-0000-0000-0000-000000000001'::uuid, 'Shared Cohort X',
   'c9500000-0000-0000-0000-000000000001'::uuid, 'b9500000-0000-0000-0000-00000000000a'::uuid),
  ('d9500000-0000-0000-0000-000000000002'::uuid, 'Cohort Y',
   'c9500000-0000-0000-0000-000000000001'::uuid, 'b9500000-0000-0000-0000-00000000000a'::uuid);

insert into public.cohort_requirement_dates
  (id, cohort_id, programme_id, module, ordinal, due_on, generation_method, materialized_via)
select ('a9500000-0000-0000-0000-0000000000' || c || o)::uuid,
  ('d9500000-0000-0000-0000-00000000000' || c)::uuid,
  'c9500000-0000-0000-0000-000000000001'::uuid, 'coaching', o,
  case when o = 1 then current_date - 10 else current_date + 30 end, 'manual', 'admin_save'
from generate_series(1, 2) c, generate_series(1, 2) o;

insert into public.programme_enrollments (id, programme_id, user_id, cohort_id, organization_id, status)
select ('e9500000-0000-0000-0000-0000000000' || lpad(n::text, 2, '0'))::uuid,
  'c9500000-0000-0000-0000-000000000001'::uuid,
  ('f9500000-0000-0000-0000-0000000000' || lpad(n::text, 2, '0'))::uuid,
  case when n = 7 then 'd9500000-0000-0000-0000-000000000002' else 'd9500000-0000-0000-0000-000000000001' end::uuid,
  case when n <= 3 then 'b9500000-0000-0000-0000-00000000000a'::uuid
       when n <= 7 then 'b9500000-0000-0000-0000-00000000000b'::uuid
       else null end,
  'active'
from generate_series(1, 8) n;

create temporary table ids (label text primary key, id uuid);
insert into ids values
  ('X', 'd9500000-0000-0000-0000-000000000001'), ('Y', 'd9500000-0000-0000-0000-000000000002'),
  ('A1', 'e9500000-0000-0000-0000-000000000001'), ('A2', 'e9500000-0000-0000-0000-000000000002'),
  ('A3', 'e9500000-0000-0000-0000-000000000003'), ('B1', 'e9500000-0000-0000-0000-000000000004'),
  ('B2', 'e9500000-0000-0000-0000-000000000005'), ('B3', 'e9500000-0000-0000-0000-000000000006'),
  ('B4', 'e9500000-0000-0000-0000-000000000007'), ('N1', 'e9500000-0000-0000-0000-000000000008');
create or replace function pg_temp.id(p_label text) returns uuid language sql stable as
  $$ select id from ids where label = p_label $$;

-- ---------------------------------------------------------------------------
-- Sponsor A
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims',
  json_build_object('sub', 'f9500000-0000-0000-0000-000000000011', 'role', 'authenticated')::text, true);

select set_eq(
  $$select enrollment_id from public.sponsor_visible_enrollments()$$,
  $$select id from ids where label in ('A1', 'A2', 'A3')$$,
  'A: the visibility rule yields exactly the org-A enrollments');

select set_eq(
  $$select enrollment_id from public.sponsor_canonical_enrollment_progress(pg_temp.id('X'), current_date)$$,
  $$select id from ids where label in ('A1', 'A2', 'A3')$$,
  'A: shared cohort progress lists only org-A learners');

select set_eq(
  $$select enrollment_id from public.sponsor_canonical_enrollment_progress(null, current_date)$$,
  $$select id from ids where label in ('A1', 'A2', 'A3')$$,
  'A: all-cohort progress lists only org-A learners');

select set_eq(
  $$select enrollment_id from public.sponsor_canonical_enrollment_metadata(pg_temp.id('X'), null, current_date)$$,
  $$select id from ids where label in ('A1', 'A2', 'A3')$$,
  'A: roster metadata lists only org-A learners');

select set_eq(
  $$select cohort_id from public.sponsor_canonical_cohort_progress(null, current_date)$$,
  $$select id from ids where label = 'X'$$,
  'A: only cohorts holding an org-A enrollment are listed (not cohort Y, despite its cohort organisation)');

select is(
  (select array[enrollment_count, required_units]
     from public.sponsor_canonical_cohort_progress(pg_temp.id('X'), current_date)),
  array[3, 6],
  'A: cohort aggregate counts 3 leaders and their 3 x 2 required units, not the other organisation''s');

select is(
  (select required_units from public.sponsor_canonical_cohort_progress(pg_temp.id('X'), current_date)),
  (select sum(required_units)::integer from public.sponsor_canonical_enrollment_progress(pg_temp.id('X'), current_date)),
  'A: the cohort aggregate is exactly the rollup of the visible leader rows');

select is(
  (select suppressed from public.sponsor_canonical_cohort_progress(pg_temp.id('X'), current_date)),
  false,
  'A: a 3-leader organisation is not hidden by the whole-cohort size gate');

-- The minimum-leader privacy threshold now guards anonymous distributions
-- only; it is still defined, and it is never computed over another
-- organisation's learners: sponsor A's leader count in the mixed cohort is its
-- own 3, never the cohort's 7.
select is(public.sponsor_min_leaders_for_distribution(), 5,
  'privacy threshold for anonymous distributions is still 5');
select is(
  (select sum(enrollment_count)::integer from public.sponsor_canonical_cohort_progress(null, current_date)),
  (select count(*)::integer from public.sponsor_visible_enrollments()),
  'A: every leader count a sponsor receives is drawn from its visible enrollments only');

select ok(
  (select progress_source_complete from public.sponsor_canonical_cohort_progress(pg_temp.id('X'), current_date)),
  'A: every visible enrollment has a canonical progress row');

select is(
  (select array[satisfaction_rated_count] from public.sponsor_canonical_cohort_progress(pg_temp.id('X'), current_date)),
  array[0],
  'A: no ratings yet -> zero rated count');

select is(
  (select satisfaction_avg from public.sponsor_canonical_cohort_progress(pg_temp.id('X'), current_date)),
  null::numeric,
  'A: no ratings yet -> satisfaction is null, not 0');

select is_empty(
  $$select * from public.sponsor_canonical_cohort_progress(pg_temp.id('Y'), current_date)$$,
  'A: cohort Y (cohort organisation A, learners org B) is not visible to sponsor A');

select is(
  (select array[cohort_count, enrollment_count, required_units, suppressed_cohort_count]
     from public.sponsor_canonical_organisation_progress(current_date)),
  array[1, 3, 6, 0],
  'A: organisation rollup covers only org-A enrollments');

select ok(
  (select jsonb_array_length(public.sponsor_canonical_programme_journey(pg_temp.id('X'), current_date)) > 0),
  'A: the cohort journey has checkpoints');

select ok(
  (select bool_and((cp->>'total_leaders')::integer = 3)
     from jsonb_array_elements(public.sponsor_canonical_programme_journey(pg_temp.id('X'), current_date)) cp),
  'A: every cohort journey checkpoint counts only the 3 org-A leaders');

select is(
  (select count(*)::integer from public.sponsor_canonical_leader_progress(pg_temp.id('A1'), current_date)),
  1, 'A: leader detail for an org-A learner');

select is(
  (select count(*)::integer from public.sponsor_canonical_leader_progress(pg_temp.id('B1'), current_date)),
  0, 'A: no leader detail for an org-B learner in the same cohort');

select is(
  (select count(*)::integer from public.sponsor_canonical_enrollment_metadata(null, pg_temp.id('B1'), current_date)),
  0, 'A: no metadata for an org-B learner');

select ok(
  (select count(*) > 0 from public.sponsor_canonical_leader_schedule_state(pg_temp.id('A1'))),
  'A: schedule state for an org-A learner');

select is_empty(
  $$select * from public.sponsor_canonical_leader_schedule_state(pg_temp.id('B1'))$$,
  'A: no schedule state for an org-B learner');

select isnt(
  public.sponsor_canonical_leader_journey(pg_temp.id('A1'), current_date), '[]'::jsonb,
  'A: journey for an org-A learner');

select is(
  public.sponsor_canonical_leader_journey(pg_temp.id('B1'), current_date), '[]'::jsonb,
  'A: no journey for an org-B learner');

select is(
  public.sponsor_canonical_leader_experience(pg_temp.id('B1'), current_date), '{}'::jsonb,
  'A: no experience for an org-B learner');

select ok(not public.sponsor_can_view_enrollment(pg_temp.id('N1')),
  'A: an enrollment with no organisation is not visible (even though its cohort is org A''s)');

select lives_ok(
  $$select public.sponsor_submit_report_request(pg_temp.id('X'), 'shared cohort report')$$,
  'A: may request a report for a cohort holding its learners');

select throws_ok(
  $$select public.sponsor_submit_report_request(pg_temp.id('Y'), 'not mine')$$,
  'P0001', 'Cohort is not available to this sponsor',
  'A: may not request a report for a cohort without its learners');

-- ---------------------------------------------------------------------------
-- Sponsor B
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims',
  json_build_object('sub', 'f9500000-0000-0000-0000-000000000012', 'role', 'authenticated')::text, true);

select set_eq(
  $$select enrollment_id from public.sponsor_canonical_enrollment_progress(pg_temp.id('X'), current_date)$$,
  $$select id from ids where label in ('B1', 'B2', 'B3')$$,
  'B: shared cohort progress lists only org-B learners');

select set_eq(
  $$select cohort_id from public.sponsor_canonical_cohort_progress(null, current_date)$$,
  $$select id from ids where label in ('X', 'Y')$$,
  'B: sees the shared cohort and cohort Y (its learner is there)');

select is(
  (select array[enrollment_count, required_units]
     from public.sponsor_canonical_cohort_progress(pg_temp.id('X'), current_date)),
  array[3, 6],
  'B: shared cohort aggregate counts only the 3 org-B leaders');

select is(
  (select enrollment_count from public.sponsor_canonical_cohort_progress(pg_temp.id('Y'), current_date)),
  1, 'B: cohort Y aggregates its single org-B leader');

select is(
  (select array[cohort_count, enrollment_count]
     from public.sponsor_canonical_organisation_progress(current_date)),
  array[2, 4],
  'B: organisation rollup covers only org-B enrollments');

select ok(
  (select bool_and((cp->>'total_leaders')::integer = 3)
     from jsonb_array_elements(public.sponsor_canonical_programme_journey(pg_temp.id('X'), current_date)) cp),
  'B: every shared cohort journey checkpoint counts only the 3 org-B leaders');

select is(
  (select count(*)::integer from public.sponsor_canonical_leader_progress(pg_temp.id('A1'), current_date)),
  0, 'B: no leader detail for an org-A learner');

select ok(not public.sponsor_can_view_enrollment(pg_temp.id('N1')),
  'B: an enrollment with no organisation is not visible');

select is_empty(
  $$select * from public.sponsor_list_report_requests()$$,
  'B: does not see sponsor A''s report request');

-- The table policy agrees (it previously compared sp.organization_id with
-- itself and exposed every organisation's requests).
create temporary table _b_visible_requests (n integer);
grant all on _b_visible_requests to authenticated;
set local role authenticated;
insert into _b_visible_requests select count(*)::integer from public.sponsor_report_requests;
reset role;
select is((select n from _b_visible_requests), 0,
  'B: RLS hides sponsor A''s report request');

-- ---------------------------------------------------------------------------
-- Enrollment writers: mixed-organisation cohorts; NULL defaults to cohort org
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims',
  json_build_object('sub', 'f9500000-0000-0000-0000-000000000013', 'role', 'authenticated')::text, true);

select is(
  (select organization_id from public.create_programme_enrollment(
     'f9500000-0000-0000-0000-000000000009'::uuid, 'c9500000-0000-0000-0000-000000000001'::uuid,
     pg_temp.id('X'), 'b9500000-0000-0000-0000-00000000000b'::uuid, current_date, current_date + 90)),
  'b9500000-0000-0000-0000-00000000000b'::uuid,
  'an org-B learner can be enrolled into a cohort whose cohort organisation is A');

select is(
  (select organization_id from public.create_programme_enrollment(
     'f9500000-0000-0000-0000-000000000010'::uuid, 'c9500000-0000-0000-0000-000000000001'::uuid,
     pg_temp.id('X'), null, current_date, current_date + 90)),
  'b9500000-0000-0000-0000-00000000000a'::uuid,
  'a NULL enrollment organisation defaults to the cohort organisation');

-- The new org-B enrollment is immediately visible to sponsor B and not A.
select set_config('request.jwt.claims',
  json_build_object('sub', 'f9500000-0000-0000-0000-000000000012', 'role', 'authenticated')::text, true);
select is(
  (select enrollment_count from public.sponsor_canonical_cohort_progress(pg_temp.id('X'), current_date)),
  4, 'B: the newly enrolled org-B learner joins sponsor B''s shared-cohort aggregate');

select * from finish();
rollback;
