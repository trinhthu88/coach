begin;
select plan(24);
insert into auth.users(id,email,raw_user_meta_data) values
 ('a5000000-0000-0000-0000-000000000001','actions-learner@example.test','{"full_name":"Action learner"}'),
 ('a5000000-0000-0000-0000-000000000002','actions-provider@example.test','{"full_name":"Action provider"}'),
 ('a5000000-0000-0000-0000-000000000003','actions-outsider@example.test','{"full_name":"Action outsider"}');
insert into public.programmes(id,name,duration_months) values ('a5000000-0000-0000-0000-000000000010','Action test',3);
insert into public.cohorts(id,name,programme_id,start_date,end_date) values ('a5000000-0000-0000-0000-000000000020','Action cohort','a5000000-0000-0000-0000-000000000010','2026-01-01','2026-04-01');
insert into public.programme_enrollments(id,user_id,programme_id,cohort_id,start_date,end_date,status) values
 ('a5000000-0000-0000-0000-000000000031','a5000000-0000-0000-0000-000000000001','a5000000-0000-0000-0000-000000000010','a5000000-0000-0000-0000-000000000020','2026-01-01','2026-04-01','active'),
 ('a5000000-0000-0000-0000-000000000032','a5000000-0000-0000-0000-000000000003','a5000000-0000-0000-0000-000000000010','a5000000-0000-0000-0000-000000000020','2026-01-01','2026-04-01','active');
insert into public.sessions(id,coach_id,coachee_id,enrollment_id,topic,start_time,duration_minutes,status) values
  ('a5000000-0000-0000-0000-000000000041','a5000000-0000-0000-0000-000000000002','a5000000-0000-0000-0000-000000000001','a5000000-0000-0000-0000-000000000031','Action session','2026-02-01',60,'completed'),
  ('a5000000-0000-0000-0000-000000000043','a5000000-0000-0000-0000-000000000002','a5000000-0000-0000-0000-000000000001','a5000000-0000-0000-0000-000000000031','Second completed session','2026-02-03',60,'completed'),
 ('a5000000-0000-0000-0000-000000000042','a5000000-0000-0000-0000-000000000002','a5000000-0000-0000-0000-000000000003','a5000000-0000-0000-0000-000000000032','Other action session','2026-02-02',60,'confirmed');
insert into public.coachee_goals(id,coachee_id,enrollment_id,title) values
 ('a5000000-0000-0000-0000-000000000051','a5000000-0000-0000-0000-000000000001','a5000000-0000-0000-0000-000000000031','Goal one'),
 ('a5000000-0000-0000-0000-000000000052','a5000000-0000-0000-0000-000000000001','a5000000-0000-0000-0000-000000000031','Goal two');

insert into public.coachee_goals(id,coachee_id,enrollment_id,title) values
 ('a5000000-0000-0000-0000-000000000053','a5000000-0000-0000-0000-000000000001','a5000000-0000-0000-0000-000000000031','Goal three');
