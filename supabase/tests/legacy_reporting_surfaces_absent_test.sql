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

select ok(pg_get_functiondef('public.get_coach_peer_session_usage(uuid)'::regprocedure)
    !~* 'coach_programmes|coach_programme_enrollments',
  'peer usage resolves programme enrollment/module config');
select ok(pg_get_functiondef('public.enforce_coach_as_coachee_limit()'::regprocedure)
    !~* 'coach_programmes|coach_programme_enrollments',
  'completion enforcement resolves programme enrollment/module config');
select ok(pg_get_functiondef('public.get_mentoring_received_limit(uuid)'::regprocedure)
    !~* 'coach_programmes|coach_programme_enrollments',
  'mentoring received limit resolves programme enrollment/module config');
select ok(pg_get_functiondef('public.get_mentoring_given_limit(uuid)'::regprocedure)
    !~* 'coach_programmes|coach_programme_enrollments',
  'mentoring given limit resolves programme enrollment/module config');
select ok(pg_get_functiondef('public.get_mentoring_session_usage(uuid)'::regprocedure)
    !~* 'coach_programmes|coach_programme_enrollments',
  'mentoring received usage is enrollment-scoped');
select ok(pg_get_functiondef('public.get_mentoring_given_usage(uuid)'::regprocedure)
    !~* 'coach_programmes|coach_programme_enrollments',
  'mentoring given usage is enrollment-scoped');
select ok(pg_get_functiondef('public.can_book_session(uuid,uuid,uuid)'::regprocedure)
    !~* 'coach_programmes|coach_programme_enrollments',
  'booking authorization has no legacy coach programme dependency');

select * from finish();
rollback;