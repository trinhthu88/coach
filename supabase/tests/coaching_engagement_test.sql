-- Coaching-only engagements (20261006170000_coaching_engagements; decision 4).
--
-- An Admin creates a 1:1 coaching engagement in one call: a cohort of kind
-- 'engagement' whose only Coach is the engagement coach, the Coaching
-- requirement dates spread evenly from start to end, and the enrollment.
-- A Coach "Refer a client" request grants nothing by itself; the coach invite
-- path and its allowlist writes are retired.
begin;
select plan(19);

-- 01 Coach Kim   02 learner Lan   03 Coach Xuan (another cohort)   04 Admin
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_user_meta_data, created_at, updated_at, confirmation_token, email_change_token_new, recovery_token)
select ('fd000000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid,
  '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated',
  'engagement-' || n || '@example.test', 'test', now(),
  jsonb_build_object('full_name', (array['Kim', 'Lan', 'Xuan', 'Admin'])[n]), now(), now(), '', '', ''
from generate_series(1, 4) n;
insert into public.user_roles (user_id, role) values
  ('fd000000-0000-4000-8000-000000000001', 'coach'),
  ('fd000000-0000-4000-8000-000000000002', 'coachee'),
  ('fd000000-0000-4000-8000-000000000003', 'coach'),
  ('fd000000-0000-4000-8000-000000000004', 'admin')
on conflict do nothing;
update public.profiles set status = 'active'::public.user_status where id::text like 'fd000000-%';
update public.profiles set full_name = (array['Kim', 'Lan', 'Xuan', 'Admin'])[right(id::text, 1)::int] where id::text like 'fd000000-%';
insert into public.coach_profiles (id, approval_status) values
  ('fd000000-0000-4000-8000-000000000001', 'active'), ('fd000000-0000-4000-8000-000000000003', 'active')
on conflict (id) do update set approval_status = 'active';

insert into public.organizations (id, name) values ('fd500000-0000-4000-8000-000000000001', 'Engagement Org');
insert into public.programmes (id, name) values
  ('fd100000-0000-4000-8000-000000000001', '1:1 Coaching'),
  ('fd100000-0000-4000-8000-000000000002', 'Blended');
insert into public.programme_modules (programme_id, module, enabled, config) values
  ('fd100000-0000-4000-8000-000000000001', 'coaching', true, '{"required": true, "required_units": 3}'),
  ('fd100000-0000-4000-8000-000000000002', 'coaching', true, '{"required": true, "required_units": 2}'),
  ('fd100000-0000-4000-8000-000000000002', 'mentoring', true, '{"required": true, "required_units": 1}');
-- Xuan coaches a group cohort of the same programme.
insert into public.cohorts (id, name, programme_id, start_date, end_date) values
  ('fd200000-0000-4000-8000-000000000009', 'Group cohort', 'fd100000-0000-4000-8000-000000000001',
   public.programme_today() - 10, public.programme_today() + 80);
insert into public.cohort_coach_assignments (cohort_id, coach_id)
values ('fd200000-0000-4000-8000-000000000009', 'fd000000-0000-4000-8000-000000000003');

create temporary table made (enrollment_id uuid);
grant all on made to authenticated;

-- ---------------------------------------------------------------------------
-- Creating an engagement
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'fd000000-0000-4000-8000-000000000001')::text, true);
select throws_ok($$select public.admin_create_coaching_engagement('fd000000-0000-4000-8000-000000000002',
  'fd000000-0000-4000-8000-000000000001', 'fd100000-0000-4000-8000-000000000001',
  public.programme_today() - 40, public.programme_today() + 50, 'fd500000-0000-4000-8000-000000000001')$$,
  '42501', null, '1. only an Admin creates an engagement');

select set_config('request.jwt.claims', json_build_object('sub', 'fd000000-0000-4000-8000-000000000004')::text, true);
select throws_ok($$select public.admin_create_coaching_engagement('fd000000-0000-4000-8000-000000000002',
  'fd000000-0000-4000-8000-000000000001', 'fd100000-0000-4000-8000-000000000002',
  public.programme_today() - 40, public.programme_today() + 50, 'fd500000-0000-4000-8000-000000000001')$$,
  '22023', null, '2. the programme must have the Coaching module only');

select lives_ok($$insert into made select public.admin_create_coaching_engagement('fd000000-0000-4000-8000-000000000002',
  'fd000000-0000-4000-8000-000000000001', 'fd100000-0000-4000-8000-000000000001',
  public.programme_today() - 40, public.programme_today() + 50, 'fd500000-0000-4000-8000-000000000001')$$,
  '3. an Admin creates Lan''s engagement with Kim');

reset role;
create temporary table eng as
select e.id AS enrollment_id, e.cohort_id, e.organization_id, e.start_date, e.end_date, c.name, c.kind
from public.programme_enrollments e join public.cohorts c on c.id = e.cohort_id
where e.id = (select enrollment_id from made);
grant select on eng to authenticated;

select results_eq($$select name, kind, organization_id from eng$$,
  $$values ('Coaching – Lan – Kim'::text, 'engagement'::text, 'fd500000-0000-4000-8000-000000000001'::uuid)$$,
  '4. one cohort of kind engagement, named for the learner and the coach');
select results_eq(
  $$select coach_id from public.cohort_coach_assignments where cohort_id = (select cohort_id from eng)$$,
  $$values ('fd000000-0000-4000-8000-000000000001'::uuid)$$,
  '5. the engagement coach is the cohort''s only Coach');
