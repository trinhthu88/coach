-- Final Assessment module (20261007000000 + 20261007000100; Prompt A5).
begin;
select plan(36);

-- 01 learner L   02 assessor A   03 Admin   04 Sponsor S
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_user_meta_data, created_at, updated_at, confirmation_token, email_change_token_new, recovery_token)
select ('af000000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid,
  '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated',
  'afinal-' || n || '@example.test', 'test', now(),
  jsonb_build_object('full_name', 'AFinal Person ' || n), now(), now(), '', '', ''
from generate_series(1, 4) n;
insert into public.user_roles (user_id, role) values
  ('af000000-0000-4000-8000-000000000001', 'coachee'), ('af000000-0000-4000-8000-000000000002', 'coach'),
  ('af000000-0000-4000-8000-000000000003', 'admin'), ('af000000-0000-4000-8000-000000000004', 'sponsor')
on conflict do nothing;
update public.profiles set status = 'active'::public.user_status where id::text like 'af000000-%';
insert into public.organizations (id, name) values ('af500000-0000-4000-8000-000000000001', 'Final Org');
insert into public.sponsor_profiles (user_id, organization_id) values ('af000000-0000-4000-8000-000000000004', 'af500000-0000-4000-8000-000000000001');

insert into public.programmes (id, name) values ('af100000-0000-4000-8000-000000000001', 'Final Programme');
-- Asks for 5 units and a video type: the database normalises both.
insert into public.programme_modules (programme_id, module, enabled, config) values
  ('af100000-0000-4000-8000-000000000001', 'final_assessment', true,
   '{"required": true, "required_units": 5, "quiz_enabled": true, "pass_mark_pct": 70, "accepted_mime": ["video/mp4"], "max_file_mb": 500, "transcript": "required"}');

-- ===========================================================================
-- Config
-- ===========================================================================
select results_eq(
  $$select (config->>'required_units')::int, config->'accepted_mime', (config->>'max_file_mb')::int, (config->>'pass_mark_pct')::numeric
      from public.programme_modules where programme_id = 'af100000-0000-4000-8000-000000000001' and module = 'final_assessment'$$,
  $$values (1, '["audio/mpeg"]'::jsonb, 50, 70::numeric)$$,
  '1. one requirement, MP3 only, 50 MB: the config is normalised whatever was sent');
select throws_ok($$update public.programme_modules set config = config || '{"transcript": "sometimes"}'
  where programme_id = 'af100000-0000-4000-8000-000000000001' and module = 'final_assessment'$$,
  '22023', null, '2. the transcript setting is none, optional or required');
select ok('final_assessment' = any(enum_range(null::public.programme_module_type)::text[])
  and 'assessment' = any(enum_range(null::public.programme_module_type)::text[]),
  '3. final_assessment is its own module type; the old assessment value is untouched');

insert into public.cohorts (id, name, programme_id, start_date, end_date) values
  ('af200000-0000-4000-8000-000000000001', 'Final Cohort', 'af100000-0000-4000-8000-000000000001',
   public.programme_today() - 60, public.programme_today() + 30);
select results_eq(
  $$select count(*)::int, min(public.cohort_requirement_label(module, ordinal)), min(due_on) = public.programme_today() + 30
      from public.cohort_requirement_dates
     where cohort_id = 'af200000-0000-4000-8000-000000000001' and module = 'final_assessment'$$,
  $$values (1, 'Final assessment'::text, true)$$,
  '4. sync_cohort_requirement_dates creates one Final assessment requirement per cohort, due at the cohort end');
select is(public.sync_cohort_requirement_dates('af200000-0000-4000-8000-000000000001'), 0, '5. ... and a re-sync adds nothing');

insert into public.programme_enrollments (id, programme_id, user_id, cohort_id, organization_id, status, start_date, end_date) values
  ('af300000-0000-4000-8000-000000000001', 'af100000-0000-4000-8000-000000000001', 'af000000-0000-4000-8000-000000000001',
   'af200000-0000-4000-8000-000000000001', 'af500000-0000-4000-8000-000000000001', 'active',
   public.programme_today() - 60, public.programme_today() + 30);
create temporary table ids (name text primary key, id uuid);
insert into ids select 'req', d.id from public.cohort_requirement_dates d
 where d.cohort_id = 'af200000-0000-4000-8000-000000000001' and d.module = 'final_assessment';
grant all on ids to authenticated;

-- ===========================================================================
-- The quiz belongs to the final assessment, not a training week
-- ===========================================================================
insert into public.assignments (id, final_assessment_programme_id, assignment_type, title, is_visible)
values ('af600000-0000-4000-8000-000000000001', 'af100000-0000-4000-8000-000000000001', 'quiz', 'Final quiz', true);
insert into public.quiz_questions (id, assignment_id, question_text, options, sort_order) values
  ('af600000-0000-4000-8000-000000000011', 'af600000-0000-4000-8000-000000000001', 'Q1',
   '[{"id": "a", "text": "Right", "is_correct": true}, {"id": "b", "text": "Wrong", "is_correct": false}]', 1),
  ('af600000-0000-4000-8000-000000000012', 'af600000-0000-4000-8000-000000000001', 'Q2',
   '[{"id": "a", "text": "Right", "is_correct": true}, {"id": "b", "text": "Wrong", "is_correct": false}]', 2);
insert into public.training_weeks (id, programme_id, week_number, title)
values ('af700000-0000-4000-8000-000000000001', 'af100000-0000-4000-8000-000000000001', 1, 'Week 1');
select throws_ok($$insert into public.assignments (final_assessment_programme_id, training_week_id, assignment_type, title)
  values ('af100000-0000-4000-8000-000000000001', 'af700000-0000-4000-8000-000000000001', 'quiz', 'Both')$$,
  '23514', null, '6. an assignment belongs to a training week OR a final assessment, not both');
select throws_ok($$insert into public.assignments (assignment_type, title) values ('quiz', 'Nobody''s')$$,
  '23514', null, '7. ... and never to neither');

-- Uploads (storage rows as the storage API writes them).
insert into storage.objects (bucket_id, name, owner_id, metadata) values
  ('assessment-files', 'af300000-0000-4000-8000-000000000001/af400000-0000-4000-8000-000000000001/recording.mp3',
   'af000000-0000-4000-8000-000000000001', '{"mimetype": "audio/mpeg", "size": 30000000}'),
  ('assessment-files', 'af300000-0000-4000-8000-000000000001/af400000-0000-4000-8000-000000000002/recording.mp3',
   'af000000-0000-4000-8000-000000000001', '{"mimetype": "audio/mpeg", "size": 31000000}');

-- ===========================================================================
-- Attempt 1
-- ===========================================================================
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'af000000-0000-4000-8000-000000000001')::text, true);
select results_eq($$select state, quiz_enabled, quiz_question_count, attempt_no, transcript_mode
                      from public.learner_final_assessment('af300000-0000-4000-8000-000000000001')$$,
  $$values ('not_submitted'::text, true, 2, 1, 'required'::text)$$, '8. the learner sees a not-yet-submitted Final Assessment with a quiz');
