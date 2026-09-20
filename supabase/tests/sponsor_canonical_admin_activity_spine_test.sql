begin;

select plan(51);

select ok(
  pg_get_functiondef(
    'public.sponsor_canonical_module_schedule(uuid)'::regprocedure
  ) ~ 'programme_modules',
  'canonical progress reads current Admin programme_modules'
);
select ok(
  pg_get_functiondef(
    'public.sponsor_canonical_module_schedule(uuid)'::regprocedure
  ) ~ 'public\.cohorts'
    AND pg_get_functiondef(
      'public.sponsor_canonical_module_schedule(uuid)'::regprocedure
    ) !~ 'e\.start_date|e\.end_date|tw\.unlock_date|enrollment_module_snapshots|enrollment_module_milestones'
    AND (
      SELECT bool_and(
        pg_get_functiondef(rpc) !~ 'enrollment_module_snapshots|enrollment_module_milestones'
      )
      FROM unnest(ARRAY[
        'public.get_sponsor_programme_progress(uuid,date)'::regprocedure,
        'public.get_sponsor_programme_journey(uuid,date)'::regprocedure,
        'public.sponsor_canonical_enrollment_progress(uuid,date)'::regprocedure,
        'public.sponsor_canonical_programme_journey(uuid,date)'::regprocedure,
        'public.sponsor_canonical_cohort_progress(uuid,date)'::regprocedure,
        'public.sponsor_canonical_organisation_progress(date)'::regprocedure,
        'public.sponsor_canonical_leader_progress(uuid,date)'::regprocedure,
        'public.sponsor_canonical_leader_journey(uuid,date)'::regprocedure,
        'public.sponsor_canonical_leader_experience(uuid,date)'::regprocedure
      ]) AS functions(rpc)
    ),
  'canonical Sponsor schedule and progress RPCs use Cohort/calendar sources, not enrollment snapshots'
);
select ok(
  pg_get_functiondef(
    'public.sponsor_canonical_activity(uuid)'::regprocedure
  ) ~ 'session_activity_attributions',
  'canonical progress reads attributed leader activity'
);
select ok(
  pg_get_functiondef(
    'public.sponsor_canonical_enrollment_progress(uuid,date)'::regprocedure
  ) ~ 'canonical_enrollment_progress'
    AND pg_get_functiondef(
      'public.canonical_enrollment_progress(uuid,date)'::regprocedure
    ) ~ 'canonical_module_progress',
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
reset role;
select is(
  (select enrollment_count
   from public.sponsor_canonical_organisation_progress('2026-07-05'::date)),
  (select count(*)::integer
   from public.programme_enrollments e
   join public.cohorts c on c.id = e.cohort_id
   where c.organization_id = '11111111-1111-4111-8111-111111111111'::uuid),
  'organisation population includes all sponsor-visible cohort enrollments'
);
set local role authenticated;

-- A temporary Admin change must affect Sponsor denominators immediately,
-- without rebuilding historical enrollment snapshots. The canonical Training
-- requirement is the set of selected Training weeks (canonical_training_
-- learning_items), so the Admin change deselects one of the six weeks.
reset role;
create temporary table training_config_before as
select config from public.programme_modules
where programme_id = '11111111-1111-4111-8111-111111111118'::uuid and module = 'training';
update public.programme_modules
set config = jsonb_set(
      jsonb_set(config, '{required_units}', '5'::jsonb),
      '{distribution_settings,training_week_ids}',
      (config->'distribution_settings'->'training_week_ids') - 5)
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
-- Restore the six-week selection for the rest of this fixture.
reset role;
update public.programme_modules
set config = (select config from training_config_before)
where programme_id = '11111111-1111-4111-8111-111111111118'::uuid and module = 'training';
set local role authenticated;

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
   (select (point->>'due_on')::date
   from jsonb_array_elements(
     public.sponsor_canonical_programme_journey(
       '11111111-1111-4111-8111-111111111119'::uuid,
       '2026-03-15'::date
     )
   ) point
    where point->'module_scope' @> '["training"]'::jsonb
      and point->>'label' LIKE '%Emerging Leaders module 1%'),
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

-- Programme-level training-week unlock dates do not move Sponsor dates. A
-- Cohort override remains authoritative for the Cohort-specific exception.
reset role;
delete from public.cohort_week_overrides
where cohort_id = '11111111-1111-4111-8111-111111111119'::uuid
  and training_week_id = '67676767-6767-4676-8676-000000000001'::uuid;
update public.training_weeks
set unlock_date = '2027-01-01'::date
where id = '67676767-6767-4676-8676-000000000001'::uuid;
reset role;
select is(
  (select due_on
   from public.sponsor_canonical_module_schedule(
     '14141414-1414-4141-8141-000000000001'::uuid
   )
   where module = 'training'::public.programme_module_type
     and training_week_id = '67676767-6767-4676-8676-000000000001'::uuid),
  '2026-03-01'::date,
  'training-linked Sponsor dates use the Cohort calendar, not the programme week unlock date'
);
set local role authenticated;

-- Enrollment dates are intentionally different from Cohort C dates here.
-- Sponsor schedule checkpoints must still follow the Cohort calendar.
reset role;
update public.programme_enrollments
set start_date = '2026-04-15'::date,
    end_date = '2026-06-15'::date
where id = '14141414-1414-4141-8141-000000000001'::uuid;
reset role;
select is(
  (select min(due_on)
   from public.sponsor_canonical_module_schedule(
     '14141414-1414-4141-8141-000000000001'::uuid
   )
   where module = 'coaching'::public.programme_module_type
     and due_on IS NOT NULL),
  '2026-04-01'::date,
  'canonical schedule uses Cohort start date when enrollment dates differ'
);
select is(
  (select max(due_on)
   from public.sponsor_canonical_module_schedule(
     '14141414-1414-4141-8141-000000000001'::uuid
   )
   where module = 'coaching'::public.programme_module_type
     and due_on IS NOT NULL),
  '2026-07-05'::date,
  'canonical schedule uses Cohort end date when enrollment dates differ'
);
set local role authenticated;

-- A late enrollment is evaluated against the already-running Cohort timeline.
-- Leader C7 has no coaching activity, so the first Cohort checkpoint is behind
-- even though its enrollment starts after that checkpoint.
reset role;
update public.programme_enrollments
set start_date = '2026-04-15'::date,
    end_date = '2026-06-15'::date
where id = '14141414-1414-4141-8141-000000000007'::uuid;
set local role authenticated;
select is(
   (select coaching_due_units
    from public.sponsor_canonical_enrollment_progress(
      '11111111-1111-4111-8111-111111111119'::uuid,
      '2026-04-02'::date)
    where enrollment_id = '14141414-1414-4141-8141-000000000007'::uuid),
  1,
  'late enrollment is due against the existing Cohort timeline'
);
select is(
  (select pace_status
    from public.sponsor_canonical_enrollment_progress(
      '11111111-1111-4111-8111-111111111119'::uuid,
      '2026-04-02'::date)
    where enrollment_id = '14141414-1414-4141-8141-000000000007'::uuid),
  'behind',
  'late enrollment can be behind before its enrollment start date'
);
select is(
  (select min((point->>'due_on')::date)
   from jsonb_array_elements(
     public.sponsor_canonical_programme_journey(
       '11111111-1111-4111-8111-111111111119'::uuid,
       '2026-04-02'::date
     )
   ) point
   where point->'module_scope' @> '["coaching"]'::jsonb),
  '2026-04-01'::date,
  'Sponsor journey checkpoints remain anchored to the Cohort start date'
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

-- Over-requirement activity. Canonical contract: completed units are capped at
-- the Admin requirement for every role (so Sponsor, Learner and Admin all show
-- 4/4, as the Demo Learner's 4 peer records show 2/2); the raw attributed
-- activity remains recorded and visible as completed_activity_units. (The
-- former uncapped 5 / 17 / 19 / 74 expectations predate the requirement-capped
-- canonical engine, 20260917160000_sponsor_requirement_capped_progress.)
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
  4,
  'leader canonical completed coaching stays capped at its four-unit requirement'
);
reset role;
select is(
  (select completed_activity_units from public.canonical_module_progress(
     '14141414-1414-4141-8141-000000000001'::uuid, '2026-07-05'::date)
   where module = 'coaching'),
  5,
  'the extra attributed activity remains visible as raw completed_activity_units'
);
set local role authenticated;
select is(
  (select completed_units
   from public.sponsor_canonical_enrollment_progress(
     '11111111-1111-4111-8111-111111111119'::uuid,
     '2026-07-05'::date)
   where learner_display_name = 'Leader C1'),
  16,
  'leader canonical completed total is the capped module sum'
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
  18,
  'cohort coaching total is the sum of capped canonical leader rows'
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
  73,
  'cohort completed total is unchanged by over-requirement activity'
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

select ok(
  pg_get_functiondef(
    'public.sponsor_canonical_activity(uuid)'::regprocedure
  ) ~ 'canonical_training_learning_items'
    AND pg_get_functiondef(
      'public.canonical_training_learning_items(uuid,date)'::regprocedure
    ) !~ 'assignment_type',
  'training activity rolls up selected learning records by week without a hard-coded assignment type'
);
select ok(
  pg_get_functiondef(
    'public.sponsor_canonical_enrollment_metadata(uuid,uuid,date)'::regprocedure
  ) !~ 'g\.title|g\.description|a\.title|a\.description|reflection_text|response_text',
  'canonical enrollment metadata exposes aggregates without private goal, action, or response wording'
);
select ok(
  pg_get_function_result(
    'public.sponsor_canonical_enrollment_metadata(uuid,uuid,date)'::regprocedure
  ) ~ 'goal_count'
    AND pg_get_function_result(
      'public.sponsor_canonical_enrollment_metadata(uuid,uuid,date)'::regprocedure
    ) ~ 'satisfaction_avg'
    AND pg_get_function_result(
      'public.sponsor_canonical_enrollment_metadata(uuid,uuid,date)'::regprocedure
    ) ~ 'total_action_count',
  'canonical enrollment metadata has sponsor-safe goals, actions, and satisfaction aggregates'
);

-- Leader C1 already completed every selected training week. Adding a response
-- to one of those weeks must not create a second Training unit.
reset role;
delete from public.daily_prompt_responses
where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'::uuid;
delete from public.daily_prompts
where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa0'::uuid;
insert into public.daily_prompts (
  id, training_week_id, day_offset, prompt_text
)
values (
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa0'::uuid,
  '67676767-6767-4676-8676-000000000001'::uuid,
  1,
  'Sponsor test prompt'
);
insert into public.daily_prompt_responses (
  id, daily_prompt_id, user_id, enrollment_id, responded_at
)
values (
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'::uuid,
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa0'::uuid,
  '13131313-1313-4131-8131-000000000001'::uuid,
  '14141414-1414-4141-8141-000000000001'::uuid,
  '2026-07-05 12:00:00+00'::timestamptz
);
set local role authenticated;
select is(
  (select training_completed_units
   from public.sponsor_canonical_enrollment_progress(
     '11111111-1111-4111-8111-111111111119'::uuid,
     '2026-07-05'::date)
   where learner_display_name = 'Leader C1'),
  6,
  'a daily-prompt response in an already completed week does not add a second Training unit'
);
select is(
  (select training_completed_units
   from public.sponsor_canonical_enrollment_metadata(
     '11111111-1111-4111-8111-111111111119'::uuid,
     NULL::uuid,
     '2026-07-05'::date)
   where learner_display_name = 'Leader C1'),
  6,
  'canonical sponsor metadata preserves one Training unit per completed week'
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