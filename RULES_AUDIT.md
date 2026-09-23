# Rules audit — data logic, schema, constraints and enforcement

**Date:** 2026-09-23 · **Scope:** all 269 files in `supabase/migrations/` (the live definition of each function, trigger, policy and view = its last definition in filename order), `supabase/tests/`, `supabase/functions/`, and the React code that reads or writes the same data. **Nothing was changed** while auditing.

Paths are relative to `supabase/migrations/` unless they start with `src/` or `supabase/`. `file:line` points at the live definition.

## Legend

| Tag | Meaning |
|---|---|
| ✅ PASS | Rule exists and the database enforces it |
| ⚠️ APP-ONLY | Rule exists only in React (or only in one RPC) and can be bypassed |
| ❌ MISSING | Rule does not exist anywhere |
| 🔧 WRONG | Rule exists but its logic is incorrect or incomplete |

"Read-time" means the canonical progress functions simply **do not count** a row that breaks the rule. "Write-time" means a trigger or constraint **rejects** the row. The fulfilment rules in this codebase are almost entirely read-time. That keeps the numbers correct, but it does not stop bad rows from being stored.

## Findings confirmed by running them

These were reproduced on a local database (all migrations + `supabase/seed.sql`), each inside a rolled-back transaction:

| # | Action | Result |
|---|---|---|
| P1 | A sponsor, logged in as themselves, runs `UPDATE sponsor_profiles SET organization_id = <another org>` | **Succeeded.** The sponsor's organisation changed, so `sponsor_visible_enrollments()` would now return the other organisation's leaders. |
| P2 | A learner, logged in as themselves, inserts `training_progress` with `completed_at = '2020-01-01'` | **Succeeded.** The completion timestamp is whatever the client sends. |
| P3 | `UPDATE programme_enrollments SET cohort_id = <cohort of a different programme>` | **Succeeded.** No trigger checks that the cohort and the enrollment share a programme. Run as the table owner; the admin row policy (FOR ALL) allows the same write through the API. |

---

## Audit 1 — Completion rules

| Rule | Read-time (counting) | Write-time (rejecting) | Verdict |
|---|---|---|---|
| a) Training can't be completed before its week opens | ✅ `canonical_training_week_fulfilment` counts evidence only between the week opening and the effective as-of date: skill card `20260930100000_journey_current_fulfilment.sql:304-308`, quiz `:237-246`, reflection `:260-269`, prompt `:283-287` | ❌ No trigger or CHECK on `training_progress`, `assignment_submissions`, `reflection_submissions` or `daily_prompt_responses` looks at dates. `supabase/tests/requirement_availability_window_test.sql:112-115` inserts early evidence and only checks that it isn't counted. | ✅ counting / ❌ write guard |
| a′) Evidence timestamps are trustworthy | — | 🔧 The learner row policies allow any write to the learner's own rows (`20260903110200_training_progress.sql:18-21`, `20260903120400:18-21`, `20260903120200:23-26`, `20260905100200:112-115`). No trigger forces `completed_at` / `responded_at` / `submitted_at` to `now()`. The client sends them itself (`src/hooks/training/useSkillCard.ts:96`, `src/hooks/training/useDailyPrompt.ts:67`). **Test P2.** | 🔧 WRONG — a learner can write a back-dated, in-window timestamp, which defeats both the window and the end freeze for Training |
| a″) Locked weeks are unreachable | — | ⚠️ `TrainingWeeks.tsx` hides a locked week's links. The RLS check on `training_weeks` (`20260903110000:35-47`) uses only the template `unlock_date`, not the cohort override or cohort-start pacing. When the template date is NULL, every week is readable and can be marked complete. | ⚠️ APP-ONLY |
| b) Sessions count only from 14 days before `due_on` | ✅ `canonical_session_requirement_available_on = due_on - 14` (`20260930100000:97-106`), applied in the calendar (`:614-617`) | ❌ Booking and completion never compare dates with `due_on` (`book_coaching_session_internal` `20260925400000:276-420`; `complete_coaching_session` `20260920140000:358-402`). The docs say this is on purpose (`docs/architecture/source-of-truth.md:164-167`). | ✅ counting / ❌ write guard |
| b′) A too-early session must not block its requirement | — | 🔧 Coaching, Mentoring and Peer attach one live-or-completed session per requirement, and booking refuses a requirement that already has one (`20260925400000:359-366`; mentoring `:533`). A session completed before `due_on - 14` therefore **permanently occupies the requirement but never counts**. The requirement can't be completed. Triads avoid this (`min(...) FILTER`, `20260930100000:535-537`). | 🔧 WRONG |
| c) Freeze after programme end | ✅ `canonical_enrollment_effective_as_of = least(as_of, coalesce(e.end_date, c.end_date))` (`20260930100000:71-90`), used by every canonical reader (`:149, :431, :582, :687, :1013, :1060`) | ❌ No trigger rejects sessions or evidence dated after the end (the test seeds one: `requirement_availability_window_test.sql:145`). For Training it can also be dodged by back-dating (a′). | ✅ counting / ❌ write guard |
| d) Week complete = Skill Card + Quiz + Reflection; Daily Prompts never count | ✅ One definition: `week_complete` at `20260930100000:352-356`; prompts counted separately (`:325-326`). `get_enrollment_training_weeks.completed_at` is set only when `week_complete` is true (`:968-970`). React reads it and doesn't recompute (`TrainingWeeks.tsx`, `useProgrammeProgress.ts:70,146`). | n/a (derived) | ✅ PASS |
| d′) Leftover non-canonical Training block | `canonical_enrollment_experience_base` (`20260918180000:96-200`) still counts a skill card as `completed_at IS NOT NULL`, with no window. Its `learning_breakdown` output is replaced by the canonical one (`:301-320`). `weekly_participation` still uses raw activity, but no React component renders it. | — | 🔧 WRONG (dormant) |

