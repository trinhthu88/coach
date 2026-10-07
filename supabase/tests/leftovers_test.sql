-- Leftovers (20261007000900_leftovers; Prompt 14).
--
--   a. admin_update_coach_configuration no longer writes the retired
--      coach_as_coachee_allowlist.
--   t. canonical_training_learning_items dates completion in programme time.
--   p. The training-pdfs read policy is learner_training_week_open().
--   o. enrollment_is_ongoing() decides the booking checks, the Peer booking
--      rule, Admin alerts and the reminder targets.
begin;
select plan(19);
set local timezone = 'UTC';

-- 01 Admin   02 learner L (ongoing)   03 learner E (ended, still stored active)
-- 04 learner P (paused)   05 Coach K (Peer opt-in)   06 Coach J
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_user_meta_data, created_at, updated_at, confirmation_token, email_change_token_new, recovery_token)
select ('d4e00000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid,
  '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated',
  'leftover-' || n || '@example.test', 'test', now(),
  jsonb_build_object('full_name', 'Leftover Person ' || n), now(), now(), '', '', ''
from generate_series(1, 6) n;
insert into public.user_roles (user_id, role) values
  ('d4e00000-0000-4000-8000-000000000001', 'admin'), ('d4e00000-0000-4000-8000-000000000002', 'coachee'),
  ('d4e00000-0000-4000-8000-000000000003', 'coachee'), ('d4e00000-0000-4000-8000-000000000004', 'coachee'),
  ('d4e00000-0000-4000-8000-000000000005', 'coach'), ('d4e00000-0000-4000-8000-000000000006', 'coach')
on conflict do nothing;
update public.profiles set status = 'active'::public.user_status, peer_coaching_opt_in = true where id::text like 'd4e00000-%';
insert into public.coach_profiles (id, approval_status, peer_coaching_opt_in)
select c, 'active', true from unnest(array['d4e00000-0000-4000-8000-000000000005', 'd4e00000-0000-4000-8000-000000000006']::uuid[]) c
on conflict (id) do update set approval_status = 'active', peer_coaching_opt_in = true;

-- Programme T: one Training week (Skill Card only), one Coaching unit, coach-to-coach Peer practice.
insert into public.programmes (id, name) values ('d4e10000-0000-4000-8000-000000000001', 'Leftover Programme');
insert into public.training_weeks (id, programme_id, week_number, title, is_visible, skill_card_visible)
values ('d4e70000-0000-4000-8000-000000000001', 'd4e10000-0000-4000-8000-000000000001', 1, 'Week 1', true, true);
insert into public.programme_modules (programme_id, module, enabled, config) values
  ('d4e10000-0000-4000-8000-000000000001', 'coaching', true, '{"required": true, "required_units": 1}'),
  ('d4e10000-0000-4000-8000-000000000001', 'training', true,
   jsonb_build_object('required', true, 'required_units', 1, 'learning_components', jsonb_build_array('skill_cards'),
     'distribution_settings', jsonb_build_object('training_week_ids', jsonb_build_array('d4e70000-0000-4000-8000-000000000001')))),
  ('d4e10000-0000-4000-8000-000000000001', 'peer_coaching', true, '{"monthly_limit": 5}');
-- Cohort O is ongoing; cohort X ended ten days ago. Both Coaching units fell due five days before.
insert into public.cohorts (id, name, programme_id, start_date, end_date) values
  ('d4e20000-0000-4000-8000-000000000001', 'Leftover Ongoing', 'd4e10000-0000-4000-8000-000000000001',
   public.programme_today() - 30, public.programme_today() + 60),
  ('d4e20000-0000-4000-8000-000000000002', 'Leftover Ended', 'd4e10000-0000-4000-8000-000000000001',
   public.programme_today() - 120, public.programme_today() - 10);
update public.cohort_requirement_dates set due_on = case when cohort_id = 'd4e20000-0000-4000-8000-000000000001'
    then public.programme_today() - 5 else public.programme_today() - 15 end,
  is_overridden = true, generation_method = 'manual', materialized_via = 'admin_save'
 where cohort_id in ('d4e20000-0000-4000-8000-000000000001', 'd4e20000-0000-4000-8000-000000000002') and module = 'coaching';
insert into public.programme_enrollments (id, programme_id, user_id, cohort_id, status, start_date, end_date) values
  ('d4e30000-0000-4000-8000-000000000002', 'd4e10000-0000-4000-8000-000000000001', 'd4e00000-0000-4000-8000-000000000002',
   'd4e20000-0000-4000-8000-000000000001', 'active', public.programme_today() - 30, public.programme_today() + 60),
  ('d4e30000-0000-4000-8000-000000000003', 'd4e10000-0000-4000-8000-000000000001', 'd4e00000-0000-4000-8000-000000000003',
   'd4e20000-0000-4000-8000-000000000002', 'active', public.programme_today() - 120, public.programme_today() - 10),
  ('d4e30000-0000-4000-8000-000000000004', 'd4e10000-0000-4000-8000-000000000001', 'd4e00000-0000-4000-8000-000000000004',
   'd4e20000-0000-4000-8000-000000000001', 'paused', public.programme_today() - 30, public.programme_today() + 60);
insert into public.coachee_goals (coachee_id, enrollment_id, title)
select e.user_id, e.id, 'Leftover goal' from public.programme_enrollments e where e.id::text like 'd4e30000-%';

-- ===========================================================================
-- a. No allowlist writes from the Admin coach editor
-- ===========================================================================
insert into public.coach_as_coachee_allowlist (coach_user_id, selectable_coach_id)
values ('d4e00000-0000-4000-8000-000000000005', 'd4e00000-0000-4000-8000-000000000006');
select is((select count(*)::int from pg_proc where proname = 'admin_update_coach_configuration'
            and pg_get_function_arguments(oid) ~ 'p_selectable_coach_ids'),
  0, 'a1. admin_update_coach_configuration takes no allowlist argument');
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'd4e00000-0000-4000-8000-000000000001')::text, true);
select lives_ok($$select public.admin_update_coach_configuration('d4e00000-0000-4000-8000-000000000005', 'Coach K', 'active')$$,
  'a2. an Admin saves a Coach''s profile');
