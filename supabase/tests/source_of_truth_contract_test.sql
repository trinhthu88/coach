-- Source-of-truth contract: ADMIN, LEARNER and SPONSOR receive the same
-- programme truth for one enrollment. Privacy may withhold detail; it may
-- never change a number, a date or a state.
begin;

select plan(41);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_user_meta_data, created_at, updated_at, confirmation_token,
  email_change_token_new, recovery_token
)
select
  ('a7700000-0000-0000-0000-00000000000' || n)::uuid,
  '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated',
  'sot-learner-' || n || '@example.test', 'test', now(),
  jsonb_build_object('full_name', 'SoT Learner ' || n), now(), now(), '', '', ''
from generate_series(1, 5) as n
union all
select ('a7700000-0000-0000-0000-0000000000' || suffix)::uuid,
  '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated',
  'sot-' || suffix || '@example.test', 'test', now(),
  jsonb_build_object('full_name', 'SoT ' || suffix), now(), now(), '', '', ''
from unnest(array['97', '98', '99']) as suffix;

insert into public.organizations (id, name) values ('b7700000-0000-0000-0000-000000000001', 'SoT organization');
insert into public.user_roles (user_id, role) values
  ('a7700000-0000-0000-0000-000000000097', 'coach'),
  ('a7700000-0000-0000-0000-000000000098', 'admin'),
  ('a7700000-0000-0000-0000-000000000099', 'sponsor');
insert into public.coach_profiles (id, approval_status, peer_coaching_opt_in)
values ('a7700000-0000-0000-0000-000000000097', 'active', false);
insert into public.sponsor_profiles (user_id, organization_id)
values ('a7700000-0000-0000-0000-000000000099', 'b7700000-0000-0000-0000-000000000001');

insert into public.programmes (id, name) values ('c7700000-0000-0000-0000-000000000001', 'SoT programme');
insert into public.training_weeks (id, programme_id, week_number, title, is_visible, unlock_date, sort_order) values
  ('f7700000-0000-0000-0000-000000000001', 'c7700000-0000-0000-0000-000000000001', 1, 'SoT week one', true, date '2026-02-02', 1),
  ('f7700000-0000-0000-0000-000000000002', 'c7700000-0000-0000-0000-000000000001', 2, 'SoT week two', true, date '2026-03-02', 2);

insert into public.cohorts (id, name, programme_id, organization_id, start_date, end_date)
values ('d7700000-0000-0000-0000-000000000001', 'SoT cohort', 'c7700000-0000-0000-0000-000000000001',
  'b7700000-0000-0000-0000-000000000001', date '2026-01-05', date '2026-07-05');
insert into public.cohort_week_overrides (cohort_id, training_week_id, unlock_date) values
  ('d7700000-0000-0000-0000-000000000001', 'f7700000-0000-0000-0000-000000000002', date '2026-03-09');

-- Coaching: evenly distributed. Mentoring: linked to Training weeks 1 and 2.
insert into public.programme_modules (programme_id, module, enabled, config) values
  ('c7700000-0000-0000-0000-000000000001', 'coaching', true, '{"required":true,"required_units":4,"receive_limit":4,"distribution_settings":{}}'),
  ('c7700000-0000-0000-0000-000000000001', 'mentoring', true, jsonb_build_object('required', true, 'required_units', 2, 'distribution_settings', jsonb_build_object('training_week_ids', jsonb_build_array('f7700000-0000-0000-0000-000000000001', 'f7700000-0000-0000-0000-000000000002'))));

insert into public.programme_enrollments (id, user_id, programme_id, cohort_id, organization_id, start_date, end_date, status)
select ('e7700000-0000-0000-0000-00000000000' || n)::uuid, ('a7700000-0000-0000-0000-00000000000' || n)::uuid,
  'c7700000-0000-0000-0000-000000000001', 'd7700000-0000-0000-0000-000000000001',
  'b7700000-0000-0000-0000-000000000001', date '2026-01-05', date '2026-07-05', 'active'
from generate_series(1, 5) as n;

