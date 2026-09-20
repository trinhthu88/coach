-- Canonical rollup chain (canonical_enrollment_progress ->
-- sponsor_canonical_cohort_progress -> sponsor_canonical_organisation_progress).
-- The retired sponsor_*_summaries engines were replaced by these RPCs
-- (20260918180000_retire_legacy_sponsor_sources).
--
-- Data-driven reconciliation contract for Emerging Leaders – Cohort C
-- (11111111-1111-4111-8111-111111111119), against the small varied leader
-- fixture in supabase/seed.sql: Leader C1 and Leader C9 finish every
-- requirement (coaching 4/4, peer 2/2, mentoring 2/2, triads 2/2,
-- training 6/6), several leaders are partially complete, several have
-- little/no activity. These numbers were hand-reconciled from the seed and
-- must not regress:
--   coaching 18/48, peer 9/24, mentoring 7/24, triads 9/24, training 30/72
--   -> 73/192 total, 2 leaders completing every requirement.
-- This guards two P0 bugs found and fixed alongside this fixture:
--   1. get_sponsor_programme_progress/get_sponsor_programme_journey double-
--      counted every peer_coaching unit (LEFT JOIN peer_sessions and LEFT
--      JOIN coachee_peer_sessions both matched the same attribution row).
--   2. A completed cohort's enrollments only got their status recomputed to
--      'completed'/'at_risk' when the raw stored status was literally
--      'active'; an 'at_risk' enrollment that went on to finish every
--      requirement stayed 'at_risk' forever.
begin;
select plan(27);

select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111116', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

select is(
  (select enrollment_count from public.sponsor_canonical_cohort_progress('11111111-1111-4111-8111-111111111119'::uuid, current_date)),
  12, 'Cohort C has twelve enrolled leaders');

-- No completed-unit numerator exceeds its denominator (invariant 6).
select ok(
  (select coaching_completed_units <= coaching_required_units
     and peer_completed_units <= peer_required_units
     and mentoring_completed_units <= mentoring_required_units
     and triad_completed_units <= triad_required_units
     and training_completed_units <= training_required_units
     and completed_units <= required_units
   from public.sponsor_canonical_cohort_progress('11111111-1111-4111-8111-111111111119'::uuid, current_date)),
  'no module or total completed-unit count exceeds its entitlement');

