begin;
select plan(81);
select is((select count(*)::int from programmes where id in
 ('11111111-1111-4111-8111-111111111112','11111111-1111-4111-8111-111111111113')),2,'exactly two programmes');
select is((select count(*)::int from cohorts where id in
 ('11111111-1111-4111-8111-111111111114','11111111-1111-4111-8111-111111111115')),2,'exactly two cohorts');
select is((select count(*)::int from programme_enrollments where cohort_id in
 ('11111111-1111-4111-8111-111111111114','11111111-1111-4111-8111-111111111115')),10,'ten enrollments');
select is((select count(distinct user_id)::int from programme_enrollments where cohort_id in
 ('11111111-1111-4111-8111-111111111114','11111111-1111-4111-8111-111111111115')),10,'ten distinct leaders');
select is((select count(*)::int from programme_enrollments where status in ('active','at_risk','paused')
 and cohort_id in ('11111111-1111-4111-8111-111111111114','11111111-1111-4111-8111-111111111115')),10,'all ongoing');
select is((select count(*)::int from cohorts where programme_id in
 ('11111111-1111-4111-8111-111111111112','11111111-1111-4111-8111-111111111113')),2,'one cohort per programme');
select is((select count(*)::int from programme_modules where programme_id='11111111-1111-4111-8111-111111111113'
 and enabled and (config->>'weight') is not null),5,'B weighted modules');
select is((select count(*)::int from sessions s join programme_enrollments e on e.id=s.enrollment_id
  where e.cohort_id in ('11111111-1111-4111-8111-111111111114','11111111-1111-4111-8111-111111111115')),25,'all coaching sessions enrollment-owned');
select is((select count(*)::int from sessions s join programme_enrollments e on e.id=s.enrollment_id
  where s.coachee_id=e.user_id),25,'coaching participant ownership matches enrollment');
select is((select count(*)::int from goal_checkins c join sessions s on s.id=c.source_activity_id
 where c.enrollment_id=s.enrollment_id and s.status='completed'),9,'checkins reference completed owned sessions');
select is((select count(*)::int from goal_checkins c join programme_enrollments e on e.id=c.enrollment_id
 where c.actor_user_id=e.user_id and c.source_activity_type='coaching'),9,'checkin actor and source ownership match');
select is((select count(*)::int from goal_checkins c
  left join sessions s on s.id=c.source_activity_id
  where c.source_activity_type='coaching' and (s.id is null or s.status <> 'completed')),0,
  'no checkin references a missing or non-completed session');
select is((select count(*)::int from goal_checkins c join sessions s on s.id=c.source_activity_id
  where c.source_activity_type='coaching' and c.enrollment_id <> s.enrollment_id),0,
  'checkin source enrollment matches');
select ok(not exists(select 1 from profiles where id in
 ('ee000000-0000-0000-0000-000000000010','ee000000-0000-0000-0000-000000000020','ee000000-0000-0000-0000-000000000030')),
 'obsolete identities absent');
select has_function('public','admin_create_programme_enrollment',
 array['uuid','uuid','uuid','uuid','date','date'],'authoritative enrollment RPC exists');
-- The reset fixture owns exactly these identities in its own organisation.  Do
-- not assert global totals: a local database may deliberately preserve other
-- organisations/programmes.
select is((select count(distinct p.id)::int from programmes p
  join cohorts c on c.programme_id=p.id
  where c.organization_id='11111111-1111-4111-8111-111111111111'
    and p.id in ('11111111-1111-4111-8111-111111111112','11111111-1111-4111-8111-111111111113')),2,
  'exactly two fixture programmes in the demo organisation');
select is((select count(*)::int from cohorts
  where organization_id='11111111-1111-4111-8111-111111111111'
    and id in ('11111111-1111-4111-8111-111111111114','11111111-1111-4111-8111-111111111115')),2,
  'exactly two fixture cohorts in the demo organisation');
select is((select count(*)::int from programme_enrollments where status in ('active','at_risk','paused')
  group by user_id having count(*)>1),NULL,'no leader has multiple ongoing enrollments');
select is((select count(*)::int from programme_enrollments where id in
 ('12121212-1212-4121-8121-000000000001','12121212-1212-4121-8121-000000000010')),2,'enrollment IDs are stable fixed IDs');
select is((select count(*)::int from profiles where email in ('admin@demo.clariva.club','provider.1@demo.clariva.club','provider.2@demo.clariva.club')),3,'admin and providers are preserved fixtures');
select is((select count(*)::int from user_roles r join profiles p on p.id=r.user_id where p.email like 'provider.%@demo.clariva.club' and r.role='coach'),2,'two deterministic provider roles exist');
select has_function('public','sponsor_satisfaction_summary',array['uuid'],'numeric sponsor satisfaction RPC exists');
select ok(has_function_privilege('authenticated','public.sponsor_satisfaction_summary(uuid)','EXECUTE'),'sponsor satisfaction RPC is callable by authenticated users');
select is((select count(*)::int from programme_enrollments where cohort_id='11111111-1111-4111-8111-111111111114'),5,'A has five leaders');
select is((select count(*)::int from programme_enrollments where cohort_id='11111111-1111-4111-8111-111111111115'),5,'B has five leaders');
select is((select count(*)::int from programme_enrollments where user_id in
 (select user_id from programme_enrollments where cohort_id='11111111-1111-4111-8111-111111111114')
 and cohort_id='11111111-1111-4111-8111-111111111115'),0,'cohort rosters are disjoint');
