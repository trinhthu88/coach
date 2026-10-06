-- Final Assessment automatic transcription: consent, cap of 3 per attempt,
-- saved draft, Admin cost log (20261007000400_final_assessment_auto_transcription).
begin;
select plan(16);

-- 01 learner   02 another learner   03 Admin
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_user_meta_data, created_at, updated_at, confirmation_token, email_change_token_new, recovery_token)
select ('a7000000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid,
  '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated',
  'atrans-' || n || '@example.test', 'test', now(),
  jsonb_build_object('full_name', 'ATrans Person ' || n), now(), now(), '', '', ''
from generate_series(1, 3) n;
insert into public.user_roles (user_id, role) values
  ('a7000000-0000-4000-8000-000000000001', 'coachee'), ('a7000000-0000-4000-8000-000000000002', 'coachee'),
  ('a7000000-0000-4000-8000-000000000003', 'admin')
on conflict do nothing;
update public.profiles set status = 'active'::public.user_status where id::text like 'a7000000-%';

-- Programme 1 takes a transcript; programme 2 does not.
insert into public.programmes (id, name) values
  ('a7100000-0000-4000-8000-000000000001', 'FA transcript'), ('a7100000-0000-4000-8000-000000000002', 'FA no transcript');
insert into public.programme_modules (programme_id, module, enabled, config) values
  ('a7100000-0000-4000-8000-000000000001', 'final_assessment', true, '{"required": true, "transcript": "optional"}'),
  ('a7100000-0000-4000-8000-000000000002', 'final_assessment', true, '{"required": true, "transcript": "none"}');
insert into public.cohorts (id, name, programme_id, start_date, end_date) values
  ('a7200000-0000-4000-8000-000000000001', 'C1', 'a7100000-0000-4000-8000-000000000001', public.programme_today() - 30, public.programme_today() + 30),
  ('a7200000-0000-4000-8000-000000000002', 'C2', 'a7100000-0000-4000-8000-000000000002', public.programme_today() - 30, public.programme_today() + 30);
insert into public.programme_enrollments (id, programme_id, user_id, cohort_id, status, start_date, end_date) values
  ('a7300000-0000-4000-8000-000000000001', 'a7100000-0000-4000-8000-000000000001', 'a7000000-0000-4000-8000-000000000001',
   'a7200000-0000-4000-8000-000000000001', 'active', public.programme_today() - 30, public.programme_today() + 30),
  ('a7300000-0000-4000-8000-000000000002', 'a7100000-0000-4000-8000-000000000002', 'a7000000-0000-4000-8000-000000000002',
   'a7200000-0000-4000-8000-000000000002', 'active', public.programme_today() - 30, public.programme_today() + 30);

create temp table claims (n int, id uuid);
grant all on claims to authenticated, service_role;

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'a7000000-0000-4000-8000-000000000001')::text, true);
select throws_ok($$select * from public.learner_claim_final_assessment_transcription('a7300000-0000-4000-8000-000000000001',
  'a7300000-0000-4000-8000-000000000001/a7400000-0000-4000-8000-000000000001/recording.mp3', false)$$,
  '22023', 'consent_required', '1. no consent, no call');
select throws_ok($$select * from public.learner_claim_final_assessment_transcription('a7300000-0000-4000-8000-000000000001',
  'a7300000-0000-4000-8000-000000000002/a7400000-0000-4000-8000-000000000001/recording.mp3', true)$$,
  '22023', 'invalid_request', '2. only a recording under this enrollment');
select results_eq($$select cap, remaining, draft_text from public.learner_final_assessment_transcription('a7300000-0000-4000-8000-000000000001')$$,
  $$values (3, 3, null::text)$$, '3. 3 drafts left, no draft yet');

insert into claims select 1, transcription_id from public.learner_claim_final_assessment_transcription('a7300000-0000-4000-8000-000000000001',
  'a7300000-0000-4000-8000-000000000001/a7400000-0000-4000-8000-000000000001/recording.mp3', true);
select results_eq($$select remaining from public.learner_final_assessment_transcription('a7300000-0000-4000-8000-000000000001')$$,
  $$values (2)$$, '4. a running call holds a use');
select throws_ok($$select public.final_assessment_transcription_finish_internal((select id from claims where n = 1), true, 'x', 60)$$,
  '42501', null, '5. a learner cannot write the outcome or the minutes');
