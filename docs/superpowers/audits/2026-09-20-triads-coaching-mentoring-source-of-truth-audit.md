# Triads / Coaching / Mentoring — source-of-truth audit

Audited against `docs/architecture/source-of-truth.md` ("one authoritative source per
business fact; every surface is a projection") on branch `coaching-canonical-cutover`
at `457e6af`.

**How this was verified.** Every migration in the three cutovers was read in full
(`20260918185800`–`20260919120000` Triads, `20260920100000`–`20260920170000` +
`20260920240000` Coaching, `20260920200000`–`20260920230000` Mentoring), plus
`supabase/deployment-2/`, the Edge Functions, and every frontend read/write path that
touches the three modules. The frontend suite was run: **86 files / 492 tests pass**.
The pgTAP suite was **not** run — it needs Docker + the Supabase CLI, which this
environment does not have — so database findings come from reading the definitions,
except C1 which was reproduced against a scratch PostgreSQL 16 instance.

**Headline.** Triads is the reference implementation and is internally consistent.
Coaching has the right architecture but three defects that make it non-functional in
production, plus four surfaces still answering Coaching questions from pre-cutover
sources. Mentoring received the *eligibility* half of the cutover only; its completion,
quantity, booking and slot model are all still pre-canonical.

| Module | Requirement-scoped | Single booking writer | Single completion rule | Guard block | Verdict |
|---|---|---|---|---|---|
| Triads | ✅ | ✅ | ✅ | ✅ 12 tests | Sound — one residual quantity duality (T1) |
| Coaching | ✅ | ✅ | ✅ | ⚠️ 3 tests | C1–C2 fixed; C3–C13 open |
| Mentoring | ❌ | ❌ | ❌ | ❌ none | Half cut over |

> **Update (2026-09-20, same day).** **C1 and C2 are fixed** — see the notes on
> each below. The Coaching migrations were unmerged and undeployed
> (`origin/main` ends at the Triad PR), so C1 was corrected in
> `20260920110000` in place rather than by a corrective migration. Everything
> else in this document is still open. Fixing C2 surfaced one new finding,
> C13.

---

## 1. Blockers — Coaching cannot work in production as shipped

### C1. One Coaching requirement can be booked by only one learner **in the whole cohort**

`supabase/migrations/20260920110000_coaching_session_requirement_link.sql:60`

```sql
CREATE UNIQUE INDEX sessions_one_live_session_per_requirement
  ON public.sessions (cohort_requirement_id)
  WHERE cohort_requirement_id IS NOT NULL
    AND status IN ('pending_coach_approval', 'confirmed');
```

`cohort_requirement_dates` is `UNIQUE (cohort_id, programme_id, module, ordinal)`
(`20260918160000_cohort_requirement_schedule.sql:57`) — one row per *cohort*
requirement, shared by every learner in it. The index has no `enrollment_id`, so
"Coaching 1 of cohort VC" admits exactly **one** live session cohort-wide. The second
learner to book Coaching 1 gets `23505`, which `BookSession.tsx:400` renders as
"this slot was just taken" — a misleading message for a requirement collision.

Every other check in the same feature is correctly enrollment-scoped
(`book_coaching_session` guards `cohort_requirement_id = … AND enrollment_id = …`,
`20260920160000:109`), so the index is simply missing a column.

Reproduced verbatim against a scratch PostgreSQL 16:

```
INSERT 0 1                                    -- learner 1 books Coaching 1
ERROR:  duplicate key value violates unique constraint
        "sessions_one_live_session_per_requirement"
DETAIL:  Key (cohort_requirement_id)=(dddddddd-…-dddd) already exists.
```

**FIXED.** The index is now keyed on `(enrollment_id, cohort_requirement_id)`
with the same predicate, and the reasoning is recorded in the migration. The
regression case (two learners of one cohort, same requirement) is now asserted
in `coaching_canonical_contract_test.sql`; the pre-existing "a second learner
cannot book a slot that is already reserved" assertion now collides only on the
slot, so it passes for the reason it states. Verified on PostgreSQL 16: L1 books
Coaching 1 ✓, L2 books the same requirement ✓, L1 double-books it ✗ (23505),
L1 rebooks after cancelling ✓.

### C2. The mandatory reflection gate has no writer — no Coaching unit can ever complete

`coaching_session_evidence()` requires four pieces of evidence
(`20260920130000:45-80`). Three have working writers:

| Gate | Writer | Status |
|---|---|---|
| goal check-in | `record_goal_checkins` — `SessionGoalRatings.tsx:103` | ✅ |
| follow-up action | `save_enrollment_activity_actions` — `lib/enrollmentActions.ts:108` | ✅ |
| satisfaction | `sessions.coachee_rating` — `Sessions.tsx:392` | ✅ |
| **reflection** | `session_learning_reflections` — `useCanonicalCoaching.ts:370` | ❌ **dead code** |

`useSubmitCoachingReflection` is exported and has no importer anywhere in `src/`.
`CoachingPostSessionChecklist.tsx` renders the four gates read-only — it has no action
to satisfy any of them. `session_learning_reflections` therefore has no INSERT path,
`unit_complete` is permanently false, and `canonical_module_progress` reports
`completed_units = 0` for Coaching for every learner regardless of what they do.

**FIXED.** The reflection composer now lives on the card that shows the gate,
so there is exactly one way to write the row. `CoachingPostSessionChecklist`
takes `enrollmentId` and `canSubmitReflection` (passed as `isCoachee` from
`SessionDetail`), reads the learner's stored answer through a new
`useCoachingReflection` hook and rewrites it through the existing upsert — one
row per `(enrollment, activity)`, edited rather than stacked. The composer is
never rendered for a Coach or Admin, and their view does not read the
narrative at all. Four component tests plus a `Coaching source of truth` guard
block covering all four gate writers.

This fix deliberately does **not** resolve C4/C5. `sessions.coachee_notes` is
still the field the learner edits on the session page and still what Admin
Alerts and the reflection feed read. Choosing which of the two stores is
canonical is a product decision, and the audit should not make it silently.

### C3. A Coach or Admin can never reschedule

`reschedule_coaching_session` authorises admin, coach or coachee
(`20260920160000:208`) and then delegates to `book_coaching_session`, which rejects
anyone but the learner:

```sql
IF v_enr.user_id IS DISTINCT FROM v_actor THEN
  RAISE EXCEPTION 'Enrollment does not belong to the authenticated user' USING ERRCODE = '42501';
```

Both are `SECURITY DEFINER`, so `auth.uid()` stays the caller. A Coach or Admin
reschedule fails with `42501` *after* the original session has been set to
`rescheduled` in the same statement — the transaction rolls back, so no data is lost,
but the action is impossible. (Were the check relaxed naively, the insert would also
set `coachee_id = v_actor`, i.e. the Coach; the requirement scoping must be changed,
not the ownership check.)

---

## 2. Coaching — surfaces still answering from pre-cutover sources

### C4. Two Coaching reflection stores, consulted by different screens

`session_learning_reflections` is the canonical gate. But `sessions.coachee_notes`
is still the field the learner actually edits (`sessionLifecycle.ts:41` allows
`coachee_notes` for the coachee actor) and is what three surfaces read as "the
reflection":

- `pages/admin/alertScan.ts:57` — `hasReflection = !!s.coachee_notes?.trim()`, which
  drives the Admin "missing reflection" alert;
- `pages/journey/SessionsBlock.tsx:159` — renders `coachee_notes` as the reflection;
- `learner_reflection_feed` (C5).

So Admin Alerts will say a learner has reflected when the canonical gate is unmet, and
say they have not when it is met. This is precisely the "second answer to a business
question" the contract forbids.

### C5. The canonical Coaching reflection never appears in the reflection feed

`learner_reflection_feed` sources `coaching_session_reflection` from
`sessions.coachee_notes` (`20260919120000:1396-1402`). It has no branch for
`session_learning_reflections`. A learner who writes the canonical reflection (once C2
is fixed) sees nothing in "My Journey → Reflections"; one who writes `coachee_notes`
sees a reflection that satisfies no gate.

### C6. "Your Sessions" contradicts canonical Coaching progress

`learner_session_history` (`20260919120000:1348`) computes:

```sql
r.status = 'completed' AND EXISTS (SELECT 1 FROM session_activity_attributions …)  -- is_programme_evidence
```

For Coaching this is *session* completion, not *unit* completion. A held session with
no post-session evidence shows as programme evidence in the session list while
canonical progress does not count it. Separately, `requirement_unit_number` is
populated only for `triad_sessions` — Coaching sessions carry `cohort_requirement_id`
now but are still unlabelled, so there is no "Coaching 2" anywhere in the learner's
history.

### C7. The booking screen still displays the retired per-person cap

`BookSession.tsx:237-289` reads `programme_modules.config.receive_limit` and counts
completed sessions itself to render an "X of Y sessions used" banner, gated by
`isOverSessionLimit` (`bookingEligibility.ts:14`). `20260920150000` deliberately
removed that number as the quantity authority for programme Coaching — quantity is the
cohort requirement count. The banner is a frontend calculation of a programme fact
(Rule 1) and will disagree with the requirement count whenever `receive_limit ≠ the
number of scheduled Coaching requirements`.

### C8. The 24-hour cancellation block is still enforced client-side

`SessionDetail.tsx:143`:

```ts
const canCancel = status !== 'cancelled' && status !== 'completed'
  && isAfter(start, addHours(new Date(), 24));
```

`cancel_coaching_session` states the opposite rule (`20260920140000:246-260`): a Coach
or Admin may cancel at any time, and a learner may cancel late *with a reason*. The UI
hides the button from all three.

### C9. The superseded completion rule is still exported and still tested

`lib/sessionLifecycle.ts:33` — `canCompleteSession({kind:'coaching', coacheeNotes})`
returns `Boolean(coacheeNotes?.trim())`. No production code calls it (SessionDetail uses
`completionGate.canMarkSessionComplete`), but `lib/__tests__/sessionRemediation.test.ts:34`
still asserts it, so the guard suite actively protects the pre-cutover rule.
`canTransitionSession(…,'cancel')` in the same file encodes the C8 rule.

### C10. A held-but-unevidenced session counts as neither complete nor booked

`sponsor_canonical_activity` emits such a requirement as `status='confirmed'` with
`occurred_on = session start date` (`20260920130000:181-186`), and the migration
comment says it therefore "counts as booked rather than complete". But
`canonical_module_progress` counts booked units with
`status IN ('pending_coach_approval','confirmed') AND occurred_on >= p_as_of`
(`20260919120000:534`) — the session date is in the past, so it is excluded. Pace flips
from `scheduled` to `behind` the day after the session, before the learner has had any
chance to do the post-session work. Intent and computation disagree; pick one.

### C11. Legacy sessions consume the requirement budget

`can_book_session`'s programme branch (`20260920150000:104-114`) compares
`count(*) FROM sessions WHERE enrollment_id = … AND status IN (live, completed)`
against the requirement count. That count includes pre-cutover sessions with
`cohort_requirement_id IS NULL`, which `coaching_sessions_without_requirement()` exists
to report precisely because they are *not* attributable to a requirement. An enrollment
with 2 legacy sessions and 2 requirements is blocked from booking either requirement.

### C12. Confirmation is the one lifecycle step the database does not own

`book` / `cancel` / `reschedule` / `complete` all have canonical RPCs. There is no
`confirm_coaching_session`; `supabase/functions/confirm-session/index.ts:157` still does
a service-role `update({status:'confirmed', …})` directly. The service role bypasses
`guard_session_protected_fields` (`u IS NULL → RETURN NEW`), so this is the one
remaining second writer of `sessions.status`.

### C13. Eight canonical Coaching hooks have no caller; the screens call the RPCs directly

Found while fixing C2. `useCanonicalCoaching.ts` describes itself as "the single
frontend entry point to the canonical Coaching backend", but eight of its fourteen
exports are imported by nothing:

```
useCanonicalCoachingProgress   useCoachingRequirements       useBookCoachingSession
useCancelCoachingSession       useRescheduleCoachingSession  useCompleteCoachingSession
useCoachingPostSessionChecklist                              useSubmitCoachingSatisfaction
```

Unlike C2 the *capability* is reachable — the screens call the same RPCs
inline instead (`BookSession.tsx:382` calls `book_coaching_session` directly,
`useSessionCore.ts:258,286` call `cancel_coaching_session` and
`complete_coaching_session` directly). So this is not a missing feature; it is two
call paths to one backend contract, with only one of them carrying the module's
shared cache-invalidation list (`LIFECYCLE_KEYS`). `BookSession` works around that by
importing `useInvalidateCoaching` separately; `useSessionCore` does not, so a
cancellation or completion invalidates a different set of caches from a booking.

Either route the screens through the hooks or delete the unused ones — but a
file that claims to be the single entry point while eight of its exports are dead
is a maintenance trap. Low severity, no user-visible defect found.

---

## 3. Mentoring — only the eligibility half was cut over

`20260920200000`–`20260920230000` moved *who* may be booked to `cohort_mentors` and
closed the user-global paths properly (the fail-closed stubs for `get_my_mentors`,
`can_book_mentoring_session(uuid,uuid)` etc. are the right call for PostgREST-exposed
functions). Everything below the eligibility layer is unchanged.

### M1. Mentoring has cohort deadlines but no requirement attribution

`cohort_requirement_dates` already holds `mentoring` rows (the migration header says
6 in production) and journeys render Mentoring checkpoints from them. But
`mentoring_sessions` has no `cohort_requirement_id`, there is no
`canonical_mentoring_requirement_fulfilment`, and `sponsor_canonical_activity` emits
Mentoring rows with `requirement_due_on = NULL` (`20260920130000:198-204`).

In `canonical_module_progress`, `completed_due_units` filters on
`requirement_due_on IS NULL OR requirement_due_on <= p_as_of` — a NULL passes
unconditionally, so **an early Mentoring 3 hides an overdue Mentoring 1**. This is the
exact defect the Triad model was rebuilt to remove ("an early Triad 2 never hides an
overdue Triad 1") and that Coaching inherited the fix for.

### M2. Two answers to "how many Mentoring sessions are required"

`get_mentoring_session_usage` (`20260914071404:591`) returns
`config.receive_limit → programmes.mentoring_received_limit`, and
`can_book_mentoring_session_reason` still gates on it (`20260920210000:88-91`). The
canonical required count is `config.required_units` via `cohort_requirement_dates`.
Nothing keeps them equal. Coaching removed exactly this duality in `20260920150000`;
Mentoring kept it.

### M3. No atomic booking path

`MentoringBookSession.tsx:187` inserts straight into `mentoring_sessions` from the
client. There is no `book_mentoring_session`, so there is no `FOR UPDATE` lock on the
slot, no server-side validation that the requested start/duration fall inside the
published slot (Coaching added that in `20260920160000`), and the eligibility RPC is
re-checked only by the cap trigger and the INSERT policy.

### M4. The Mentoring slot lifecycle is the bug Coaching just fixed, still live

- `is_booked` is set only by `confirm-mentoring-session/index.ts:181`, i.e. at **mentor
  confirmation**, not when the request is created. The picker filters on
  `is_booked = false` (`MentoringBookSession.tsx:87`), so between request and
  confirmation the slot is still offered to everyone else — the exact double-booking
  window `20260920110000` closed for Coaching.
- Nothing ever sets it back to `false`. There is no mentoring equivalent of
  `sync_coaching_slot_reservation`.
- `mentoring_sessions_slot_id_unique` (`20260818140400:73`) is unique on `slot_id`
  across **all** statuses. `20260920110000:76` dropped the identical
  `sessions_slot_id_unique` for Coaching with the note that it means "a cancelled
  session kept holding [the slot] forever". Mentoring still has it, so a cancelled
  Mentoring slot is permanently unbookable while permanently appearing free.

### M5. No lifecycle guard on `mentoring_sessions`

`guard_session_protected_fields` has branches for `sessions`, `peer_sessions` and
`coachee_peer_sessions` — none for `mentoring_sessions`, and no trigger is attached.
Completion is a raw client write (`useMentoringSessionCore.ts:101`:
`.from("mentoring_sessions").update({ status: "completed" })`), and there is no
cancellation path at all (`cancel-session/index.ts:57` maps only to `sessions` /
`peer_sessions`).

### M6. Mentoring unit completion = session status, with no evidence gates

A Mentoring unit completes the moment the row reaches `completed`. Coaching now
distinguishes "the conversation happened" from "the programme unit is done"; Triads
requires a completed session of the requirement's group. Whether Mentoring should have
gates is a product decision — but it should be an explicit one recorded in the
contract, not an artefact of the cutover stopping early.

Note the two prep-file triggers dropped in `20260920210000` were a correct removal, and
the reschedule re-attribution trigger added in `20260920240000` correctly covers both
`mentoring_sessions` and `sessions`.

---

## 4. Triads — sound, with one residual duality

The Triad chain holds up under the contract. Requirement-scoped groups
(`triad_groups.cohort_requirement_date_id`), one active group per enrollment per
requirement (`triad_validate_group_member` + advisory lock), a single attribution
writer (`triad_sync_session_attributions`, which deletes evidence when a session is
cancelled), per-requirement fulfilment capped at `required_units`, per-deadline
overdue, and a 12-test frontend guard block plus an 834-line pgTAP contract. The
`validate_triad_session_cap` rewrite in `20260918190000:1245` correctly moved off the
retired `coach_/coachee_/observer_enrollment_id` columns before deployment 2 drops them.

### T1. `max_triads` is a second authority on Triad quantity

`validate_triad_session_cap` still enforces a per-person
`programme_modules.config.max_triads` cap (`20260918190000:1255`), and
`AdminProgrammes.tsx:201` exposes it as an editable field next to `required_units`.
The contract says Triad quantity is `required_units` via `cohort_requirement_dates`.
If an Admin sets `max_triads < required_units`, learners are blocked from fulfilling
requirements the same screen says they must fulfil. Same class as M2; Coaching removed
its equivalent.

---

## 5. Governance gaps that let all of the above through

### G1. The contract document does not describe the deployed system

`docs/architecture/source-of-truth.md` and `RULES.md` contain **zero** mentions of
`cohort_coach_assignments`, `canonical_coaching_requirement_fulfilment`,
`coaching_session_evidence`, `session_learning_reflections` or `cohort_mentors`. The
ownership matrix still lists "Activity completion (evidence) → `session_activity_attributions`",
which is no longer true for Coaching. Two cutovers shipped without updating the document
they are governed by.

### G2. No Coaching or Mentoring guard block

`src/test/programmeProfileArchitecture.test.ts` has a 12-test "Triad source of truth"
block that also scans `supabase/functions`. There is no equivalent for Coaching or
Mentoring. C4, C7, C8 and C9 are all exactly the shape that block catches for Triads.

### G3. The Coaching contract test cannot see C1

`supabase/tests/coaching_canonical_contract_test.sql` sets up two learners in one
cohort with two requirements, but L1 is only ever tested against requirement `d1d1` and
L2 only against `d2d2`. The one case that matters for a cohort model — two learners,
same requirement ordinal — is never exercised. The "a second learner cannot book a slot
that is already reserved" assertion at line 131 collides on *both* the slot and the
requirement, so it passes for the wrong reason.

### G4. Coaching attributions are now orphaned derived storage

`attribute_new_activity_trigger` still writes a `session_activity_attributions` row for
every Coaching session at INSERT, but `sponsor_canonical_activity` no longer reads them
for Coaching. They survive only as the input to `learner_session_history`'s
`is_programme_evidence` (C6) — i.e. derived storage that is still functioning as a
second answer. Either make it the projection of `coaching_session_evidence` or stop
writing it.

### G5. `sessions_reattribute_on_reschedule` is dead for Coaching

`20260920240000` attaches it to `AFTER UPDATE OF start_time`. But
`reschedule_coaching_session` does not move `start_time` — it marks the old row
`rescheduled` and inserts a new one. The stale attribution stays on the abandoned row,
and the trigger only ever fires for a direct Admin edit of `start_time`. The identical
trigger on `mentoring_sessions` does work, because Mentoring has no reschedule RPC and
its date genuinely is edited in place.

---

## 6. Suggested order of work

1. ~~**C1**~~ — done (index scoped to the enrollment; regression case added, G3
   closed for this defect).
2. ~~**C2**~~ — done (writer wired). **Still to decide: C4/C5** — either
   `session_learning_reflections` becomes the single Coaching reflection store and
   `coachee_notes` is retired for it, or the canonical gate reads `coachee_notes`.
   Not both. Until that lands, a learner has two places to write a reflection and
   only one of them counts.
3. **C3** — scope the ownership check in `book_coaching_session` (or give reschedule
   its own insert path) so Coach and Admin can reschedule.
4. **C6, C7, C8, C9, C12, C13** — the projection/UI cleanups, landed into the
   "Coaching source of truth" guard block started for C2 (G2) so they cannot regress.
5. **C10, C11** — decide and encode the two intent/implementation mismatches.
6. **Mentoring (M1–M5)** — give Mentoring the Coaching treatment:
   `cohort_requirement_id` on `mentoring_sessions`, a
   `canonical_mentoring_requirement_fulfilment`, `book_mentoring_session`, a slot
   reservation trigger + partial unique index, and a `guard_session_protected_fields`
   branch. M6 is a product decision to record first.
7. **T1, M2** — retire `max_triads` and `receive_limit` as programme-quantity
   authorities, the way `20260920150000` did for Coaching.
8. **G1** — update `docs/architecture/source-of-truth.md` and `RULES.md` in the same
   change as each of the above, not afterwards.
