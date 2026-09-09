begin;
select plan(5);
select has_function('public', 'create_programme_enrollment', array['uuid','uuid','uuid','uuid','date','date']);
select has_function('public', 'record_goal_checkin', array['uuid','uuid','text','uuid','smallint','text']);
select has_function('public', 'get_enrollment_progress', array['uuid','date']);
select has_function('public', 'generate_enrollment_schedule', array['uuid']);
select has_index('public', 'programme_enrollments', 'ux_programme_enrollments_one_ongoing');
select * from finish();
rollback;
