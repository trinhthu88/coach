# Enrollment Remaining Batches Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development to implement bounded tasks and review each result. Steps use checkbox syntax.

**Goal:** Complete enrollment-owned programme configuration, progress, goals/actions, sponsor reporting, replacement demo fixtures, and final enforcement.

**Architecture:** Extend the existing programme module JSON configuration and immutable enrollment snapshots. Keep progress calculations in PostgreSQL and expose privacy-limited sponsor RPCs using enrollment IDs. Normalize actions and check-ins through validated enrollment relationships.

**Tech Stack:** React, TypeScript, Supabase PostgreSQL, Vitest, pgTAP.

**Spec:** User instructions in the current conversation, captured below. Corrupted business-rule fragments have been requested from the user; dependent behavior must not be guessed.

## Global Constraints

- Continue on feature/enrollment-scoped-foundation from green bd5762b.
- Do not modify remote Supabase, merge, deploy, or retry Replit Docker.
- Keep historical migrations unchanged; use forward migrations.
- Never guess ambiguous ownership or delete fixture identities by name.
- Preserve platform administrator and reuse appropriate coaches/mentors.
- Commit and push each green batch; use GitHub database validation for reset, pgTAP, lint, and type regeneration evidence.
- A missing business decision blocks only dependent work.

## Batch sequence and acceptance

1. Batch 2: admin module configuration, schedule snapshots, historical progress, learner integration, three-active-goal limit, universal check-ins/history and normalized actions with preserved source/goal/milestone links. No fabricated ratings.
2. Batch 3: organization/cohort/leader reporting from one enrollment calculation, including participation, progress, pace, goal-progress percentage and satisfaction rating. Exclude comments, goal text, session content, notes, reflections, prompts and quiz scores. Test cross-organization access and historical isolation.
3. Batch 4: identity-safe replacement fixtures, exactly two demo programmes/cohorts and ten distinct leaders split five/five, coaching-only and blended, sponsor contact@erickson.vn, idempotent rich activity and count/privacy tests.
4. Final enforcement: deterministic backfill, unresolved audit retention, conditional NOT NULL only at zero unresolved records, remove legacy production readers/writers/calculations, regenerate types, full verification and CI.

### Task 1: Programme module schedule configuration editor

**Files:** Modify src/pages/admin/AdminProgrammes.tsx; create src/pages/admin/ProgrammeModuleScheduleFields.tsx and src/lib/programmeModuleConfig.ts; add src/lib/__tests__/programmeModuleConfig.test.ts and component tests; modify en/vi admin locale keys.

**Interfaces:** Consumes existing ModuleRow.config. Produces validateModuleScheduleConfig(config: Record<string, unknown>): string | null and a controlled editor using config/onChange props. Configuration keys remain required, required_units, weight, distribution_mode, distribution_settings. Modes remain evenly_distributed, monthly_frequency, training_linked, custom, flexible. Preserve unrelated module keys.

- [ ] Write and run failing validation/UI tests. Examples: required_units=-1 fails; weight=-1 fails; required=true with zero units fails; coaching flexible configuration with three units and no training succeeds; custom milestone units must sum to required_units; monthly interval must be positive; training-linked IDs require selection.
- [ ] Implement labeled required/optional toggle, integer unit count, optional nonnegative weight and mode selector. Show applicable monthly interval, training-week selection, or editable custom milestone date/unit/window rows. Reject invalid config before any programme save.
- [ ] Run focused tests, TypeScript and lint for touched files. Review diff for untouched config-key preservation and non-training programme support.

### Task 2: Snapshot and progress database corrections

**Files:** New forward migration after 20260910161000; new supabase/tests/enrollment_progress_test.sql; generated types only for actual signature changes.

**Interfaces:** Preserve generate_enrollment_schedule(uuid) and get_enrollment_progress(uuid,date) signatures. Existing snapshots stay unchanged on repeated generation. Flexible requirements become due at ends_on; historical completed counts exclude activity after p_as_of. Verify exact deadlines and unit totals for each supported mode with pgTAP.

- [ ] Write behavior tests with transaction-local identities/enrollments for snapshot immutability, each mode, future activity exclusion, and completed status timing.
- [ ] Implement forward function replacements; validate schedule settings and reject invalid mode relationships rather than silently truncate requirements.
- [ ] Run non-Docker checks; use GitHub pgTAP and database lint to validate executable SQL.

### Dependent task planning

Goals/actions, sponsor aggregation business semantics, fixture identity cleanup and final enforcement will each receive bounded file/interface/test briefs after the preceding interfaces and outstanding business rules are resolved. This plan does not authorize invented meanings for corrupted requirements.

### Task 3: Learner enrollment progress integration

