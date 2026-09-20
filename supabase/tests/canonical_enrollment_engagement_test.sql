
-- Canonical goals/actions/programme-experience summary.
--
-- Proves Sponsor Leader Detail (sponsor_canonical_enrollment_metadata) and
-- the Learner Dashboard (learner_canonical_engagement) read ONE definition
-- (canonical_enrollment_engagement) and therefore agree for the same
-- enrollment, that archived goals / cancelled actions are excluded, and that
-- the learner can only ever read their own enrollment.
begin;

select plan(14);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_user_meta_data, created_at, updated_at, confirmation_token,
  email_change_token_new, recovery_token
)
select
  ('a8000000-0000-0000-0000-00000000000' || n)::uuid,
  '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated',
  'engagement-recon-' || n || '@example.test', 'test', now(),
  jsonb_build_object('full_name', 'Learner Engagement recon ' || n), now(), now(), '', '', ''
from generate_series(1, 5) as n
union all
select
  'a8000000-0000-0000-0000-000000000099'::uuid,
  '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated',
  'engagement-recon-sponsor@example.test', 'test', now(),
  '{"full_name":"Learner Engagement recon Sponsor"}'::jsonb, now(), now(), '', '', '';

insert into public.organizations (id, name)
values ('b8000000-0000-0000-0000-000000000001', 'Engagement recon organization');

insert into public.user_roles (user_id, role)
values
  ('a8000000-0000-0000-0000-000000000002', 'coach'),
  ('a8000000-0000-0000-0000-000000000099', 'sponsor');
insert into public.coach_profiles (id, approval_status, peer_coaching_opt_in)
values ('a8000000-0000-0000-0000-000000000002', 'active', false);
insert into public.sponsor_profiles (user_id, organization_id)
values ('a8000000-0000-0000-0000-000000000099', 'b8000000-0000-0000-0000-000000000001');

insert into public.programmes (id, name)
values ('c8000000-0000-0000-0000-000000000001', 'Engagement recon programme');

insert into public.cohorts (id, name, programme_id, organization_id, start_date, end_date)
values (
  'd8000000-0000-0000-0000-000000000001', 'Engagement recon cohort',
  'c8000000-0000-0000-0000-000000000001', 'b8000000-0000-0000-0000-000000000001',
  date '2026-01-05', date '2026-07-05'
);

insert into public.training_weeks (id, programme_id, week_number, title, is_visible)
values
  ('f8000000-0000-0000-0000-000000000001', 'c8000000-0000-0000-0000-000000000001', 1, 'Engagement recon week one', true),
  ('f8000000-0000-0000-0000-000000000002', 'c8000000-0000-0000-0000-000000000001', 2, 'Engagement recon week two', true);

insert into public.programme_modules (programme_id, module, enabled, config)
values
  ('c8000000-0000-0000-0000-000000000001', 'coaching', true, '{"required":true,"required_units":2,"receive_limit":2,"distribution_settings":{}}'),
  ('c8000000-0000-0000-0000-000000000001', 'training', true, jsonb_build_object('required', true, 'required_units', 2, 'distribution_settings', jsonb_build_object('training_week_ids', jsonb_build_array('f8000000-0000-0000-0000-000000000001', 'f8000000-0000-0000-0000-000000000002'))));

insert into public.programme_enrollments (id, user_id, programme_id, cohort_id, organization_id, start_date, end_date, status)
select
  ('e8000000-0000-0000-0000-00000000000' || n)::uuid,
  ('a8000000-0000-0000-0000-00000000000' || n)::uuid,
  'c8000000-0000-0000-0000-000000000001', 'd8000000-0000-0000-0000-000000000001',
  'b8000000-0000-0000-0000-000000000001', date '2026-01-05', date '2026-07-05', 'active'
from generate_series(1, 5) as n;

insert into public.coachee_coach_allowlist (coachee_id, coach_id)
values ('a8000000-0000-0000-0000-000000000001', 'a8000000-0000-0000-0000-000000000002');

