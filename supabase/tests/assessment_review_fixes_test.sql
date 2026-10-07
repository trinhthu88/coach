-- Assessment fixes (20261007000600_assessment_review_fixes; Prompt 11:
-- B1-B4, decisions 4, 5, 6, 10).
begin;
select plan(33);

-- 01 learner L   02 assessor A   03 Admin   04 Sponsor S   05 coach C (cohort coach, group cohort)
-- 06 N (Coach and learner, in the pool)   07 learner P (ended cohort, released)
-- 08 learner Q   09 assessor B   10 learner R (ended cohort, under review)
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_user_meta_data, created_at, updated_at, confirmation_token, email_change_token_new, recovery_token)
select ('f1000000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid,
  '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated',
  'afix-' || n || '@example.test', 'test', now(),
  jsonb_build_object('full_name', 'AFix Person ' || n), now(), now(), '', '', ''
from generate_series(1, 10) n;
insert into public.user_roles (user_id, role) values
  ('f1000000-0000-4000-8000-000000000001', 'coachee'), ('f1000000-0000-4000-8000-000000000002', 'coach'),
  ('f1000000-0000-4000-8000-000000000003', 'admin'), ('f1000000-0000-4000-8000-000000000004', 'sponsor'),
  ('f1000000-0000-4000-8000-000000000005', 'coach'), ('f1000000-0000-4000-8000-000000000006', 'coach'),
  ('f1000000-0000-4000-8000-000000000006', 'coachee'), ('f1000000-0000-4000-8000-000000000007', 'coachee'),
  ('f1000000-0000-4000-8000-000000000008', 'coachee'), ('f1000000-0000-4000-8000-000000000009', 'coach'),
  ('f1000000-0000-4000-8000-000000000010', 'coachee')
on conflict do nothing;
update public.profiles set status = 'active'::public.user_status where id::text like 'f1000000-%';
insert into public.organizations (id, name) values ('f1500000-0000-4000-8000-000000000001', 'Fix Org');
insert into public.sponsor_profiles (user_id, organization_id) values ('f1000000-0000-4000-8000-000000000004', 'f1500000-0000-4000-8000-000000000001');

-- Programme 1 (ongoing cohort): a Final Assessment with a quiz, an assessed
-- Triad 1, and one Training week with its own quiz.
insert into public.programmes (id, name) values ('f1100000-0000-4000-8000-000000000001', 'Fix Programme');
insert into public.programme_modules (programme_id, module, enabled, config) values
  ('f1100000-0000-4000-8000-000000000001', 'final_assessment', true,
   '{"required": true, "quiz_enabled": true, "pass_mark_pct": 50, "transcript": "optional"}'),
  ('f1100000-0000-4000-8000-000000000001', 'triads', true, '{"required": true, "required_units": 1, "assessed_units": [1]}');
insert into public.cohorts (id, name, programme_id, start_date, end_date) values
  ('f1200000-0000-4000-8000-000000000001', 'Fix Cohort', 'f1100000-0000-4000-8000-000000000001',
   public.programme_today() - 30, public.programme_today() + 60);
insert into public.programme_enrollments (id, programme_id, user_id, cohort_id, organization_id, status, start_date, end_date)
select ('f1300000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid, 'f1100000-0000-4000-8000-000000000001',
  ('f1000000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid, 'f1200000-0000-4000-8000-000000000001',
  'f1500000-0000-4000-8000-000000000001', 'active', public.programme_today() - 30, public.programme_today() + 60
from unnest(array[1, 6, 8]) n;
-- C is a cohort coach of this (group, not engagement) cohort.
insert into public.cohort_coach_assignments (cohort_id, coach_id)
values ('f1200000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000005');

insert into public.assignments (id, final_assessment_programme_id, assignment_type, title, is_visible)
values ('f1600000-0000-4000-8000-000000000001', 'f1100000-0000-4000-8000-000000000001', 'quiz', 'Final quiz', true);
insert into public.quiz_questions (id, assignment_id, question_text, options, sort_order) values
  ('f1600000-0000-4000-8000-000000000011', 'f1600000-0000-4000-8000-000000000001', 'Q1',
   '[{"id": "a", "text": "Right", "is_correct": true}, {"id": "b", "text": "Wrong", "is_correct": false}]', 1);
insert into public.training_weeks (id, programme_id, week_number, title)
values ('f1700000-0000-4000-8000-000000000001', 'f1100000-0000-4000-8000-000000000001', 1, 'Week 1');
insert into public.assignments (id, training_week_id, assignment_type, title, is_visible)
values ('f1600000-0000-4000-8000-000000000002', 'f1700000-0000-4000-8000-000000000001', 'quiz', 'Week 1 quiz', true);
-- L's Week 1 quiz (trusted fixture: the Training evidence row).
insert into public.assignment_submissions (id, assignment_id, user_id, enrollment_id, answers)
values ('f1600000-0000-4000-8000-000000000021', 'f1600000-0000-4000-8000-000000000002',
        'f1000000-0000-4000-8000-000000000001', 'f1300000-0000-4000-8000-000000000001', '{}');

-- Triad 1: a completed session, L and Q grouped.
insert into public.triad_groups (id, cohort_requirement_date_id, is_active)
select 'f1800000-0000-4000-8000-000000000001', d.id, true from public.cohort_requirement_dates d
 where d.cohort_id = 'f1200000-0000-4000-8000-000000000001' and d.module = 'triads';
insert into public.triad_group_members (triad_group_id, enrollment_id, member_order) values
  ('f1800000-0000-4000-8000-000000000001', 'f1300000-0000-4000-8000-000000000001', 1),
  ('f1800000-0000-4000-8000-000000000001', 'f1300000-0000-4000-8000-000000000008', 2);
insert into public.triad_sessions (id, triad_group_id, scheduled_start_time, status)
values ('f1800000-0000-4000-8000-000000000002', 'f1800000-0000-4000-8000-000000000001', now() - interval '1 day', 'completed');

create temporary table ids (name text primary key, id uuid);
insert into ids select 'req', d.id from public.cohort_requirement_dates d
 where d.cohort_id = 'f1200000-0000-4000-8000-000000000001' and d.module = 'final_assessment';
insert into ids select 'triad1', d.id from public.cohort_requirement_dates d
 where d.cohort_id = 'f1200000-0000-4000-8000-000000000001' and d.module = 'triads';
grant all on ids to authenticated;

-- MP3 uploads: L attempts 1 and 2, Q attempts 1 and 2 (storage rows as the API writes them).
insert into storage.objects (bucket_id, name, owner_id, metadata)
select 'assessment-files', e || '/' || s || '/recording.mp3', u, '{"mimetype": "audio/mpeg", "size": 1000}'
from (values
  ('f1300000-0000-4000-8000-000000000001', 'f1400000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001'),
  ('f1300000-0000-4000-8000-000000000001', 'f1400000-0000-4000-8000-000000000002', 'f1000000-0000-4000-8000-000000000001'),
  ('f1300000-0000-4000-8000-000000000008', 'f1400000-0000-4000-8000-000000000008', 'f1000000-0000-4000-8000-000000000008'),
  ('f1300000-0000-4000-8000-000000000008', 'f1400000-0000-4000-8000-000000000009', 'f1000000-0000-4000-8000-000000000008')) v(e, s, u);

-- Assessor pool: A, B, C and N.
select set_config('request.jwt.claims', json_build_object('sub', 'f1000000-0000-4000-8000-000000000003')::text, true);
select public.admin_set_cohort_assessor('f1200000-0000-4000-8000-000000000001', c)
from unnest(array['f1000000-0000-4000-8000-000000000002', 'f1000000-0000-4000-8000-000000000009',
                  'f1000000-0000-4000-8000-000000000005', 'f1000000-0000-4000-8000-000000000006']::uuid[]) c;

-- ===========================================================================
-- (5) A Triad submission is made only by submitting the Triad reflection
-- ===========================================================================
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'f1000000-0000-4000-8000-000000000001')::text, true);
select lives_ok($$select public.learner_triad_submit_reflection('f1800000-0000-4000-8000-000000000002', 4::smallint)$$,
  '5a. L submits the assessed Triad 1 reflection');
reset role;
select is((select count(*)::int from public.assessment_submissions
            where enrollment_id = 'f1300000-0000-4000-8000-000000000001' and kind = 'triad'),
  1, '5b. ... which creates the Triad submission');
insert into ids select 'refl', r.id from public.triad_reflections r
 where r.triad_session_id = 'f1800000-0000-4000-8000-000000000002' and r.enrollment_id = 'f1300000-0000-4000-8000-000000000001';
set local role authenticated;
select throws_ok($$select public.learner_submit_assessment(gen_random_uuid(), 'f1300000-0000-4000-8000-000000000001',
  (select id from ids where name = 'triad1'), 'triad', (select id from ids where name = 'refl'))$$,
  '22023', 'A Triad is submitted with its reflection, not here',
  '5c. learner_submit_assessment(kind = triad) is refused, even with the learner''s own reflection');
-- Q's reflection written any other way: the same refusal, no submission.
select set_config('request.jwt.claims', json_build_object('sub', 'f1000000-0000-4000-8000-000000000008')::text, true);
reset role;
insert into public.triad_reflections (id, triad_session_id, enrollment_id, satisfaction_rating)
values ('f1800000-0000-4000-8000-000000000003', 'f1800000-0000-4000-8000-000000000002', 'f1300000-0000-4000-8000-000000000008', 5);
set local role authenticated;
select throws_ok($$select public.learner_submit_assessment(gen_random_uuid(), 'f1300000-0000-4000-8000-000000000008',
  (select id from ids where name = 'triad1'), 'triad', 'f1800000-0000-4000-8000-000000000003')$$,
  '22023', 'A Triad is submitted with its reflection, not here',
  '5d. ... for a reflection inserted any other way too');
reset role;
select is((select count(*)::int from public.assessment_submissions
            where enrollment_id = 'f1300000-0000-4000-8000-000000000008' and kind = 'triad'),
  0, '5e. ... so it never becomes a Triad submission');

-- ===========================================================================
-- (4) The Final Assessment quiz row is not readable from the table
-- ===========================================================================
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'f1000000-0000-4000-8000-000000000001')::text, true);
select public.learner_submit_final_assessment_quiz('f1300000-0000-4000-8000-000000000001', '{"f1600000-0000-4000-8000-000000000011": "b"}');
select results_eq($$select id from public.assignment_submissions where user_id = 'f1000000-0000-4000-8000-000000000001'$$,
  $$values ('f1600000-0000-4000-8000-000000000021'::uuid)$$,
  '4a. "Submissions: user read own" returns L''s Training quiz, not the Final Assessment quiz');
