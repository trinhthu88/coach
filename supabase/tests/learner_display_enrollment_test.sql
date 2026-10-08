-- What a learner is SHOWN vs what they may DO (20261008210000_learner_display_enrollment;
-- PR #20 review).
--
--   learner_current_enrollment() decides actions (booking, submitting):
--   enrollment_is_ongoing. learner_display_enrollment() decides what the
--   learner's pages show: the current enrollment, else their latest one,
--   flagged read-only (display_state paused / ended / upcoming), so a learner
--   whose programme ended or is paused keeps My Journey and a Final
--   Assessment result released after the end.
--
--   enrollment_status is active | completed | paused | at_risk (no withdrawn
--   value exists), so every enrollment is displayable.
begin;
select plan(13);

-- 01 learner C (current)   02 learner E (ended; Final Assessment released after the end)
-- 03 learner P (paused)    04 learner N (no enrollment)   05 learner U (starts next week)
-- 06 learner K (only a completed enrollment)   07 assessor A   08 Admin
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_user_meta_data, created_at, updated_at, confirmation_token, email_change_token_new, recovery_token)
select ('d15a0000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid,
  '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated',
  'display-' || n || '@example.test', 'test', now(),
  jsonb_build_object('full_name', 'Display Person ' || n), now(), now(), '', '', ''
from generate_series(1, 8) n;
insert into public.user_roles (user_id, role)
select ('d15a0000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid,
  (case n when 7 then 'coach' when 8 then 'admin' else 'coachee' end)::public.app_role
from generate_series(1, 8) n
on conflict do nothing;
update public.profiles set status = 'active'::public.user_status where id::text like 'd15a0000-%';
insert into public.organizations (id, name) values ('d15a5000-0000-4000-8000-000000000001', 'Display Org');

insert into public.programmes (id, name) values
  ('d15a1000-0000-4000-8000-000000000001', 'Display Programme'),
  ('d15a1000-0000-4000-8000-000000000002', 'Display Earlier Programme');
insert into public.programme_modules (programme_id, module, enabled, config) values
  ('d15a1000-0000-4000-8000-000000000001', 'final_assessment', true, '{"required": true, "transcript": "none"}');
insert into public.cohorts (id, name, programme_id, start_date, end_date) values
  ('d15a2000-0000-4000-8000-000000000001', 'Display Cohort', 'd15a1000-0000-4000-8000-000000000001',
   public.programme_today() - 60, public.programme_today() + 30);
insert into public.programme_enrollments (id, programme_id, user_id, cohort_id, organization_id, status, start_date, end_date)
select ('d15a3000-0000-4000-8000-0000000000' || lpad(v.n::text, 2, '0'))::uuid, v.programme_id::uuid,
  ('d15a0000-0000-4000-8000-0000000000' || lpad(v.u::text, 2, '0'))::uuid, v.cohort_id::uuid,
  'd15a5000-0000-4000-8000-000000000001', v.status::public.enrollment_status, public.programme_today() + v.s, public.programme_today() + v.e
from (values
  (1, 1, 'd15a1000-0000-4000-8000-000000000001', 'd15a2000-0000-4000-8000-000000000001', 'active', -60, 30),
  (2, 2, 'd15a1000-0000-4000-8000-000000000001', 'd15a2000-0000-4000-8000-000000000001', 'active', -60, 30),
  (12, 2, 'd15a1000-0000-4000-8000-000000000002', null, 'completed', -400, -200),
  (3, 3, 'd15a1000-0000-4000-8000-000000000001', 'd15a2000-0000-4000-8000-000000000001', 'paused', -60, 30),
  (5, 5, 'd15a1000-0000-4000-8000-000000000002', null, 'active', 7, 90),
  (6, 6, 'd15a1000-0000-4000-8000-000000000002', null, 'completed', -300, -100)
) v(n, u, programme_id, cohort_id, status, s, e);

-- E submits the Final Assessment while ongoing; it is reviewed and released.
insert into storage.objects (bucket_id, name, owner_id, metadata) values
  ('assessment-files', 'd15a3000-0000-4000-8000-000000000002/d15a4000-0000-4000-8000-000000000001/recording.mp3',
   'd15a0000-0000-4000-8000-000000000002', '{"mimetype": "audio/mpeg", "size": 3000000}');
create temporary table fa_req as select d.id from public.cohort_requirement_dates d
 where d.cohort_id = 'd15a2000-0000-4000-8000-000000000001' and d.module = 'final_assessment';
grant select on fa_req to authenticated;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'd15a0000-0000-4000-8000-000000000002')::text, true);
select public.learner_submit_assessment('d15a4000-0000-4000-8000-000000000001', 'd15a3000-0000-4000-8000-000000000002',
  (select id from fa_req),
  'final_assessment', null, null, null, 'none',
  '[{"storage_path": "d15a3000-0000-4000-8000-000000000002/d15a4000-0000-4000-8000-000000000001/recording.mp3", "file_kind": "recording"}]');
