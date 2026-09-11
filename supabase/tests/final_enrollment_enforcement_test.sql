BEGIN;
SELECT plan(4);

SELECT is(
  (SELECT count(*)::integer
   FROM pg_constraint
   WHERE conname IN (
     'sessions_enrollment_required',
     'peer_sessions_enrollment_required',
     'coachee_goals_enrollment_required',
     'coachee_milestones_enrollment_required',
     'triad_reflections_enrollment_required'
   )),
  5,
  'retained historical rows have validated retirement-aware constraints'
);

SELECT is(
  (SELECT count(*)::integer
   FROM information_schema.columns
   WHERE table_schema = 'public'
     AND (
       (table_name IN (
          'coachee_peer_sessions',
          'mentoring_sessions',
          'training_progress',
          'assignment_submissions',
          'daily_prompt_responses',
          'reflection_submissions',
          'coachee_goal_ratings'
        ) AND column_name = 'enrollment_id')
       OR (table_name = 'triad_groups' AND column_name IN ('enrollment_1_id', 'enrollment_2_id'))
       OR (table_name = 'triad_sessions' AND column_name IN ('coach_enrollment_id', 'coachee_enrollment_id'))
     )
     AND is_nullable = 'NO'),
  11,
  'non-retired activity ownership columns are physically required'
);

SELECT is(
  (SELECT count(*)::integer
   FROM public.enrollment_scope_backfill_audit),
  0,
  'scope audit has no unresolved active records'
);

SELECT is(
  (SELECT count(*)::integer
   FROM public.enrollment_ownership_retirements),
  0,
  'clean fixtures have no production retirement rows'
);

SELECT * FROM finish();
ROLLBACK;