-- Peer coaching is not double-counted (regression guard for bug #1).
select is(
  (select peer_completed_units from public.sponsor_canonical_cohort_progress('11111111-1111-4111-8111-111111111119'::uuid, current_date)),
  9, 'peer coaching completed units are not double-counted across peer_sessions/coachee_peer_sessions');
select is(
  (select peer_completed_leaders from public.sponsor_canonical_cohort_progress('11111111-1111-4111-8111-111111111119'::uuid, current_date)),
  3, 'exactly the leaders who really finished peer coaching count as having completed it');

select is(
  (select coaching_completed_units from public.sponsor_canonical_cohort_progress('11111111-1111-4111-8111-111111111119'::uuid, current_date)), 18, 'coaching completed units');
select is(
  (select mentoring_completed_units from public.sponsor_canonical_cohort_progress('11111111-1111-4111-8111-111111111119'::uuid, current_date)), 7, 'mentoring completed units');
select is(
  (select triad_completed_units from public.sponsor_canonical_cohort_progress('11111111-1111-4111-8111-111111111119'::uuid, current_date)), 9, 'triad completed units');
select is(
  (select training_completed_units from public.sponsor_canonical_cohort_progress('11111111-1111-4111-8111-111111111119'::uuid, current_date)), 30, 'training completed units');
select is(
  (select training_completed_units
   from public.sponsor_canonical_leader_progress(
     '14141414-1414-4141-8141-000000000002'::uuid,
     '2026-07-06'::date
   )),
  5,
  'Leader C2 canonical Training completion is five active Skill Cards');
select is(
  (select training_required_units
   from public.sponsor_canonical_leader_progress(
     '14141414-1414-4141-8141-000000000002'::uuid,
     '2026-07-06'::date
   )),
  6,
  'Leader C2 canonical Training requirement is six active Skill Cards');
select is(
  (select (point->>'completed_units')::integer
   from jsonb_array_elements(
     (public.sponsor_canonical_leader_experience(
       '14141414-1414-4141-8141-000000000002'::uuid,
       '2026-07-06'::date
     ))->'learning_breakdown'
   ) point
   where point->>'key' = 'skill_cards'),
  5,
  'Leader C2 learning breakdown renders Skill Cards as 5/6');
select is(
  (select required_units from public.sponsor_canonical_cohort_progress('11111111-1111-4111-8111-111111111119'::uuid, current_date)), 192, 'entitlement is admin requirement x leaders (16 x 12)');
select is(
  (select completed_units from public.sponsor_canonical_cohort_progress('11111111-1111-4111-8111-111111111119'::uuid, current_date)), 73, 'total completed units reconcile to the hand-computed sum');

-- Cohort card totals reconcile with roster rows (invariant 3).
select is(
  (select sum(required_units)::int from public.sponsor_canonical_enrollment_progress('11111111-1111-4111-8111-111111111119'::uuid, current_date)),
  (select required_units from public.sponsor_canonical_cohort_progress('11111111-1111-4111-8111-111111111119'::uuid, current_date)),
  'roster required_units sum matches the cohort card total');
select is(
  (select sum(completed_units)::int from public.sponsor_canonical_enrollment_progress('11111111-1111-4111-8111-111111111119'::uuid, current_date)),
  (select completed_units from public.sponsor_canonical_cohort_progress('11111111-1111-4111-8111-111111111119'::uuid, current_date)),
  'roster completed_units sum matches the cohort card total');
select is(
  (select sum(coaching_completed_units)::int from public.sponsor_canonical_enrollment_progress('11111111-1111-4111-8111-111111111119'::uuid, current_date)),
  (select coaching_completed_units from public.sponsor_canonical_cohort_progress('11111111-1111-4111-8111-111111111119'::uuid, current_date)),
  'roster coaching sum matches the cohort coaching card');
select is(
  (select sum(peer_completed_units)::int from public.sponsor_canonical_enrollment_progress('11111111-1111-4111-8111-111111111119'::uuid, current_date)),
  (select peer_completed_units from public.sponsor_canonical_cohort_progress('11111111-1111-4111-8111-111111111119'::uuid, current_date)),
  'roster peer sum matches the cohort peer card');

-- Completed-cohort lifecycle: only leaders who finished every requirement
-- show as 'completed'; the rest show 'at_risk', never 'active' (invariant 5,
-- "Completed cohort status logic").
select is(
  (select count(*)::int from public.sponsor_canonical_enrollment_progress('11111111-1111-4111-8111-111111111119'::uuid, current_date)
     where enrollment_status = 'active'),
  0, 'a cohort that has ended never shows a leader as active');
select is(
  (select count(*)::int from public.sponsor_canonical_enrollment_progress('11111111-1111-4111-8111-111111111119'::uuid, current_date)
     where enrollment_status = 'completed'),
  2, 'exactly the two leaders who finished every requirement show as completed');
select is(
  (select enrollment_status from public.sponsor_canonical_enrollment_progress('11111111-1111-4111-8111-111111111119'::uuid, current_date)
     where learner_display_name = 'Leader C1'),
  'completed', 'Leader C1 (4/4, 2/2, 2/2, 2/2, 6/6) shows completed, not stuck at its raw at_risk status');
select is(
  (select enrollment_status from public.sponsor_canonical_enrollment_progress('11111111-1111-4111-8111-111111111119'::uuid, current_date)
     where learner_display_name = 'Leader C7'),
  'at_risk', 'Leader C7 (zero activity) shows at_risk, never completed or active');

-- Org-level Across Programmes reconciles with Cohort Detail (invariant 4):
-- the organisation total's completed_units includes Cohort C's contribution.
select ok(
  (select completed_units from public.sponsor_canonical_organisation_progress(current_date))
    >= (select completed_units from public.sponsor_canonical_cohort_progress('11111111-1111-4111-8111-111111111119'::uuid, current_date)),
  'organisation completed_units is at least Cohort C''s own completed_units');

-- Training configuration cannot silently contradict itself (invariant 9):
-- the Admin-configured training required_units must equal the number of
-- Training Content weeks actually selected for that programme. Checked as
-- an unrestricted role: programme_modules/training_weeks are Admin
-- configuration, not sponsor-readable table data.
reset role;
select is(
  (select (config->>'required_units')::int from programme_modules
     where programme_id = '11111111-1111-4111-8111-111111111118' and module = 'training'),
  (select count(*)::int from training_weeks where programme_id = '11111111-1111-4111-8111-111111111118'),
  'Emerging Leaders training required_units equals its Training Content week count (6)');
select is(
  (select jsonb_array_length(config->'distribution_settings'->'training_week_ids') from programme_modules
     where programme_id = '11111111-1111-4111-8111-111111111118' and module = 'training'),
  6, 'all six Training Content weeks are selected into the training schedule');

-- Over-utilisation (invariant 6). Canonical contract: completed units are
-- capped at the Admin requirement for every role (4/4 stays 4/4, like the
-- Demo Learner's 4 peer records showing 2/2); the raw attributed activity is
-- still recorded and reported separately as completed_activity_units.
-- (The former uncapped 5 / 19 expectations belonged to the retired
-- sponsor_*_summaries engines.)
reset role;
insert into session_activity_attributions (enrollment_id, module, source_activity_type, source_activity_id, occurred_on)
values ('14141414-1414-4141-8141-000000000001'::uuid, 'coaching', 'coaching', gen_random_uuid(), '2026-07-05'::date);

select is(
  (select completed_activity_units from public.canonical_module_progress('14141414-1414-4141-8141-000000000001'::uuid, current_date)
     where module = 'coaching'),
  5, 'a 5th real coaching activity remains visible as raw activity (completed_activity_units)');

select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111116', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

select is(
  (select coaching_completed_units from public.sponsor_canonical_enrollment_progress('11111111-1111-4111-8111-111111111119'::uuid, current_date)
     where learner_display_name = 'Leader C1'),
  4, 'the canonical completed units stay capped at the four-unit requirement');
select is(
  (select coaching_completed_units from public.sponsor_canonical_cohort_progress('11111111-1111-4111-8111-111111111119'::uuid, current_date)),
  (select sum(coaching_completed_units)::int from public.sponsor_canonical_enrollment_progress('11111111-1111-4111-8111-111111111119'::uuid, current_date)),
  'the cohort coaching card is the sum of the canonical (capped) leader rows');

select * from finish();
rollback;
