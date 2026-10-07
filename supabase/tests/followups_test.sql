-- Follow-ups from Prompts 11-14 (20261007001000_followups; Prompt 15 Part A).
--
--   1. book_peer_session needs a slot: coach-pool practice is booked into one
--      of the peer Coach's Peer slots.
--   2. A learner cannot delete their Final Assessment quiz row.
--   3. An automatic attempt-2 assignment is recorded as such
--      (assignment_source = 'auto_resubmit', assigned_by NULL); see
--      assessment_review_fixes_test.sql for the flow itself.
--   4. No public table grants TRUNCATE to anon or authenticated.
begin;
select plan(9);

-- 01 Coach K (Peer opt-in)   02 learner D (coach-to-coach Peer, Final Assessment)
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_user_meta_data, created_at, updated_at, confirmation_token, email_change_token_new, recovery_token)
select ('e5f00000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid,
  '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated',
  'followup-' || n || '@example.test', 'test', now(),
  jsonb_build_object('full_name', 'Followup Person ' || n), now(), now(), '', '', ''
from generate_series(1, 2) n;
insert into public.user_roles (user_id, role) values
  ('e5f00000-0000-4000-8000-000000000001', 'coach'), ('e5f00000-0000-4000-8000-000000000002', 'coachee')
on conflict do nothing;
update public.profiles set status = 'active'::public.user_status, peer_coaching_opt_in = true where id::text like 'e5f00000-%';
insert into public.coach_profiles (id, approval_status, peer_coaching_opt_in)
values ('e5f00000-0000-4000-8000-000000000001', 'active', true)
on conflict (id) do update set approval_status = 'active', peer_coaching_opt_in = true;

insert into public.programmes (id, name) values ('e5f10000-0000-4000-8000-000000000001', 'Followup coach-to-coach Programme');
insert into public.programme_modules (programme_id, module, enabled, config) values
  ('e5f10000-0000-4000-8000-000000000001', 'peer_coaching', true, '{"monthly_limit": 9}');
insert into public.programme_enrollments (id, programme_id, user_id, cohort_id, status, start_date, end_date) values
  ('e5f30000-0000-4000-8000-000000000002', 'e5f10000-0000-4000-8000-000000000001', 'e5f00000-0000-4000-8000-000000000002',
   null, 'active', public.programme_today() - 30, null);
insert into public.coachee_goals (coachee_id, enrollment_id, title)
values ('e5f00000-0000-4000-8000-000000000002', 'e5f30000-0000-4000-8000-000000000002', 'Followup goal');
insert into public.coach_availability (id, coach_id, slot_date, start_time, end_time, slot_type) values
  ('e5f50000-0000-4000-8000-000000000001', 'e5f00000-0000-4000-8000-000000000001', public.programme_today() + 5, '09:00', '11:00', 'peer');

-- ===========================================================================
-- 1. Coach-pool practice is booked into a slot
-- ===========================================================================
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'e5f00000-0000-4000-8000-000000000002')::text, true);
select throws_ok($$select public.book_peer_session('e5f00000-0000-4000-8000-000000000001', 'e5f30000-0000-4000-8000-000000000002',
  'No slot', now() + interval '3 days', 60, null)$$,
  '22023', 'Choose one of the Coach''s Peer slots', '1a. a coach-pool practice booking without a slot is refused');
select lives_ok($$select public.book_peer_session('e5f00000-0000-4000-8000-000000000001', 'e5f30000-0000-4000-8000-000000000002',
  'Practice', (public.programme_today() + 5 + time '09:30') at time zone public.availability_slot_time_zone('e5f00000-0000-4000-8000-000000000001'),
  60, 'e5f50000-0000-4000-8000-000000000001')$$, '1b. ... and with one of the Coach''s Peer slots it books');

-- ===========================================================================
-- 2. The Final Assessment quiz row cannot be deleted by the learner
-- ===========================================================================
reset role;
insert into public.assignments (id, final_assessment_programme_id, assignment_type, title, is_visible)
values ('e5f60000-0000-4000-8000-000000000001', 'e5f10000-0000-4000-8000-000000000001', 'quiz', 'Final quiz', true);
insert into public.assignment_submissions (id, assignment_id, user_id, enrollment_id, answers)
values ('e5f60000-0000-4000-8000-000000000011', 'e5f60000-0000-4000-8000-000000000001',
        'e5f00000-0000-4000-8000-000000000002', 'e5f30000-0000-4000-8000-000000000002', '{}');
-- No WHERE clause, so the read policy cannot hide the row: the DELETE policy
-- alone leaves the Final Assessment quiz out (and trg_prevent_quiz_resubmission
-- refuses deleting any quiz row behind it).
set local role authenticated;
delete from public.assignment_submissions;
reset role;
select is((select count(*)::int from public.assignment_submissions where id = 'e5f60000-0000-4000-8000-000000000011'),
  1, '2a. the learner''s DELETE leaves the Final Assessment quiz row in place (no retaking the quiz)');
select ok((select qual ~ 'assignment_is_final_assessment_quiz' from pg_policies
            where schemaname = 'public' and tablename = 'assignment_submissions' and policyname = 'Submissions: user delete own'),
  '2b. "Submissions: user delete own" leaves Final Assessment quiz rows out, like the read policy');

-- ===========================================================================
-- 3. The assignment's source
-- ===========================================================================
select is((select string_agg(column_name || ' ' || coalesce(column_default, '-') || ' ' || is_nullable, '; ' order by column_name)
             from information_schema.columns
            where table_schema = 'public' and table_name = 'assessment_assignments' and column_name in ('assignment_source', 'assigned_by')),
  'assigned_by - YES; assignment_source ''admin''::text NO',
  '3a. assignment_source defaults to admin; assigned_by may be NULL (an automatic assignment)');
select throws_ok($$insert into public.assessment_assignments (submission_id, assessor_id, assigned_by, due_on, assignment_source)
  values (gen_random_uuid(), 'e5f00000-0000-4000-8000-000000000001', null, current_date, 'admin')$$,
  '23514', null, '3b. an Admin assignment names its Admin');
select throws_ok($$insert into public.assessment_assignments (submission_id, assessor_id, assigned_by, due_on, assignment_source)
  values (gen_random_uuid(), 'e5f00000-0000-4000-8000-000000000001', null, current_date, 'by_magic')$$,
  '23514', null, '3c. the source is admin or auto_resubmit');

-- ===========================================================================
-- 4. TRUNCATE ignores RLS: no client role holds it on any public table
-- ===========================================================================
select is((select string_agg(c.relname || ':' || r.rolname, ', ' order by c.relname, r.rolname)
             from pg_class c join pg_namespace n on n.oid = c.relnamespace
             cross join (values ('anon'), ('authenticated')) r(rolname)
            where n.nspname = 'public' and c.relkind in ('r', 'p')
              and has_table_privilege(r.rolname, c.oid, 'TRUNCATE')),
  null, '4a. no public table grants TRUNCATE to anon or authenticated');
select ok(not exists (
  select 1 from pg_default_acl d join pg_namespace n on n.oid = d.defaclnamespace,
         aclexplode(d.defaclacl) a
  where n.nspname = 'public' and d.defaclobjtype = 'r' and a.privilege_type = 'TRUNCATE'
    and d.defaclrole = 'postgres'::regrole
    and a.grantee in ('anon'::regrole, 'authenticated'::regrole)),
  '4b. nor will a table a migration creates later: postgres''s default privileges grant no TRUNCATE to them');

select * from finish();
rollback;
