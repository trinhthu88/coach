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
select plan(23);

select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111116', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

select is(
  (select enrollment_count from sponsor_cohort_summaries('11111111-1111-4111-8111-111111111119')),
  12, 'Cohort C has twelve enrolled leaders');

-- No completed-unit numerator exceeds its denominator (invariant 6).
select ok(
  (select coaching_completed_units <= coaching_entitled_units
     and peer_completed_units <= peer_entitled_units
     and mentoring_completed_units <= mentoring_entitled_units
     and triad_completed_units <= triad_entitled_units
     and training_completed_units <= training_entitled_units
     and completed_units <= required_units
   from sponsor_cohort_summaries('11111111-1111-4111-8111-111111111119')),
  'no module or total completed-unit count exceeds its entitlement');

-- Peer coaching is not double-counted (regression guard for bug #1).
select is(
  (select peer_completed_units from sponsor_cohort_summaries('11111111-1111-4111-8111-111111111119')),
  9, 'peer coaching completed units are not double-counted across peer_sessions/coachee_peer_sessions');
select is(
  (select peer_completed_leaders from sponsor_cohort_summaries('11111111-1111-4111-8111-111111111119')),
  3, 'exactly the leaders who really finished peer coaching count as having completed it');

select is(
  (select coaching_completed_units from sponsor_cohort_summaries('11111111-1111-4111-8111-111111111119')), 18, 'coaching completed units');
select is(
  (select mentoring_completed_units from sponsor_cohort_summaries('11111111-1111-4111-8111-111111111119')), 7, 'mentoring completed units');
select is(
  (select triad_completed_units from sponsor_cohort_summaries('11111111-1111-4111-8111-111111111119')), 9, 'triad completed units');
select is(
  (select training_completed_units from sponsor_cohort_summaries('11111111-1111-4111-8111-111111111119')), 30, 'training completed units');
select is(
  (select required_units from sponsor_cohort_summaries('11111111-1111-4111-8111-111111111119')), 192, 'entitlement is admin requirement x leaders (16 x 12)');
select is(
  (select completed_units from sponsor_cohort_summaries('11111111-1111-4111-8111-111111111119')), 73, 'total completed units reconcile to the hand-computed sum');

-- Cohort card totals reconcile with roster rows (invariant 3).
select is(
  (select sum(required_units)::int from sponsor_enrollment_summaries('11111111-1111-4111-8111-111111111119')),
  (select required_units from sponsor_cohort_summaries('11111111-1111-4111-8111-111111111119')),
  'roster required_units sum matches the cohort card total');
select is(
  (select sum(completed_units)::int from sponsor_enrollment_summaries('11111111-1111-4111-8111-111111111119')),
  (select completed_units from sponsor_cohort_summaries('11111111-1111-4111-8111-111111111119')),
  'roster completed_units sum matches the cohort card total');
select is(
  (select sum(coaching_completed_units)::int from sponsor_enrollment_summaries('11111111-1111-4111-8111-111111111119')),
  (select coaching_completed_units from sponsor_cohort_summaries('11111111-1111-4111-8111-111111111119')),
  'roster coaching sum matches the cohort coaching card');
select is(
  (select sum(peer_completed_units)::int from sponsor_enrollment_summaries('11111111-1111-4111-8111-111111111119')),
  (select peer_completed_units from sponsor_cohort_summaries('11111111-1111-4111-8111-111111111119')),
  'roster peer sum matches the cohort peer card');

-- Completed-cohort lifecycle: only leaders who finished every requirement
-- show as 'completed'; the rest show 'at_risk', never 'active' (invariant 5,
-- "Completed cohort status logic").
select is(
  (select count(*)::int from sponsor_enrollment_summaries('11111111-1111-4111-8111-111111111119')
     where enrollment_status = 'active'),
  0, 'a cohort that has ended never shows a leader as active');
select is(
  (select count(*)::int from sponsor_enrollment_summaries('11111111-1111-4111-8111-111111111119')
     where enrollment_status = 'completed'),
  2, 'exactly the two leaders who finished every requirement show as completed');
select is(
  (select enrollment_status from sponsor_enrollment_summaries('11111111-1111-4111-8111-111111111119')
     where learner_display_name = 'Leader C1'),
  'completed', 'Leader C1 (4/4, 2/2, 2/2, 2/2, 6/6) shows completed, not stuck at its raw at_risk status');
select is(
  (select enrollment_status from sponsor_enrollment_summaries('11111111-1111-4111-8111-111111111119')
     where learner_display_name = 'Leader C7'),
  'at_risk', 'Leader C7 (zero activity) shows at_risk, never completed or active');

-- Org-level Across Programmes reconciles with Cohort Detail (invariant 4):
-- the organisation total's completed_units includes Cohort C's contribution.
select ok(
  (select completed_units from sponsor_organisation_summary())
    >= (select completed_units from sponsor_cohort_summaries('11111111-1111-4111-8111-111111111119')),
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

-- Over-utilisation regression (invariant 6): raw completed activity remains
-- visible even when it exceeds the configured requirement. Leader C1 already
-- has coaching 4/4 (Emerging Leaders' coachee_session_limit also happens to
-- be 4, so a 5th real booking would rightly be rejected at the sessions
-- table itself) -- attribute one more coaching unit directly to prove the
-- Sponsor reporting numerator is not capped independently of that booking
-- limit. Percentage fields remain capped by the reporting contract.
reset role;
insert into session_activity_attributions (enrollment_id, module, source_activity_type, source_activity_id, occurred_on)
values ('14141414-1414-4141-8141-000000000001'::uuid, 'coaching', 'coaching', gen_random_uuid(), '2026-07-05'::date);

select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111116', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

select is(
  (select coaching_completed_units from sponsor_enrollment_summaries('11111111-1111-4111-8111-111111111119')
     where learner_display_name = 'Leader C1'),
  5, 'a 5th real coaching activity remains visible in the raw completed total');
select is(
  (select coaching_completed_units from sponsor_cohort_summaries('11111111-1111-4111-8111-111111111119')),
  19, 'the cohort coaching card reconciles to the uncapped raw activity total');

select * from finish();
rollback;
