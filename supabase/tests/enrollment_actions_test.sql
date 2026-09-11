begin;
select plan(27);
insert into auth.users(id,email,raw_user_meta_data) values
 ('a5000000-0000-4000-8000-000000000001','actions-learner@example.test','{"full_name":"Action learner"}'),
 ('a5000000-0000-4000-8000-000000000002','actions-provider@example.test','{"full_name":"Action provider"}'),
 ('a5000000-0000-4000-8000-000000000003','actions-outsider@example.test','{"full_name":"Action outsider"}');
insert into public.programmes(id,name,duration_months) values ('a5000000-0000-4000-8000-000000000010','Action test',3);
insert into public.cohorts(id,name,programme_id,start_date,end_date) values ('a5000000-0000-4000-8000-000000000020','Action cohort','a5000000-0000-4000-8000-000000000010','2026-01-01','2026-04-01');
insert into public.programme_enrollments(id,user_id,programme_id,cohort_id,start_date,end_date,status) values
 ('a5000000-0000-4000-8000-000000000031','a5000000-0000-4000-8000-000000000001','a5000000-0000-4000-8000-000000000010','a5000000-0000-4000-8000-000000000020','2026-01-01','2026-04-01','active'),
 ('a5000000-0000-4000-8000-000000000032','a5000000-0000-4000-8000-000000000003','a5000000-0000-4000-8000-000000000010','a5000000-0000-4000-8000-000000000020','2026-01-01','2026-04-01','active');
insert into public.sessions(id,coach_id,coachee_id,enrollment_id,topic,start_time,duration_minutes,status) values
 ('a5000000-0000-4000-8000-000000000041','a5000000-0000-4000-8000-000000000002','a5000000-0000-4000-8000-000000000001','a5000000-0000-4000-8000-000000000031','Action session','2026-02-01',60,'confirmed'),
 ('a5000000-0000-4000-8000-000000000042','a5000000-0000-4000-8000-000000000002','a5000000-0000-4000-8000-000000000003','a5000000-0000-4000-8000-000000000032','Other action session','2026-02-02',60,'confirmed');
insert into public.coachee_goals(id,coachee_id,enrollment_id,title) values
 ('a5000000-0000-4000-8000-000000000051','a5000000-0000-4000-8000-000000000001','a5000000-0000-4000-8000-000000000031','Goal one'),
 ('a5000000-0000-4000-8000-000000000052','a5000000-0000-4000-8000-000000000001','a5000000-0000-4000-8000-000000000031','Goal two');
insert into public.coachee_milestones(id,coachee_id,enrollment_id,goal_id,title) values
 ('a5000000-0000-4000-8000-000000000060','a5000000-0000-4000-8000-000000000001','a5000000-0000-4000-8000-000000000031','a5000000-0000-4000-8000-000000000051','Milestone one');
