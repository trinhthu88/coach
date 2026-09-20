# Clariva source-of-truth contract

**One authoritative source per business fact.** Every Admin, Learner, Sponsor,
Analytics, Alerts, Dashboard, Journey or reporting surface is a *projection*
of that source. Role and privacy rules may hide detail. They must never
change how a number, date or state is calculated.

Derived or cached storage may exist when it's technically useful, but it is
never a second answer to a business question.

## Ownership matrix

| Business fact | Authoritative source | Read through (all roles) | Notes |
|---|---|---|---|
| **Programme required units** (what is required) | `programme_modules.config` (`required`, `required_units`) | `canonical_module_progress` → `canonical_enrollment_progress` | Admin edits the programme template. |
| **Default scheduling policy** | `programme_modules.config.distribution_mode` + `distribution_settings` | `cohort_requirement_proposal_internal` only | Proposal/generation layer only. Nothing downstream re-runs the policy. |
| **Cohort requirement due dates** (Coaching / Peer / Mentoring / Triads) | `cohort_requirement_dates` | `sponsor_canonical_module_schedule` | Materialized on cohort creation. Only missing modules are auto-filled. Changed only by Admin save or explicit "Regenerate schedule". |
| **Training / Learning cohort timing** | `training_weeks.unlock_date` + `cohort_week_overrides` | `canonical_training_learning_items` → `sponsor_canonical_module_schedule` | Training-linked *other* modules copy these dates at materialization and don't follow later changes (Admin regenerates explicitly). |
| **Required vs scheduled (mismatch)** | derived from the two rows above | `cohort_programme_schedule_state` → `learner_/sponsor_canonical_leader_/admin_canonical_schedule_state`, `cohort_requirement_schedule_issues` | For example "Coaching 5 required / 4 scheduled". Nothing is invented; every role sees the same state. |
| **Enrollment applicability** | `programme_enrollments` (programme, cohort, status) | canonical progress / journey wrappers | *Effective* status (after the programme end date) is computed once in `canonical_enrollment_progress`. |
| **Activity completion** | the session lifecycle, per requirement (Coaching / Mentoring / Triads); `session_activity_attributions` for Peer, quiz, daily prompt and Training | `sponsor_canonical_activity`, `canonical_training_learning_items` | Session booking dates never become requirement due dates. See the operational-vs-evidence rule below. |
| **Coaching provider** | `cohort_coach_assignments` | `cohort_coaching_coach_pool` → `enrollment_coaching_coach_pool` | The learner-level allowlists are not programme Coaching authority. |
| **Coaching requirement link** | `sessions.cohort_requirement_id` (server-assigned) | `canonical_coaching_requirement_fulfilment` | One live session per LEARNER per requirement. |
| **Coaching completion** | a COMPLETED session attributed to a requirement | `canonical_coaching_requirement_fulfilment` → `sponsor_canonical_activity` | Evidence never gates it (`20260921130000`). |
| **Mentoring provider** | `cohort_mentors` | `cohort_mentoring_mentor_pool` → `get_mentors_for_enrollment` | The user-global `mentoring_allowlist` is not programme Mentoring authority. |
| **Mentoring requirement link** | `mentoring_sessions.cohort_requirement_id` (server-assigned) | `canonical_mentoring_requirement_fulfilment` | One live session per LEARNER per requirement. |
| **Mentoring completion** | a COMPLETED session attributed to a requirement | `canonical_mentoring_requirement_fulfilment` → `sponsor_canonical_activity` | The preparation document is optional and gates nothing. |
| **After-session evidence** | the evidence records themselves | `coaching_session_evidence`, `mentoring_session_evidence` | REPORTING ONLY. Neither returns a unit or progress field. |
| **Module completion, overall completion %, due-to-date adherence %, overdue units, pace** | computed once | `canonical_enrollment_progress` (per module: `canonical_module_progress`) → `learner_canonical_progress`, `sponsor_canonical_enrollment_progress` / `_leader_progress` / `_enrollment_metadata`, `admin_canonical_enrollment_progress` | Cohort and organisation rollups aggregate these per-enrollment rows. |
| **Programme Journey checkpoints** | computed once | `canonical_enrollment_journey` → `learner_canonical_journey`, `sponsor_canonical_leader_journey`, `admin_canonical_enrollment_journey`; cohort view `get_sponsor_programme_journey` (same schedule, cohort aggregate) | One checkpoint per due date. Modules only in `module_scope`, never as a title. The UI never regroups checkpoints. |
| **Session history** | session tables (`sessions`, `coachee_peer_sessions`, `peer_sessions`, `mentoring_sessions`, `triad_sessions`) | `learner_session_history` | |
| **Goals / actions** | `coachee_goals`, `coachee_goal_ratings`, `enrollment_actions` | per-goal progress `canonical_goal_progress`; aggregates `canonical_enrollment_engagement` | Archived goals are excluded; unrated goals have no progress. |
| **Reflections** | original reflection records; for Coaching and Mentoring `session_learning_reflections` | `learner_reflection_feed` | `sessions.coachee_notes` is historical for Coaching (`20260921190000`): it was a second place a reflection could live, so the feed and the Admin alert disagreed with the evidence record. |
| **Feedback** | original feedback records | learner feedback source (`useLearnerFeedback`) | Author-private notes are never selected. |
| **Triad membership** | `triad_group_members.enrollment_id` | `canonical_triad_group_members` → `learner_triad_members` | Never derived from session records or role columns. See the Triad ownership map below. |

