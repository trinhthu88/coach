begin;

select plan(38);

select ok(
  pg_get_functiondef(
    'public.get_sponsor_programme_progress(uuid,date)'::regprocedure
  ) ~ 'programme_modules',
  'canonical progress reads current Admin programme_modules'
);
select ok(
  pg_get_functiondef(
    'public.get_sponsor_programme_progress(uuid,date)'::regprocedure
  ) ~ 'session_activity_attributions',
  'canonical progress reads attributed leader activity'
);
select ok(
  pg_get_functiondef(
    'public.sponsor_canonical_enrollment_progress(uuid,date)'::regprocedure
  ) ~ 'get_sponsor_programme_progress',
  'canonical enrollment progress uses the current Admin/activity source'
);
select ok(
  pg_get_functiondef(
    'public.sponsor_canonical_enrollment_progress(uuid,date)'::regprocedure
  ) !~ 'get_enrollment_progress',
  'canonical enrollment progress does not use snapshot progress'
);

select set_config(
  'request.jwt.claim.sub',
  '11111111-1111-4111-8111-111111111116',
  true
);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

-- Cohort C has twelve leaders and its current Admin configuration requires
-- 4 coaching, 2 peer, 2 mentoring, 2 triad, and 6 training units per leader.
select is(
  (select count(*)::integer
   from public.sponsor_canonical_enrollment_progress(
     '11111111-1111-4111-8111-111111111119'::uuid,
     '2026-07-05'::date)),
  12,
  'canonical enrollment source returns every visible Cohort C leader'
);
select is(
  (select required_units
   from public.sponsor_canonical_cohort_progress(
     '11111111-1111-4111-8111-111111111119'::uuid,
     '2026-07-05'::date)),
  (select sum(required_units)::integer
   from public.sponsor_canonical_enrollment_progress(
     '11111111-1111-4111-8111-111111111119'::uuid,
     '2026-07-05'::date)),
  'cohort required units equal the enrollment module sum'
);
select is(
  (select completed_units
   from public.sponsor_canonical_cohort_progress(
     '11111111-1111-4111-8111-111111111119'::uuid,
     '2026-07-05'::date)),
  (select sum(completed_units)::integer
   from public.sponsor_canonical_enrollment_progress(
     '11111111-1111-4111-8111-111111111119'::uuid,
     '2026-07-05'::date)),
  'cohort completed units equal the enrollment module sum'
);
select is(
  (select coaching_completed_units
   from public.sponsor_canonical_cohort_progress(
     '11111111-1111-4111-8111-111111111119'::uuid,
     '2026-07-05'::date)),
  18,
  'cohort coaching completion comes from attributed leader activity'
);
select is(
  (select training_required_units
   from public.sponsor_canonical_cohort_progress(
     '11111111-1111-4111-8111-111111111119'::uuid,
     '2026-07-05'::date)),
  72,
  'cohort training denominator comes from current Admin configuration'
);
select is(
  (select training_completed_units
   from public.sponsor_canonical_cohort_progress(
     '11111111-1111-4111-8111-111111111119'::uuid,
     '2026-07-05'::date)),
  30,
  'cohort training completion comes from attributed leader activity'
);
select is(
  (select peer_completed_units
   from public.sponsor_canonical_cohort_progress(
     '11111111-1111-4111-8111-111111111119'::uuid,
     '2026-07-05'::date)),
  9,
  'peer activity is counted once across both peer source tables'
);
select is(
  (select peer_completed_leaders
   from public.sponsor_canonical_cohort_progress(
     '11111111-1111-4111-8111-111111111119'::uuid,
     '2026-07-05'::date)),
  3,
  'peer completion leader counts reconcile after de-duplication'
);
select is(
  (select progress_source_complete
   from public.sponsor_canonical_cohort_progress(
     '11111111-1111-4111-8111-111111111119'::uuid,
     '2026-07-05'::date)),
  true,
  'visible cohort progress has one canonical source row per enrollment'
);

select is(
  (select completed_units
   from public.sponsor_canonical_organisation_progress('2026-07-05'::date)),
  (select sum(completed_units)::integer
   from public.sponsor_canonical_cohort_progress(NULL::uuid, '2026-07-05'::date)
   where not suppressed),
  'organisation completed units equal the visible cohort rollup'
);
select is(
  (select required_units
   from public.sponsor_canonical_organisation_progress('2026-07-05'::date)),
  (select sum(required_units)::integer
   from public.sponsor_canonical_cohort_progress(NULL::uuid, '2026-07-05'::date)
   where not suppressed),
  'organisation required units equal the visible cohort rollup'
);
select is(
  (select enrollment_count
   from public.sponsor_canonical_organisation_progress('2026-07-05'::date)),
  (select count(*)::integer
   from public.programme_enrollments e
   join public.cohorts c on c.id = e.cohort_id
   where c.organization_id = '11111111-1111-4111-8111-111111111111'::uuid),
  'organisation population includes all sponsor-visible cohort enrollments'
);