select is((select count(*)::int from public.learner_final_assessment_quiz('af300000-0000-4000-8000-000000000001') q,
                 jsonb_array_elements(q.options) o where o ? 'is_correct'),
  0, '9. the quiz never carries the answer key');
select throws_ok($$select public.learner_submit_assessment('af400000-0000-4000-8000-000000000001', 'af300000-0000-4000-8000-000000000001',
  (select id from ids where name = 'req'), 'final_assessment', null, null, 'Transcript.', 'pasted',
  '[{"storage_path": "af300000-0000-4000-8000-000000000001/af400000-0000-4000-8000-000000000001/recording.mp3", "file_kind": "recording"}]')$$,
  '22023', 'Take the quiz for this attempt before submitting', '10. the quiz comes first');
select throws_ok($$select public.learner_submit_final_assessment_quiz('af300000-0000-4000-8000-000000000001',
  '{"af600000-0000-4000-8000-000000000011": "a"}')$$, '22023', 'Answer every question', '11. every question is answered');
select lives_ok($$select public.learner_submit_final_assessment_quiz('af300000-0000-4000-8000-000000000001',
  '{"af600000-0000-4000-8000-000000000011": "a", "af600000-0000-4000-8000-000000000012": "b"}')$$, '12. L takes the quiz (1 of 2)');
