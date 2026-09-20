# Clariva source-of-truth integrity audit — 2026-09-20

Scope: Coaching, Mentoring, Peer Coaching, Triads across Admin, Sponsor,
Learner/Coachee and Coach/Mentor surfaces.

Audit basis:
- Branch `coaching-canonical-cutover` @ `4c2cb9d` (tree identical to `replit-agent` @ `35db17a`).
- 235 migrations replayed in filename order; the **effective** (last surviving)
  definition of all 280 live functions extracted, with 51 functions confirmed
  retired by a later `DROP` and excluded.
- `src/` (293 `.tsx`, 187 `.ts`), 19 edge functions, 36 pgTAP suites, `supabase/seed.sql`.

No code was changed.

---

## A. Executive verdict

> **Can Clariva currently guarantee the same factual data across all users?**

| Module | Verdict | One-line reason |
|---|---|---|
| **Coaching** | **Yes, conditionally** | Programme → cohort requirement → `sessions.cohort_requirement_id` → `canonical_coaching_requirement_fulfilment` → `canonical_module_progress` is a single unbroken lineage. Two conditions break it: a cohort with no `end_date` (P0-2) and a Coach-facing surface that never reads it (P1-5). |
| **Mentoring** | **Yes, conditionally** | Same lineage, plus `cohort_mentors` as the only eligibility source and `mentor_profiles`/`mentoring_allowlist` fully demoted. The prep-file completion gate is gone. Its eligibility quantity uses a *different* formula from progress (P0-1). |
| **Peer Coaching** | **No** | Canonical lineage exists and is correct for the learner↔learner path, but a **second live booking path** (`BookSession.tsx` → `book_peer_session`) is gated by `config.monthly_limit` with a hardcoded frontend fallback of 4, is not gated by the cohort rule, and *still consumes canonical Peer requirements* (P0-3). |
| **Triads** | **Yes** | The strongest module. Requirement-specific groups, membership finality, one active group per enrollment per requirement, `max_triads` cap trigger removed, extra sessions provably non-fulfilling. Only residue is a dead `max_triads` field still editable in the Admin form (P2-11). |

**Overall: not yet.** The canonical engine itself is sound and genuinely
single-sourced — every number on every Admin and Sponsor surface traces to
`canonical_module_progress`. The failures are at the **edges**: two eligibility
functions that answer "how many?" differently from the progress engine, one
un-migrated Peer booking path, one role (Coach) whose client list shows an
entirely separate progress formula, and an out-of-repo demo system writing
pre-cutover shapes into a production-like database.

---

## B. Source-of-truth matrix

`programme_modules.config.required_units` is written **PM**; `cohort_requirement_dates` is **CRD**.

