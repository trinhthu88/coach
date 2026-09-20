-- Learner session history + canonical reflection feed.
--
-- Self-contained fixture reproducing the reported Emerging Leaders case
-- (triad requirement 2 with one completed + one confirmed session in the
-- unit 1 group; peer requirement 2 with more history than required).
-- Proves:
--   * module progress and session history agree on WHICH sessions are
--     programme evidence, while history keeps every record and real status;
--   * triad sessions are history for every group member (membership);
--   * given peer sessions stay visible but are not this learner's evidence;
--   * the reflection feed projects every learner-authored source, skips
--     rating-only / blank rows, and never exposes coach/mentor/provider notes.
begin;

select plan(25);

-- Fixture: one programme/cohort reproducing the reported Emerging Leaders
-- case. Learner 1 is "our" learner; 2 and 3 are peers/triad members; 9 is a
-- coach; 8 a mentor. Requirements: coaching 2, peer 2, mentoring 1, triads 2.
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_user_meta_data, created_at, updated_at, confirmation_token, email_change_token_new, recovery_token)
select ('a7000000-0000-0000-0000-00000000000' || n)::uuid, '00000000-0000-0000-0000-000000000000'::uuid,
  'authenticated', 'authenticated', 'history-feed-' || n || '@example.test', 'test', now(),
  jsonb_build_object('full_name', 'History Feed ' || n), now(), now(), '', '', ''
from generate_series(1, 9) n;

insert into public.user_roles (user_id, role) values
  ('a7000000-0000-0000-0000-000000000009', 'coach'), ('a7000000-0000-0000-0000-000000000008', 'coach');
insert into public.coach_profiles (id, approval_status, peer_coaching_opt_in) values
  ('a7000000-0000-0000-0000-000000000009', 'active', false), ('a7000000-0000-0000-0000-000000000008', 'active', false);

insert into public.organizations (id, name) values ('b7000000-0000-0000-0000-000000000001', 'History feed org');
insert into public.programmes (id, name) values ('c7000000-0000-0000-0000-000000000001', 'History feed programme');
insert into public.cohorts (id, name, programme_id, organization_id, start_date, end_date)
values ('d7000000-0000-0000-0000-000000000001', 'History feed cohort', 'c7000000-0000-0000-0000-000000000001',
  'b7000000-0000-0000-0000-000000000001', date '2026-01-05', date '2026-07-05');
insert into public.programme_modules (programme_id, module, enabled, config) values
  ('c7000000-0000-0000-0000-000000000001', 'coaching', true, '{"required":true,"required_units":2,"receive_limit":5,"distribution_mode":"flexible","distribution_settings":{}}'),
  ('c7000000-0000-0000-0000-000000000001', 'peer_coaching', true, '{"required":true,"required_units":2,"distribution_mode":"flexible","distribution_settings":{}}'),
  ('c7000000-0000-0000-0000-000000000001', 'mentoring', true, '{"required":true,"required_units":1,"distribution_mode":"flexible","distribution_settings":{}}'),
  ('c7000000-0000-0000-0000-000000000001', 'triads', true, '{"required":true,"required_units":2,"distribution_mode":"flexible","distribution_settings":{}}');

insert into public.programme_enrollments (id, user_id, programme_id, cohort_id, organization_id, start_date, end_date, status)
select ('e7000000-0000-0000-0000-00000000000' || n)::uuid, ('a7000000-0000-0000-0000-00000000000' || n)::uuid,
  'c7000000-0000-0000-0000-000000000001', 'd7000000-0000-0000-0000-000000000001',
  'b7000000-0000-0000-0000-000000000001', date '2026-01-05', date '2026-07-05', 'active'
from generate_series(1, 3) n;

update public.profiles set peer_coaching_opt_in = true
where id in ('a7000000-0000-0000-0000-000000000001', 'a7000000-0000-0000-0000-000000000002', 'a7000000-0000-0000-0000-000000000003');