-- The Admin dates each Coaching requirement explicitly (one date per
-- requirement; cohort_requirement_dates.due_on). Mentoring keeps its module
-- default on purpose: the assertions below exercise that default path.
update public.cohort_requirement_dates d
   set due_on = v.due_on, is_overridden = true,
       generation_method = 'manual', materialized_via = 'admin_save'
  from (values (1, date '2026-02-20'), (2, date '2026-03-20'),
               (3, date '2026-04-20'), (4, date '2026-05-20')) v(ordinal, due_on)
 where d.cohort_id = 'd7700000-0000-0000-0000-000000000001'
   and d.module = 'coaching'::public.programme_module_type
   and d.ordinal = v.ordinal;

-- Evidence: one completed coaching session; goals incl. an archived one.
insert into public.coachee_coach_allowlist (coachee_id, coach_id)
values ('a7700000-0000-0000-0000-000000000001', 'a7700000-0000-0000-0000-000000000097');
select set_config('request.jwt.claim.sub', 'a7700000-0000-0000-0000-000000000001', true);
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



insert into public.sessions (coach_id, coachee_id, topic, start_time, duration_minutes, status, enrollment_id)
values ('a7700000-0000-0000-0000-000000000097', 'a7700000-0000-0000-0000-000000000001',
  'SoT session', '2026-02-10T10:00:00Z', 60, 'completed', 'e7700000-0000-0000-0000-000000000001');
reset role;

insert into public.coachee_goals (id, coachee_id, enrollment_id, title, status) values
  ('97700000-0000-0000-0000-000000000001', 'a7700000-0000-0000-0000-000000000001', 'e7700000-0000-0000-0000-000000000001', 'Active goal', 'active'),
  ('97700000-0000-0000-0000-000000000002', 'a7700000-0000-0000-0000-000000000001', 'e7700000-0000-0000-0000-000000000001', 'Archived goal', 'archived');
insert into public.coachee_goal_ratings (coachee_id, enrollment_id, goal_id, start_rating, current_rating, target_rating) values
  ('a7700000-0000-0000-0000-000000000001', 'e7700000-0000-0000-0000-000000000001', '97700000-0000-0000-0000-000000000001', 20, 50, 80),
  ('a7700000-0000-0000-0000-000000000001', 'e7700000-0000-0000-0000-000000000001', '97700000-0000-0000-0000-000000000002', 10, 10, 90);

-- ---------------------------------------------------------------------------
-- Read the same enrollment as each role.
-- ---------------------------------------------------------------------------
create temporary table facts (role text, progress jsonb, journey jsonb, schedule jsonb);
grant all on facts to authenticated;

create or replace function pg_temp.capture(p_role text) returns void language plpgsql as $$
begin
  if p_role = 'learner' then
    insert into facts select p_role,
      (select to_jsonb(p) from public.learner_canonical_progress('e7700000-0000-0000-0000-000000000001', date '2026-04-01') p),
      public.learner_canonical_journey('e7700000-0000-0000-0000-000000000001', date '2026-04-01'),
      (select jsonb_agg(to_jsonb(s) order by s.module) from public.learner_canonical_schedule_state('e7700000-0000-0000-0000-000000000001') s);
  elsif p_role = 'sponsor' then
    insert into facts select p_role,
      (select to_jsonb(p) from public.sponsor_canonical_leader_progress('e7700000-0000-0000-0000-000000000001', date '2026-04-01') p),
      public.sponsor_canonical_leader_journey('e7700000-0000-0000-0000-000000000001', date '2026-04-01'),
      (select jsonb_agg(to_jsonb(s) order by s.module) from public.sponsor_canonical_leader_schedule_state('e7700000-0000-0000-0000-000000000001') s);
  else
    insert into facts select p_role,
      (select to_jsonb(p) from public.admin_canonical_enrollment_progress(array['e7700000-0000-0000-0000-000000000001'::uuid], date '2026-04-01') p),
      public.admin_canonical_enrollment_journey('e7700000-0000-0000-0000-000000000001', date '2026-04-01'),
      (select jsonb_agg(to_jsonb(s) order by s.module) from public.admin_canonical_schedule_state('e7700000-0000-0000-0000-000000000001') s);
  end if;
end $$;
grant execute on function pg_temp.capture(text) to authenticated;