| Module | Business fact | Input | Canonical storage | Writer | Canonical processor | Consumers | Duplicate / legacy source |
|---|---|---|---|---|---|---|---|
| all | module enabled | Admin programme form | `programme_modules.enabled` | `AdminProgrammes` / `ProgrammeBuilder` | `get_enrollment_programme_modules` | every surface | `user_module_access` (Mentoring only, display) |
| all | **required_units** | Admin programme form | **PM** | Admin | `cohort_required_module_units` → `sponsor_canonical_module_schedule` | all progress | ⚠️ `programme_required_units()` (GREATEST), `can_book_session()` (row count), `config.receive_limit`, `config.monthly_limit`, `config.max_triads`, `programmes.coachee_session_limit/peer_session_limit` |
| all | requirement identity | system | **CRD** (`ordinal`, `units=1`) | `sync_cohort_requirement_dates` | — | fulfilment fns | none |
| all | deadline | Admin cohort screen | `cohort_module_deadlines.completion_deadline` | `admin_set_cohort_module_deadlines` | `sync_cohort_requirement_dates` → CRD.`due_on` | schedule, journey | `CRD.legacy_due_on` (frozen, read only by `cohort_requirement_legacy_spread`) |
| Coaching | provider pool | Admin cohort panel | `cohort_coach_assignments` | Admin | `cohort_coaching_coach_pool` | booking | `coachee_coach_allowlist` (legacy branch only) |
| Mentoring | provider pool | Admin cohort panel | `cohort_mentors` | Admin | `cohort_mentoring_mentor_pool` | booking | `mentoring_allowlist` (display only, `AdminMentoring.tsx:61`); `mentor_profiles` (retired) |
| Peer | partner pool | Admin peer panel | `peer_cohort_permissions` + `profiles.peer_coaching_opt_in` | Admin | `peer_eligible_cohorts` → `eligible_peer_partners` / `peer_partner_enrollment` | Peer book screen | ⚠️ `coach_profiles.peer_coaching_opt_in` pool on the `peer_sessions` path — **not cohort-gated** |
| Triads | group membership | Admin triad screen | `triad_group_members.enrollment_id` | `admin_triad_create_group` / `_change_member` | `canonical_triad_group_members` | triad surfaces | `triad_rounds`, `programme_triad_rounds` (DEPRECATED, archived) |
| all | enrollment ownership | enrollment | `programme_enrollments` | Admin | — | everything | `resolve_current_enrollment()` (unused, still granted) |
| Coaching | booking | learner | `sessions.cohort_requirement_id` | `book_coaching_session` | `canonical_coaching_requirement_fulfilment` | all | legacy branch of `can_book_session` |
| Mentoring | booking | learner | `mentoring_sessions.cohort_requirement_id` | `book_mentoring_session` | `canonical_mentoring_requirement_fulfilment` | all | none |
| Peer | booking | learner | `peer_session_participants.cohort_requirement_id` | `sync_peer_session_participants` trigger | `canonical_peer_requirement_fulfilment` | all | ⚠️ `book_peer_session` gated by `monthly_limit` |
| Triads | booking | learner | `triad_sessions` + `triad_groups.cohort_requirement_date_id` | `learner_triad_schedule_session` | `canonical_triad_requirement_fulfilment` | all | none |
| all | session status | lifecycle RPCs | `*.status` | `transition_*_session_status` | fulfilment fns | all | Edge Functions `confirm-session`, `confirm-mentoring-session` (service role) |
| all | **completion** | operational status only | `status='completed'` | lifecycle | fulfilment fns | all | none — evidence gating fully removed |
| all | fulfilment | — | requirement link | — | `canonical_*_requirement_fulfilment` | `sponsor_canonical_activity` | ⚠️ `session_activity_attributions` still written for coaching/mentoring/peer (derived, unread) |
| Coaching/Mentoring | reflection | learner | `session_learning_reflections` | learner | `learner_reflection_feed` | feeds | `sessions.coachee_notes` (historical, `20260921190000`) |
| all | provider notes / feedback / goal check-in / actions / satisfaction / prep file | — | own tables | — | `coaching_session_evidence`, `mentoring_session_evidence` | reporting only | none — no unit or pct field returned |
| all | due / booked / completed / overdue / pct / pace | — | computed | — | **`canonical_module_progress`** | `canonical_enrollment_progress` → learner/admin/sponsor wrappers | ⚠️ `useCoachClients` (milestone ratio + overdue heuristic), `ProgrammeTimeline.tsx` (week ratio) |
| all | journey checkpoint | — | computed | — | `canonical_enrollment_journey` | 3 role wrappers | none |

---

## C. Input → storage → processing → output

### Coaching
```
programme_modules.config.required_units          (Admin)
        ↓ cohort_required_module_units
cohort_module_deadlines.completion_deadline      (Admin, per cohort×module)
        ↓ sync_cohort_requirement_dates  [trigger: cohorts, programme_modules, enrollments, deadlines]
cohort_requirement_dates  ordinal 1..N, units=1, due_on = deadline
        ↓
programme_enrollments  (ownership)
        ↓ cohort_coach_assignments → cohort_coaching_coach_pool   (who may deliver)
book_coaching_session → sessions.cohort_requirement_id
        │  UNIQUE sessions_one_live_session_per_requirement (enrollment, requirement) WHERE live
        ↓ transition_session_status → 'completed'
canonical_coaching_requirement_fulfilment        (one row per requirement)
        ↓ sponsor_canonical_activity
canonical_module_progress → canonical_enrollment_progress
        ↓
learner_canonical_progress / admin_canonical_enrollment_progress / sponsor_canonical_enrollment_progress
```
Verified: booking is enrollment-scoped; one live booking per requirement is a
partial unique index, not application code; Coach eligibility is
`cohort_coach_assignments` only; completion is operational
(`20260921130000`); `coaching_session_evidence` returns no unit field;
reflections have one store; `can_book_session` counts only
requirement-attributed sessions (C11 fix); no journey fallback re-derives a
second number.

### Mentoring
Identical shape. `mentoring_sessions.cohort_requirement_id`,
`mentoring_sessions_one_live_session_per_requirement`,
`canonical_mentoring_requirement_fulfilment`. Mentor = Coach identity +
active `cohort_mentors` row (`20260921200000`); `mentor_profiles` decides
nothing; `enforce_mentoring_prep_file_before_completion` and
`enforce_mentoring_feedback_requires_prep_file` were **dropped** in
`20260921120000` — the prep file is genuinely optional.
Unattributed historical sessions are reported by
`mentoring_sessions_without_requirement()` and consume no requirement.