select is((select count(*)::int from public.assignment_submissions where assignment_id = 'f1600000-0000-4000-8000-000000000001'),
  0, '4b. ... not even when asked for by the final quiz''s id (its score stays hidden until release)');
select is((select quiz_taken from public.learner_final_assessment('f1300000-0000-4000-8000-000000000001')),
  true, '4c. the Final Assessment page still knows the quiz was taken');

-- ===========================================================================
-- (2) A Final Assessment review needs a result
-- ===========================================================================
select lives_ok($$select public.learner_submit_assessment('f1400000-0000-4000-8000-000000000001', 'f1300000-0000-4000-8000-000000000001',
  (select id from ids where name = 'req'), 'final_assessment', null,
  (select quiz_submission_id from public.learner_final_assessment('f1300000-0000-4000-8000-000000000001')), null, 'none',
  '[{"storage_path": "f1300000-0000-4000-8000-000000000001/f1400000-0000-4000-8000-000000000001/recording.mp3", "file_kind": "recording"}]')$$,
  '2a. L submits attempt 1');

-- ===========================================================================
-- (7) Never the learner's own coach, nor the learner themself
-- ===========================================================================
reset role;
select ok(public.assessment_is_learners_coach_internal('f1300000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000005'),
  '7a. a cohort_coach_assignments coach of a group cohort is the learner''s coach');
