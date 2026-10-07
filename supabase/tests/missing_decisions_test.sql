-- Missing decisions (20261007000800_missing_decisions; Prompt 13: decisions 5, 7, 9).
--
--   e. 9e: organizations.is_demo, and one reporting population
--      (reporting_enrollments) behind the Admin rollups, admin_alerts_current,
--      admin_canonical_completion_rate (chosen on the server) and the Sponsor
--      rollups. A Sponsor still sees their own (demo) organisation.
--   m. Decision 7: Mentoring cancels like Coaching (free until 24 h before,
--      a reason after), and a learner no-show counts as held: from the start
--      time only the Mentor or an Admin acts.
--   f. Decision 9: final_assessment_* columns in the progress rollups, so the
--      module cards add up to the total.
begin;
select plan(28);

-- ---------------------------------------------------------------------------
-- Fixture
-- ---------------------------------------------------------------------------
-- 01 learner U1 (real org R)   02 learner U2 (demo org D)   03 mentee U3 (org R)
-- 04 Admin   05 Sponsor SR (org R)   06 Sponsor SD (demo org D)   07 Mentor M
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_user_meta_data, created_at, updated_at, confirmation_token, email_change_token_new, recovery_token)
select ('c3d00000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid,
  '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated',
  'decide-' || n || '@example.test', 'test', now(),
  jsonb_build_object('full_name', 'Decide Person ' || n), now(), now(), '', '', ''
from generate_series(1, 7) n;
insert into public.user_roles (user_id, role) values
  ('c3d00000-0000-4000-8000-000000000001', 'coachee'), ('c3d00000-0000-4000-8000-000000000002', 'coachee'),
  ('c3d00000-0000-4000-8000-000000000003', 'coachee'), ('c3d00000-0000-4000-8000-000000000004', 'admin'),
  ('c3d00000-0000-4000-8000-000000000005', 'sponsor'), ('c3d00000-0000-4000-8000-000000000006', 'sponsor'),
  ('c3d00000-0000-4000-8000-000000000007', 'coach')
on conflict do nothing;
update public.profiles set status = 'active'::public.user_status where id::text like 'c3d00000-%';
insert into public.coach_profiles (id, approval_status) values ('c3d00000-0000-4000-8000-000000000007', 'active')
on conflict (id) do update set approval_status = 'active';
insert into public.mentor_profiles (coach_user_id, is_active) values ('c3d00000-0000-4000-8000-000000000007', true)
on conflict do nothing;

insert into public.organizations (id, name) values
  ('c3d50000-0000-4000-8000-000000000001', 'Decide Real Org'),
  ('c3d50000-0000-4000-8000-000000000002', 'Decide Demo Org');
insert into public.sponsor_profiles (user_id, organization_id) values
  ('c3d00000-0000-4000-8000-000000000005', 'c3d50000-0000-4000-8000-000000000001'),
  ('c3d00000-0000-4000-8000-000000000006', 'c3d50000-0000-4000-8000-000000000002');

-- Programme P9: one Coaching unit (overdue) and a Final Assessment.
-- Programme PM: four Mentoring units.
insert into public.programmes (id, name) values
  ('c3d10000-0000-4000-8000-000000000001', 'Decide Reporting Programme'),
  ('c3d10000-0000-4000-8000-000000000002', 'Decide Mentoring Programme');
insert into public.programme_modules (programme_id, module, enabled, config) values
  ('c3d10000-0000-4000-8000-000000000001', 'coaching', true, '{"required": true, "required_units": 1}'),
  ('c3d10000-0000-4000-8000-000000000001', 'final_assessment', true, '{"required": true}'),
  ('c3d10000-0000-4000-8000-000000000002', 'mentoring', true, '{"required": true, "required_units": 4}');
insert into public.cohorts (id, name, programme_id, start_date, end_date) values
  ('c3d20000-0000-4000-8000-000000000001', 'Decide Reporting Cohort', 'c3d10000-0000-4000-8000-000000000001',
   public.programme_today() - 60, public.programme_today() + 60),
  ('c3d20000-0000-4000-8000-000000000002', 'Decide Mentoring Cohort', 'c3d10000-0000-4000-8000-000000000002',
   public.programme_today() - 30, public.programme_today() + 200);
update public.cohort_requirement_dates set due_on = public.programme_today() - 5, is_overridden = true,
  generation_method = 'manual', materialized_via = 'admin_save'
 where cohort_id = 'c3d20000-0000-4000-8000-000000000001' and module = 'coaching';
update public.cohort_requirement_dates set due_on = public.programme_today() + 10, is_overridden = true,
  generation_method = 'manual', materialized_via = 'admin_save'
 where cohort_id = 'c3d20000-0000-4000-8000-000000000002';
insert into public.programme_enrollments (id, programme_id, user_id, cohort_id, organization_id, status, start_date, end_date) values
  ('c3d30000-0000-4000-8000-000000000001', 'c3d10000-0000-4000-8000-000000000001', 'c3d00000-0000-4000-8000-000000000001',
   'c3d20000-0000-4000-8000-000000000001', 'c3d50000-0000-4000-8000-000000000001', 'active', public.programme_today() - 60, public.programme_today() + 60),
  ('c3d30000-0000-4000-8000-000000000002', 'c3d10000-0000-4000-8000-000000000001', 'c3d00000-0000-4000-8000-000000000002',
   'c3d20000-0000-4000-8000-000000000001', 'c3d50000-0000-4000-8000-000000000002', 'active', public.programme_today() - 60, public.programme_today() + 60),
  ('c3d30000-0000-4000-8000-000000000003', 'c3d10000-0000-4000-8000-000000000002', 'c3d00000-0000-4000-8000-000000000003',
   'c3d20000-0000-4000-8000-000000000002', 'c3d50000-0000-4000-8000-000000000001', 'active', public.programme_today() - 30, public.programme_today() + 200);
insert into public.coachee_goals (coachee_id, enrollment_id, title)
select e.user_id, e.id, 'Decide goal' from public.programme_enrollments e where e.id::text like 'c3d30000-%';
insert into public.cohort_mentors (cohort_id, mentor_user_id)
values ('c3d20000-0000-4000-8000-000000000002', 'c3d00000-0000-4000-8000-000000000007');

-- ===========================================================================
-- e. 9e: demo organisations are not reported
-- ===========================================================================
select is((select is_demo from public.organizations where id = 'c3d50000-0000-4000-8000-000000000001'),
  false, 'e1. organizations.is_demo defaults to false');
update public.organizations set is_demo = true where id = 'c3d50000-0000-4000-8000-000000000002';
select ok(not exists (select 1 from public.organizations
                       where name in ('Clariva Demo Organization A', 'Clariva Demo Organization B',
                                      'Clariva Erickson Demo Organisation', 'Clariva Demo Organization')
                         and not is_demo),
  'e2. every demo organisation present is marked is_demo');

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'c3d00000-0000-4000-8000-000000000004')::text, true);
select ok(not has_function_privilege('authenticated', 'public.reporting_enrollments()', 'EXECUTE')
  and not has_function_privilege('anon', 'public.reporting_enrollments()', 'EXECUTE'),
  'e3. reporting_enrollments() is not client-callable');