select throws_ok($$insert into public.enrollment_actions(enrollment_id,owner_user_id,title,source_activity_type,source_activity_id) values('a5000000-0000-4000-8000-000000000031','a5000000-0000-4000-8000-000000000001','Invalid','coaching','a5000000-0000-4000-8000-000000000042')$$,'42501','Action source must belong to the action enrollment','reject source from another enrollment');
select throws_ok($$insert into public.enrollment_actions(enrollment_id,owner_user_id,title,goal_id,milestone_id) values('a5000000-0000-4000-8000-000000000031','a5000000-0000-4000-8000-000000000001','Invalid','a5000000-0000-4000-8000-000000000052','a5000000-0000-4000-8000-000000000060')$$,'42501','Action milestone must belong to the action goal','reject inconsistent goal/milestone link');
select set_config('request.jwt.claim.sub','a5000000-0000-4000-8000-000000000002',true);
select lives_ok($$select public.save_enrollment_activity_actions('a5000000-0000-4000-8000-000000000031','coaching','a5000000-0000-4000-8000-000000000041','[{"id":"a5000000-0000-4000-8000-000000000070","title":"Ask for feedback","milestone_id":"a5000000-0000-4000-8000-000000000060","status":"open"}]')$$,'actual provider can save source-linked actions');
select is((select goal_id from public.enrollment_actions where id='a5000000-0000-4000-8000-000000000070'),'a5000000-0000-4000-8000-000000000051'::uuid,'saving milestone preserves its goal relationship');
select lives_ok($$select public.save_enrollment_activity_actions('a5000000-0000-4000-8000-000000000031','coaching','a5000000-0000-4000-8000-000000000041','[{"id":"a5000000-0000-4000-8000-000000000070","title":"Ask for feedback","status":"completed","milestone_id":"a5000000-0000-4000-8000-000000000060"}]')$$,'repeated save updates stable action ID');
select is((select count(*)::integer from public.enrollment_actions where source_activity_id='a5000000-0000-4000-8000-000000000041'),1,'repeated save does not duplicate action');
select throws_ok($$select public.save_enrollment_activity_actions('a5000000-0000-4000-8000-000000000032','coaching','a5000000-0000-4000-8000-000000000042','[{"id":"a5000000-0000-4000-8000-000000000070","title":"Steal action"}]')$$,'42501','Action ID belongs to another source or enrollment','provider cannot transfer another source action by ID');
select set_config('request.jwt.claim.sub','a5000000-0000-4000-8000-000000000003',true);
select throws_ok($$select public.save_enrollment_activity_actions('a5000000-0000-4000-8000-000000000031','coaching','a5000000-0000-4000-8000-000000000041','[]')$$,'42501','Not authorized to manage this activity','outsider cannot replace another enrollment actions');
select set_config('request.jwt.claim.sub','a5000000-0000-4000-8000-000000000001',true);
select throws_ok($$select public.save_enrollment_activity_actions('a5000000-0000-4000-8000-000000000031','coaching','a5000000-0000-4000-8000-000000000041','[{"id":"a5000000-0000-4000-8000-000000000070","title":""}]')$$,'P0001','Action title is invalid','invalid action rejects the atomic save');
select is((select title from public.enrollment_actions where id='a5000000-0000-4000-8000-000000000070'),'Ask for feedback','failed atomic save preserves prior action');
update public.sessions set action_items='[{"text":"Legacy linked action","done":true,"milestone_id":"a5000000-0000-4000-8000-000000000060"},{"text":"Broken date action","due_date":"not-a-date"}]' where id='a5000000-0000-4000-8000-000000000041';
select public.backfill_enrollment_actions();
select public.backfill_enrollment_actions();
select is((select count(*)::integer from public.enrollment_actions where source_activity_id='a5000000-0000-4000-8000-000000000041' and title='Legacy linked action'),1,'legacy import is idempotent by source identity and ordinal');
select is((select goal_id from public.enrollment_actions where source_activity_id='a5000000-0000-4000-8000-000000000041' and title='Legacy linked action'),'a5000000-0000-4000-8000-000000000051'::uuid,'legacy import retains milestone and goal relationship');
select is((select count(*)::integer from public.enrollment_action_backfill_audit where source_activity_id='a5000000-0000-4000-8000-000000000041'),1,'invalid historical action is retained in audit without guessing');
select set_config('request.jwt.claim.sub','a5000000-0000-4000-8000-000000000003',true);
set local role authenticated;
select is((select count(*)::integer from public.enrollment_actions where enrollment_id='a5000000-0000-4000-8000-000000000031'),0,'RLS hides another enrollment action text');
select is((select count(*)::integer from public.enrollment_action_backfill_audit),0,'RLS hides action audit from non-admins');
reset role;
select set_config('request.jwt.claim.sub','a5000000-0000-4000-8000-000000000002',true);
set local role authenticated;
select is((select count(*)::integer from public.enrollment_actions where enrollment_id='a5000000-0000-4000-8000-000000000031'),2,'RLS permits only the actual source provider to read linked actions');
reset role;
-- Direct writes must preserve the same ownership boundary as the RPC.
select throws_ok($$update public.enrollment_actions set enrollment_id='a5000000-0000-4000-8000-000000000032',owner_user_id='a5000000-0000-4000-8000-000000000003',source_activity_id='a5000000-0000-4000-8000-000000000042' where id='a5000000-0000-4000-8000-000000000070'$$,'42501','Action enrollment, owner and source cannot be changed','direct update cannot transfer an existing action');
select is((select action_items from public.sessions where id='a5000000-0000-4000-8000-000000000041'),'[{"text":"Legacy linked action","done":true,"milestone_id":"a5000000-0000-4000-8000-000000000060"},{"text":"Broken date action","due_date":"not-a-date"}]'::jsonb,'backfill preserves original legacy JSON including unresolved items');
select set_config('request.jwt.claim.sub','a5000000-0000-4000-8000-000000000001',true);
set local role authenticated;
select lives_ok($$select public.save_enrollment_activity_actions('a5000000-0000-4000-8000-000000000031','coaching','a5000000-0000-4000-8000-000000000041','[{"id":"a5000000-0000-4000-8000-000000000070","title":"Learner update"}]')$$,'authenticated learner may save their activity actions');
select throws_ok($$select public.save_enrollment_activity_actions('a5000000-0000-4000-8000-000000000031','coaching','a5000000-0000-4000-8000-000000000041','[{"id":"a5000000-0000-4000-8000-000000000070","title":"Duplicate"},{"id":"a5000000-0000-4000-8000-000000000070","title":"Duplicate"}]')$$,'P0001','Duplicate action ID','duplicate IDs reject the entire save');
select throws_ok($$select public.save_enrollment_activity_actions('a5000000-0000-4000-8000-000000000031','coaching','a5000000-0000-4000-8000-000000000041','[{"title":12}]')$$,'P0001','Action title is invalid','reject scalar title');
select throws_ok($$select public.save_enrollment_activity_actions('a5000000-0000-4000-8000-000000000031','coaching','a5000000-0000-4000-8000-000000000041','[{"title":"bad","goal_id":"not-a-uuid"}]')$$,'P0001','Action goal ID is invalid','reject malformed goal ID');
select throws_ok($$select public.save_enrollment_activity_actions('a5000000-0000-4000-8000-000000000031','coaching','a5000000-0000-4000-8000-000000000041','[{"title":"bad","due_date":"2026-99-99"}]')$$,'P0001','Action UUID or date is invalid','reject malformed date');
select throws_ok($$select public.save_enrollment_activity_actions('a5000000-0000-4000-8000-000000000031','coaching','a5000000-0000-4000-8000-000000000041','[{"title":"bad","status":"unknown"}]')$$,'P0001','Action status is invalid','reject unknown status');
select throws_ok($$select public.save_enrollment_activity_actions('a5000000-0000-4000-8000-000000000031','coaching','a5000000-0000-4000-8000-000000000041','[{"title":"bad","unexpected":true}]')$$,'P0001','Unknown action field','reject unknown fields');
select is((select title from public.enrollment_actions where id='a5000000-0000-4000-8000-000000000070'),'Learner update','duplicate rejection rolls back preceding updates');
select lives_ok($$select public.save_enrollment_activity_actions('a5000000-0000-4000-8000-000000000031','coaching','a5000000-0000-4000-8000-000000000041','[]')$$,'learner may clear the normalized source action set');
reset role;
select * from finish();
rollback;