select ok(public.assessment_is_learners_coach_internal('f1300000-0000-4000-8000-000000000006', 'f1000000-0000-4000-8000-000000000006'),
  '7b. a learner is never their own assessor');
select ok(not public.assessment_is_learners_coach_internal('f1300000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000002'),
  '7c. an unrelated pool Coach is not');
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'f1000000-0000-4000-8000-000000000003')::text, true);
select throws_ok($$select public.admin_assign_assessor(array['f1400000-0000-4000-8000-000000000001']::uuid[], 'f1000000-0000-4000-8000-000000000005')$$,
  '42501', null, '7d. Admin cannot assign L''s cohort coach C, though C is in the pool');
select is(public.admin_assign_assessor(array['f1400000-0000-4000-8000-000000000001']::uuid[], 'f1000000-0000-4000-8000-000000000002'),
  1, '7e. Admin assigns A');

-- (2) continued
select set_config('request.jwt.claims', json_build_object('sub', 'f1000000-0000-4000-8000-000000000002')::text, true);
select throws_ok($$select public.coach_submit_review('f1400000-0000-4000-8000-000000000001', 'Good session.', null)$$,
  '22023', 'A Final Assessment review needs a result: Pass, Not pass or Resubmit',
  '2b. a Final Assessment review with no result (NULL) is refused');