select set_config('request.jwt.claim.sub', 'a7700000-0000-0000-0000-000000000001', true);
set local role authenticated;
select pg_temp.capture('learner');
select set_config('request.jwt.claim.sub', 'a7700000-0000-0000-0000-000000000099', true);
select pg_temp.capture('sponsor');
select set_config('request.jwt.claim.sub', 'a7700000-0000-0000-0000-000000000098', true);
select pg_temp.capture('admin');
reset role;

select is((select count(*)::int from facts where progress is not null and jsonb_array_length(journey) > 0), 3,
  'Admin, Learner and Sponsor each receive the enrollment''s progress and journey');

-- Every shared programme fact, compared across the three roles.
select is(
  -- coalesce, because a fact that is legitimately NULL for every role (no unit
  -- is due before the deadline, so adherence is undefined) is still identical.
  (select count(distinct coalesce(progress->>f, '<null>'))::int from facts), 1,
  'identical ' || f || ' for Admin, Learner and Sponsor')
from unnest(array[
  'programme_start_date', 'programme_end_date', 'required_units', 'completed_units', 'due_units', 'overdue_units',
  'full_completion_pct', 'due_adherence_pct', 'pace_status', 'effective_enrollment_status',
  'coaching_required_units', 'coaching_completed_units', 'coaching_due_units',
  'mentoring_required_units', 'mentoring_completed_units', 'mentoring_due_units'
]) f;

select is((select count(distinct journey)::int from facts), 1,
  'identical checkpoint dates, scope, cumulative units and states for Admin, Learner and Sponsor');
select is((select count(distinct schedule)::int from facts), 1,
  'identical schedule state for Admin, Learner and Sponsor');

-- Experience (weekly participation, learning breakdown, coaching utilisation
-- incl. next session) and per-module progress: one construction.
create temporary table experience_facts (role text, experience jsonb, modules jsonb);
grant all on experience_facts to authenticated;
select set_config('request.jwt.claim.sub', 'a7700000-0000-0000-0000-000000000001', true);
set local role authenticated;
insert into experience_facts select 'learner',
  public.learner_canonical_experience('e7700000-0000-0000-0000-000000000001', date '2026-04-01'),
  (select jsonb_agg(jsonb_build_object('module', m.module, 'required', m.required_units, 'completed', m.completed_units, 'due', m.due_units) order by m.module)
   from public.learner_canonical_module_progress('e7700000-0000-0000-0000-000000000001', date '2026-04-01') m);
select set_config('request.jwt.claim.sub', 'a7700000-0000-0000-0000-000000000099', true);
insert into experience_facts select 'sponsor',
  public.sponsor_canonical_leader_experience('e7700000-0000-0000-0000-000000000001', date '2026-04-01'),
  (select jsonb_build_array(
     jsonb_build_object('module', 'coaching', 'required', p.coaching_required_units, 'completed', p.coaching_completed_units, 'due', p.coaching_due_units),
     jsonb_build_object('module', 'mentoring', 'required', p.mentoring_required_units, 'completed', p.mentoring_completed_units, 'due', p.mentoring_due_units))
   from public.sponsor_canonical_leader_progress('e7700000-0000-0000-0000-000000000001', date '2026-04-01') p);
reset role;

select is(
  (select experience from experience_facts where role = 'learner'),
  (select experience from experience_facts where role = 'sponsor'),
  'Learner and Sponsor receive the identical experience (weekly participation, learning breakdown, coaching utilisation)');
select ok(
  (select jsonb_array_length(experience->'weekly_participation') > 0
      and (experience->'coaching_utilisation'->>'required_units')::int = 4
      and experience->'coaching_utilisation' ? 'next_session_at'
   from experience_facts where role = 'sponsor'),
  'the Sponsor experience carries real weekly participation and coaching utilisation (never an empty stub)');
select is(
  (select modules from experience_facts where role = 'learner'),
  (select modules from experience_facts where role = 'sponsor'),
  'per-module progress is identical for Learner and Sponsor');

