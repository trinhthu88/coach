-- Assessment inbox and feedback release (20261006230000_assessment_inbox_feedback; Prompt A4).
begin;
select plan(11);

-- 01 learner L   02 assessor A   03 coach X (no assignment)   04 Admin   05 Coach-learner K
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_user_meta_data, created_at, updated_at, confirmation_token, email_change_token_new, recovery_token)
select ('ae000000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid,
  '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated',
  'ainbox-' || n || '@example.test', 'test', now(),
  jsonb_build_object('full_name', 'AInbox Person ' || n), now(), now(), '', '', ''
from generate_series(1, 5) n;
insert into public.user_roles (user_id, role) values
  ('ae000000-0000-4000-8000-000000000001', 'coachee'), ('ae000000-0000-4000-8000-000000000002', 'coach'),
  ('ae000000-0000-4000-8000-000000000003', 'coach'), ('ae000000-0000-4000-8000-000000000004', 'admin'),
  ('ae000000-0000-4000-8000-000000000005', 'coach'), ('ae000000-0000-4000-8000-000000000005', 'coachee')
on conflict do nothing;
update public.profiles set status = 'active'::public.user_status, preferred_language = 'vi'
 where id::text like 'ae000000-%';

insert into public.programmes (id, name) values ('ae100000-0000-4000-8000-000000000001', 'Inbox Programme');
insert into public.programme_modules (programme_id, module, enabled, config) values
  ('ae100000-0000-4000-8000-000000000001', 'triads', true, '{"required": true, "required_units": 1}');
insert into public.cohorts (id, name, programme_id, start_date, end_date) values
  ('ae200000-0000-4000-8000-000000000001', 'Inbox Cohort', 'ae100000-0000-4000-8000-000000000001',
   public.programme_today() - 30, public.programme_today() + 200);
update public.cohort_requirement_dates set due_on = public.programme_today() + 5, is_overridden = true,
  generation_method = 'manual', materialized_via = 'admin_save'
 where cohort_id = 'ae200000-0000-4000-8000-000000000001';
insert into public.programme_enrollments (id, programme_id, user_id, cohort_id, status, start_date, end_date) values
  ('ae300000-0000-4000-8000-000000000001', 'ae100000-0000-4000-8000-000000000001', 'ae000000-0000-4000-8000-000000000001',
   'ae200000-0000-4000-8000-000000000001', 'active', public.programme_today() - 30, public.programme_today() + 200);

create temporary table ids (name text primary key, id uuid);
insert into ids select 'triad1', d.id from public.cohort_requirement_dates d
 where d.cohort_id = 'ae200000-0000-4000-8000-000000000001' and d.module = 'triads';
grant all on ids to authenticated;

insert into public.triad_groups (id, cohort_requirement_date_id, is_active)
values ('ae600000-0000-4000-8000-000000000001', (select id from ids where name = 'triad1'), true);
insert into public.triad_group_members (triad_group_id, enrollment_id, member_order)
values ('ae600000-0000-4000-8000-000000000001', 'ae300000-0000-4000-8000-000000000001', 1);
insert into public.triad_sessions (id, triad_group_id, scheduled_start_time, status)
values ('ae600000-0000-4000-8000-000000000002', 'ae600000-0000-4000-8000-000000000001', now() - interval '1 day', 'completed');
insert into public.triad_reflections (id, triad_session_id, enrollment_id, satisfaction_rating)
values ('ae600000-0000-4000-8000-000000000003', 'ae600000-0000-4000-8000-000000000002', 'ae300000-0000-4000-8000-000000000001', 4);
insert into public.triad_reflection_questions (id, programme_id, question_key, section, label, label_vi, display_order, is_active)
values ('ae600000-0000-4000-8000-000000000004', 'ae100000-0000-4000-8000-000000000001', 'ae_learned_coach', 'coach',
        'What did you learn as Coach?', 'Bạn học được gì khi là Coach?', 1, true);
insert into public.triad_reflection_answers (triad_reflection_id, question_id, answer_text)
values ('ae600000-0000-4000-8000-000000000003', 'ae600000-0000-4000-8000-000000000004', 'Ask, then listen.');

select set_config('request.jwt.claims', json_build_object('sub', 'ae000000-0000-4000-8000-000000000004')::text, true);
select public.admin_set_cohort_assessor('ae200000-0000-4000-8000-000000000001', 'ae000000-0000-4000-8000-000000000002');

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'ae000000-0000-4000-8000-000000000001')::text, true);
select public.learner_submit_assessment('ae400000-0000-4000-8000-000000000001', 'ae300000-0000-4000-8000-000000000001',
  (select id from ids where name = 'triad1'), 'triad', 'ae600000-0000-4000-8000-000000000003');
