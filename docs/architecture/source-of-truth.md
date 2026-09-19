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

Established by `20260918190000_triad_canonical_cutover` and `20260918199000_triad_retire_legacy`, with `20260918192000_triad_completion_rule_stable` and `20260918193000_triad_history_guards`.

| Triad fact | Authoritative source | Read through | Notes |
|---|---|---|---|
| Required Triad units | `programme_modules` (`module = 'triads'`, `config.required_units`) | `canonical_module_progress` | The only round-count source. Admin can't add rounds. |
| Triad unit N (the "round") and its due date | `cohort_requirement_dates` (`module = 'triads'`, `ordinal = N`, always `units = 1`) | `triad_requirement_units_internal` → `admin_cohort_triad_requirements`, `learner_triad_overview`, journey | Editing the Cohort Requirement Schedule moves every Triad screen. |
| Group | `triad_groups.cohort_requirement_date_id` | same | Cohort, programme, unit number and due date are derived through the requirement row. |
| Membership | `triad_group_members` (`triad_group_id`, `enrollment_id`) | `canonical_triad_group_members` → `learner_triad_members` | 2–3 members. Learner/profile comes through the enrollment. `member_order` is display order only, not a role. |
| Actual session time + lifecycle | `triad_sessions.scheduled_start_time / scheduled_end_time`, `status` (`proposed → confirmed → completed`, or `cancelled`) | `learner_triad_overview`, `learner_session_history` | Lifecycle is enforced by the `triad_sessions_guard` trigger for every writer. |
| Session acceptance | `triad_session_responses` (session × enrollment) | `learner_triad_overview` | |
| Alternative times | `triad_alternative_proposals` (`pending → accepted \| superseded`) + `triad_alternative_proposal_responses` | `learner_triad_overview` | A candidate becomes the session time only when every member accepts. Superseded ones stay as history. |
| Completion evidence | completed `triad_sessions` × `triad_group_members` → `session_activity_attributions` (one writer: `triad_sync_session_attributions`) | `canonical_module_progress` | Completion is validated server-side (`learner_triad_complete_session` + session guard). Capped at required units. A reflection is never completion. A completed session is final, and it can't be deleted by any writer, Admin included. The same goes for a session with reflections (`triad_sessions_guard_delete`). |
| Progress / overdue per unit | `canonical_module_progress` | `triad_unit_enrollment_status_internal` → Admin, Learner. Sponsor reads canonical progress / journey. | Unit N is completed when completed units ≥ N, and overdue when N ≤ due units and not completed. No local overdue rule. |
| Goal rating / comment | `goal_checkins` (via `record_goal_checkins`, source `triad`) | `learner_reflection_feed` | Never copied into Triad tables. |
| Triad reflection | `triad_reflections` (one per session × enrollment; `satisfaction_rating`) | `learner_triad_session_reflections`, `learner_reflection_feed` | Group members see each other's only after all have submitted. Sponsors never see it. |
| Reflection answers | `triad_reflection_answers` × `triad_reflection_questions` (stable ids / keys, programme-scoped or default set) | same | |
| Auto-assign run state | `cohort_triad_operations` | service role only | Operational only: never a date, a membership or a completion. |
| Triad reflection rate (Admin Analytics per-week table, weekly admin email) | derived from `triad_reflections` | `useAdminProgrammeEngagement`, `send-weekly-admin-summary` | An engagement signal, labelled "Triad reflection". It is never presented as Triad completion. |
| My Journey / Your Sessions / Dashboard | projections only | `learner_reflection_feed`, `learner_session_history`, `canonical_enrollment_journey` | No Triad data is copied into another table. |

Assignment is always requirement-first: cohort Triad requirement → that cohort's ongoing enrollments → exclude those already grouped for the unit → language → availability. `triad-auto-assign` takes a `cohort_requirement_date_id`, and `triad_validate_group_member` rejects any enrollment from another cohort or programme.

### Retired Triad objects

| Retired | Class | Replacement |
|---|---|---|
| `triad_rounds` (incl. `completion_deadline`, `auto_assign_*`, `is_visible`, `title`) | DROPPED (archived in `triad_cutover_archive`) | `cohort_requirement_dates` + `cohort_triad_operations` |
| `programme_triad_rounds` | DROPPED (had no runtime consumer) | `programme_modules.required_units` + `cohort_requirement_dates` |
| `triad_groups.member_1/2/3_id`, `enrollment_1/2/3_id`, `cohort_id`, `programme_id`, `round_number`, `triad_round_id`, `name` | DROPPED (archived) | `triad_group_members`, `cohort_requirement_date_id` |
| `triad_sessions.coach_ / coachee_ / observer_enrollment_id` | DROPPED (archived) | `triad_group_members`. Every member rotates through every role. |
| `triad_sessions.member_N_response`, `triad_alternative_proposals.member_N_response` | DROPPED (archived) | `triad_session_responses`, `triad_alternative_proposal_responses` |
| `triad_sessions.proposed_start/end_time`, `start_time`, `proposed_by` | DROPPED (archived) | `scheduled_start_time / scheduled_end_time` |
| `triad_alternative_proposals.proposed_by` | DROPPED (archived) | `proposed_by_enrollment_id` |
| `triad_reflections.participant_id`, `learned_as_*`, `will_use_as_*` | DROPPED (archived; answers backfilled verbatim) | `enrollment_id`, `triad_reflection_answers` |
| `validate_triad_group_enrollment_scope`, `validate_triad_session_enrollment_scope`, `auto_confirm_triad_session`, `auto_accept_alternative_proposal`, `attribute_new_triad_activity` | DROPPED | `triad_validate_group_member`, `triad_guard_session`, `triad_confirm_session_if_accepted`, `triad_accept_proposal_if_unanimous`, `triad_sync_session_attributions` |
| Admin local overdue (`completion_deadline` + session status) | REMOVED | `triad_unit_enrollment_status_internal` (canonical progress) |
| `triad_cutover_group_decisions`, `triad_cutover_archive` | INTERNAL (no client access) | Audit only. They answer no current business question. |

Production readiness: run `scripts/triad-cutover-readiness.sql` (read-only) against the target before deploying. Every group it lists as `AMBIGUOUS` needs a reviewed row in `triad_cutover_group_decisions`, shipped in a migration between `20260918185900` and `20260918190000`. Otherwise the cutover stops.

Section 6 of the same report lists past `confirmed` sessions. The legacy `trg_auto_confirm_triad` trigger reset a session to `confirmed` on every update once all members had accepted. That included the learner's own "Mark complete", so a completion made that way was never stored. The cutover keeps stored statuses as they are and never infers a completion. Restoring one needs a reviewed decision (a follow-up migration that names the sessions).

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
     which also scans `supabase/functions` (no retired Triad field, requirement-first
     auto-assignment, no Triad completion derived from reflections or session rows,
     no client-side Triad date or overdue logic);
   - the final-state guard at the end of
     `20260918170000_single_source_of_truth.sql`, which fails the deployment
     if the canonical definitions aren't in place, and the final-state guard
     in `20260918199000_triad_retire_legacy.sql` (no retired Triad field or
     client-callable internal Triad function).
