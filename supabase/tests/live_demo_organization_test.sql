begin;
select plan(12);

select has_table('public','live_demo_organizations','live demo registry exists');
select has_table('public','live_demo_identities','demo identities are explicitly registered');
select has_table('public','live_demo_operations','reset operations are auditable');
select has_table('public','live_demo_baseline_resources','protected baseline resources are explicit');
select has_function('public','is_real_clariva_admin',array[]::text[],'real-admin gate exists');
select has_function('public','is_live_demo_user',array['uuid'],'demo-user check exists');
select has_function('public','reset_live_demo_data',array['uuid','text','integer','date','jsonb'],'fixed reset function exists');
select ok(has_function_privilege('service_role','public.reset_live_demo_data(uuid,text,integer,date,jsonb)','EXECUTE'),'service role can reset');
select ok(not has_function_privilege('authenticated','public.reset_live_demo_data(uuid,text,integer,date,jsonb)','EXECUTE'),'authenticated callers cannot reset directly');
select has_trigger('public','sessions','sessions_protect_demo_baseline','seeded coaching history is protected');
select has_trigger('public','profiles','profiles_protect_live_demo','shared demo profiles are protected');
select ok(has_policy('public','profiles','Profiles: live demo boundary'),'profile discovery has a reciprocal demo boundary');

select * from finish();
rollback;