select throws_ok($$select public.coach_submit_review('f1400000-0000-4000-8000-000000000001', 'Good session.', 'maybe')$$,
  '22023', 'A Final Assessment review needs a result: Pass, Not pass or Resubmit',
  '2c. ... and one with an unknown result');
reset role;
select is((select status from public.assessment_submissions where id = 'f1400000-0000-4000-8000-000000000001'),
  'with_assessor', '2d. nothing moved: the submission still waits for A''s review');

-- ===========================================================================
-- (3) An unregistered object is readable only by its uploader
-- ===========================================================================
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'f1000000-0000-4000-8000-000000000002')::text, true);
insert into storage.objects (bucket_id, name, owner_id, metadata) values
  ('assessment-files', 'f1300000-0000-4000-8000-000000000001/f1400000-0000-4000-8000-000000000001/draft-feedback.pdf',
   'f1000000-0000-4000-8000-000000000002', '{"mimetype": "application/pdf", "size": 1000}');
select is(public.assessment_object_readable('f1300000-0000-4000-8000-000000000001/f1400000-0000-4000-8000-000000000001/draft-feedback.pdf'),
  true, '3a. A reads back the PDF A uploaded and has not yet submitted');
select set_config('request.jwt.claims', json_build_object('sub', 'f1000000-0000-4000-8000-000000000001')::text, true);
select is(public.assessment_object_readable('f1300000-0000-4000-8000-000000000001/f1400000-0000-4000-8000-000000000001/draft-feedback.pdf'),
  false, '3b. the learner cannot read the assessor''s unregistered PDF under their own enrollment');
select is((select count(*)::int from storage.objects
            where bucket_id = 'assessment-files' and name like 'f1300000-0000-4000-8000-000000000001/%/draft-feedback.pdf'),
  0, '3c. ... nor list it');
reset role;
insert into storage.objects (bucket_id, name, owner_id, metadata) values
  ('assessment-files', 'f1300000-0000-4000-8000-000000000001/f1400000-0000-4000-8000-000000000003/recording.mp3',
   'f1000000-0000-4000-8000-000000000001', '{"mimetype": "audio/mpeg", "size": 1000}');
