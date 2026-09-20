-- Canonical cohort requirement schedule (cohort_requirement_dates).
--
-- Programme = WHAT is required + DEFAULT scheduling policy.
-- Cohort    = WHEN each requirement unit is due (materialized, editable).
-- Learner, Sponsor and Admin all read the same stored cohort dates.
begin;

select plan(32);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_user_meta_data, created_at, updated_at, confirmation_token,
  email_change_token_new, recovery_token
)
select
  ('a8000000-0000-0000-0000-00000000000' || n)::uuid,
  '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated',
  'crd-learner-' || n || '@example.test', 'test', now(),
  jsonb_build_object('full_name', 'CRD Learner ' || n), now(), now(), '', '', ''
from generate_series(1, 5) as n
union all
select ('a8000000-0000-0000-0000-0000000000' || suffix)::uuid,
  '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated',
  'crd-' || suffix || '@example.test', 'test', now(),
  jsonb_build_object('full_name', 'CRD ' || suffix), now(), now(), '', '', ''
from unnest(array['97', '98', '99']) as suffix;

insert into public.organizations (id, name)
values ('b8000000-0000-0000-0000-000000000001', 'CRD organization');

insert into public.user_roles (user_id, role)
values
  ('a8000000-0000-0000-0000-000000000097', 'coach'),
  ('a8000000-0000-0000-0000-000000000098', 'admin'),
  ('a8000000-0000-0000-0000-000000000099', 'sponsor');
insert into public.coach_profiles (id, approval_status, peer_coaching_opt_in)
values ('a8000000-0000-0000-0000-000000000097', 'active', false);
insert into public.sponsor_profiles (user_id, organization_id)
values ('a8000000-0000-0000-0000-000000000099', 'b8000000-0000-0000-0000-000000000001');

insert into public.programmes (id, name)
values ('c8000000-0000-0000-0000-000000000001', 'CRD Emerging Leaders');

insert into public.programme_modules (programme_id, module, enabled, config)
values
  ('c8000000-0000-0000-0000-000000000001', 'coaching', true, '{"required":true,"required_units":4,"receive_limit":4,"distribution_mode":"evenly_distributed","distribution_settings":{}}'),
  ('c8000000-0000-0000-0000-000000000001', 'peer_coaching', true, '{"required":true,"required_units":2,"distribution_mode":"evenly_distributed","distribution_settings":{}}'),
  ('c8000000-0000-0000-0000-000000000001', 'mentoring', true, '{"required":true,"required_units":2,"distribution_mode":"evenly_distributed","distribution_settings":{}}'),
  ('c8000000-0000-0000-0000-000000000001', 'triads', true, '{"required":true,"required_units":2,"distribution_mode":"evenly_distributed","distribution_settings":{}}');

-- ---------------------------------------------------------------------------
-- 1. Policy → proposal
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', 'a8000000-0000-0000-0000-000000000098', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

select is(
  (select array_agg(due_on order by ordinal)
   from public.cohort_requirement_schedule_proposal(
     'c8000000-0000-0000-0000-000000000001', date '2026-01-05', date '2026-07-05')
   where module = 'coaching'),
  array[date '2026-02-19', date '2026-04-05', date '2026-05-20', date '2026-07-05'],
  '1. Coaching 4 × evenly distributed proposes 4 dates (Feb 19, Apr 5, May 20, Jul 5)'
);

reset role;

-- ---------------------------------------------------------------------------
-- 2. Creating the cohort materializes the proposal as cohort dates
-- ---------------------------------------------------------------------------
insert into public.cohorts (id, name, programme_id, organization_id, start_date, end_date)
values ('d8000000-0000-0000-0000-000000000001', 'CRD cohort',
  'c8000000-0000-0000-0000-000000000001', 'b8000000-0000-0000-0000-000000000001',
  date '2026-01-05', date '2026-07-05');

