-- Coaching no-show rule (20261007001300_coaching_no_show; decision 7 follow-up).
--
-- Mentoring already refuses a mentee cancel once the session has started.
-- Coaching now matches it: from the start time the learner can neither cancel
-- nor reschedule (a no-show counts as held); the Coach and an Admin are never
-- blocked. A learner cancel inside 24 hours with a reason still frees the unit.
begin;
select plan(10);

-- ---------------------------------------------------------------------------
-- Fixture: 01 learner L   02 Coach C   03 Admin A
-- ---------------------------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_user_meta_data, created_at, updated_at, confirmation_token, email_change_token_new, recovery_token)
select ('c4e00000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid,
  '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated',
  'noshow-' || n || '@example.test', 'test', now(),
  jsonb_build_object('full_name', 'No-show Person ' || n), now(), now(), '', '', ''
from generate_series(1, 3) n;
insert into public.user_roles (user_id, role) values
  ('c4e00000-0000-4000-8000-000000000001', 'coachee'),
  ('c4e00000-0000-4000-8000-000000000002', 'coach'),
  ('c4e00000-0000-4000-8000-000000000003', 'admin')
on conflict do nothing;
update public.profiles set status = 'active'::public.user_status where id::text like 'c4e00000-%';
insert into public.coach_profiles (id, approval_status) values ('c4e00000-0000-4000-8000-000000000002', 'active')
on conflict (id) do update set approval_status = 'active';

insert into public.programmes (id, name) values ('c4e10000-0000-4000-8000-000000000001', 'No-show Programme');
insert into public.programme_modules (programme_id, module, enabled, config) values
  ('c4e10000-0000-4000-8000-000000000001', 'coaching', true, '{"required": true, "required_units": 6}');
insert into public.cohorts (id, name, programme_id, start_date, end_date) values
  ('c4e20000-0000-4000-8000-000000000001', 'No-show Cohort', 'c4e10000-0000-4000-8000-000000000001',
   public.programme_today() - 30, public.programme_today() + 200);
update public.cohort_requirement_dates set due_on = public.programme_today() + 30, is_overridden = true,
  generation_method = 'manual', materialized_via = 'admin_save'
 where cohort_id = 'c4e20000-0000-4000-8000-000000000001';
insert into public.cohort_coach_assignments (cohort_id, coach_id)
values ('c4e20000-0000-4000-8000-000000000001', 'c4e00000-0000-4000-8000-000000000002');
insert into public.programme_enrollments (id, programme_id, user_id, cohort_id, status, start_date, end_date) values
  ('c4e30000-0000-4000-8000-000000000001', 'c4e10000-0000-4000-8000-000000000001', 'c4e00000-0000-4000-8000-000000000001',
   'c4e20000-0000-4000-8000-000000000001', 'active', public.programme_today() - 30, public.programme_today() + 200);
insert into public.coachee_goals (coachee_id, enrollment_id, title)
values ('c4e00000-0000-4000-8000-000000000001', 'c4e30000-0000-4000-8000-000000000001', 'No-show goal');

-- Trusted SQL: confirmed Coaching sessions of L with C, one per requirement.
create temporary table cs (name text primary key, id uuid);
grant select on cs to authenticated;
insert into cs values
  ('started',        'c4e40000-0000-4000-8000-000000000001'),
  ('started_resch',  'c4e40000-0000-4000-8000-000000000002'),
  ('started_coach',  'c4e40000-0000-4000-8000-000000000003'),
  ('started_admin',  'c4e40000-0000-4000-8000-000000000004'),
  ('in5hours',       'c4e40000-0000-4000-8000-000000000005'),
  ('in5hours_noreason', 'c4e40000-0000-4000-8000-000000000006');
select set_config('app.session_transition', 'on', true);
insert into public.sessions (id, enrollment_id, cohort_requirement_id, coach_id, coachee_id, topic, start_time, duration_minutes, status)
select v.id::uuid, 'c4e30000-0000-4000-8000-000000000001', d.id,
  'c4e00000-0000-4000-8000-000000000002', 'c4e00000-0000-4000-8000-000000000001', v.name, now() + v.offs, 60, 'confirmed'
from (values ('c4e40000-0000-4000-8000-000000000001', 'started',           interval '-1 hour',   1),
             ('c4e40000-0000-4000-8000-000000000002', 'started_resch',     interval '-30 minutes', 2),
             ('c4e40000-0000-4000-8000-000000000003', 'started_coach',     interval '-2 hours',  3),
             ('c4e40000-0000-4000-8000-000000000004', 'started_admin',     interval '-3 hours',  4),
             ('c4e40000-0000-4000-8000-000000000005', 'in5hours',          interval '5 hours',   5),
             ('c4e40000-0000-4000-8000-000000000006', 'in5hours_noreason', interval '6 hours',   6)) v(id, name, offs, ordinal)
join public.cohort_requirement_dates d
  on d.cohort_id = 'c4e20000-0000-4000-8000-000000000001' and d.module = 'coaching' and d.ordinal = v.ordinal;
select set_config('app.session_transition', '', true);

-- ---------------------------------------------------------------------------
-- Learner
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'c4e00000-0000-4000-8000-000000000001')::text, true);

select throws_ok($$select public.cancel_coaching_session((select id from cs where name = 'started'), 'I did not make it')$$,
  '42501', null, 'n1. the learner cannot cancel a Coaching session once it has started');
select throws_ok($$select public.reschedule_coaching_session((select id from cs where name = 'started_resch'),
    'c4e90000-0000-4000-8000-000000000001', 'Missed it')$$,
  '42501', null, 'n2. the learner cannot reschedule a Coaching session once it has started');
select throws_ok($$select public.cancel_coaching_session((select id from cs where name = 'in5hours_noreason'))$$,
  '23514', null, 'n3. inside 24 hours the learner still needs a reason');
select lives_ok($$select public.cancel_coaching_session((select id from cs where name = 'in5hours'), 'Called into a board meeting')$$,
  'n4. inside 24 hours, with a reason, the learner can cancel');

-- ---------------------------------------------------------------------------
-- Coach and Admin are never blocked
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', 'c4e00000-0000-4000-8000-000000000002')::text, true);
select lives_ok($$select public.cancel_coaching_session((select id from cs where name = 'started_coach'))$$,
  'n5. the Coach can still cancel after the start');
select lives_ok($$select public.complete_coaching_session((select id from cs where name = 'started'))$$,
  'n6. the Coach marks the learner no-show as held');
select set_config('request.jwt.claims', json_build_object('sub', 'c4e00000-0000-4000-8000-000000000003')::text, true);
select lives_ok($$select public.cancel_coaching_session((select id from cs where name = 'started_admin'))$$,
  'n7. an Admin can still cancel after the start');
reset role;

-- ---------------------------------------------------------------------------
-- Resulting state
-- ---------------------------------------------------------------------------
select is((select status::text from public.sessions where id = (select id from cs where name = 'started')),
  'completed', 'n8. the no-show the learner tried to cancel counts as held');
select is((select status::text from public.sessions where id = (select id from cs where name = 'started_resch')),
  'confirmed', 'n9. the started session the learner tried to move is unchanged');
select is((select status::text from public.sessions where id = (select id from cs where name = 'in5hours')),
  'cancelled', 'n10. the late cancel with a reason freed the unit');

select * from finish();
rollback;
