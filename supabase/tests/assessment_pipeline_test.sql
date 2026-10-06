-- Assessment review pipeline (20261006210000_assessment_pipeline).
-- One section per rule of the Assessment review spec (R1-R12).
begin;
select plan(53);

-- ---------------------------------------------------------------------------
-- Fixture
-- ---------------------------------------------------------------------------
-- 01 learner L   02 assessor A   03 coach X (no pool)   04 Admin
-- 05 coach O (in the pool, but L's own Coach)   06 Sponsor S   07 learner M
-- 08 assessor B
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_user_meta_data, created_at, updated_at, confirmation_token, email_change_token_new, recovery_token)
select ('ac000000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid,
  '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated',
  'assess-' || n || '@example.test', 'test', now(),
  jsonb_build_object('full_name', 'Assess Person ' || n), now(), now(), '', '', ''
from generate_series(1, 8) n;
insert into public.user_roles (user_id, role) values
  ('ac000000-0000-4000-8000-000000000001', 'coachee'), ('ac000000-0000-4000-8000-000000000002', 'coach'),
  ('ac000000-0000-4000-8000-000000000003', 'coach'), ('ac000000-0000-4000-8000-000000000004', 'admin'),
  ('ac000000-0000-4000-8000-000000000005', 'coach'), ('ac000000-0000-4000-8000-000000000006', 'sponsor'),
  ('ac000000-0000-4000-8000-000000000007', 'coachee'), ('ac000000-0000-4000-8000-000000000008', 'coach')
on conflict do nothing;
update public.profiles set status = 'active'::public.user_status where id::text like 'ac000000-%';
insert into public.coach_profiles (id, approval_status)
select ('ac000000-0000-4000-8000-00000000000' || n)::uuid, 'active' from unnest(array[2, 3, 5, 8]) n
on conflict (id) do update set approval_status = 'active';

insert into public.organizations (id, name) values ('ac500000-0000-4000-8000-000000000001', 'Assess Org');
insert into public.sponsor_profiles (user_id, organization_id) values ('ac000000-0000-4000-8000-000000000006', 'ac500000-0000-4000-8000-000000000001');
insert into public.programmes (id, name) values ('ac100000-0000-4000-8000-000000000001', 'Assessed Programme');
insert into public.programme_modules (programme_id, module, enabled, config) values
  ('ac100000-0000-4000-8000-000000000001', 'triads', true, '{"required": true, "required_units": 1}'),
  ('ac100000-0000-4000-8000-000000000001', 'coaching', true, '{"required": true, "required_units": 1}');
insert into public.cohorts (id, name, programme_id, start_date, end_date) values
  ('ac200000-0000-4000-8000-000000000001', 'Assess Cohort', 'ac100000-0000-4000-8000-000000000001',
   public.programme_today() - 30, public.programme_today() + 200),
  ('ac200000-0000-4000-8000-000000000002', 'Other Cohort', 'ac100000-0000-4000-8000-000000000001',
   public.programme_today() - 30, public.programme_today() + 200);
update public.cohort_requirement_dates set due_on = public.programme_today() + 5, is_overridden = true,
  generation_method = 'manual', materialized_via = 'admin_save'
 where cohort_id in ('ac200000-0000-4000-8000-000000000001', 'ac200000-0000-4000-8000-000000000002');
insert into public.cohort_coach_assignments (cohort_id, coach_id)
values ('ac200000-0000-4000-8000-000000000001', 'ac000000-0000-4000-8000-000000000005');
insert into public.programme_enrollments (id, programme_id, user_id, cohort_id, organization_id, status, start_date, end_date) values
  ('ac300000-0000-4000-8000-000000000001', 'ac100000-0000-4000-8000-000000000001', 'ac000000-0000-4000-8000-000000000001',
   'ac200000-0000-4000-8000-000000000001', 'ac500000-0000-4000-8000-000000000001', 'active', public.programme_today() - 30, public.programme_today() + 200),
  ('ac300000-0000-4000-8000-000000000007', 'ac100000-0000-4000-8000-000000000001', 'ac000000-0000-4000-8000-000000000007',
   'ac200000-0000-4000-8000-000000000001', 'ac500000-0000-4000-8000-000000000001', 'active', public.programme_today() - 30, public.programme_today() + 200);

create temporary table ids (name text primary key, id uuid);
insert into ids select 'triad1', d.id from public.cohort_requirement_dates d
 where d.cohort_id = 'ac200000-0000-4000-8000-000000000001' and d.module = 'triads';
insert into ids select 'other_triad1', d.id from public.cohort_requirement_dates d
 where d.cohort_id = 'ac200000-0000-4000-8000-000000000002' and d.module = 'triads';
insert into ids values ('sub', 'ac400000-0000-4000-8000-000000000001');
grant all on ids to authenticated;

-- L's own Coach O has a Coaching session with L.
select set_config('app.session_transition', 'on', true);
insert into public.sessions (enrollment_id, cohort_requirement_id, coach_id, coachee_id, topic, start_time, duration_minutes, status)
select 'ac300000-0000-4000-8000-000000000001', d.id, 'ac000000-0000-4000-8000-000000000005',
  'ac000000-0000-4000-8000-000000000001', 'Own coach', now() + interval '3 days', 60, 'confirmed'
from public.cohort_requirement_dates d where d.cohort_id = 'ac200000-0000-4000-8000-000000000001' and d.module = 'coaching';
select set_config('app.session_transition', '', true);

-- A completed Triad 1 and L's reflection.
insert into public.triad_groups (id, cohort_requirement_date_id, is_active)
values ('ac600000-0000-4000-8000-000000000001', (select id from ids where name = 'triad1'), true);
insert into public.triad_group_members (triad_group_id, enrollment_id, member_order) values
  ('ac600000-0000-4000-8000-000000000001', 'ac300000-0000-4000-8000-000000000001', 1),
  ('ac600000-0000-4000-8000-000000000001', 'ac300000-0000-4000-8000-000000000007', 2);
insert into public.triad_sessions (id, triad_group_id, scheduled_start_time, status)
values ('ac600000-0000-4000-8000-000000000002', 'ac600000-0000-4000-8000-000000000001', now() - interval '1 day', 'completed');
insert into public.triad_reflections (id, triad_session_id, enrollment_id, satisfaction_rating)
values ('ac600000-0000-4000-8000-000000000003', 'ac600000-0000-4000-8000-000000000002', 'ac300000-0000-4000-8000-000000000001', 4);

-- Assessor pool: A, B and O.
select set_config('request.jwt.claims', json_build_object('sub', 'ac000000-0000-4000-8000-000000000004')::text, true);
select public.admin_set_cohort_assessor('ac200000-0000-4000-8000-000000000001', c)
from unnest(array['ac000000-0000-4000-8000-000000000002', 'ac000000-0000-4000-8000-000000000008',
                  'ac000000-0000-4000-8000-000000000005']::uuid[]) c;

-- "Uploads" (storage rows as the storage API writes them).
insert into storage.objects (bucket_id, name, owner_id, metadata) values
  ('assessment-files', 'ac300000-0000-4000-8000-000000000001/ac400000-0000-4000-8000-000000000001/notes.txt',
   'ac000000-0000-4000-8000-000000000001', '{"mimetype": "text/plain", "size": 120}');

-- ===========================================================================
-- R1. No direct writes from the app
-- ===========================================================================
select ok(not exists (
  select 1 from unnest(array['cohort_assessors', 'assessment_submissions', 'assessment_files', 'assessment_assignments',
                             'assessment_reviews', 'assessment_validations']) t
  where has_table_privilege('authenticated', 'public.' || t, 'INSERT') or has_table_privilege('authenticated', 'public.' || t, 'UPDATE')
     or has_table_privilege('authenticated', 'public.' || t, 'DELETE') or has_table_privilege('authenticated', 'public.' || t, 'SELECT')),
  'R1a. the app holds no privilege on the six tables');
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'ac000000-0000-4000-8000-000000000001')::text, true);
select throws_ok($$insert into public.assessment_submissions (id, enrollment_id, kind, cohort_requirement_id, status, submitted_at, triad_reflection_id)
  values (gen_random_uuid(), 'ac300000-0000-4000-8000-000000000001', 'triad', (select id from ids where name = 'triad1'), 'released', now(), 'ac600000-0000-4000-8000-000000000003')$$,
  '42501', null, 'R1b. a learner cannot write a submission directly, least of all a released one');