select is(
  (select array_agg(due_on order by ordinal) from public.cohort_requirement_dates
   where cohort_id = 'd8000000-0000-0000-0000-000000000001' and module = 'coaching'),
  array[date '2026-02-19', date '2026-04-05', date '2026-05-20', date '2026-07-05'],
  '2. the generated Coaching dates are materialized on the cohort'
);
select is(
  (select count(*)::integer from public.cohort_requirement_dates
   where cohort_id = 'd8000000-0000-0000-0000-000000000001'),
  10,
  '2. every required unit (4 + 2 + 2 + 2) has one cohort date'
);

insert into public.programme_enrollments (id, user_id, programme_id, cohort_id, organization_id, start_date, end_date, status)
select
  ('e8000000-0000-0000-0000-00000000000' || n)::uuid,
  ('a8000000-0000-0000-0000-00000000000' || n)::uuid,
  'c8000000-0000-0000-0000-000000000001', 'd8000000-0000-0000-0000-000000000001',
  'b8000000-0000-0000-0000-000000000001', date '2026-01-05', date '2026-07-05', 'active'
from generate_series(1, 5) as n;

select is(
  (select count(*)::integer from public.cohort_requirement_dates
   where cohort_id = 'd8000000-0000-0000-0000-000000000001'),
  10,
  '2. enrolling learners never duplicates or rewrites existing cohort dates'
);

-- ---------------------------------------------------------------------------
-- 7 / 8 / 9. Checkpoints come from cohort dates, grouped by due date
-- ---------------------------------------------------------------------------
create temporary table journey_before as
select public.canonical_enrollment_journey('e8000000-0000-0000-0000-000000000001', date '2026-03-01') as j;

select is(
  (select array_agg((c->>'due_on')::date order by (c->>'checkpoint_number')::int)
   from journey_before, jsonb_array_elements(j) c),
  array[date '2026-02-19', date '2026-04-05', date '2026-05-20', date '2026-07-05'],
  '7. requirements sharing a due date produce ONE checkpoint per date'
);
select is(
  (select c->'module_scope' from journey_before, jsonb_array_elements(j) c where c->>'due_on' = '2026-04-05'),
  '["coaching", "mentoring", "peer_coaching", "triads"]'::jsonb,
  '8. the shared-date checkpoint lists every module in scope'
);
select is(
  (select c->'module_scope' from journey_before, jsonb_array_elements(j) c where c->>'due_on' = '2026-02-19'),
  '["coaching"]'::jsonb,
  '8. a single-module checkpoint scopes only that module'
);
select is(
  (select array_agg((c->>'required_units')::int order by (c->>'checkpoint_number')::int)
   from journey_before, jsonb_array_elements(j) c),
  array[1, 5, 6, 10],
  '9. cumulative required units follow the canonical cohort dates'
);
select ok(
  (select bool_and(c->'label' = 'null'::jsonb) from journey_before, jsonb_array_elements(j) c),
  '6. checkpoints carry no generated module-list title (label is null without Training week titles)'
);
select is(
  (select c->>'state' from journey_before, jsonb_array_elements(j) c where c->>'due_on' = '2026-02-19'),
  'overdue',
  '10. a passed cohort due date with no evidence is overdue'
);

-- ---------------------------------------------------------------------------
-- 3. The canonical schedule reads cohort dates — it does not recalculate
-- ---------------------------------------------------------------------------
select ok(
  pg_get_functiondef('public.sponsor_canonical_module_schedule(uuid)'::regprocedure) ~ 'cohort_requirement_dates'
    and pg_get_functiondef('public.sponsor_canonical_module_schedule(uuid)'::regprocedure)
      !~ 'evenly_distributed|monthly_frequency|distribution_mode|generate_series',
  '3. sponsor_canonical_module_schedule reads cohort_requirement_dates and interprets no policy'
);
select ok(
  pg_get_functiondef('public.learner_canonical_journey(uuid,date)'::regprocedure) ~ 'canonical_enrollment_journey'
    and pg_get_functiondef('public.sponsor_canonical_leader_journey(uuid,date)'::regprocedure) ~ 'canonical_enrollment_journey',
  '12. Learner and Sponsor Leader journeys share one construction'
);