-- Rollups aggregate the canonical enrollment rows; they never recompute.
select set_config('request.jwt.claim.sub', 'a7700000-0000-0000-0000-000000000099', true);
set local role authenticated;
select ok(
  (select c.required_units = e.required_units and c.completed_units = e.completed_units
      and c.due_units = e.due_units and c.overdue_units = e.overdue_units
      and c.coaching_completed_units = e.coaching_completed_units
      and c.at_risk_count = e.at_risk and c.behind_count = e.behind
   from public.sponsor_canonical_cohort_progress('d7700000-0000-0000-0000-000000000001', date '2026-04-01') c,
   (select sum(required_units)::int required_units, sum(completed_units)::int completed_units,
           sum(due_units)::int due_units, sum(overdue_units)::int overdue_units,
           sum(coaching_completed_units)::int coaching_completed_units,
           count(*) filter (where effective_enrollment_status = 'at_risk')::int at_risk,
           count(*) filter (where pace_status = 'behind')::int behind
    from public.sponsor_canonical_enrollment_progress('d7700000-0000-0000-0000-000000000001', date '2026-04-01')) e),
  'the cohort rollup is exactly the aggregation of the canonical enrollment rows');
select ok(
  (select o.required_units = c.required_units and o.completed_units = c.completed_units and o.due_units = c.due_units
   from public.sponsor_canonical_organisation_progress(date '2026-04-01') o,
   (select sum(required_units)::int required_units, sum(completed_units)::int completed_units, sum(due_units)::int due_units
    from public.sponsor_canonical_cohort_progress(null::uuid, date '2026-04-01') where not suppressed) c),
  'the organisation rollup is exactly the aggregation of the visible cohort rollups');
reset role;

-- Requirement due dates: the journey dates ARE the stored cohort dates.
select is(
  (select array_agg(distinct due_on order by due_on) from public.cohort_requirement_dates where cohort_id = 'd7700000-0000-0000-0000-000000000001'),
  (select array_agg((c->>'due_on')::date order by (c->>'due_on')::date) from facts, jsonb_array_elements(journey) c where role = 'admin'),
  'requirement due dates in every journey are exactly the stored cohort dates'
);
select is(
  (select array_agg(distinct due_on) from public.cohort_requirement_dates
   where cohort_id = 'd7700000-0000-0000-0000-000000000001' and module = 'mentoring'),
  array[(select completion_deadline from public.cohort_module_deadlines
          where cohort_id = 'd7700000-0000-0000-0000-000000000001' and module = 'mentoring')],
  'every Mentoring requirement is due on the cohort-module completion deadline, and nowhere else'
);

-- ---------------------------------------------------------------------------
-- Required units are the programme's answer, and the cohort materialises them.
-- ---------------------------------------------------------------------------
-- Under the deadline model a required_units change is not a mismatch to be
-- reconciled by hand: the cohort materialises the missing unit on the module
-- deadline, and every role sees the same thing at once.
update public.programme_modules
set config = config || '{"required_units":5,"receive_limit":5}'::jsonb
where programme_id = 'c7700000-0000-0000-0000-000000000001' and module = 'coaching';
truncate facts;

select set_config('request.jwt.claim.sub', 'a7700000-0000-0000-0000-000000000001', true);
set local role authenticated;
select pg_temp.capture('learner');
select set_config('request.jwt.claim.sub', 'a7700000-0000-0000-0000-000000000099', true);
select pg_temp.capture('sponsor');
select set_config('request.jwt.claim.sub', 'a7700000-0000-0000-0000-000000000098', true);
select pg_temp.capture('admin');
reset role;

select is(
  (select count(*)::int from public.cohort_requirement_dates where cohort_id = 'd7700000-0000-0000-0000-000000000001' and module = 'coaching'),
  5, 'raising Coaching 4 -> 5 materialises the fifth canonical requirement');
select is(
  (select array_agg(due_on::text || ':' || is_overridden::text order by ordinal)
   from public.cohort_requirement_dates
   where cohort_id = 'd7700000-0000-0000-0000-000000000001' and module = 'coaching'),
  array['2026-02-20:true', '2026-03-20:true', '2026-04-20:true', '2026-05-20:true',
        (select completion_deadline::text from public.cohort_module_deadlines
          where cohort_id = 'd7700000-0000-0000-0000-000000000001' and module = 'coaching') || ':false'],
  'the new unit starts at the module default; the explicitly dated units keep their own dates');
