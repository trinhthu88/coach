# Canonical cutover — production deployment preparation

**Status: prepared, not applied.** Nothing was deployed and the live database
was not contacted (production reads are blocked in this environment).

The live-db audit established the baseline: **206 migrations applied, latest
`20260919120000`**, repo at **236**, so **30 migrations are unapplied**. Those
30 *are* the Coaching / Mentoring / Peer canonical cutover.

## How these conclusions were reached

Static reading alone cannot answer "will this apply?", so the chain was
**rehearsed end to end** in a throwaway database:

1. A pristine `supabase/postgres:17.6.1.155` container.
2. The **206 production-applied migrations replayed in order** — the result was
   verified against the live audit: `sessions.cohort_requirement_id`,
   `mentoring_sessions.cohort_requirement_id`, `peer_session_participants`,
   `cohort_module_deadlines` and `session_learning_reflections` all **absent**,
   `cohort_requirement_dates` **present**. The baseline matches production.
3. A pre-cutover dataset loaded with the **attribution triggers live**, so
   `session_activity_attributions` is populated exactly as production's is:
   5 enrollments, 12 Coaching sessions, 5 Mentoring sessions, requirement rows
   materialised by the 206-state materialiser (one unit per row, ordinals 1..N
   — the shape the live audit reports as OK).
4. The **30 applied one at a time**, each in its own transaction, as
   `supabase db push` does.

Two rehearsal attempts were discarded first, and both mistakes are worth
recording because they are easy to repeat:

- Loading the fixture with `session_replication_role = replica` suppressed
  `attribute_new_activity_trigger`, so legacy progress read 0 and migration #15
  aborted. **That abort was a fixture artefact, not a defect.**
- Leaving `distribution_mode` unset made the 206-state materialiser emit **one
  weighted row** (`units = 4`) instead of four rows — which exposed a genuine
  latent defect (see C-1), but is not production's shape.

---

## A. The 30 migrations, in order

`SCHEMA` = table/column/index/constraint · `FUNC` = create/replace function ·
`TRIG` = trigger · `DATA` = backfill of existing rows · `GUARD` = a top-level
`DO` block that can abort the deployment.