select results_eq(
  $$select d.ordinal, d.due_on, d.is_overridden from public.cohort_requirement_dates d
     where d.cohort_id = (select cohort_id from eng) and d.module = 'coaching' order by d.ordinal$$,
  $$select g, (select start_date from eng) + round(((select end_date from eng) - (select start_date from eng)) * g / 3.0)::int, true
     from generate_series(1, 3) g$$,
  '6. three Coaching requirements spread evenly from start to end');
select is((select count(*)::int from public.cohorts where kind = 'group' and id = 'fd200000-0000-4000-8000-000000000009'),
  1, '7. an ordinary cohort is a group');

-- ---------------------------------------------------------------------------
-- The learner books only the engagement coach; every role sees one progress
-- ---------------------------------------------------------------------------
insert into public.coachee_goals (coachee_id, enrollment_id, title)
values ('fd000000-0000-4000-8000-000000000002', (select enrollment_id from eng), 'Engagement goal');
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'fd000000-0000-4000-8000-000000000002')::text, true);
select is(public.check_can_book_session('fd000000-0000-4000-8000-000000000001', (select enrollment_id from eng)),
  true, '8. Lan may book Kim');
select is(public.check_can_book_session('fd000000-0000-4000-8000-000000000003', (select enrollment_id from eng)),
  false, '9. ... and nobody else (Xuan coaches another cohort)');

reset role;
select set_config('app.session_transition', 'on', true);
insert into public.sessions (enrollment_id, cohort_requirement_id, coach_id, coachee_id, topic, start_time, duration_minutes, status)
select (select enrollment_id from eng), d.id, 'fd000000-0000-4000-8000-000000000001',
  'fd000000-0000-4000-8000-000000000002', 'First', now() - interval '2 days', 60, 'completed'
from public.cohort_requirement_dates d
where d.cohort_id = (select cohort_id from eng) and d.module = 'coaching' and d.ordinal = 1;
select set_config('app.session_transition', '', true);

-- Coaching 1 is due 10 days ago (start + 30): the session 2 days ago is
-- inside its window, so every viewer counts one unit.
create temporary table seen (viewer text, required integer, completed integer);
grant all on seen to authenticated;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'fd000000-0000-4000-8000-000000000002')::text, true);
insert into seen select 'learner', required_units, completed_units from public.learner_canonical_progress((select enrollment_id from eng));
select set_config('request.jwt.claims', json_build_object('sub', 'fd000000-0000-4000-8000-000000000001')::text, true);
insert into seen select 'coach', required_units, completed_units
  from public.coach_canonical_enrollment_progress(array[(select enrollment_id from eng)]);
select set_config('request.jwt.claims', json_build_object('sub', 'fd000000-0000-4000-8000-000000000004')::text, true);
insert into seen select 'admin', required_units, completed_units
  from public.admin_canonical_enrollment_progress(array[(select enrollment_id from eng)]);
select results_eq($$select viewer, required, completed from seen order by viewer$$,
  $$values ('admin'::text, 3, 1), ('coach', 3, 1), ('learner', 3, 1)$$,
  '10. learner, coach and Admin read the same progress');

select set_config('request.jwt.claims', json_build_object('sub', 'fd000000-0000-4000-8000-000000000001')::text, true);
select results_eq($$select enrollment_id, user_id from public.coach_engagement_enrollments()$$,
  $$select enrollment_id, 'fd000000-0000-4000-8000-000000000002'::uuid from eng$$,
  '11. the engagement learner is on Kim''s client list');
select set_config('request.jwt.claims', json_build_object('sub', 'fd000000-0000-4000-8000-000000000003')::text, true);
select is((select count(*)::int from public.coach_engagement_enrollments()), 0, '12. not on Xuan''s');

-- ---------------------------------------------------------------------------
-- Refer a client
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', 'fd000000-0000-4000-8000-000000000001')::text, true);
select lives_ok($$select public.coach_refer_client('Minh Tran', 'minh@example.test', 'fd100000-0000-4000-8000-000000000001', 'Met at a workshop')$$,
  '13. a Coach refers a client');
reset role;
select results_eq(
  $$select role, status, referred_by_coach_id, suggested_programme_id from public.access_requests where email = 'minh@example.test'$$,
  $$values ('executive'::text, 'pending'::text, 'fd000000-0000-4000-8000-000000000001'::uuid, 'fd100000-0000-4000-8000-000000000001'::uuid)$$,
  '14. the referral is a pending access request for Admin');
select is((select count(*)::int from public.profiles where email = 'minh@example.test'), 0,
  '15. it grants nothing by itself: no account, no enrollment');
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'fd000000-0000-4000-8000-000000000002')::text, true);
select throws_ok($$select public.coach_refer_client('Someone', 'someone@example.test', null, null)$$,
  '42501', null, '16. only a Coach refers');
reset role;

-- ---------------------------------------------------------------------------
-- The coach invite path is retired
-- ---------------------------------------------------------------------------
select ok(not has_table_privilege('authenticated', 'public.coachee_coach_allowlist', 'INSERT')
  and not has_table_privilege('authenticated', 'public.coachee_coach_allowlist', 'DELETE'),
  '17. no app role writes the coach allowlist');
select hasnt_function('public', 'remove_own_coachee', array['uuid'], '18. coaches no longer remove allowlisted clients');
select hasnt_function('public', 'get_own_coach_invite_slots', array[]::text[], '19. there are no invite slots');

select * from finish();
rollback;
