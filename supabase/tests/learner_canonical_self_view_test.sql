-- Learner canonical self-view reconciliation.
--
-- Proves the Learner Dashboard and Sponsor Leader Detail describe the same
-- enrollment identically: learner_canonical_progress/journey/experience
-- must return byte-for-byte the same values as their sponsor_canonical_
-- leader_* counterparts for the same enrollment, because both call down
-- into the same get_sponsor_programme_progress/sponsor_canonical_module_
-- schedule/sponsor_canonical_activity primitives. Also proves the
-- self-authorization boundary: a learner may only ever read their own
-- enrollment, never another learner's, regardless of cohort size.
begin;

select plan(16);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_user_meta_data, created_at, updated_at, confirmation_token,
  email_change_token_new, recovery_token
)
select
  ('a9000000-0000-0000-0000-00000000000' || n)::uuid,
  '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated',
  'learner-recon-' || n || '@example.test', 'test', now(),
  jsonb_build_object('full_name', 'Learner Recon ' || n), now(), now(), '', '', ''
from generate_series(1, 5) as n
union all
select
  'a9000000-0000-0000-0000-000000000099'::uuid,
  '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated',
  'learner-recon-sponsor@example.test', 'test', now(),
  '{"full_name":"Learner Recon Sponsor"}'::jsonb, now(), now(), '', '', '';

insert into public.organizations (id, name)
values ('b9000000-0000-0000-0000-000000000001', 'Learner recon organization');

insert into public.user_roles (user_id, role)
values
  ('a9000000-0000-0000-0000-000000000002', 'coach'),
  ('a9000000-0000-0000-0000-000000000099', 'sponsor');
insert into public.coach_profiles (id, approval_status, peer_coaching_opt_in)
values ('a9000000-0000-0000-0000-000000000002', 'active', false);
insert into public.sponsor_profiles (user_id, organization_id)
values ('a9000000-0000-0000-0000-000000000099', 'b9000000-0000-0000-0000-000000000001');

insert into public.programmes (id, name)
values ('c9000000-0000-0000-0000-000000000001', 'Learner recon programme');

insert into public.cohorts (id, name, programme_id, organization_id, start_date, end_date)
values (
  'd9000000-0000-0000-0000-000000000001', 'Learner recon cohort',
  'c9000000-0000-0000-0000-000000000001', 'b9000000-0000-0000-0000-000000000001',
  date '2026-01-05', date '2026-07-05'
);

insert into public.training_weeks (id, programme_id, week_number, title, is_visible)
values
  ('f9000000-0000-0000-0000-000000000001', 'c9000000-0000-0000-0000-000000000001', 1, 'Recon week one', true),
  ('f9000000-0000-0000-0000-000000000002', 'c9000000-0000-0000-0000-000000000001', 2, 'Recon week two', true);

insert into public.programme_modules (programme_id, module, enabled, config)
values
  ('c9000000-0000-0000-0000-000000000001', 'coaching', true, '{"required":true,"required_units":2,"receive_limit":1,"distribution_mode":"flexible","distribution_settings":{}}'),
  ('c9000000-0000-0000-0000-000000000001', 'training', true, jsonb_build_object('required', true, 'required_units', 2, 'distribution_mode', 'training_linked', 'distribution_settings', jsonb_build_object('training_week_ids', jsonb_build_array('f9000000-0000-0000-0000-000000000001', 'f9000000-0000-0000-0000-000000000002'))));

insert into public.programme_enrollments (id, user_id, programme_id, cohort_id, organization_id, start_date, end_date, status)
select
  ('e9000000-0000-0000-0000-00000000000' || n)::uuid,
  ('a9000000-0000-0000-0000-00000000000' || n)::uuid,
  'c9000000-0000-0000-0000-000000000001', 'd9000000-0000-0000-0000-000000000001',
  'b9000000-0000-0000-0000-000000000001', date '2026-01-05', date '2026-07-05', 'active'
from generate_series(1, 5) as n;

insert into public.coachee_coach_allowlist (coachee_id, coach_id)
values ('a9000000-0000-0000-0000-000000000001', 'a9000000-0000-0000-0000-000000000002');

