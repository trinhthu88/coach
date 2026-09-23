-- The enrollment module snapshot is a PROJECTION of the canonical cohort
-- schedule, not a second scheduler.
--
-- It used to re-implement all five distribution modes, which is why a short
-- programme could round the first "evenly distributed" milestone onto the
-- programme start date. There is no policy left to round: a module has one
-- cohort completion deadline and its required units are milestones on it.
-- Training keeps its own week-driven dates.
begin;

select plan(8);
insert into public.programmes (id, name)
values
  ('aa000000-0000-0000-0000-000000000011', 'Evenly baseline test'),
  ('aa000000-0000-0000-0000-000000000012', 'Explicit start milestone test'),
  ('aa000000-0000-0000-0000-000000000013', 'Training dates test');

insert into public.cohorts (
  id, name, programme_id, organization_id, start_date, end_date
)
values
  ('ac000000-0000-0000-0000-000000000011', 'Evenly baseline cohort',
   'aa000000-0000-0000-0000-000000000011',
   '11111111-1111-4111-8111-111111111111', '2026-01-01', '2026-01-02'),
  ('ac000000-0000-0000-0000-000000000012', 'Explicit start cohort',
   'aa000000-0000-0000-0000-000000000012',
   '11111111-1111-4111-8111-111111111111', '2026-01-01', '2026-01-11'),
  ('ac000000-0000-0000-0000-000000000013', 'Training dates cohort',
   'aa000000-0000-0000-0000-000000000013',
   '11111111-1111-4111-8111-111111111111', '2026-04-01', '2026-04-30');

insert into public.programme_modules (id, programme_id, module, enabled, config)
values
  ('ad000000-0000-0000-0000-000000000011',
   'aa000000-0000-0000-0000-000000000011', 'coaching', true,
   '{"required":true,"required_units":4}'),
  ('ad000000-0000-0000-0000-000000000012',
   'aa000000-0000-0000-0000-000000000012', 'coaching', true,
   '{"required":true,"required_units":1}'),
  ('ad000000-0000-0000-0000-000000000013',
   'aa000000-0000-0000-0000-000000000013', 'training', true,
   '{"required":true,"required_units":2,"distribution_settings":{"training_week_ids":["ae000000-0000-0000-0000-000000000011","ae000000-0000-0000-0000-000000000012"]}}');

insert into public.training_weeks (
  id, programme_id, week_number, title, is_visible, unlock_date, sort_order
)
values
  ('ae000000-0000-0000-0000-000000000011',
   'aa000000-0000-0000-0000-000000000013', 1, 'Configured week one', true,
   '2026-04-04', 1),
  ('ae000000-0000-0000-0000-000000000012',
   'aa000000-0000-0000-0000-000000000013', 2, 'Configured week two', true,
   '2026-04-18', 2);

insert into public.cohort_week_overrides (cohort_id, training_week_id, unlock_date)
values
  ('ac000000-0000-0000-0000-000000000013',
   'ae000000-0000-0000-0000-000000000011', '2026-04-05'),
  ('ac000000-0000-0000-0000-000000000013',
   'ae000000-0000-0000-0000-000000000012', '2026-04-20');

insert into public.programme_enrollments (
  id, user_id, programme_id, cohort_id, organization_id,
  start_date, end_date, status
)
values
  ('af000000-0000-0000-0000-000000000011',
   '11111111-1111-4111-8111-111111111116',
   'aa000000-0000-0000-0000-000000000011',
   'ac000000-0000-0000-0000-000000000011',
   '11111111-1111-4111-8111-111111111111',
   '2026-01-01', '2026-01-02', 'completed'),
  ('af000000-0000-0000-0000-000000000012',
   '11111111-1111-4111-8111-111111111116',
   'aa000000-0000-0000-0000-000000000012',
   'ac000000-0000-0000-0000-000000000012',
   '11111111-1111-4111-8111-111111111111',
   '2026-01-01', '2026-01-11', 'completed'),
  ('af000000-0000-0000-0000-000000000013',
   '11111111-1111-4111-8111-111111111116',
   'aa000000-0000-0000-0000-000000000013',
   'ac000000-0000-0000-0000-000000000013',
   '11111111-1111-4111-8111-111111111111',
   '2026-04-01', '2026-04-30', 'completed'),
  ('af000000-0000-0000-0000-000000000014',
   '11111111-1111-4111-8111-111111111116',
   'aa000000-0000-0000-0000-000000000011',
   'ac000000-0000-0000-0000-000000000011',
   '11111111-1111-4111-8111-111111111111',
   '2026-01-01', '2026-01-02', 'completed'),
  ('af000000-0000-0000-0000-000000000015',
   '11111111-1111-4111-8111-111111111116',
   'aa000000-0000-0000-0000-000000000011',
   'ac000000-0000-0000-0000-000000000011',
   '11111111-1111-4111-8111-111111111111',
   '2026-01-01', '2026-01-02', 'completed'),
  ('af000000-0000-0000-0000-000000000016',
   '11111111-1111-4111-8111-111111111116',
   'aa000000-0000-0000-0000-000000000011',
   'ac000000-0000-0000-0000-000000000011',
   '11111111-1111-4111-8111-111111111111',
   '2026-01-01', '2026-01-02', 'completed'),
  ('af000000-0000-0000-0000-000000000017',
   '11111111-1111-4111-8111-111111111116',
   'aa000000-0000-0000-0000-000000000011',
   'ac000000-0000-0000-0000-000000000011',
   '11111111-1111-4111-8111-111111111111',
   '2026-01-01', '2026-01-02', 'completed');