## Triad ownership map

Established by `20260918185800_triad_cutover_ledgers`, `20260918185850_triad_reviewed_decisions`, `20260918185900_triad_legacy_data_cleanup`, `20260918189000_demo_generator_triad_model`, `20260918190000_triad_canonical_cutover` and `20260918195000_canonical_engagement_signals` (deployment 1, live since 2026-09-19), corrected by the forward migration `20260919120000_triad_requirement_groups` (every required Triad has its own group assignment). Legacy storage is dropped by `supabase/deployment-2/20260919190000_triad_retire_legacy.sql` (deployment 2, only after the above are verified in production).

**EVERY REQUIRED TRIAD HAS ITS OWN GROUP ASSIGNMENT.** The business model:

- **Programme** = how many Triads are required (N).
- **Triad requirement** = `cohort_requirement_dates` row "Triad 1 … Triad N" of the cohort, each with its own deadline. This is the only Triad "round"; there is no other round object.
- **Group** = the enrollments assigned together for ONE requirement (`triad_groups.cohort_requirement_date_id`). The group owns no date: it references the requirement that owns the deadline.
- **Session** = the actual practice session of that group (normally one).
- **Fulfilment** = a completed session of a requirement's group fulfils THAT requirement, once, for every member of the group. It never fulfils another requirement.

A learner therefore has different group memberships for Triad 1, Triad 2, Triad 3 … (at most one active group per requirement). Extra sessions under one requirement are raw activity only. Nothing assumes the Triad 1 group continues into Triad 2.