reset role;
select is((select count(*)::int from public.coach_as_coachee_allowlist where coach_user_id = 'd4e00000-0000-4000-8000-000000000005'),
  1, 'a3. ... and the retired allowlist row is neither rewritten nor removed');

-- ===========================================================================
-- t. Training completion is dated in programme time
-- ===========================================================================
-- L completes the Skill Card at 20:30 UTC three days ago: 03:30 the next day in Vietnam.
insert into public.training_progress (user_id, enrollment_id, training_week_id, viewed_at, completed_at)
values ('d4e00000-0000-4000-8000-000000000002', 'd4e30000-0000-4000-8000-000000000002', 'd4e70000-0000-4000-8000-000000000001',
        ((public.programme_today() - 3)::timestamp + time '20:00') at time zone 'UTC',
        ((public.programme_today() - 3)::timestamp + time '20:30') at time zone 'UTC');
select is((select completed_on from public.canonical_training_learning_items('d4e30000-0000-4000-8000-000000000002')),
  public.programme_today() - 2, 't1. the week is completed on its Vietnam date, not the UTC one');

-- ===========================================================================
-- p. training-pdfs: readable while the learner's week is open
-- ===========================================================================
select ok((select qual ~ 'learner_training_week_open' and qual !~* 'CURRENT_DATE|unlock_date' from pg_policies
            where schemaname = 'storage' and tablename = 'objects' and policyname = 'Training PDFs: enrolled users read'),
  'p1. the read policy is learner_training_week_open(), not a stored unlock date');
insert into storage.objects (bucket_id, name, owner_id, metadata) values
  ('training-pdfs', 'd4e70000-0000-4000-8000-000000000001/week1.pdf', 'd4e00000-0000-4000-8000-000000000001', '{"mimetype": "application/pdf", "size": 100}'),
  ('training-pdfs', 'not-a-week/handbook.pdf', 'd4e00000-0000-4000-8000-000000000001', '{"mimetype": "application/pdf", "size": 100}');
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'd4e00000-0000-4000-8000-000000000002')::text, true);
select is((select count(*)::int from storage.objects where bucket_id = 'training-pdfs' and name like 'd4e70000-%'),
  1, 'p2. the ongoing learner reads their open week''s PDF');
select is((select count(*)::int from storage.objects where bucket_id = 'training-pdfs' and name like 'not-a-week/%'),
  0, 'p3. a path that is not a week is simply not readable (no cast error)');
select set_config('request.jwt.claims', json_build_object('sub', 'd4e00000-0000-4000-8000-000000000003')::text, true);
select is((select count(*)::int from storage.objects where bucket_id = 'training-pdfs' and name like 'd4e70000-%'),
  0, 'p4. a learner whose enrollment has ended does not, though it is still stored active');

