-- Spec hardening (20260926100000, 20260926200000):
--   * get_primary_role ranks admin > sponsor > coach > coachee (same as the client);
--   * sponsor visibility requires the sponsor ROLE, not just a sponsor_profiles row;
--   * admin_transition_enrollment accepts the service role (admin-invite-users),
--     still refuses non-admins, and keeps the organization an org-only
--     correction replaced.
begin;
select plan(12);

insert into auth.users(id, email, raw_user_meta_data) values
 ('a8100000-0000-4000-8000-000000000001', 'hardening-admin@example.test',   '{"full_name":"Hardening admin"}'),
 ('a8100000-0000-4000-8000-000000000002', 'hardening-learner@example.test', '{"full_name":"Hardening learner"}'),
 ('a8100000-0000-4000-8000-000000000003', 'hardening-sponsor@example.test', '{"full_name":"Hardening sponsor"}'),
 ('a8100000-0000-4000-8000-000000000004', 'hardening-multi@example.test',   '{"full_name":"Hardening multi-role"}'),
 ('a8100000-0000-4000-8000-000000000005', 'hardening-other@example.test',   '{"full_name":"Hardening outsider"}');

insert into public.user_roles(user_id, role) values
 ('a8100000-0000-4000-8000-000000000001', 'admin'),
 ('a8100000-0000-4000-8000-000000000004', 'coach')
on conflict do nothing;

insert into public.organizations(id, name) values
 ('a8100000-0000-4000-8000-000000000050', 'Hardening org A'),
 ('a8100000-0000-4000-8000-000000000051', 'Hardening org B');
insert into public.programmes(id, name, duration_months) values
 ('a8100000-0000-4000-8000-000000000010', 'Hardening programme', 3);
insert into public.cohorts(id, name, programme_id, organization_id, start_date, end_date) values
 ('a8100000-0000-4000-8000-000000000020', 'Hardening cohort', 'a8100000-0000-4000-8000-000000000010',
  'a8100000-0000-4000-8000-000000000050', '2026-01-01', '2027-06-01');

-- ---------------------------------------------------------------------------
-- Role priority
-- ---------------------------------------------------------------------------
select is(public.get_primary_role('a8100000-0000-4000-8000-000000000004'), 'coach'::public.app_role,
  'a coach (plus the trigger-default coachee row, if any) resolves to coach');

insert into public.user_roles(user_id, role) values ('a8100000-0000-4000-8000-000000000004', 'sponsor')
on conflict do nothing;
insert into public.sponsor_profiles(user_id, organization_id)
values ('a8100000-0000-4000-8000-000000000004', 'a8100000-0000-4000-8000-000000000050');
select is(public.get_primary_role('a8100000-0000-4000-8000-000000000004'), 'sponsor'::public.app_role,
  'sponsor outranks coach');
select is(public.get_primary_role('a8100000-0000-4000-8000-000000000001'), 'admin'::public.app_role,
  'admin stays first');

-- ---------------------------------------------------------------------------
-- admin_transition_enrollment: service role allowed, non-admin refused
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', 'a8100000-0000-4000-8000-000000000005', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;
select throws_ok(
  $$select public.admin_transition_enrollment('a8100000-0000-4000-8000-000000000002', null,
      'a8100000-0000-4000-8000-000000000020', null, '2026-02-01')$$,
  '42501', 'Only an administrator can change enrolments', 'a non-admin still cannot transition enrollments');
reset role;

-- The admin-invite-users edge function: service role, no end-user subject.
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', 'service_role', true);
select is(
  (public.admin_transition_enrollment('a8100000-0000-4000-8000-000000000002', null,
     'a8100000-0000-4000-8000-000000000020', null, '2026-02-01'))->>'action',
  'created', 'the service role can create an enrollment through the transition path');

-- An org-only change is a correction of the current enrollment, and the
-- organization it replaces is recorded rather than lost.
select set_config('request.jwt.claim.sub', 'a8100000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select is(
  (public.admin_transition_enrollment('a8100000-0000-4000-8000-000000000002', null,
     'a8100000-0000-4000-8000-000000000020', 'a8100000-0000-4000-8000-000000000051', '2026-03-01'))->>'action',
  'organization_updated', 'an organization-only change updates the ongoing enrollment');
select is(
  (select count(*)::int from public.programme_enrollment_organization_changes c
   join public.programme_enrollments e on e.id = c.enrollment_id
   where e.user_id = 'a8100000-0000-4000-8000-000000000002'
     and c.previous_organization_id = 'a8100000-0000-4000-8000-000000000050'
     and c.new_organization_id = 'a8100000-0000-4000-8000-000000000051'
     and c.changed_by = 'a8100000-0000-4000-8000-000000000001'),
  1, 'the replaced organization is kept in programme_enrollment_organization_changes');
select is(
  (select count(*)::int from public.programme_enrollments
   where user_id = 'a8100000-0000-4000-8000-000000000002'),
  1, 'no second enrollment was created by the correction');

-- ---------------------------------------------------------------------------
-- Sponsor visibility requires the sponsor role
-- ---------------------------------------------------------------------------
insert into public.user_roles(user_id, role) values ('a8100000-0000-4000-8000-000000000003', 'sponsor')
on conflict do nothing;
insert into public.sponsor_profiles(user_id, organization_id)
values ('a8100000-0000-4000-8000-000000000003', 'a8100000-0000-4000-8000-000000000051');

select set_config('request.jwt.claim.sub', 'a8100000-0000-4000-8000-000000000003', true);
set local role authenticated;
select is((select count(*)::int from public.sponsor_visible_enrollments()), 1,
  'the org-B sponsor sees the org-B enrollment (enrollment organization, not the cohort''s org A)');
reset role;

select set_config('request.jwt.claim.sub', 'a8100000-0000-4000-8000-000000000001', true);
delete from public.user_roles where user_id = 'a8100000-0000-4000-8000-000000000003' and role = 'sponsor';
select ok(exists (select 1 from public.sponsor_profiles where user_id = 'a8100000-0000-4000-8000-000000000003'),
  'the sponsor profile row survives the role removal');

select set_config('request.jwt.claim.sub', 'a8100000-0000-4000-8000-000000000003', true);
set local role authenticated;
select is((select count(*)::int from public.sponsor_visible_enrollments()), 0,
  'without the sponsor role the leftover profile row grants no visibility');
select is(public.sponsor_can_view_enrollment(
    (select id from public.programme_enrollments where user_id = 'a8100000-0000-4000-8000-000000000002')),
  false, 'sponsor_can_view_enrollment follows the same rule');
reset role;

select * from finish();
rollback;