select results_eq($$select quiz_taken, quiz_score_pct, quiz_passed from public.learner_final_assessment('af300000-0000-4000-8000-000000000001')$$,
  $$values (true, null::numeric, null::boolean)$$, '13. taken, but the score is hidden until release');
-- The quiz row itself is not the learner's to read (20261007000600): keep its id here.
reset role;
insert into ids select 'quiz1', id from public.assignment_submissions
 where enrollment_id = 'af300000-0000-4000-8000-000000000001' and attempt_no = 1;
set local role authenticated;
select throws_ok($$select public.learner_submit_assessment('af400000-0000-4000-8000-000000000001', 'af300000-0000-4000-8000-000000000001',
  (select id from ids where name = 'req'), 'final_assessment', null,
  (select id from ids where name = 'quiz1'),
  'Transcript.', 'pasted', '[]')$$, '22023', 'Upload one MP3 recording', '14. one MP3 recording is required');
select throws_ok($$select public.learner_submit_assessment('af400000-0000-4000-8000-000000000001', 'af300000-0000-4000-8000-000000000001',
  (select id from ids where name = 'req'), 'final_assessment', null,
  (select id from ids where name = 'quiz1'),
  null, 'none',
  '[{"storage_path": "af300000-0000-4000-8000-000000000001/af400000-0000-4000-8000-000000000001/recording.mp3", "file_kind": "recording"}]')$$,
  '22023', 'This Final Assessment needs a transcript', '15. the programme requires a transcript');
select throws_ok($$select public.learner_submit_assessment('af400000-0000-4000-8000-000000000001', 'af300000-0000-4000-8000-000000000001',
  (select id from ids where name = 'req'), 'final_assessment', null,
  (select id from ids where name = 'quiz1'),
  'Coach: what would make today useful?', 'pasted',
  '[{"storage_path": "af300000-0000-4000-8000-000000000001/af400000-0000-4000-8000-000000000001/recording.mp3", "file_kind": "recording", "duration_seconds": 0}]')$$,
  '22023', 'The recording length must be between 1 second and 24 hours', '15b. a recording length, when given, must be a real length');
select lives_ok($$select public.learner_submit_assessment('af400000-0000-4000-8000-000000000001', 'af300000-0000-4000-8000-000000000001',
  (select id from ids where name = 'req'), 'final_assessment', null,
  (select id from ids where name = 'quiz1'),
  'Coach: what would make today useful?', 'pasted',
  '[{"storage_path": "af300000-0000-4000-8000-000000000001/af400000-0000-4000-8000-000000000001/recording.mp3", "file_kind": "recording", "duration_seconds": 1520.4}]')$$,
  '16. L submits attempt 1');

-- 17. Learner, Admin and Sponsor show the same state.
reset role;
create temporary table views (step text, role text, state text, result text);
grant all on views to authenticated;
set local role authenticated;
insert into views select 'submitted', 'learner', state, final_result from public.learner_final_assessment('af300000-0000-4000-8000-000000000001');
select set_config('request.jwt.claims', json_build_object('sub', 'af000000-0000-4000-8000-000000000003')::text, true);
insert into views select 'submitted', 'admin', state, final_result from public.admin_final_assessment_result('af300000-0000-4000-8000-000000000001');
select set_config('request.jwt.claims', json_build_object('sub', 'af000000-0000-4000-8000-000000000004')::text, true);
insert into views select 'submitted', 'sponsor', status, result from public.sponsor_final_assessment_status('af300000-0000-4000-8000-000000000001');
select results_eq($$select role, state, result from views where step = 'submitted' order by role$$,
  $$values ('admin'::text, 'submitted'::text, null::text), ('learner', 'submitted', null), ('sponsor', 'under_review', null)$$,
  '17. submitted: Learner and Admin say Submitted, the Sponsor Under review, nobody a result');

-- Admin assigns, the assessor asks for a resubmission, Admin approves.
select set_config('request.jwt.claims', json_build_object('sub', 'af000000-0000-4000-8000-000000000003')::text, true);
select public.admin_set_cohort_assessor('af200000-0000-4000-8000-000000000001', 'af000000-0000-4000-8000-000000000002');
select public.admin_assign_assessor(array['af400000-0000-4000-8000-000000000001']::uuid[], 'af000000-0000-4000-8000-000000000002');
select set_config('request.jwt.claims', json_build_object('sub', 'af000000-0000-4000-8000-000000000002')::text, true);
select is((select quiz_score_pct from public.coach_assessment_inbox()), 50.0::numeric,
  '18. the assessor sees the quiz score, from assignment_submissions.score_pct');