| # | Migration | What it does | Class |
|---|---|---|---|
| 1 | `20260920100000_cohort_coach_assignments` | Cohort-level Coach pool for programme Coaching | SCHEMA + FUNC + TRIG + DATA |
| 2 | `20260920110000_coaching_session_requirement_link` | `sessions.cohort_requirement_id` + one-live-session index | SCHEMA + FUNC + TRIG |
| 3 | `20260920120000_session_learning_reflections` | Enrollment-scoped session reflection store | SCHEMA + FUNC + TRIG |
| 4 | `20260920130000_canonical_coaching_completion` | Canonical Coaching unit completion | FUNC |
| 5 | `20260920140000_coaching_booking_lifecycle` | Atomic Coaching booking / cancel / reschedule | FUNC |
| 6 | `20260920150000_coaching_eligibility_cohort_authority` | Coaching eligibility → cohort Coach pool | FUNC |
| 7 | `20260920160000_coaching_booking_slot_window` | Booking accepts a start time inside the slot | FUNC |
| 8 | `20260920170000_coaching_session_evidence_bulk` | Bulk Coaching evidence reader | FUNC |
| 9 | `20260920200000_cohort_mentors` | Cohort-level Mentor pool | SCHEMA + FUNC + TRIG + DATA |
| 10 | `20260920210000_mentoring_cohort_eligibility` | Mentoring eligibility → cohort pool; prep-file gate removed | FUNC + TRIG |
| 11 | `20260920220000_mentoring_cohort_profile_visibility` | Mentor profile visibility follows the pool | RLS |
| 12 | `20260920230000_mentoring_retire_user_global_paths` | Retires user-global Mentoring paths | FUNC + DROP FUNC |
| 13 | `20260920240000_session_reschedule_reattribution` | Re-attributes cadence milestone on reschedule | FUNC + TRIG |
| 14 | `20260921100000_coaching_requirement_scope_and_reschedule` | Per-learner requirement scope | SCHEMA + FUNC |
| 15 | `20260921110000_mentoring_requirement_link` | **Mentoring requirement attribution + backfill** | SCHEMA + FUNC + TRIG + **DATA + GUARD** |
| 16 | `20260921120000_mentoring_canonical_lifecycle` | Mentoring booking, lifecycle, field protection | SCHEMA + FUNC + TRIG + GUARD |
| 17 | `20260921130000_coaching_operational_completion` | Completion is operational; evidence is reporting | FUNC + GUARD |
| 18 | `20260921140000_single_quantity_authority_and_evidence` | One quantity authority; retires the `max_triads` cap | FUNC + DROP TRIG + GUARD |
| 19 | `20260921150000_cap_triggers_honour_lifecycle_service` | Cap triggers stop re-authorising the lifecycle service | FUNC + GUARD |
| 20 | `20260921160000_mentoring_eligibility_before_availability` | Validate WHO before WHICH | FUNC + GUARD |
| 21 | `20260921170000_quantity_from_programme_not_schedule` | Quantity from the programme | FUNC + GUARD |
| 22 | `20260921180000_coaching_requirement_backfill` | **Attributes existing Coaching sessions** | **DATA + GUARD** |
| 23 | `20260921190000_coaching_reflection_single_store` | One Coaching reflection store | FUNC + DATA + GUARD |
| 24 | `20260921200000_mentor_is_a_coach` | Mentor = Coach + cohort assignment | FUNC + TRIG + GUARD |
| 25 | `20260921210000_peer_participant_enrollment` | **`peer_session_participants`** + backfill | SCHEMA + FUNC + TRIG + **DATA + GUARD** |
| 26 | `20260922100000_cohort_module_deadlines` | **`cohort_module_deadlines`; retires distribution modes** | SCHEMA + FUNC + TRIG + **DATA + GUARD** |
| 27 | `20260922110000_peer_cohort_eligibility` | Peer eligibility becomes a cohort decision | SCHEMA + FUNC + TRIG + GUARD |
| 28 | `20260922120000_peer_booking_and_lifecycle` | Peer booking gated by the cohort rule | SCHEMA + FUNC + TRIG + DATA + GUARD |
| 29 | `20260922130000_peer_surface_convergence` | Peer surfaces read canonical rows | FUNC + DATA + GUARD |
| 30 | `20260923100000_programme_quantity_invariant` | Quantity invariant enforced by deferred triggers | SCHEMA + FUNC + TRIG + DATA + GUARD |

---

## B. Dependency order — verified by execution

**All 30 apply cleanly in filename order. Total 1.36 s** on a
production-shaped dataset.

No migration references an object created by a later one; no trigger targets a
table that does not yet exist; no function calls one defined later.

**One harness requirement, not a defect:** each migration must be applied **as
a single transaction**. Several (`20260918185900`, `20260921180000`,
`20260922100000`) build `ON COMMIT DROP` temp tables and read them in a later
statement. Applied statement-by-statement outside a transaction they fail with
`relation "_cb_expected" does not exist`. `supabase db push` already wraps each
file in a transaction, so this is satisfied by default — but any manual
`psql -f` must use `-1`.

### Conditional guards that behave differently on production

| Guard | Where | Effect on production |
|---|---|---|
| `to_regclass('public.demo_resource_registry')` | #15, #22 | **Fires on production** — the demo registry exists there. It excludes demo enrollments from the progress-change guard, which is what lets the deploy proceed when demo data is stale. On a fresh DB it silently skips. |
| `IF EXISTS` on triggers/policies | #10, #16, #24, #26, #30 | Benign `NOTICE ... skipping`. Verified: every one is a drop-before-recreate. |
| `to_regprocedure(...)` checks | #18, #21, #30 | Assertions on the final state, not skips. |

---

## C. Destructive operations