| Triad fact | Authoritative source | Read through | Notes |
|---|---|---|---|
| Triad required count | `programme_modules` (`module = 'triads'`, `config.required_units`) | `canonical_module_progress` → `canonical_triad_completion` | Groups can only be created for learners whose programme requires Triads. |
| Triad requirement (Triad N + its deadline) | `cohort_requirement_dates` (`module = 'triads'`, `ordinal = N`, always `units = 1`) | `admin_cohort_triad_requirement`, `admin_cohort_triad_requirements`, `canonical_triad_completion.schedule`, journeys | Its identity is stable: "Regenerate schedule" updates rows in place, and a requirement with assigned groups can't be removed (`cohort_requirement_dates_keep_triad_groups`). Edit its date in the Cohort Requirement Schedule only; every role follows. |
| Triad group | `triad_groups.cohort_requirement_date_id` (+ `is_active`, `closed_at`, `assigned_by`, `group_language`); `cohort_id` is derived from the requirement and validated | `admin_cohort_triad_groups`, `learner_triad_overview` | One group per requirement assignment. Its requirement (and cohort) never change (`triad_guard_group`). |
| Triad members | `triad_group_members.enrollment_id` | `canonical_triad_group_members` → `learner_triad_members` | 2–3 enrollments of the requirement's cohort and programme. **One active group per enrollment per requirement** (`triad_validate_group_member`, serialised by an advisory lock). Membership is final once the group has any session: to regroup, close the group and create a replacement group for the SAME requirement. |
| Actual session | `triad_sessions` (`scheduled_start_time / scheduled_end_time`, `status`) | `learner_triad_overview`, `learner_session_history` (`requirement_unit_number` → "Triad N"), `admin_cohort_triad_groups` | `proposed → confirmed → completed`, or `cancelled`. `completed` and `cancelled` are final. One open session per group. Once the group's session is completed, the group schedules no further programme session (`learner_triad_schedule_session`). |
| Session acceptance | `triad_session_responses` (session × enrollment) | `learner_triad_overview` | Only members of the session's historical group can respond. |
| Alternative time | `triad_alternative_proposals` (`pending → accepted \| superseded \| withdrawn`) + `triad_alternative_proposal_responses` | `learner_triad_overview` | A candidate becomes the session time only when every member accepts it. |
| Goal check-in | `goal_checkins` (via `record_goal_checkins`, source `triad`) | `learner_reflection_feed` | Never copied into Triad tables. |
| Triad reflection | `triad_reflections` (one per session × enrollment; `satisfaction_rating`) | `learner_triad_session_reflections`, `learner_reflection_feed` | Group members see each other's only after everyone has submitted. Sponsors never see it. |
| Triad answers | `triad_reflection_answers` × `triad_reflection_questions` (stable ids / keys) | same | |
| Completion evidence | session × historical membership → `session_activity_attributions` (one writer: `triad_sync_session_attributions`) | `canonical_triad_requirement_fulfilment` | Session evidence only: `milestone_id` is always NULL for Triads. Dated on the session's scheduled start. A cancelled session is no evidence. |
| **Fulfilment** | evidence of the enrollment on a completed session of a group linked to requirement N | `canonical_triad_requirement_fulfilment` (one row per requirement: `fulfilled_on`, `booked_on`, `proposed_on`) → `sponsor_canonical_activity` (one Triad row per requirement, with `requirement_due_on`) | THE rule. Each requirement contributes at most one unit; a second session in the same group is raw activity only. |
| **Completion** | fulfilled requirements, capped at the programme's required units | `canonical_module_progress` → `canonical_triad_completion` (`completed_units`, `raw_completed_sessions` = activity only, `schedule` per requirement with its group) | |
| **Due / overdue** | each requirement against its OWN deadline | `canonical_module_progress` → `canonical_triad_completion` (`due_units`, `overdue_units`, `next_due_on`), journeys | `due_units` = requirements with deadline ≤ as-of. `overdue_units` = due requirements − fulfilled due requirements (an early Triad 2 never hides an overdue Triad 1). Journey checkpoints count a requirement only at checkpoints on or after its own deadline. `next_due_on` = earliest unfulfilled requirement. |
| Triad reflection rate | `triad_reflection_rate_internal` | `admin_programme_triad_reflection_rate`, `send-weekly-admin-summary` | An engagement signal, labelled "Triad reflection". It is never Triad completion. Weeks come from the canonical training schedule (`canonical_training_learning_items`); nothing rebuilds cohort weeks. |
| My Journey / Your Sessions / Dashboard | projections only | `learner_reflection_feed`, `learner_session_history`, `canonical_enrollment_journey` | No Triad data is copied into another table. No round or week label. |

Every role reads these facts from the same place: Admin (`admin_cohort_triad_learners`), Learner (`learner_triad_status`, `learner_canonical_progress`), Sponsor (`sponsor_canonical_leader_progress` / journey) and a coach enrolled as a learner (the learner path). Privacy can hide reflection content, but never changes a programme fact.

Assignment is always requirement-first: selected Triad requirement (`cohort_requirement_date_id`) → its cohort's eligible ongoing enrollments in its programme → exclude those already in an active group FOR THIS requirement (`triad_requirement_candidates_internal`; a learner grouped for Triad 1 is a Triad 2 candidate) → language → fewest repeated prior co-members (partners from the cohort's other Triads), then the most availability overlap → groups of 3 → optional dyad → unmatched learners are flagged for Admin. `triad-auto-assign` takes a `cohort_requirement_date_id` and reports how many prior partner pairs it could not avoid (`repeated_pairs`). Manual assignment (`admin_triad_create_group(p_cohort_requirement_date_id, …)`) is requirement-scoped and shows each candidate's prior partners. `triad_validate_group_member` rejects an enrollment outside the requirement's cohort or programme. Auto-assign has no scheduled run and no stored run state. Reminders (`triad-reminders`, `send-programme-reminders`) are per requirement.

### Retired Triad objects

