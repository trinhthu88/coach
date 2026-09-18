-- Sponsor Leader Detail canonical contract: enrollment scoping, no
-- cross-enrollment leakage, current-Admin/real-activity sourcing, and
-- privacy-safe output for sponsor_canonical_leader_progress,
-- sponsor_canonical_leader_journey and sponsor_leader_engagement_summary.
--
-- Reuses the Emerging Leaders / Cohort C fixture from seed.sql: Leader C1
-- (enrollment 14141414-1414-4141-8141-000000000001) finishes every
-- requirement (coaching 4/4, peer 2/2, mentoring 2/2, triads 2/2,
-- training 6/6); Leader C2 (…000002) does not. These numbers are already
-- hand-reconciled and guarded by sponsor_cohort_c_reconciliation_test.sql
-- and sponsor_canonical_admin_activity_spine_test.sql; this file reuses
-- them as ground truth since sponsor_canonical_leader_progress calls the
-- exact same get_sponsor_programme_progress/sponsor_canonical_activity
-- primitives, not a new formula.
begin;

select plan(33);

-- Source of truth: current Admin config + real attributed activity, same
-- primitives as the cohort/organisation rollups — not a new formula.
select ok(
  pg_get_functiondef(
    'public.sponsor_canonical_leader_progress(uuid,date)'::regprocedure
  ) ~ 'get_sponsor_programme_progress',
  'leader progress uses the current Admin/activity source'
);
-- The leader journey delegates to the one shared journey construction
-- (canonical_enrollment_journey), which reads the canonical cohort schedule
-- and the real activity source.
select ok(
  pg_get_functiondef(
    'public.sponsor_canonical_leader_journey(uuid,date)'::regprocedure
  ) ~ 'canonical_enrollment_journey'
    AND pg_get_functiondef(
      'public.canonical_enrollment_journey(uuid,date)'::regprocedure
    ) ~ 'sponsor_canonical_module_schedule'
    AND pg_get_functiondef(
      'public.canonical_enrollment_journey(uuid,date)'::regprocedure
    ) ~ 'sponsor_canonical_activity',
  'leader journey uses the current Admin schedule and real activity source'
);
-- The engagement summary projects the one canonical goal/action rule
-- (canonical_enrollment_engagement → canonical_goal_progress / enrollment_actions).
select ok(
  pg_get_functiondef(
    'public.sponsor_leader_engagement_summary(uuid)'::regprocedure
  ) ~ 'canonical_enrollment_engagement' AND pg_get_functiondef(
    'public.canonical_enrollment_engagement(uuid)'::regprocedure
  ) ~ 'canonical_goal_progress' AND pg_get_functiondef(
    'public.canonical_enrollment_engagement(uuid)'::regprocedure
  ) ~ 'enrollment_actions',
  'leader engagement summary reads real goal/action rows'
);

-- Privacy: never select coach identity, notes, reflections or comments.
select ok(
  pg_get_functiondef(
    'public.sponsor_canonical_leader_progress(uuid,date)'::regprocedure
  ) !~ 'coach_id|coach_notes|coach_private_notes|coachee_notes',
  'leader progress never selects coach identity or session notes'
);
select ok(
  pg_get_functiondef(
    'public.sponsor_leader_engagement_summary(uuid)'::regprocedure
  ) !~ 'coach_id|coach_notes|coach_private_notes|coachee_notes|coachee_rating_comment|\.title|\.description',
  'leader engagement summary never selects coach identity, notes, or goal/action wording'
);
select ok(
  pg_get_functiondef(
    'public.sponsor_canonical_leader_experience(uuid,date)'::regprocedure
  ) ~ 'sponsor_canonical_module_schedule'
    AND pg_get_functiondef(
      'public.sponsor_canonical_leader_experience(uuid,date)'::regprocedure
    ) ~ 'sponsor_canonical_activity'
    AND pg_get_functiondef(
      'public.sponsor_canonical_leader_experience(uuid,date)'::regprocedure
    ) ~ 'training_progress|assignment_submissions|reflection_submissions|daily_prompt_responses',
  'leader experience uses canonical schedule/activity and enrollment-owned learning completion'
);
select ok(
  pg_get_functiondef(
    'public.sponsor_canonical_leader_experience(uuid,date)'::regprocedure
  ) !~ 'pe\.start_date|tw\.unlock_date|enrollment_module_snapshots|enrollment_module_milestones',
  'leader experience learning weeks do not use enrollment dates or schedule snapshots'
);
select ok(
  pg_get_functiondef(
    'public.sponsor_canonical_leader_experience(uuid,date)'::regprocedure
  ) !~ 'response_text|reflection_text|answers|coach_id|coach_notes|coachee_rating_comment',
  'leader experience never returns private learning responses or coaching content'
);