`admin_ineligible_programme_activity()` (`20260930100000:1106-1204`) is a **diagnostic only**: admin-only, read-only, and it rejects nothing. It lists session and Training evidence that was refused credit (`completed_before_available`, `completed_after_programme_end`). Daily prompts are not included. ✅ PASS as a diagnostic.

---

## Audit 2 — Source of Truth chain (FK integrity)

### The chain assumed in the brief is wrong at the top

`programmes` has **no `organization_id` and no FK to organizations** (`20260430172516_9c6dc92e-….sql:12-22`). The organisation is attached in two places:
- `programme_enrollments.organization_id`: **the** visibility rule.
- `cohorts.organization_id`: only a default for new enrollments.

The real chain is **Programme → Cohort → Requirement dates → Enrollment (+ Organisation) → Session/evidence → Requirement fulfilment → Goal rating / Satisfaction**.

### Links

| Link | FK (file:line) | ON DELETE | NOT NULL | Orphan / inconsistency possible? |
|---|---|---|---|---|
| cohorts.programme_id → programmes | `20260430172516:40` | SET NULL | no | **Yes.** A cohort can lose its programme, or its programme can be changed freely by UPDATE. |
| cohorts.organization_id → organizations | `20260908100000:2-3` | SET NULL | no | Yes, by design (default only) |
| programme_modules / training_weeks → programmes | `20260903100000:20` / `20260903110000:8` | CASCADE | yes | No |
| cohort_module_deadlines → cohort, programme | `20260922100000:56-57` | CASCADE | yes | No |
| cohort_requirement_dates → cohort, programme | `20260918160000:31,36` | CASCADE | yes | Rows for a programme the cohort doesn't run can exist; they are only *reported* (`requirement_integrity_issues` → `requirement_unresolvable`, `20260928120000:92`) |
| programme_enrollments.programme_id | `20260430172516:63` | RESTRICT | yes | No |
| **programme_enrollments.cohort_id** | `20260430172516:64` | **SET NULL** | **no** | **Yes. 🔧 WRONG.** `validate_programme_enrollment()` (`20260910150000:32-38`, "cohort does not belong to programme") is **never attached as a trigger**. The rule lives only in the RPCs (`create_programme_enrollment` `20260925100000:906`). **Test P3.** |
| programme_enrollments.organization_id | `20260811100100:61` | SET NULL | no | Yes; reported as `enrollment_without_organization` |
| sessions.enrollment_id | `20260910150000:106` | RESTRICT | CHECK allows NULL only for retired rows recorded in the retirement ledger (`20260911200000:61-68`) | Retired rows only |
| sessions / mentoring_sessions → requirement, cohort | `20260920110000:30,34`; `20260921110000:34,38` | RESTRICT | no (NULL = not attributed) | ✅ Linking a session to another cohort's requirement is blocked by trigger (`20260920110000:152`; `20260921110000:141`). 🔧 The trigger checks **cohort only, not programme**: another programme's requirement in the same cohort is accepted, then silently ignored by the calendar. |
| peer_session_participants → enrollment / requirement | `20260921210000:51` / `:57` | **CASCADE** / RESTRICT | enrollment nullable (legacy) | ✅ Trigger checks cohort and programme (`:191`). `peer_session_id` has no FK (it can point at more than one session table), so it isn't cleaned up when a session is deleted. |
| peer_dyads / members | `20260929100000:802-812` | RESTRICT | yes | ✅ Same cohort and programme required |
| triad_groups → requirement | `20260919120000:55,111` | RESTRICT | yes | ✅ Cohort derived from the requirement and fixed; members' cohort and programme checked (`:151-153`) |
| training_progress / assignment_submissions / daily_prompt_responses → enrollment | `20260910150000:110-112` (NOT NULL `20260911200000:43-47`) | RESTRICT | yes | No. But their week / assignment / prompt parent is **CASCADE** (see below). |
| session_activity_attributions | `20260914071405:6` | RESTRICT | yes | `source_activity_id` has no FK. Triad completion is read from this **stored** table (`20260930100000:550`). |
| coachee_goals.enrollment_id | `20260910150000:122` | RESTRICT | CHECK with retirement ledger | ✅ `validate_enrollment_goal`: same learner, at most 3 active |
| **coachee_goal_ratings.goal_id** | **none** (`20260501205544:14`, `NOT NULL UNIQUE` only) | — | yes | **Yes. ❌ MISSING FK.** A rating can point at a deleted goal or at another enrollment's goal. |
| goal_checkins → enrollment, goal | `20260910150000:265-266` | RESTRICT | yes | Source session has no FK; checked by RPC |
| session_goal_ratings | **no FKs** (`20260501213615:9`) | — | — | Legacy table, no enrollment |
| Satisfaction | No table. Stored as rating columns on each session row, read through the view `canonical_session_satisfaction` (`20260926800000:41-85`) | inherits the session's | — | The 1–5 CHECKs are `NOT VALID` (not checked against old rows); the view filters to 1–5 |