select results_eq(
  $$select enrollment_count, required_units, completed_units
      from public.admin_canonical_completion_rate(p_programme_id => 'c3d10000-0000-4000-8000-000000000001')$$,
  $$values (1, 2, 0)$$,
  'e4. the completion rate''s population is chosen on the server: the demo learner is left out');
select ok(exists (select 1 from public.admin_alerts_current() where related_enrollment_id = 'c3d30000-0000-4000-8000-000000000001')
  and not exists (select 1 from public.admin_alerts_current() where related_enrollment_id = 'c3d30000-0000-4000-8000-000000000002'),
  'e5. admin_alerts_current: the real learner''s overdue unit raises an alert, the demo learner''s does not');
select ok(exists (select 1 from public.admin_enrollment_inactivity('c3d10000-0000-4000-8000-000000000001') where enrollment_id = 'c3d30000-0000-4000-8000-000000000001')
  and not exists (select 1 from public.admin_enrollment_inactivity('c3d10000-0000-4000-8000-000000000001') where enrollment_id = 'c3d30000-0000-4000-8000-000000000002'),
  'e6. admin_enrollment_inactivity: the demo learner is left out');
select is((select count(*)::int from public.admin_goal_setup_overdue() where enrollment_id = 'c3d30000-0000-4000-8000-000000000002'),
  0, 'e7. admin_goal_setup_overdue: never a demo learner');

select set_config('request.jwt.claims', json_build_object('sub', 'c3d00000-0000-4000-8000-000000000005')::text, true);
select is((select array_agg(enrollment_id) from public.sponsor_canonical_enrollment_progress('c3d20000-0000-4000-8000-000000000001')),
  array['c3d30000-0000-4000-8000-000000000001'::uuid], 'e8. a real Sponsor''s rollup holds only their own organisation''s leader');
select set_config('request.jwt.claims', json_build_object('sub', 'c3d00000-0000-4000-8000-000000000006')::text, true);
select is((select array_agg(enrollment_id) from public.sponsor_canonical_enrollment_progress('c3d20000-0000-4000-8000-000000000001')),
  array['c3d30000-0000-4000-8000-000000000002'::uuid], 'e9. the demo Sponsor still sees their own (demo) organisation');