select is((select count(*)::int from programme_modules where programme_id='11111111-1111-4111-8111-111111111112'),1,'A is coaching-only');
select is((select sum((config->>'weight')::numeric) from programme_modules where programme_id='11111111-1111-4111-8111-111111111113'),100::numeric,'B weights total 100');
select is((select count(*)::int from training_weeks where programme_id='11111111-1111-4111-8111-111111111113'),4,'B has training weeks');
select is((select count(*)::int from training_progress tp join programme_enrollments e on e.id=tp.enrollment_id where e.cohort_id='11111111-1111-4111-8111-111111111115'),11,'training progress is enrollment-owned');
select is((select count(*)::int from training_progress tp join programme_enrollments e on e.id=tp.enrollment_id
  where e.cohort_id='11111111-1111-4111-8111-111111111115' and e.user_id=(select user_id from programme_enrollments where cohort_id='11111111-1111-4111-8111-111111111115' order by id offset 2 limit 1)),4,'B3 training is complete');
select is((select count(*)::int from training_progress tp join programme_enrollments e on e.id=tp.enrollment_id
  where e.cohort_id='11111111-1111-4111-8111-111111111115' and e.user_id=(select user_id from programme_enrollments where cohort_id='11111111-1111-4111-8111-111111111115' order by id offset 3 limit 1)),1,'B4 training is behind');
select is((select count(*)::int from assignment_submissions s join programme_enrollments e on e.id=s.enrollment_id where e.cohort_id='11111111-1111-4111-8111-111111111115'),11,'assignment submissions are owned');
select is((select count(*)::int from daily_prompt_responses r join programme_enrollments e on e.id=r.enrollment_id where e.cohort_id='11111111-1111-4111-8111-111111111115'),7,'prompt responses are owned');
select is((select count(*)::int from reflection_submissions r join programme_enrollments e on e.id=r.enrollment_id where e.cohort_id='11111111-1111-4111-8111-111111111115'),8,'reflections are owned');
select is((select count(*)::int from triad_sessions t where t.coach_enrollment_id is not null and t.coachee_enrollment_id is not null and t.observer_enrollment_id is not null),1,'triad roles are enrollment-owned');
select is((select count(*)::int from peer_sessions p join programme_enrollments e on e.id=p.enrollment_id where e.cohort_id='11111111-1111-4111-8111-111111111115'),2,'peer sessions are owned');
select is((select count(*)::int from mentoring_sessions m join programme_enrollments e on e.id=m.enrollment_id where e.cohort_id='11111111-1111-4111-8111-111111111115'),2,'mentoring sessions are owned');
select is((select count(*)::int from programme_enrollments where status='paused'),1,'A5 is paused');
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111116',true);
select set_config('request.jwt.claim.role','authenticated',true);
set local role authenticated;
select is((select count(*)::int from coachee_goals),0,'sponsor cannot directly read goals');
select is((select count(*)::int from enrollment_actions),0,'sponsor cannot directly read actions');
select is((select count(*)::int from coach_session_private_notes),0,'sponsor cannot directly read coach notes');
select is((select count(*)::int from assignment_submissions),0,'sponsor cannot directly read assignment content');
select is((select count(*)::int from daily_prompt_responses),0,'sponsor cannot directly read prompt responses');
select is((select count(*)::int from reflection_submissions),0,'sponsor cannot directly read reflections');
select is((select count(*)::int from mentoring_sessions),0,'sponsor cannot directly read mentoring private fields');
select is((select count(*)::int from peer_sessions),0,'sponsor cannot directly read peer private fields');
select is((select count(*)::int from triad_sessions),0,'sponsor cannot directly read triad private fields');
reset role;
select is((select count(*)::int from programme_enrollments where id::text like 'ee000000-%'),0,'obsolete enrollment range absent');
select is((select count(*)::int from sessions where id::text like 'ee000000-%'),0,'obsolete session range absent');
select is((select count(*)::int from coachee_goals where id::text like 'ee000000-%'),0,'obsolete goal range absent');
select is((select count(*)::int from enrollment_actions where id::text like 'ee000000-%'),0,'obsolete action range absent');
select is((select count(*)::int from training_progress where id::text like 'ee000000-%'),0,'obsolete training range absent');
select is((select count(*)::int from assignment_submissions where id::text like 'ee000000-%'),0,'obsolete assignment range absent');
select is((select count(*)::int from peer_sessions where id::text like 'ee000000-%'),0,'obsolete peer range absent');
select is((select count(*)::int from mentoring_sessions where id::text like 'ee000000-%'),0,'obsolete mentoring range absent');
select is((select count(*)::int from triad_sessions where id::text like 'ee000000-%'),0,'obsolete triad range absent');
select is((select pace_status from get_enrollment_progress('12121212-1212-4121-8121-000000000001','2026-11-01') where module='coaching'),'ahead','A1 coaching fixed-as-of ahead');
select is((select pace_status from get_enrollment_progress('12121212-1212-4121-8121-000000000002','2026-11-01') where module='coaching'),'on_track','A2 coaching fixed-as-of on track');
select is((select pace_status from get_enrollment_progress('12121212-1212-4121-8121-000000000003','2026-11-01') where module='coaching'),'behind','A3 coaching fixed-as-of behind');
select is((select pace_status from get_enrollment_progress('12121212-1212-4121-8121-000000000004','2026-11-01') where module='coaching'),'scheduled','A4 coaching fixed-as-of scheduled');
select is((select count(*)::int from get_enrollment_progress('12121212-1212-4121-8121-000000000010','2026-11-01') where pace_status='not_yet_due'),5,'B5 all modules fixed-as-of not yet due');
select is((select start_date from programme_enrollments where id='12121212-1212-4121-8121-000000000010'),'2026-11-15','B5 exact recent start date');
select is((select count(*)::int from coachee_goals where enrollment_id='12121212-1212-4121-8121-000000000010'),0,'B5 has no goals');
select is((select count(*)::int from enrollment_actions where enrollment_id='12121212-1212-4121-8121-000000000010'),0,'B5 has no actions');
select is((select count(*)::int from goal_checkins where enrollment_id='12121212-1212-4121-8121-000000000010'),0,'B5 has no check-ins');
select ok((select status='paused' from programme_enrollments where id='12121212-1212-4121-8121-000000000005'),'A5 paused semantics');
select ok(not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname in ('sponsor_enrollment_summaries','sponsor_cohort_summaries')
 and pg_get_function_result(p.oid) ~* '(notes?|description|title|comment|reflection|prompt|file|recording|transcript)'),'sponsor RPC contracts exclude private fields');