### CASCADE paths that can silently delete completion history

1. 🔧 **Deleting a training week** (the Admin UI calls `.delete()` directly: `src/pages/admin/AdminTrainingContent.tsx:148`) cascades to `training_progress`, `assignments → assignment_submissions`, `daily_prompts → daily_prompt_responses`, and (by trigger `20260928100000:337-373`) the cohort's Training requirement rows. Nothing blocks it. **Highest silent-wipe risk.**
2. 🔧 **Deleting a coach, mentor or learner account** cascades `sessions.coach_id/coachee_id` (`20260429193745:92-93`), `mentoring_sessions.mentor_id/mentee_id` (`20260818140400`) and `peer_session_participants.user_id`. That removes **other learners'** completed sessions unless some unrelated FK happens to block the delete.
3. **Deleting an enrollment** cascades `peer_session_participants`, `enrollment_module_snapshots` and `session_learning_reflections`. It is usually blocked by RESTRICT children, but not always (e.g. a learner who was only ever a peer provider).
4. 🔧 **Deleting a cohort** (`src/pages/admin/AdminCohorts.tsx:115`) is blocked once activity is attributed. A cohort with enrollments but no activity deletes cleanly and leaves enrollments with `cohort_id = NULL`. The canonical readers inner-join cohorts, so those learners silently show no progress at all.
5. Deleting a programme is blocked by enrollments (RESTRICT). Without enrollments it cascades modules, weeks, requirement dates and triad groups.

### Is overall status derived or stored?

- ✅ **Derived, with one chain in SQL:**
  - `canonical_enrollment_requirement_calendar` (`20260930100000:569`) → `canonical_enrollment_requirement_status` (`:664`) → checkpoints / `canonical_enrollment_journey` (`:793`).
  - `canonical_module_progress` (`20260928100000:646`, per-module `pace_status`) → `canonical_enrollment_progress` (`20260928130000:21`, overall `pace_status` + `effective_enrollment_status`).
  - Sponsor, learner, coach and admin surfaces all call these.