### Peer Coaching
```
PM.required_units → CRD (module='peer_coaching')
        ↓
peer_cohort_permissions + profiles.peer_coaching_opt_in
        ↓ peer_eligible_cohorts → eligible_peer_partners / peer_partner_enrollment
book_coachee_peer_session → coachee_peer_sessions
        ↓ TRIGGER sync_peer_session_participants
peer_session_participants  (receiver row + provider row, EACH with its own
                            enrollment_id and its own cohort_requirement_id)
        │  session_status mirrored from the session (derived, trigger-set)
        │  UNIQUE (enrollment_id, cohort_requirement_id) WHERE status live-or-completed
        ↓
canonical_peer_requirement_fulfilment → sponsor_canonical_activity → canonical_module_progress
```
This is the correct §23 model: one physical meeting, two participation
records, each fulfilling its **own** enrollment's own requirement. Cancelling
releases the requirement (status-aware index, `20260922120000`).
**But** `peer_sessions` (the coach-pool path) is bolted onto the same trigger
with a different gate — see P0-3.

### Triads
```
PM.required_units (triads) → CRD ordinal 1..N
        ↓ triad_groups.cohort_requirement_date_id     (a group exists FOR one requirement)
triad_group_members.enrollment_id                     (2–3, same cohort+programme)
        ↓ triad_sessions  (one open per group; completed/cancelled terminal)
        ↓ triad_sync_session_attributions → session_activity_attributions
canonical_triad_requirement_fulfilment → canonical_module_progress
```
Verified: an extra session under requirement *k* produces more attribution
rows **for the same requirement** and cannot satisfy *k+1*, because
fulfilment is grouped by `cohort_requirement_dates.id` via
`triad_groups.cohort_requirement_date_id`. Membership is requirement-specific
and final once a session exists. `triad_rounds`/`programme_triad_rounds` are
DEPRECATED with all policies dropped. `validate_triad_session_cap`'s trigger
was removed. Missing group assignment is an operational gap, not a missing
requirement.

---

## D. Duplicate authority list

**Three live answers to "how many units are required?"**

| Reader | Formula | File |
|---|---|---|
| Progress engine (all roles) | `PM.config.required_units` **only** | `sponsor_canonical_module_schedule`, `20260918160000` |
| Mentoring eligibility | `GREATEST(PM.config.required_units, count(CRD))` | `programme_required_units()`, `20260921170000` |
| Coaching eligibility | `count(CRD)` **only** | `can_book_session()`, `20260921140000` |

They coincide only while `count(CRD) = required_units`.
`sync_cohort_requirement_dates` converges them automatically — except for
surplus rows carrying history (kept by design, §5c) and for cohorts that can
get no deadline at all (P0-2).

Remaining second answers:

| Where | Second authority | Status |
|---|---|---|
| `BookSession.tsx` peer mode | `config.monthly_limit` + `DEFAULT_SESSION_LIMIT = 4` | **LIVE** |
| `can_book_coachee_peer_session` | `config.receive_limit` ‖ `monthly_limit` | live (pre-check) |
| `validate_peer_session_enrollment` | `config.monthly_limit` | live trigger |
| `can_book_session` legacy branch | `config.receive_limit` ‖ `programmes.coachee_session_limit` | live (non-programme coaching) |
| `AdminProgrammes.tsx:201` | `config.max_triads` | **write path live, no reader** |
| `AdminProgrammes.tsx:469–482` | `programmes.coachee_session_limit / coach_session_limit / peer_session_limit / peer_given_limit` with `?? 8` / `?? 4` | editable |
| `validate_programme_module_config` | asserts `required_units ≤ give_limit / receive_limit` | live |
| `useCoachClients` / `ClientRow` / `ClientDetailDialog` | `milestonesDone / milestonesTotal` as a progress bar; overdue-action heuristic as `at_risk` | **LIVE** |
| `ProgrammeTimeline.tsx:98` | `completedWeeks / weeks.length` | **LIVE** |
| `get_mentoring_given_limit` / `get_coach_peer_session_usage` | provider capacity | **legitimate** — operational, not programme quantity |

---

## E. Orphan / unlinked data

Reporting functions that already exist (all `SECURITY DEFINER`, admin-scoped):

| Function | Covers |
|---|---|
| `coaching_sessions_without_requirement()` | `sessions.cohort_requirement_id IS NULL`, classified |
| `mentoring_sessions_without_requirement()` | same for `mentoring_sessions` |
| `peer_participants_without_requirement()` | `peer_session_participants.cohort_requirement_id IS NULL`, classified |
| `mentoring_allowlist_unmapped()` | allowlist rows that cannot map to one cohort |
| `peer_cohort_permission_issues()` | invalid Peer grants |
| `cohort_requirement_schedule_issues(cohort)` | `missing_deadline`, `missing_dates`, `surplus_dates`, `outside_cohort`, `out_of_scope` |
| `cohort_requirement_legacy_spread()` | superseded per-unit dates |

Ownership columns are enforced `NOT NULL` on `sessions`, `mentoring_sessions`,
`peer_sessions`, `coachee_peer_sessions`, `training_progress`,
`assignment_submissions`, `daily_prompt_responses` and the enrollment-scoped
core (`20260911200000`).

