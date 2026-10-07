-- Admin alerts computed on read (20261006140000_admin_alerts_current).
--
--   a. Only an Admin reads them.
--   b. They come from canonical rows: an overdue requirement raises
--      needs_attention (decision 8: behind pace OR >= 1 overdue unit); a
--      completed session without the learner's reflection raises an info
--      reminder -- never a warning that completion is blocked.
--   c. Alerts are not stored: fixing the cause clears the alert.
--   d. Stored alerts of other types (Edge Functions) pass through with their id;
--      stored snapshots of the live types do not.
begin;
select plan(11);

-- 01 Coach K   02 leader L1 (overdue)   03 leader L2 (no reflections)   04 Admin
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_user_meta_data, created_at, updated_at, confirmation_token, email_change_token_new, recovery_token)
select ('fa000000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid,
  '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated',
  'alerts-' || n || '@example.test', 'test', now(),
  jsonb_build_object('full_name', 'Alerts Person ' || n), now(), now(), '', '', ''
from generate_series(1, 4) n;
insert into public.user_roles (user_id, role) values
  ('fa000000-0000-4000-8000-000000000001', 'coach'),
  ('fa000000-0000-4000-8000-000000000002', 'coachee'),
  ('fa000000-0000-4000-8000-000000000003', 'coachee'),
  ('fa000000-0000-4000-8000-000000000004', 'admin')
on conflict do nothing;
update public.profiles set status = 'active'::public.user_status where id::text like 'fa000000-%';
insert into public.coach_profiles (id, approval_status) values ('fa000000-0000-4000-8000-000000000001', 'active')
on conflict (id) do update set approval_status = 'active';

insert into public.programmes (id, name) values ('fa100000-0000-4000-8000-000000000001', 'Alerts Programme');
insert into public.programme_modules (programme_id, module, enabled, config) values
  ('fa100000-0000-4000-8000-000000000001', 'coaching', true, '{"required": true, "required_units": 2}');
insert into public.cohorts (id, name, programme_id, start_date, end_date) values
  ('fa200000-0000-4000-8000-000000000001', 'Alerts Cohort', 'fa100000-0000-4000-8000-000000000001',
   current_date - 60, current_date + 200);
update public.cohort_requirement_dates
   set due_on = case ordinal when 1 then current_date - 3 else current_date + 5 end,
       is_overridden = true, generation_method = 'manual', materialized_via = 'admin_save'
 where cohort_id = 'fa200000-0000-4000-8000-000000000001';
insert into public.cohort_coach_assignments (cohort_id, coach_id)
values ('fa200000-0000-4000-8000-000000000001', 'fa000000-0000-4000-8000-000000000001');
insert into public.programme_enrollments (id, programme_id, user_id, cohort_id, status, start_date, end_date)
select ('fa300000-0000-4000-8000-00000000000' || n)::uuid, 'fa100000-0000-4000-8000-000000000001',
  ('fa000000-0000-4000-8000-00000000000' || n)::uuid, 'fa200000-0000-4000-8000-000000000001',
  'active', current_date - 60, current_date + 200
from generate_series(2, 3) n;
-- Both have a goal, so the goal-setup alert stays out of this suite.
insert into public.coachee_goals (coachee_id, enrollment_id, title)
select ('fa000000-0000-4000-8000-00000000000' || n)::uuid, ('fa300000-0000-4000-8000-00000000000' || n)::uuid, 'Alerts goal'
from generate_series(2, 3) n;

-- L2 completed both units and has written no reflection.
select set_config('app.session_transition', 'on', true);
insert into public.sessions (id, enrollment_id, cohort_requirement_id, coach_id, coachee_id, topic, start_time, duration_minutes, status)
select ('fa400000-0000-4000-8000-00000000000' || d.ordinal)::uuid, 'fa300000-0000-4000-8000-000000000003', d.id,
  'fa000000-0000-4000-8000-000000000001', 'fa000000-0000-4000-8000-000000000003', 'Done ' || d.ordinal,
  now() - (case d.ordinal when 1 then 5 else 2 end || ' days')::interval, 60, 'completed'
from public.cohort_requirement_dates d
where d.cohort_id = 'fa200000-0000-4000-8000-000000000001' and d.module = 'coaching';
select set_config('app.session_transition', '', true);

-- L2 owes three follow-up actions, one already past its due date by a week,
-- two by a day; a fourth is not due yet. Written as history (the validator
-- requires a future due date at creation).
alter table public.enrollment_actions disable trigger user;
insert into public.enrollment_actions (enrollment_id, goal_id, title, owner_user_id, status, due_date, source_activity_type, source_activity_id)
select 'fa300000-0000-4000-8000-000000000003', g.id, 'Action ' || n, 'fa000000-0000-4000-8000-000000000003', 'open',
  case n when 1 then current_date - 7 when 4 then current_date + 3 else current_date - 1 end,
  'coaching', 'fa400000-0000-4000-8000-000000000001'
from generate_series(1, 4) n
cross join (select id from public.coachee_goals where enrollment_id = 'fa300000-0000-4000-8000-000000000003') g;
alter table public.enrollment_actions enable trigger user;

-- Stored rows: one an Edge Function would write, one a retired browser scan wrote.
insert into public.admin_alerts (severity, alert_type, title, message, related_coachee_id, resolved) values
  ('warning', 'triad_admin_alert', 'Triad group needs a session', 'From an Edge Function', 'fa000000-0000-4000-8000-000000000002', false),
  ('warning', 'feedback_response', 'Old snapshot', 'The coach can''t mark this session complete', 'fa000000-0000-4000-8000-000000000003', false);

create temporary table mine as select * from public.admin_alerts_current() limit 0;
grant all on mine to authenticated;

-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'fa000000-0000-4000-8000-000000000002')::text, true);
select throws_ok($$select * from public.admin_alerts_current()$$, '42501', null, 'a1. a learner cannot read Admin alerts');