| Retired | Class | Replacement |
|---|---|---|
| `triad_rounds` (incl. `completion_deadline`, `auto_assign_*`, `is_visible`, `title`) | DEPRECATED in deployment 1 (no client access; archived in `triad_cutover_archive`); DROPPED in deployment 2 | nothing: programme = quantity, `cohort_requirement_dates` = cumulative dates |
| `programme_triad_rounds` | DEPRECATED → DROPPED in deployment 2 (it never had a runtime consumer) | `programme_modules.required_units` + `cohort_requirement_dates` |
| `triad_groups.member_1/2/3_id`, `enrollment_1/2/3_id`, `programme_id`, `round_number`, `triad_round_id`, `name` | not written in deployment 1; DROPPED (archived) in deployment 2 | `triad_group_members`, `triad_groups.cohort_id` |
| `triad_sessions.coach_ / coachee_ / observer_enrollment_id` | same | `triad_group_members`. Every member rotates through every role. |
| `triad_sessions.member_N_response`, `triad_alternative_proposals.member_N_response` | same | `triad_session_responses`, `triad_alternative_proposal_responses` |
| `triad_sessions.proposed_start/end_time`, `start_time`, `proposed_by` | same | `scheduled_start_time / scheduled_end_time` |
| `triad_alternative_proposals.proposed_by` | same | `proposed_by_enrollment_id` |
| `triad_reflections.participant_id`, `learned_as_*`, `will_use_as_*` | same (answers backfilled verbatim) | `enrollment_id`, `triad_reflection_answers` |
| `validate_triad_group_enrollment_scope`, `validate_triad_session_enrollment_scope`, `auto_confirm_triad_session`, `auto_accept_alternative_proposal`, `attribute_new_triad_activity` | DROPPED | `triad_validate_group_member`, `triad_guard_session`, `triad_confirm_session_if_accepted`, `triad_accept_proposal_if_unanimous`, `triad_sync_session_attributions` |
| Cohort-level groups (deployment 1: `triad_cohort_candidates_internal`, `admin_triad_create_group(p_cohort_id, …)`, `triad_create_group_internal(p_cohort_id, …)`, completion = distinct completed sessions) | REPLACED by `20260919120000_triad_requirement_groups` (every existing group mapped to its requirement; ambiguity stops the deployment) | requirement-specific groups + `canonical_triad_requirement_fulfilment` |
| `cohort_triad_operations`, `triad_requirement_units_internal`, `triad_unit_enrollment_status_internal` | NEVER DEPLOYED | `cohort_requirement_dates` + `triad_groups.cohort_requirement_date_id` |
| `triad_cutover_review_decisions`, `triad_cutover_archive` | INTERNAL (no client access) | Audit only. They answer no current business question. |