**Missing coverage** — no orphan report exists for:
`triad_sessions` / `triad_groups` / `triad_group_members` (a group whose
`cohort_requirement_date_id` points at a requirement beyond
`required_units`), `coach_session_feedback`, `mentoring_feedback`,
`peer_session_competency_feedback`, `session_goal_ratings`,
`coach_client_notes`. The last group has **no `enrollment_id`** and reaches
ownership only through its parent session — acceptable as *derived* lineage
while evidence gates nothing, but it means "which enrollment owns this
feedback" has no direct query.

Table classification:

| Class | Tables |
|---|---|
| CANONICAL | `programmes`, `programme_modules`, `cohorts`, `cohort_module_deadlines`, `cohort_requirement_dates`, `programme_enrollments`, `cohort_coach_assignments`, `cohort_mentors`, `peer_cohort_permissions`, `sessions`, `mentoring_sessions`, `peer_sessions`, `coachee_peer_sessions`, `peer_session_participants`, `triad_groups`, `triad_group_members`, `triad_sessions`, `session_learning_reflections` |
| DERIVED / CACHE | `session_activity_attributions` (canonical **only** for Triads; orphaned derived storage for coaching/mentoring/peer since `20260921140000` G4 — yet still written), `enrollment_module_snapshots`, `CRD.legacy_due_on`, `peer_session_participants.session_status` (documented as derived) |
| HISTORICAL | `sessions.coachee_notes`, `mentoring_allowlist`, `mentor_profiles`, `coachee_coach_allowlist`, `coach_as_coachee_allowlist`, `session_limits`, `programmes.*_session_limit` |
| AUDIT | `enrollment_action_backfill_audit`, `enrollment_schedule_backfill_audit`, `enrollment_ownership_retirements`, `triad_cutover_archive`, `triad_cutover_review_decisions` |
| DEAD | `triad_rounds`, `programme_triad_rounds` (all policies dropped; drop staged in `deployment-2`) |
| OUT OF REPO | `demo_resource_registry`, `demo_operations` — see F |

---

## F. Seed / demo audit

**Valid.** `supabase/seed.sql` is guarded by
`app.seed_environment ∈ (local, development, preview, test)` and refuses
otherwise. Every historical seed migration
(`20260907120000`, `20260908090000`, `20260908160000`, `20260915130000`) has
been reduced to a deliberate no-op with an explanatory comment. The
`seed-demo-data` edge function returns 410. `demo_seed_contract_test.sql`
asserts the fixture obeys the canonical architecture.

**Contaminating — the material finding.** `20260918189000_demo_generator_triad_model.sql`
documents an **out-of-band demo system living in production and defined
nowhere in this repository**: `demo_resource_registry`, `demo_operations`,
`demo_apply_batch_3`, `demo_seed_triads`, `demo_assert_batch_4_*`,
`demo_delete_batch_4_owned_resources`, organisation *"Clariva Demo Organization"*.
The migration patches only its **Triad** blocks, guarded by
`to_regclass('public.demo_resource_registry') IS NULL → RETURN`.

Consequences:

1. Its `INSERT INTO public.sessions`, `mentoring_sessions` and
   `coachee_peer_sessions` blocks (lines 364, 392, 432, 461, 498, 536) set
   **no `cohort_requirement_id`** and write **no `peer_session_participants`**
   attribution. After the Coaching / Mentoring / Peer cutovers, every demo
   learner will show sessions in history and **0 canonical progress**.
2. Nothing in this repository excludes that organisation from Admin metrics,
   Sponsor rollups, Analytics, Alerts, leader lists or provider pools. The
   registry is consulted only by *backfills*, to exclude demo rows from
   backfilling — never from business reporting.
3. `demo_apply_batch_3` has no repo-visible `REVOKE`. Only
   `demo_seed_triads(bigint)` is explicitly revoked
   (`20260919120000:1679`).

---

## G. Frontend fallback / static / locally-calculated programme data

| File:line | What | Verdict |
|---|---|---|
| `pages/dashboard/cards/…`, e.g. `useCoachingReceiveCardData.ts:102` | `coachingProgress?.required_units ?? 0` on a canonical RPC | **silent zero instead of a data error** |
| `hooks/coach/useCoachClients.ts:140-144` | `at_risk` / `needs_attention` from overdue-action counts | **invented programme status** |
| `pages/coach/ClientRow.tsx:10,33` | progress bar = `milestonesDone / milestonesTotal` | **invented programme progress** |
| `pages/coach/ClientDetailDialog.tsx:164` | `Math.round(done / ms.length * 100)` | same |
| `pages/journey/ProgrammeTimeline.tsx:97-98` | `completedWeeks / weeks.length` | **second Training progress formula** |
| `pages/admin/AdminDashboard.tsx:222` | `coachees − round(coachees × 0.93)` presented as "growth this month" | **fabricated metric** |
| `src/lib/constants.ts` → `BookSession.tsx:236` | `DEFAULT_SESSION_LIMIT = 4` shown as the learner's Peer limit when the RPC returns no row | **hardcoded quantity fallback** |
| `hooks/dashboard/usePeerCoachingCardData.ts:87,123` | `completedCount` from raw `status === "completed"` | computed, **never rendered** — dead |
| `hooks/admin/useAdminCoacheesData.ts:100`, `useAdminRegistrations.ts:86` | `?? 4` default session limit | display-only |
| `pages/admin/AdminProgrammes.tsx:452,469,473,477,482` | `?? 3`, `?? 8`, `?? 4` form defaults | writes real rows |

