-- Deadline contract (20260928100000_requirement_calendar, superseding the
-- P0-2 "one deadline per cohort x module" lock of 20260926400000):
-- the module completion deadline is the DEFAULT every requirement starts at
-- and follows; each of the N requirements can carry its own Admin date.
begin;
select plan(8);

insert into auth.users(id, email, raw_user_meta_data) values
 ('a8200000-0000-4000-8000-000000000001', 'deadline-admin@example.test', '{"full_name":"Deadline admin"}');
insert into public.user_roles(user_id, role) values ('a8200000-0000-4000-8000-000000000001', 'admin')
on conflict do nothing;
insert into public.programmes(id, name, duration_months) values
 ('a8200000-0000-4000-8000-000000000010', 'Deadline programme', 6);
insert into public.programme_modules(programme_id, module, enabled, config) values
 ('a8200000-0000-4000-8000-000000000010', 'coaching', true, '{"required": true, "required_units": 3}');
insert into public.cohorts(id, name, programme_id, start_date, end_date) values
 ('a8200000-0000-4000-8000-000000000020', 'Deadline cohort', 'a8200000-0000-4000-8000-000000000010',
  current_date - 10, current_date + 170);

select set_config('request.jwt.claim.sub', 'a8200000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select public.admin_set_cohort_module_deadlines('a8200000-0000-4000-8000-000000000020',
  jsonb_build_array(jsonb_build_object('programme_id', 'a8200000-0000-4000-8000-000000000010',
    'module', 'coaching', 'completion_deadline', (current_date + 60)::text)));

select is((select count(*)::int from public.cohort_requirement_dates
           where cohort_id = 'a8200000-0000-4000-8000-000000000020' and module = 'coaching'),
  3, 'N = 3 requirement ordinals are materialised');
select is((select array_agg(distinct due_on) from public.cohort_requirement_dates
           where cohort_id = 'a8200000-0000-4000-8000-000000000020' and module = 'coaching'),
  array[current_date + 60], 'all three ordinals start at the module deadline (their default)');

-- Moving the module deadline moves every ordinal that follows it.
select public.admin_set_cohort_module_deadlines('a8200000-0000-4000-8000-000000000020',
  jsonb_build_array(jsonb_build_object('programme_id', 'a8200000-0000-4000-8000-000000000010',
    'module', 'coaching', 'completion_deadline', (current_date + 90)::text)));
select is((select array_agg(distinct due_on) from public.cohort_requirement_dates
           where cohort_id = 'a8200000-0000-4000-8000-000000000020' and module = 'coaching'),
  array[current_date + 90], 'changing the module deadline moves every ordinal that follows it');

-- A module has one DEFAULT deadline (per-requirement dates go through admin_set_cohort_requirement_dates).
select throws_ok(
  $$select public.admin_set_cohort_module_deadlines('a8200000-0000-4000-8000-000000000020',
      jsonb_build_array(
        jsonb_build_object('programme_id', 'a8200000-0000-4000-8000-000000000010', 'module', 'coaching', 'completion_deadline', (current_date + 30)::text),
        jsonb_build_object('programme_id', 'a8200000-0000-4000-8000-000000000010', 'module', 'coaching', 'completion_deadline', (current_date + 40)::text)))$$,
  '22023', 'A module can have only one completion deadline', 'a module cannot carry two default deadlines');

-- One requirement gets its own date; the others keep following the default.
select public.admin_set_cohort_requirement_dates('a8200000-0000-4000-8000-000000000020',
  jsonb_build_array(jsonb_build_object('requirement_id',
    (select id from public.cohort_requirement_dates where cohort_id = 'a8200000-0000-4000-8000-000000000020'
       and module = 'coaching' and ordinal = 2),
    'due_on', (current_date + 45)::text)));
select public.admin_set_cohort_module_deadlines('a8200000-0000-4000-8000-000000000020',
  jsonb_build_array(jsonb_build_object('programme_id', 'a8200000-0000-4000-8000-000000000010',
    'module', 'coaching', 'completion_deadline', (current_date + 100)::text)));
select is((select array_agg(due_on order by ordinal) from public.cohort_requirement_dates
           where cohort_id = 'a8200000-0000-4000-8000-000000000020' and module = 'coaching'),
  array[current_date + 100, current_date + 45, current_date + 100],
  'per-requirement dates: an Admin-dated requirement keeps its date when the default moves');
select is((select count(*)::int from public.cohort_requirement_dates
           where cohort_id = 'a8200000-0000-4000-8000-000000000020' and module = 'coaching'),
  3, 'dating one requirement never changes the requirement count');

select ok(obj_description('public.sync_cohort_requirement_dates(uuid)'::regprocedure) like '%Admin-dated row (is_overridden) keeps its own date%',
  'the per-requirement contract is recorded on the materialisation function');
select ok(obj_description('public.cohort_module_deadlines'::regclass) like '%DEFAULT completion deadline%',
  'cohort_module_deadlines is recorded as the default, not the only date');

select * from finish();
rollback;