reset role;
select ok(pg_get_functiondef('public.sponsor_visible_enrollments()'::regprocedure) ~ 'reporting_enrollments'
  and pg_get_functiondef('public.admin_alerts_current()'::regprocedure) ~ 'reporting_enrollments'
  and pg_get_functiondef('public.admin_enrollment_satisfaction(uuid[])'::regprocedure) ~ 'reporting_enrollments'
  and pg_get_functiondef('public.triad_reflection_rate_internal(uuid, date, date)'::regprocedure) ~ 'reporting_enrollments',
  'e10. one predicate: the Sponsor scope, alerts, satisfaction and the Triad reflection rate all read reporting_enrollments()');
select is((select count(*)::int from pg_proc where proname = 'admin_canonical_completion_rate'
            and pg_get_function_identity_arguments(oid) ~ 'uuid\[\]'),
  0, 'e11. no completion rate takes a list of enrollment ids from the browser');

-- ===========================================================================
-- m. Decision 7: Mentoring cancels like Coaching; a no-show counts as held
-- ===========================================================================
-- Trusted SQL: confirmed sessions of U3 with M.
create temporary table ms (name text primary key, id uuid);
grant select on ms to authenticated;
insert into ms values ('in3days', 'c3d40000-0000-4000-8000-000000000001'), ('in5hours', 'c3d40000-0000-4000-8000-000000000002'),
  ('mentor_late', 'c3d40000-0000-4000-8000-000000000003'), ('started', 'c3d40000-0000-4000-8000-000000000004'),
  ('admin_late', 'c3d40000-0000-4000-8000-000000000005');
select set_config('app.session_transition', 'on', true);
insert into public.mentoring_sessions (id, enrollment_id, cohort_requirement_id, mentor_id, mentee_id, topic, start_time, duration_minutes, status)
select v.id::uuid, 'c3d30000-0000-4000-8000-000000000003', d.id,
  'c3d00000-0000-4000-8000-000000000007', 'c3d00000-0000-4000-8000-000000000003', v.name, now() + v.offs, 60, 'confirmed'
from (values ('c3d40000-0000-4000-8000-000000000001', 'in3days', interval '3 days', 1),
             ('c3d40000-0000-4000-8000-000000000002', 'in5hours', interval '5 hours', 2),
             ('c3d40000-0000-4000-8000-000000000003', 'mentor_late', interval '6 hours', 3),
             ('c3d40000-0000-4000-8000-000000000004', 'started', interval '-1 hour', 4)) v(id, name, offs, ordinal)
join public.cohort_requirement_dates d on d.cohort_id = 'c3d20000-0000-4000-8000-000000000002' and d.module = 'mentoring' and d.ordinal = v.ordinal;
select set_config('app.session_transition', '', true);

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'c3d00000-0000-4000-8000-000000000003')::text, true);
select lives_ok($$select public.transition_mentoring_session_status((select id from ms where name = 'in3days'), 'cancelled')$$,
  'm1. the mentee cancels 3 days ahead freely, without a reason');
select throws_ok($$select public.transition_mentoring_session_status((select id from ms where name = 'in5hours'), 'cancelled')$$,
  '23514', 'A reason is required to cancel within 24 hours of the session',
  'm2. inside 24 hours the mentee must give a reason (the Coaching rule)');
select lives_ok($$select public.transition_mentoring_session_status((select id from ms where name = 'in5hours'), 'cancelled', 'Called into a board meeting')$$,
  'm3. ... and with one, the session is cancelled');
reset role;
select results_eq($$select status::text, cancel_reason from public.mentoring_sessions where id in (select id from ms where name in ('in3days', 'in5hours')) order by start_time$$,
  $$values ('cancelled'::text, 'Called into a board meeting'::text), ('cancelled', null)$$,
  'm4. both are cancelled; the late one keeps its reason');
select is((select count(*)::int from public.canonical_mentoring_requirement_fulfilment('c3d30000-0000-4000-8000-000000000003')
            where ordinal in (1, 2) and (booked_on is not null or fulfilled_on is not null)),
  0, 'm5. a cancellation (early or late) frees its unit, as in Coaching');
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'c3d00000-0000-4000-8000-000000000007')::text, true);
select lives_ok($$select public.transition_mentoring_session_status((select id from ms where name = 'mentor_late'), 'cancelled')$$,
  'm6. the Mentor is never blocked, even inside 24 hours without a reason');
select set_config('request.jwt.claims', json_build_object('sub', 'c3d00000-0000-4000-8000-000000000003')::text, true);
select throws_ok($$select public.transition_mentoring_session_status((select id from ms where name = 'started'), 'cancelled', 'I did not make it')$$,
  '42501', null, 'm7. once it has started the mentee cannot cancel: a no-show cannot be undone');