Clean by contrast: all Sponsor pages (`SponsorDataErrorState` on every
canonical failure), `useLearnerCanonicalProgress` (throws rather than
falling back), `ProgrammeProgressCard`, `ProgrammeModuleProgress`,
`LearnerProgrammeJourney` — all pure projections.

---

## H. Cross-user reconciliation

`canonical_progress_reconciliation_test.sql` asserts, for one enrollment and
one `p_as_of`, that the spine, Learner, Admin and Sponsor routes return
identical `required_units`, `completed_units`, `due_units`, `booked_units`,
`overdue_units`, `full_completion_pct`, `due_adherence_pct` and `pace_status`.

| Role | Route | Reconciled? |
|---|---|---|
| spine | `canonical_module_progress` → `canonical_enrollment_progress` | baseline |
| Learner | `learner_canonical_progress` | ✅ asserted |
| Admin | `admin_canonical_enrollment_progress` | ✅ asserted |
| Sponsor | `sponsor_canonical_enrollment_progress` | ✅ asserted (narrative-free contract also asserted) |
| **Coach / Mentor** | *none* — `useCoachClients` milestone ratio | ❌ **different math** |

And the test fixture configures **coaching, mentoring, triads only** — Peer
Coaching is absent from the cross-role reconciliation (it has its own
`peer_surface_agreement_test`, which covers Learner + Sponsor but not Admin).

Privacy is correctly narrative-only: `sponsor_canonical_enrollment_progress`
carries no narrative column, and `sponsor_canonical_leader_experience`
projects the same numbers.

---

## I. Database integrity gaps

Enforced server-side (good):

| Invariant | Mechanism |
|---|---|
| one live Coaching session per learner per requirement | partial `UNIQUE sessions_one_live_session_per_requirement` |
| one live Mentoring session per requirement | `UNIQUE mentoring_sessions_one_live_session_per_requirement` |
| one live-or-completed Peer participation per requirement | `UNIQUE peer_participants_one_fulfilment_per_requirement … WHERE session_status IN (live)` |
| Peer participant enrollment belongs to the participant | `validate_peer_session_participant()` trigger |
| Triad member cohort+programme match, one active group per requirement, membership final after a session | `triad_validate_group_member()` + advisory lock |
| Triad requirement ≤ programme required | `triad_validate_group_member` → `triad_required_units_for_programme` |
| requirement rows can't be deleted while referenced | `cohort_requirement_is_referenced()` + `admin_save_cohort_requirement_dates_guard` |
| requirement cardinality converges to `required_units` | `sync_cohort_requirement_dates()` on 4 triggers |
| `cohort_requirement_id` referential | FK `ON DELETE RESTRICT` on `sessions`, `mentoring_sessions`, `peer_session_participants` |
| one ongoing enrollment per user | `ux_programme_enrollments_one_ongoing` |

Gaps:

1. **No constraint or trigger enforces `count(CRD) = required_units`.** It is
   converged by a function, reported by `cohort_requirement_schedule_issues`,
   but a surplus row with history is a permanently supported divergent state.
2. **No guard on a NULL `cohorts.end_date`.** It silently produces a cohort
   with a required module and zero requirements (P0-2).
3. **`peer_sessions` has no cohort-rule trigger.** `validate_peer_cohort_permission`
   guards the `coachee_peer_sessions` path; the `peer_sessions` path is
   gated only by `can_book_peer_session` / `validate_peer_session_enrollment`,
   both of which read `monthly_limit`, not the cohort rule.
4. **Coach-surface programme status is React-only.** Nothing server-side
   produces the `at_risk` the Coach sees.
5. **`demo_apply_batch_3` has no repo-visible privilege revoke.**

---

## J. Peer-specific findings

Correct and worth keeping:
- Participant-level attribution is explicit and per-enrollment. A physical
  session legitimately fulfils A's requirement *and* B's, without duplicating
  the session row — exactly the §23 target.
- `session_status` is mirrored onto the participant row as an acknowledged
  derivation, with the BEFORE trigger as its only writer, so requirement
  ownership can be status-aware in one index and one reader.
- Cancellation releases the requirement without erasing what the meeting was
  for (`cohort_requirement_id` retained, ownership dropped).
- `peer_partner_enrollment()` — the rule that admitted the booking is the rule
  that attributes it.

