-- coachee_reflections.enrollment_id: FK integrity, ownership validation,
-- and the three deterministic backfill outcomes (resolved / ambiguous /
-- no-candidate). Uses completed-status enrollments throughout so the
-- ux_programme_enrollments_one_ongoing partial unique index (which only
-- covers active/at_risk/paused) never blocks the overlapping fixtures this
-- test deliberately needs for the ambiguous case.
begin;

select plan(10);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_user_meta_data, created_at, updated_at, confirmation_token,
  email_change_token_new, recovery_token
)
select
  ('b8000000-0000-0000-0000-00000000000' || n)::uuid,
  '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated',
  'reflection-scope-' || n || '@example.test', 'test', now(),
  jsonb_build_object('full_name', 'Reflection Scope ' || n), now(), now(), '', '', ''
from generate_series(1, 3) as n;

insert into public.organizations (id, name)
values ('b8000000-0000-0000-0000-000000000001', 'Reflection scope organization');

insert into public.programmes (id, name)
values ('b8000000-0000-0000-0000-000000000002', 'Reflection scope programme');

insert into public.cohorts (id, name, programme_id, organization_id, start_date, end_date)
values ('b8000000-0000-0000-0000-000000000003', 'Reflection scope cohort',
  'b8000000-0000-0000-0000-000000000002', 'b8000000-0000-0000-0000-000000000001',
  date '2026-01-01', date '2026-12-31');

-- Learner 1: exactly one enrollment covering 2026-03-01 -> resolves.
insert into public.programme_enrollments (id, user_id, programme_id, cohort_id, organization_id, start_date, end_date, status)
values ('b8000000-0000-0000-0000-00000000e001', 'b8000000-0000-0000-0000-000000000001',
  'b8000000-0000-0000-0000-000000000002', 'b8000000-0000-0000-0000-000000000003',
  'b8000000-0000-0000-0000-000000000001', date '2026-02-01', date '2026-04-01', 'completed');

-- Learner 2: two overlapping (completed) enrollments both covering 2026-03-01 -> ambiguous.
insert into public.programme_enrollments (id, user_id, programme_id, cohort_id, organization_id, start_date, end_date, status)
values
  ('b8000000-0000-0000-0000-00000000e002', 'b8000000-0000-0000-0000-000000000002',
    'b8000000-0000-0000-0000-000000000002', 'b8000000-0000-0000-0000-000000000003',
    'b8000000-0000-0000-0000-000000000001', date '2026-01-15', date '2026-06-01', 'completed'),
  ('b8000000-0000-0000-0000-00000000e003', 'b8000000-0000-0000-0000-000000000002',
    'b8000000-0000-0000-0000-000000000002', 'b8000000-0000-0000-0000-000000000003',
    'b8000000-0000-0000-0000-000000000001', date '2026-02-15', date '2026-05-01', 'completed');

-- Learner 3: one enrollment, but it does NOT cover the reflection's date -> no candidate.
insert into public.programme_enrollments (id, user_id, programme_id, cohort_id, organization_id, start_date, end_date, status)
values ('b8000000-0000-0000-0000-00000000e004', 'b8000000-0000-0000-0000-000000000003',
  'b8000000-0000-0000-0000-000000000002', 'b8000000-0000-0000-0000-000000000003',
  'b8000000-0000-0000-0000-000000000001', date '2026-09-01', date '2026-11-01', 'completed');

-- Three historical (pre-migration-style) reflections, all with enrollment_id
-- left unset, inserted directly at the DB level the same way an old row
-- would have existed before this column existed.
insert into public.coachee_reflections (id, coachee_id, body, created_at)
values
  ('b8000000-0000-0000-0000-00000000f001', 'b8000000-0000-0000-0000-000000000001', 'Case A: single matching enrollment', '2026-03-01T10:00:00Z'),
  ('b8000000-0000-0000-0000-00000000f002', 'b8000000-0000-0000-0000-000000000002', 'Case C: two overlapping enrollments', '2026-03-01T10:00:00Z'),
  ('b8000000-0000-0000-0000-00000000f003', 'b8000000-0000-0000-0000-000000000003', 'Case B: no covering enrollment', '2026-03-01T10:00:00Z');