select set_config('request.jwt.claims', json_build_object('sub', 'c3d00000-0000-4000-8000-000000000007')::text, true);
select lives_ok($$select public.transition_mentoring_session_status((select id from ms where name = 'started'), 'completed')$$,
  'm8. the Mentor marks the no-show held');
reset role;
select ok((select fulfilled_on is not null from public.canonical_mentoring_requirement_fulfilment('c3d30000-0000-4000-8000-000000000003') where ordinal = 4),
  'm9. ... and it counts: the no-show fulfils its Mentoring unit');
select set_config('app.session_transition', 'on', true);
insert into public.mentoring_sessions (id, enrollment_id, cohort_requirement_id, mentor_id, mentee_id, topic, start_time, duration_minutes, status)
select 'c3d40000-0000-4000-8000-000000000005', 'c3d30000-0000-4000-8000-000000000003', d.id,
  'c3d00000-0000-4000-8000-000000000007', 'c3d00000-0000-4000-8000-000000000003', 'admin_late', now() - interval '30 minutes', 60, 'confirmed'
from public.cohort_requirement_dates d where d.cohort_id = 'c3d20000-0000-4000-8000-000000000002' and d.module = 'mentoring' and d.ordinal = 1;
select set_config('app.session_transition', '', true);
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'c3d00000-0000-4000-8000-000000000004')::text, true);
select lives_ok($$select public.transition_mentoring_session_status((select id from ms where name = 'admin_late'), 'cancelled')$$,
  'm10. an Admin may still cancel after the start');

-- ===========================================================================
-- f. Decision 9: the Final Assessment in the progress rollups
-- ===========================================================================
reset role;
select results_eq(
  $$select final_assessment_required_units, final_assessment_completed_units,
           coaching_required_units + training_required_units + peer_required_units + mentoring_required_units
             + triad_required_units + final_assessment_required_units = required_units,
           coaching_completed_units + training_completed_units + peer_completed_units + mentoring_completed_units
             + triad_completed_units + final_assessment_completed_units = completed_units
      from public.canonical_enrollment_progress('c3d30000-0000-4000-8000-000000000001')$$,
  $$values (1, 0, true, true)$$,
  'f1. canonical_enrollment_progress carries the Final Assessment, and the modules add up to the total');
-- U1 submits the Final Assessment (trusted fixture: the pipeline's row).
insert into public.assessment_submissions (id, enrollment_id, kind, cohort_requirement_id, attempt_no, status, submitted_at)
select 'c3d60000-0000-4000-8000-000000000001', 'c3d30000-0000-4000-8000-000000000001', 'final_assessment', d.id, 1, 'awaiting_assignment', now()
from public.cohort_requirement_dates d where d.cohort_id = 'c3d20000-0000-4000-8000-000000000001' and d.module = 'final_assessment';
select is((select final_assessment_completed_units from public.canonical_enrollment_progress('c3d30000-0000-4000-8000-000000000001')),
  1, 'f2. ... completed once submitted');

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'c3d00000-0000-4000-8000-000000000005')::text, true);
select results_eq(
  $$select final_assessment_required_units, final_assessment_completed_units, final_assessment_completed_leaders,
           coaching_required_units + training_required_units + peer_required_units + mentoring_required_units
             + triad_required_units + final_assessment_required_units = required_units
      from public.sponsor_canonical_cohort_progress('c3d20000-0000-4000-8000-000000000001')$$,
  $$values (1, 1, 1, true)$$,
  'f3. the Sponsor cohort rollup: a Final Assessment card, and the cards add up to the total');
select results_eq(
  $$select final_assessment_required_units, final_assessment_completed_units,
           coaching_required_units + training_required_units + peer_required_units + mentoring_required_units
             + triad_required_units + final_assessment_required_units = required_units
      from public.sponsor_canonical_organisation_progress()$$,
  $$values (1, 1, true)$$,
  'f4. ... and the organisation rollup');
select is((select final_assessment_required_units from public.sponsor_canonical_leader_progress('c3d30000-0000-4000-8000-000000000001')),
  1, 'f5. ... and the leader detail');
select set_config('request.jwt.claims', json_build_object('sub', 'c3d00000-0000-4000-8000-000000000001')::text, true);
select is((select final_assessment_required_units from public.learner_canonical_progress('c3d30000-0000-4000-8000-000000000001')),
  1, 'f6. the learner reads the same column');
select set_config('request.jwt.claims', json_build_object('sub', 'c3d00000-0000-4000-8000-000000000004')::text, true);
select is((select final_assessment_required_units from public.admin_canonical_enrollment_progress(array['c3d30000-0000-4000-8000-000000000001']::uuid[])),
  1, 'f7. ... and Admin');
reset role;

select * from finish();
rollback;