set local role authenticated;
select is(public.assessment_object_readable('f1300000-0000-4000-8000-000000000001/f1400000-0000-4000-8000-000000000003/recording.mp3'),
  true, '3d. the learner still reads back their own upload before submitting');
select set_config('request.jwt.claims', json_build_object('sub', 'f1000000-0000-4000-8000-000000000002')::text, true);
select is(public.assessment_object_readable('f1300000-0000-4000-8000-000000000001/f1400000-0000-4000-8000-000000000003/recording.mp3'),
  false, '3e. ... and nobody else does');

-- ===========================================================================
-- (6) Attempt 2 after Resubmit goes back to attempt 1's assessor
-- ===========================================================================
select public.coach_submit_review('f1400000-0000-4000-8000-000000000001', 'Please record a full session.', 'resubmit');
select set_config('request.jwt.claims', json_build_object('sub', 'f1000000-0000-4000-8000-000000000003')::text, true);
select public.admin_validate_review((select review_id from public.admin_assessment_queue()
  where submission_id = 'f1400000-0000-4000-8000-000000000001'), 'approved');
select set_config('request.jwt.claims', json_build_object('sub', 'f1000000-0000-4000-8000-000000000001')::text, true);
select public.learner_submit_final_assessment_quiz('f1300000-0000-4000-8000-000000000001', '{"f1600000-0000-4000-8000-000000000011": "a"}');
select lives_ok($$select public.learner_submit_assessment('f1400000-0000-4000-8000-000000000002', 'f1300000-0000-4000-8000-000000000001',
  (select id from ids where name = 'req'), 'final_assessment', null,
  (select quiz_submission_id from public.learner_final_assessment('f1300000-0000-4000-8000-000000000001')), null, 'none',
  '[{"storage_path": "f1300000-0000-4000-8000-000000000001/f1400000-0000-4000-8000-000000000002/recording.mp3", "file_kind": "recording"}]')$$,
  '6a. L submits attempt 2');
reset role;
select results_eq(
  $$select s.status, a.assessor_id, a.assigned_by, a.due_on
      from public.assessment_submissions s
      join public.assessment_assignments a on a.submission_id = s.id and a.ended_at is null
     where s.id = 'f1400000-0000-4000-8000-000000000002'$$,
  $$values ('with_assessor'::text, 'f1000000-0000-4000-8000-000000000002'::uuid,
            'f1000000-0000-4000-8000-000000000003'::uuid, public.programme_today() + 7)$$,
  '6b. attempt 2 is assigned to A automatically (on attempt 1''s Admin), due 7 days later');
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'f1000000-0000-4000-8000-000000000002')::text, true);
select results_eq($$select inbox_tab, attempt_no from public.coach_assessment_inbox() where submission_id = 'f1400000-0000-4000-8000-000000000002'$$,
  $$values ('to_assess'::text, 2)$$, '6c. ... and is in A''s inbox to assess');

-- Q: attempt 1 assessed by B, who then leaves the pool.
select set_config('request.jwt.claims', json_build_object('sub', 'f1000000-0000-4000-8000-000000000008')::text, true);
select public.learner_submit_final_assessment_quiz('f1300000-0000-4000-8000-000000000008', '{"f1600000-0000-4000-8000-000000000011": "a"}');
select public.learner_submit_assessment('f1400000-0000-4000-8000-000000000008', 'f1300000-0000-4000-8000-000000000008',
  (select id from ids where name = 'req'), 'final_assessment', null,
  (select quiz_submission_id from public.learner_final_assessment('f1300000-0000-4000-8000-000000000008')), null, 'none',
  '[{"storage_path": "f1300000-0000-4000-8000-000000000008/f1400000-0000-4000-8000-000000000008/recording.mp3", "file_kind": "recording"}]');