select is((select (f->>'duration_seconds')::int from public.coach_assessment_inbox() i, jsonb_array_elements(i.learner_files) f
            where f->>'file_kind' = 'recording'), 1520,
  '18b. the assessor''s inbox carries the recording length, which sizes its signed URL (Prompt 15 item 15)');
select public.coach_submit_review('af400000-0000-4000-8000-000000000001', 'Please record a full session.', 'resubmit');
select set_config('request.jwt.claims', json_build_object('sub', 'af000000-0000-4000-8000-000000000003')::text, true);
select public.admin_validate_review((select review_id from public.admin_assessment_queue()
  where submission_id = 'af400000-0000-4000-8000-000000000001'), 'approved');

insert into views select 'resubmit', 'admin', state, final_result from public.admin_final_assessment_result('af300000-0000-4000-8000-000000000001');
select set_config('request.jwt.claims', json_build_object('sub', 'af000000-0000-4000-8000-000000000004')::text, true);
insert into views select 'resubmit', 'sponsor', status, result from public.sponsor_final_assessment_status('af300000-0000-4000-8000-000000000001');
select set_config('request.jwt.claims', json_build_object('sub', 'af000000-0000-4000-8000-000000000001')::text, true);
insert into views select 'resubmit', 'learner', state, final_result from public.learner_final_assessment('af300000-0000-4000-8000-000000000001');
select results_eq($$select role, state, result from views where step = 'resubmit' order by role$$,
  $$values ('admin'::text, 'resubmit_requested'::text, null::text), ('learner', 'resubmit_requested', null), ('sponsor', 'under_review', null)$$,
  '19. Resubmit: Learner and Admin say Resubmission requested, the Sponsor still Under review');
select results_eq($$select attempt_no, quiz_taken, can_resubmit from public.learner_final_assessment('af300000-0000-4000-8000-000000000001')$$,
  $$values (2, false, true)$$, '20. Resubmit opens attempt 2, with a fresh quiz');
-- Decision 4: fulfilment is the submission, not the result.
select results_eq($$select completed_units, overdue_units from public.learner_module_progress('af300000-0000-4000-8000-000000000001') where module = 'final_assessment'$$,
  $$values (1, 0)$$, '21. Resubmit: the Final Assessment stays completed, on the date attempt 1 was submitted');

-- ===========================================================================
-- Attempt 2
-- ===========================================================================
select lives_ok($$select public.learner_submit_final_assessment_quiz('af300000-0000-4000-8000-000000000001',
  '{"af600000-0000-4000-8000-000000000011": "a", "af600000-0000-4000-8000-000000000012": "a"}')$$, '22. L takes the quiz again (2 of 2)');
select throws_ok($$select public.learner_submit_final_assessment_quiz('af300000-0000-4000-8000-000000000001',
  '{"af600000-0000-4000-8000-000000000011": "a", "af600000-0000-4000-8000-000000000012": "a"}')$$, '23505', null,
  '23. ... once per attempt');
select throws_ok($$select public.learner_submit_assessment('af400000-0000-4000-8000-000000000002', 'af300000-0000-4000-8000-000000000001',
  (select id from ids where name = 'req'), 'final_assessment', null,
  (select id from ids where name = 'quiz1'),
  'Transcript.', 'pasted',
  '[{"storage_path": "af300000-0000-4000-8000-000000000001/af400000-0000-4000-8000-000000000002/recording.mp3", "file_kind": "recording"}]')$$,
  '22023', 'Take the quiz for this attempt before submitting', '24. attempt 2 needs attempt 2''s quiz, not attempt 1''s');
select lives_ok($$select public.learner_submit_assessment('af400000-0000-4000-8000-000000000002', 'af300000-0000-4000-8000-000000000001',
  (select id from ids where name = 'req'), 'final_assessment', null,
  (select quiz_submission_id from public.learner_final_assessment('af300000-0000-4000-8000-000000000001')),
  'Coach: what would you like to take away?', 'pasted',
  '[{"storage_path": "af300000-0000-4000-8000-000000000001/af400000-0000-4000-8000-000000000002/recording.mp3", "file_kind": "recording"}]')$$,
  '25. L submits attempt 2');