-- ---------------------------------------------------------------------------
-- 11. A session booking date never replaces a requirement due date
-- ---------------------------------------------------------------------------
insert into public.coachee_coach_allowlist (coachee_id, coach_id)
values ('a8000000-0000-0000-0000-000000000001', 'a8000000-0000-0000-0000-000000000097');
select set_config('request.jwt.claim.sub', 'a8000000-0000-0000-0000-000000000001', true);
set local role authenticated;
insert into public.sessions (coach_id, coachee_id, topic, start_time, duration_minutes, status, enrollment_id)
values (
  'a8000000-0000-0000-0000-000000000097', 'a8000000-0000-0000-0000-000000000001',
  'CRD booked session', '2026-03-15T10:00:00Z', 60, 'confirmed',
  'e8000000-0000-0000-0000-000000000001'
);
reset role;

select is(
  (select array_agg((c->>'due_on')::date order by (c->>'checkpoint_number')::int)
   from jsonb_array_elements(public.canonical_enrollment_journey('e8000000-0000-0000-0000-000000000001', date '2026-03-01')) c),
  array[date '2026-02-19', date '2026-04-05', date '2026-05-20', date '2026-07-05'],
  '11. a booked session (Mar 15) does not create or move a requirement due date'
);

-- ---------------------------------------------------------------------------
-- 4. Admin override of Coaching unit 2 changes only that cohort date
-- ---------------------------------------------------------------------------
create temporary table dates_before as
select module, ordinal, due_on from public.cohort_requirement_dates
where cohort_id = 'd8000000-0000-0000-0000-000000000001';

select set_config('request.jwt.claim.sub', 'a8000000-0000-0000-0000-000000000098', true);
set local role authenticated;
select is(
  public.admin_save_cohort_requirement_dates(
    'd8000000-0000-0000-0000-000000000001',
    jsonb_build_array(jsonb_build_object(
      'programme_id', 'c8000000-0000-0000-0000-000000000001',
      'module', 'coaching', 'ordinal', 2, 'due_on', '2026-04-12'))
  ),
  1,
  '4. Admin saves one requirement date'
);
reset role;

select is(
  (select array_agg(module::text || '#' || ordinal order by module::text, ordinal) from (
    select d.module, d.ordinal from public.cohort_requirement_dates d
    join dates_before b using (module, ordinal)
    where d.cohort_id = 'd8000000-0000-0000-0000-000000000001' and d.due_on <> b.due_on
  ) changed),
  array['coaching#2'],
  '4. only Coaching unit 2 changed'
);
select ok(
  (select is_overridden and generated_due_on = date '2026-04-05'
   from public.cohort_requirement_dates
   where cohort_id = 'd8000000-0000-0000-0000-000000000001' and module = 'coaching' and ordinal = 2),
  '4. the override is recorded against the policy-generated date'
);

-- 21 / 22. Saved Admin date appears immediately in Learner and Sponsor journeys.
select set_config('request.jwt.claim.sub', 'a8000000-0000-0000-0000-000000000099', true);
set local role authenticated;
create temporary table sponsor_journey as
select public.sponsor_canonical_leader_journey('e8000000-0000-0000-0000-000000000001', date '2026-03-01') as j;
reset role;

select set_config('request.jwt.claim.sub', 'a8000000-0000-0000-0000-000000000001', true);
set local role authenticated;
create temporary table learner_journey as
select public.learner_canonical_journey('e8000000-0000-0000-0000-000000000001', date '2026-03-01') as j;
reset role;

select ok(
  exists (select 1 from learner_journey, jsonb_array_elements(j) c
          where c->>'due_on' = '2026-04-12' and c->'module_scope' = '["coaching"]'::jsonb),
  '21. the saved Admin date appears in the Learner journey'
);
select ok(
  exists (select 1 from sponsor_journey, jsonb_array_elements(j) c
          where c->>'due_on' = '2026-04-12' and c->'module_scope' = '["coaching"]'::jsonb),
  '22. the saved Admin date appears in the Sponsor Leader journey'
);
select is(
  (select j from learner_journey),
  (select j from sponsor_journey),
  '12. Learner and Sponsor receive identical checkpoints, dates, scope, units and states'
);
select is(
  (select c->'module_scope' from learner_journey, jsonb_array_elements(j) c where c->>'due_on' = '2026-04-05'),
  '["mentoring", "peer_coaching", "triads"]'::jsonb,
  '8. moving Coaching 2 removes it from the Apr 5 checkpoint scope'
);

