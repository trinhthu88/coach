begin;
select plan(42);

select ok(
  not exists (
    with required(table_name) as (
      values
        ('sessions'), ('peer_sessions'), ('coachee_peer_sessions'),
        ('mentoring_sessions'), ('training_progress'),
        ('assignment_submissions'), ('daily_prompt_responses'),
        ('reflection_submissions'), ('coachee_goals'), ('goal_checkins'),
        ('coachee_goal_ratings'), ('enrollment_actions')
    )
    select 1
    from required r
    where not exists (
      select 1
      from information_schema.columns c
      where c.table_schema = 'public'
        and c.table_name = r.table_name
        and c.column_name = 'enrollment_id'
    )
  ),
  'all current activity tables carry enrollment_id'
);

select has_index(
  'public', 'programme_enrollments', 'ux_programme_enrollments_one_ongoing',
  'at most one active, at-risk, or paused enrollment exists per user'
);
select has_function(
  'public', 'assert_enrollment_scope', array['uuid', 'uuid', 'uuid'],
  'enrollment ownership assertion exists'
);
select has_function(
  'public', 'validate_enrollment_activity', array[]::text[],
  'activity ownership validation exists'
);
select has_function(
  'public', 'get_enrollment_progress', array['uuid', 'date'],
  'enrollment progress RPC exists'
);
select has_function(
  'public', 'generate_enrollment_schedule', array['uuid'],
  'enrollment schedule RPC exists'
);
select has_function(
  'public', 'get_sponsor_programme_journey', array['uuid', 'date'],
  'sponsor programme journey RPC exists'
);

select has_trigger('public', 'sessions', 'sessions_enrollment_activity_scope', 'coaching activity is enrollment-scoped');
select has_trigger('public', 'peer_sessions', 'peer_sessions_enrollment_activity_scope', 'peer activity is enrollment-scoped');
select has_trigger('public', 'coachee_peer_sessions', 'coachee_peer_sessions_enrollment_activity_scope', 'PSS activity is enrollment-scoped');
select has_trigger('public', 'mentoring_sessions', 'mentoring_sessions_enrollment_activity_scope', 'mentoring activity is enrollment-scoped');
select has_trigger('public', 'training_progress', 'training_progress_enrollment_activity_scope', 'training activity is enrollment-scoped');
select has_trigger('public', 'assignment_submissions', 'assignment_submissions_enrollment_activity_scope', 'assignment activity is enrollment-scoped');
select has_trigger('public', 'daily_prompt_responses', 'daily_prompt_responses_enrollment_activity_scope', 'prompt activity is enrollment-scoped');
select has_trigger('public', 'reflection_submissions', 'reflection_submissions_enrollment_activity_scope', 'reflection activity is enrollment-scoped');
select has_trigger('public', 'coachee_goals', 'coachee_goals_enrollment_scope', 'goals are enrollment-scoped');

select has_index(
  'public', 'training_progress', 'training_progress_enrollment_week_key',
  'training progress is unique per enrollment and week'
);
select has_index(
  'public', 'assignment_submissions', 'assignment_submissions_enrollment_assignment_key',
  'assignments are unique per enrollment'
);
select has_index(
  'public', 'daily_prompt_responses', 'daily_prompt_responses_enrollment_prompt_key',
  'prompt responses are unique per enrollment'
);
select has_index(
  'public', 'reflection_submissions', 'reflection_submissions_enrollment_reflection_key',
  'reflections are unique per enrollment'
);

select ok(
  (select relrowsecurity
   from pg_class c
   join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'sponsor_report_requests'),
  'sponsor report requests have RLS enabled'
);
select ok(
  exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'sponsor_report_requests'
      and policyname = 'sponsor_report_requests_sponsor_read'
  ),
  'sponsors have an organization-scoped report-request read policy'
);
select ok(
  has_function_privilege(
    'authenticated',
    'public.sponsor_submit_report_request(uuid,text)',
    'EXECUTE'
  ),
  'authenticated sponsors can submit report requests'
);
select ok(
  has_function_privilege(
    'authenticated',
    'public.admin_update_report_request(uuid,text,text)',
    'EXECUTE'
  ) AND pg_get_functiondef(
    'public.admin_update_report_request(uuid,text,text)'::regprocedure
  ) ~ 'has_role',
  'report status RPC remains callable but enforces admin authorization'
);
select has_function(
  'public', 'sponsor_cohort_summaries', array['uuid'],
  'visible sponsor cohort summaries exist'
);
select has_function(
  'public', 'sponsor_organisation_summary', array[]::text[],
  'sponsor organization summary exists'
);
select ok(
  has_function_privilege('authenticated', 'public.sponsor_organisation_summary()', 'EXECUTE'),
  'authenticated sponsors can read the organization summary'
);