select set_config('request.jwt.claims', json_build_object('sub', 'f1000000-0000-4000-8000-000000000003')::text, true);
select public.admin_assign_assessor(array['f1400000-0000-4000-8000-000000000008']::uuid[], 'f1000000-0000-4000-8000-000000000009');
select set_config('request.jwt.claims', json_build_object('sub', 'f1000000-0000-4000-8000-000000000009')::text, true);
select public.coach_submit_review('f1400000-0000-4000-8000-000000000008', 'Record the whole session.', 'resubmit');
select set_config('request.jwt.claims', json_build_object('sub', 'f1000000-0000-4000-8000-000000000003')::text, true);
select public.admin_validate_review((select review_id from public.admin_assessment_queue()
  where submission_id = 'f1400000-0000-4000-8000-000000000008'), 'approved');
select public.admin_set_cohort_assessor('f1200000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000009', false);
select set_config('request.jwt.claims', json_build_object('sub', 'f1000000-0000-4000-8000-000000000008')::text, true);
select public.learner_submit_final_assessment_quiz('f1300000-0000-4000-8000-000000000008', '{"f1600000-0000-4000-8000-000000000011": "a"}');
select public.learner_submit_assessment('f1400000-0000-4000-8000-000000000009', 'f1300000-0000-4000-8000-000000000008',
  (select id from ids where name = 'req'), 'final_assessment', null,
  (select quiz_submission_id from public.learner_final_assessment('f1300000-0000-4000-8000-000000000008')), null, 'none',
  '[{"storage_path": "f1300000-0000-4000-8000-000000000008/f1400000-0000-4000-8000-000000000009/recording.mp3", "file_kind": "recording"}]');
reset role;
select results_eq(
  $$select s.status, (select count(*)::int from public.assessment_assignments a where a.submission_id = s.id)
      from public.assessment_submissions s where s.id = 'f1400000-0000-4000-8000-000000000009'$$,
  $$values ('awaiting_assignment'::text, 0)$$,
  '6d. attempt 1''s assessor has left the pool: attempt 2 waits for Admin');

-- ===========================================================================
-- (1) Fulfilled on the Vietnam date of the latest attempt's submission
-- ===========================================================================
-- Programme 2, an ended cohort: due 30 days ago, ended 10 days ago.
insert into public.programmes (id, name) values ('f1100000-0000-4000-8000-000000000002', 'Fix Ended Programme');
insert into public.programme_modules (programme_id, module, enabled, config) values
  ('f1100000-0000-4000-8000-000000000002', 'final_assessment', true, '{"required": true, "transcript": "optional"}');
insert into public.cohorts (id, name, programme_id, start_date, end_date) values
  ('f1200000-0000-4000-8000-000000000002', 'Fix Ended Cohort', 'f1100000-0000-4000-8000-000000000002',
   public.programme_today() - 120, public.programme_today() - 10);
update public.cohort_requirement_dates set due_on = public.programme_today() - 30, is_overridden = true,
  generation_method = 'manual', materialized_via = 'admin_save'
 where cohort_id = 'f1200000-0000-4000-8000-000000000002';
