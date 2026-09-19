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
| **Activity completion (evidence)** | `session_activity_attributions` + Training completion | `sponsor_canonical_activity`, `canonical_training_learning_items` | Session booking dates never become requirement due dates. |
| **Module completion, overall completion %, due-to-date adherence %, overdue units, pace** | computed once | `canonical_enrollment_progress` (per module: `canonical_module_progress`) → `learner_canonical_progress`, `sponsor_canonical_enrollment_progress` / `_leader_progress` / `_enrollment_metadata`, `admin_canonical_enrollment_progress` | Cohort and organisation rollups aggregate these per-enrollment rows. |
| **Programme Journey checkpoints** | computed once | `canonical_enrollment_journey` → `learner_canonical_journey`, `sponsor_canonical_leader_journey`, `admin_canonical_enrollment_journey`; cohort view `get_sponsor_programme_journey` (same schedule, cohort aggregate) | One checkpoint per due date. Modules only in `module_scope`, never as a title. The UI never regroups checkpoints. |
| **Session history** | session tables (`sessions`, `coachee_peer_sessions`, `peer_sessions`, `mentoring_sessions`, `triad_sessions`) | `learner_session_history` | |
| **Goals / actions** | `coachee_goals`, `coachee_goal_ratings`, `enrollment_actions` | per-goal progress `canonical_goal_progress`; aggregates `canonical_enrollment_engagement` | Archived goals are excluded; unrated goals have no progress. |
| **Reflections** | original reflection records | `learner_reflection_feed` | |
| **Feedback** | original feedback records | learner feedback source (`useLearnerFeedback`) | Author-private notes are never selected. |
| **Triad membership** | `triad_group_members.enrollment_id` | `canonical_triad_group_members` → `learner_triad_members` | Never derived from session records or role columns. See the Triad ownership map below. |

## Triad ownership map

Established by `20260918185800_triad_cutover_ledgers`, `20260918185900_triad_legacy_data_cleanup` and `20260918190000_triad_canonical_cutover` (deployment 1). Legacy storage is dropped by `supabase/deployment-2/20260918199000_triad_retire_legacy.sql` (deployment 2, only after deployment 1 is verified in production).

The business model:

- **Programme** = how many Triad sessions are required.
- **Cohort** = cumulative deadlines for those sessions ("N completed sessions by this date").
- **Group** = which enrollments of the cohort practise together.
- **Session** = one actual practice session of that group.
- **Completed session** = one unit of evidence for every member of that group.

A group is never tied to a requirement unit. A session is never assigned to a deadline. There is no Triad "round".

| Triad fact | Authoritative source | Read through | Notes |
|---|---|---|---|
| Triad required count | `programme_modules` (`module = 'triads'`, `config.required_units`) | `canonical_module_progress` → `canonical_triad_completion` | Groups can only be created for learners whose programme requires Triads. |
| Triad cumulative due dates | `cohort_requirement_dates` (`module = 'triads'`, `ordinal = N`, always `units = 1`) | `admin_cohort_triad_requirement`, `canonical_triad_completion.schedule`, journeys | Row N means "N completed Triad sessions by this date". It identifies no group and no session. Edit it in the Cohort Requirement Schedule only. |
| Triad group | `triad_groups.cohort_id` (+ `is_active`, `closed_at`, `assigned_by`, `group_language`) | `admin_cohort_triad_groups`, `learner_triad_overview` | Cohort-level. It practises together across all required sessions. |
| Triad members | `triad_group_members.enrollment_id` | `canonical_triad_group_members` → `learner_triad_members` | 2–3 members of the group's cohort, one programme. Learner, programme and cohort come through the enrollment. Only one active group per enrollment. Membership is final once the group has any session: to regroup, close the group and create a new one. |
| Actual session | `triad_sessions` (`scheduled_start_time / scheduled_end_time`, `status`) | `learner_triad_overview`, `learner_session_history`, `admin_cohort_triad_groups` | `proposed → confirmed → completed`, or `cancelled`. `completed` and `cancelled` are final. One open session per group. After a session completes, the same group schedules the next one (`learner_triad_schedule_session`). |
| Session acceptance | `triad_session_responses` (session × enrollment) | `learner_triad_overview` | Only members of the session's historical group can respond. |
| Alternative time | `triad_alternative_proposals` (`pending → accepted \| superseded \| withdrawn`) + `triad_alternative_proposal_responses` | `learner_triad_overview` | A candidate becomes the session time only when every member accepts it. |
| Goal check-in | `goal_checkins` (via `record_goal_checkins`, source `triad`) | `learner_reflection_feed` | Never copied into Triad tables. |
| Triad reflection | `triad_reflections` (one per session × enrollment; `satisfaction_rating`) | `learner_triad_session_reflections`, `learner_reflection_feed` | Group members see each other's only after everyone has submitted. Sponsors never see it. |
| Triad answers | `triad_reflection_answers` × `triad_reflection_questions` (stable ids / keys) | same | |
| Completion evidence | session × historical membership → `session_activity_attributions` (one writer: `triad_sync_session_attributions`) | `sponsor_canonical_activity` | Session evidence only: `milestone_id` is always NULL for Triads. Dated on the session's scheduled start. A cancelled session is no evidence. |
| **Completion** | distinct completed Triad sessions of the enrollment's (historical) groups, capped at the programme's required units | `canonical_module_progress` → `canonical_triad_completion` (`raw_completed_sessions`, `completed_units`, `completed_by_as_of`) | A third session is kept as activity beyond the requirement. It doesn't depend on staying in one group. |
| **Due / overdue** | cumulative due dates compared with cumulative completed session evidence | `canonical_module_progress` → `canonical_triad_completion` (`due_units`, `overdue_units`, `next_due_on`), journeys | `due_units` = Triad dates ≤ as-of. `overdue_units` = max(due − min(completed by as-of, due), 0). Journey checkpoints use activity dates ≤ the checkpoint. |
| Triad reflection rate | `triad_reflection_rate_internal` | `admin_programme_triad_reflection_rate`, `send-weekly-admin-summary` | An engagement signal, labelled "Triad reflection". It is never Triad completion. |
| My Journey / Your Sessions / Dashboard | projections only | `learner_reflection_feed`, `learner_session_history`, `canonical_enrollment_journey` | No Triad data is copied into another table. No round or week label. |