insert into public.mentor_profiles (coach_user_id, is_active, bio)
values ('a7000000-0000-0000-0000-000000000008', true, 'Fixture mentor');
insert into public.mentoring_allowlist (mentee_user_id, mentor_user_id)
values ('a7000000-0000-0000-0000-000000000001', 'a7000000-0000-0000-0000-000000000008');

insert into public.coachee_coach_allowlist (coachee_id, coach_id)
values ('a7000000-0000-0000-0000-000000000001', 'a7000000-0000-0000-0000-000000000009');

-- Each session is inserted with the booking learner as auth.uid(), as the app
-- does, so the real booking/entitlement triggers apply.
select set_config('request.jwt.claim.sub', 'a7000000-0000-0000-0000-000000000001', true);

-- Coaching: 2 completed (attributed on insert by the canonical trigger).

-- Programme Mentoring eligibility is the COHORT mentor pool
-- (20260920200000_cohort_mentors); mentoring_allowlist is only the historical
-- pairing and no longer grants programme Mentoring.
insert into public.cohort_mentors (cohort_id, mentor_user_id)
select distinct e.cohort_id, a.mentor_user_id
from public.mentoring_allowlist a
join public.programme_enrollments e on e.user_id = a.mentee_user_id
where e.cohort_id is not null
on conflict (cohort_id, mentor_user_id) do nothing;

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

insert into public.sessions (id, coach_id, coachee_id, topic, start_time, duration_minutes, status, enrollment_id, coachee_notes, coach_notes, coachee_rating, coachee_rating_comment)
values
  ('f7000000-0000-0000-0000-000000000001', 'a7000000-0000-0000-0000-000000000009', 'a7000000-0000-0000-0000-000000000001',
   'Coaching one', '2026-01-12T10:00:00Z', 60, 'completed', 'e7000000-0000-0000-0000-000000000001',
   'Coaching reflection: I interrupt when anxious.', 'COACH SHARED NOTE', 5, 'Rating comment: very useful.'),
  ('f7000000-0000-0000-0000-000000000002', 'a7000000-0000-0000-0000-000000000009', 'a7000000-0000-0000-0000-000000000001',
   'Coaching two', '2026-01-26T10:00:00Z', 60, 'completed', 'e7000000-0000-0000-0000-000000000001', null, null, 4, null);

-- The learner's Coaching reflection is a session_learning_reflections row
-- (20260921190000). sessions.coachee_notes is historical for Coaching: the
-- migration copies notes that existed when it ran, but a fixture creating a
-- session afterwards has to write the canonical record itself.
insert into public.session_learning_reflections
  (enrollment_id, source_activity_type, source_activity_id, body)
values ('e7000000-0000-0000-0000-000000000001', 'coaching',
        'f7000000-0000-0000-0000-000000000001',
        'Coaching reflection: I interrupt when anxious.')
on conflict (enrollment_id, source_activity_type, source_activity_id) do nothing;