select set_config('request.jwt.claims', json_build_object('sub', 'ae000000-0000-4000-8000-000000000004')::text, true);
select public.admin_assign_assessor(array['ae400000-0000-4000-8000-000000000001']::uuid[], 'ae000000-0000-4000-8000-000000000002');

-- 1-3. The active assessor reads the enrollment (for the PDF path) and the reflection answers.
select set_config('request.jwt.claims', json_build_object('sub', 'ae000000-0000-4000-8000-000000000002')::text, true);
select is((select enrollment_id from public.coach_assessment_inbox()), 'ae300000-0000-4000-8000-000000000001'::uuid,
  '1. the inbox carries the submission''s enrollment');
select is((select reflection->'answers'->0->>'answer' from public.coach_assessment_inbox()), 'Ask, then listen.',
  '2. the active assessor reads the reflection answers through the inbox');
select ok((select not (reflection ? 'satisfaction_rating') from public.coach_assessment_inbox()),
  '3. ... the written answers only, not the satisfaction rating');
select set_config('request.jwt.claims', json_build_object('sub', 'ae000000-0000-4000-8000-000000000003')::text, true);
select is((select count(*)::int from public.coach_assessment_inbox()), 0, '4. another coach sees nothing');

-- Review, approve.
select set_config('request.jwt.claims', json_build_object('sub', 'ae000000-0000-4000-8000-000000000002')::text, true);
select public.coach_submit_review('ae400000-0000-4000-8000-000000000001', 'A clear question opened the session.');
select set_config('request.jwt.claims', json_build_object('sub', 'ae000000-0000-4000-8000-000000000004')::text, true);
select public.admin_validate_review((select review_id from public.admin_assessment_queue()
  where submission_id = 'ae400000-0000-4000-8000-000000000001'), 'approved');

-- 5. Released: history only, no learner content.
select set_config('request.jwt.claims', json_build_object('sub', 'ae000000-0000-4000-8000-000000000002')::text, true);
select results_eq($$select inbox_tab, reflection is null, released_at is not null from public.coach_assessment_inbox()$$,
  $$values ('released'::text, true, true)$$, '5. once released the assessor keeps the history, not the answers');

reset role;
-- 6-7. The notification opens the learner's own journey page.
select is((select link from public.notifications where user_id = 'ae000000-0000-4000-8000-000000000001'
            and notification_type = 'assessment_feedback_released'),
  '/coachee/journey#feedback-results', '6. a learner''s release notification opens My Journey -> Feedback & results');
select is(public.assessment_feedback_link_internal('ae000000-0000-4000-8000-000000000005'),
  '/coach/my-journey#feedback-results', '7. a Coach-learner''s opens their own journey page');

-- 8-10. The release email is claimed once.
set local role service_role;
select results_eq($$select email, preferred_language, kind, requirement_ordinal
                      from public.assessment_claim_release_email_internal('ae400000-0000-4000-8000-000000000001')$$,
  $$values ('ainbox-1@example.test'::text, 'vi'::text, 'triad'::text, 1)$$,
  '8. the first claim returns the recipient, language and Triad');
select is((select count(*)::int from public.assessment_claim_release_email_internal('ae400000-0000-4000-8000-000000000001')),
  0, '9. a second claim returns nothing: one email per release');
reset role;
select ok((select release_emailed_at is not null from public.assessment_submissions where id = 'ae400000-0000-4000-8000-000000000001'),
  '10. the claim is stamped from the server clock');

select ok(
  not has_function_privilege('authenticated', 'public.assessment_claim_release_email_internal(uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.assessment_feedback_link_internal(uuid)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.coach_assessment_inbox()', 'EXECUTE'),
  '11. the email claim and link helper are not client-callable; the inbox is');
select * from finish();
rollback;