select lives_ok(
  $$select * from public.get_enrollment_progress(
    (select e.id from public.programme_enrollments e order by e.id limit 1),
    current_date
  )$$,
  'progress RPC compiles and executes for a seeded enrollment'
);

select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111116', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

select lives_ok(
  $$select * from public.sponsor_cohort_summaries(null::uuid)$$,
  'sponsor cohort summary executes for the seeded sponsor'
);
select lives_ok(
  $$select * from public.sponsor_organisation_summary()$$,
  'sponsor organization summary executes for the seeded sponsor'
);
select lives_ok(
  $$select public.get_sponsor_programme_journey(
    '11111111-1111-4111-8111-111111111119'::uuid,
    current_date
  )$$,
  'sponsor programme journey executes for Cohort C'
);
select is(
  (select cohort_count from public.sponsor_organisation_summary()),
  (select count(*)::integer from public.sponsor_cohort_summaries(null::uuid)),
  'organization cohort count matches visible cohort summaries'
);
select is(
  (select enrollment_count from public.sponsor_organisation_summary()),
  (select coalesce(sum(enrollment_count), 0)::integer from public.sponsor_cohort_summaries(null::uuid)),
  'organization enrollment count matches visible cohort summaries'
);
select is(
  (select cohort_count from public.sponsor_organisation_summary()),
  (select count(*)::integer from public.sponsor_cohort_summaries(null::uuid)),
  'organization cohort count uses the sponsor-visible cohort population'
);
select is(
  (select enrollment_count from public.sponsor_organisation_summary()),
  (select coalesce(sum(enrollment_count), 0)::integer
   from public.sponsor_cohort_summaries(null::uuid)),
  'organization enrollment count uses the sponsor-visible enrollment population'
);
select is(
  (select required_units from public.sponsor_organisation_summary()),
  (select coalesce(sum(required_units), 0)::integer from public.sponsor_cohort_summaries(null::uuid)),
  'organization required units match visible cohort summaries'
);
select is(
  (select required_units from public.sponsor_cohort_summaries(
    '11111111-1111-4111-8111-111111111119'::uuid
  )),
  192,
  'Cohort C required units use the Admin-configured entitlement'
);
select is(
  (select completed_units from public.sponsor_organisation_summary()),
  (select coalesce(sum(completed_units), 0)::integer from public.sponsor_cohort_summaries(null::uuid)),
  'organization completed units match visible cohort summaries'
);
select is(
  (select due_units from public.sponsor_organisation_summary()),
  (select coalesce(sum(due_units), 0)::integer from public.sponsor_cohort_summaries(null::uuid)),
  'organization due units match visible cohort summaries'
);
select is(
  (select booked_units from public.sponsor_organisation_summary()),
  (select coalesce(sum(booked_units), 0)::integer from public.sponsor_cohort_summaries(null::uuid)),
  'organization booked units match visible cohort summaries'
);
select is(
  (select total_action_count from public.sponsor_organisation_summary()),
  (select coalesce(sum(total_action_count), 0)::integer from public.sponsor_cohort_summaries(null::uuid)),
  'organization action totals match visible cohort summaries'
);
select ok(
  (
    select c.enrollment_count = 12
      and c.required_units = 192
      and c.coaching_required_per_leader = 4
      and c.coaching_entitled_units = 48
      and c.mentoring_required_per_leader = 2
      and c.mentoring_entitled_units = 24
      and c.peer_required_per_leader = 2
      and c.peer_entitled_units = 24
      and c.triad_required_per_leader = 2
      and c.triad_entitled_units = 24
      and c.training_required_per_leader = 6
      and c.training_entitled_units = 72
    from public.sponsor_cohort_summaries(
      '11111111-1111-4111-8111-111111111119'::uuid
    ) c
  ),
  'Cohort C has the Admin-configured requirements'
);

select * from finish();
rollback;