**There is no `DROP TABLE`, no `DROP COLUMN` and no `ALTER COLUMN TYPE`
anywhere in the 30.** Nothing widens, narrows or retypes an existing column.

| Operation | Migration | Affects | Guarded | Risk |
|---|---|---|---|---|
| `UPDATE mentoring_sessions` (set `cohort_requirement_id`) | #15 | a **new** column only | followed by a progress-equality guard | **SAFE** |
| `UPDATE sessions` (set `cohort_requirement_id`) | #22 | a **new** column only | followed by a progress-equality guard | **SAFE** |
| `INSERT session_learning_reflections` | #23 | copies existing `coachee_notes` into the new store; originals untouched | — | **SAFE** |
| `INSERT/UPDATE peer_session_participants` | #25, #28 | a **new** table | — | **SAFE** |
| `UPDATE cohort_requirement_dates` (ordinals, units, due_on) | #26 | **existing production rows** | see C-1 | **REVIEW** |
| `DELETE cohort_requirement_dates` (surplus) | #26 | existing rows, **only when unreferenced** (`cohort_requirement_is_referenced`) | yes | **SAFE** |
| `DELETE cohort_requirement_dates` (weighted expansion) | #30 | only rows with `units > 1`; aborts first if any carry activity | yes | **SAFE** |
| `ADD CONSTRAINT ... CHECK (units = 1)` | #30 | existing table | preceded by the expansion | **REVIEW** — fails if any weighted row survives |
| `SET NOT NULL` on `peer_session_participants.session_status` | #28 | a **new** table | — | **SAFE** |
| 11 top-level `DO` blocks with `RAISE EXCEPTION` | #15–#30 | abort the transaction | by design | **REVIEW** — see D |

### C-1. Ordinal collision in migration #26 — FOUND BY REHEARSAL, NOW FIXED

`20260922100000` lines 147–160 expand weighted requirement rows. The original
code numbered the new rows `d.ordinal + extra.i`. The preceding
`ordinal + 1000000` shift moves every existing row as a block, which preserves
the **relative spacing** between siblings — so the expansion walked straight
onto the next sibling's ordinal:

```
weighted row ordinal 1000001, units 4  ->  would insert {1000002, 1000003, 1000004}
siblings already present               ->              {1000001, 1000002, 1000003, 1000004}
```

`ERROR: duplicate key value violates unique constraint
cohort_requirement_dates_cohort_id_programme_id_module_ordi_key`, and the whole
migration rolls back.

**Fix applied.** Only the INSERT's ordinal expression changed; the `+1000000`
shift and every other statement are untouched. New rows are now numbered by
`row_number()` over the whole expansion of that `(cohort, programme, module)`,
in a band of their own:

```sql
2000000 + (row_number() OVER (
  PARTITION BY d.cohort_id, d.programme_id, d.module
  ORDER BY d.legacy_due_on, d.ordinal, d.id, extra.i
))::integer
```

Originals sit at 1000001+, copies at 2000001+, so they cannot collide with the
originals or with each other. The `ORDER BY` matters as much as the numbering:
copies inherit their parent's `legacy_due_on` and therefore sort into the
parent's date group, and because every original is below every copy, **the
original always takes the first ordinal of its group** — it keeps the unit
number learners have already seen and that sessions, mentoring sessions, peer
participants and Triad groups already reference. The renumber at lines 167–178
then lands the whole set on 1..N as before.

#### Verified by rehearsal — four cases, all 30 migrations each

| Case | Pre-cutover shape | Result |
|---|---|---|
| 1. Production shape | `units = 1`, ordinals 1..N | **all 30 OK**, rows unchanged |
| 2. Weighted + activity | one weighted row, learners with sessions | **stops at #15** — see below |
| 3. Weighted, no activity | coaching 1 row `units=4`, mentoring 1 row `units=2` | **all 30 OK** → 4 and 2 one-unit rows, ordinals 1..N |
| 4. Mixed, hostile | coaching `units` 2+3+1 at **non-contiguous ordinals 9, 5, 1**, inserted out of date order | **all 30 OK** → 6 rows, ordinals 1..6 |

