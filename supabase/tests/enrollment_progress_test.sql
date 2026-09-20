begin;

select plan(17);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_user_meta_data, created_at, updated_at, confirmation_token,
  email_change_token_new, recovery_token
)
values
  ('a1000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'schedule-learner@example.test', 'test', now(), '{"full_name":"Schedule Learner"}', now(), now(), '', '', ''),
  ('a2000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'schedule-partner@example.test', 'test', now(), '{"full_name":"Schedule Partner"}', now(), now(), '', '', ''),
  ('a3000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'schedule-provider@example.test', 'test', now(), '{"full_name":"Schedule Provider"}', now(), now(), '', '', ''),
  ('a4000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'schedule-outsider@example.test', 'test', now(), '{"full_name":"Schedule Outsider"}', now(), now(), '', '', '');

insert into public.organizations (id, name)
values ('b1000000-0000-0000-0000-000000000001', 'Schedule test organization');

insert into public.user_roles (user_id, role)
values ('a3000000-0000-0000-0000-000000000003', 'coach');

insert into public.coach_profiles (id, approval_status, peer_coaching_opt_in)
values ('a3000000-0000-0000-0000-000000000003', 'active', true);
-- Willing AND usable: Peer eligibility requires a usable account
-- (RULES.md §1), and the signup trigger leaves profiles at pending_approval.
update public.profiles
set peer_coaching_opt_in = true, status = 'active'::public.user_status
where id = 'a2000000-0000-0000-0000-000000000002';

insert into public.programmes (id, name, duration_months)
values ('c1000000-0000-0000-0000-000000000001', 'Schedule progress test programme', 3);

insert into public.cohorts (id, name, programme_id, organization_id, start_date, end_date)
values (
  'd1000000-0000-0000-0000-000000000001',
  'Schedule progress test cohort',
  'c1000000-0000-0000-0000-000000000001',
  'b1000000-0000-0000-0000-000000000001',
  date '2026-01-01',
  date '2026-04-01'
);

insert into public.programme_enrollments (
  id, user_id, programme_id, cohort_id, organization_id, start_date, end_date, status
)
values
  ('e1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000001', date '2026-01-01', date '2026-04-01', 'active'),
  ('e2000000-0000-0000-0000-000000000002', 'a2000000-0000-0000-0000-000000000002', 'c1000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000001', date '2026-01-01', date '2026-04-01', 'active');

insert into public.training_weeks (id, programme_id, week_number, title, is_visible)
values
  ('f1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001', 1, 'Test week one', true),
  ('f1000000-0000-0000-0000-000000000002', 'c1000000-0000-0000-0000-000000000001', 2, 'Test week two', true);

insert into public.cohort_week_overrides (cohort_id, training_week_id, unlock_date)
values
  ('d1000000-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-000000000001', date '2026-01-10'),
  ('d1000000-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-000000000002', date '2026-02-10');

insert into public.programme_modules (programme_id, module, enabled, config)
values
  ('c1000000-0000-0000-0000-000000000001', 'coaching', true, '{"required":true,"required_units":3,"receive_limit":3}'),
  ('c1000000-0000-0000-0000-000000000001', 'peer_coaching', true, '{"required":true,"required_units":3,"receive_limit":3,"monthly_limit":3}'),
  ('c1000000-0000-0000-0000-000000000001', 'mentoring', true, '{"required":true,"required_units":3,"receive_limit":3}'),
  ('c1000000-0000-0000-0000-000000000001', 'triads', true, '{"required":true,"required_units":3,"max_triads":3}'),
  ('c1000000-0000-0000-0000-000000000001', 'training', true, jsonb_build_object('required', true, 'required_units', 2, 'distribution_settings', jsonb_build_object('training_week_ids', jsonb_build_array('f1000000-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-000000000002')))),
  ('c1000000-0000-0000-0000-000000000001', 'quiz', true, '{"required":true,"required_units":2}'),
  ('c1000000-0000-0000-0000-000000000001', 'daily_prompt', true, '{"required":true,"required_units":2}'),
  ('c1000000-0000-0000-0000-000000000001', 'assessment', true, '{"required":true,"required_units":2}');

insert into public.coachee_coach_allowlist(coachee_id, coach_id)
values ('a1000000-0000-0000-0000-000000000001','a3000000-0000-0000-0000-000000000003');
insert into public.mentor_profiles(coach_user_id,is_active,bio)
values ('a3000000-0000-0000-0000-000000000003',true,'Schedule test mentor');
insert into public.mentoring_allowlist(mentee_user_id,mentor_user_id)
values ('a1000000-0000-0000-0000-000000000001','a3000000-0000-0000-0000-000000000003');

select public.generate_enrollment_schedule('e1000000-0000-0000-0000-000000000001');

select is(
  (select count(*)::integer from public.enrollment_module_snapshots where enrollment_id = 'e1000000-0000-0000-0000-000000000001'),
  8,
  'generation snapshots every enabled module'
);

-- Every requirement module: one milestone per required unit, all on the
-- cohort-module completion deadline. No module has a cadence of its own.
select results_eq(
  $$select s.module::text, count(*)::int, count(distinct m.due_on)::int, max(m.due_on), sum(m.required_units)::int
      from public.enrollment_module_snapshots s
      join public.enrollment_module_milestones m on m.enrollment_module_snapshot_id = s.id
     where s.enrollment_id = 'e1000000-0000-0000-0000-000000000001'
       and s.module in ('coaching', 'peer_coaching', 'mentoring', 'triads')
     group by s.module::text order by s.module::text$$,
  $$values
      ('coaching'::text, 3, 1, date '2026-04-01', 3),
      ('mentoring'::text, 3, 1, date '2026-04-01', 3),
      ('peer_coaching'::text, 3, 1, date '2026-04-01', 3),
      ('triads'::text, 3, 1, date '2026-04-01', 3)$$,
  'every scheduled module places its required units on the one cohort deadline'
);

-- The rule is the same for quiz, daily prompt and assessment: a required
-- module is a required module, whatever kind of activity fulfils it.
select results_eq(
  $$select s.module::text, count(*)::int, max(m.due_on), sum(m.required_units)::int
      from public.enrollment_module_snapshots s
      join public.enrollment_module_milestones m on m.enrollment_module_snapshot_id = s.id
     where s.enrollment_id = 'e1000000-0000-0000-0000-000000000001'
       and s.module in ('quiz', 'daily_prompt', 'assessment')
     group by s.module::text order by s.module::text$$,
  $$values
      ('assessment'::text, 2, date '2026-04-01', 2),
      ('daily_prompt'::text, 2, date '2026-04-01', 2),
      ('quiz'::text, 2, date '2026-04-01', 2)$$,
  'quiz, daily prompt and assessment follow the same one-deadline rule'
);

select results_eq(
  $$select m.due_on, m.training_week_id, m.required_units
      from public.enrollment_module_milestones m
      join public.enrollment_module_snapshots s on s.id = m.enrollment_module_snapshot_id
     where s.enrollment_id = 'e1000000-0000-0000-0000-000000000001' and s.module = 'training'
     order by m.sequence$$,
  $$values
      (date '2026-01-10', 'f1000000-0000-0000-0000-000000000001'::uuid, 1),
      (date '2026-02-10', 'f1000000-0000-0000-0000-000000000002'::uuid, 1)$$,
  'training-linked distribution uses cohort overrides and preserves selected units'
);

create temporary table schedule_snapshot_before as
select s.id, s.module, s.required, s.required_units,
       s.distribution_settings, s.weight, s.starts_on, s.ends_on
from public.enrollment_module_snapshots s
where s.enrollment_id = 'e1000000-0000-0000-0000-000000000001';

create temporary table schedule_milestone_before as
select m.id, m.enrollment_module_snapshot_id, m.sequence, m.due_on,
       m.window_end_on, m.training_week_id, m.required_units
from public.enrollment_module_milestones m
join public.enrollment_module_snapshots s on s.id = m.enrollment_module_snapshot_id
where s.enrollment_id = 'e1000000-0000-0000-0000-000000000001';

update public.programme_modules
set config = jsonb_set(config, '{required_units}', '99'::jsonb)
where programme_id = 'c1000000-0000-0000-0000-000000000001' and module = 'coaching';

select public.generate_enrollment_schedule('e1000000-0000-0000-0000-000000000001');

select results_eq(
  $$select id, module, required, required_units, distribution_settings, weight, starts_on, ends_on
      from public.enrollment_module_snapshots
     where enrollment_id = 'e1000000-0000-0000-0000-000000000001'
     order by module$$,
  $$select id, module, required, required_units, distribution_settings, weight, starts_on, ends_on
      from schedule_snapshot_before
     order by module$$,
  'repeated generation leaves existing enrollment snapshots unchanged'
);

select results_eq(
  $$select m.id, m.enrollment_module_snapshot_id, m.sequence, m.due_on, m.window_end_on, m.training_week_id, m.required_units
      from public.enrollment_module_milestones m
      join public.enrollment_module_snapshots s on s.id = m.enrollment_module_snapshot_id
     where s.enrollment_id = 'e1000000-0000-0000-0000-000000000001'
     order by m.enrollment_module_snapshot_id, m.sequence$$,
  $$select id, enrollment_module_snapshot_id, sequence, due_on, window_end_on, training_week_id, required_units
      from schedule_milestone_before
     order by enrollment_module_snapshot_id, sequence$$,
  'repeated generation leaves existing enrollment milestone identities unchanged'
);

-- What is still refused. The scheduling policies are gone, so what is left is
-- the module CONFIG contradicting itself -- caught where it is written when it
-- can be, and by the snapshot engine otherwise.
insert into public.programmes (id, name)
values
  ('c2000000-0000-0000-0000-000000000001', 'Non-object settings programme'),
  ('c2000000-0000-0000-0000-000000000002', 'Negative weight programme');

insert into public.cohorts (id, name, programme_id, start_date, end_date)
select ('d2000000-0000-0000-0000-00000000000' || n)::uuid,
       'Invalid schedule cohort ' || n,
       ('c2000000-0000-0000-0000-00000000000' || n)::uuid,
       date '2026-01-01', date '2026-04-01'
from generate_series(1, 2) as n;

insert into public.programme_enrollments (id, user_id, programme_id, cohort_id, start_date, end_date, status)
select ('e3000000-0000-0000-0000-00000000000' || n)::uuid,
       'a1000000-0000-0000-0000-000000000001'::uuid,
       ('c2000000-0000-0000-0000-00000000000' || n)::uuid,
       ('d2000000-0000-0000-0000-00000000000' || n)::uuid,
       date '2026-01-01', date '2026-04-01', 'completed'
from generate_series(1, 2) as n;

insert into public.programme_modules (programme_id, module, config)
values
  ('c2000000-0000-0000-0000-000000000001', 'coaching', '{"required":true,"required_units":1,"distribution_settings":[]}'),
  ('c2000000-0000-0000-0000-000000000002', 'coaching', '{"required":true,"required_units":1,"weight":-5}');

select throws_ok(
  $$insert into public.programme_modules (programme_id, module, config)
    values ('c2000000-0000-0000-0000-000000000001', 'mentoring', '{"required":true,"required_units":0}')$$,
  '22023',
  'Required modules must have at least one required unit',
  'a module cannot be required and require nothing'
);

select throws_ok(
  $$insert into public.programme_modules (programme_id, module, config)
    values ('c2000000-0000-0000-0000-000000000001', 'triads', '{"required":false,"required_units":-1}')$$,
  '22023',
  'required_units must be a non-negative integer',
  'required_units cannot be negative'
);

select throws_ok(
  $$select public.generate_enrollment_schedule('e3000000-0000-0000-0000-000000000001')$$,
  'P0001',
  'Module distribution_settings must be a JSON object',
  'module settings must be an object'
);

select throws_ok(
  $$select public.generate_enrollment_schedule('e3000000-0000-0000-0000-000000000002')$$,
  'P0001',
  'Module weight must be nonnegative',
  'module weight cannot be negative'
);

select set_config('request.jwt.claim.sub', 'a1000000-0000-0000-0000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

-- Programme Mentoring eligibility is the COHORT mentor pool
-- (20260920200000_cohort_mentors); mentoring_allowlist is only the historical
-- pairing and no longer grants programme Mentoring.
insert into public.cohort_mentors (cohort_id, mentor_user_id)
select distinct e.cohort_id, a.mentor_user_id
from public.mentoring_allowlist a
join public.programme_enrollments e on e.user_id = a.mentee_user_id
where e.cohort_id is not null
on conflict (cohort_id, mentor_user_id) do nothing;

-- Programme Coaching eligibility is the COHORT Coach pool
-- (20260920100000_cohort_coach_assignments); coachee_coach_allowlist above is
-- only the historical pairing and no longer grants programme Coaching. This
-- mirrors that migration's own backfill: every (cohort, coach) pair the
-- fixture already declares becomes an assignment.
insert into public.cohort_coach_assignments (cohort_id, coach_id)
select distinct e.cohort_id, a.coach_id
from public.coachee_coach_allowlist a
join public.programme_enrollments e on e.user_id = a.coachee_id
where e.cohort_id is not null
on conflict (cohort_id, coach_id) do nothing;

insert into public.sessions (coach_id, coachee_id, topic, start_time, duration_minutes, status, enrollment_id)
values
  ('a3000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-000000000001', 'Past completed coaching', '2026-01-20 10:00:00+00', 60, 'completed', 'e1000000-0000-0000-0000-000000000001'),
  ('a3000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-000000000001', 'Future completed coaching', '2026-03-20 10:00:00+00', 60, 'completed', 'e1000000-0000-0000-0000-000000000001'),
  ('a3000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-000000000001', 'Booked coaching', '2026-03-01 10:00:00+00', 60, 'confirmed', 'e1000000-0000-0000-0000-000000000001');

insert into public.peer_sessions (peer_coach_id, peer_coachee_id, topic, start_time, duration_minutes, status, enrollment_id)
values ('a3000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-000000000001', 'Past peer session', '2026-01-21 10:00:00+00', 60, 'completed', 'e1000000-0000-0000-0000-000000000001');

insert into public.coachee_peer_sessions (peer_provider_id, peer_receiver_id, topic, start_time, duration_minutes, status, enrollment_id)
values ('a2000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000001', 'Future peer session', '2026-03-21 10:00:00+00', 60, 'completed', 'e1000000-0000-0000-0000-000000000001');

insert into public.mentoring_sessions (mentor_id, mentee_id, topic, start_time, duration_minutes, status, prep_file_path, enrollment_id)
values
  ('a3000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-000000000001', 'Past mentoring', '2026-01-22 10:00:00+00', 60, 'completed', 'test/past.pdf', 'e1000000-0000-0000-0000-000000000001'),
  ('a3000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-000000000001', 'Future mentoring', '2026-03-22 10:00:00+00', 60, 'completed', 'test/future.pdf', 'e1000000-0000-0000-0000-000000000001');

-- A dyad for Triad 1 and a dyad for Triad 2 (every required Triad has its
-- own group assignment); each completed session fulfils its own Triad for
-- both member enrollments.
insert into public.triad_groups (id, cohort_requirement_date_id)
select g.id, d.id
from (values ('a5000000-0000-0000-0000-000000000001'::uuid, 1), ('a5000000-0000-0000-0000-000000000002'::uuid, 2)) g(id, ordinal)
join public.cohort_requirement_dates d on d.cohort_id = 'd1000000-0000-0000-0000-000000000001'
  and d.programme_id = 'c1000000-0000-0000-0000-000000000001' and d.module = 'triads' and d.ordinal = g.ordinal;

insert into public.triad_group_members (triad_group_id, enrollment_id, member_order)
values
  ('a5000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001', 1),
  ('a5000000-0000-0000-0000-000000000001', 'e2000000-0000-0000-0000-000000000002', 2),
  ('a5000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000001', 1),
  ('a5000000-0000-0000-0000-000000000002', 'e2000000-0000-0000-0000-000000000002', 2);

insert into public.triad_sessions (triad_group_id, scheduled_start_time, scheduled_end_time, status)
values
  ('a5000000-0000-0000-0000-000000000001', '2026-01-23 10:00:00+00', '2026-01-23 11:00:00+00', 'completed'),
  ('a5000000-0000-0000-0000-000000000002', '2026-03-23 10:00:00+00', '2026-03-23 11:00:00+00', 'completed');

insert into public.training_progress (user_id, training_week_id, completed_at, enrollment_id)
values
  ('a1000000-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-000000000001', '2026-01-24 10:00:00+00', 'e1000000-0000-0000-0000-000000000001'),
  ('a1000000-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-000000000002', '2026-03-24 10:00:00+00', 'e1000000-0000-0000-0000-000000000001');

insert into public.assignments (id, training_week_id, title, assignment_type, is_visible)
values
  ('a6000000-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-000000000001', 'Past zero-score quiz', 'quiz', true),
  ('a6000000-0000-0000-0000-000000000002', 'f1000000-0000-0000-0000-000000000002', 'Future zero-score quiz', 'quiz', true);

insert into public.assignment_submissions (assignment_id, user_id, answers, submitted_at, enrollment_id)
values
  ('a6000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', '{}', '2026-01-25 10:00:00+00', 'e1000000-0000-0000-0000-000000000001'),
  ('a6000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000001', '{}', '2026-03-25 10:00:00+00', 'e1000000-0000-0000-0000-000000000001');

insert into public.daily_prompts (id, training_week_id, day_offset, prompt_text, is_visible, sort_order)
values
  ('a7000000-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-000000000001', 1, 'Past prompt', true, 1),
  ('a7000000-0000-0000-0000-000000000002', 'f1000000-0000-0000-0000-000000000002', 1, 'Future prompt', true, 1);

insert into public.daily_prompt_responses (daily_prompt_id, user_id, response_text, responded_at, enrollment_id)
values
  ('a7000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 'Past response', '2026-01-26 10:00:00+00', 'e1000000-0000-0000-0000-000000000001'),
  ('a7000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000001', 'Future response', '2026-03-26 10:00:00+00', 'e1000000-0000-0000-0000-000000000001');

-- get_enrollment_progress is the HISTORICAL snapshot engine: it is no
-- longer client-callable (20260918170000_single_source_of_truth), so its
-- historical semantics are checked as the database owner.
select set_config('request.jwt.claim.sub', 'a1000000-0000-0000-0000-000000000001', true);

select results_eq(
  $$select module::text, completed_units
      from public.get_enrollment_progress('e1000000-0000-0000-0000-000000000001', date '2026-02-01')
     order by module::text$$,
  $$values
      ('assessment'::text, 0), ('coaching'::text, 1), ('daily_prompt'::text, 1),
      ('mentoring'::text, 1), ('peer_coaching'::text, 1), ('quiz'::text, 1),
      ('training'::text, 1), ('triads'::text, 1)$$,
  'historical progress counts only activity completed by the as-of date'
);

select results_eq(
  $$select module::text, completed_units
      from public.get_enrollment_progress('e1000000-0000-0000-0000-000000000001', date '2026-04-01')
     order by module::text$$,
  $$values
      ('assessment'::text, 0), ('coaching'::text, 2), ('daily_prompt'::text, 2),
      ('mentoring'::text, 2), ('peer_coaching'::text, 2), ('quiz'::text, 2),
      ('training'::text, 2), ('triads'::text, 2)$$,
  'progress uses session dates, training completion, quiz submission, prompt response, and scheduled triad dates'
);

select is(
  (select booked_units from public.get_enrollment_progress('e1000000-0000-0000-0000-000000000001', date '2026-02-01') where module = 'coaching'),
  1,
  'booked session units remain distinct from completed units'
);

select isnt(
  (select pace_status from public.get_enrollment_progress('e1000000-0000-0000-0000-000000000001', date '2026-02-01') where module = 'quiz'),
  'completed',
  'future quiz submissions do not complete a module historically'
);

select is(
  (select pace_status from public.get_enrollment_progress('e1000000-0000-0000-0000-000000000001', date '2026-04-01') where module = 'quiz'),
  'completed',
  'a module becomes completed once all required activity has occurred'
);

select set_config('request.jwt.claim.sub', 'a4000000-0000-0000-0000-000000000004', true);
select is_empty(
  $$select * from public.get_enrollment_progress('e1000000-0000-0000-0000-000000000001', date '2026-04-01')$$,
  'an unrelated user cannot read enrollment progress'
);
set local role authenticated;
select throws_ok(
  $$select * from public.get_enrollment_progress('e1000000-0000-0000-0000-000000000001', date '2026-04-01')$$,
  '42501', null,
  'clients cannot call the historical snapshot engine at all'
);
reset role;

select * from finish();
rollback;
