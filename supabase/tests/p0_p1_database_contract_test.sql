begin;
select plan(40);

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
-- Canonical Sponsor rollup chain (the legacy sponsor_*_summaries engines
-- were retired in 20260918180000_retire_legacy_sponsor_sources).
select has_function(
  'public', 'sponsor_canonical_cohort_progress', array['uuid', 'date'],
  'canonical sponsor cohort rollup exists'
);
select has_function(
  'public', 'sponsor_canonical_organisation_progress', array['date'],
  'canonical sponsor organisation rollup exists'
);
select ok(
  has_function_privilege('authenticated', 'public.sponsor_canonical_organisation_progress(date)', 'EXECUTE'),
  'authenticated sponsors can read the organisation rollup'
);

select lives_ok(
  $$select * from public.get_enrollment_progress(
    (select e.id from public.programme_enrollments e order by e.id limit 1),
    current_date
  )$$,
  'historical progress engine compiles and executes for a seeded enrollment (owner only)'
);

-- Expected action totals come straight from the original records.
create temporary table expected_actions as
select count(a.id)::integer as total_action_count
from public.enrollment_actions a
join public.programme_enrollments e on e.id = a.enrollment_id
where e.cohort_id = '11111111-1111-4111-8111-111111111119'::uuid;
grant select on expected_actions to authenticated;

select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111116', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

select lives_ok(
  $$select * from public.sponsor_canonical_cohort_progress(null::uuid, current_date)$$,
  'sponsor cohort rollup executes for the seeded sponsor'
);
select lives_ok(
  $$select * from public.sponsor_canonical_organisation_progress(current_date)$$,
  'sponsor organisation rollup executes for the seeded sponsor'
);
select lives_ok(
  $$select public.sponsor_canonical_programme_journey('11111111-1111-4111-8111-111111111119'::uuid, current_date)$$,
  'sponsor programme journey executes for Cohort C'
);
select is(
  (select cohort_count from public.sponsor_canonical_organisation_progress(current_date)),
  (select count(*)::integer from public.sponsor_canonical_cohort_progress(null::uuid, current_date)),
  'organisation cohort count matches the visible cohort rollup'
);
select is(
  (select enrollment_count from public.sponsor_canonical_organisation_progress(current_date)),
  (select coalesce(sum(enrollment_count), 0)::integer from public.sponsor_canonical_cohort_progress(null::uuid, current_date)),
  'organisation enrollment count matches the visible cohort rollup'
);
select is(
  (select required_units from public.sponsor_canonical_organisation_progress(current_date)),
  (select coalesce(sum(required_units), 0)::integer from public.sponsor_canonical_cohort_progress(null::uuid, current_date) where not suppressed),
  'organisation required units are the sum of visible cohort rows'
);
select is(
  (select required_units from public.sponsor_canonical_cohort_progress('11111111-1111-4111-8111-111111111119'::uuid, current_date)),
  192,
  'Cohort C required units use the Admin-configured entitlement'
);
select is(
  (select completed_units from public.sponsor_canonical_organisation_progress(current_date)),
  (select coalesce(sum(completed_units), 0)::integer from public.sponsor_canonical_cohort_progress(null::uuid, current_date) where not suppressed),
  'organisation completed units are the sum of visible cohort rows'
);
select is(
  (select due_units from public.sponsor_canonical_organisation_progress(current_date)),
  (select coalesce(sum(due_units), 0)::integer from public.sponsor_canonical_cohort_progress(null::uuid, current_date) where not suppressed),
  'organisation due units are the sum of visible cohort rows'
);
select is(
  (select booked_units from public.sponsor_canonical_organisation_progress(current_date)),
  (select coalesce(sum(booked_units), 0)::integer from public.sponsor_canonical_cohort_progress(null::uuid, current_date) where not suppressed),
  'organisation booked units are the sum of visible cohort rows'
);
select is(
  (select sum(total_action_count)::integer from public.sponsor_canonical_enrollment_metadata('11111111-1111-4111-8111-111111111119'::uuid, null::uuid, current_date)),
  (select total_action_count from expected_actions),
  'Cohort C action totals are the canonical engagement counts of the original action records'
);
select ok(
  (
    select c.enrollment_count = 12
      and c.required_units = 192
      and c.coaching_required_units = 48
      and c.mentoring_required_units = 24
      and c.peer_required_units = 24
      and c.triad_required_units = 24
      and c.training_required_units = 72
    from public.sponsor_canonical_cohort_progress('11111111-1111-4111-8111-111111111119'::uuid, current_date) c
  ),
  'Cohort C has the Admin-configured requirements (per leader x 12)'
);

select * from finish();
rollback;