-- 13. The Admin cohort schedule exposes the same dates the journeys use.
select set_config('request.jwt.claim.sub', 'a8000000-0000-0000-0000-000000000098', true);
set local role authenticated;
select is(
  (select array_agg(distinct due_on order by due_on) from public.cohort_requirement_dates
   where cohort_id = 'd8000000-0000-0000-0000-000000000001'),
  (select array_agg((c->>'due_on')::date order by (c->>'due_on')::date) from learner_journey, jsonb_array_elements(j) c),
  '13. the Admin cohort schedule exposes exactly the journey checkpoint dates'
);

reset role;

-- 10. Overdue follows the canonical (overridden) date.
select is(
  (select c->>'state' from jsonb_array_elements(public.canonical_enrollment_journey('e8000000-0000-0000-0000-000000000001', date '2026-04-10')) c
   where c->>'due_on' = '2026-04-12'),
  'upcoming',
  '10. Coaching 2 moved to Apr 12 is not overdue on Apr 10 (the old Apr 5 date no longer applies)'
);

select set_config('request.jwt.claim.sub', 'a8000000-0000-0000-0000-000000000098', true);
set local role authenticated;

-- Validation of Admin edits.
select throws_ok(
  $$select public.admin_save_cohort_requirement_dates('d8000000-0000-0000-0000-000000000001',
      '[{"programme_id":"c8000000-0000-0000-0000-000000000001","module":"coaching","ordinal":1,"due_on":"2026-08-01"}]')$$,
  '22023', null,
  'dates outside the cohort are rejected'
);
select throws_ok(
  $$select public.admin_save_cohort_requirement_dates('d8000000-0000-0000-0000-000000000001',
      '[{"programme_id":"c8000000-0000-0000-0000-000000000001","module":"daily_prompt","ordinal":1,"due_on":"2026-03-01"}]')$$,
  '22023', null,
  'requirements outside the programme scope are rejected'
);
select throws_ok(
  $$select public.admin_save_cohort_requirement_dates('d8000000-0000-0000-0000-000000000001',
      '[{"programme_id":"c8000000-0000-0000-0000-000000000001","module":"coaching","ordinal":1,"due_on":null}]')$$,
  '22023', null,
  'missing requirement dates are rejected'
);
reset role;

-- ---------------------------------------------------------------------------
-- 5. Programme template edits never silently alter an existing cohort
-- ---------------------------------------------------------------------------
create temporary table dates_after_override as
select module, ordinal, due_on from public.cohort_requirement_dates
where cohort_id = 'd8000000-0000-0000-0000-000000000001';

update public.programme_modules
set config = '{"required":true,"required_units":5,"receive_limit":5,"distribution_mode":"monthly_frequency","distribution_settings":{"interval_months":1}}'
where programme_id = 'c8000000-0000-0000-0000-000000000001' and module = 'coaching';

select is(
  (select count(*)::integer from (
    (select module, ordinal, due_on from public.cohort_requirement_dates where cohort_id = 'd8000000-0000-0000-0000-000000000001'
     except select * from dates_after_override)
    union all
    (select * from dates_after_override
     except select module, ordinal, due_on from public.cohort_requirement_dates where cohort_id = 'd8000000-0000-0000-0000-000000000001')
  ) diff),
  0,
  '5. changing the programme template (units + policy) does not rewrite the cohort dates'
);

