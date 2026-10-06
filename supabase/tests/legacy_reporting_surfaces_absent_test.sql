begin;
select plan(22);

select hasnt_function('public', 'sponsor_can_view_coachee', array['uuid'],
  'legacy sponsor visibility fallback RPC is retired');
select hasnt_function('public', 'sponsor_confidence_trend', array[]::text[],
  'legacy sponsor confidence trend RPC is retired');
select hasnt_function('public', 'sponsor_engagement_red_flags', array['uuid'],
  'legacy sponsor red flags RPC is retired');
select hasnt_function('public', 'sponsor_goal_growth_summary', array['uuid'],
  'legacy sponsor goal growth RPC is retired');
select hasnt_function('public', 'sponsor_kpis', array['uuid'],
  'legacy sponsor KPI RPC is retired');
select hasnt_function('public', 'sponsor_programme_engagement', array['uuid'],
  'legacy sponsor engagement RPC is retired');
select hasnt_function('public', 'sponsor_roster', array['uuid'],
  'legacy sponsor roster RPC is retired');
select hasnt_function('public', 'sponsor_satisfaction_trend', array['uuid'],
  'legacy sponsor satisfaction trend RPC is retired');
select hasnt_function('public', 'sponsor_coach_utilisation', array['uuid'],
  'legacy sponsor coach utilisation RPC is retired');
select hasnt_function('public', 'sponsor_timeline', array[]::text[],
  'legacy sponsor timeline RPC is retired');
select hasnt_function('public', 'sponsor_roster', array[]::text[],
  'zero-argument sponsor roster overload is retired');
select hasnt_function('public', 'sponsor_goal_growth_summary', array[]::text[],
  'zero-argument sponsor goal growth overload is retired');
select hasnt_function('public', 'sponsor_satisfaction_summary', array[]::text[],
  'zero-argument sponsor satisfaction overload is retired');
select hasnt_function('public', 'sponsor_kpis', array[]::text[],
  'zero-argument sponsor KPI overload is retired');
select hasnt_function('public', 'sponsor_timeline', array[]::text[],
  'zero-argument sponsor timeline overload is retired');

select hasnt_function('public', 'get_coach_peer_session_usage', array['uuid'],
  'the coach-as-learner peer allowance reader is retired (20261006120000)');
-- enforce_coach_as_coachee_limit(), get_mentoring_given_limit() and
-- get_mentoring_given_usage() were DROPPED by 20261006110000: session limits
-- are not a programme requirement (supabase/tests/retired_session_limits_test.sql).
select hasnt_function('public', 'enforce_coach_as_coachee_limit', array[]::text[],
  'the completion-count session limit is retired');
-- get_mentoring_received_limit() was DROPPED by 20260920230000: it was
-- user-global and summed the mentoring entitlement of every enrollment a
-- learner had ever held, so a historical enrollment inflated the current
-- one's allowance. Absence is the stronger form of the original assertion --
-- a function that does not exist cannot depend on anything.
select hasnt_function('public', 'get_mentoring_received_limit', array['uuid'],
  'the user-global mentoring received limit is retired');
select hasnt_function('public', 'get_mentoring_given_limit', array['uuid'],
  'the mentoring given limit is retired');
select hasnt_function('public', 'get_mentoring_session_usage', array['uuid'],
  'the mentoring received allowance reader is retired (20261006120000)');
select hasnt_function('public', 'get_mentoring_given_usage', array['uuid'],
  'the mentoring given usage reader is retired');
select ok(pg_get_functiondef('public.can_book_session(uuid,uuid,uuid)'::regprocedure)
    !~* 'coach_programmes|coach_programme_enrollments',
  'booking authorization has no legacy coach programme dependency');

select * from finish();
rollback;