Case 4 also confirms no timing information is lost:

| ordinal | 1 | 2 | 3 | 4 | 5 | 6 |
|---|---|---|---|---|---|---|
| original date | Jun 30 | Jun 30 | Jul 31 | Jul 31 | Jul 31 | Aug 31 |
| is original row | **yes** | copy | **yes** | copy | copy | **yes** |

which is exactly the expansion the contract specifies. All eight canonical
pgTAP suites pass against both the case 1 and case 4 databases.

#### Case 2 is a separate, correct refusal — not this defect

With a weighted row **and** learner activity, the chain stops earlier, at **#15**:

```
ERROR: Mentoring requirement link: Mentoring progress changed for real enrollments ...
```

A weighted row means the cohort holds fewer requirement **rows** than required
**units**, so a learner's second Mentoring session has no row to attach to and
their completed count would drop. The progress-equality guard refuses rather
than silently losing the unit — "a data problem to resolve deliberately", as it
says. That is the guard working, and it is unreachable on production, which has
no weighted rows.

---

## D. The invariant migration (#30) — verdict

**It would pass.**

Rehearsed directly: applied last, on a dataset shaped like the live audit's
report, migration #30 completed in 71 ms with no error. Its final `DO` block
raises only when `cohort_schedule_violations()` returns a row whose violation is
not `missing_deadline`; after #26 has run, every cohort-module holds exactly
`required_units` one-unit rows, so the set is empty.

This is consistent with the live audit independently: all 16 cohort×module rows
`OK` means `row_count = required_units` and `weighted_rows = 0`, which is
precisely the invariant #30 asserts.

**Two conditions to re-check immediately before deploying**, since the audit is
a point-in-time snapshot:

1. No cohort-module has drifted since the audit — re-run Section 5.
2. No cohort gains an `end_date` of `NULL` with a required module. That yields
   `missing_deadline`, which is **pending, not a violation**: it does not abort
   the migration, but it does block booking for that cohort until an Admin sets
   the deadline.

---

## E. Deployment plan

### Business impact to agree *before* deploying

The rehearsal measured this precisely. `required_units` and `completed_units`
are **preserved exactly** — nobody's completion moves:

| | before | after |
|---|---|---|
| e1 Coaching | 4 req / 4 done | 4 / 4 |
| e2 Coaching (6 sessions) | 4 / 4 | 4 / 4 |
| e3 Coaching (2 sessions) | 4 / 2 | 4 / 2 |

But **`due_units` and `overdue_units` collapse to 0**, and `pace_status` flips
from `behind` to `not_yet_due`:

| | before | after |
|---|---|---|
| e3 Coaching | due 3, overdue 1 | due 0, overdue 0 |
| e4 Coaching | due 3, overdue 3 | due 0, overdue 0 |

This is migration #26 working as designed and as its header documents: interim
per-unit dates are replaced by **one completion deadline per cohort-module**, so
nothing is due until that date. The superseded dates are preserved in
`cohort_requirement_dates.legacy_due_on` and reported by
`cohort_requirement_legacy_spread()`.

**Every overdue figure on every Admin and Sponsor screen will drop to zero on
deployment day.** That is intended, irreversible in effect, and must be
communicated to Admin and Sponsor users in advance. It is the single largest
visible consequence of this deploy — larger than anything in the schema.

### Recommended approach

**One batch, one transaction per migration, in a maintenance window** —
`supabase db push`.

- **Locking / duration:** negligible. 1.36 s total in rehearsal. The heaviest
  are #26 (133 ms) and #15/#22 (~120/90 ms). Production has more rows, but the
  backfills are single-pass updates over `sessions` and `mentoring_sessions`;
  expect seconds, not minutes. No table rewrite occurs — every `ADD COLUMN` is
  nullable with no default.