- ✅ No table stores `pace_status`, on-track or a completion %. `programme_enrollments.progress_pct` is forced to NULL and marked deprecated (`20260918170000:539-543`).
- 🔧 **Lifecycle and progress share one enum.** `enrollment_status = ('active','completed','paused','at_risk')` (`20260430172516:4`). A *stored* `at_risk` is a progress word in a lifecycle column. `canonical_enrollment_progress` passes it through until the programme ends, and `src/pages/admin/coachees/CoacheeProfileSheet.tsx:123` displays the stored value directly.
- ⚠️ `src/pages/admin/AdminAlerts.tsx:166-195` scans enrollments in the browser and **writes** `admin_alerts` rows ("programme_at_risk", "overdue_actions"). That is a stored, client-generated status which can go stale.
- ⚠️ `src/pages/sponsor/SponsorCohortDetail.tsx:527` builds its "needs attention" filter in the browser, partly from conditions that aren't a canonical status.
- 🔧 `src/hooks/journey/useModuleRequirements.ts:35` recomputes overdue as `due_on <= today` (the canonical rule is `due_on < as_of`, `20260930100000:647`). It uses a UTC date and the raw `fulfilled_on`, ignoring the window and the freeze. The comment claims it matches the canonical rule; it doesn't.
- Minor: `src/hooks/coach/types.ts:5` `ClientPaceStatus` includes `at_risk` (not a pace value) and lacks `scheduled` / `not_yet_due`.

---

## Audit 3 — Sponsor isolation (organisations mixed in one cohort)

**Conclusion: the schema already supports cohorts with leaders from different organisations. No migration is needed for isolation itself.** Fix P1 before relying on it.

- ✅ **The shared rule joins through the leader's enrollment, never the cohort:**
  - `sponsor_visible_enrollments()` (`20260926200000:46-64`) joins `sponsor_profiles` on `e.organization_id = sp.organization_id` and requires `has_role(auth.uid(),'sponsor')`.
  - The per-row version is `sponsor_can_view_enrollment(uuid)` (`20260925100000:118-131`).
- ✅ **`cohorts.organization_id` still exists but authorises nothing.**
  - Current uses: the default organisation for new enrollments (`coalesce(p_organization_id, cohort.organization_id)`, `20260925100000:927,980`; `20260926100000:87`), a one-time backfill, and admin display.
  - `src/test/migrationChain.test.ts:531` asserts no live sponsor surface authorises through it.
  - The old cohort-fallback functions (`sponsor_roster`, `sponsor_kpis`, `sponsor_coach_utilisation`, …) were dropped (`20260911140000:37-58`, `20260918180000:428-445`).