select is((select count(*)::int from sponsor_cohort_summaries(null)),2,'sponsor sees both cohorts');
select is((select count(*)::int from sponsor_enrollment_summaries('11111111-1111-4111-8111-111111111114')),5,'sponsor sees five A enrollments');
select is((select count(*)::int from sponsor_enrollment_summaries('11111111-1111-4111-8111-111111111115')),5,'sponsor sees five B enrollments');
select is((select count(*)::int from sponsor_satisfaction_summary('11111111-1111-4111-8111-111111111114')),1,'sponsor satisfaction is numeric aggregate');
select is((select rated_session_count from sponsor_satisfaction_summary('11111111-1111-4111-8111-111111111114')),
  (select count(*)::int from sessions s join programme_enrollments e on e.id=s.enrollment_id
   where e.cohort_id='11111111-1111-4111-8111-111111111114' and s.status='completed' and s.coachee_rating is not null),
  'sponsor satisfaction count reconciles to completed sessions');
select is((select avg_rating from sponsor_satisfaction_summary('11111111-1111-4111-8111-111111111114')),
  (select round(avg(s.coachee_rating)::numeric,2) from sessions s join programme_enrollments e on e.id=s.enrollment_id
   where e.cohort_id='11111111-1111-4111-8111-111111111114' and s.status='completed' and s.coachee_rating is not null),
  'sponsor satisfaction average reconciles');
select is((select count(*)::int from sponsor_cohort_summaries(null)),2,'sponsor exact cohort total');
select is((select count(*)::int from sponsor_enrollment_summaries('11111111-1111-4111-8111-111111111114')),5,'sponsor exact enrollment total A');
select ok(not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname in ('sponsor_enrollment_summaries','sponsor_cohort_summaries')
  and pg_get_function_result(p.oid) ~* '(notes?|description|title|comment|reflection|prompt|assignment|file|recording|transcript)'),
  'sponsor result contains no private text or content payload');
select ok(not exists(select 1 from programmes where id in ('ee000000-0000-0000-0000-000000000001','ee000000-0000-0000-0000-000000000002')),'obsolete programme IDs absent');
select ok(not exists(select 1 from cohorts where id in ('ee000000-0000-0000-0000-000000000101','ee000000-0000-0000-0000-000000000102')),'obsolete cohort IDs absent');
select is((select count(*)::int from sessions where enrollment_id is null),0,'no orphan obsolete sessions');
select is((select count(*)::int from enrollment_actions where enrollment_id is null),0,'no orphan obsolete actions');
select * from finish();
rollback;