Defects:
1. **P0-3. `BookSession.tsx` peer mode is an un-migrated second path.** It
   books `peer_sessions` through `book_peer_session`, pre-checked by
   `get_peer_session_usage` + `can_book_peer_session` — both reading
   `config.monthly_limit`, with `DEFAULT_SESSION_LIMIT = 4` when the RPC
   returns no row. It is not gated by `peer_cohort_permissions`. But
   `sync_peer_session_participants` is attached to `peer_sessions` too, so
   these bookings **do** consume canonical Peer requirements. The gate and the
   thing gated are different quantities.
2. **P1. Provider attribution on `peer_sessions` is date-inferred.**
   `only_enrollment_candidate(provider, NULL, session_date)` asks only "which
   enrollment covers this date". It is safe when ambiguous (returns NULL when
   ≠ 1 candidate), but where it does resolve, it grants programme credit from
   a date match rather than from the eligibility rule — the
   `coachee_peer` path deliberately does not do this.
3. **P1. Peer is absent from the cross-role reconciliation test.**
4. **P2.** The learner Peer dashboard card renders no required/completed at
   all, while Coaching and Mentoring cards do; `completedCount` is computed
   from raw statuses and discarded.
5. **P3.** `docs/architecture/source-of-truth.md:21` still states Peer
   completion comes from `session_activity_attributions`. It has not since
   `20260921210000`.

### Peer deadlines
`distribution_mode` no longer exists — `20260922100000` replaced all five
policies with one `cohort_module_deadlines.completion_deadline` per
cohort×module. All N Peer requirements carry that date, identity preserved by
`ordinal`. Quantity is never redefined by a policy. §8 satisfied.

---

## K. Legacy / obsolete objects

51 functions are confirmed dropped after their last definition — the sponsor
legacy reporting layer (`sponsor_kpis`, `sponsor_roster`,
`sponsor_cohort_summaries`, `compute_leader_progress`,
`refresh_all_progress_pct`, `trg_update_progress_from_session`, …),
`get_admin_enrollment_progress`, `get_mentoring_received_limit`,
`check_mentoring_session_usage`, `enforce_mentoring_prep_file_before_completion`,
`auto_confirm_triad_session`, and the whole distribution-mode proposal stack
(`cohort_requirement_proposal_internal`, `cohort_requirement_schedule_proposal`,
`materialize_missing_cohort_requirement_dates`, `admin_save_cohort_requirement_dates`).
Hygiene here is strong.

| Object | Class | Action |
|---|---|---|
| `config.max_triads` write path (`AdminProgrammes.tsx:201`, `ProgrammeBuilder.tsx:92`) | DEAD runtime code | remove — cap trigger gone since `20260921140000` |
| `programmes.coachee_session_limit` etc. in the Admin form | COMPATIBILITY | still read by `can_book_session`'s legacy branch; retire with that branch |
| `validate_programme_module_config` `required_units ≤ give/receive_limit` | COMPATIBILITY | retire with the limit fields |
| `mentoring_allowlist` read in `AdminMentoring.tsx:61` | HISTORICAL | display-only; the page says so |
| `mentor_profiles` | HISTORICAL | decides nothing (`20260921200000`) |
| `resolve_current_enrollment()` | DEAD | no runtime caller; still `GRANT EXECUTE … TO authenticated` |
| `triad_rounds`, `programme_triad_rounds` | DEAD | drop staged in `deployment-2/20260919190000` |
| `session_activity_attributions` writes for coaching/mentoring/peer | DEAD WRITE | `attribute_new_activity_trigger` still populates rows nothing reads |
| `supabase/deployment-2/*.sql` | PENDING | `20260919190000_triad_retire_legacy`, `20260920190000_coaching_retire_legacy` staged, not in the chain. No Mentoring or Peer retirement staged. |
| migrations | HISTORY | keep all — none should be deleted |

---

## L. Branch audit

Authoritative branch: **`coaching-canonical-cutover`**. Its tree is byte-identical
to `replit-agent`'s tip (`git diff` empty) and it is 47 commits ahead of
`origin/main`, carrying the entire Coaching / Mentoring / Peer canonical
cutover (160 files, +22,673 lines). `origin/main` is 6 commits ahead, all of
which are asset uploads (`.zip`, one `.html`) and merge commits — `git diff
coaching-canonical-cutover...origin/main -- supabase/migrations src` is empty.

**Do not assume `main` is current — it is not.** Local `main` (`40867c7`,
2026-09-13) is 318 commits behind and 13 days stale.