- ✅ **Every live sponsor function** goes through the shared rule. Checked: `sponsor_canonical_enrollment_progress`, `_leader_progress`, `_leader_journey`, `_leader_experience`, `_leader_schedule_state`, `sponsor_leader_requirement_calendar`, `_cohort_progress(_one)`, `_organisation_progress`, `sponsor_canonical_programme_journey`, `sponsor_submit_report_request`. The PDF edge function (`supabase/functions/generate-report-pdf/index.ts:85-86`) calls them with the caller's own login.
- ✅ **No sponsor row policies** remain on profiles, coachee_profiles, programme_enrollments or programme_modules (dropped `20260911150000:4-7`). Sponsor pages read learner data only through RPCs.
- ✅ Tests: `supabase/tests/sponsor_enrollment_org_visibility_test.sql` (a cohort shared by organisations A and B, plus a cohort whose row says A but which holds only B's learner).
- 🔧 **P1 — a sponsor can change their own organisation.** `"Sponsor profiles: own update"` (`20260908140000_sponsor_settings_schema.sql:24-27`) has no column restriction. No REVOKE and no trigger protects `organization_id`. The only obstacle is `UNIQUE(organization_id)`. Organisation ids are discoverable: `get_sponsor_org(uuid)` (`20260811100100:77`) can be executed by anyone, including anonymous callers.
- ⚠️ **The organisation default hides admin mistakes.** An enrollment created without an organisation silently inherits the cohort's. In a mixed cohort, forgetting the organisation puts the leader in the wrong sponsor's view.
- Minor:
  - `"Cohorts: authenticated view"` is `USING (true)` (`20260430172516:53`), so sponsors can list every cohort's name and organisation. Metadata only.
  - `sponsor_list_report_requests` (`20260914071406:47`), the `sponsor_report_requests` read policy and `"Organizations: sponsor view own"` check the `sponsor_profiles` row but not the sponsor **role**. The main rule gained that check in `20260926200000`.
  - `organizations.admin_notes` is readable by the organisation's sponsor.
  - The stale column comment at `20260908100000:5-7` still says the cohort organisation grants visibility.
- **Model limit:** `sponsor_profiles` is `user_id PRIMARY KEY, UNIQUE(organization_id)` (`20260811100100:37-45`). One sponsor per organisation and one organisation per sponsor. ❌ MISSING if an organisation needs several sponsor seats.
- The minimum-group-size gate (`sponsor_min_leaders_for_distribution()` = 5) no longer hides anything by design (`20260925100000:34-55`). Named rows show each leader's own `satisfaction_avg` and goal-progress %. **Confirm this is intended.**

---

## Audit 4 — Per-session deadlines

| Check | Verdict |
|---|---|
| One `due_on` per (cohort, programme, module, ordinal) | ✅ `due_on date NOT NULL` (`20260918160000:40`), `UNIQUE(cohort_id, programme_id, module, ordinal)` (`:57`), `units = 1` enforced by two CHECKs (`20260922100000:206`, `20260923100000:132`), Training row requires a week plus a unique index (`20260928100000:57-63`) |
| The calendar reads per-session dates | ✅ `20260930100000:610-623` joins by ordinal; no module fallback |
| Overdue uses per-session dates | ✅ `canonical_module_progress` / `canonical_overdue_items` aggregate the calendar (`20260928100000:646-712`); overdue = `due_on < as_of AND not completed` (`20260930100000:647`); journeys and sponsor schedule read `d.due_on` |
| An admin override sticks | ✅ Sync only moves rows where `NOT is_overridden` (`20260928100000:221-232, 269-277`). Changing the module deadline doesn't touch overridden rows (`20260923100000:679-754`). Only an explicit reset (`admin_set_cohort_requirement_dates` with `due_on` null, which the UI's "Apply to all" sends) clears one. |
| Silent fallback to the module-level deadline | ✅ None in live due/overdue logic. `cohort_module_deadlines.completion_deadline` is read only by sync, admin setters and display. |
| Silent fallback for Training | 🔧 `canonical_training_week_fulfilment.due_on = coalesce(d.due_on, cohort override, cohort start + (week-1)*7, template unlock)` (`20260930100000:195-200`). If no stored row exists, a computed date is used silently. That happens when `training_week_ids` is not an array: every week is selected (`:231`) but sync creates no rows (`20260928100000:118-121`); only reported as `training_units_mismatch`. |
| Training opening date | 🔧 (by design, but surprising) `available_on` is always computed and never read from the stored row (`20260930100000:202-209`). An admin override of a Training `due_on` does not move when the week opens. |
| React computing due/overdue itself | 🔧 `useModuleRequirements.ts:35` (see Audit 2). Otherwise ✅: `completion_deadline` appears only in the admin editor. |

---

## Audit 5 — Follow-up action integrity (`enrollment_actions`)