-- A temporary Admin change must affect Sponsor denominators immediately,
-- without rebuilding historical enrollment snapshots.
reset role;
update public.programme_modules
set config = jsonb_set(config, '{required_units}', '5'::jsonb)
where programme_id = '11111111-1111-4111-8111-111111111118'::uuid
  and module = 'training';
set local role authenticated;
select is(
  (select training_required_units
   from public.sponsor_canonical_enrollment_progress(
     '11111111-1111-4111-8111-111111111119'::uuid,
     '2026-07-05'::date)
   where learner_display_name = 'Leader C1'),
  5,
  'canonical enrollment denominator follows current Admin configuration'
);

-- Training-linked dates use the configured cohort override rather than an
-- inferred week number or the historical enrollment snapshot.
reset role;
delete from public.cohort_week_overrides
where cohort_id = '11111111-1111-4111-8111-111111111119'::uuid
  and training_week_id = '67676767-6767-4676-8676-000000000001'::uuid;
insert into public.cohort_week_overrides (
  cohort_id, training_week_id, unlock_date
)
values (
  '11111111-1111-4111-8111-111111111119'::uuid,
  '67676767-6767-4676-8676-000000000001'::uuid,
  '2026-03-15'::date
);
set local role authenticated;
select is(
  (select min((point->>'due_on')::date)
   from jsonb_array_elements(
     public.sponsor_canonical_programme_journey(
       '11111111-1111-4111-8111-111111111119'::uuid,
       '2026-03-15'::date
     )
   ) point
   where point->'module_scope' @> '["training"]'::jsonb),
  '2026-03-15'::date,
  'canonical journey uses the configured Training cohort override'
);
select ok(
  (select bool_and(point->>'label' <> 'Programme checkpoint')
   from jsonb_array_elements(
     public.sponsor_canonical_programme_journey(
       '11111111-1111-4111-8111-111111111119'::uuid,
       '2026-03-15'::date
     )
   ) point),
  'canonical journey labels are derived from configured module or training scope'
);

-- An empty cohort is suppressed: population is not exposed as a detail
-- denominator, while the organisation population remains countable.
reset role;
insert into public.cohorts (
  id, name, programme_id, organization_id, start_date, end_date
)
values (
  'cd000000-0000-0000-0000-000000000001'::uuid,
  'Canonical suppression fixture',
  '11111111-1111-4111-8111-111111111112'::uuid,
  '11111111-1111-4111-8111-111111111111'::uuid,
  '2026-09-01'::date,
  '2026-12-01'::date
);
set local role authenticated;
select is(
  (select suppressed
   from public.sponsor_canonical_cohort_progress(
     'cd000000-0000-0000-0000-000000000001'::uuid,
     '2026-09-16'::date)),
  true,
  'below-threshold cohorts remain suppressed'
);
select is(
  (select enrollment_count
   from public.sponsor_canonical_cohort_progress(
     'cd000000-0000-0000-0000-000000000001'::uuid,
     '2026-09-16'::date)),
  NULL::integer,
  'suppressed cohort enrollment count is null, not zero'
);
select is(
  (select required_units
   from public.sponsor_canonical_cohort_progress(
     'cd000000-0000-0000-0000-000000000001'::uuid,
     '2026-09-16'::date)),
  NULL::integer,
  'suppressed cohort progress is null, not zero'
);
select is(
  (select count(*)::integer
   from public.sponsor_canonical_enrollment_progress(
     'cd000000-0000-0000-0000-000000000001'::uuid,
     '2026-09-16'::date)),
  0,
  'suppressed cohorts expose no enrollment detail rows'
);

