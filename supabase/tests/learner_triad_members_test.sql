-- Triad co-member identity (learner_triad_members).
--
-- Group G1 = learners A, B, C (cohort 1). D is in cohort 1 but not in G1.
-- E, F are in another programme/cohort with their own group G2. B and C have
-- profile status 'reach_limit' — the reported case where the general
-- "view active" discovery policy hid them. S is a sponsor of the org.
begin;

select plan(16);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_user_meta_data, created_at, updated_at, confirmation_token, email_change_token_new, recovery_token)
select ('a6000000-0000-0000-0000-00000000000' || n)::uuid, '00000000-0000-0000-0000-000000000000'::uuid,
  'authenticated', 'authenticated', 'triad-members-' || n || '@example.test', 'test', now(),
  jsonb_build_object('full_name', 'Triad Member ' || n), now(), now(), '', '', ''
from generate_series(1, 7) n;
-- 1=A 2=B 3=C 4=D (same cohort, not in group) 5=E 6=F (other programme) 7=S (sponsor)

update public.profiles set full_name = case id
    when 'a6000000-0000-0000-0000-000000000001' then 'Alex A'
    when 'a6000000-0000-0000-0000-000000000002' then 'Bea B'
    when 'a6000000-0000-0000-0000-000000000003' then 'Cam C'
    when 'a6000000-0000-0000-0000-000000000004' then 'Dee D'
    when 'a6000000-0000-0000-0000-000000000005' then 'Eli E'
    when 'a6000000-0000-0000-0000-000000000006' then 'Fay F'
    else full_name end,
  avatar_url = case when id = 'a6000000-0000-0000-0000-000000000002' then 'https://example.test/b.png' else avatar_url end
where id::text like 'a6000000-%';
update public.profiles set status = 'reach_limit'
where id in ('a6000000-0000-0000-0000-000000000002', 'a6000000-0000-0000-0000-000000000003');

insert into public.organizations (id, name) values ('b6000000-0000-0000-0000-000000000001', 'Triad members org');
insert into public.programmes (id, name) values
  ('c6000000-0000-0000-0000-000000000001', 'Triad members programme'),
  ('c6000000-0000-0000-0000-000000000002', 'Other programme');
insert into public.cohorts (id, name, programme_id, organization_id, start_date, end_date) values
  ('d6000000-0000-0000-0000-000000000001', 'Cohort 1', 'c6000000-0000-0000-0000-000000000001', 'b6000000-0000-0000-0000-000000000001', date '2026-01-05', date '2026-07-05'),
  ('d6000000-0000-0000-0000-000000000002', 'Cohort 2', 'c6000000-0000-0000-0000-000000000002', 'b6000000-0000-0000-0000-000000000001', date '2026-01-05', date '2026-07-05');
insert into public.programme_modules (programme_id, module, enabled, config) values
  ('c6000000-0000-0000-0000-000000000001', 'triads', true, '{"required":true,"required_units":2,"distribution_mode":"flexible","distribution_settings":{}}'),
  ('c6000000-0000-0000-0000-000000000002', 'triads', true, '{"required":true,"required_units":2,"distribution_mode":"flexible","distribution_settings":{}}');
insert into public.programme_enrollments (id, user_id, programme_id, cohort_id, organization_id, start_date, end_date, status)
select ('e6000000-0000-0000-0000-00000000000' || n)::uuid, ('a6000000-0000-0000-0000-00000000000' || n)::uuid,
  case when n <= 4 then 'c6000000-0000-0000-0000-000000000001' else 'c6000000-0000-0000-0000-000000000002' end::uuid,
  case when n <= 4 then 'd6000000-0000-0000-0000-000000000001' else 'd6000000-0000-0000-0000-000000000002' end::uuid,
  'b6000000-0000-0000-0000-000000000001', date '2026-01-05', date '2026-07-05', 'active'
from generate_series(1, 6) n;

insert into public.user_roles (user_id, role) values ('a6000000-0000-0000-0000-000000000007', 'sponsor');
insert into public.sponsor_profiles (user_id, organization_id) values ('a6000000-0000-0000-0000-000000000007', 'b6000000-0000-0000-0000-000000000001');

-- G1 = A, B, C in cohort 1; G2 is another programme's (cohort 2's) group.
insert into public.triad_groups (id, cohort_id, is_active) values
  ('f6000000-0000-0000-0000-000000000001', 'd6000000-0000-0000-0000-000000000001', true),
  ('f6000000-0000-0000-0000-000000000002', 'd6000000-0000-0000-0000-000000000002', true);
insert into public.triad_group_members (triad_group_id, enrollment_id, member_order) values
  ('f6000000-0000-0000-0000-000000000001', 'e6000000-0000-0000-0000-000000000001', 1),
  ('f6000000-0000-0000-0000-000000000001', 'e6000000-0000-0000-0000-000000000002', 2),
  ('f6000000-0000-0000-0000-000000000001', 'e6000000-0000-0000-0000-000000000003', 3),
  ('f6000000-0000-0000-0000-000000000002', 'e6000000-0000-0000-0000-000000000005', 1),
  ('f6000000-0000-0000-0000-000000000002', 'e6000000-0000-0000-0000-000000000006', 2);

create temporary table profile_policies_before as
select polname, polcmd, pg_get_expr(polqual, polrelid) as qual from pg_policy where polrelid = 'public.profiles'::regclass;
grant select on profile_policies_before to authenticated, anon;