| Check | Verdict |
|---|---|
| Text + due date + goal + source session on every new action | ✅ Enforced by the BEFORE INSERT/UPDATE trigger `validate_enrollment_action` (`20260930100000:1229-1300`): goal and due date `:1251-1259`, source `:1260-1262`, non-blank title `:1295-1297`. The columns themselves are nullable (`20260910150000:126-135`), deliberately, so historical rows stay valid without invented values. Direct API writes and the service role both pass through the trigger. |
| Goal from a different leader | ✅ FK to `coachee_goals` (`20260910150000:129`) plus a same-enrollment check (`20260930100000:1264-1269`); milestone must belong to the same goal (`:1271-1281`) |
| Source session recorded and owned | ✅ `enrollment_activity_participants` (`:1302-1358`) requires the session to exist with the same enrollment and owner. Covers coaching, peer (both sides), mentoring and triad. |
| Goal moved to another enrollment later | 🔧 Checked only when the action is written. `validate_enrollment_goal` (`20260910171000:10-21`) lets a goal move to another enrollment of the same learner; the actions aren't re-checked. Detected by `admin_action_integrity_issues` (`goal_other_enrollment`). A milestone moving goal is **not detected** (❌). |
| Deleting a goal that has actions | 🔧 FK is `ON DELETE SET NULL`, which the trigger rejects, so the delete fails with the misleading error "New post-session actions require a goal and due date". Behaves like RESTRICT, with the wrong message. |
| Due date bounds | ❌ No check against the session date or the enrollment window |
| Source session status | ❌ An action can attach to a scheduled or cancelled session, so "post-session" isn't enforced |
| `completed_at` / delete by learner | ⚠️ The RPC sets `completed_at` properly, but a direct UPDATE can set it to anything, and a learner can DELETE any of their actions |
| Integrity report visible to admins | ❌ `admin_action_integrity_issues` (`:1515-1551`) isn't called anywhere in `src/`; it is SQL-only |
| Frontend status round-trip | 🔧 `src/lib/enrollmentActions.ts:116` sends `status: done ? "completed" : "open"`, so saving turns an `in_progress` or `cancelled` action back into `open` |

---

## Audit 6 — Privacy boundary

**Summary: ✅ PASS.**
- No live row policy gives the sponsor role access to any coaching-content table. The only `has_role(...,'sponsor')` uses in policies are *exclusions* (`20260911150000:13,17-25`) and the `admin_alerts` insert.
- Sponsor functions return counts, percentages, dates, generic requirement labels, week titles, and learner, cohort and programme names only.
- No sponsor page or hook reads any field below.

| table.column | Sponsor row access | In a sponsor function or export | Verdict |
|---|---|---|---|
| sessions.coach_notes, coachee_notes, coachee_rating_comment, cancel_reason | no | no | ✅ |
| coach_session_private_notes.body, peer_coach_session_private_notes.body, coach_client_notes.body | no | no | ✅ |
| peer_sessions.coach_notes, coachee_notes, coachee_rating_comment | no | no | ✅ |
| coachee_peer_sessions.provider_notes, provider_private_notes, receiver_notes, receiver_rating_comment | no | no | ✅ |
| mentoring_sessions.mentor_notes, mentee_notes, prep_file_notes; mentoring_feedback.overall_notes | no | no | ✅ |
| triad_sessions.notes, member_*_response; triad_session_responses.response; triad_reflection_answers.answer_text | no | no | ✅ |
| coachee_goals.title, description; coachee_milestones.title | no | no | ✅ (the `shared_with_sponsor` flag is unused) |
| session_goal_ratings.note | no | no | ✅ |
| enrollment_actions.title, description | no | counts only | ✅ |
| session_messages.body (the chat table) | no | no | ✅ |
| session_learning_reflections.body, coachee_reflections.body, reflection_answers.answer_text | no | no | ✅ |
| assignment_submissions.answers, reflection_text; daily_prompt_responses.response_text | no | counts only | ✅ |
| peer_session_competency_feedback.feedback_note; coach_session_feedback.flag_notes; tool_sessions.responses | no | no | ✅ |
| programme_enrollments.notes, ended_reason | no | no | ✅ |

**Coach identity:**
- ✅ No sponsor function returns a coach name or id.
- ⚠️ A dead component still renders `coach_name`: `CoachUtilisationBars` in `src/pages/sponsor/_shared.tsx:32-49`, with its type in `src/hooks/sponsor/useSponsorDashboardData.ts:14`. It is unused and has no data source; remove it so it can't be reconnected.
- ❌ **Coach credential tier (ACC/PCC/MCC) does not exist** anywhere in the schema or sponsor output. The design says sponsors see the tier and not the name; today they see neither. This was only implemented in the static prototype `Clariva_Sponsor_Portal.html`.

**Other free text a sponsor can see (not coaching content):** `organizations.admin_notes`; `sponsor_report_requests.request_notes` / `admin_notes`.

**Unrelated to sponsors:** `coachee_availability` has an "authenticated view" policy (`20260830140000:75`), so every logged-in user can see every active learner's id and availability slots.