**Production readiness.** For `20260919120000_triad_requirement_groups`, run `scripts/triad-requirement-groups-readiness.sql` (read-only) first: it previews the requirement every existing group maps to (unit = 1 + the member's earlier same-cohort groups with a completed session; all members must agree), lists blocking groups, groups with more than one completed session (the extras become activity only) and the demo sessions that move to their own Triad 2 groups. The migration itself stops if a group can't be mapped or if a real (non-demo) learner's Triad progress would change.

For deployment 1 (already applied), `scripts/triad-cutover-readiness.sql` (read-only) was run against the target before deploying.

- **Section 2** classifies every legacy Triad record that conflicts with the model: no cohort, a member outside the cohort, a programme without a Triad requirement, a reflection on an open or future session, or a duplicate completed session.
  - DEMO/SEED rows are archived and removed by `20260918185900`.
  - REAL/UNKNOWN rows stop the deployment until someone corrects the data or ships a reviewed `delete` decision in `triad_cutover_review_decisions`, in a migration between `20260918185800` and `20260918185900`.
- **Section 3** must be empty.
- **Section 5** shows each enrollment's Triad progress before and after.
- **Section 6** lists past `confirmed` sessions. The legacy `trg_auto_confirm_triad` reset a learner's "Mark complete". A session updated after both its insert and its start is a candidate for a reviewed restore. A session never updated since insert isn't one.


## Operational completion is not evidence completion

Added by the 2026-09-21 Coaching and Mentoring remediation. Two different
facts, deliberately never fused:

**Operational completion** — the legitimate scheduled session took place and
reached `completed`. This, and only this, drives programme progress:

```
Coaching    completed session attributed to a requirement  -> one unit
Mentoring   completed session attributed to a requirement  -> one unit
Triads      fulfilled cohort requirement                   -> one unit
```

Triads differ on purpose: a Triad requirement may legitimately contain several
completed sessions, and only the requirement counts. Do not "simplify" Triads
into counting sessions.

**After-session evidence** — reflection, goal check-in, follow-up action,
satisfaction, provider notes, provider feedback, preparation document. Reported
by `coaching_session_evidence()` and `mentoring_session_evidence()`, which
return no unit or progress field of any kind. A surface may legitimately show:

```
Session completed · Reflection pending · Satisfaction pending
```

`20260920130000` originally made a Coaching unit complete only once all four
evidence items existed. That made a held session count as neither completed nor
booked once its date had passed, and — because the reflection had no writer
anywhere in the product — made Coaching completion unreachable for every
learner. `20260921130000` reverses it and renames `unit_complete` to
`evidence_complete`, so the two facts cannot be confused again by name.

## Canonical chains

```
Completion / progress
  canonical_module_progress (per module, internal)
    → canonical_enrollment_progress (THE enrollment row, internal)
        → learner_canonical_progress · sponsor_canonical_enrollment_progress · admin_canonical_enrollment_progress
        → sponsor_canonical_leader_progress · sponsor_canonical_enrollment_metadata (+ canonical_enrollment_engagement)
    → sponsor_canonical_cohort_progress_one / sponsor_canonical_cohort_progress (sums canonical enrollment rows)
        → sponsor_canonical_organisation_progress (sums visible cohort rows)

Journey:     sponsor_canonical_module_schedule → canonical_enrollment_journey → learner_ / sponsor_canonical_leader_ / admin_canonical_enrollment_journey
Experience:  canonical_enrollment_progress + schedule + activity → canonical_enrollment_experience_base → canonical_enrollment_experience
             → learner_canonical_experience · sponsor_canonical_leader_experience
Schedule state: cohort_programme_schedule_state → canonical_enrollment_schedule_state → learner_ / sponsor_canonical_leader_ / admin_canonical_schedule_state
```

Rollups only aggregate canonical rows (sums, counts of effective status and pace). They never recompute module progress, goal progress, overdue, adherence or status.

## Table / function classification

| Object | Class | Canonical replacement / note |
|---|---|---|
| `programme_modules` | CANONICAL | Requirements + default policy |
| `cohort_requirement_dates` | CANONICAL | Cohort due dates (non-Training) |
| `training_weeks`, `cohort_week_overrides` | CANONICAL | Training cohort timing. For requirement dates the precedence is cohort override → cohort calendar → programme template date. |
| `session_activity_attributions` | CANONICAL | Completion evidence |
| `canonical_module_progress`, `canonical_enrollment_progress`, `canonical_enrollment_journey`, `canonical_enrollment_experience(_base)`, `canonical_enrollment_engagement`, `canonical_goal_progress`, `canonical_training_learning_items`, `canonical_learning_breakdown`, `sponsor_canonical_module_schedule`, `sponsor_canonical_activity`, `cohort_programme_schedule_state`, `canonical_enrollment_schedule_state`, `cohort_requirement_proposal_internal` | CANONICAL (INTERNAL) | Shared constructions. Not client-callable. |
| `learner_canonical_*`, `sponsor_canonical_*`, `admin_canonical_*` | CANONICAL wrappers | Role eligibility only |
| `get_sponsor_programme_progress`, `get_sponsor_programme_journey`, `sponsor_canonical_cohort_progress_one` | INTERNAL | Projections used inside canonical functions; not client-callable |
| `attribute_activity_to_cadence_milestone`, `generate_enrollment_schedule`, `backfill_enrollment_schedule_snapshots` | INTERNAL / HISTORICAL | Maintain the snapshot history only |
| `enrollment_module_snapshots`, `enrollment_module_milestones` | HISTORICAL / DERIVED | Enrollment-time record for activity-to-milestone attribution. Never current requirements, dates or completion. |
| `get_enrollment_progress` | HISTORICAL | Snapshot progress engine; not client-callable |
| `programme_enrollments.progress_pct` | DEPRECATED | Not maintained (maintenance functions dropped), always NULL. Use `canonical_enrollment_progress.full_completion_pct`. |
| `sponsor_min_leaders_for_distribution()` | CANONICAL | Single zero-argument signature |
| Learner Training page unlock (`get_enrollment_training_weeks`, `get_my_training_weeks`) | CONTENT ACCESS | Unlocks content from the learner's own enrollment start. This is a content-availability rule, not a requirement due date. |
| `20260918090000_sponsor_canonical_calendar_followup.sql` | RETIRED | Intentional no-op |

### Retired (dropped in `20260918180000_retire_legacy_sponsor_sources`)

| Retired | Canonical replacement |
|---|---|
| `sponsor_enrollment_summaries` | `sponsor_canonical_enrollment_progress` / `sponsor_canonical_enrollment_metadata` |
| `sponsor_cohort_summaries`, `sponsor_cohort_summaries_legacy`* | `sponsor_canonical_cohort_progress` |
| `sponsor_organisation_summary`, `sponsor_organisation_summary_legacy`* | `sponsor_canonical_organisation_progress` |
| `sponsor_metric_rows`*, `sponsor_metric_rows_legacy`*, `sponsor_satisfaction_summary`, `sponsor_satisfaction_events`*, `sponsor_normalize_satisfaction`* | `canonical_enrollment_engagement` satisfaction fields (via `sponsor_canonical_enrollment_metadata`) |
| `sponsor_leader_engagement_summary` | `sponsor_canonical_enrollment_metadata` |
| `sponsor_leader_cadence_items`*, `sponsor_cohort_cadence_items`* | `canonical_enrollment_journey` |
| `sponsor_enrollment_next_session`*, `sponsor_canonical_leader_next_booking` | `canonical_enrollment_experience` → `coaching_utilisation.next_session_at` |
| `sponsor_leader_programme_history`* | `sponsor_canonical_leader_progress` |
| `sponsor_canonical_leader_experience_base`, `sponsor_canonical_leader_experience_legacy`, `learner_canonical_experience_legacy` | `canonical_enrollment_experience` |
| `get_admin_enrollment_progress` | `admin_canonical_enrollment_progress` |
| `compute_leader_progress`, `refresh_all_progress_pct`, `trg_update_progress_from_session`, `trg_update_progress_from_training` | none (`progress_pct` is deprecated) |

\* existed only on hosted production (not created by any repository migration).

### Known production-only exception

The demo-organisation reset tooling (30 `demo_*` / `get_demo_organization_status` functions and 5 `demo_*` tables) exists only on hosted production. It answers no programme business fact. Only `get_demo_organization_status` is client-callable, and it is Admin/service-role gated. Pending a decision: bring it under migration control, or remove it.

## Rules for new code

1. **Don't calculate** requirement dates, completion, adherence, overdue,
   status or checkpoints in the frontend. Render what the canonical RPC
   returns.
2. **Adding a role or surface** means adding an *eligibility wrapper* around
   the shared construction (`canonical_enrollment_progress`,
   `canonical_enrollment_journey`, `canonical_enrollment_schedule_state`).
   Never write a new aggregation.
3. **Changing scheduling policy** belongs in `cohort_requirement_proposal_internal`
   only. Materialized cohort dates are never rewritten implicitly.
4. **Snapshots and caches** must not be read by user-facing current-state
   surfaces.
5. **Guards enforce this contract** and must stay green:
   - `src/test/programmeProfileArchitecture.test.ts` and
     `src/test/migrationChain.test.ts` (frontend and migration chain);
   - `supabase/tests/cohort_requirement_schedule_test.sql`,
     `supabase/tests/source_of_truth_contract_test.sql` and
     `supabase/tests/triad_canonical_contract_test.sql` (database);
   - the "Triad source of truth" block in `src/test/programmeProfileArchitecture.test.ts`,
     which also scans `supabase/functions` (no retired Triad field, no Triad round, no
     cohort-scoped assignment, requirement-scoped auto-assignment with repeated-partner
     minimisation, one Admin card / learner section per required Triad, sessions labelled
     "Triad N", per-requirement reminders, no local Triad completion, no client-side Triad
     date or overdue logic, and no "0 required" when the requirement fails to load);
   - the final-state guard at the end of
     `20260918170000_single_source_of_truth.sql`, which fails the deployment
     if the canonical definitions aren't in place; the final-state guards of
     `20260918190000_triad_canonical_cutover.sql` (equivalence with the legacy
     data), of `20260919120000_triad_requirement_groups.sql` (every group linked
     to a requirement of its cohort, one active group per enrollment per
     requirement, projection = canonical progress, real learners' progress
     unchanged, no retired field, no cohort-scoped assignment) and of
     `supabase/deployment-2/20260919190000_triad_retire_legacy.sql` (no
     retired Triad field or client-callable internal Triad function; the
     requirement link is required).