-- ===== A =====
select set_config('request.jwt.claim.sub', 'a6000000-0000-0000-0000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

select results_eq(
  $$select member_slot, full_name, is_self from public.learner_triad_members(array['f6000000-0000-0000-0000-000000000001'::uuid]) order by member_slot$$,
  $$values (1, 'Alex A'::text, true), (2, 'Bea B'::text, false), (3, 'Cam C'::text, false)$$,
  'A resolves every member of their own triad, including members hidden from general discovery (reach_limit)'
);
select is(
  (select avatar_url from public.learner_triad_members(array['f6000000-0000-0000-0000-000000000001'::uuid]) where member_slot = 2),
  'https://example.test/b.png',
  'the member avatar is returned for display'
);
select is(
  (select count(*)::integer from public.profiles where id in ('a6000000-0000-0000-0000-000000000002', 'a6000000-0000-0000-0000-000000000003')),
  0,
  'profiles RLS itself is unchanged: A still cannot read B/C rows directly (the RPC is the only widened path)'
);
select is(
  (select count(*)::integer from public.learner_triad_members(array['f6000000-0000-0000-0000-000000000002'::uuid])),
  0,
  'A cannot resolve members of a triad in another programme/cohort'
);
select is(
  (select count(*)::integer from public.learner_triad_members(array['f6000000-0000-0000-0000-000000000001'::uuid]) where member_id = 'a6000000-0000-0000-0000-000000000004'),
  0,
  'A cannot resolve D, who is in the same cohort but not the same triad'
);
select is(
  (select count(distinct triad_group_id)::integer from public.learner_triad_members(array['f6000000-0000-0000-0000-000000000001'::uuid, 'f6000000-0000-0000-0000-000000000002'::uuid])),
  1,
  'asking for several groups returns only the groups the caller belongs to'
);

-- ===== B =====
select set_config('request.jwt.claim.sub', 'a6000000-0000-0000-0000-000000000002', true);
select results_eq(
  $$select full_name, is_self from public.learner_triad_members(array['f6000000-0000-0000-0000-000000000001'::uuid]) order by member_slot$$,
  $$values ('Alex A'::text, false), ('Bea B'::text, true), ('Cam C'::text, false)$$,
  'B resolves A and C'
);

-- ===== D (same cohort, not in the triad) =====
select set_config('request.jwt.claim.sub', 'a6000000-0000-0000-0000-000000000004', true);
select is((select count(*)::integer from public.learner_triad_members(array['f6000000-0000-0000-0000-000000000001'::uuid])), 0,
  'D (same cohort, not a member) resolves nothing for the triad');

-- ===== E (other programme) =====
select set_config('request.jwt.claim.sub', 'a6000000-0000-0000-0000-000000000005', true);
select is((select count(*)::integer from public.learner_triad_members(array['f6000000-0000-0000-0000-000000000001'::uuid])), 0,
  'a learner from another programme resolves nothing for the triad');

-- ===== Sponsor =====
select set_config('request.jwt.claim.sub', 'a6000000-0000-0000-0000-000000000007', true);
select is((select count(*)::integer from public.learner_triad_members(array['f6000000-0000-0000-0000-000000000001'::uuid])), 0,
  'a sponsor gains no individual triad member visibility');
select is((select count(*)::integer from public.profiles where id::text like 'a6000000-%' and id <> 'a6000000-0000-0000-0000-000000000007'), 0,
  'sponsor profile visibility is unchanged (no learner profiles)');

-- ===== Unauthenticated / anon =====
select set_config('request.jwt.claim.sub', '', true);
select is((select count(*)::integer from public.learner_triad_members(array['f6000000-0000-0000-0000-000000000001'::uuid])), 0,
  'an authenticated role without a user id resolves nothing');
reset role;
set local role anon;
select throws_ok(
  $$select * from public.learner_triad_members(array['f6000000-0000-0000-0000-000000000001'::uuid])$$,
  '42501', null, 'the anonymous role cannot execute the projection'
);
reset role;

-- ===== Shape / privacy of the contract =====
select is(
  pg_get_function_result('public.learner_triad_members(uuid[])'::regprocedure),
  'TABLE(triad_group_id uuid, member_id uuid, member_slot integer, full_name text, avatar_url text, is_self boolean)',
  'only id, slot, name and avatar are exposed'
);
select ok(
  pg_get_function_result('public.canonical_triad_group_members(uuid[])'::regprocedure)
    !~ 'email|phone|status|session|enrollment|goal|reflection|note|cohort'
  and pg_get_functiondef('public.canonical_triad_group_members(uuid[])'::regprocedure) ~ 'triad_group_members'
  and pg_get_functiondef('public.canonical_triad_group_members(uuid[])'::regprocedure)
    !~ 'email|phone|status|session|goal|reflection|note|cohort',
  'membership comes from triad_group_members only; no contact, status, session, enrollment or content fields are exposed'
);
select results_eq(
  $$select polname, polcmd, pg_get_expr(polqual, polrelid) from pg_policy where polrelid = 'public.profiles'::regclass order by 1$$,
  $$select polname, polcmd, qual from profile_policies_before order by 1$$,
  'profiles RLS policies are unchanged'
);

select * from finish();
rollback;