select set_config('request.jwt.claims', json_build_object('sub', 'ac000000-0000-4000-8000-000000000004')::text, true);
select throws_ok($$insert into public.cohort_assessors (cohort_id, coach_id) values ('ac200000-0000-4000-8000-000000000001', 'ac000000-0000-4000-8000-000000000003')$$,
  '42501', null, 'R1c. not even an Admin writes the pool directly: admin_set_cohort_assessor does');

-- ===========================================================================
-- R2. The learner submits for their own ongoing enrollment, a requirement of
--     their cohort, once per attempt; then the content is locked
-- ===========================================================================
select set_config('request.jwt.claims', json_build_object('sub', 'ac000000-0000-4000-8000-000000000007')::text, true);
select throws_ok($$select public.learner_submit_assessment((select id from ids where name = 'sub'), 'ac300000-0000-4000-8000-000000000001',
  (select id from ids where name = 'triad1'), 'triad', 'ac600000-0000-4000-8000-000000000003')$$,
  '42501', null, 'R2a. another learner cannot submit for L');
select set_config('request.jwt.claims', json_build_object('sub', 'ac000000-0000-4000-8000-000000000001')::text, true);
select throws_ok($$select public.learner_submit_assessment(gen_random_uuid(), 'ac300000-0000-4000-8000-000000000001',
  (select id from ids where name = 'other_triad1'), 'triad', 'ac600000-0000-4000-8000-000000000003')$$,
  '42501', null, 'R2b. only a requirement of the learner''s own cohort');