select throws_ok($$select * from public.final_assessment_transcriptions$$, '42501', null, '6. the log is not readable directly');

reset role;
set local role service_role;
select public.final_assessment_transcription_finish_internal((select id from claims where n = 1), true, '  Xin chào, hôm nay bạn muốn gì?  ', 1500);

set local role authenticated;
select results_eq($$select remaining, draft_text from public.learner_final_assessment_transcription('a7300000-0000-4000-8000-000000000001')$$,
  $$values (2, 'Xin chào, hôm nay bạn muốn gì?'::text)$$, '7. the draft is saved on the attempt, a reload gets it back');

-- A failed call gives its use back.
insert into claims select 2, transcription_id from public.learner_claim_final_assessment_transcription('a7300000-0000-4000-8000-000000000001',
  'a7300000-0000-4000-8000-000000000001/a7400000-0000-4000-8000-000000000001/recording.mp3', true);
reset role;
set local role service_role;
select public.final_assessment_transcription_finish_internal((select id from claims where n = 2), false);
set local role authenticated;
select results_eq($$select remaining, draft_text from public.learner_final_assessment_transcription('a7300000-0000-4000-8000-000000000001')$$,
  $$values (2, 'Xin chào, hôm nay bạn muốn gì?'::text)$$, '8. a failed call costs no draft and keeps the last draft');

insert into claims select 3, transcription_id from public.learner_claim_final_assessment_transcription('a7300000-0000-4000-8000-000000000001',
  'a7300000-0000-4000-8000-000000000001/a7400000-0000-4000-8000-000000000001/recording.mp3', true);
select results_eq($$select remaining from public.learner_claim_final_assessment_transcription('a7300000-0000-4000-8000-000000000001',
  'a7300000-0000-4000-8000-000000000001/a7400000-0000-4000-8000-000000000001/recording.mp3', true)$$,
  $$values (0)$$, '9. the third draft leaves none');
select throws_ok($$select * from public.learner_claim_final_assessment_transcription('a7300000-0000-4000-8000-000000000001',
  'a7300000-0000-4000-8000-000000000001/a7400000-0000-4000-8000-000000000001/recording.mp3', true)$$,
  'P0001', 'limit_reached', '10. a fourth call is refused in the database');
select results_eq($$select remaining from public.learner_final_assessment_transcription('a7300000-0000-4000-8000-000000000001')$$,
  $$values (0)$$, '11. ... and the page shows none left');

-- Other learners and programmes without a transcript.
select set_config('request.jwt.claims', json_build_object('sub', 'a7000000-0000-4000-8000-000000000002')::text, true);
select throws_ok($$select * from public.learner_claim_final_assessment_transcription('a7300000-0000-4000-8000-000000000001',
  'a7300000-0000-4000-8000-000000000001/a7400000-0000-4000-8000-000000000001/recording.mp3', true)$$,
  '42501', 'not_open', '12. another learner cannot use someone else''s attempt');
select is((select count(*)::int from public.learner_final_assessment_transcription('a7300000-0000-4000-8000-000000000001')),
  0, '13. ... nor read their draft');
select throws_ok($$select * from public.learner_claim_final_assessment_transcription('a7300000-0000-4000-8000-000000000002',
  'a7300000-0000-4000-8000-000000000002/a7400000-0000-4000-8000-000000000002/recording.mp3', true)$$,
  '22023', 'not_open', '14. no automatic transcription when the programme takes no transcript');
select throws_ok($$select * from public.admin_final_assessment_transcriptions()$$, '42501', null, '15. only an Admin reads the cost log');

-- Admin: every call with attempt, learner, audio minutes and time.
select set_config('request.jwt.claims', json_build_object('sub', 'a7000000-0000-4000-8000-000000000003')::text, true);
select results_eq(
  $$select attempt_no, learner_name, status, audio_minutes from public.admin_final_assessment_transcriptions('a7300000-0000-4000-8000-000000000001')
    order by started_at, status$$,
  $$values (1, 'ATrans Person 1'::text, 'failed'::text, null::numeric), (1, 'ATrans Person 1', 'pending', null),
           (1, 'ATrans Person 1', 'pending', null), (1, 'ATrans Person 1', 'succeeded', 25.00)$$,
  '16. Admin sees each call: attempt, learner, status and audio minutes');

select * from finish();
rollback;