---

## Audit 7 — Edge cases

| Case | What actually happens | Verdict |
|---|---|---|
| a) Leader with no organisation | Allowed (nullable column; the writers fall back to the cohort's organisation and store NULL when that is NULL too). **Hidden from every sponsor**: the rule's join never matches NULL. Reported as `enrollment_without_organization` (`20260928120000:143-146`), shown in the admin schedule and tested (`requirement_calendar_contract_test.sql:396`). | ✅ PASS (no crash, no leak) |
| b) Programme with 0 requirements | The calendar is empty. `canonical_enrollment_progress` returns `required_units = 0`, completion NULL, pace `not_yet_due`, `progress_available = false` (`20260928130000:124-129`). The journey returns `[]` (`20260930100000:803-815`). Every SQL division is guarded; `ratioPct` returns null for a 0 denominator; `ProgrammeJourney.tsx:104-107` shows an empty state. | ✅ PASS · 🔧 copy: the sponsor empty state uses `leaderDrawer.reference.journeyWithheld` (`src/locales/en/sponsor.json:547`), which wrongly says checkpoints are withheld · 🔧 `SponsorDashboard.tsx:95` turns a NULL completion into `?? 0` and shows 0% instead of "—" |
| c) Same organisation, different coaches | Sponsor sees both leaders, one row per visible enrollment; no coach name or id in any sponsor function | ✅ PASS (coach tier ❌ missing, see Audit 6) |
| d) Requirement date NULL | `cohort_requirement_dates.due_on` is NOT NULL. **But a session requirement with no date row at all** comes out of the calendar's LEFT JOIN with `requirement_id` and `due_on` NULL (`20260930100000:620-623`). It can never be completed, stays `upcoming` forever (`:704`), is left out of the journey (`:753, :846`), but **still counts in `required_units`**. Completion can't reach 100%, and the last checkpoint ≠ the canonical total. Only reported as a schedule violation. | 🔧 WRONG |
| d′) Training week with no dates | `LEAST` ignores NULLs (`20260930100000:193-209`). With no cohort start, override or template unlock, `available_on` becomes the cohort **end** date, so any earlier work doesn't count. If the end date is NULL too, the week can never be completed but still counts as required. Only partly reported (`training_week_unmapped`). | 🔧 WRONG |
| d″) No programme end | The freeze correctly becomes "no freeze" (`20260930100000:83-86`) | ✅ PASS |
| d‴) Two different end dates | The freeze uses `coalesce(enrollment end, cohort end)`, but the automatic completed / at_risk status compares against the **cohort** end only (`20260928130000:35,110,117`). With a NULL cohort end, progress freezes at the enrollment end but the status never changes. | 🔧 WRONG |

---

## Prioritised fix list

### P0 — security and data loss

1. **Stop sponsors changing their organisation.** In a new migration: `REVOKE UPDATE ON public.sponsor_profiles FROM authenticated; GRANT UPDATE (title, department, phone) ON public.sponsor_profiles TO authenticated;`, or add a BEFORE UPDATE trigger that rejects `organization_id` changes by non-admins. Also `REVOKE EXECUTE ON FUNCTION public.get_sponsor_org(uuid) FROM anon, authenticated`. Add a case to `supabase/tests/sponsor_isolation_test.mjs`. *(Source: `20260908140000_sponsor_settings_schema.sql:24-27`, `20260811100100:77`)*
2. **Make Training evidence timestamps server-owned.** Add a BEFORE INSERT/UPDATE trigger on `training_progress`, `assignment_submissions`, `reflection_submissions` and `daily_prompt_responses` that sets `completed_at` / `submitted_at` / `responded_at` to `now()` for non-service callers. Reject the write when the week isn't open for the enrollment or the programme has ended. Remove the client-sent timestamps in `src/hooks/training/useSkillCard.ts:96` and `src/hooks/training/useDailyPrompt.ts:67`. *(Closes 1a, 1a′, 1c for Training.)*
3. **Guard deletes that wipe history.** Add BEFORE DELETE triggers that refuse:
   - a `training_weeks` row that has any evidence;
   - a cohort that has enrollments;
   - a profile or auth user that is the coach, mentor or learner of a completed session.

   Better still, change those `sessions` / `mentoring_sessions` person FKs from CASCADE to RESTRICT. *(Source: `20260903110000:8`, `20260903110200:8`, `20260903120000:8`, `20260903120300:6`, `20260429193745:92-93`, `20260818140400`; the delete calls are in `src/pages/admin/AdminTrainingContent.tsx:148` and `src/pages/admin/AdminCohorts.tsx:115`.)*