select set_config('request.jwt.claim.sub', 'a8000000-0000-0000-0000-000000000098', true);
set local role authenticated;
select is(
  (select issue || ':' || required_units || '/' || scheduled_units
   from public.cohort_requirement_schedule_issues('d8000000-0000-0000-0000-000000000001')
   where module = 'coaching'),
  'missing_dates:5/4',
  '5. the Admin sees the template/schedule mismatch as a validation issue instead'
);
reset role;

-- ---------------------------------------------------------------------------
-- 6. Cohort start/end changes do not silently rewrite saved dates
-- ---------------------------------------------------------------------------
update public.cohorts set start_date = date '2026-02-01', end_date = date '2026-08-31'
where id = 'd8000000-0000-0000-0000-000000000001';

select is(
  (select count(*)::integer from (
    (select module, ordinal, due_on from public.cohort_requirement_dates where cohort_id = 'd8000000-0000-0000-0000-000000000001'
     except select * from dates_after_override)
    union all
    (select * from dates_after_override
     except select module, ordinal, due_on from public.cohort_requirement_dates where cohort_id = 'd8000000-0000-0000-0000-000000000001')
  ) diff),
  0,
  '6. changing cohort start/end leaves every saved requirement date unchanged'
);

-- ---------------------------------------------------------------------------
-- Privacy: only Admins read or write the schedule directly.
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', 'a8000000-0000-0000-0000-000000000001', true);
set local role authenticated;
select is(
  (select count(*)::integer from public.cohort_requirement_dates),
  0,
  'learners cannot read the cohort schedule table directly (only via canonical projections)'
);
select throws_ok(
  $$select public.admin_save_cohort_requirement_dates('d8000000-0000-0000-0000-000000000001', '[]'::jsonb)$$,
  '42501', null,
  'non-admins cannot edit cohort requirement dates'
);
reset role;
select set_config('request.jwt.claim.sub', 'a8000000-0000-0000-0000-000000000099', true);
set local role authenticated;
select throws_ok(
  $$select * from public.cohort_requirement_schedule_proposal('c8000000-0000-0000-0000-000000000001', date '2026-01-05', date '2026-07-05')$$,
  '42501', null,
  'sponsors cannot run the scheduling policy'
);
reset role;

-- ---------------------------------------------------------------------------
-- 14. Existing cohorts keep their current journey dates: for every seeded
--     enrollment, the stored cohort schedule equals what the previous live
--     algorithm produced from the cohort's dates (the migration additionally
--     refuses to apply if any enrollment's schedule would change).
-- ---------------------------------------------------------------------------
select is(
  (select count(*)::integer from (
    (select e.id, s.module, s.due_on, s.milestone_units
     from public.programme_enrollments e
     join public.cohorts c on c.id = e.cohort_id
     cross join lateral public.sponsor_canonical_module_schedule(e.id) s
     where s.module <> 'training' and s.due_on is not null and e.cohort_id <> 'd8000000-0000-0000-0000-000000000001'
     except all
     select e.id, p.module, p.due_on, p.units
     from public.programme_enrollments e
     join public.cohorts c on c.id = e.cohort_id
     cross join lateral public.cohort_requirement_proposal_internal(e.programme_id, e.cohort_id, c.start_date, c.end_date) p
     where e.cohort_id <> 'd8000000-0000-0000-0000-000000000001')
    union all
    (select e.id, p.module, p.due_on, p.units
     from public.programme_enrollments e
     join public.cohorts c on c.id = e.cohort_id
     cross join lateral public.cohort_requirement_proposal_internal(e.programme_id, e.cohort_id, c.start_date, c.end_date) p
     where e.cohort_id <> 'd8000000-0000-0000-0000-000000000001'
     except all
     select e.id, s.module, s.due_on, s.milestone_units
     from public.programme_enrollments e
     join public.cohorts c on c.id = e.cohort_id
     cross join lateral public.sponsor_canonical_module_schedule(e.id) s
     where s.module <> 'training' and s.due_on is not null and e.cohort_id <> 'd8000000-0000-0000-0000-000000000001')
  ) diff),
  0,
  '14. every existing enrollment keeps exactly the dates the previous live algorithm produced'
);

select * from finish();
rollback;
