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
| **Triad membership** | `triad_groups` | `learner_triad_members` | Never derived from session records. |

## Table / function classification

| Object | Class | Status |
|---|---|---|
| `programme_modules` | canonical | Requirements + default policy |
| `cohort_requirement_dates` | canonical | Cohort due dates (non-Training) |
| `training_weeks`, `cohort_week_overrides` | canonical | Training cohort timing |
| `session_activity_attributions` | canonical | Completion evidence |
| `enrollment_module_snapshots`, `enrollment_module_milestones` | **historical / derived** | Record of the module configuration and milestone at enrollment time; used for activity-to-milestone attribution history. **Not** a current requirement, due date or completion source. |
| `get_enrollment_progress` | **historical** | Snapshot progress engine. Not client-callable. |
| `generate_enrollment_schedule`, `attribute_activity_to_cadence_milestone`, `backfill_enrollment_schedule_snapshots` | historical infrastructure | Maintain the snapshot history only. |
| `get_admin_enrollment_progress` | projection | Compatibility projection of `admin_canonical_enrollment_progress`. |
| `sponsor_enrollment_summaries`, `sponsor_cohort_summaries`, `sponsor_organisation_summary`, `sponsor_leader_engagement_summary` | legacy projections | Not used by the app. Unit progress comes from `canonical_module_progress`; goal progress uses the canonical goal rule. New code must use the `sponsor_canonical_*` RPCs. |
| `sponsor_*_cadence_items`, `sponsor_*_legacy`, `sponsor_metric_rows*`, `sponsor_enrollment_next_session`, `sponsor_leader_programme_history` | **retired** | Not client-callable. These exist only on hosted production, created outside the migration chain (schema drift). |
| `programme_enrollments.progress_pct` | **deprecated** | Not maintained, always NULL. Use `canonical_enrollment_progress.full_completion_pct`. |
| `20260918090000_sponsor_canonical_calendar_followup.sql` | superseded | Intentional no-op; its dynamic-schedule redefinition must never apply. |

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
   - `supabase/tests/cohort_requirement_schedule_test.sql` and
     `supabase/tests/source_of_truth_contract_test.sql` (database);
   - the final-state guard at the end of
     `20260918170000_single_source_of_truth.sql`, which fails the deployment
     if the canonical definitions aren't in place.
