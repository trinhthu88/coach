-- P1-7: one canonical satisfaction projection (20260926800000).
begin;
select plan(6);

select has_view('public', 'canonical_session_satisfaction', 'the canonical satisfaction view exists');
select columns_are('public', 'canonical_session_satisfaction',
  array['enrollment_id', 'module', 'source_table', 'activity_id', 'rating', 'rated_at'],
  'it projects numbers only: no comment, reflection or session content columns');
select ok(not has_table_privilege('authenticated', 'public.canonical_session_satisfaction', 'select'),
  'clients cannot read it directly (authorised wrappers only)');
select ok(not has_table_privilege('anon', 'public.canonical_session_satisfaction', 'select'),
  'anonymous users cannot read it');
select ok(pg_get_functiondef('public.canonical_enrollment_satisfaction(uuid)'::regprocedure) ~ 'canonical_session_satisfaction',
  'canonical_enrollment_satisfaction (and so every Sponsor/Admin aggregate) reads the view');
select is(
  (select count(*)::int from public.canonical_session_satisfaction where rating not between 1 and 5),
  0, 'every projected rating is on the shared 1-5 scale');

select * from finish();
rollback;