select public.generate_enrollment_schedule(
  'af000000-0000-0000-0000-000000000011'
);
select public.generate_enrollment_schedule(
  'af000000-0000-0000-0000-000000000012'
);
select public.generate_enrollment_schedule(
  'af000000-0000-0000-0000-000000000013'
);
select public.generate_enrollment_schedule(
  'af000000-0000-0000-0000-000000000014'
);
select public.generate_enrollment_schedule(
  'af000000-0000-0000-0000-000000000015'
);
select public.generate_enrollment_schedule(
  'af000000-0000-0000-0000-000000000016'
);
select public.generate_enrollment_schedule(
  'af000000-0000-0000-0000-000000000017'
);

select is(
  (select min(m.due_on)
   from public.enrollment_module_milestones m
   join public.enrollment_module_snapshots s
     on s.id = m.enrollment_module_snapshot_id
   where s.enrollment_id = 'af000000-0000-0000-0000-000000000011'),
  '2026-01-02'::date,
  'no milestone can land on the programme start through rounding: there is no rounding'
);
select is(
  (select max(m.due_on)
   from public.enrollment_module_milestones m
   join public.enrollment_module_snapshots s
     on s.id = m.enrollment_module_snapshot_id
   where s.enrollment_id = 'af000000-0000-0000-0000-000000000011'),
  '2026-01-02'::date,
  'every required unit is a milestone on the cohort-module completion deadline'
);
select is(
  (select count(*)::integer
   from public.enrollment_module_milestones m
   join public.enrollment_module_snapshots s
     on s.id = m.enrollment_module_snapshot_id
   where s.enrollment_id = 'af000000-0000-0000-0000-000000000011'
     and m.due_on = '2026-01-01'),
  0,
  'the programme-start baseline has no due units'
);
select is(
  (select min(m.due_on)
   from public.enrollment_module_milestones m
   join public.enrollment_module_snapshots s
     on s.id = m.enrollment_module_snapshot_id
   where s.enrollment_id = 'af000000-0000-0000-0000-000000000012'),
  '2026-01-11'::date,
  'a single required unit is a single milestone, on the cohort deadline'
);
select is(
  (select array_agg(m.due_on order by m.sequence)
   from public.enrollment_module_milestones m
   join public.enrollment_module_snapshots s
     on s.id = m.enrollment_module_snapshot_id
   where s.enrollment_id = 'af000000-0000-0000-0000-000000000013'),
  array['2026-04-05'::date, '2026-04-20'::date],
  'Training-linked checkpoints retain configured cohort training dates'
);

-- Moving the cohort end date moves the deadline the system chose, and every
-- required unit with it -- there is no cadence to preserve.
update public.cohorts set end_date = '2026-01-11'
where id = 'ac000000-0000-0000-0000-000000000011';
update public.programme_enrollments
set start_date = '2026-01-01', end_date = '2026-01-11'
where id = 'af000000-0000-0000-0000-000000000011';
delete from public.enrollment_module_snapshots
where enrollment_id = 'af000000-0000-0000-0000-000000000011';
select public.generate_enrollment_schedule(
  'af000000-0000-0000-0000-000000000011'
);
select is(
  (select array_agg(m.due_on order by m.sequence)
   from public.enrollment_module_milestones m
   join public.enrollment_module_snapshots s
     on s.id = m.enrollment_module_snapshot_id
   where s.enrollment_id = 'af000000-0000-0000-0000-000000000011'),
  array['2026-01-11'::date, '2026-01-11'::date, '2026-01-11'::date, '2026-01-11'::date],
  'all four required units follow the cohort deadline together'
);
select set_config(
  'request.jwt.claim.sub',
  '11111111-1111-4111-8111-111111111116',
  true
);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;
select is(
  (select (public.sponsor_canonical_programme_journey(
    'ac000000-0000-0000-0000-000000000011'::uuid,
    '2026-01-01'::date
  )->0->>'due_on')::date),
  '2026-01-11'::date,
  'the Sponsor journey checkpoint is the cohort deadline, not a generated cadence point'
);
select is(
  (select (public.sponsor_canonical_programme_journey(
    'ac000000-0000-0000-0000-000000000011'::uuid,
    '2026-01-01'::date
  )->0->>'state')),
  -- Its session requirements opened 14 days before the 11 Jan deadline, so on
  -- 1 Jan they are available and not yet due: current (20260930100000).
  'current',
  'the Sponsor journey does not mark the programme-start baseline overdue'
);

select * from finish();
rollback;