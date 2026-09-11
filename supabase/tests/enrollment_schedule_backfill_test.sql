begin;

select plan(15);
create temporary table baseline_enrollments as select count(*)::integer n from public.programme_enrollments;
grant select on baseline_enrollments to authenticated;

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change_token_new, recovery_token)
values
 ('aa000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','backfill-learner@test.invalid','test',now(),'{}',now(),now(),'','',''),
 ('aa000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','backfill-admin@test.invalid','test',now(),'{}',now(),now(),'','',''),
 ('aa000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','backfill-outsider@test.invalid','test',now(),'{}',now(),now(),'','','');
insert into public.user_roles (user_id, role)
values ('aa000000-0000-0000-0000-000000000002','admin');
insert into public.organizations (id,name)
values ('ab000000-0000-0000-0000-000000000001','Backfill test organisation');
insert into public.programmes (id,name)
values
 ('ac000000-0000-0000-0000-000000000001','Backfill valid'),
 ('ac000000-0000-0000-0000-000000000002','Backfill invalid');
insert into public.cohorts (id,name,programme_id,organization_id,start_date,end_date)
values
 ('ad000000-0000-0000-0000-000000000001','Backfill valid cohort','ac000000-0000-0000-0000-000000000001','ab000000-0000-0000-0000-000000000001','2026-01-01','2026-04-01'),
 ('ad000000-0000-0000-0000-000000000002','Backfill invalid cohort','ac000000-0000-0000-0000-000000000002','ab000000-0000-0000-0000-000000000001','2026-01-01','2026-04-01');
insert into public.programme_modules (id,programme_id,module,enabled,config)
values
 ('ae000000-0000-0000-0000-000000000001','ac000000-0000-0000-0000-000000000001','coaching',true,'{"required":true,"required_units":2,"distribution_mode":"flexible"}'),
 ('ae000000-0000-0000-0000-000000000002','ac000000-0000-0000-0000-000000000002','coaching',true,'{"required":true,"required_units":2,"distribution_mode":"custom","distribution_settings":{"milestones":[{"due_on":"2026-02-01","required_units":1}]}}');
insert into public.programme_enrollments
 (id,user_id,programme_id,cohort_id,organization_id,start_date,end_date,status)
values
 ('af000000-0000-0000-0000-000000000001','aa000000-0000-0000-0000-000000000001','ac000000-0000-0000-0000-000000000001','ad000000-0000-0000-0000-000000000001','ab000000-0000-0000-0000-000000000001','2026-01-01','2026-04-01','completed'),
 ('af000000-0000-0000-0000-000000000002','aa000000-0000-0000-0000-000000000003','ac000000-0000-0000-0000-000000000001','ad000000-0000-0000-0000-000000000001','ab000000-0000-0000-0000-000000000001','2026-01-01','2026-04-01','completed'),
 ('af000000-0000-0000-0000-000000000003','aa000000-0000-0000-0000-000000000001','ac000000-0000-0000-0000-000000000002','ad000000-0000-0000-0000-000000000002','ab000000-0000-0000-0000-000000000001','2026-01-01','2026-04-01','completed'),
 ('af000000-0000-0000-0000-000000000004','aa000000-0000-0000-0000-000000000003','ac000000-0000-0000-0000-000000000001','ad000000-0000-0000-0000-000000000001','ab000000-0000-0000-0000-000000000001','2026-01-01','2026-04-01','completed');

-- The complete row is the immutable/skipped control.  The fourth row is
-- deliberately partial and must never be mistaken for complete.
select public.generate_enrollment_schedule('af000000-0000-0000-0000-000000000002');
insert into public.enrollment_module_snapshots
 (enrollment_id,programme_module_id,module,required,required_units,distribution_mode,distribution_settings,starts_on,ends_on)
select 'af000000-0000-0000-0000-000000000004',id,module,true,2,'flexible','{}','2026-01-01','2026-04-01'
from public.programme_modules where id='ae000000-0000-0000-0000-000000000001';