select throws_ok($$insert into public.coachee_goals(coachee_id,enrollment_id,title) values('a5000000-0000-0000-0000-000000000001','a5000000-0000-0000-000000000031','Fourth')$$,'P0001','This enrollment already has the maximum of 3 active goals','fourth active goal rejected');
select lives_ok($$update public.coachee_goals set title='Updated' where id='a5000000-0000-0000-0000-000000000053'$$,'editing an existing active goal does not count it twice');
select set_config('request.jwt.claim.sub','a5000000-0000-0000-0000-000000000001',true);
select lives_ok($$select public.record_goal_checkin('a5000000-0000-0000-0000-000000000031','a5000000-0000-0000-0000-000000000051','coaching','a5000000-0000-0000-0000-000000000041',null,'Unrated note')$$,'unrated check-in is allowed');
select is((select new_rating from public.goal_checkins where goal_id='a5000000-0000-0000-0000-000000000051'),null::smallint,'unrated check-in never invents 50');
select lives_ok($$select public.record_goal_checkin('a5000000-0000-0000-0000-000000000031','a5000000-0000-0000-0000-000000000051','coaching','a5000000-0000-0000-000000000041',65::smallint,null)$$,'entered rating can be saved without fabricated baseline');
select is((select count(*)::integer from public.goal_checkins where goal_id='a5000000-0000-0000-0000-000000000051'),2,'later check-ins preserve earlier history');
select is((select start_rating from public.coachee_goal_ratings where goal_id='a5000000-0000-0000-0000-000000000051'),null::smallint,'missing baseline remains null');
select is((select current_rating from public.coachee_goal_ratings where goal_id='a5000000-0000-0000-0000-000000000051'),65::smallint,'explicit rating updates enrollment current rating');
select throws_ok($$select public.record_goal_checkin('a5000000-0000-0000-0000-000000000031','a5000000-0000-0000-0000-000000000051','coaching','a5000000-0000-0000-0000-000000000042',65::smallint,null)$$,'42501','Coaching session is not a completed session in this enrollment','foreign-enrollment source rejected');
select throws_ok($$select public.record_goal_checkin('a5000000-0000-0000-0000-000000000031','a5000000-0000-0000-0000-000000000051','unknown','a5000000-0000-0000-0000-000000000041',65::smallint,null)$$,'22023','Unsupported goal check-in source','unknown source rejected');
select set_config('request.jwt.claim.sub','a5000000-0000-0000-0000-000000000003',true);
select throws_ok($$select public.record_goal_checkin('a5000000-0000-0000-0000-000000000031','a5000000-0000-0000-0000-000000000051','coaching','a5000000-0000-0000-0000-000000000041',65::smallint,null)$$,'42501','Only the learner can record a goal check-in','other learner cannot check in');
select set_config('request.jwt.claim.sub','',true);
select throws_ok($$select public.record_goal_checkin('a5000000-0000-0000-0000-000000000031','a5000000-0000-0000-0000-000000000051','coaching','a5000000-0000-0000-0000-000000000041',65::smallint,null)$$,'42501','Only the learner can record a goal check-in','null actor cannot bypass authorization');
select set_config('request.jwt.claim.sub','a5000000-0000-0000-0000-000000000001',true);
select lives_ok($$select public.record_goal_checkin('a5000000-0000-0000-0000-000000000031','a5000000-0000-0000-0000-000000000051','coaching','a5000000-0000-0000-0000-000000000041',null,'Discussed without a new rating')$$,'note-only check-in after rating succeeds');
select is((select current_rating from public.coachee_goal_ratings where goal_id='a5000000-0000-0000-0000-000000000051'),65::smallint,'missing new rating leaves current value unchanged');
select is((select count(*)::integer from public.goal_checkins where goal_id='a5000000-0000-0000-0000-000000000052'),0,'unselected goal has no check-in');
select lives_ok($$select public.record_goal_checkins('a5000000-0000-0000-0000-000000000031','coaching','a5000000-0000-0000-0000-000000000041','[{"goal_id":"a5000000-0000-0000-0000-000000000052","new_rating":null,"note":null}]'::jsonb,'a5000000-0000-0000-0000-000000000099')$$,'batch check-in is atomic and accepts null rating');
select lives_ok($$select public.record_goal_checkins('a5000000-0000-0000-0000-000000000031','coaching','a5000000-0000-0000-0000-000000000041','[{"goal_id":"a5000000-0000-0000-0000-000000000052","new_rating":null,"note":null}]'::jsonb,'a5000000-0000-0000-0000-000000000099')$$,'retry returns the same submission safely');
select is((select count(*)::integer from public.goal_checkins where goal_id='a5000000-0000-0000-0000-000000000052'),1,'retry does not duplicate immutable history');
select throws_ok($$select public.record_goal_checkins('a5000000-0000-0000-0000-000000000031','coaching','a5000000-0000-0000-0000-000000000043','[{"goal_id":"a5000000-0000-0000-0000-000000000052","new_rating":null,"note":null}]'::jsonb,'a5000000-0000-0000-0000-000000000099')$$,'22023','Submission ID was already used with a different request','changed source is rejected');
select throws_ok($$select public.record_goal_checkins('a5000000-0000-0000-0000-000000000031','coaching','a5000000-0000-0000-0000-000000000041','[{"goal_id":"a5000000-0000-0000-0000-000000000052","new_rating":1,"note":null}]'::jsonb,'a5000000-0000-0000-0000-000000000099')$$,'22023','Submission ID was already used with a different request','changed payload is rejected');
select is((select count(*)::integer from public.goal_checkins where goal_id='a5000000-0000-0000-0000-000000000052'),1,'rejected retries do not add history');
select is((select current_rating from public.coachee_goal_ratings where goal_id='a5000000-0000-0000-0000-000000000052'),null::smallint,'rejected retries do not change current rating');
select lives_ok($$update public.coachee_goals set status='archived' where id='a5000000-0000-0000-0000-000000000051'$$,'goal with history can be archived');
select lives_ok($$insert into public.coachee_goals(coachee_id,enrollment_id,title) values('a5000000-0000-0000-0000-000000000001','a5000000-0000-0000-0000-000000000031','Replacement')$$,'archived goal frees active slot');
select * from finish();
rollback;