-- Raw historical activity is not capped at the Admin requirement. Only the
-- percentage and booked/schedule capacity fields remain bounded.
reset role;
insert into public.session_activity_attributions (
  enrollment_id, module, source_activity_type, source_activity_id, occurred_on
)
values (
  '14141414-1414-4141-8141-000000000001'::uuid,
  'coaching',
  'coaching',
  gen_random_uuid(),
  '2026-07-05'::date
);
set local role authenticated;
select is(
  (select coaching_completed_units
   from public.sponsor_canonical_enrollment_progress(
     '11111111-1111-4111-8111-111111111119'::uuid,
     '2026-07-05'::date)
   where learner_display_name = 'Leader C1'),
  5,
  'leader raw completed coaching activity can exceed its four-unit requirement'
);
select is(
  (select completed_units
   from public.sponsor_canonical_enrollment_progress(
     '11111111-1111-4111-8111-111111111119'::uuid,
     '2026-07-05'::date)
   where learner_display_name = 'Leader C1'),
  17,
  'leader raw completed total reconciles to uncapped module activity'
);
select ok(
  (select full_completion_pct <= 100
   from public.sponsor_canonical_enrollment_progress(
     '11111111-1111-4111-8111-111111111119'::uuid,
     '2026-07-05'::date)
   where learner_display_name = 'Leader C1'),
  'leader completion percentage remains capped at 100 percent'
);
select ok(
  (select coaching_booked_units <= greatest(
      coaching_required_units - coaching_completed_units, 0
    )
   from public.sponsor_canonical_enrollment_progress(
     '11111111-1111-4111-8111-111111111119'::uuid,
     '2026-07-05'::date)
   where learner_display_name = 'Leader C1'),
  'leader booked capacity remains bounded after raw completion exceeds requirement'
);
select is(
  (select coaching_completed_units
   from public.sponsor_canonical_cohort_progress(
     '11111111-1111-4111-8111-111111111119'::uuid,
     '2026-07-05'::date)),
  19,
  'cohort raw coaching total includes the extra attributed activity'
);
select is(
  (select completed_units
   from public.sponsor_canonical_cohort_progress(
     '11111111-1111-4111-8111-111111111119'::uuid,
     '2026-07-05'::date)),
  (select sum(completed_units)::integer
   from public.sponsor_canonical_enrollment_progress(
     '11111111-1111-4111-8111-111111111119'::uuid,
     '2026-07-05'::date)),
  'cohort raw completed total reconciles to uncapped leader totals'
);
select is(
  (select completed_units
   from public.sponsor_canonical_cohort_progress(
     '11111111-1111-4111-8111-111111111119'::uuid,
     '2026-07-05'::date)),
  74,
  'cohort raw completed total increases from 73 to 74'
);
select ok(
  (select full_completion_pct <= 100
   from public.sponsor_canonical_cohort_progress(
     '11111111-1111-4111-8111-111111111119'::uuid,
     '2026-07-05'::date)),
  'cohort completion percentage remains capped at 100 percent'
);
select ok(
  (select schedule_coverage_pct <= 100
   from public.sponsor_canonical_cohort_progress(
     '11111111-1111-4111-8111-111111111119'::uuid,
     '2026-07-05'::date)),
  'cohort schedule coverage percentage remains capped at 100 percent'
);
select is(
  (select coaching_completed_units
   from public.sponsor_canonical_organisation_progress('2026-07-05'::date)),
  (select sum(coaching_completed_units)::integer
   from public.sponsor_canonical_cohort_progress(NULL::uuid, '2026-07-05'::date)
   where not suppressed),
  'organisation raw coaching total reconciles to visible cohort totals'
);
select ok(
  (select full_completion_pct <= 100
   from public.sponsor_canonical_organisation_progress('2026-07-05'::date)),
  'organisation completion percentage remains capped at 100 percent'
);
select ok(
  (select schedule_coverage_pct <= 100
   from public.sponsor_canonical_organisation_progress('2026-07-05'::date)),
  'organisation schedule coverage percentage remains capped at 100 percent'
);
select is(
  (select peer_completed_units
   from public.sponsor_canonical_cohort_progress(
     '11111111-1111-4111-8111-111111111119'::uuid,
     '2026-07-05'::date)),
  9,
  'peer coaching remains counted once after raw overutilisation activity'
);

-- A visible leader with no enabled required modules keeps count fields at
-- zero but percentages unavailable; this distinguishes zero from unknown.
reset role;
update public.programme_modules
set enabled = false
where programme_id = '11111111-1111-4111-8111-111111111118'::uuid;
set local role authenticated;
select is(
  (select required_units
   from public.sponsor_canonical_enrollment_progress(
     '11111111-1111-4111-8111-111111111119'::uuid,
     '2026-07-05'::date)
   where learner_display_name = 'Leader C1'),
  0,
  'no enabled required modules produce a known zero denominator'
);
select is(
  (select full_completion_pct
   from public.sponsor_canonical_enrollment_progress(
     '11111111-1111-4111-8111-111111111119'::uuid,
     '2026-07-05'::date)
   where learner_display_name = 'Leader C1'),
  NULL::numeric,
  'completion percentage is null when no requirement exists'
);

select * from finish();
rollback;