create temporary table immutable_ids as
select id,module from public.enrollment_module_snapshots
where enrollment_id='af000000-0000-0000-0000-000000000002';

grant select on immutable_ids to authenticated;
set local role authenticated;
select set_config('request.jwt.claim.sub','aa000000-0000-0000-0000-000000000002',true);
select results_eq(
 $$select processed,succeeded,unresolved,skipped from public.backfill_enrollment_schedule_snapshots()$$,
 $$select 4+n,1,2,1+n from baseline_enrollments$$, 'batch backfills valid rows and isolates invalid and partial rows');
select is((select count(*)::integer from public.enrollment_module_snapshots where enrollment_id='af000000-0000-0000-0000-000000000001'),1,'valid missing enrollment is backfilled');
select results_eq(
 $$select id,module from public.enrollment_module_snapshots where enrollment_id='af000000-0000-0000-0000-000000000002' order by module$$,
 $$select id,module from immutable_ids order by module$$, 'complete snapshots retain identities');
select results_eq(
 $$select reason from public.enrollment_schedule_backfill_audit order by enrollment_id$$,
 $$values ('invalid_or_ambiguous_configuration'),('partial_snapshot')$$,
 'invalid and partial schedules are audited with machine reasons');
select is((select count(*)::integer from public.enrollment_module_snapshots where enrollment_id='af000000-0000-0000-0000-000000000004'),1,'partial snapshot is not rebuilt or treated complete');

-- Correct the configuration; the next retry succeeds and clears only that
-- enrollment's audit row while the unrelated partial row remains unresolved.
update public.programme_modules
set config='{"required":true,"required_units":2,"distribution_mode":"custom","distribution_settings":{"milestones":[{"due_on":"2026-02-01","required_units":2}]}}'
where id='ae000000-0000-0000-0000-000000000002';
select results_eq(
 $$select processed,succeeded,unresolved,skipped from public.backfill_enrollment_schedule_snapshots()$$,
 $$select 4+n,1,1,2+n from baseline_enrollments$$, 'corrected configuration succeeds on retry');
select is((select count(*)::integer from public.enrollment_schedule_backfill_audit where enrollment_id='af000000-0000-0000-0000-000000000003'),0,'successful retry clears its audit');
select is((select count(*)::integer from public.enrollment_schedule_backfill_audit where reason='partial_snapshot'),1,'partial audit remains unresolved');
select throws_ok($$select public.assert_enrollment_schedule_backfill_ready()$$,'P0001',NULL,'readiness fails while unresolved audits remain');
select set_config('request.jwt.claim.sub','aa000000-0000-0000-0000-000000000003',true);
select throws_ok($$select public.backfill_enrollment_schedule_snapshots()$$,'42501',NULL,'non-admin cannot execute backfill');
select is_empty($$select * from public.enrollment_schedule_backfill_audit$$,'non-admin cannot read audit rows');
select throws_ok($$select public.assert_enrollment_schedule_backfill_ready()$$,'42501',NULL,'non-admin cannot execute readiness assertion');
select is((select count(*) from information_schema.columns where table_schema='public' and table_name='enrollment_schedule_backfill_audit' and column_name in ('email','full_name','topic','response_text','notes','description')),0,'audit contains no PII or coaching-content columns');

select set_config('request.jwt.claim.sub','aa000000-0000-0000-0000-000000000002',true);
reset role;
insert into public.enrollment_module_milestones(enrollment_module_snapshot_id,sequence,due_on,required_units)
select id,1,ends_on,required_units from public.enrollment_module_snapshots
where enrollment_id='af000000-0000-0000-0000-000000000004';
select public.backfill_enrollment_schedule_snapshots();
set local role authenticated;
select lives_ok($$select public.assert_enrollment_schedule_backfill_ready()$$,'readiness succeeds after all audits are cleared');
select results_eq(
 $$select processed,succeeded,unresolved,skipped from public.backfill_enrollment_schedule_snapshots()$$,
 $$select 4+n,0,0,4+n from baseline_enrollments$$, 'repeated clean run is idempotent');
select * from finish();
rollback;