select is((select count(distinct schedule)::int from facts), 1, 'every role receives the same schedule state');
select ok(
  (select schedule @> '[{"module":"coaching","required_units":5,"scheduled_units":5,"state":"aligned"}]'::jsonb from facts where role = 'learner'),
  'the cohort is aligned again without an Admin touching anything');
select is((select count(distinct progress->>'coaching_required_units')::int from facts), 1, 'every role agrees on the requirement (5)');
select is((select max(progress->>'coaching_required_units') from facts), '5', 'the requirement comes from the programme');
select is((select count(distinct journey)::int from facts), 1, 'every role receives the same journey');

select set_config('request.jwt.claim.sub', 'a7700000-0000-0000-0000-000000000098', true);
set local role authenticated;
select is(
  (select count(*)::int from public.cohort_requirement_schedule_issues('d7700000-0000-0000-0000-000000000001') where module = 'coaching'),
  0, 'the Admin schedule issues report nothing to fix');
reset role;

-- ---------------------------------------------------------------------------
-- Training timing is Training's business and never moves another module.
-- ---------------------------------------------------------------------------
update public.cohort_week_overrides set unlock_date = date '2026-03-16'
where cohort_id = 'd7700000-0000-0000-0000-000000000001' and training_week_id = 'f7700000-0000-0000-0000-000000000002';
select is(
  (select count(distinct due_on)::int from public.cohort_requirement_dates
   where cohort_id = 'd7700000-0000-0000-0000-000000000001' and module = 'mentoring'),
  1, 'moving a Training week does not reach into the Mentoring deadline');

-- The cohort is the only place a module deadline can change.
select set_config('request.jwt.claim.sub', 'a7700000-0000-0000-0000-000000000098', true);
set local role authenticated;
select is(
  public.admin_set_cohort_module_deadlines('d7700000-0000-0000-0000-000000000001',
    '[{"programme_id":"c7700000-0000-0000-0000-000000000001","module":"mentoring","completion_deadline":"2026-06-20"}]'::jsonb),
  1, 'the Admin moves the Mentoring deadline');
reset role;
select is(
  (select array_agg(distinct due_on) from public.cohort_requirement_dates
   where cohort_id = 'd7700000-0000-0000-0000-000000000001' and module = 'mentoring'),
  array[date '2026-06-20'],
  'every Mentoring requirement moves with it -- there is nothing else to edit');

-- ---------------------------------------------------------------------------
-- One goal-progress rule; retired engines; deprecated stored percentage.
-- ---------------------------------------------------------------------------
create temporary table canonical_goal as
select goal_progress_pct from public.canonical_enrollment_engagement('e7700000-0000-0000-0000-000000000001');
grant select on canonical_goal to authenticated;

select set_config('request.jwt.claim.sub', 'a7700000-0000-0000-0000-000000000099', true);
set local role authenticated;
select is(
  (select goal_progress_pct from public.sponsor_canonical_enrollment_metadata('d7700000-0000-0000-0000-000000000001'::uuid, 'e7700000-0000-0000-0000-000000000001'::uuid, date '2026-04-01')),
  (select goal_progress_pct from canonical_goal),
  'Sponsor metadata uses the canonical goal-progress rule (archived goal excluded)');
select set_config('request.jwt.claim.sub', 'a7700000-0000-0000-0000-000000000001', true);
select is(
  (select goal_progress_pct from public.learner_canonical_engagement('e7700000-0000-0000-0000-000000000001')),
  (select goal_progress_pct from canonical_goal),
  'the learner engagement uses the same canonical engagement');
select throws_ok(
  $$select * from public.get_enrollment_progress('e7700000-0000-0000-0000-000000000001', current_date)$$,
  '42501', null, 'the historical snapshot engine is not a client-facing source');
reset role;
select is(
  (select progress_pct from public.programme_enrollments where id = 'e7700000-0000-0000-0000-000000000001'),
  NULL::integer, 'the deprecated stored percentage is not maintained (no second completion %)');

select * from finish();
rollback;