| Branch | Tip | Merged into cutover | Unique | Obsolete architecture | Recommendation |
|---|---|---|---|---|---|
| `coaching-canonical-cutover` | `4c2cb9d` | — | — | no | **keep — authoritative** |
| `replit-agent` | `35db17a` | contains it (tree identical) | 333 tooling commits | no | keep — Replit's own lineage |
| `origin/main` | `66ef591` | no (6 asset commits) | assets only | yes (pre-cutover code) | **merge cutover into it before anything else** |
| `main` (local) | `40867c7` | yes | 0 | yes | fast-forward to origin/main |
| `feature/enrollment-scoped-foundation` | `0734998` | yes | 0 | yes | safe to delete |
| `fix/production-quiz-backfill` | `0a7a7ee` | yes | 0 | yes | safe to delete |
| `fix/resolve-clear-enrollment-backfill` | `f6c29c4` | yes | 0 | yes | safe to delete |
| `fix/retire-unresolved-ownership` | `da1ab3e` | yes | 0 | yes | safe to delete |
| `fix/validated-clear-enrollment-mappings` | `27ad615` | yes | 0 | yes | safe to delete |
| `remediation-p0-p1-retimestamp` | `340d8e7` | yes | 0 | yes | safe to delete |
| `fix/final-enrollment-enforcement` | `cad9d8b` | **no** | 22 | yes | review the 22, then delete |
| `remediation/p0-p1` | `79dd8ab` | **no** | 25 | yes | review the 25, then delete |
| `pr10-resolution` | `4db195c` | **no** | 10 | yes | review, then delete |
| `local-before-daily-prompt-fix-push` | `2947191` | **no** | 5 | yes | review, then delete |
| `mentoring/canonical-finalization` | `b1b7b54` | **no** | 4 | partly | **retain temporarily** — most recent unmerged (2026-09-20) |
| `fix/types-drift-only` | `6cf261a` | **no** | 1 | yes | generated types only — delete |
| `fix/types-from-validation-artifact` | `b25f9f9` | **no** | 1 | yes | delete |
| `coachconnect-legacy` | `80beeff` | **no** | 4 | yes (2026-08-09) | retain as an archive tag, then delete the branch |
| `subrepl-*` ×5 | — | **no** | 1–4 each | yes (2026-08-09) | Replit sub-REPL scratch — delete, and remove the 5 matching remotes |

Nothing was deleted. Branch count does not affect runtime — the deployment
is `deploymentTarget = "static"` from `dist/`, built from whichever branch is
checked out.

---

## M. Recommended remediation order

### P0 — can produce wrong programme truth
1. **One quantity authority.** Make `programme_required_units()` return
   `PM.config.required_units` (not `GREATEST`), make `can_book_session()`'s
   programme branch call it instead of counting CRD rows, and assert in a
   migration guard that no eligibility function counts `cohort_requirement_dates`.
2. **Close the no-end-date hole.** Either refuse to enable a required module
   on a cohort with no `end_date`, or require an explicit
   `cohort_module_deadlines` row before enrollment. Today such a cohort
   materialises zero requirements, reports `required=N / completed=0` forever,
   and silently routes Coaching bookings down the legacy allowlist path with
   `cohort_requirement_id = NULL`.
3. **Retire the second Peer booking path.** Route `BookSession.tsx` peer mode
   through `book_coachee_peer_session`, or gate `book_peer_session` with
   `peer_partner_is_eligible` and `next_peer_requirement`. Until then, a
   `monthly_limit` gate is admitting bookings that consume `required_units`
   requirements. Delete `DEFAULT_SESSION_LIMIT` from the peer path.

### P1 — duplicate source / inconsistent output
4. Give the Coach surfaces the canonical engine: replace the milestone
   progress bar and the overdue-action `at_risk` heuristic in
   `useCoachClients` / `ClientRow` / `ClientDetailDialog` with
   `canonical_module_progress` + `effective_enrollment_status`, and scope the
   sessions/goals/milestones queries by `enrollment_id` (§24).
5. Attribute the `peer_sessions` provider half through `peer_partner_enrollment`,
   not `only_enrollment_candidate`.
6. Bring the out-of-repo demo generator into this repository, update its
   Coaching / Mentoring / Peer blocks to set `cohort_requirement_id` and
   participant attribution, and add a consistent demo-organisation exclusion
   to Admin metrics, Sponsor rollups, Analytics and Alerts — or move demo data
   to a dedicated environment.
7. Pick one alert engine. `AdminAlerts.tsx` deletes and re-inserts nine
   `alert_type`s that `send-programme-reminders` also writes.
8. Delete the browser-side Training ratio in `ProgrammeTimeline.tsx:98`;
   read `canonical_training_learning_summary`.
9. Extend `canonical_progress_reconciliation_test.sql` to Peer Coaching, and
   add the Coach/Mentor route once #4 lands.
10. Resolve surplus `cohort_requirement_dates` rows that carry history rather
    than leaving them as a permanent `surplus_dates` issue.

### P2 — dead / legacy / confusing
11. Remove the `max_triads` field from `AdminProgrammes.tsx` / `ProgrammeBuilder.tsx`.
12. Remove `programmes.*_session_limit` from the Admin form once the
    `can_book_session` legacy branch is retired; drop the
    `required_units ≤ give/receive_limit` assertion with it.