-- Peer practice: learner 1 received 3 completed (requirement is 2) and gave 2
-- (stored under learner 2's enrollment, same cohort).
insert into public.coachee_peer_sessions (id, peer_provider_id, peer_receiver_id, topic, start_time, duration_minutes, status, enrollment_id, receiver_notes, provider_notes, provider_private_notes)
values
  ('f7000000-0000-0000-0000-000000000011', 'a7000000-0000-0000-0000-000000000002', 'a7000000-0000-0000-0000-000000000001', 'Peer received 1', '2026-02-02T10:00:00Z', 60, 'completed', 'e7000000-0000-0000-0000-000000000001', 'Peer reflection: open questions helped.', 'PROVIDER SHARED NOTE', 'PROVIDER PRIVATE NOTE'),
  ('f7000000-0000-0000-0000-000000000012', 'a7000000-0000-0000-0000-000000000002', 'a7000000-0000-0000-0000-000000000001', 'Peer received 2', '2026-03-02T10:00:00Z', 60, 'completed', 'e7000000-0000-0000-0000-000000000001', null, null, null),
  ('f7000000-0000-0000-0000-000000000013', 'a7000000-0000-0000-0000-000000000003', 'a7000000-0000-0000-0000-000000000001', 'Peer received 3', '2026-03-16T10:00:00Z', 60, 'completed', 'e7000000-0000-0000-0000-000000000001', null, null, null);
select set_config('request.jwt.claim.sub', 'a7000000-0000-0000-0000-000000000002', true);
insert into public.coachee_peer_sessions (id, peer_provider_id, peer_receiver_id, topic, start_time, duration_minutes, status, enrollment_id, receiver_notes, provider_notes, provider_private_notes)
values
  ('f7000000-0000-0000-0000-000000000014', 'a7000000-0000-0000-0000-000000000001', 'a7000000-0000-0000-0000-000000000002', 'Peer given 1', '2026-02-09T10:00:00Z', 60, 'completed', 'e7000000-0000-0000-0000-000000000002', null, null, null),
  ('f7000000-0000-0000-0000-000000000015', 'a7000000-0000-0000-0000-000000000001', 'a7000000-0000-0000-0000-000000000002', 'Peer given 2', '2099-04-05T10:00:00Z', 60, 'confirmed', 'e7000000-0000-0000-0000-000000000002', null, null, null);

select set_config('request.jwt.claim.sub', 'a7000000-0000-0000-0000-000000000001', true);

-- Mentoring: 1 completed.
insert into public.mentoring_sessions (id, enrollment_id, mentor_id, mentee_id, topic, start_time, duration_minutes, status, prep_file_path, mentee_notes, mentor_notes)
values ('f7000000-0000-0000-0000-000000000021', 'e7000000-0000-0000-0000-000000000001', 'a7000000-0000-0000-0000-000000000008',
  'a7000000-0000-0000-0000-000000000001', 'Mentoring one', '2026-01-19T10:00:00Z', 60, 'completed', 'prep/file.pdf',
  'Mentoring reflection: map stakeholders earlier.', 'MENTOR NOTE');

-- Triads: a Triad 1 group with a completed session and a Triad 2 group with
-- a confirmed one (every required Triad has its own group assignment).
-- Membership is by enrollment.
insert into public.triad_groups (id, cohort_requirement_date_id, is_active)
select g.id, d.id, true
from (values ('f7000000-0000-0000-0000-000000000030'::uuid, 1), ('f7000000-0000-0000-0000-000000000040'::uuid, 2)) g(id, ordinal)
join public.cohort_requirement_dates d on d.cohort_id = 'd7000000-0000-0000-0000-000000000001'
  and d.programme_id = 'c7000000-0000-0000-0000-000000000001' and d.module = 'triads' and d.ordinal = g.ordinal;
insert into public.triad_group_members (triad_group_id, enrollment_id, member_order)
select g, e, o from unnest(array['f7000000-0000-0000-0000-000000000030', 'f7000000-0000-0000-0000-000000000040']::uuid[]) g
cross join (values ('e7000000-0000-0000-0000-000000000001'::uuid, 1), ('e7000000-0000-0000-0000-000000000002'::uuid, 2),
                   ('e7000000-0000-0000-0000-000000000003'::uuid, 3)) m(e, o);
insert into public.triad_sessions (id, triad_group_id, scheduled_start_time, status)
values
  ('f7000000-0000-0000-0000-000000000031', 'f7000000-0000-0000-0000-000000000030', '2026-02-16T10:00:00Z', 'completed'),
  ('f7000000-0000-0000-0000-000000000032', 'f7000000-0000-0000-0000-000000000040', '2099-04-20T10:00:00Z', 'confirmed');

insert into public.triad_reflections (id, triad_session_id, enrollment_id, satisfaction_rating)
values ('f7000000-0000-0000-0000-000000000033', 'f7000000-0000-0000-0000-000000000031',
  'e7000000-0000-0000-0000-000000000001', 4);
insert into public.triad_reflection_answers (triad_reflection_id, question_id, answer_text)
values ('f7000000-0000-0000-0000-000000000033', '7d1a0000-0000-4000-8000-000000000001', 'Triad reflection: silence is useful.');

-- Goal check-ins by the learner: one with a comment, one rating-only; plus a
-- check-in note written by the coach (not a learner reflection).
insert into public.coachee_goals (id, coachee_id, enrollment_id, title)
values ('f7000000-0000-0000-0000-000000000040', 'a7000000-0000-0000-0000-000000000001', 'e7000000-0000-0000-0000-000000000001', 'Delegate more');
insert into public.goal_checkins (enrollment_id, goal_id, source_activity_type, source_activity_id, previous_rating, new_rating, note, actor_user_id) values
  ('e7000000-0000-0000-0000-000000000001', 'f7000000-0000-0000-0000-000000000040', 'coaching', 'f7000000-0000-0000-0000-000000000001', 70, 80, 'Goal check-in: I noticed that I delegate more.', 'a7000000-0000-0000-0000-000000000001'),
  ('e7000000-0000-0000-0000-000000000001', 'f7000000-0000-0000-0000-000000000040', 'coaching', 'f7000000-0000-0000-0000-000000000002', 80, 85, '   ', 'a7000000-0000-0000-0000-000000000001'),
  ('e7000000-0000-0000-0000-000000000001', 'f7000000-0000-0000-0000-000000000040', 'coaching', 'f7000000-0000-0000-0000-000000000002', 85, 86, 'COACH CHECKIN NOTE', 'a7000000-0000-0000-0000-000000000009');

-- Training reflection prompt answer + explicit My Journey reflection.
insert into public.training_weeks (id, programme_id, week_number, title, is_visible)
values ('f7000000-0000-0000-0000-000000000050', 'c7000000-0000-0000-0000-000000000001', 1, 'Week one', true);
insert into public.programme_reflections (id, programme_id, reflection_number, title, appears_at_week, is_visible)
values ('f7000000-0000-0000-0000-000000000051', 'c7000000-0000-0000-0000-000000000001', 1, 'Week one reflection', 1, true);
insert into public.reflection_questions (id, reflection_id, question_text, question_type, sort_order)
values ('f7000000-0000-0000-0000-000000000052', 'f7000000-0000-0000-0000-000000000051', 'What did you try?', 'open_text', 1);
insert into public.reflection_submissions (id, reflection_id, user_id, enrollment_id, confidence_score, submitted_at)
values ('f7000000-0000-0000-0000-000000000053', 'f7000000-0000-0000-0000-000000000051', 'a7000000-0000-0000-0000-000000000001', 'e7000000-0000-0000-0000-000000000001', 4, '2026-01-20T10:00:00Z');
insert into public.reflection_answers (submission_id, question_id, answer_text)
values ('f7000000-0000-0000-0000-000000000053', 'f7000000-0000-0000-0000-000000000052', 'Training reflection: I tried pausing.');

insert into public.coachee_reflections (coachee_id, enrollment_id, body, mood)
values ('a7000000-0000-0000-0000-000000000001', 'e7000000-0000-0000-0000-000000000001', 'Journey reflection: proud of this week.', 'proud');

-- ===== Session history, read as learner 1 =====
select set_config('request.jwt.claim.sub', 'a7000000-0000-0000-0000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

create temporary table history as
select * from public.learner_session_history('e7000000-0000-0000-0000-000000000001');
create temporary table modules as
select module::text, required_units, completed_units
from public.learner_canonical_module_progress('e7000000-0000-0000-0000-000000000001');

select is((select completed_units || '/' || required_units from modules where module = 'triads'), '1/2',
  'triad module progress is 1/2 (a confirmed session is not completed evidence)');
select results_eq(
  $$select status from history where session_type = 'triad' order by start_time$$,
  $$values ('completed'::text), ('confirmed'::text)$$,
  'both triad sessions remain in history with their real statuses'
);
select is((select count(*)::integer from history where session_type = 'triad' and is_programme_evidence), 1,
  'exactly the completed triad session is programme evidence');
select ok(pg_get_function_result('public.learner_session_history(uuid)'::regprocedure) !~ 'round_number|training_week_number',
  'triad sessions carry no round / requirement unit (a session belongs to its group only)');

select is((select completed_units || '/' || required_units from modules where module = 'peer_coaching'), '2/2',
  'peer module progress caps at 2/2');
select is((select count(*)::integer from history where session_type = 'peer_coaching'), 5,
  'peer history keeps all five records (3 received + 2 given)');
select is((select count(*)::integer from history where session_type = 'peer_coaching' and is_programme_evidence), 3,
  'all three received completed sessions are evidence; the requirement cap is applied by module progress');
select ok(
  (select bool_and(not is_programme_evidence) from history where session_type = 'peer_coaching' and participant_role = 'provider'),
  'peer sessions the learner gave are history but not this enrollment''s evidence'
);
select is((select count(*)::integer from history where source_table = 'coachee_peer_sessions'), 5,
  'a coachee''s peer history comes from coachee_peer_sessions, not the coach-to-coach table');

select is(
  (select count(*)::integer from history where is_programme_evidence and module = 'coaching'),
  (select completed_units from modules where module = 'coaching'),
  'coaching evidence rows reconcile to canonical coaching completion'
);
select is(
  (select count(*)::integer from history where is_programme_evidence and module = 'mentoring'),
  (select completed_units from modules where module = 'mentoring'),
  'mentoring evidence rows reconcile to canonical mentoring completion'
);

select is((select count(*)::integer from public.learner_session_history('e7000000-0000-0000-0000-000000000002')), 0,
  'a learner cannot read another learner''s session history');

-- ===== Reflection feed, read as learner 1 =====
create temporary table feed as
select * from public.learner_reflection_feed('e7000000-0000-0000-0000-000000000001');

select ok(exists(select 1 from feed where source_type = 'coaching_session_reflection' and body like 'Coaching reflection:%'
    and linked_session_table = 'sessions'),
  'coaching session reflection appears in the feed, linked to its session');
select ok(exists(select 1 from feed where source_type = 'coaching_session_rating' and rating = 5),
  'the learner''s own session rating comment appears with its rating');
select ok(exists(select 1 from feed where source_type = 'peer_session_reflection' and body like 'Peer reflection:%'),
  'peer practice reflection appears in the feed');
select ok(exists(select 1 from feed where source_type = 'mentoring_session_reflection' and body like 'Mentoring reflection:%'),
  'mentoring reflection appears in the feed');
select ok(exists(select 1 from feed where source_type = 'triad_reflection' and body like 'Triad reflection:%' and rating = 4),
  'triad reflection appears with its self-rating');
select ok(exists(select 1 from feed where source_type = 'goal_checkin' and body like 'Goal check-in:%'
    and previous_rating = 70 and rating = 80 and linked_goal_id is not null and linked_session_table = 'sessions'),
  'goal check-in with a comment appears with goal, rating change and linked session');
select is((select count(*)::integer from feed where source_type = 'goal_checkin' and previous_rating = 80 and rating = 85), 0,
  'a goal rating with no comment does not create a blank reflection');
select ok(exists(select 1 from feed where source_type = 'training_reflection' and body like 'Training reflection:%'
    and details->'answers'->0->>'question' = 'What did you try?'),
  'training / learning reflection prompt answers appear with their question');
select ok(exists(select 1 from feed where source_type = 'journey_reflection' and is_private and details->>'mood' = 'proud'),
  'explicit My Journey reflections appear, marked private');
select is(
  (select count(*)::integer from feed where body ~ 'COACH SHARED NOTE|PROVIDER PRIVATE NOTE|PROVIDER SHARED NOTE|MENTOR NOTE|COACH CHECKIN NOTE'),
  0,
  'coach, mentor and provider notes, and coach-written check-ins, never appear as learner reflections'
);
select ok(
  pg_get_functiondef('public.learner_reflection_feed(uuid)'::regprocedure)
    !~ 'coach_notes|coach_private_notes|provider_notes|provider_private_notes|mentor_notes|mentoring_feedback|coach_session_feedback',
  'the feed never selects coach/mentor/provider-authored columns'
);
select ok((select bool_and(nullif(btrim(body), '') is not null) from feed),
  'every feed row carries learner-authored text');

select is((select count(*)::integer from public.learner_reflection_feed('e7000000-0000-0000-0000-000000000002')), 0,
  'a learner cannot read another learner''s reflections');

select * from finish();
rollback;