select is(
  (select enrollment_id from public.coachee_reflections where id = 'b8000000-0000-0000-0000-00000000f001'::uuid),
  null::uuid,
  'before backfill: Case A reflection has no enrollment_id yet'
);

select * from public.backfill_coachee_reflection_enrollment_scope();

select is(
  (select enrollment_id from public.coachee_reflections where id = 'b8000000-0000-0000-0000-00000000f001'::uuid),
  'b8000000-0000-0000-0000-00000000e001'::uuid,
  'Case A: exactly one covering enrollment -> backfilled to that enrollment'
);
select is(
  (select enrollment_id from public.coachee_reflections where id = 'b8000000-0000-0000-0000-00000000f002'::uuid),
  null::uuid,
  'Case C: two overlapping covering enrollments -> left null, never guessed'
);
select is(
  (select enrollment_id from public.coachee_reflections where id = 'b8000000-0000-0000-0000-00000000f003'::uuid),
  null::uuid,
  'Case B: no covering enrollment -> left null'
);

-- Re-running the backfill is a safe no-op (idempotent): already-resolved
-- rows are untouched, ambiguous/no-candidate rows are still unresolved.
select * from public.backfill_coachee_reflection_enrollment_scope();
select is(
  (select enrollment_id from public.coachee_reflections where id = 'b8000000-0000-0000-0000-00000000f001'::uuid),
  'b8000000-0000-0000-0000-00000000e001'::uuid,
  'backfill is idempotent: Case A stays resolved to the same enrollment on re-run'
);
select is(
  (select enrollment_id from public.coachee_reflections where id = 'b8000000-0000-0000-0000-00000000f002'::uuid),
  null::uuid,
  'backfill is idempotent: Case C stays null on re-run'
);

-- A nonexistent enrollment_id is rejected. The ownership-validation trigger
-- (BEFORE INSERT) runs first and already treats "no matching row owned by
-- this coachee" as invalid, so this never reaches the raw FK constraint —
-- fail-closed either way, with one consistent error.
select throws_ok(
  $$insert into public.coachee_reflections (coachee_id, body, enrollment_id)
    values ('b8000000-0000-0000-0000-000000000001', 'bad fk', 'b8000000-0000-0000-0000-00000000ffff')$$,
  '42501',
  'Reflection enrollment must belong to the reflecting coachee',
  'a nonexistent enrollment_id is rejected before ever reaching the FK constraint'
);

-- Ownership validation trigger: a reflection cannot be tagged with an
-- enrollment belonging to a different coachee.
select throws_ok(
  $$insert into public.coachee_reflections (coachee_id, body, enrollment_id)
    values ('b8000000-0000-0000-0000-000000000003', 'wrong owner', 'b8000000-0000-0000-0000-00000000e001')$$,
  '42501',
  'Reflection enrollment must belong to the reflecting coachee',
  'a reflection cannot be tagged with another coachee''s enrollment'
);

-- A reflection CAN be tagged with the caller's own enrollment.
select lives_ok(
  $$insert into public.coachee_reflections (coachee_id, body, enrollment_id)
    values ('b8000000-0000-0000-0000-000000000001', 'own enrollment', 'b8000000-0000-0000-0000-00000000e001')$$,
  'a reflection can be tagged with its own coachee''s enrollment'
);

-- RLS remains intact: the existing "coachee manage own" policy still scopes
-- by coachee_id regardless of the new column.
select policies_are(
  'public', 'coachee_reflections',
  ARRAY['Reflections: coachee manage own', 'Reflections: admin all'],
  'coachee_reflections RLS policies are unchanged by this migration'
);

select * from finish();
rollback;