- **Why a window anyway:** not for lock duration, but because the booking
  surface changes semantics mid-chain. Between #2 and #22, Coaching sessions
  exist whose `cohort_requirement_id` is NULL and which therefore fulfil
  nothing. A booking made in that gap would be unattributed.
- **Do not split the batch.** #4 moves completion onto requirement attribution
  while #22 supplies the attribution. Stopping between them leaves **every
  learner's Coaching progress at zero** — migration #22's header states this
  explicitly and it is the strongest argument for a single batch.

### Rollback

`supabase db push` applies each file in its own transaction, so a failure rolls
back **that migration only**; earlier ones stay applied. Since these 30 are not
individually reversible (no down-migrations), the rollback strategy is:

1. **Take a PITR restore point / snapshot immediately before.** This is the
   real rollback and the only one that recovers a partial chain.
2. If migration *N* fails, the database sits at *N−1*. **Do not attempt to run
   the app in that state** if *N* is between 4 and 22 — Coaching progress reads
   zero there.
3. Fix forward if the failure is a guard firing (that means a data problem the
   guard is naming), or restore to the snapshot if it is anything else.

### Pre-flight checks (all read-only)

```
psql "$PROD_DB_URL" -X -f scripts/live-db-audit.sql          # sections 2 and 5
psql "$PROD_DB_URL" -X -f scripts/programme-quantity-readiness.sql
```

Proceed only when the readiness verdict reads `READY` and Section 5 shows every
cohort-module `OK`.

---

## F. Post-deployment verification

1. **Re-run `scripts/live-db-audit.sql`.** Every object in section 3 must read
   `YES` — 29 functions, 13 triggers, 4 indexes, 5 tables, 5 columns.
2. **Section 4b marker checks** must read: `programme_required_units` → no
   `greatest`; `can_book_mentoring_session_reason` and `can_book_session` →
   `cohort_requirement_id is not null` PRESENT; `cohort_mentoring_mentor_pool`
   → `mentor_profiles` ABSENT.
3. **Orphan diagnostics**, now callable — expect small, explainable counts
   (the rehearsal produced 2 Coaching and 1 Mentoring from a learner with more
   sessions than requirements):
   ```sql
   SELECT * FROM public.coaching_sessions_without_requirement();
   SELECT * FROM public.mentoring_sessions_without_requirement();
   SELECT * FROM public.peer_participants_without_requirement();
   SELECT * FROM public.cohort_schedule_violations();   -- must be empty
   ```
4. **Progress reconciliation.** Capture `canonical_module_progress` for a
   sample of enrollments *before* the deploy and compare after:
   `required_units` and `completed_units` must be identical; `due_units` and
   `overdue_units` are expected to fall (section E).
5. **pgTAP.** All 7 canonical suites passed against the post-migration
   rehearsal database (`programme_cohort_requirement_integrity`,
   `coaching_canonical_contract`, `mentoring_canonical_contract`,
   `peer_canonical_contract`, `triad_canonical_contract`,
   `canonical_progress_reconciliation`, `source_of_truth_contract`). Run them
   against a **restored copy** of production, never against production itself —
   they create fixtures and roll back, but they do write.
6. **Smoke-test each booking path** as a real user: Coaching
   (`book_coaching_session`), Mentoring (`book_mentoring_session`), Peer
   learner-to-learner (`book_coachee_peer_session`), Triad group scheduling
   (`learner_triad_schedule_session`).
7. **Confirm the Admin cohort screens** show the Coaching and Mentoring pools
   drawn from the same Coach population, and that the Mentoring panel no longer
   reports "no mentors exist yet".

---

## Open items

- ~~**C-1**~~ — **fixed and rehearsed** (four shapes, including weighted and
  mixed non-contiguous ordinals). No longer a deployment risk.
- The **demo generator** (`demo_resource_registry`, out of repo) writes
  Coaching/Mentoring/Peer rows with no requirement attribution. After this
  deploy its data will read 0 canonical progress. The guards in #15/#22
  deliberately exclude demo enrollments, so it will not block the deployment —
  but the demo environment will look broken until the generator is updated.