select lives_ok($$select public.learner_submit_assessment((select id from ids where name = 'sub'), 'ac300000-0000-4000-8000-000000000001',
  (select id from ids where name = 'triad1'), 'triad', 'ac600000-0000-4000-8000-000000000003', null, null, 'uploaded',
  '[{"storage_path": "ac300000-0000-4000-8000-000000000001/ac400000-0000-4000-8000-000000000001/notes.txt", "file_kind": "transcript"}]')$$,
  'R2c. L submits Triad 1, linked to their reflection');
select throws_ok($$select public.learner_submit_assessment(gen_random_uuid(), 'ac300000-0000-4000-8000-000000000001',
  (select id from ids where name = 'triad1'), 'triad', 'ac600000-0000-4000-8000-000000000003')$$,
  '23505', null, 'R2d. once per attempt (a Triad has one)');
-- (Storage refuses direct SQL deletes; the Storage API deletes under the
-- policy below, which refuses any registered file.)
select ok(public.assessment_object_registered('ac300000-0000-4000-8000-000000000001/ac400000-0000-4000-8000-000000000001/notes.txt')
  and exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
              and policyname = 'Assessment files: delete before registration' and qual ~ 'NOT assessment_object_registered'),
  'R2e. a submitted file is locked: the delete policy refuses registered files');
select is(public.assessment_object_writable('ac300000-0000-4000-8000-000000000001/ac400000-0000-4000-8000-000000000001/more.txt'),
  false, 'R2f. ... nor add to a submitted submission');
reset role;
select is((select status from public.assessment_submissions where id = (select id from ids where name = 'sub')),
  'awaiting_assignment', 'R2g. a new submission awaits assignment');

-- ===========================================================================
-- R3. Only Admin assigns, and only from the cohort's pool
-- ===========================================================================
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'ac000000-0000-4000-8000-000000000002')::text, true);
select throws_ok($$select public.admin_assign_assessor(array[(select id from ids where name = 'sub')], 'ac000000-0000-4000-8000-000000000002')$$,
  '42501', null, 'R3a. a coach cannot assign');
select set_config('request.jwt.claims', json_build_object('sub', 'ac000000-0000-4000-8000-000000000004')::text, true);
select throws_ok($$select public.admin_assign_assessor(array[(select id from ids where name = 'sub')], 'ac000000-0000-4000-8000-000000000003')$$,
  '42501', null, 'R3b. a coach outside the cohort''s pool is refused');
select throws_ok($$select public.admin_assign_assessor(array[(select id from ids where name = 'sub')], 'ac000000-0000-4000-8000-000000000005')$$,
  '42501', null, 'R3c. the learner''s own programme coach is refused (decision 6)');
select is(public.admin_assign_assessor(array[(select id from ids where name = 'sub')], 'ac000000-0000-4000-8000-000000000002'),
  1, 'R3d. an Admin assigns A from the pool');
reset role;
select results_eq(
  $$select assessor_id, due_on from public.assessment_assignments where submission_id = (select id from ids where name = 'sub') and ended_at is null$$,
  $$values ('ac000000-0000-4000-8000-000000000002'::uuid, public.programme_today() + 7)$$,
  'R3e. one open assignment, due 7 days later (decision 7)');

