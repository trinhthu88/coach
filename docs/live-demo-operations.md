# Clariva live demo operations

The live demo is a separate, production-safe subsystem. It is not the local
`supabase/seed.sql` fixture and must not be initialized with `supabase db reset`.

## Fixed manifest

- Organization: **Clariva Demo Organization**
- Registry slug: `clariva-demo-organization`
- Fixture version: `clariva-live-demo-v1`
- Programmes/cohorts: A 8 active, B 10 active, C 12 active, D 10 completed
- Fictional leaders: 40 total
- Prospect logins: two learners, one coach, one sponsor
- Batch 2 creates four programmes, four cohorts, four dedicated identities, 42
  Auth users/profiles/role assignments, and 40 enrollments. The two learner
  prospect identities are included in the 40 fictional leaders.
- Batch 2 deliberately creates no sessions, goals, training, mentoring, peer,
  triad, rating, milestone, sponsor-activity, or schedule rows.
- Batch 3 adds deterministic enrollment-scoped activity through the same
  server-only executor. It creates 24 programme modules, 18 neutral training
  weeks, 254 immutable enrollment snapshots, 748 schedule milestones, 128
  coaching sessions, 60 mentoring sessions, 44 peer sessions, 7 triad groups,
  14 triad sessions, 40 goals, 80 goal milestones, 40 numeric goal ratings,
  40 numeric goal check-ins, 57 normalized actions, and 192 training-progress
  rows. Cohort D is completed; active cohorts A/B/C contain varied progress
  states.
- Batch 3 has a strict privacy boundary: required legacy labels are neutral
  fixture labels only. It does not create notes, objectives, reflections,
  written feedback, comments, recordings, transcripts, quiz detail, or
  assessment detail. The historical mentoring completion gate uses a
  `demo://no-file-content` sentinel only; no file bytes or storage object are
  created.
- Batch 4 provides the only full reset path. It requires a ready fixed-target
  registry, verifies ownership and cross-organization references before
  deletion, deletes only IDs registered to the demo organization, and rebuilds
  Batches 2 and 3 in the same transaction. The fixed organization and all
  non-demo rows remain untouched.
- Batch 4 verifies the exact 1,746-resource closure and approved domain counts
  after rebuilding, applies one generation increment through the existing
  finish operation, and records the reset in `demo_operations`. A failed
  rebuild rolls back its deletes and leaves the operation failed-closed.
- The admin Organizations screen polls the returned operation ID when a reset
  remains in progress and displays the latest operation status or error.

The manifest is code-reviewed and versioned in
`supabase/functions/demo-admin/manifest.ts`. It contains no passwords or
credentials.

## Safety gates

1. Apply the registry migration without seeding an organization or Auth user.
2. Configure `DEMO_ORGANIZATION_ID` only as the approved fixed identifier
   `c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2e7a01`. The value is never accepted from the
   browser for provisioning or reset.
3. Provision dedicated Auth identities and fixture rows through the separate
   server-side provisioning operation. Existing email/name matches must abort;
   never adopt a real identity. Existing fixed-ID programmes, cohorts,
   profiles, enrollments, or resources must already be demo-owned or the
   operation aborts.
4. Record every organization/resource/account/profile/role/enrollment in the
   registry before enabling prospect access. Batch 2 expects 221 protected
   baseline resource rows.
5. Batch 3 extends the same registry with 1,746 protected activity/supporting
   resource rows and refuses to adopt an existing unregistered row.
6. Enable reset only after the full dependency closure and sponsor privacy
   assertions pass in an isolated database containing non-demo sentinel data.

Batch 1 provides the server-only executor state machine. Batch 2 uses that
state machine for a transactional reconciliation of the fixed organization,
four programmes, four cohorts, four dedicated identities, 40 leaders, and 40
enrollments. Batch 3 uses the same lock, generation, collision, ownership, and
idempotency boundary for activity and progress. Provisioning is repeatable
through the reconciliation path and advances the generation only after
ownership closure succeeds. It fails closed on target, idempotency, collision,
lock, ownership, or generation errors.

Batch 4 is reset-only and reuses the same operation lock, idempotency key,
generation compare-and-swap, stale-operation handling, and audit ledger. It
does not delete by organization-wide queries or by email/name matching.

## Reset contract

Later fixture batches must use the registry, resource ownership ledger,
operation idempotency key, generation, and organization-scoped lock. They must
restore only registry-owned baseline rows, preserve the four Auth identities,
and abort before writes on any cross-organization reference or unknown
dependency. Sponsor views and exports must continue to use their existing
privacy contracts.