select set_config(
  'request.jwt.claim.sub',
  '11111111-1111-4111-8111-111111111116',
  true
);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

-- Correct enrollment scoping: exactly one row for the requested leader.
select is(
  (select count(*)::integer
   from public.sponsor_canonical_leader_progress(
     '14141414-1414-4141-8141-000000000001'::uuid, '2026-07-06'::date)),
  1,
  'leader progress returns exactly one row for the requested enrollment'
);
select is(
  (select learner_display_name
   from public.sponsor_canonical_leader_progress(
     '14141414-1414-4141-8141-000000000001'::uuid, '2026-07-06'::date)),
  'Leader C1',
  'leader progress identifies the requested enrollment, not another one'
);

-- Real historical activity, current Admin denominators (ground truth
-- shared with the existing Cohort C reconciliation suite). Uses
-- 2026-07-06, one day after Cohort C's own 2026-07-05 end_date: the
-- status-recalculation branch below needs programme_end_date strictly
-- less than p_as_of to fire, and every seeded activity is already dated
-- on or before the cohort's end date, so this date change doesn't affect
-- any completed/due unit counts.
select is(
  (select coaching_completed_units
   from public.sponsor_canonical_leader_progress(
     '14141414-1414-4141-8141-000000000001'::uuid, '2026-07-06'::date)),
  4, 'Leader C1 coaching completed units reconcile to the seed fixture');
select is(
  (select peer_completed_units
   from public.sponsor_canonical_leader_progress(
     '14141414-1414-4141-8141-000000000001'::uuid, '2026-07-06'::date)),
  2, 'Leader C1 peer coaching completed units reconcile to the seed fixture');
select is(
  (select mentoring_completed_units
   from public.sponsor_canonical_leader_progress(
     '14141414-1414-4141-8141-000000000001'::uuid, '2026-07-06'::date)),
  2, 'Leader C1 mentoring completed units reconcile to the seed fixture');
select is(
  (select triad_completed_units
   from public.sponsor_canonical_leader_progress(
     '14141414-1414-4141-8141-000000000001'::uuid, '2026-07-06'::date)),
  2, 'Leader C1 triad completed units reconcile to the seed fixture');
select is(
  (select training_completed_units
   from public.sponsor_canonical_leader_progress(
     '14141414-1414-4141-8141-000000000001'::uuid, '2026-07-06'::date)),
  6, 'Leader C1 training completed units reconcile to the seed fixture');
select is(
  (select effective_enrollment_status
   from public.sponsor_canonical_leader_progress(
     '14141414-1414-4141-8141-000000000001'::uuid, '2026-07-06'::date)),
  'completed'::public.enrollment_status,
  'Leader C1 (finished every requirement) shows completed, not stuck at raw at_risk status');