-- ===========================================================================
-- R4. A coach reads a submission only while its active assessor
-- ===========================================================================
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'ac000000-0000-4000-8000-000000000002')::text, true);
select results_eq($$select inbox_tab, triad_reflection_id from public.coach_assessment_inbox()$$,
  $$values ('to_assess'::text, 'ac600000-0000-4000-8000-000000000003'::uuid)$$,
  'R4a. A sees the submission and its reflection link');
select is(public.assessment_object_readable('ac300000-0000-4000-8000-000000000001/ac400000-0000-4000-8000-000000000001/notes.txt'),
  true, 'R4b. ... and may open its files');
select set_config('request.jwt.claims', json_build_object('sub', 'ac000000-0000-4000-8000-000000000003')::text, true);
select is((select count(*)::int from public.coach_assessment_inbox()), 0, 'R4c. another coach sees nothing');
select set_config('request.jwt.claims', json_build_object('sub', 'ac000000-0000-4000-8000-000000000004')::text, true);
select public.admin_assign_assessor(array[(select id from ids where name = 'sub')], 'ac000000-0000-4000-8000-000000000008');
select set_config('request.jwt.claims', json_build_object('sub', 'ac000000-0000-4000-8000-000000000002')::text, true);
select is((select count(*)::int from public.coach_assessment_inbox()), 0, 'R4d. reassigned away, A loses it');
select is(public.assessment_object_readable('ac300000-0000-4000-8000-000000000001/ac400000-0000-4000-8000-000000000001/notes.txt'),
  false, 'R4e. ... and its files');
select set_config('request.jwt.claims', json_build_object('sub', 'ac000000-0000-4000-8000-000000000008')::text, true);
select is((select count(*)::int from public.coach_assessment_inbox()), 1, 'R4f. B now has it');

-- ===========================================================================
-- R5. Only the active assessor reviews, and only when it is theirs to review
-- ===========================================================================
select set_config('request.jwt.claims', json_build_object('sub', 'ac000000-0000-4000-8000-000000000002')::text, true);
select throws_ok($$select public.coach_submit_review((select id from ids where name = 'sub'), 'Feedback from A')$$,
  '42501', null, 'R5a. a former assessor cannot review');
select set_config('request.jwt.claims', json_build_object('sub', 'ac000000-0000-4000-8000-000000000008')::text, true);
select throws_ok($$select public.coach_submit_review((select id from ids where name = 'sub'), 'Good', 'pass')$$,
  '22023', null, 'R5b. a Triad review carries no result (decision 3)');
select lives_ok($$select public.coach_submit_review((select id from ids where name = 'sub'), 'Version 1: clear observations.')$$,
  'R5c. the active assessor submits feedback');
select throws_ok($$select public.coach_submit_review((select id from ids where name = 'sub'), 'Again')$$,
  '23514', null, 'R5d. not again while it awaits validation');

-- ===========================================================================
-- R6. Only Admin validates; Return needs a reason; Approve releases and
--     notifies in the same transaction
-- ===========================================================================
reset role;
insert into ids select 'review1', r.id from public.assessment_reviews r where r.submission_id = (select id from ids where name = 'sub') and r.version = 1;
set local role authenticated;
select throws_ok($$select public.admin_validate_review((select id from ids where name = 'review1'), 'approved')$$,
  '42501', null, 'R6a. a coach cannot validate');
select set_config('request.jwt.claims', json_build_object('sub', 'ac000000-0000-4000-8000-000000000004')::text, true);
select throws_ok($$select public.admin_validate_review((select id from ids where name = 'review1'), 'returned', '  ')$$,
  '22023', null, 'R6b. Return needs a reason');
select is(public.admin_validate_review((select id from ids where name = 'review1'), 'returned', 'Please cite a moment from the session.'),
  'returned', 'R6c. Admin returns version 1 with a reason');
select set_config('request.jwt.claims', json_build_object('sub', 'ac000000-0000-4000-8000-000000000008')::text, true);
select is((select return_reason from public.coach_assessment_inbox()), 'Please cite a moment from the session.',
  'R6d. the assessor sees Admin''s reason');
select lives_ok($$select public.coach_submit_review((select id from ids where name = 'sub'), 'Version 2: at 10 minutes you reframed well.')$$,
  'R6e. ... and submits version 2');