insert into public.programme_enrollments (id, programme_id, user_id, cohort_id, organization_id, status, start_date, end_date)
select ('f1300000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid, 'f1100000-0000-4000-8000-000000000002',
  ('f1000000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid, 'f1200000-0000-4000-8000-000000000002',
  'f1500000-0000-4000-8000-000000000001', 'active', public.programme_today() - 120, public.programme_today() - 10
from unnest(array[7, 10]) n;
insert into ids select 'req2', d.id from public.cohort_requirement_dates d
 where d.cohort_id = 'f1200000-0000-4000-8000-000000000002' and d.module = 'final_assessment';

-- P submitted 2 days before the due date, late in the Vietnam evening (16:30
-- UTC is 23:30 in Ho Chi Minh City); the Pass was released 3 weeks after the
-- due date, after the programme ended. R submitted the same day; still under review.
-- (Trusted fixtures: the rows the pipeline writes, at past server times.)
insert into public.assessment_submissions (id, enrollment_id, kind, cohort_requirement_id, attempt_no, status, submitted_at, released_at)
values
  ('f1400000-0000-4000-8000-000000000007', 'f1300000-0000-4000-8000-000000000007', 'final_assessment',
   (select id from ids where name = 'req2'), 1, 'released',
   ((public.programme_today() - 32)::timestamp + interval '23 hours 30 minutes') at time zone public.programme_time_zone(),
   ((public.programme_today() - 9)::timestamp + interval '10 hours') at time zone public.programme_time_zone()),
  ('f1400000-0000-4000-8000-000000000010', 'f1300000-0000-4000-8000-000000000010', 'final_assessment',
   (select id from ids where name = 'req2'), 1, 'with_assessor',
   ((public.programme_today() - 32)::timestamp + interval '23 hours 30 minutes') at time zone public.programme_time_zone(), null);
insert into public.assessment_reviews (id, submission_id, assessor_id, version, feedback_text, outcome)
values ('f1900000-0000-4000-8000-000000000001', 'f1400000-0000-4000-8000-000000000007', 'f1000000-0000-4000-8000-000000000002', 1, 'Clear.', 'pass');
insert into public.assessment_validations (review_id, admin_id, decision)
values ('f1900000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000003', 'approved');

select results_eq($$select fulfilled_on, final_result from public.canonical_final_assessment_fulfilment('f1300000-0000-4000-8000-000000000007')$$,
  $$values (public.programme_today() - 32, 'pass'::text)$$,
  '1a. fulfilled on the Vietnam date it was submitted, not the date it was released; the result stays Pass');
select results_eq($$select state, completed_on from public.canonical_enrollment_requirement_status('f1300000-0000-4000-8000-000000000007')
                     where module = 'final_assessment'$$,
  $$values ('completed'::text, public.programme_today() - 32)$$,
  '1b. completed on time, not completed late or overdue');
select results_eq($$select fulfilled_on, final_result from public.canonical_final_assessment_fulfilment('f1300000-0000-4000-8000-000000000010')$$,
  $$values (public.programme_today() - 32, null::text)$$,
  '1c. under review: fulfilled on its submission date all the same, with no result yet');
select results_eq($$select state, final_result from public.canonical_final_assessment_result('f1300000-0000-4000-8000-000000000010')$$,
  $$values ('under_review'::text, null::text)$$,
  '1d. ... the result stays in canonical_final_assessment_result');

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'f1000000-0000-4000-8000-000000000007')::text, true);
select results_eq($$select completed_units, overdue_units, pace_status from public.learner_module_progress('f1300000-0000-4000-8000-000000000007')
                     where module = 'final_assessment'$$,
  $$values (1, 0, 'completed'::text)$$, '1e. the learner''s progress counts it completed, not overdue');
select set_config('request.jwt.claims', json_build_object('sub', 'f1000000-0000-4000-8000-000000000003')::text, true);
select results_eq($$select completed_units, overdue_units, pace_status from public.admin_enrollment_module_progress('f1300000-0000-4000-8000-000000000007')
                     where module = 'final_assessment'$$,
  $$values (1, 0, 'completed'::text)$$, '1f. ... so does Admin''s');
select set_config('request.jwt.claims', json_build_object('sub', 'f1000000-0000-4000-8000-000000000004')::text, true);
select results_eq($$select enrollment_id, required_units, completed_units, overdue_units
                      from public.sponsor_canonical_enrollment_progress('f1200000-0000-4000-8000-000000000002') order by enrollment_id$$,
  $$values ('f1300000-0000-4000-8000-000000000007'::uuid, 1, 1, 0), ('f1300000-0000-4000-8000-000000000010'::uuid, 1, 1, 0)$$,
  '1g. ... and the Sponsor''s, for the released and the under-review leader alike');
reset role;

select * from finish();
rollback;