13. Delete the fabricated "growth this month" in `AdminDashboard.tsx:222`.
14. Delete the dead `completedCount` in `usePeerCoachingCardData`; render
    canonical Peer progress on the learner Peer card.
15. Replace `?? 0` on canonical RPC results in the dashboard cards with a data-error state.
16. `REVOKE EXECUTE` on `resolve_current_enrollment()`, or drop it.
17. Stop writing `session_activity_attributions` for coaching/mentoring/peer;
    either move Triad fulfilment off it or document it as Triad-canonical.
18. Ship the staged `deployment-2` retirements; stage the Mentoring and Peer equivalents.

### P3 — hygiene
19. Update `docs/architecture/source-of-truth.md`: lines 16 and 21 describe
    `distribution_mode` / `cohort_requirement_proposal_internal` (dropped
    `20260922100000`) and Peer-via-`session_activity_attributions` (superseded
    `20260921210000`); line 164 lists dropped functions as canonical.
20. Merge `coaching-canonical-cutover` into `main`, then execute the branch
    cleanup in §L and remove the five `subrepl-*` remotes.

---

## N. Verification plan

Run before any cleanup or deployment.

**Existing suites that must stay green** (`supabase/tests`, 36 files):
`canonical_progress_reconciliation_test`, `source_of_truth_contract_test`,
`coaching_canonical_contract_test`, `mentoring_canonical_contract_test`,
`peer_canonical_contract_test`, `peer_cohort_eligibility_test`,
`peer_surface_agreement_test`, `peer_booking_enrollment_test`,
`triad_canonical_contract_test`, `cohort_requirement_schedule_test`,
`legacy_reporting_surfaces_absent_test`, `demo_seed_contract_test`.

**New assertions required:**

| # | Assertion |
|---|---|
| V1 | For every enabled required module, `count(cohort_requirement_dates) = PM.config.required_units`, `units = 1`, `ordinal` is exactly `1..N`, one `due_on` per row. |
| V2 | `pg_get_functiondef` of every `can_book_*` / `*_required_units` function contains no `receive_limit`, `monthly_limit`, `max_triads`, `coachee_session_limit`, and no `count(*) … cohort_requirement_dates`. |
| V3 | A cohort with `end_date IS NULL` and a required module either refuses the enrollment or reports `missing_deadline` — and `can_book_session` does **not** fall through to the legacy branch. |
| V4 | Booking through `book_peer_session` is refused for a partner outside `eligible_peer_partners`. |
| V5 | `canonical_progress_reconciliation_test` fixture gains Peer Coaching; all four roles agree on all eight figures for all four modules. |
| V6 | Coach client list figures equal `canonical_module_progress` for the same enrollment and `p_as_of`. |
| V7 | Activity of Enrollment A contributes 0 to Enrollment B for all four modules, including the Coach client list and the Peer participant path. |
| V8 | A second completed Triad session under requirement *k* leaves `completed_units` unchanged and requirement *k+1* unfulfilled. |
| V9 | Setting every evidence artefact to absent (reflection, notes, feedback, goal check-in, actions, satisfaction, prep file) changes no progress figure in any module. |
| V10 | `coaching_sessions_without_requirement()`, `mentoring_sessions_without_requirement()`, `peer_participants_without_requirement()`, `cohort_requirement_schedule_issues()` return zero rows for every production cohort — the pre-deploy gate. |
| V11 | Demo-organisation enrollments are absent from Admin metrics, Sponsor rollups, Analytics and Alerts. |
| V12 | Frontend: no `.tsx`/`.ts` outside `__tests__` computes a programme percentage, required count or completed count from raw rows (lint rule or grep gate). |

**Test coverage matrix — current state**

| Invariant | Coaching | Mentoring | Peer | Triads |
|---|---|---|---|---|
| programme quantity | PARTIAL (eligibility counts CRD) | PARTIAL (GREATEST) | **MISSING** (2nd path) | PASS |
| exact cohort requirements | PARTIAL | PARTIAL | PARTIAL | PARTIAL |
| enrollment ownership | PASS | PASS | PASS | PASS |
| provider / group validity | PASS | PASS | PARTIAL (`peer_sessions` ungated) | PASS |
| booking | PASS | PASS | PARTIAL | PASS |
| lifecycle | PASS | PASS | PASS | PASS |
| fulfilment | PASS | PASS | PASS | PASS |
| due / overdue | PASS | PASS | PARTIAL | PASS |
| historical isolation | PASS | PASS | PASS | PASS |
| cross-role reconciliation | PARTIAL (no Coach) | PARTIAL (no Coach) | **MISSING** | PARTIAL (no Coach) |
| evidence non-gating | PASS | PASS | PASS | PASS |
| RLS | PASS | PASS | PASS | PASS |