select set_config('request.jwt.claims', json_build_object('sub', 'd15a0000-0000-4000-8000-000000000008')::text, true);
select public.admin_set_cohort_assessor('d15a2000-0000-4000-8000-000000000001', 'd15a0000-0000-4000-8000-000000000007');
select public.admin_assign_assessor(array['d15a4000-0000-4000-8000-000000000001']::uuid[], 'd15a0000-0000-4000-8000-000000000007');
select set_config('request.jwt.claims', json_build_object('sub', 'd15a0000-0000-4000-8000-000000000007')::text, true);
select public.coach_submit_review('d15a4000-0000-4000-8000-000000000001', 'A clear, well-contracted session.', 'pass');
-- E's programme ends (yesterday) before Admin releases the result.
reset role;
update public.programme_enrollments set end_date = public.programme_today() - 1 where id = 'd15a3000-0000-4000-8000-000000000002';
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'd15a0000-0000-4000-8000-000000000008')::text, true);
select public.admin_validate_review((select review_id from public.admin_assessment_queue()
  where submission_id = 'd15a4000-0000-4000-8000-000000000001'), 'approved');

-- ===========================================================================
-- 1. What each learner's pages show
-- ===========================================================================
create or replace function pg_temp.display_as(p_user text)
returns table(enrollment_id uuid, is_current boolean, display_state text) language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user)::text, true);
  return query select * from public.learner_display_enrollment();
end $$;
grant execute on function pg_temp.display_as(text) to authenticated;

select results_eq($$select * from pg_temp.display_as('d15a0000-0000-4000-8000-000000000001')$$,
  $$values ('d15a3000-0000-4000-8000-000000000001'::uuid, true, 'current'::text)$$,
  '1a. an ongoing learner is shown their current enrollment');
select results_eq($$select * from pg_temp.display_as('d15a0000-0000-4000-8000-000000000002')$$,
  $$values ('d15a3000-0000-4000-8000-000000000002'::uuid, false, 'ended'::text)$$,
  '1b. a learner past their end date (still active) is shown their latest enrollment, read-only, as ended');
select results_eq($$select * from pg_temp.display_as('d15a0000-0000-4000-8000-000000000003')$$,
  $$values ('d15a3000-0000-4000-8000-000000000003'::uuid, false, 'paused'::text)$$,
  '1c. a paused learner is shown their enrollment, read-only, as paused');
select is_empty($$select * from pg_temp.display_as('d15a0000-0000-4000-8000-000000000004')$$,
  '1d. a learner with no enrollment is shown none');
select results_eq($$select * from pg_temp.display_as('d15a0000-0000-4000-8000-000000000005')$$,
  $$values ('d15a3000-0000-4000-8000-000000000005'::uuid, false, 'upcoming'::text)$$,
  '1e. an enrollment that has not started yet is upcoming, never "ended"');
select results_eq($$select * from pg_temp.display_as('d15a0000-0000-4000-8000-000000000006')$$,
  $$values ('d15a3000-0000-4000-8000-000000000006'::uuid, false, 'ended'::text)$$,
  '1f. a learner whose only enrollment is completed is shown it as ended');

-- ===========================================================================
-- 2. Showing is not acting
-- ===========================================================================
select set_config('request.jwt.claims', json_build_object('sub', 'd15a0000-0000-4000-8000-000000000002')::text, true);
select is_empty($$select * from public.learner_current_enrollment()$$,
  '2a. the ended learner still has no CURRENT enrollment: booking and submitting stay refused');
select is((select count(*)::int from public.learner_display_enrollment() where enrollment_id::text like 'd15a3000-0000-4000-8000-00000000000_'
            and enrollment_id <> 'd15a3000-0000-4000-8000-000000000002'), 0,
  '2b. a learner is only ever shown their own enrollment');
reset role;
select ok(not has_function_privilege('anon', 'public.learner_display_enrollment()', 'EXECUTE')
          and has_function_privilege('authenticated', 'public.learner_display_enrollment()', 'EXECUTE'),
  '2c. learner_display_enrollment is for signed-in users only');
set local role authenticated;
select set_config('request.jwt.claims', '{}', true);
select throws_ok($$select * from public.learner_display_enrollment()$$, '42501', null, '2d. it requires a signed-in user');

-- ===========================================================================
-- 3. A result released after the end stays readable
-- ===========================================================================
select set_config('request.jwt.claims', json_build_object('sub', 'd15a0000-0000-4000-8000-000000000002')::text, true);
select results_eq($$select state, final_result from public.learner_final_assessment('d15a3000-0000-4000-8000-000000000002')$$,
  $$values ('completed'::text, 'pass'::text)$$,
  '3a. after the programme ended, the learner still reads their released Final Assessment result');
select results_eq($$select kind, outcome, feedback_text, assessor_name from public.learner_assessment_feedback('d15a3000-0000-4000-8000-000000000002')$$,
  $$values ('final_assessment'::text, 'pass'::text, 'A clear, well-contracted session.'::text, 'Display Person 7'::text)$$,
  '3b. ... and the released feedback, with the assessor''s name');
select set_config('request.jwt.claims', json_build_object('sub', 'd15a0000-0000-4000-8000-000000000001')::text, true);
select is_empty($$select * from public.learner_assessment_feedback('d15a3000-0000-4000-8000-000000000002')$$,
  '3c. another learner reads none of it');

select * from finish();
rollback;