select set_config('request.jwt.claims', json_build_object('sub', 'fa000000-0000-4000-8000-000000000004')::text, true);
insert into mine select * from public.admin_alerts_current() where related_user_id::text like 'fa000000-%';

select results_eq(
  $$select severity, count_value from mine where alert_type = 'needs_attention' and related_enrollment_id = 'fa300000-0000-4000-8000-000000000002'$$,
  $$values ('warning'::text, 1)$$,
  'b1. L1''s overdue Coaching unit raises needs_attention with the canonical overdue count');
select is((select count(*)::int from mine where alert_type = 'needs_attention' and related_enrollment_id = 'fa300000-0000-4000-8000-000000000003'),
  0, 'b2. L2 is ahead: no needs_attention');
select results_eq(
  $$select severity, count_value from mine where alert_type = 'reflection_outstanding'$$,
  $$values ('info'::text, 2)$$,
  'b3. L2''s two completed sessions without a reflection raise ONE info reminder');
select is((select count(*)::int from mine where severity = 'warning' and alert_type in ('reflection_outstanding', 'feedback_response')),
  0, 'b4. a missing reflection is never a warning');

select results_eq(
  $$select severity, count_value from mine where alert_type = 'overdue_actions'$$,
  $$values ('warning'::text, 3)$$,
  'b5. three open actions past their due date: one overdue_actions warning (the one not yet due is not counted)');
select is((select count(*)::int from mine where alert_type = 'overdue_actions' and related_enrollment_id = 'fa300000-0000-4000-8000-000000000002'),
  0, 'b6. no actions, no alert');

select results_eq(
  $$select alert_type, stored_title from mine where stored_alert_id is not null$$,
  $$values ('triad_admin_alert'::text, 'Triad group needs a session'::text)$$,
  'd1. a stored Edge Function alert passes through, resolvable by its id; the stale scan snapshot does not');

-- c. Fixing the cause clears the alert: L1 completes Coaching 1.
reset role;
select set_config('app.session_transition', 'on', true);
insert into public.sessions (enrollment_id, cohort_requirement_id, coach_id, coachee_id, topic, start_time, duration_minutes, status)
select 'fa300000-0000-4000-8000-000000000002', d.id, 'fa000000-0000-4000-8000-000000000001',
  'fa000000-0000-4000-8000-000000000002', 'Caught up', now() - interval '1 day', 60, 'completed'
from public.cohort_requirement_dates d
where d.cohort_id = 'fa200000-0000-4000-8000-000000000001' and d.module = 'coaching' and d.ordinal = 1;
select set_config('app.session_transition', '', true);
insert into public.session_learning_reflections (enrollment_id, source_activity_type, source_activity_id, body)
select 'fa300000-0000-4000-8000-000000000003', 'coaching', ('fa400000-0000-4000-8000-00000000000' || n)::uuid, 'Reflected'
from generate_series(1, 2) n;
set local role authenticated;
select is((select count(*)::int from public.admin_alerts_current()
            where alert_type = 'needs_attention' and related_enrollment_id = 'fa300000-0000-4000-8000-000000000002'),
  0, 'c1. once L1 catches up, the alert is gone -- nobody re-runs a scan');
select is((select count(*)::int from public.admin_alerts_current() where alert_type = 'reflection_outstanding'
            and related_enrollment_id = 'fa300000-0000-4000-8000-000000000003'),
  0, 'c2. once L2 reflects, the reminder is gone');
reset role;
select ok(not has_function_privilege('anon', 'public.admin_alerts_current()', 'EXECUTE'),
  'a2. anon cannot execute it');

select * from finish();
rollback;
