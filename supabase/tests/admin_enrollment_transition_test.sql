begin;
select plan(3);

select has_function(
  'public',
  'admin_create_programme_enrollment',
  array['uuid','uuid','uuid','uuid','date','date'],
  'service-role enrollment transition exists'
);
select ok(has_function_privilege(
  'service_role',
  'public.admin_create_programme_enrollment(uuid,uuid,uuid,uuid,date,date)',
  'EXECUTE'
), 'only service role receives direct transition execution');
select ok(NOT has_function_privilege(
  'authenticated',
  'public.admin_create_programme_enrollment(uuid,uuid,uuid,uuid,date,date)',
  'EXECUTE'
), 'normal users cannot execute service transition');

select * from finish();
rollback;