begin;
select plan(17);

-- Fixtures: an admin, a learner, an outsider; two programmes with one cohort
-- each, all owned by one organization.
insert into auth.users(id,email,raw_user_meta_data) values
 ('a7000000-0000-4000-8000-000000000001','transition-admin@example.test','{"full_name":"Transition admin"}'),
 ('a7000000-0000-4000-8000-000000000002','transition-learner@example.test','{"full_name":"Transition learner"}'),
 ('a7000000-0000-4000-8000-000000000003','transition-outsider@example.test','{"full_name":"Transition outsider"}');
insert into public.user_roles(user_id,role) values ('a7000000-0000-4000-8000-000000000001','admin')
on conflict do nothing;
insert into public.organizations(id,name) values
 ('a7000000-0000-4000-8000-000000000050','Transition org'),
 ('a7000000-0000-4000-8000-000000000051','Transition org B');
insert into public.programmes(id,name,duration_months) values
 ('a7000000-0000-4000-8000-000000000010','Transition programme A',3),
 ('a7000000-0000-4000-8000-000000000011','Transition programme B',3);
insert into public.cohorts(id,name,programme_id,organization_id,start_date,end_date) values
 ('a7000000-0000-4000-8000-000000000020','Transition cohort A','a7000000-0000-4000-8000-000000000010','a7000000-0000-4000-8000-000000000050','2026-01-01','2027-06-01'),
 ('a7000000-0000-4000-8000-000000000021','Transition cohort B','a7000000-0000-4000-8000-000000000011','a7000000-0000-4000-8000-000000000050','2026-01-01','2027-06-01');

select has_function('public','admin_transition_enrollment',array['uuid','uuid','uuid','uuid','date'],'transition RPC exists');

-- Non-admin is rejected.
select set_config('request.jwt.claim.sub','a7000000-0000-4000-8000-000000000003',true);
select set_config('request.jwt.claim.role','authenticated',true);
set local role authenticated;
select throws_ok(
  $$select public.admin_transition_enrollment('a7000000-0000-4000-8000-000000000002','a7000000-0000-4000-8000-000000000010','a7000000-0000-4000-8000-000000000020',null,'2026-02-01')$$,
  '42501', 'Only an administrator can change enrolments', 'non-admin cannot transition enrollments');
reset role;

select set_config('request.jwt.claim.sub','a7000000-0000-4000-8000-000000000001',true);
set local role authenticated;

-- First enrollment: no ongoing row, programme derived from the cohort, org defaulted from the cohort.
select is(
  (public.admin_transition_enrollment('a7000000-0000-4000-8000-000000000002',null,'a7000000-0000-4000-8000-000000000020',null,'2026-02-01'))->>'action',
  'created', 'first call creates an enrollment');
reset role;
select is((select count(*)::int from public.programme_enrollments where user_id='a7000000-0000-4000-8000-000000000002'),1,'one enrollment exists');
select is((select organization_id from public.programme_enrollments where user_id='a7000000-0000-4000-8000-000000000002'),
  'a7000000-0000-4000-8000-000000000050'::uuid,'organization defaults to the cohort organization');

set local role authenticated;
-- Conflicting explicit programme is rejected.
select throws_ok(
  $$select public.admin_transition_enrollment('a7000000-0000-4000-8000-000000000002','a7000000-0000-4000-8000-000000000011','a7000000-0000-4000-8000-000000000020',null,'2026-03-01')$$,
  'P0001', 'The selected cohort does not belong to the selected programme', 'programme/cohort mismatch rejected');

-- Same programme + cohort + org: no-op.
select is(
  (public.admin_transition_enrollment('a7000000-0000-4000-8000-000000000002','a7000000-0000-4000-8000-000000000010','a7000000-0000-4000-8000-000000000020','a7000000-0000-4000-8000-000000000050','2026-03-01'))->>'action',
  'unchanged', 'identical request is a no-op');

-- Move to programme B / cohort B. (Run as the table owner so the temp table
-- can be created; authorization is by the admin JWT subject, not the DB role.)
reset role;
create temporary table transition_result on commit drop as
  select public.admin_transition_enrollment('a7000000-0000-4000-8000-000000000002',null,'a7000000-0000-4000-8000-000000000021',null,'2026-03-15') as r;
reset role;

select is((select r->>'action' from transition_result),'transitioned','moving cohorts transitions');
select is((select count(*)::int from public.programme_enrollments where user_id='a7000000-0000-4000-8000-000000000002'),2,'history preserved: two enrollments');
select is(
  (select status::text from public.programme_enrollments where id = (select (r->>'closed_enrollment_id')::uuid from transition_result)),
  'completed','previous enrollment closed');
select is(
  (select end_date from public.programme_enrollments where id = (select (r->>'closed_enrollment_id')::uuid from transition_result)),
  '2026-03-15'::date,'previous enrollment ends on the effective date');
select results_eq(
  $$select programme_id, cohort_id, organization_id, ended_reason, superseded_by
      from public.programme_enrollments where id = (select (r->>'closed_enrollment_id')::uuid from transition_result)$$,
  $$values ('a7000000-0000-4000-8000-000000000010'::uuid,'a7000000-0000-4000-8000-000000000020'::uuid,
            'a7000000-0000-4000-8000-000000000050'::uuid,'transferred'::text,(select (r->>'enrollment_id')::uuid from transition_result))$$,
  'previous enrollment keeps its programme/cohort/org and links to its successor');
select results_eq(
  $$select programme_id, cohort_id, status::text, start_date
      from public.programme_enrollments where id = (select (r->>'enrollment_id')::uuid from transition_result)$$,
  $$values ('a7000000-0000-4000-8000-000000000011'::uuid,'a7000000-0000-4000-8000-000000000021'::uuid,'active'::text,'2026-03-15'::date)$$,
  'new enrollment created in the target cohort');
select is((select count(*)::int from public.programme_enrollments
           where user_id='a7000000-0000-4000-8000-000000000002' and status in ('active','at_risk','paused')),1,
  'exactly one ongoing enrollment after the transition');

-- Organization-only change updates the current enrollment in place.
set local role authenticated;
select is(
  (public.admin_transition_enrollment('a7000000-0000-4000-8000-000000000002',null,'a7000000-0000-4000-8000-000000000021','a7000000-0000-4000-8000-000000000051','2026-04-01'))->>'action',
  'organization_updated', 'organization-only change is an in-place correction');
reset role;
select is((select count(*)::int from public.programme_enrollments where user_id='a7000000-0000-4000-8000-000000000002'),2,'organization correction creates no new enrollment');

-- Anonymous callers have no execute privilege.
select ok(not has_function_privilege('anon','public.admin_transition_enrollment(uuid,uuid,uuid,uuid,date)','EXECUTE'),
  'anon cannot execute the transition');

select * from finish();
rollback;