-- No cross-enrollment leakage: querying Leader C2 returns exactly C2's own
-- identity (never C1's), and querying C1 never contains C2's identity —
-- proves the WHERE e.id = p_enrollment_id filter is doing real scoping
-- work, not silently returning cohort-wide rows.
select is(
  (select learner_display_name
   from public.sponsor_canonical_leader_progress(
     '14141414-1414-4141-8141-000000000002'::uuid, '2026-07-06'::date)),
  'Leader C2',
  'querying Leader C2''s enrollment id returns Leader C2''s own identity, not Leader C1''s'
);
select is(
  (select count(*)::integer
   from public.sponsor_canonical_leader_progress(
     '14141414-1414-4141-8141-000000000001'::uuid, '2026-07-06'::date)
   where learner_display_name = 'Leader C2'),
  0, 'Leader C1''s result never contains Leader C2''s identity');

-- Goals/actions/satisfaction aggregate scoping and null-vs-zero semantics.
select is(
  (select open_action_count from public.sponsor_leader_engagement_summary(
     '14141414-1414-4141-8141-000000000001'::uuid)),
  0, 'Leader C1 has zero open actions (both seeded actions are completed)');
select is(
  (select completed_action_count from public.sponsor_leader_engagement_summary(
     '14141414-1414-4141-8141-000000000001'::uuid)),
  2, 'Leader C1 completed-action count reconciles to the seed fixture');
select is(
  (select action_completion_pct from public.sponsor_leader_engagement_summary(
     '14141414-1414-4141-8141-000000000001'::uuid)),
  100.0, 'Leader C1 action completion is a real 100%, not a coerced default');
select is(
  (select goal_count from public.sponsor_leader_engagement_summary(
     '14141414-1414-4141-8141-000000000001'::uuid)),
  1, 'Leader C1 goal count reconciles to the seed fixture (one seeded leadership goal)');
select is(
  (select goal_progress_pct from public.sponsor_leader_engagement_summary(
     '14141414-1414-4141-8141-000000000001'::uuid)),
  NULL::numeric,
  'Leader C1 goal progress is null (unavailable, no rated goal), never coerced to zero'
);
select is(
  (select count(*)::integer from public.sponsor_leader_engagement_summary(
     '14141414-1414-4141-8141-000000000002'::uuid)),
  1, 'Leader C2''s engagement summary is independently scoped and also returns exactly one row'
);

-- Individual Journey: same four checkpoint states as the Cohort Journey,
-- derived from the same canonical schedule, never invented.
select ok(
  (select bool_and(point->>'state' IN ('upcoming', 'current', 'completed', 'overdue'))
   from jsonb_array_elements(
     public.sponsor_canonical_leader_journey(
       '14141414-1414-4141-8141-000000000001'::uuid, '2026-07-06'::date)
   ) point),
  'leader journey checkpoints only ever use the canonical four states'
);
select ok(
  (select count(*) > 0
   from jsonb_array_elements(
     public.sponsor_canonical_leader_journey(
       '14141414-1414-4141-8141-000000000001'::uuid, '2026-07-06'::date)
   )),
  'leader journey produces real checkpoints from the current Admin schedule'
);

-- Experience contract: weekly activity and learning breakdowns remain
-- enrollment-scoped, use the canonical four states, and return a stable
-- empty object for an unauthorized/nonexistent enrollment.
select ok(
  (select bool_and(point->>'state' IN ('upcoming', 'current', 'completed', 'overdue'))
   from jsonb_array_elements(
     (public.sponsor_canonical_leader_experience(
       '14141414-1414-4141-8141-000000000001'::uuid, '2026-07-06'::date
     ))->'weekly_participation'
   ) point),
  'leader experience weekly participation uses the canonical four states'
);
select ok(
  public.sponsor_canonical_leader_experience(
    '14141414-1414-4141-8141-000000000001'::uuid, '2026-07-06'::date
  ) ? 'learning_breakdown',
  'leader experience includes the configured learning breakdown'
);

-- With no training-week unlock dates, the learning-week fallback must use the
-- Cohort calendar even when this learner's enrollment dates differ.
reset role;
update public.programme_enrollments
set start_date = '2026-04-15'::date,
    end_date = '2026-06-15'::date
where id = '14141414-1414-4141-8141-000000000001'::uuid;
update public.training_weeks
set unlock_date = NULL
where programme_id = '11111111-1111-4111-8111-111111111118'::uuid;
delete from public.cohort_week_overrides
where cohort_id = '11111111-1111-4111-8111-111111111119'::uuid;
set local role authenticated;
select is(
  (select (point->>'due_units')::integer
   from jsonb_array_elements(
     (public.sponsor_canonical_leader_experience(
       '14141414-1414-4141-8141-000000000001'::uuid,
       '2026-03-08'::date
     ))->'learning_breakdown'
   ) point
   where point->>'key' = 'skill_cards'),
  2,
  'leader experience learning-week fallback uses Cohort start date when enrollment dates differ'
);

-- Not found / not authorized: a nonexistent enrollment id returns nothing,
-- not an error and not fabricated data.
select is(
  (select count(*)::integer from public.sponsor_canonical_leader_progress(
     '00000000-0000-0000-0000-000000000000'::uuid, '2026-07-06'::date)),
  0, 'a nonexistent enrollment id returns no rows');
select is(
  (select count(*)::integer from public.sponsor_leader_engagement_summary(
     '00000000-0000-0000-0000-000000000000'::uuid)),
  0, 'engagement summary returns no rows for a nonexistent enrollment');
select is(
  public.sponsor_canonical_leader_journey(
    '00000000-0000-0000-0000-000000000000'::uuid, '2026-07-06'::date),
  '[]'::jsonb,
  'journey is an empty array, not fabricated checkpoints, for a nonexistent enrollment');
select is(
  public.sponsor_canonical_leader_experience(
    '00000000-0000-0000-0000-000000000000'::uuid, '2026-07-06'::date),
  '{}'::jsonb,
  'experience is an empty object, not fabricated detail, for a nonexistent enrollment');

select * from finish();
rollback;