-- Attempt 2 goes straight back to attempt 1's assessor (decision 6).
select set_config('request.jwt.claims', json_build_object('sub', 'af000000-0000-4000-8000-000000000002')::text, true);
select throws_ok($$select public.coach_submit_review('af400000-0000-4000-8000-000000000002', 'Again?', 'resubmit')$$,
  '22023', null, '26. attempt 2 is the last: no third attempt');
select public.coach_submit_review('af400000-0000-4000-8000-000000000002', 'A clear, well-contracted session.', 'pass');
select set_config('request.jwt.claims', json_build_object('sub', 'af000000-0000-4000-8000-000000000001')::text, true);
select is((select quiz_score_pct from public.learner_final_assessment('af300000-0000-4000-8000-000000000001')), null::numeric,
  '27. awaiting validation: the learner still sees no score');
select set_config('request.jwt.claims', json_build_object('sub', 'af000000-0000-4000-8000-000000000003')::text, true);
select public.admin_validate_review((select review_id from public.admin_assessment_queue()
  where submission_id = 'af400000-0000-4000-8000-000000000002'), 'approved');

insert into views select 'pass', 'admin', state, final_result from public.admin_final_assessment_result('af300000-0000-4000-8000-000000000001');
select set_config('request.jwt.claims', json_build_object('sub', 'af000000-0000-4000-8000-000000000004')::text, true);
insert into views select 'pass', 'sponsor', status, result from public.sponsor_final_assessment_status('af300000-0000-4000-8000-000000000001');
select set_config('request.jwt.claims', json_build_object('sub', 'af000000-0000-4000-8000-000000000001')::text, true);
insert into views select 'pass', 'learner', state, final_result from public.learner_final_assessment('af300000-0000-4000-8000-000000000001');
select results_eq($$select role, state, result from views where step = 'pass' order by role$$,
  $$values ('admin'::text, 'completed'::text, 'pass'::text), ('learner', 'completed', 'pass'), ('sponsor', 'completed', 'pass')$$,
  '28. released Pass: Learner, Admin and Sponsor all show Completed - Pass');
select results_eq($$select quiz_score_pct, pass_mark_pct, quiz_passed, can_resubmit from public.learner_final_assessment('af300000-0000-4000-8000-000000000001')$$,
  $$values (100.0::numeric, 70::numeric, true, false)$$, '29. after release the learner sees the attempt-2 quiz score, above the 70% pass mark (decided in SQL)');
select results_eq($$select quiz_score_pct, pass_mark_pct, quiz_passed from public.learner_assessment_feedback('af300000-0000-4000-8000-000000000001')
                      where submission_id = 'af400000-0000-4000-8000-000000000002'$$,
  $$values (100.0::numeric, 70::numeric, true)$$, '29b. the released feedback says the quiz is above the pass mark (Prompt 15 item 14)');
select results_eq($$select required_units, completed_units, pace_status from public.learner_module_progress('af300000-0000-4000-8000-000000000001') where module = 'final_assessment'$$,
  $$values (1, 1, 'completed'::text)$$, '30. canonical_module_progress counts the Final Assessment as completed');
select throws_ok($$select public.learner_submit_assessment(gen_random_uuid(), 'af300000-0000-4000-8000-000000000001',
  (select id from ids where name = 'req'), 'final_assessment', null, null, 'x', 'pasted', '[]')$$,
  '23505', null, '31. nothing after the final result');

reset role;
select results_eq($$select quiz_passed, outcome, final_result
                      from public.canonical_final_assessment_result('af300000-0000-4000-8000-000000000001')$$,
  $$values (true, 'pass'::text, 'pass'::text)$$, '32. one construction behind all three views');
select ok(
  not has_function_privilege('authenticated', 'public.canonical_final_assessment_result(uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.canonical_final_assessment_fulfilment(uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.final_assessment_config_internal(uuid)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.learner_final_assessment(uuid)', 'EXECUTE'),
  '33. the canonical constructions are not client-callable; the role wrappers are');
select * from finish();
rollback;