select set_config('request.jwt.claims', json_build_object('sub', 'ac000000-0000-4000-8000-000000000004')::text, true);
reset role;
insert into ids select 'review2', r.id from public.assessment_reviews r where r.submission_id = (select id from ids where name = 'sub') and r.version = 2;
set local role authenticated;
select is(public.admin_validate_review((select id from ids where name = 'review2'), 'approved'), 'approved', 'R6f. Admin approves version 2');
reset role;
select results_eq(
  $$select status, released_at is not null from public.assessment_submissions where id = (select id from ids where name = 'sub')$$,
  $$values ('released'::text, true)$$, 'R6g. approval released it');
select is((select count(*)::int from public.notifications
            where user_id = 'ac000000-0000-4000-8000-000000000001' and notification_type = 'assessment_feedback_released'),
  1, 'R6h. ... and notified the learner, in the same transaction');

-- ===========================================================================
-- R7. The learner reads only the released, approved version, never a reason
-- ===========================================================================
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'ac000000-0000-4000-8000-000000000001')::text, true);
select results_eq(
  $$select feedback_text, assessor_name from public.learner_assessment_feedback('ac300000-0000-4000-8000-000000000001')$$,
  $$values ('Version 2: at 10 minutes you reframed well.'::text, 'Assess Person 8'::text)$$,
  'R7a. the approved version, with the assessor''s name (decision 12)');
select ok(not exists (
  select 1 from pg_proc p, unnest(p.proargnames) a(name)
  where p.proname = 'learner_assessment_feedback' and a.name ~ 'reason'),
  'R7b. the learner''s feedback has no return reason in it');
select throws_ok($$select * from public.assessment_reviews$$, '42501', null, 'R7c. the learner cannot read reviews directly');
select set_config('request.jwt.claims', json_build_object('sub', 'ac000000-0000-4000-8000-000000000007')::text, true);
select is((select count(*)::int from public.learner_assessment_feedback('ac300000-0000-4000-8000-000000000001')),
  0, 'R7d. another learner reads none of it');

-- ===========================================================================
-- R8. Every time is the server's
-- ===========================================================================
select set_config('request.jwt.claims', json_build_object('sub', 'ac000000-0000-4000-8000-000000000001')::text, true);
select isnt(public.learner_mark_feedback_viewed((select id from ids where name = 'sub')), null, 'R8a. viewing records viewed_at');
reset role;
select results_eq(
  $$select s.submitted_at = now(), s.released_at = now(), s.viewed_at = now(),
           (select bool_and(assigned_at = now()) from public.assessment_assignments a where a.submission_id = s.id),
           (select bool_and(submitted_at = now()) from public.assessment_reviews r where r.submission_id = s.id),
           (select bool_and(decided_at = now()) from public.assessment_validations v join public.assessment_reviews r on r.id = v.review_id where r.submission_id = s.id)
      from public.assessment_submissions s where s.id = (select id from ids where name = 'sub')$$,
  $$values (true, true, true, true, true, true)$$,
  'R8b. submitted, assigned, reviewed, decided, released and viewed are all server times');
select ok(not exists (
  select 1 from pg_proc p
  where p.proname in ('learner_submit_assessment', 'admin_assign_assessor', 'coach_submit_review', 'admin_validate_review', 'learner_mark_feedback_viewed')
    and pg_get_function_arguments(p.oid) ~* 'timestamp|date'),
  'R8c. no step accepts a time from the app');

-- ===========================================================================
-- R9. The quiz score is never accepted from the app
-- ===========================================================================
select ok(not exists (
  select 1 from pg_proc p where p.proname = 'learner_submit_assessment' and pg_get_function_arguments(p.oid) ~* 'score|correct|total'),
  'R9a. the submit step takes a quiz submission id, never a score');
select ok(pg_get_functiondef('public.canonical_assessment_feedback_internal(uuid)'::regprocedure) ~ 'q\.score_pct',
  'R9b. the released score is assignment_submissions.score_pct (the database''s own scoring)');

-- ===========================================================================
-- R10. File type and size: the bucket refuses them, and so does the function
-- ===========================================================================
select results_eq(
  $$select public, file_size_limit, 'video/mp4' = any(allowed_mime_types), 'audio/mpeg' = any(allowed_mime_types)
      from storage.buckets where id = 'assessment-files'$$,
  $$values (false, 52428800::bigint, false, true)$$,
  'R10a. private bucket, 50 MB, MP3 accepted, video refused');