Every role reads these facts from the same place: Admin (`admin_cohort_triad_learners`), Learner (`learner_triad_status`, `learner_canonical_progress`), Sponsor (`sponsor_canonical_leader_progress` / journey) and a coach enrolled as a learner (the learner path). Privacy can hide reflection content, but never changes a programme fact.

Assignment is always cohort-first: selected cohort → that cohort's eligible ongoing enrollments (programme requires Triads) → exclude those already in an active group → language → availability → groups of 3 → optional dyad → unmatched learners are flagged for Admin. `triad-auto-assign` takes a `cohort_id`. `triad_validate_group_member` rejects an enrollment from another cohort. Auto-assign has no scheduled run and no stored run state.

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
| Requirement-specific model (`triad_groups.cohort_requirement_date_id`, `canonical_triad_requirement_fulfilment`, `cohort_triad_operations`, `triad_requirement_units_internal`, `triad_unit_enrollment_status_internal`) | NEVER DEPLOYED (removed from the undeployed chain before deployment) | cohort-level groups + `canonical_triad_completion` |
| `triad_cutover_review_decisions`, `triad_cutover_archive` | INTERNAL (no client access) | Audit only. They answer no current business question. |

**Production readiness.** Run `scripts/triad-cutover-readiness.sql` (read-only) against the target before deploying.

- **Section 2** classifies every legacy Triad record that conflicts with the model: no cohort, a member outside the cohort, a programme without a Triad requirement, a reflection on an open or future session, or a duplicate completed session.
  - DEMO/SEED rows are archived and removed by `20260918185900`.
  - REAL/UNKNOWN rows stop the deployment until someone corrects the data or ships a reviewed `delete` decision in `triad_cutover_review_decisions`, in a migration between `20260918185800` and `20260918185900`.
- **Section 3** must be empty.
- **Section 5** shows each enrollment's Triad progress before and after.
- **Section 6** lists past `confirmed` sessions. The legacy `trg_auto_confirm_triad` reset a learner's "Mark complete". A session updated after both its insert and its start is a candidate for a reviewed restore. A session never updated since insert isn't one.

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
     which also scans `supabase/functions` (no retired Triad field, no requirement-unit /
     round ownership of groups or sessions, cohort-first auto-assignment, no local Triad
     completion, no client-side Triad date or overdue logic, and no "0 required" when the
     requirement fails to load);
   - the final-state guard at the end of
     `20260918170000_single_source_of_truth.sql`, which fails the deployment
     if the canonical definitions aren't in place; the final-state guards of
     `20260918190000_triad_canonical_cutover.sql` (equivalence with the legacy
     data, no function reading a retired Triad field or a requirement-unit link)
     and of `supabase/deployment-2/20260918199000_triad_retire_legacy.sql` (no
     retired Triad field or client-callable internal Triad function).