-- ===========================================================================
-- o. enrollment_is_ongoing() decides
-- ===========================================================================
reset role;
select ok(not exists (
  select 1 from unnest(array['can_book_session(uuid,uuid)', 'can_book_session(uuid,uuid,uuid)', 'can_book_peer_session(uuid,uuid)',
                             'coachee_peer_booking_allowed_internal(uuid,uuid)', 'can_book_mentoring_session_reason(uuid,uuid,uuid)',
                             'assert_peer_session_bookable_internal(uuid,uuid,uuid,uuid,timestamptz)',
                             'training_overdue_assignment_targets_internal(date)', 'daily_prompt_targets_internal(date)',
                             'triad_reminder_targets_internal(date,uuid)', 'admin_alerts_current()']) f
  where pg_get_functiondef(('public.' || f)::regprocedure) !~ 'enrollment_is_ongoing'
     or pg_get_functiondef(('public.' || f)::regprocedure) ~ '''at_risk''::public\.enrollment_status'),
  'o1. every booking check, the Peer rule, the alerts and the reminder targets use enrollment_is_ongoing() and list no statuses');

-- Coach-to-coach Peer practice: E's enrollment is stored active but has ended.
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'd4e00000-0000-4000-8000-000000000002')::text, true);
select is(public.can_book_peer_session('d4e00000-0000-4000-8000-000000000005', 'd4e30000-0000-4000-8000-000000000002'),
  true, 'o2. the ongoing learner may book Peer practice (within the monthly cap)');
select set_config('request.jwt.claims', json_build_object('sub', 'd4e00000-0000-4000-8000-000000000003')::text, true);
select is(public.can_book_peer_session('d4e00000-0000-4000-8000-000000000005', 'd4e30000-0000-4000-8000-000000000003'),
  false, 'o3. an ended enrollment cannot book, though its stored status is active');
select throws_ok($$select public.book_peer_session('d4e00000-0000-4000-8000-000000000005', 'd4e30000-0000-4000-8000-000000000003',
  'Late', now() + interval '2 days', 30, null)$$, '42501', null, 'o4. ... and the booking itself is refused');
select set_config('request.jwt.claims', json_build_object('sub', 'd4e00000-0000-4000-8000-000000000004')::text, true);
select is(public.can_book_peer_session('d4e00000-0000-4000-8000-000000000005', 'd4e30000-0000-4000-8000-000000000004'),
  false, 'o5. a paused enrollment cannot book');
select is(public.can_book_session('d4e00000-0000-4000-8000-000000000004', 'd4e00000-0000-4000-8000-000000000005',
  'd4e30000-0000-4000-8000-000000000004'), false, 'o6. ... nor book Coaching');

-- Alerts: the ongoing learner's overdue Coaching raises Needs attention; the
-- paused learner's does not; the ended learner is still Programme at risk.
select set_config('request.jwt.claims', json_build_object('sub', 'd4e00000-0000-4000-8000-000000000001')::text, true);
select ok(exists (select 1 from public.admin_alerts_current()
                  where alert_type = 'needs_attention' and related_enrollment_id = 'd4e30000-0000-4000-8000-000000000002'),
  'o7. an ongoing learner''s overdue unit is an alert');
select ok(not exists (select 1 from public.admin_alerts_current()
                      where related_enrollment_id = 'd4e30000-0000-4000-8000-000000000004'),
  'o8. a paused learner raises no alert');
select ok(exists (select 1 from public.admin_alerts_current()
                  where alert_type = 'programme_at_risk' and related_enrollment_id = 'd4e30000-0000-4000-8000-000000000003'),
  'o9. an enrollment that ended incomplete is still Programme at risk');
reset role;

-- Reminder targets.
select is((select count(*)::int from public.daily_prompt_targets_internal(public.programme_today())
            where enrollment_id in ('d4e30000-0000-4000-8000-000000000003', 'd4e30000-0000-4000-8000-000000000004')),
  0, 'o10. no daily prompt to an ended or paused enrollment');
select is((select count(*)::int from public.training_overdue_assignment_targets_internal(public.programme_today())
            where enrollment_id in ('d4e30000-0000-4000-8000-000000000003', 'd4e30000-0000-4000-8000-000000000004')),
  0, 'o11. no overdue-training reminder to an ended or paused enrollment');

select * from finish();
rollback;
