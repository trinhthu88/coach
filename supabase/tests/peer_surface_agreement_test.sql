-- Every Peer surface reports the same number, and no surface reports more than
-- its audience is entitled to (Peer canonical cutover, phase 5).
--
-- The failure this guards against is not a wrong number. It is SEVERAL numbers:
-- Clariva could show Peer progress on the Dashboard, a Peer session in the
-- Sessions list, and an empty Peer page, because each surface decided for
-- itself what a Peer session was. Agreement is therefore asserted against the
-- SEEDED demo learner rather than a private fixture -- a fixture proves the
-- functions compose, the seed proves the product does.
--
-- Leader C1 of Emerging Leaders – Cohort C: two required Peer units, both
-- completed (supabase/seed.sql, hand-reconciled in
-- sponsor_cohort_c_reconciliation_test at cohort level as peer 9/24).
begin;

select plan(22);

-- ---------------------------------------------------------------------------
-- 1. One number, every learner surface
-- ---------------------------------------------------------------------------

select set_config('request.jwt.claim.sub', '13131313-1313-4131-8131-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

-- Learner Dashboard.
select is(
  (select peer_completed_units || '/' || peer_required_units
     from public.learner_canonical_progress('14141414-1414-4141-8141-000000000001'::uuid)),
  '2/2', 'Learner Dashboard: Peer 2/2');

-- Programme Journey / module rows.
select is(
  (select completed_units || '/' || required_units
     from public.learner_canonical_module_progress('14141414-1414-4141-8141-000000000001'::uuid, current_date)
    where module = 'peer_coaching'),
  '2/2', 'Programme Journey: the same 2/2');

-- Peer workspace and the Sessions list both read learner_session_history; the
-- number of rows it marks as programme evidence must BE the completed count,
-- not merely be capped to it by some later surface.
select is(
  (select count(*)::integer from public.learner_session_history('14141414-1414-4141-8141-000000000001'::uuid)
    where session_type = 'peer_coaching' and is_programme_evidence),
  2, 'Peer workspace / Sessions: exactly two records count, matching progress');

-- The workspace is not empty: the bug was progress existing while the Peer
-- page showed nothing at all.
select cmp_ok(
  (select count(*)::integer from public.learner_session_history('14141414-1414-4141-8141-000000000001'::uuid)
    where session_type = 'peer_coaching'),
  '>', 0, 'the Peer workspace has records to show, not just a progress number');

-- Every Peer record resolves to a real session in a real Peer table, so every
-- entry point opens the same detail.
select ok(
  (select bool_and(
     (h.source_table = 'peer_sessions' and exists (select 1 from public.peer_sessions s where s.id = h.source_id))
     or (h.source_table = 'coachee_peer_sessions' and exists (select 1 from public.coachee_peer_sessions s where s.id = h.source_id)))
     from public.learner_session_history('14141414-1414-4141-8141-000000000001'::uuid) h
    where h.session_type = 'peer_coaching'),
  'every Peer record in history resolves to an existing session row');

-- A learner has a partner pool at all. Before phase 2 this came from a global
-- opt-in flag; the demo seed now opts its cohort in, so an empty pool here
-- means the cohort rule is broken, not that nobody volunteered.
select cmp_ok(
  (select count(*)::integer from public.eligible_peer_partners('14141414-1414-4141-8141-000000000001'::uuid)),
  '>', 0, 'the seeded learner can actually see somebody to practise with');

select ok(
  (select bool_and(is_own_cohort) from public.eligible_peer_partners('14141414-1414-4141-8141-000000000001'::uuid)),
  'with no cross-cohort grant configured, the pool is exactly the own cohort');

-- ---------------------------------------------------------------------------
-- 2. The same number on the Sponsor side
-- ---------------------------------------------------------------------------

reset role;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111116', true);
set local role authenticated;

-- Sponsor Leader Detail.
select is(
  (select peer_completed_units || '/' || peer_required_units
     from public.sponsor_canonical_leader_progress('14141414-1414-4141-8141-000000000001'::uuid, current_date)),
  '2/2', 'Sponsor Leader Detail: the same 2/2');

-- Sponsor Cohort Detail / Dashboard rollup.
select is(
  (select peer_completed_units || '/' || peer_required_units
     from public.sponsor_canonical_cohort_progress('11111111-1111-4111-8111-111111111119'::uuid, current_date)),
  '9/24', 'Sponsor Cohort Detail: the cohort rollup of the same fulfilment');

-- A rollup that exceeded its own entitlement would mean Peer was being counted
-- somewhere other than requirement fulfilment.
select ok(
  (select peer_completed_units <= peer_required_units
     from public.sponsor_canonical_cohort_progress('11111111-1111-4111-8111-111111111119'::uuid, current_date)),
  'no Peer numerator exceeds its denominator');

-- ---------------------------------------------------------------------------
-- 3. Sponsor sees numbers, never narrative
-- ---------------------------------------------------------------------------

select ok(
  pg_get_function_result('public.sponsor_canonical_leader_progress(uuid,date)'::regprocedure)
    !~ 'reflection|notes|feedback|rating|topic',
  'the Sponsor leader contract carries no reflection, notes, feedback or rating column');

select ok(
  pg_get_function_result('public.sponsor_canonical_cohort_progress(uuid,date)'::regprocedure)
    !~ 'reflection|notes|feedback|rating|topic',
  'and neither does the cohort rollup');

-- A Sponsor is not a participant, so the participant policy does not admit
-- them to the Peer narrative stores.
select is(
  (select count(*)::integer from public.session_learning_reflections
    where source_activity_type = 'peer_coaching'),
  0, 'a Sponsor reads no Peer reflection through RLS');

-- ---------------------------------------------------------------------------
-- 4. One learner does not see another's private Peer narrative
-- ---------------------------------------------------------------------------

reset role;
insert into public.session_learning_reflections (enrollment_id, source_activity_type, source_activity_id, body)
select '14141414-1414-4141-8141-000000000002'::uuid, 'peer_coaching', p.peer_session_id,
       'C2 private peer reflection'
from public.peer_session_participants p
where p.enrollment_id = '14141414-1414-4141-8141-000000000002'::uuid
limit 1
on conflict do nothing;

select set_config('request.jwt.claim.sub', '13131313-1313-4131-8131-000000000001', true);
set local role authenticated;

select is(
  (select count(*)::integer from public.session_learning_reflections
    where body = 'C2 private peer reflection'),
  0, 'learner C1 cannot read learner C2''s private Peer reflection');

reset role;
select set_config('request.jwt.claim.sub', '13131313-1313-4131-8131-000000000002', true);
set local role authenticated;

select is(
  (select count(*)::integer from public.session_learning_reflections
    where body = 'C2 private peer reflection'),
  1, 'its own author still reads it: the reflection is enrollment-scoped, not hidden');

-- The "session coach" escape hatch on reflections is scoped to Coaching, so a
-- Peer partner never reaches the other side's reflection through it.
reset role;
select ok(
  (select qual::text ~ 'coaching' from pg_policies
    where tablename = 'session_learning_reflections'
      and policyname = 'Session learning reflections: session coach view'),
  'the coach-view policy is confined to Coaching and opens no Peer narrative');

-- ---------------------------------------------------------------------------
-- 5. RLS and grants on the Peer surface
-- ---------------------------------------------------------------------------

select ok(
  not has_table_privilege('anon', 'public.coachee_peer_sessions', 'SELECT')
  and not has_table_privilege('anon', 'public.peer_sessions', 'SELECT')
  and not has_table_privilege('anon', 'public.peer_session_participants', 'SELECT')
  and not has_table_privilege('anon', 'public.peer_cohort_permissions', 'SELECT'),
  'no part of the Peer surface is granted to anon');

select ok(
  (select bool_and(rowsecurity) from pg_tables
    where schemaname = 'public'
      and tablename in ('peer_sessions', 'coachee_peer_sessions',
                        'peer_session_participants', 'peer_cohort_permissions')),
  'row level security is enabled on every Peer table');

-- Configuration is the Admin's; a learner cannot grant themselves a cohort.
select set_config('request.jwt.claim.sub', '13131313-1313-4131-8131-000000000001', true);
set local role authenticated;
select is(
  (select count(*)::integer from public.peer_cohort_permissions),
  0, 'a learner cannot read the cohort grant graph');

-- ---------------------------------------------------------------------------
-- 6. Diagnostics expose unresolved data rather than hiding it
-- ---------------------------------------------------------------------------

reset role;

-- The seed's two Coaches deliver peer practice while holding no programme
-- enrollment of their own. That is legitimate -- they have no programme
-- progress to attribute -- and it is REPORTED rather than guessed at.
select cmp_ok(
  (select count(*)::integer from public.peer_participants_without_requirement()
    where reason = 'participant has no determinable enrollment'),
  '>', 0, 'participants with no determinable enrollment are reported, not invented');

select ok(
  not exists (
    select 1 from public.peer_participants_without_requirement()
    where reason not in ('participant has no determinable enrollment',
                         'cohort schedules no Peer requirements',
                         'more Peer participation than requirements (extra activity)',
                         'session is not live, so it holds no requirement')),
  'every unattributed participation has an explained reason');

select is(
  (select count(*)::integer from public.peer_cohort_permission_issues()),
  0, 'the seeded configuration has no unusable Peer cohort grant');

select * from finish();
rollback;