-- A second submission (learner M) to test the assessor's files.
select set_config('request.jwt.claims', json_build_object('sub', 'ac000000-0000-4000-8000-000000000007')::text, true);
insert into public.triad_reflections (id, triad_session_id, enrollment_id, satisfaction_rating)
values ('ac600000-0000-4000-8000-000000000004', 'ac600000-0000-4000-8000-000000000002', 'ac300000-0000-4000-8000-000000000007', 5);
set local role authenticated;
insert into storage.objects (bucket_id, name, owner_id, metadata) values
  ('assessment-files', 'ac300000-0000-4000-8000-000000000007/ac400000-0000-4000-8000-000000000007/clip.mp4',
   'ac000000-0000-4000-8000-000000000007', '{"mimetype": "video/mp4", "size": 1000}');
select throws_ok($$select public.learner_submit_assessment('ac400000-0000-4000-8000-000000000007', 'ac300000-0000-4000-8000-000000000007',
  (select id from ids where name = 'triad1'), 'triad', 'ac600000-0000-4000-8000-000000000004', null, null, 'uploaded',
  '[{"storage_path": "ac300000-0000-4000-8000-000000000007/ac400000-0000-4000-8000-000000000007/clip.mp4", "file_kind": "transcript"}]')$$,
  '22023', null, 'R10b. a video passed as a transcript is refused by the submit function');
select lives_ok($$select public.learner_submit_assessment('ac400000-0000-4000-8000-000000000007', 'ac300000-0000-4000-8000-000000000007',
  (select id from ids where name = 'triad1'), 'triad', 'ac600000-0000-4000-8000-000000000004')$$,
  'R10c. M submits without files');
select set_config('request.jwt.claims', json_build_object('sub', 'ac000000-0000-4000-8000-000000000004')::text, true);
select public.admin_assign_assessor(array['ac400000-0000-4000-8000-000000000007'::uuid], 'ac000000-0000-4000-8000-000000000002');
select set_config('request.jwt.claims', json_build_object('sub', 'ac000000-0000-4000-8000-000000000002')::text, true);
insert into storage.objects (bucket_id, name, owner_id, metadata) values
  ('assessment-files', 'ac300000-0000-4000-8000-000000000007/ac400000-0000-4000-8000-000000000007/feedback.pdf',
   'ac000000-0000-4000-8000-000000000002', '{"mimetype": "application/pdf", "size": 12582912}');
select throws_ok($$select public.coach_submit_review('ac400000-0000-4000-8000-000000000007', null, null,
  '[{"storage_path": "ac300000-0000-4000-8000-000000000007/ac400000-0000-4000-8000-000000000007/feedback.pdf", "file_kind": "feedback_pdf"}]')$$,
  '22023', null, 'R10d. a 12 MB feedback PDF is refused (10 MB)');

-- ===========================================================================
-- R11. Sponsor functions return status and result only
-- ===========================================================================
select set_config('request.jwt.claims', json_build_object('sub', 'ac000000-0000-4000-8000-000000000006')::text, true);
select is(pg_get_function_result('public.sponsor_final_assessment_status(uuid)'::regprocedure),
  'TABLE(status text, result text)', 'R11a. the Sponsor reads status and result, nothing else');
select results_eq($$select status, result from public.sponsor_final_assessment_status('ac300000-0000-4000-8000-000000000001')$$,
  $$values ('not_submitted'::text, null::text)$$, 'R11b. ... and nothing for Triad reviews');
select throws_ok($$select * from public.admin_assessment_queue()$$, '42501', null, 'R11c. the Sponsor cannot read the queue');
select is((select count(*)::int from public.learner_assessment_feedback('ac300000-0000-4000-8000-000000000001')),
  0, 'R11d. ... nor the learner''s feedback');

-- ===========================================================================
-- R12. No cascading deletes while submissions or reviews exist
-- ===========================================================================
reset role;
select throws_ok($$delete from public.programme_enrollments where id = 'ac300000-0000-4000-8000-000000000001'$$,
  '23503', null, 'R12a. an enrollment with a submission cannot be deleted');
select throws_ok($$delete from public.profiles where id = 'ac000000-0000-4000-8000-000000000008'$$,
  '23503', null, 'R12b. an assessor with reviews cannot be deleted');
select throws_ok($$delete from public.cohorts where id = 'ac200000-0000-4000-8000-000000000001'$$,
  null, null, 'R12c. nor the cohort holding them');

select * from finish();
rollback;
