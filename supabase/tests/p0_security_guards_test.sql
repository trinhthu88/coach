-- P0 security guards (20261001100000_p0_security_guards).
--
--   1. A sponsor cannot move their own profile to another organisation; an
--      Admin can. get_sponsor_org() is not executable by clients, and a
--      sponsor still reads their own organisation.
--   2. Training evidence written by an end user carries the server's time,
--      never the client's; a view / prompt open is not turned into a
--      completion; trusted SQL may still write history.
--   3. Deleting a training week with evidence, a cohort with enrollments, or a
--      person on a Coaching / Mentoring session is refused.
begin;
select plan(27);

-- ---------------------------------------------------------------------------
-- Fixture
-- ---------------------------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_user_meta_data, created_at, updated_at, confirmation_token, email_change_token_new, recovery_token)
select ('f8800000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid,
  '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated',
  'p0guard-' || n || '@example.test', 'test', now(),
  jsonb_build_object('full_name', 'P0 User ' || n), now(), now(), '', '', ''
from unnest(array[1, 2, 3]) n;

insert into public.profiles (id, full_name, email, status)
select id, raw_user_meta_data->>'full_name', email, 'active'
from auth.users where email like 'p0guard-%'
on conflict (id) do update set full_name = excluded.full_name, status = 'active';

-- 01 admin, 02 sponsor of org A, 03 learner
insert into public.user_roles (user_id, role) values
  ('f8800000-0000-4000-8000-000000000001', 'admin'),
  ('f8800000-0000-4000-8000-000000000002', 'sponsor'),
  ('f8800000-0000-4000-8000-000000000003', 'coachee')
on conflict do nothing;

insert into public.organizations (id, name) values
  ('f8810000-0000-4000-8000-00000000000a', 'P0 Org A'),
  ('f8810000-0000-4000-8000-00000000000b', 'P0 Org B');
insert into public.sponsor_profiles (user_id, organization_id)
values ('f8800000-0000-4000-8000-000000000002', 'f8810000-0000-4000-8000-00000000000a');

insert into public.programmes (id, name, duration_months)
values ('f8820000-0000-4000-8000-000000000001', 'P0 Programme', 6);

-- Week 1 gets evidence; week 2 stays empty.
insert into public.training_weeks (id, programme_id, week_number, title, is_visible, skill_card_visible) values
  ('f8830000-0000-4000-8000-000000000001', 'f8820000-0000-4000-8000-000000000001', 1, 'P0 week 1', true, true),
  ('f8830000-0000-4000-8000-000000000002', 'f8820000-0000-4000-8000-000000000001', 2, 'P0 week 2', true, true);
insert into public.assignments (id, training_week_id, title, assignment_type, is_visible)
values ('f8840000-0000-4000-8000-000000000001', 'f8830000-0000-4000-8000-000000000001', 'P0 exercise', 'reflection', true);
insert into public.daily_prompts (id, training_week_id, day_offset, prompt_text, is_visible)
values ('f8850000-0000-4000-8000-000000000001', 'f8830000-0000-4000-8000-000000000001', 1, 'P0 prompt', true);
insert into public.programme_reflections (id, programme_id, reflection_number, title, appears_at_week, is_visible)
values ('f8860000-0000-4000-8000-000000000001', 'f8820000-0000-4000-8000-000000000001', 1, 'P0 reflection', 1, true);

insert into public.cohorts (id, name, programme_id, organization_id, start_date, end_date) values
  ('f8870000-0000-4000-8000-000000000001', 'P0 Cohort (enrolled)', 'f8820000-0000-4000-8000-000000000001',
   'f8810000-0000-4000-8000-00000000000a', current_date - 14, current_date + 100),
  ('f8870000-0000-4000-8000-000000000002', 'P0 Cohort (empty)', 'f8820000-0000-4000-8000-000000000001',
   'f8810000-0000-4000-8000-00000000000a', current_date - 14, current_date + 100);

insert into public.programme_enrollments (id, programme_id, user_id, cohort_id, organization_id, status, start_date)
values ('f8880000-0000-4000-8000-000000000001', 'f8820000-0000-4000-8000-000000000001',
  'f8800000-0000-4000-8000-000000000003', 'f8870000-0000-4000-8000-000000000001',
  'f8810000-0000-4000-8000-00000000000a', 'active', current_date - 14);

create function pg_temp.as_user(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;

-- ---------------------------------------------------------------------------
-- 1. Sponsor organisation
-- ---------------------------------------------------------------------------
select pg_temp.as_user('f8800000-0000-4000-8000-000000000002');
set local role authenticated;

select throws_ok(
  $$update public.sponsor_profiles set organization_id = 'f8810000-0000-4000-8000-00000000000b'
    where user_id = auth.uid()$$,
  '42501', null,
  'a sponsor cannot move their own profile to another organisation');
select lives_ok(
  $$update public.sponsor_profiles set phone = '+84 90 000 0000' where user_id = auth.uid()$$,
  'a sponsor can still edit their own contact details');
select is(
  (select array_agg(id) from public.organizations),
  array['f8810000-0000-4000-8000-00000000000a'::uuid],
  'a sponsor still reads exactly their own organisation');
select throws_ok(
  $$select public.get_sponsor_org('f8800000-0000-4000-8000-000000000002')$$,
  '42501', null,
  'get_sponsor_org is not callable by an authenticated client');
reset role;

select is(has_function_privilege('anon', 'public.get_sponsor_org(uuid)', 'execute'), false,
  'anon cannot execute get_sponsor_org');
select is(has_function_privilege('authenticated', 'public.get_sponsor_org(uuid)', 'execute'), false,
  'authenticated cannot execute get_sponsor_org');

select pg_temp.as_user('f8800000-0000-4000-8000-000000000001');
set local role authenticated;
select lives_ok(
  $$update public.sponsor_profiles set organization_id = 'f8810000-0000-4000-8000-00000000000b'
    where user_id = 'f8800000-0000-4000-8000-000000000002'$$,
  'an Admin can change a sponsor''s organisation');
reset role;
select is(
  (select organization_id from public.sponsor_profiles where user_id = 'f8800000-0000-4000-8000-000000000002'),
  'f8810000-0000-4000-8000-00000000000b'::uuid,
  'the Admin change is stored');
update public.sponsor_profiles set organization_id = 'f8810000-0000-4000-8000-00000000000a'
where user_id = 'f8800000-0000-4000-8000-000000000002';

-- ---------------------------------------------------------------------------
-- 2. Server-owned Training timestamps
-- ---------------------------------------------------------------------------
select pg_temp.as_user('f8800000-0000-4000-8000-000000000003');
set local role authenticated;

-- A view is not a completion.
insert into public.training_progress (user_id, enrollment_id, training_week_id, viewed_at)
values (auth.uid(), 'f8880000-0000-4000-8000-000000000001', 'f8830000-0000-4000-8000-000000000001', now());
select is(
  (select completed_at from public.training_progress where enrollment_id = 'f8880000-0000-4000-8000-000000000001'),
  null::timestamptz,
  'recording a view leaves the week uncompleted');

-- The reproduced attack: a back-dated completion.
update public.training_progress set completed_at = '2020-01-01'
where enrollment_id = 'f8880000-0000-4000-8000-000000000001';
select is(
  (select completed_at from public.training_progress where enrollment_id = 'f8880000-0000-4000-8000-000000000001'),
  now(),
  'a client-sent completed_at is replaced by the server time');
update public.training_progress set completed_at = '2020-01-01', viewed_at = now()
where enrollment_id = 'f8880000-0000-4000-8000-000000000001';
select is(
  (select completed_at from public.training_progress where enrollment_id = 'f8880000-0000-4000-8000-000000000001'),
  now(),
  'an existing completion cannot be re-dated');

-- A prompt open is not a response; a response carries the server time.
insert into public.daily_prompt_responses (user_id, enrollment_id, daily_prompt_id, opened_at)
values (auth.uid(), 'f8880000-0000-4000-8000-000000000001', 'f8850000-0000-4000-8000-000000000001', now());
select is(
  (select responded_at from public.daily_prompt_responses where enrollment_id = 'f8880000-0000-4000-8000-000000000001'),
  null::timestamptz,
  'opening a prompt does not record a response');
update public.daily_prompt_responses set responded_at = '2020-01-01', response_text = 'Back-dated'
where enrollment_id = 'f8880000-0000-4000-8000-000000000001';
select is(
  (select responded_at from public.daily_prompt_responses where enrollment_id = 'f8880000-0000-4000-8000-000000000001'),
  now(),
  'a client-sent responded_at is replaced by the server time');

insert into public.assignment_submissions (user_id, enrollment_id, assignment_id, submitted_at, reflection_text)
values (auth.uid(), 'f8880000-0000-4000-8000-000000000001', 'f8840000-0000-4000-8000-000000000001', '2020-01-01', 'Done');
select is(
  (select submitted_at from public.assignment_submissions where enrollment_id = 'f8880000-0000-4000-8000-000000000001'),
  now(),
  'a client-sent assignment submitted_at is replaced by the server time');

insert into public.reflection_submissions (user_id, enrollment_id, reflection_id, confidence_score, submitted_at)
values (auth.uid(), 'f8880000-0000-4000-8000-000000000001', 'f8860000-0000-4000-8000-000000000001', 4, '2020-01-01');
select is(
  (select submitted_at from public.reflection_submissions where enrollment_id = 'f8880000-0000-4000-8000-000000000001'),
  now(),
  'a client-sent reflection submitted_at is replaced by the server time');
update public.reflection_submissions set submitted_at = '2020-01-01', confidence_score = 5
where enrollment_id = 'f8880000-0000-4000-8000-000000000001';
select is(
  (select submitted_at from public.reflection_submissions where enrollment_id = 'f8880000-0000-4000-8000-000000000001'),
  now(),
  'editing a reflection does not re-date it');
reset role;

-- Trusted SQL (seeds, migrations, service role) may still write history.
update public.training_progress set completed_at = '2026-01-05'
where enrollment_id = 'f8880000-0000-4000-8000-000000000001';
select is(
  (select completed_at from public.training_progress where enrollment_id = 'f8880000-0000-4000-8000-000000000001'),
  '2026-01-05'::timestamptz,
  'a non-end-user write keeps its historical timestamp');
select is(public.request_is_end_user(), false, 'the table owner is not an end user');

-- ---------------------------------------------------------------------------
-- 3. Destructive deletes
-- ---------------------------------------------------------------------------
select throws_ok(
  $$delete from public.training_weeks where id = 'f8830000-0000-4000-8000-000000000001'$$,
  '23503', null,
  'a training week with learner evidence cannot be deleted');
select is(
  (select count(*)::int from public.training_progress where training_week_id = 'f8830000-0000-4000-8000-000000000001'),
  1,
  'the refused delete kept the evidence');
select lives_ok(
  $$delete from public.training_weeks where id = 'f8830000-0000-4000-8000-000000000002'$$,
  'a training week without evidence can still be deleted');

select throws_ok(
  $$delete from public.cohorts where id = 'f8870000-0000-4000-8000-000000000001'$$,
  '23503', null,
  'a cohort with enrollments cannot be deleted');
select lives_ok(
  $$delete from public.cohorts where id = 'f8870000-0000-4000-8000-000000000002'$$,
  'an empty cohort can still be deleted');

select is(
  (select confdeltype from pg_constraint where conname = c and conrelid = t::regclass),
  'r'::"char",
  c || ' is ON DELETE RESTRICT')
from (values ('sessions_coach_id_fkey', 'public.sessions'),
             ('sessions_coachee_id_fkey', 'public.sessions'),
             ('mentoring_sessions_mentor_id_fkey', 'public.mentoring_sessions'),
             ('mentoring_sessions_mentee_id_fkey', 'public.mentoring_sessions')) v(c, t);

select * from finish();
rollback;
