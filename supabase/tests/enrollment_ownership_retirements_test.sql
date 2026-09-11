begin;
select plan(3);
select has_table('public', 'enrollment_ownership_retirements',
  'historical ownership retirement ledger exists');
select has_function('public', 'is_historical_ownership_retired',
  array['text','uuid'],
  'retirement lookup function exists');
select has_view('public', 'enrollment_scope_backfill_audit',
  'scope readiness view remains available after retirement filtering');
select * from finish();
rollback;