### P1 — source-of-truth correctness

4. **Enforce enrollment ↔ cohort ↔ programme.** Attach `validate_programme_enrollment()` (`20260910150000:32`) as BEFORE INSERT/UPDATE on `programme_enrollments`, or add a composite FK `(cohort_id, programme_id) → cohorts(id, programme_id)`. Make `cohort_id` RESTRICT; block `UPDATE cohorts SET programme_id` once enrollments exist. Extend `requirement_integrity_issues()` (`20260928120000:92`) to report mismatches and stale session attribution.
5. **Early sessions must not lock a requirement.** Choose one:
   - reject booking or completion before `due_on - 14` in `book_coaching_session_internal` / mentoring / peer (`20260925400000:276-420`); or
   - let the "already has a live or completed session" check (`20260925400000:359-366`, mentoring `:533`) ignore sessions completed outside the window, and have `next_*_requirement` skip them too.
6. **A requirement without a date row must not count as required.** In `canonical_enrollment_requirement_calendar` (`20260930100000:569-623`), either drop rows with no stored requirement, or make them block. Pick one rule so `required_units` always equals the journey total.
7. **Training dates without a fallback.** Remove the computed `coalesce(...)` fallback for `due_on` (`20260930100000:195-200`), or materialise rows whenever weeks are selected. Stop `available_on` ending up after `due_on` when all pacing dates are NULL (`:202-209`).
8. **Use one end date.** Have `canonical_enrollment_progress` (`20260928130000:35,110,117`) use the same `coalesce(enrollment end, cohort end)` as `canonical_enrollment_effective_as_of`.
9. **Separate lifecycle from progress.** Stop storing `at_risk` in `programme_enrollments.status` (`20260430172516:4`); derive it only. Stop `src/pages/admin/coachees/CoacheeProfileSheet.tsx:123` showing the stored value.
10. **Add the missing FK:** `coachee_goal_ratings.goal_id → coachee_goals(id)` (`20260501205544:14`) plus a same-enrollment check.

### P2 — rule gaps and consistency

11. Validate programme as well as cohort in the coaching and mentoring attribution triggers (`20260920110000:152`, `20260921110000:141`).
12. Actions:
    - change the `coachee_goals` FK on `enrollment_actions` to RESTRICT with a clear message;
    - re-check actions when a goal or milestone moves;
    - bound `due_date`;
    - require the source session to be completed;
    - stop `src/lib/enrollmentActions.ts:116` resetting `in_progress` / `cancelled`;
    - show `admin_action_integrity_issues()` in the admin UI.
13. Fix `src/hooks/journey/useModuleRequirements.ts:35`: use `<` and a local date, and read canonical status instead of raw `fulfilled_on`.
14. Move admin alert generation out of the browser (`src/pages/admin/AdminAlerts.tsx:166-195`) into a canonical function.
15. The report-request list, its row policy and the organisation "view own" policy should also require the sponsor role (`20260914071406:47`).
16. Remove the dormant non-canonical Training block in `canonical_enrollment_experience_base` (`20260918180000:96-200`) and the dead `CoachUtilisationBars` (`src/pages/sponsor/_shared.tsx:32-49`).

### P3 — product decisions and polish

17. **Coach tier (ACC/PCC/MCC):** add a tier column on `coach_profiles` and expose only the tier in sponsor leader detail, if the design is confirmed.
18. Confirm that sponsors may see each named leader's `satisfaction_avg` and goal progress now that the size gate is off.
19. Multiple sponsor seats per organisation would need `UNIQUE(organization_id)` on `sponsor_profiles` dropped.
20. Copy and display fixes:
    - `sponsor.json:547` "journeyWithheld" wording;
    - `SponsorDashboard.tsx:95` `?? 0`;
    - stale column comment `20260908100000:5-7`;
    - `src/hooks/coach/types.ts:5` pace values;
    - `coachee_availability` visible to every logged-in user.