**Files:** src/hooks/dashboard/useProgrammeProgress.ts, src/components/ProgrammeProgressCard.tsx, src/hooks/journey/useJourneyProgramme.ts, new src/hooks/useEnrollmentProgress.ts, related focused tests and en/vi training locales.

**Interfaces:** useEnrollmentProgress(enrollmentId?: string, asOf?: string) consumes get_enrollment_progress(uuid,date) and exposes module rows/loading/error. Use selected enrollment ID in all query keys and related activity reads. ProgrammeProgressCard renders enabled module progress even when training is disabled, with no client-side programme percentage calculation. Keep training content and learner-only quiz scores separate from module completion percentages.

- [ ] Add failing hook/component tests for a coaching-only enrollment, no-enrollment disabled fetch, explicit historical enrollment isolation, RPC errors, and module percentage display.
- [ ] Implement the hook and connect dashboard card; use RPC rows for completion and pace. Retain training shortcuts only when training is present.
- [ ] Replace journey programme latest-active lookup with useEnrollmentContext selection and enrollment ID-filtered reads. Keep booking quotas separate from programme completion.
- [ ] Run focused tests, TypeScript and lint. No overall weighted formula until business semantics are confirmed; display module-level RPC values.

### Task 4: Universal enrollment goals, check-ins and rating history

**Files:** New forward migration 20260910171000_enrollment_goal_checkins.sql, supabase/tests/enrollment_goals_test.sql; src/pages/session/SessionGoalRatings.tsx; src/hooks/journey/useJourneyRatings.ts and useJourneyDerived.ts; src/pages/journey/GoalWheel.tsx and GoalAccordion.tsx; session/mentoring/triad/onboarding entry components; generated types and en/vi session/journey locales.

**Interfaces:** Preserve record_goal_checkin(uuid,uuid,text,uuid,smallint,text) and goal_checkins. Every goal read/write uses explicit enrollment_id. Reuse GoalDialog for learner goal creation in all activity contexts and onboarding. SessionGoalRatings accepts explicit enrollmentId/sourceActivityType; source ID remains sessionId. Read history from goal_checkins, not person-scoped session_goal_ratings.

- [ ] Write tests rejecting a fourth active goal, moving an active goal into a full enrollment, foreign-enrollment ratings/check-ins, unsupported activity source, and unauthenticated check-ins. Verify unrated input stays null and save never invents 50 or another numeric default.
- [ ] Lock the enrollment during active-goal limit checks; count other active goals for insert, reactivation and ownership change. Validate rating/goal/enrollment relationships.
- [ ] Make missing baseline values explicit null; require user-entered baseline/target for goal-progress percentage. Preserve actual existing values. Keep unrated goals out of numerical aggregate denominators and show missing state in UI.
- [ ] Route check-in submission through validated RPC for coaching, mentoring, peer coaching and triads. Keep source IDs and previous/current rating history; retries must not duplicate the same activity check-in. No invented source or baseline.
- [ ] Connect learner-created goals in each activity and onboarding to the same enrollment-scoped CRUD and enforce three-active limit in the database.
- [ ] Run focused tests, pgTAP, TypeScript and lint; record review evidence before the batch commit.

### Task 5: Normalized enrollment actions

**Files:** New forward migration 20260910172000_enrollment_actions_cutover.sql and supabase/tests/enrollment_actions_test.sql; new src/lib/enrollmentActions.ts; existing session core/GROW/journey/action summary consumers.

**Interfaces:** save_enrollment_activity_actions(p_enrollment_id uuid, p_source_activity_type text, p_source_activity_id uuid, p_actions jsonb) writes normalized rows atomically. Sources: coaching, peer_coaching, coachee_peer_coaching, mentoring, triad. JSON input items use id/title/status/due_date/goal_id/milestone_id; source identity is passed separately and verified against the actual activity. Reads use enrollment_actions; UI adapters may preserve existing action display shapes, but must not read/write stored session action_items.

- [ ] Add pgTAP tests for foreign source rejection, milestone/goal consistency, provider authorization, atomic saves, stable IDs, idempotent legacy backfill and isolation between enrollments.
- [ ] Extend action validation and provider policies using actual activity participation; atomically synchronize only the specified source/enrollment. Keep private action text inaccessible to sponsors.
- [ ] Deterministically import legacy session JSON actions by source UUID and item ordinal; retain invalid/ambiguous legacy rows in a private audit report. Preserve enrollment, source, goal and milestone relationships.
- [ ] Switch production action consumers and writes to normalized rows and stable action IDs, including GROW, session detail, journey and dashboard summaries.
- [ ] Run focused frontend and SQL tests, typecheck and review all production action_items references before batch verification.