-- One completed coaching session for learner 1 so completed_units differs
-- from zero and the two engines have something non-trivial to agree on.
select set_config('request.jwt.claim.sub', 'a8000000-0000-0000-0000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
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

set local role authenticated;



insert into public.sessions (coach_id, coachee_id, topic, start_time, duration_minutes, status, enrollment_id, coachee_rating)
values (
  'a8000000-0000-0000-0000-000000000002', 'a8000000-0000-0000-0000-000000000001',
  'Engagement recon coaching session', '2026-02-01T10:00:00Z', 60, 'completed',
  'e8000000-0000-0000-0000-000000000001', 4
);


-- Learner-owned goal/action/rating data (inserted as the learner, under RLS).
insert into public.coachee_goals (id, coachee_id, enrollment_id, title) values
  ('98000000-0000-0000-0000-000000000001', 'a8000000-0000-0000-0000-000000000001', 'e8000000-0000-0000-0000-000000000001', 'Private goal wording one'),
  ('98000000-0000-0000-0000-000000000002', 'a8000000-0000-0000-0000-000000000001', 'e8000000-0000-0000-0000-000000000001', 'Private goal wording two');
reset role;
insert into public.coachee_goal_ratings (coachee_id, enrollment_id, goal_id, start_rating, current_rating, target_rating) values
  ('a8000000-0000-0000-0000-000000000001', 'e8000000-0000-0000-0000-000000000001', '98000000-0000-0000-0000-000000000001', 20, 50, 80),
  ('a8000000-0000-0000-0000-000000000001', 'e8000000-0000-0000-0000-000000000001', '98000000-0000-0000-0000-000000000002', 10, 40, 60);
insert into public.enrollment_actions (enrollment_id, owner_user_id, goal_id, title, status) values
  ('e8000000-0000-0000-0000-000000000001', 'a8000000-0000-0000-0000-000000000001', '98000000-0000-0000-0000-000000000001', 'Done action', 'completed'),
  ('e8000000-0000-0000-0000-000000000001', 'a8000000-0000-0000-0000-000000000001', '98000000-0000-0000-0000-000000000001', 'Open action', 'open'),
  ('e8000000-0000-0000-0000-000000000001', 'a8000000-0000-0000-0000-000000000001', null, 'Cancelled action', 'cancelled');

-- Sponsor read first (5-enrollment cohort meets the k-anonymity threshold).
select set_config('request.jwt.claim.sub', 'a8000000-0000-0000-0000-000000000099', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;
create temporary table sponsor_engagement as
select goal_count, goal_setup, goal_progress_pct, open_action_count,
    completed_action_count, total_action_count, action_completion_pct,
    satisfaction_avg, satisfaction_rated_count
  from public.sponsor_canonical_enrollment_metadata(
    'd8000000-0000-0000-0000-000000000001', 'e8000000-0000-0000-0000-000000000001');

select is((select count(*)::integer from sponsor_engagement), 1, 'sponsor reads the enrollment metadata row');

select set_config('request.jwt.claim.sub', 'a8000000-0000-0000-0000-000000000001', true);
create temporary table learner_engagement as
select goal_count, goal_setup, goal_progress_pct, open_action_count,
    completed_action_count, total_action_count, action_completion_pct,
    satisfaction_avg, satisfaction_rated_count
  from public.learner_canonical_engagement('e8000000-0000-0000-0000-000000000001');

select results_eq(
  'select * from learner_engagement',
  'select * from sponsor_engagement',
  'learner engagement equals the sponsor metadata engagement for the same enrollment'
);
select is((select goal_progress_pct from learner_engagement), 55.0,
  'goal progress is the average of (current-start)/(target-start): (50% + 60%) / 2');
select is((select total_action_count from learner_engagement), 2, 'cancelled actions are excluded from the action total');
select is((select completed_action_count from learner_engagement), 1, 'completed actions are counted');
select is((select satisfaction_avg from learner_engagement), 4.00::numeric, 'programme experience averages completed-session ratings');

select results_eq(
  $$select goal_id, round(progress_pct, 1) from public.learner_canonical_goal_progress('e8000000-0000-0000-0000-000000000001') order by goal_id$$,
  $$values ('98000000-0000-0000-0000-000000000001'::uuid, 50.0::numeric), ('98000000-0000-0000-0000-000000000002'::uuid, 60.0::numeric)$$,
  'per-goal progress comes from canonical_goal_progress'
);
select is(
  (select round(avg(progress_pct), 1) from public.learner_canonical_goal_progress('e8000000-0000-0000-0000-000000000001')),
  (select goal_progress_pct from learner_engagement),
  'the enrollment goal progress is exactly the average of the canonical per-goal values'
);
select is(
  (select count(*)::integer from public.learner_canonical_goal_progress('e8000000-0000-0000-0000-000000000002')),
  0,
  'a learner cannot read another learner''s per-goal progress'
);

update public.coachee_goals set status = 'archived' where id = '98000000-0000-0000-0000-000000000002';
select is(
  (select goal_count from public.learner_canonical_engagement('e8000000-0000-0000-0000-000000000001')),
  1,
  'archived goals are not counted'
);
select is(
  (select count(*)::integer from public.learner_canonical_goal_progress('e8000000-0000-0000-0000-000000000001')),
  1,
  'archived goals have no per-goal progress row'
);

select is(
  (select count(*)::integer from public.learner_canonical_engagement('e8000000-0000-0000-0000-000000000002')),
  0,
  'a learner cannot read another learner''s engagement summary'
);

select ok(
  pg_get_functiondef('public.canonical_enrollment_engagement(uuid)'::regprocedure) !~ 'title|description|coachee_rating_comment|coach_notes|coachee_notes',
  'the engagement summary never selects goal/action wording, rating comments or notes'
);
select ok(
  pg_get_functiondef('public.sponsor_canonical_enrollment_metadata(uuid,uuid,date)'::regprocedure) ~ 'canonical_enrollment_engagement',
  'sponsor metadata reads the shared engagement definition instead of its own copy'
);

select * from finish();
rollback;