-- One completed coaching session for learner 1 so completed_units differs
-- from zero and the two engines have something non-trivial to agree on.
select set_config('request.jwt.claim.sub', 'a9000000-0000-0000-0000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;
insert into public.sessions (coach_id, coachee_id, topic, start_time, duration_minutes, status, enrollment_id)
values (
  'a9000000-0000-0000-0000-000000000002', 'a9000000-0000-0000-0000-000000000001',
  'Recon coaching session', '2026-02-01T10:00:00Z', 60, 'completed',
  'e9000000-0000-0000-0000-000000000001'
);

-- Sponsor reads the enrollment first (cohort has 5 enrollments, meeting the
-- k-anonymity threshold for sponsor visibility) and its output is captured
-- so it can be compared against the learner's own read below — each RPC's
-- authorization depends on auth.uid() at call time, so the two calls can
-- never be compared inside a single statement.
select set_config('request.jwt.claim.sub', 'a9000000-0000-0000-0000-000000000099', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

create temporary table sponsor_progress as
select required_units, completed_units, due_units, booked_units,
    full_completion_pct, pace_status,
    coaching_required_units, coaching_completed_units,
    training_required_units, training_completed_units,
    programme_start_date, programme_end_date,
    enrollment_start_date, enrollment_end_date
  from public.sponsor_canonical_leader_progress('e9000000-0000-0000-0000-000000000001');

create temporary table sponsor_journey as
select public.sponsor_canonical_leader_journey('e9000000-0000-0000-0000-000000000001') as journey;

-- Learner 1 reads their own enrollment.
select set_config('request.jwt.claim.sub', 'a9000000-0000-0000-0000-000000000001', true);

select is(
  (select count(*)::integer from public.learner_canonical_progress('e9000000-0000-0000-0000-000000000001')),
  1,
  'learner can read their own enrollment progress'
);

create temporary table learner_progress as
select required_units, completed_units, due_units, booked_units,
    full_completion_pct, pace_status,
    coaching_required_units, coaching_completed_units,
    training_required_units, training_completed_units,
    programme_start_date, programme_end_date,
    enrollment_start_date, enrollment_end_date
  from public.learner_canonical_progress('e9000000-0000-0000-0000-000000000001');

select results_eq(
  'select * from learner_progress',
  'select * from sponsor_progress',
  'learner progress matches the sponsor progress engine output for the same enrollment'
);

select is(
  (select required_units from learner_progress),
  2,
  'training-linked + flexible module config produces the expected required-unit total'
);
select is(
  (select completed_units from learner_progress),
  1,
  'a single completed coaching session is reflected in completed units'
);

select is(
  (select public.learner_canonical_journey('e9000000-0000-0000-0000-000000000001')),
  (select journey from sponsor_journey),
  'learner journey matches the sponsor journey engine output for the same enrollment'
);

select ok(
  jsonb_array_length(public.learner_canonical_journey('e9000000-0000-0000-0000-000000000001')) > 0,
  'learner journey derives real checkpoints from Programme + Cohort schedule'
);

select ok(
  (public.learner_canonical_experience('e9000000-0000-0000-0000-000000000001') ? 'weekly_participation'),
  'learner experience includes weekly participation derived from the canonical schedule'
);

select ok(
  (public.learner_canonical_experience('e9000000-0000-0000-0000-000000000001') ? 'learning_breakdown'),
  'learner experience includes a learning breakdown by content type'
);

select set_config('request.jwt.claim.sub', 'a9000000-0000-0000-0000-000000000001', true);
select results_eq(
  $$select module::text, required_units, completed_units, due_units, pace_status
      from public.learner_canonical_module_progress('e9000000-0000-0000-0000-000000000001')
      order by module::text$$,
  $$values ('coaching', 2, 1, 2, 'behind'::text), ('training', 2, 0, 2, 'behind'::text)$$,
  'per-module progress cards use the same get_sponsor_programme_progress engine as Sponsor'
);

-- Cross-enrollment isolation: learner 1 cannot read learner 2's enrollment.
select is(
  (select count(*)::integer from public.learner_canonical_progress('e9000000-0000-0000-0000-000000000002')),
  0,
  'a learner cannot read a different learner''s enrollment progress'
);
select is(
  (select public.learner_canonical_journey('e9000000-0000-0000-0000-000000000002')),
  '[]'::jsonb,
  'a learner cannot read a different learner''s enrollment journey'
);
select is(
  (select public.learner_canonical_experience('e9000000-0000-0000-0000-000000000002')),
  '{}'::jsonb,
  'a learner cannot read a different learner''s enrollment experience'
);
select is(
  (select count(*)::integer from public.learner_canonical_module_progress('e9000000-0000-0000-0000-000000000002')),
  0,
  'a learner cannot read a different learner''s per-module progress'
);

-- Unauthenticated access returns nothing.
select set_config('request.jwt.claim.sub', '', true);
select is(
  (select count(*)::integer from public.learner_canonical_progress('e9000000-0000-0000-0000-000000000001')),
  0,
  'an unauthenticated caller cannot read learner progress'
);

-- Source-of-truth + privacy checks (same style as the Sponsor Leader Detail
-- contract tests): reuses the current Admin config / real activity engines,
-- and never selects coach identity or private notes.
select ok(
  pg_get_functiondef('public.learner_canonical_progress(uuid,date)'::regprocedure) ~ 'get_sponsor_programme_progress'
    AND pg_get_functiondef('public.learner_canonical_progress(uuid,date)'::regprocedure) !~ 'enrollment_module_snapshots',
  'learner progress uses the current Admin/activity source, not enrollment snapshots'
);
select ok(
  pg_get_functiondef('public.learner_canonical_progress(uuid,date)'::regprocedure) !~ 'coach_id|coach_notes|coach_private_notes|coachee_notes',
  'learner progress never selects coach identity or session notes'
);

select * from finish();
rollback;
